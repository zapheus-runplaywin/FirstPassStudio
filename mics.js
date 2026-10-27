// FirstPass Studio - mics: live microphones (wireless effects mics on court, crowd mics) mixed into the stream's sound.
//
// A mic is one input of an audio device plugged into the Mac (a wireless receiver, a USB interface): the device by
// the name macOS gives it, and which of its channels (both, left or right, so two receivers on one stereo interface
// are two mics). Studio keeps the settings; the primary output's own window (scene.html in the app's display, NDI or
// Blackmagic output) opens the devices and mixes them into its sound, so the mics go out with the music and video
// sound on the Mac's sound output. They're never played in a Scene View: a speaker in the room near a mic would
// feed back. With the primary output off, the mics are silent.
//
// Each mic has a level (0-200 %, 100 as it comes in), a mute and a low cut (on by default: takes out rumble and wind
// below about 100 Hz). One master level and mute sit over all of them, and a limiter at the end stops a loud shout
// clipping the stream.
//
// Dips: like the music's duck, the mics come down to the Dip to level (and back up) while
//   - music is playing (the player's, a sequence's or the super shot song),
//   - a video with its sound on is showing (or a page playing a theme song),
//   - a scene or sequence with "Quiet the music" ticked is on (an interview on court),
//   - the Dip button or /deck/mics/dip is on, by hand.
// Each of the first three is a tick box; the Dip by hand always works. A mic with "Follows the dips" off stays at
// its level whatever happens (a commentator's mic, say). The dip goes down over dipDownSec and back up over
// dipUpSec: dip { from, to, at, ms } goes from 0 (up) to 1 (down at dipTo), as the music's duck does.
//
// The window mixing the mics reports what it hears every half second (report()): the devices it can see, each mic's
// level as it comes in, and any trouble (no permission, device not plugged in). The Output page shows it from live().
// The Output page opened in the Mac app can also list the Mac's devices itself, before any output is on.
//
// Saved as mics.json in the data folder: one set of mics for the Mac (the devices are this Mac's), not per competition.

'use strict';

const fs = require('fs');
const datadir = require('./datadir');
const savefile = require('./savefile');

const FILE = datadir.file('mics.json');
const MAX_MICS = 8;
const CHANNELS = ['both', 'left', 'right'];
// A report older than this means no window is mixing the mics (the primary output is off, or its window stopped).
const REPORT_STALE_MS = 3000;

let log = () => {};
let settings = defaults();
let hand = false; // the Dip by hand
let why = { music: false, video: false, quiet: false };
let down = false;
let dip = { from: 0, to: 0, at: 0, ms: 0 };
let seen = { at: 0, devices: [], levels: {}, problems: {}, status: '' };
let listed = { at: 0, devices: [] }; // the devices the Output page in the Mac app listed

function defaults() {
  return { level: 100, muted: false, dipTo: 30, dipMusic: true, dipVideo: true, dipQuiet: true, dipDownSec: 1, dipUpSec: 2, mics: [] };
}

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const flag = (v, d) => v === undefined ? d : !!v;

// ─── Saving ──────────────────────────────────────────────────────────────
function cleanMic(m, existing = {}) {
  const s = { ...existing, ...(m && typeof m === 'object' ? m : {}) };
  const out = {
    id: String(existing.id || s.id || newId()).replace(/[^a-z0-9]/gi, '').slice(0, 20) || newId(),
    name: '',
    device: text(s.device, 200), // the device's name as macOS gives it; '' is the Mac's default input
    channel: CHANNELS.includes(s.channel) ? s.channel : 'both',
    level: Math.round(clamp(s.level, 0, 200, 100)),
    muted: flag(s.muted, false),
    lowCut: flag(s.lowCut, true),
    follow: flag(s.follow, true), // follows the dips
  };
  const base = text(s.name, 40) || 'Mic';
  const taken = new Set(settings.mics.filter(x => x.id !== out.id).map(x => slug(x.name)));
  out.name = base;
  for (let i = 2; taken.has(slug(out.name)) || !slug(out.name); i++) out.name = `${base} ${i}`;
  return out;
}
function cleanSettings(v) {
  const s = { ...settings, ...(v && typeof v === 'object' ? v : {}) };
  return {
    level: Math.round(clamp(s.level, 0, 100, 100)),
    muted: flag(s.muted, false),
    dipTo: Math.round(clamp(s.dipTo, 0, 100, 30)),
    dipMusic: flag(s.dipMusic, true),
    dipVideo: flag(s.dipVideo, true),
    dipQuiet: flag(s.dipQuiet, true),
    dipDownSec: clamp(s.dipDownSec, 0, 10, 1),
    dipUpSec: clamp(s.dipUpSec, 0, 10, 2),
    mics: settings.mics,
  };
}
function load() {
  settings = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    settings = cleanSettings(saved);
    for (const m of Array.isArray(saved.mics) ? saved.mics.slice(0, MAX_MICS) : []) if (m && typeof m === 'object') settings.mics.push(cleanMic(m));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'mics', `Could not read mics.json, starting with no mics: ${err.message}`);
  }
}
function save() {
  try { savefile.writeJsonSync(FILE, settings); }
  catch (err) { log('error', 'mics', `Could not save mics.json: ${err.message}`); }
}

function find(ref) {
  const r = String(ref || '');
  if (/^\d+$/.test(r) && settings.mics[Number(r) - 1]) return settings.mics[Number(r) - 1]; // /deck/mic/1/...
  return settings.mics.find(m => m.id === r) || settings.mics.find(m => slug(m.name) === slug(r)) || null;
}

// ─── Dips ────────────────────────────────────────────────────────────────
const ease = x => x * x * (3 - 2 * x);
function along(e) {
  if (!e.ms || now() >= e.at + e.ms) return e.to;
  return e.from + (e.to - e.from) * ease(Math.max(0, (now() - e.at) / e.ms));
}
// Why the mics are down now, as words for the Output page and the log.
function reasons() {
  const r = [];
  if (hand) r.push('by hand');
  if (why.music && settings.dipMusic) r.push('music playing');
  if (why.video && settings.dipVideo) r.push('a video with sound');
  if (why.quiet && settings.dipQuiet) r.push('a quiet scene');
  return r;
}
function settle() {
  const want = reasons().length > 0;
  if (want === down) return false;
  down = want;
  const sec = want ? settings.dipDownSec : settings.dipUpSec;
  dip = { from: along(dip), to: want ? 1 : 0, at: now(), ms: Math.round(sec * 1000) };
  if (settings.mics.length) log('info', 'mics', want ? `Mics dip to ${settings.dipTo}% (${reasons().join(', ')})` : 'Mics back up');
  return true;
}

// scene.js, each time the scene changes: whether music is being heard and whether a video plays its sound.
// m is music.js's state().music.
function follow(m, videoOn) {
  why.music = !!m && m.status === 'playing' && !m.muted && m.gain.to > 0 && m.video !== 'pause';
  why.video = !!videoOn;
  return settle();
}
// A scene or sequence with "Quiet the music" ticked started (true), or one without it (false).
function quiet(on) {
  why.quiet = !!on;
  return settle();
}

// ─── Changes ─────────────────────────────────────────────────────────────
const onOff = (v, was) => v === 'toggle' ? !was : !!v && v !== 'off';
function apply(a) {
  switch (a.type) {
    case 'micAdd': {
      if (settings.mics.length >= MAX_MICS) return `Studio mixes up to ${MAX_MICS} mics.`;
      const m = cleanMic({ ...(a.changes || {}), id: undefined }, { id: newId() });
      settings.mics.push(m);
      save();
      log('info', 'mics', `Added the mic "${m.name}" (${m.device || 'the Mac\'s default input'}, ${m.channel})`);
      return null;
    }
    case 'micUpdate': {
      const m = find(a.mic);
      if (!m) return `No mic "${a.mic || ''}".`;
      const { id, ...changes } = a.changes || {};
      settings.mics[settings.mics.indexOf(m)] = cleanMic(changes, m);
      save();
      return null;
    }
    case 'micRemove': {
      const m = find(a.mic);
      if (!m) return `No mic "${a.mic || ''}".`;
      settings.mics.splice(settings.mics.indexOf(m), 1);
      save();
      log('info', 'mics', `Removed the mic "${m.name}"`);
      return null;
    }
    case 'micMute': {
      const m = find(a.mic);
      if (!m) return `No mic "${a.mic || ''}".`;
      m.muted = onOff(a.value, m.muted);
      save();
      log('info', 'mics', `${m.name} ${m.muted ? 'muted' : 'on'}`);
      return null;
    }
    case 'micLevel': {
      const m = find(a.mic);
      if (!m) return `No mic "${a.mic || ''}".`;
      m.level = Math.round(clamp(a.by !== undefined ? m.level + Number(a.by) : a.value, 0, 200, m.level));
      save();
      return null;
    }
    case 'micsMute':
      settings.muted = onOff(a.value, settings.muted);
      save();
      log('info', 'mics', settings.muted ? 'All mics muted' : 'Mics on');
      return null;
    case 'micsLevel':
      settings.level = Math.round(clamp(a.by !== undefined ? settings.level + Number(a.by) : a.value, 0, 100, settings.level));
      save();
      return null;
    case 'micsDip':
      hand = onOff(a.value, hand);
      settle();
      return null;
    case 'micsSettings': {
      const { mics, ...rest } = a.settings || {};
      settings = cleanSettings(rest);
      settle();
      save();
      return null;
    }
    default:
      return undefined;
  }
}

// /deck/mics/mute/on|off|toggle, /deck/mics/dip/on|off|toggle, /deck/mics/up, /deck/mics/down (?by=N, 10 by
// default), /deck/mics/level/<0-100>, and one mic by name or number: /deck/mic/<name>/mute/on|off|toggle,
// /deck/mic/<name>/up and /down.
function deck(parts, q = {}) {
  const [what, a1, a2, a3] = parts;
  const by = q.by !== undefined && q.by !== '' ? Math.abs(Number(q.by)) || 10 : 10;
  let action = null;
  if (what === 'mics' && a1) {
    if ((a1 === 'mute' || a1 === 'dip') && ['on', 'off', 'toggle'].includes(a2 || 'toggle') && !a3) action = { type: a1 === 'mute' ? 'micsMute' : 'micsDip', value: a2 || 'toggle' };
    else if ((a1 === 'up' || a1 === 'down') && !a2) action = { type: 'micsLevel', by: a1 === 'up' ? by : -by };
    else if (a1 === 'level' && /^\d+$/.test(a2 || '') && !a3) action = { type: 'micsLevel', value: Number(a2) };
  } else if (what === 'mic' && a1 && a2) {
    if (a2 === 'mute' && ['on', 'off', 'toggle'].includes(a3 || 'toggle')) action = { type: 'micMute', mic: decodeURIComponent(a1), value: a3 || 'toggle' };
    else if ((a2 === 'up' || a2 === 'down') && !a3) action = { type: 'micLevel', mic: decodeURIComponent(a1), by: a2 === 'up' ? by : -by };
  } else if (what !== 'mics' && what !== 'mic') return null;
  if (!action) return { status: 404, error: 'Use /deck/mics/mute, /deck/mics/dip (on, off or toggle), /deck/mics/up, /deck/mics/down, /deck/mics/level/<0-100>, or /deck/mic/<name>/mute, up or down.' };
  const error = apply(action);
  if (error) return { status: 404, error };
  const m = action.mic ? find(action.mic) : null;
  return { body: m ? { ok: true, mic: m.name, muted: m.muted, level: m.level } : { ok: true, muted: settings.muted, level: settings.level, dipped: down, why: reasons() } };
}

// ─── What the windows hear ───────────────────────────────────────────────
const cleanDevices = list => (Array.isArray(list) ? list : []).map(d => text(d, 200)).filter(Boolean).slice(0, 40);
// The output window mixing the mics: { devices: [name], levels: { micId: dBFS }, problems: { micId: words }, status }.
function report(r) {
  const was = seen.status;
  const levels = {}, problems = {};
  for (const m of settings.mics) {
    const v = Number(r?.levels?.[m.id]);
    if (Number.isFinite(v)) levels[m.id] = Math.max(-100, Math.min(0, Math.round(v)));
    if (r?.problems?.[m.id]) problems[m.id] = text(r.problems[m.id], 200);
  }
  seen = { at: now(), devices: cleanDevices(r?.devices), levels, problems, status: text(r?.status, 200) };
  if (seen.status !== was && seen.status) log('warn', 'mics', seen.status);
}
// The Output page in the Mac app listing the Mac's audio inputs.
function devicesListed(list) { listed = { at: now(), devices: cleanDevices(list) }; }
function live() {
  const fresh = now() - seen.at < REPORT_STALE_MS;
  const devices = [...new Set([...(fresh ? seen.devices : []), ...listed.devices])];
  return { mixing: fresh, devices, levels: fresh ? seen.levels : {}, problems: fresh ? seen.problems : {}, status: fresh ? seen.status : '' };
}

function state() {
  return { mics: { ...settings, dipped: down, why: reasons(), hand, dip } };
}

function init(logger) {
  log = logger || log;
  load();
}

module.exports = { init, apply, deck, state, follow, quiet, report, devicesListed, live, MAX_MICS };
