// FirstPass Studio - mics: live microphones (wireless effects mics on court, crowd mics) mixed into the stream's sound.
//
// A mic is one input of an audio device plugged into the Mac (a wireless receiver, a USB interface): the device by
// the name macOS gives it, and which of its channels (both, left or right, so two receivers on one stereo interface
// are two mics). Each mic goes to the outputs ticked for it (outputs, Output 1 unless set): a commentators' feed can
// take the effects mics and leave out the commentators' own. Studio keeps the settings; each output's own window
// (scene.html in the app's display, NDI or Blackmagic output) opens the devices of the mics going to it and mixes
// them into its sound, so the mics go out with that output's music and video sound. They're never played in a
// Scene View: a speaker in the room near a mic would feed back. With its outputs off, a mic is silent.
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
// Each of the first three is a tick box; the Dip by hand always works. A mic marked "Has an external mixer"
// (follow false) stays at its level whatever happens: the mixer does the fading. The dip goes down over dipDownSec
// and back up over dipUpSec: dip { from, to, at, ms } goes from 0 (up) to 1 (down at dipTo), as the music's duck does.
//
// Each window mixing mics reports what it hears every half second (report()): the devices it can see, each mic's
// level as it comes in, and any trouble (no permission, device not plugged in). The Output page shows them all
// together from live().
// The Output page opened in the Mac app can also list the Mac's devices itself, before any output is on.
//
// A mic can be plugged into the ATEM switcher instead (on: 'atem'): one of its mic or line inputs (input, as the
// switcher numbers them: 1301 for an ATEM Mini's Mic 1), both its channels or, when the input is split into two mono
// channels in ATEM Software Control, the left or the right one. The switcher mixes it; Studio moves its fader to the
// same level, mute and dips (fading them in steps), through switcher.js. Studio never fights the operator: a fader
// moved on the switcher or in ATEM Software Control becomes that mic's level, and on connecting Studio sends nothing,
// it takes the fader as it finds it. Everything else on the input (On, Off or AFV, EQ, dynamics) stays the
// switcher's. These mics are heard whatever Studio's outputs are doing, since the switcher carries them.
//
// Saved as mics.json in the data folder: one set of mics for the Mac (the devices are this Mac's), not per competition.

'use strict';

const fs = require('fs');
const datadir = require('./datadir');
const savefile = require('./savefile');

const FILE = datadir.file('mics.json');
const MAX_MICS = 8;
const CHANNELS = ['both', 'left', 'right'];
const ROUTES = ['mac', 'atem'];
// The switcher's fader: Studio's level as dB, from all the way down to +6 (200 % is about +6 dB).
const FLOOR_DB = -100, LOW_DB = -60, TOP_DB = 6;
const STEP_MS = 50;            // fades on the switcher's faders move in steps this often
const OWN_ECHO_MS = 1000;      // a fader reading this soon after Studio moved it is Studio's own move coming back
// A report older than this means that window isn't mixing the mics any more (its output is off, or the window stopped).
const REPORT_STALE_MS = 3000;

let log = () => {};
let settings = defaults();
let hand = false; // the Dip by hand
let why = { music: false, video: false, quiet: false };
let down = false;
let dip = { from: 0, to: 0, at: 0, ms: 0 };
const seen = new Map(); // output id -> { at, devices, levels, problems, status }: what that output's window last said
let listed = { at: 0, devices: [] }; // the devices the Output page in the Mac app listed
let changedHook = () => {};    // scene.js: publish the scene (a fader moved on the switcher changed a mic's level)
let sw = null;                 // switcher.js: { inputs(), set(input, source, dB) }
const sent = new Map();        // mic id -> { dB, at }: where Studio last put (or first found) its fader
let stepTimer = null;

function defaults() {
  return { level: 100, muted: false, dipTo: 30, dipMusic: true, dipVideo: true, dipQuiet: true, dipDownSec: 1, dipUpSec: 2, mics: [] };
}

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const outputIds = v => [...new Set((Array.isArray(v) ? v : []).map(x => String(x || '').replace(/[^a-z0-9]/gi, '').slice(0, 20)).filter(Boolean))].slice(0, 8);
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const flag = (v, d) => v === undefined ? d : !!v;

// ─── Saving ──────────────────────────────────────────────────────────────
function cleanMic(m, existing = {}) {
  const s = { ...existing, ...(m && typeof m === 'object' ? m : {}) };
  const out = {
    id: String(existing.id || s.id || newId()).replace(/[^a-z0-9]/gi, '').slice(0, 20) || newId(),
    name: '',
    on: ROUTES.includes(s.on) ? s.on : 'mac', // plugged into the Mac or the switcher
    device: text(s.device, 200), // the device's name as macOS gives it; '' is the Mac's default input
    input: Math.round(clamp(s.input, 0, 65535, 0)), // the switcher's audio input (on 'atem')
    channel: CHANNELS.includes(s.channel) ? s.channel : 'both',
    level: Math.round(clamp(s.level, 0, 200, 100)),
    muted: flag(s.muted, false),
    lowCut: flag(s.lowCut, true),
    follow: flag(s.follow, true), // follows the dips; false when an external mixer does the fading
    // The outputs it goes to (on 'mac'): Output 1 unless set. One a removed output had is left out by the windows.
    outputs: outputIds(s.outputs).length ? outputIds(s.outputs) : ['main'],
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
  if (settings.mics.length) log('info', 'mics', want ? `Mics duck to ${settings.dipTo}% (${reasons().join(', ')})` : 'Mics back up');
  drive();
  return true;
}
// How much of a mic is heard now, 0 to 2: its level, the master level, the mutes and the dip (as scene.html works it out).
function dipNow(m) {
  if (!m.follow) return 1;
  const d = along(dip), low = Math.max(settings.dipTo / 100, 0.01);
  return d >= 1 ? settings.dipTo / 100 : Math.pow(low, d);
}
const gainOf = m => settings.muted || m.muted ? 0 : (m.level / 100) * (settings.level / 100) * dipNow(m);

// ─── Mics on the switcher ────────────────────────────────────────────────
const toDb = g => g <= 0.001 ? FLOOR_DB : Math.round(Math.max(LOW_DB, Math.min(TOP_DB, 20 * Math.log10(g))) * 10) / 10;
const onSwitcher = () => settings.mics.filter(m => m.on === 'atem');
// The sources of the switcher's input a mic moves: both channels, or the left or right of an input split in two.
function sourcesOf(m, inputs) {
  const inp = inputs.find(i => i.id === m.input);
  if (!inp) return [];
  if (m.channel === 'left') return inp.sources.slice(0, 1);
  if (m.channel === 'right') return inp.sources.length > 1 ? inp.sources.slice(1, 2) : [];
  return inp.sources;
}
// Moves the faders of the mics on the switcher to where Studio has them, stepping while the dip fades.
function drive() {
  if (!sw) return;
  const inputs = sw.inputs();
  if (inputs.length) {
    for (const m of onSwitcher()) {
      const srcs = sourcesOf(m, inputs), last = sent.get(m.id);
      if (!srcs.length || !last) continue; // not found yet: switcherChanged() takes it as it is first
      const want = toDb(gainOf(m));
      if (Math.abs(want - last.dB) < 0.05) continue;
      sent.set(m.id, { dB: want, at: now() });
      for (const x of srcs) sw.set(m.input, x.id, want);
    }
  }
  const fading = dip.ms && now() < dip.at + dip.ms && onSwitcher().length;
  if (fading && !stepTimer) { stepTimer = setInterval(drive, STEP_MS); stepTimer.unref?.(); }
  if (!fading && stepTimer) { clearInterval(stepTimer); stepTimer = null; drive(); }
}
// The switcher's state changed (switcher.js): a mic's fader Studio hasn't seen yet is taken as it is, and one moved
// by hand on the switcher (not Studio's own move coming back) becomes that mic's level.
function switcherChanged() {
  if (!sw) return;
  const inputs = sw.inputs();
  if (!inputs.length) { sent.clear(); return; }
  let moved = false;
  for (const m of onSwitcher()) {
    const srcs = sourcesOf(m, inputs);
    if (!srcs.length) continue;
    const at = srcs[0].fader, last = sent.get(m.id);
    if (last && (Math.abs(at - last.dB) <= 0.5 || now() - last.at < OWN_ECHO_MS)) continue;
    sent.set(m.id, { dB: at, at: now() });
    if (!last && (settings.muted || m.muted)) continue; // muted here: left as it is until something changes
    const k = (settings.level / 100) * dipNow(m);
    const level = at <= LOW_DB ? 0 : Math.round(clamp(100 * Math.pow(10, at / 20) / Math.max(k, 0.01), 0, 200, m.level));
    if (level === m.level && !(last && m.muted)) continue;
    m.level = level;
    if (last) m.muted = false; // brought up by hand on the switcher: it's on
    moved = true;
    log('info', 'mics', `${m.name}'s fader ${last ? 'moved on the switcher' : 'is'} at ${at <= FLOOR_DB ? 'all the way down' : `${at} dB`}: its level is ${level}%`);
  }
  if (moved) { save(); changedHook(); }
}
// What the Output page shows about the mics on the switcher: each one's fader and any trouble.
function onSwitcherLive() {
  const inputs = sw ? sw.inputs() : [];
  const faders = {}, problems = {};
  for (const m of onSwitcher()) {
    const inp = inputs.find(i => i.id === m.input), srcs = sourcesOf(m, inputs);
    if (!inputs.length) problems[m.id] = 'The switcher isn\'t connected (or has no mic inputs)';
    else if (!inp) problems[m.id] = m.input ? `The switcher has no audio input ${m.input}` : 'Pick the switcher\'s input';
    else if (!srcs.length) problems[m.id] = `${inp.name} isn't split into two mono channels on the switcher: pick Both, or split it in ATEM Software Control`;
    else if (srcs.some(x => x.off)) problems[m.id] = `${inp.name} is Off on the switcher: turn it On in ATEM Software Control`;
    if (srcs.length) faders[m.id] = srcs[0].fader;
  }
  return { inputs: inputs.map(i => ({ id: i.id, name: i.name, split: i.sources.length > 1 })), connected: inputs.length > 0, faders, problems };
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
  const r = change(a);
  if (r === null) drive();
  return r;
}
function change(a) {
  switch (a.type) {
    case 'micAdd': {
      if (settings.mics.length >= MAX_MICS) return `Studio mixes up to ${MAX_MICS} mics.`;
      const m = cleanMic({ ...(a.changes || {}), id: undefined }, { id: newId() });
      settings.mics.push(m);
      save();
      log('info', 'mics', `Added the mic "${m.name}" (${m.on === 'atem' ? `the switcher's input ${m.input}` : m.device || 'the Mac\'s default input'}, ${m.channel})`);
      switcherChanged();
      return null;
    }
    case 'micUpdate': {
      const m = find(a.mic);
      if (!m) return `No mic "${a.mic || ''}".`;
      const { id, ...changes } = a.changes || {};
      const next = cleanMic(changes, m);
      // Moved to another input: its fader there is taken as it is first.
      if (next.on !== m.on || next.input !== m.input || next.channel !== m.channel) sent.delete(m.id);
      settings.mics[settings.mics.indexOf(m)] = next;
      save();
      switcherChanged();
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
    if ((a1 === 'mute' || a1 === 'duck' || a1 === 'dip') && ['on', 'off', 'toggle'].includes(a2 || 'toggle') && !a3) action = { type: a1 === 'mute' ? 'micsMute' : 'micsDip', value: a2 || 'toggle' };
    else if ((a1 === 'up' || a1 === 'down') && !a2) action = { type: 'micsLevel', by: a1 === 'up' ? by : -by };
    else if (a1 === 'level' && /^\d+$/.test(a2 || '') && !a3) action = { type: 'micsLevel', value: Number(a2) };
  } else if (what === 'mic' && a1 && a2) {
    if (a2 === 'mute' && ['on', 'off', 'toggle'].includes(a3 || 'toggle')) action = { type: 'micMute', mic: decodeURIComponent(a1), value: a3 || 'toggle' };
    else if ((a2 === 'up' || a2 === 'down') && !a3) action = { type: 'micLevel', mic: decodeURIComponent(a1), by: a2 === 'up' ? by : -by };
  } else if (what !== 'mics' && what !== 'mic') return null;
  if (!action) return { status: 404, error: 'Use /deck/mics/mute, /deck/mics/duck (on, off or toggle), /deck/mics/up, /deck/mics/down, /deck/mics/level/<0-100>, or /deck/mic/<name>/mute, up or down.' };
  const error = apply(action);
  if (error) return { status: 404, error };
  const m = action.mic ? find(action.mic) : null;
  return { body: m ? { ok: true, mic: m.name, muted: m.muted, level: m.level } : { ok: true, muted: settings.muted, level: settings.level, dipped: down, why: reasons() } };
}

// ─── What the windows hear ───────────────────────────────────────────────
const cleanDevices = list => (Array.isArray(list) ? list : []).map(d => text(d, 200)).filter(Boolean).slice(0, 40);
// An output window mixing mics: { output, devices: [name], levels: { micId: dBFS }, problems: { micId: words }, status }.
function report(r) {
  const out = outputIds([r?.output])[0] || 'main';
  const was = seen.get(out)?.status;
  const levels = {}, problems = {};
  for (const m of settings.mics) {
    const v = Number(r?.levels?.[m.id]);
    if (Number.isFinite(v)) levels[m.id] = Math.max(-100, Math.min(0, Math.round(v)));
    if (r?.problems?.[m.id]) problems[m.id] = text(r.problems[m.id], 200);
  }
  const s = { at: now(), devices: cleanDevices(r?.devices), levels, problems, status: text(r?.status, 200) };
  seen.set(out, s);
  if (s.status !== was && s.status) log('warn', 'mics', s.status);
}
// The Output page in the Mac app listing the Mac's audio inputs.
function devicesListed(list) { listed = { at: now(), devices: cleanDevices(list) }; }
function live() {
  // Every window still reporting, together: a mic heard on two outputs shows its louder reading.
  const fresh = [...seen.values()].filter(s => now() - s.at < REPORT_STALE_MS);
  const devices = [...new Set([...fresh.flatMap(s => s.devices), ...listed.devices])];
  const atem = onSwitcherLive();
  const mac = new Set(settings.mics.filter(m => m.on !== 'atem').map(m => m.id));
  const levels = {}, problems = {};
  for (const s of fresh) {
    for (const [id, v] of Object.entries(s.levels)) if (mac.has(id)) levels[id] = Math.max(levels[id] ?? -100, v);
    for (const [id, v] of Object.entries(s.problems)) if (mac.has(id)) problems[id] = v;
  }
  return { mixing: fresh.length > 0, devices, levels, problems: { ...problems, ...atem.problems }, status: fresh.map(s => s.status).find(Boolean) || '',
    switcher: { connected: atem.connected, inputs: atem.inputs }, faders: atem.faders };
}

function state() {
  return { mics: { ...settings, dipped: down, why: reasons(), hand, dip } };
}

// switcher: switcher.js's { inputs: micInputs, set: setMicFader }, from server.js.
function useSwitcher(api) { sw = api; switcherChanged(); }

// changed(): publish the scene (scene.js).
function init(logger, { changed } = {}) {
  log = logger || log;
  if (changed) changedHook = changed;
  sent.clear();
  seen.clear();
  load();
}

module.exports = { init, apply, deck, state, follow, quiet, report, devicesListed, live, useSwitcher, switcherChanged, MAX_MICS };
