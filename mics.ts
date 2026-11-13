// FirstPass Studio - mics: live microphones (wireless effects mics on court, crowd mics) mixed into the stream's sound.
//
// A mic is one input of an audio device plugged into the Mac (a wireless receiver, a USB interface): the device by
// the name macOS gives it, and which of its channels (both, left or right, so two receivers on one stereo interface
// are two mics). The mics are Output 1's, like the music: Studio keeps the settings, and Output 1's own window
// (scene.html in the app's display, NDI or Blackmagic output) opens their devices and mixes them into its sound, so
// they go out with Output 1's music and video sound. Output 1's other sound destinations (the Output page's "Sound goes
// to") each take the mics ticked for them. They're never played in a Scene View: a speaker in the room near a mic would
// feed back. With Output 1 off, the mics are silent.
//
// Each mic has a level (0-200 %, 100 as it comes in), a mute and a low cut (on by default: takes out rumble and wind
// below about 100 Hz). One master level and mute sit over all of them, and a limiter at the end stops a loud shout
// clipping the stream.
//
// Dips: like the music's duck, the mics come down to the Dip to level (and back up) while
//   - music is playing (the player's, a sequence's or the super shot song), if ticked (it starts unticked),
//   - a video with its sound on is showing (or a page playing a theme song),
//   - a scene or sequence with "Ducks the music" ticked is on (an interview on court),
//   - the Dip button or /deck/mics/dip is on, by hand.
// Each of the first three is a tick box; the Dip by hand always works. A mic marked "Never ducks (an external mixer does it)"
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
// same level, mute and dips (fading them in steps), through switcher.ts. Studio never fights the operator: a fader
// moved on the switcher or in ATEM Software Control becomes that mic's level, and on connecting Studio sends nothing,
// it takes the fader as it finds it. Everything else on the input (On, Off or AFV, EQ, dynamics) stays the
// switcher's. These mics are heard whatever Studio's outputs are doing, since the switcher carries them.
//
// A phone can be a mic too (on: 'phone'), as a backup commentator headset: the Commentator page on a paired phone sends
// whatever mic the phone has (a USB-C interface, a wired headset or Bluetooth) to Output 1's window over the network
// (phonemic.ts), which mixes it like a mic plugged into the Mac. Studio adds the mic the first time the phone starts,
// named after it (phone: the paired device's id). Its card says when the phone's connection drops.
//
// Saved as mics.json in the data folder: one set of mics for the Mac (the devices are this Mac's), not per competition.

import fs from 'node:fs';
import * as datadir from './datadir';
import * as savefile from './savefile';
import { errorCode, errorMessage } from './errors';
import { arr, isObj, obj } from './check';
import type { Act, Body, Log, Query } from './types';

type Channel = 'both' | 'left' | 'right';
type Route = 'mac' | 'atem' | 'phone';
export interface Mic { id: string; name: string; on: Route; device: string; input: number; phone: string; channel: Channel; level: number; muted: boolean; lowCut: boolean; follow: boolean }
interface Settings {
  v: number; level: number; muted: boolean; dipTo: number; dipMusic: boolean; dipVideo: boolean; dipQuiet: boolean; dipDownSec: number; dipUpSec: number; mics: Mic[];
}
// What a window mixing mics last said (report()).
interface Seen { at: number; devices: string[]; levels: Record<string, number>; problems: Record<string, string>; status: string }
// A switcher audio input as switcher.ts gives it, and the switcher's end (switcher.ts micInputs, setMicFader, micLevel).
interface SwitcherInput { id: number; name: string; sources: { id: number | string; fader: number; off?: boolean }[] }
interface Switcher { inputs(): SwitcherInput[]; set(input: number, source: number | string, dB: number): void; level?(input: number, source: number | string): number | undefined }
// The music as mics.ts follows it (music.ts state().music).
interface MusicNow { status: string; muted: boolean; gain: { to: number }; video: string | null }

const FILE = datadir.file('mics.json');
const MAX_MICS = 8;
const CHANNELS: readonly Channel[] = ['both', 'left', 'right'];
const ROUTES: readonly Route[] = ['mac', 'atem', 'phone'];
const isChannel = (v: unknown): v is Channel => (CHANNELS as readonly unknown[]).includes(v);
const isRoute = (v: unknown): v is Route => (ROUTES as readonly unknown[]).includes(v);
// The switcher's fader: Studio's level as dB, from all the way down to +6 (200 % is about +6 dB).
const FLOOR_DB = -100, LOW_DB = -60, TOP_DB = 6;
const STEP_MS = 50;            // fades on the switcher's faders move in steps this often
const OWN_ECHO_MS = 1000;      // a fader reading this soon after Studio moved it is Studio's own move coming back
// A report older than this means that window isn't mixing the mics any more (its output is off, or the window stopped).
const REPORT_STALE_MS = 3000;
// Silent: a mic that's heard nothing above SILENT_DB for SILENT_MS while it's being listened to (a flat battery, a
// receiver turned off, a pulled cable), for its card and the board. A muted mic is never silent.
const SILENT_DB = -55;
const SILENT_MS = 10000;
const heardAt = new Map<string, { since: number; loud: number; last: number }>(); // mic id -> { since: first reading of this run, loud: last reading above SILENT_DB, last: last reading }

let log: Log = () => {};
let settings = defaults();
let hand = false; // the Dip by hand
const why = { music: false, video: false, quiet: false };
let down = false;
let dip = { from: 0, to: 0, at: 0, ms: 0 };
const seen = new Map<string, Seen>(); // output id -> { at, devices, levels, problems, status }: what that output's window last said
let listed: { at: number; devices: string[] } = { at: 0, devices: [] }; // the devices the Output page in the Mac app listed
let changedHook = () => {};    // scene.ts: publish the scene (a fader moved on the switcher changed a mic's level)
let sw: Switcher | null = null;                 // switcher.ts: { inputs(), set(input, source, dB) }
const sent = new Map<string, { dB: number; at: number }>();        // mic id -> { dB, at }: where Studio last put (or first found) its fader
let stepTimer: NodeJS.Timeout | undefined;

function defaults(): Settings {
  return { v: 2, level: 100, muted: false, dipTo: 30, dipMusic: false, dipVideo: true, dipQuiet: true, dipDownSec: 1, dipUpSec: 2, mics: [] };
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const slug = (s: unknown) => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const outputId = (v: unknown) => String(v || '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'main';
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const flag = (v: unknown, d: boolean) => v === undefined ? d : !!v;

// ─── Saving ──────────────────────────────────────────────────────────────
// A mic as given (a save from the Output page, or mics.json), made safe.
function cleanMic(m: unknown, existing: Partial<Mic> = {}): Mic {
  const s: Body = { ...existing, ...obj(m) };
  const out: Mic = {
    id: String(existing.id || s.id || newId()).replace(/[^a-z0-9]/gi, '').slice(0, 20) || newId(),
    name: '',
    on: isRoute(s.on) ? s.on : 'mac', // plugged into the Mac or the switcher, or a phone
    device: text(s.device, 200), // the device's name as macOS gives it; '' is the Mac's default input
    input: Math.round(clamp(s.input, 0, 65535, 0)), // the switcher's audio input (on 'atem')
    phone: s.on === 'phone' ? text(s.phone, 40) : '', // the paired phone's device id (on 'phone')
    channel: s.on !== 'phone' && isChannel(s.channel) ? s.channel : 'both', // a phone sends one channel
    level: Math.round(clamp(s.level, 0, 200, 100)),
    muted: flag(s.muted, false),
    lowCut: flag(s.lowCut, true),
    follow: flag(s.follow, true), // follows the dips; false when an external mixer does the fading
    // An older mics.json's outputs (Goes to) is dropped: the mics are Output 1's.
  };
  const base = text(s.name, 40) || 'Mic';
  const taken = new Set(settings.mics.filter(x => x.id !== out.id).map(x => slug(x.name)));
  out.name = base;
  for (let i = 2; taken.has(slug(out.name)) || !slug(out.name); i++) out.name = `${base} ${i}`;
  return out;
}
function cleanSettings(v: unknown): Settings {
  const s: Body = { ...settings, ...obj(v) };
  return {
    level: Math.round(clamp(s.level, 0, 100, 100)),
    muted: flag(s.muted, false),
    dipTo: Math.round(clamp(s.dipTo, 0, 100, 30)),
    dipMusic: flag(s.dipMusic, false), // off unless ticked (Matt, 2026-11-01)
    dipVideo: flag(s.dipVideo, true),
    dipQuiet: flag(s.dipQuiet, true),
    dipDownSec: clamp(s.dipDownSec, 0, 10, 1),
    dipUpSec: clamp(s.dipUpSec, 0, 10, 2),
    v: 2,
    mics: settings.mics,
  };
}
function load() {
  settings = defaults();
  try {
    const saved = obj(JSON.parse(fs.readFileSync(FILE, 'utf8')));
    settings = cleanSettings(saved);
    // Ducking under music was on by default before v2; such a file is unticked once, then saved with v: 2.
    if (!(Number(saved.v) >= 2)) { settings.dipMusic = false; save(); }
    for (const m of arr(saved.mics).slice(0, MAX_MICS)) if (isObj(m)) settings.mics.push(cleanMic(m));
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') log('warn', 'mics', `Could not read mics.json, starting with no mics: ${errorMessage(err)}`);
  }
}
function save() {
  try { savefile.writeJsonSync(FILE, settings); }
  catch (err) { log('error', 'mics', `Could not save mics.json: ${errorMessage(err)}`); }
}

// The mic of a paired phone (its device id), or null.
const phoneMic = (id: string | null | undefined) => (id && settings.mics.find(m => m.on === 'phone' && m.phone === id)) || null;

function find(ref: unknown) {
  const r = String(ref || '');
  if (/^\d+$/.test(r) && settings.mics[Number(r) - 1]) return settings.mics[Number(r) - 1]; // /deck/mic/1/...
  return settings.mics.find(m => m.id === r) || settings.mics.find(m => slug(m.name) === slug(r)) || null;
}

// ─── Dips ────────────────────────────────────────────────────────────────
const ease = (x: number) => x * x * (3 - 2 * x);
function along(e: { from: number; to: number; at: number; ms: number }) {
  if (!e.ms || now() >= e.at + e.ms) return e.to;
  return e.from + (e.to - e.from) * ease(Math.max(0, (now() - e.at) / e.ms));
}
// Why the mics are down now, as words for the Output page and the log.
function reasons() {
  const r = [];
  if (hand) r.push('by hand');
  if (why.music && settings.dipMusic) r.push('music playing');
  if (why.video && settings.dipVideo) r.push('a video with sound');
  if (why.quiet && settings.dipQuiet) r.push('a scene or sequence');
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
function dipNow(m: Mic) {
  if (!m.follow) return 1;
  const d = along(dip), low = Math.max(settings.dipTo / 100, 0.01);
  return d >= 1 ? settings.dipTo / 100 : Math.pow(low, d);
}
const gainOf = (m: Mic) => settings.muted || m.muted ? 0 : (m.level / 100) * (settings.level / 100) * dipNow(m);

// ─── Mics on the switcher ────────────────────────────────────────────────
const toDb = (g: number) => g <= 0.001 ? FLOOR_DB : Math.round(Math.max(LOW_DB, Math.min(TOP_DB, 20 * Math.log10(g))) * 10) / 10;
const onSwitcher = () => settings.mics.filter(m => m.on === 'atem');
// The sources of the switcher's input a mic moves: both channels, or the left or right of an input split in two.
function sourcesOf(m: Mic, inputs: SwitcherInput[]) {
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
  if (!fading && stepTimer) { clearInterval(stepTimer); stepTimer = undefined; drive(); }
}
// The switcher's state changed (switcher.ts): a mic's fader Studio hasn't seen yet is taken as it is, and one moved
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
  const faders: Record<string, number> = {}, levels: Record<string, number> = {}, problems: Record<string, string> = {};
  for (const m of onSwitcher()) {
    const inp = inputs.find(i => i.id === m.input), srcs = sourcesOf(m, inputs);
    if (!inputs.length) problems[m.id] = 'The switcher isn\'t connected (or has no mic inputs)';
    else if (!inp) problems[m.id] = m.input ? `The switcher has no audio input ${m.input}` : 'Pick the switcher\'s input';
    else if (!srcs.length) problems[m.id] = `${inp.name} isn't split into two mono channels on the switcher: pick Both, or split it in ATEM Software Control`;
    else if (srcs.some(x => x.off)) problems[m.id] = `${inp.name} is Off on the switcher: turn it On in ATEM Software Control`;
    if (srcs.length) faders[m.id] = srcs[0].fader;
    // What comes into it (before its fader), when the switcher sends its levels: the louder of its sources.
    const heard = srcs.map(x => sw && sw.level ? sw.level(m.input, x.id) : undefined).filter((v): v is number => v !== undefined);
    if (heard.length) levels[m.id] = Math.round(Math.max(...heard));
  }
  return { inputs: inputs.map(i => ({ id: i.id, name: i.name, split: i.sources.length > 1 })), connected: inputs.length > 0, faders, levels, problems };
}

// scene.ts, each time the scene changes: whether music is being heard and whether a video plays its sound.
// m is music.ts's state().music.
function follow(m: MusicNow | null | undefined, videoOn: unknown) {
  why.music = !!m && m.status === 'playing' && !m.muted && m.gain.to > 0 && m.video !== 'pause';
  why.video = !!videoOn;
  return settle();
}
// A scene or sequence with "Ducks the music" ticked started (true), or one without it (false).
function quiet(on: unknown) {
  why.quiet = !!on;
  return settle();
}

// ─── Changes ─────────────────────────────────────────────────────────────
const onOff = (v: unknown, was: boolean) => v === 'toggle' ? !was : !!v && v !== 'off';
function apply(a: Act) {
  const r = change(a);
  if (r === null) drive();
  return r;
}
function change(a: Act): string | null | undefined {
  switch (a.type) {
    case 'micAdd': {
      if (settings.mics.length >= MAX_MICS) return `Studio mixes up to ${MAX_MICS} mics.`;
      const m = cleanMic({ ...obj(a.changes), id: undefined }, { id: newId() });
      settings.mics.push(m);
      save();
      log('info', 'mics', `Added the mic "${m.name}" (${m.on === 'atem' ? `the switcher's input ${m.input}` : m.on === 'phone' ? 'a phone on the Commentator page' : m.device || 'the Mac\'s default input'}, ${m.channel})`);
      switcherChanged();
      return null;
    }
    case 'micUpdate': {
      const m = find(a.mic);
      if (!m) return `No mic "${a.mic || ''}".`;
      const { id, ...changes } = obj(a.changes);
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
      const { mics, ...rest } = obj(a.settings);
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
function deck(parts: string[], q: Query = {}) {
  const [what, a1, a2, a3] = parts;
  const by = q.by !== undefined && q.by !== '' ? Math.abs(Number(q.by)) || 10 : 10;
  let action: Act | null = null;
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
const cleanDevices = (list: unknown) => arr(list).map(d => text(d, 200)).filter(Boolean).slice(0, 40);
// A window mixing mics (Output 1's, or a sound copy's): { output, devices: [name], levels: { micId: dBFS }, problems: { micId: words }, status }.
function report(given: unknown) {
  const r = obj(given), heard = obj(r.levels), trouble = obj(r.problems);
  const out = outputId(r.output);
  const was = seen.get(out)?.status;
  const levels: Record<string, number> = {}, problems: Record<string, string> = {};
  for (const m of settings.mics) {
    const v = Number(heard[m.id]);
    if (Number.isFinite(v)) levels[m.id] = Math.max(-100, Math.min(0, Math.round(v)));
    if (trouble[m.id]) problems[m.id] = text(trouble[m.id], 200);
  }
  for (const [id, db] of Object.entries(levels)) noteLevel(id, db);
  const s: Seen = { at: now(), devices: cleanDevices(r.devices), levels, problems, status: text(r.status, 200) };
  seen.set(out, s);
  if (s.status !== was && s.status) log('warn', 'mics', s.status);
}
// A reading of what comes into a mic (dBFS): when it was last loud enough to count as heard. Readings that stopped
// for a while start a new run, so a mic isn't called silent for the time nobody was listening.
function noteLevel(id: string, db: number, t = now()) {
  let h = heardAt.get(id);
  if (!h || t - h.last > REPORT_STALE_MS) h = { since: t, loud: 0, last: t };
  h.last = t;
  if (db > SILENT_DB) h.loud = t;
  heardAt.set(id, h);
}
// { micId: seconds } for each mic that's been silent SILENT_MS or more, while its readings keep coming.
function silences(t = now()) {
  const out: Record<string, number> = {};
  for (const m of settings.mics) {
    const h = heardAt.get(m.id);
    if (!h || t - h.last > REPORT_STALE_MS || m.muted || settings.muted) continue;
    const quiet = t - Math.max(h.loud, h.since);
    if (quiet >= SILENT_MS) out[m.id] = Math.floor(quiet / 1000);
  }
  return out;
}
// The Output page in the Mac app listing the Mac's audio inputs.
function devicesListed(list: unknown) { listed = { at: now(), devices: cleanDevices(list) }; }
function live() {
  // Every window still reporting, together: a mic heard in two windows shows its louder reading.
  const fresh = [...seen.values()].filter(s => now() - s.at < REPORT_STALE_MS);
  const devices = [...new Set([...fresh.flatMap(s => s.devices), ...listed.devices])];
  const atem = onSwitcherLive();
  const mac = new Set(settings.mics.filter(m => m.on !== 'atem').map(m => m.id));
  const levels: Record<string, number> = {}, problems: Record<string, string> = {};
  for (const s of fresh) {
    for (const [id, v] of Object.entries(s.levels)) if (mac.has(id)) levels[id] = Math.max(levels[id] ?? -100, v);
    for (const [id, v] of Object.entries(s.problems)) if (mac.has(id)) problems[id] = v;
  }
  // levels: what comes into each mic, the Mac's from Output 1's window, the switcher's from the switcher when it sends them.
  for (const [id, db] of Object.entries(atem.levels)) noteLevel(id, db);
  return { mixing: fresh.length > 0, devices, levels: { ...levels, ...atem.levels }, silent: silences(), problems: { ...problems, ...atem.problems }, status: fresh.map(s => s.status).find(Boolean) || '',
    switcher: { connected: atem.connected, inputs: atem.inputs }, faders: atem.faders };
}

function state() {
  return { mics: { ...settings, dipped: down, why: reasons(), hand, dip } };
}

// switcher: switcher.ts's { inputs: micInputs, set: setMicFader }, from server.ts.
function useSwitcher(api: Switcher) { sw = api; switcherChanged(); }

// changed(): publish the scene (scene.ts).
function init(logger: Log | null | undefined, { changed }: { changed?: () => void } = {}) {
  log = logger || log;
  if (changed) changedHook = changed;
  sent.clear();
  seen.clear();
  load();
}

export type { Switcher as MicSwitcher, SwitcherInput as MicInput };
export { init,
 apply, phoneMic, deck, state, follow, quiet, report, devicesListed, live, useSwitcher, switcherChanged, MAX_MICS };
