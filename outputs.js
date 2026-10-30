// FirstPass Studio - sending the scene to the Mac's own displays or a Blackmagic device (optional).
//
// Up to four outputs at once, each with its own graphics. Output 1 (id "main") is the primary output: it
// always exists, it's the one scenes, sequences and old Stream Deck links act on, and it carries all the
// sound. Outputs 2 to 4 are added on the Output page; each shows the sources turned on for it
// (scene.js keeps an on and off per output) and is always silent. Each output picks one way out:
//   chroma   - the scene over a solid colour on one extra display (a single HDMI into a switcher
//              that keys on that colour);
//   fill+key - the scene over black on one display (fill) and its transparency as white on black
//              on another (key), for a switcher's fill and key inputs;
//   decklink - out of a Blackmagic UltraStudio or DeckLink, as fill and key over SDI (its external
//              keyer) or fill only;
//   ndi      - as NDI® sources on the network: fill and key (two sources), chroma, or one source with
//              transparency. Needs NDI's runtime on the Mac.
// The Mac app does the sending (desktop/outputs.js, desktop/decklink.js, desktop/ndi.js): it tells the
// helper which displays and Blackmagic devices it has and whether NDI is there, and the helper tells it
// what to show, over the utility process's message port. Run without the app (npm start) there are none, and the Output page says so.
//
// Each output also says how it comes into the ATEM switcher (keyer, swFill, swKey: the key and the switcher inputs it's
// plugged into; swCameras: the cameras its graphics go with), for switcher.js's key settings check and its cuts;
// switcherPlan() gives it that, with the signal it sends.
//
// An output's way out can't be one another output already uses: the same display, the Blackmagic device
// (one output at a time) or the same NDI source name. The earlier output keeps it and the later one shows
// nothing until it's changed, and the Output page says why. An output's NDI sources are named after the
// output (and follow it when it's renamed) unless "Use my own name" is ticked (ndiOwnName) with a name typed.
//
// Picture (quality): HD, or 4K for every output at once. In 4K each NDI and Blackmagic output keeps the format
// saved for it (1080p50, say) and sends the 2160p one at the same rate instead: the scene keeps its 1920 x 1080
// layout and is drawn at twice the density (density 2 in its windows), so nothing set up for 1080p changes, and
// HD again is exactly as before. A Blackmagic device without that 2160p format, or a 720p NDI format, stays as
// it is and says so. Displays are left alone: a 4K screen set to look like 1920 x 1080 already draws at 2x.
// In 4K a Blackmagic output can also have one of the device's own 2160p formats picked, which it sends as it is;
// in HD those aren't offered, and one picked earlier goes out as the 1080p format at the same rate.
//
// Saved as outputs.json in the data folder: { outputs: [...], quality }, the primary first (an older file with one
// output's settings becomes Output 1). Stream Deck: /deck/output/on|off|toggle (the primary),
// /deck/output/<name or number>/on|off|toggle and /deck/output/all/on|off|toggle.

'use strict';

const fs = require('fs');
const datadir = require('./datadir');
const savefile = require('./savefile');

const FILE = datadir.file('outputs.json');
// 'off' is Web links only on the Output page: nothing sent from this Mac (the scene's web links work whatever the mode).
const MODES = ['off', 'chroma', 'fillkey', 'decklink', 'ndi'];
const KEYING = ['external', 'off'];
// Where a Blackmagic output's sound goes: embedded in the SDI (with fill and key, the fill), the Mac's sound output, or both.
const DECKLINK_SOUND = ['sdi', 'mac', 'both'];
// Which of the switcher's keys an output comes into ('' for the usual one: Output 1 on downstream key 1, the others
// on upstream keys 2 to 4, and a chroma output on an upstream key, as only those key on a colour), or none.
const KEYERS = ['', 'none', 'dsk1', 'dsk2', 'usk1', 'usk2', 'usk3', 'usk4'];
const DEFAULT_CHROMA = '#00b140';
const NDI_SIGNALS = ['fillkey', 'chroma', 'alpha'];
// The video formats NDI can send at (receivers take any; pick what the switcher runs at): 1080p at the
// same rates a Blackmagic device can name, and 720p.
const NDI_FORMATS = [
  ...[['23.98', 24000, 1001], ['24', 24, 1], ['25', 25, 1], ['29.97', 30000, 1001], ['30', 30, 1], ['47.95', 48000, 1001], ['48', 48, 1],
    ['50', 50, 1], ['59.94', 60000, 1001], ['60', 60, 1], ['95.9', 96000, 1001], ['96', 96, 1], ['100', 100, 1], ['119.88', 120000, 1001], ['120', 120, 1]]
    .map(([rate, n, d]) => [`1080p${rate}`, 1920, 1080, n, d]),
  ['720p25', 1280, 720, 25, 1], ['720p29.97', 1280, 720, 30000, 1001], ['720p30', 1280, 720, 30, 1],
  ['720p50', 1280, 720, 50, 1], ['720p59.94', 1280, 720, 60000, 1001], ['720p60', 1280, 720, 60, 1],
].map(([id, width, height, rateN, rateD]) => ({ id, width, height, rateN, rateD }));
const DEFAULT_NDI_FORMAT = '1080p50';

// Picture: hd (as before) or uhd (4K, 2160p).
const QUALITY = ['hd', 'uhd'];

const MAX = 4;
const PRIMARY = 'main';
// Each output's colour, by its number (slot): the same colours light its Stream Deck keys.
const COLOURS = { 1: '#ea9a38', 2: '#f24f91', 3: '#4ec1e6', 4: '#95ba45' };
const DEFAULTS = {
  mode: 'off', on: true, chromaDisplay: '', chromaColor: DEFAULT_CHROMA, chromaSafe: true, fillDisplay: '', keyDisplay: '',
  decklinkDevice: '', decklinkMode: 0, decklinkKeying: 'external', decklinkStraight: false, decklinkSound: 'sdi',
  ndiSignal: 'fillkey', ndiOwnName: false, ndiName: '', ndiFormat: DEFAULT_NDI_FORMAT, sponsors: false,
  keyer: '', swFill: 0, swKey: 0, swCameras: [],
};

let log = () => {};
let list = [{ id: PRIMARY, slot: 1, name: 'Output 1', ...DEFAULTS }];
let quality = 'hd';
const primary = () => list[0];
// Called with an output's id when it's removed, so the scene forgets what was on for it.
let onRemove = () => {};
// Called after any change to the outputs' settings (the switcher's key settings check follows them).
let onChange = () => {};
// The pictures and videos that look soft in 4K (picturesize.js soft()), for the Output page while 4K is on.
let softPictures = () => [];
// The Mac app's displays: [{ id, label, width, height, scale, primary }]; null when not run by the app.
// width x height is the size macOS draws at; scale 2 means it draws each point as 2 x 2 pixels (HiDPI).
let displays = null;
// The Mac app's Blackmagic devices: { ok, version, devices: [{ id, name, externalKeying, modes }] } or
// { ok: false, error }, and how its output is doing: { running, error, name, late, dropped }.
let decklink = null;
let decklinkStatus = { running: false };
let decklinkOutput = ''; // the output whose picture the Blackmagic device is sending
// Whether the Mac app can send NDI: { ok, version } or { ok: false, error, url }, and how it's doing:
// { running, format, sources: [{ kind, name, connections }], late, error }.
let ndi = null;
const ndiStatus = new Map(); // output id -> its NDI sources' status
// How hard each output is working, from the app (desktop/perf.js) every few seconds while one is showing:
// { at, outputs: { id: { cpu, memMB, fps, target } }, total: { cpu, memMB, gpu } }; and the samples
// since the last minute's log line.
let perf = null;
let perfSamples = [];
let perfLoggedAt = 0;
const PERF_STALE_MS = 15000;
const PERF_LOG_MS = 60000;
const port = process.parentPort || null;
// The Output page (or Scene View window) whose Scene View plays the sound: { id, until }. Only while no
// video output is on (an output on carries the sound itself, so the Scene View is silent and the same sound
// never plays twice), and only one at a time. It checks in every few seconds; if it stops (the page closed
// without saying so) it lets go.
let listener = null;
const LISTEN_MS = 70000; // a hidden page's timers can slow to once a minute

const hex = c => /^#?[0-9a-f]{6}$/i.test(String(c || '')) ? `#${String(c).replace('#', '').toLowerCase()}` : DEFAULT_CHROMA;

function clean(s, old = DEFAULTS) {
  const pick = (k, d) => (s[k] === undefined ? old[k] : s[k]) ?? d;
  return {
    id: String(old.id || s.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || PRIMARY,
    slot: Math.min(MAX, Math.max(1, Math.round(Number(pick('slot', 1))) || 1)),
    // The name shown on the Output page and used in its Stream Deck links (/deck/output/big-screen/on).
    name: String(pick('name', '')).replace(/\s+/g, ' ').trim().slice(0, 40),
    mode: MODES.includes(pick('mode')) ? pick('mode') : 'off',
    // Switched on (Output on). An output set to Web links only is always off: there's nothing to turn on until it's set up.
    on: MODES.includes(pick('mode')) && pick('mode') !== 'off' && pick('on', true) !== false,
    chromaDisplay: String(pick('chromaDisplay', '')),
    chromaColor: hex(pick('chromaColor')),
    // Chroma key safe graphics (public/chroma.js): solid panels, no soft shadows, nothing half see-through.
    // On unless turned off; it only changes how the chroma outputs draw, never any source's own settings.
    chromaSafe: pick('chromaSafe', true) !== false,
    fillDisplay: String(pick('fillDisplay', '')),
    keyDisplay: String(pick('keyDisplay', '')),
    decklinkDevice: String(pick('decklinkDevice', '')),
    decklinkMode: Number(pick('decklinkMode', 0)) || 0,
    decklinkKeying: KEYING.includes(pick('decklinkKeying')) ? pick('decklinkKeying') : 'external',
    decklinkStraight: pick('decklinkStraight', false) === true,
    decklinkSound: DECKLINK_SOUND.includes(pick('decklinkSound')) ? pick('decklinkSound') : 'sdi',
    ndiSignal: NDI_SIGNALS.includes(pick('ndiSignal')) ? pick('ndiSignal') : 'fillkey',
    // The NDI sources take the output's name unless ndiOwnName is ticked: then ndiName, the name typed (see ndiSource).
    ndiOwnName: pick('ndiOwnName', false) === true,
    ndiName: ndiClean(pick('ndiName', '')),
    ndiFormat: NDI_FORMATS.some(f => f.id === pick('ndiFormat')) ? pick('ndiFormat') : DEFAULT_NDI_FORMAT,
    // What's on it counts in the sponsors' exposure report (Output 1's always does). Off unless ticked, as Studio
    // can't tell whether another output is on the stream.
    sponsors: pick('sponsors', false) === true,
    // Into the switcher as: the key it comes into and the switcher inputs its fill and key are plugged into (0: not
    // picked). Only read by the key settings check (switcher.js); nothing is sent to the switcher until asked.
    keyer: KEYERS.includes(pick('keyer')) ? pick('keyer') : '',
    swFill: swInput(pick('swFill', 0)),
    swKey: swInput(pick('swKey', 0)),
    // The cameras this output's graphics go with (switcher inputs), for an output on an upstream key: Studio's cuts
    // take its key on with them and off with any other camera (switcher.js). None: Studio leaves its key alone.
    swCameras: [...new Set((Array.isArray(pick('swCameras')) ? pick('swCameras') : []).map(swInput).filter(Boolean))].sort((a, b) => a - b).slice(0, 20),
  };
}
// NDI shows sources as "MAC NAME (this name)", so brackets in it would confuse things.
const ndiClean = t => String(t || '').replace(/[()\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
// The name an output's NDI sources go by: its own name typed when that's ticked, else the output's name.
const ndiSource = o => (o.ndiOwnName && o.ndiName) || ndiClean(o.name) || `Output ${o.slot}`;
const swInput = v => { const n = Math.round(Number(v)); return n >= 1 && n <= 40 ? n : 0; };

const slug = t => String(t || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// Words a name can't take in a link, as /deck/output/<name>/... would mean something else.
const RESERVED = new Set(['on', 'off', 'toggle', 'all', 'main', 'layer', 'layers']);
// Every output's name set and different from the others' (and from Stream Deck words), so its links work.
function tidy() {
  list[0] = { ...list[0], id: PRIMARY, slot: 1 };
  const slots = new Set();
  for (const o of list) {
    if (slots.has(o.slot)) o.slot = [1, 2, 3, 4].find(n => !slots.has(n));
    slots.add(o.slot);
  }
  const taken = new Set();
  for (const o of list) {
    let name = o.name || `Output ${o.slot}`;
    if (RESERVED.has(slug(name)) || /^\d+$/.test(slug(name)) || !slug(name)) name = `Output ${o.slot}`;
    for (let i = 2; taken.has(slug(name)); i++) name = `${o.name || `Output ${o.slot}`} ${i}`;
    taken.add(slug(name));
    o.name = name;
  }
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // An older outputs.json is one output's settings: it becomes Output 1.
    const items = Array.isArray(saved.outputs) ? saved.outputs : [{ ...saved, id: PRIMARY, slot: 1 }];
    const seen = new Set();
    list = [];
    for (const item of items.slice(0, MAX)) {
      if (!item || typeof item !== 'object') continue;
      // Saved before NDI sources followed the output's name: the source name saved then is dropped, so they follow it now.
      const o = clean(item.ndiOwnName === undefined ? { ...item, ndiName: '' } : item, { ...DEFAULTS, id: list.length ? item.id : PRIMARY });
      if (seen.has(o.id) || (list.length && o.id === PRIMARY)) continue;
      seen.add(o.id);
      list.push(o);
    }
    if (!list.length || list[0].id !== PRIMARY) list.unshift(clean({ name: 'Output 1' }, { ...DEFAULTS, id: PRIMARY }));
    tidy();
    quality = QUALITY.includes(saved.quality) ? saved.quality : 'hd';
  } catch (err) { if (err.code !== 'ENOENT') log('warn', 'outputs', `Could not read outputs.json: ${err.message}`); }
}

function save() {
  try { savefile.writeJsonSync(FILE, { outputs: list, quality }); }
  catch (err) { log('error', 'outputs', `Could not save outputs.json: ${err.message}`); }
  send();
}

// Whether the Scene View may play the sound: only with the primary output not showing (the other outputs
// are always silent, so they don't count).
const sceneViewSound = () => !outputWindows().some(w => w.output === PRIMARY);
const listening = () => !!(sceneViewSound() && listener && listener.until > Date.now());

// What each output should show now, every output's in one list, each tagged with its output id (output)
// and whether it's silent (muted: every output but the primary):
// [{ display, kind: 'fill' | 'key' | 'chroma', color, safe }] on the Mac's displays,
// [{ kind: 'decklink', device, mode, keying, straight, sound, density }] for the Blackmagic device, or
// [{ kind: 'ndi', signal, name, format, color, safe, density }] for NDI. safe: the scene drawn chroma key safe;
// density: 2 when it's sent at 2160p (4K), the 1920 x 1080 scene drawn at twice the density.
const windows = () => outputWindows();

// The Blackmagic format to send: the one picked if it's 1080p (even one the device says it can't send: it
// may be wrong, and if not the output says so), else (nothing picked yet, or an interlaced or 720p format
// saved before they were taken off the Output page, as they look soft) the one the Output page starts with:
// 1080p50 if the device can key it, else the first 1080p format that can, else the first it can send.
// A 2160p format picked in 4K is sent as it is in 4K (uhdPicked), and in HD as the 1080p one at its rate.
function decklinkMode(device, o) {
  const modes = device.modes.filter(m => m.height === 1080 && !m.interlaced);
  const sends = modes.filter(m => m.supported);
  const picked = uhdPicked(device, o);
  return modes.find(m => m.mode === o.decklinkMode)
    || (picked && modes.find(m => rateOf(m.name) === rateOf(picked.name)))
    || ['1080p50', '1080p25'].map(n => sends.find(m => m.keying && String(m.name).replace(/\s/g, '').includes(n))).find(Boolean)
    || sends.find(m => m.keying) || sends[0] || modes[0];
}
// The device's 2160p progressive format picked for this output, or null.
const uhdPicked = (device, o) => device.modes.find(m => m.mode === o.decklinkMode && m.height === 2160 && !m.interlaced) || null;
// What a Blackmagic output sends: { mode, uhd } (uhd: 2160p, drawn at twice the density).
function decklinkSends(device, o) {
  if (quality === 'uhd') {
    const picked = uhdPicked(device, o);
    if (picked) return { mode: picked, uhd: true };
  }
  const hd = decklinkMode(device, o);
  const uhd = hd && quality === 'uhd' ? uhdDecklink(device, hd) : null;
  return { mode: uhd || hd, uhd: !!uhd };
}

// The 2160p format to send in 4K for a 1080p one, at the same rate: for NDI, the 1080p format at twice the size
// (2160p50 for 1080p50); for a Blackmagic device, its own 2160p progressive format with the same rate in its name,
// if it has one. null when there isn't one (720p, or a device that only does HD).
const rateOf = name => (String(name).replace(/\s/g, '').match(/^(?:1080|2160)p(.+)$/) || [])[1] || '';
function uhdNdi(format) {
  if (!format || format.height !== 1080) return null;
  return { ...format, id: format.id.replace(/^1080p/, '2160p'), width: 3840, height: 2160 };
}
function uhdDecklink(device, mode) {
  const rate = rateOf(mode.name);
  return (rate && device.modes.find(m => m.height === 2160 && !m.interlaced && rateOf(m.name) === rate)) || null;
}

// One output's windows, as if it were the only one.
function windowsOf(o) {
  if (!o.on) return [];
  if (o.mode === 'decklink') {
    const device = decklink?.devices?.find(d => d.id === o.decklinkDevice);
    const sends = device && decklinkSends(device, o);
    if (!sends || !sends.mode) return [];
    return [{ kind: 'decklink', device: device.id, mode: sends.mode.mode, keying: o.decklinkKeying, straight: o.decklinkStraight, sound: o.decklinkSound, density: sends.uhd ? 2 : 1 }];
  }
  if (o.mode === 'ndi') {
    if (!ndi?.ok) return [];
    const hd = NDI_FORMATS.find(f => f.id === o.ndiFormat);
    const uhd = quality === 'uhd' ? uhdNdi(hd) : null;
    return [{ kind: 'ndi', signal: o.ndiSignal, name: ndiSource(o), format: uhd || hd, color: o.chromaColor, safe: chromaSafe(o), density: uhd ? 2 : 1 }];
  }
  if (!displays) return [];
  const have = id => displays.some(d => d.id === id);
  if (o.mode === 'chroma' && have(o.chromaDisplay)) return [{ display: o.chromaDisplay, kind: 'chroma', color: o.chromaColor, safe: chromaSafe(o) }];
  if (o.mode === 'fillkey') {
    const out = [];
    if (have(o.fillDisplay)) out.push({ display: o.fillDisplay, kind: 'fill' });
    if (have(o.keyDisplay) && o.keyDisplay !== o.fillDisplay) out.push({ display: o.keyDisplay, kind: 'key' });
    return out;
  }
  return [];
}

// What an output would use, to find two outputs wanting the same thing: displays, the Blackmagic device,
// NDI source names. (Set up, whether or not it's on: the Output page warns before it's turned on.)
function uses(o) {
  if (o.mode === 'chroma') return [`display:${o.chromaDisplay}`];
  if (o.mode === 'fillkey') return [`display:${o.fillDisplay}`, `display:${o.keyDisplay}`];
  if (o.mode === 'decklink') return ['decklink'];
  if (o.mode === 'ndi') return [`ndi:${slug(ndiSource(o))}`];
  return [];
}
// For each output, the earlier output already using what it needs (or null): that one keeps it.
function clashes() {
  const owner = new Map();
  const out = new Map();
  for (const o of list) {
    const mine = uses(o).filter(u => !u.endsWith(':'));
    const taken = mine.map(u => owner.get(u)).find(Boolean) || null;
    out.set(o.id, taken);
    if (!taken) for (const u of mine) owner.set(u, o);
  }
  return out;
}

function outputWindows() {
  const clash = clashes();
  return list.flatMap(o => clash.get(o.id) ? [] : windowsOf(o).map(w => ({ ...w, output: o.id, ...(o.id === PRIMARY ? {} : { muted: true }) })));
}

// Whether an output's scene goes out chroma key safe: ticked, and it's keyed on a colour.
const chromaSafe = o => o.chromaSafe && (o.mode === 'chroma' || (o.mode === 'ndi' && o.ndiSignal === 'chroma'));

// The competition's colours that sit close to the key colour, so a keyer would cut holes in them:
// a strong colour (not too grey or dark) within 55 degrees of its hue. colours: [{ name, hex }].
let competitionColours = () => [];
const hsv = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const hue = !d ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (hue + 360) % 360, s: max ? d / max : 0, v: max };
};
function nearKey(colours, key) {
  const k = hsv(key);
  const seen = new Set();
  return colours.filter(c => {
    if (!/^#[0-9a-f]{6}$/i.test(c.hex || '') || seen.has(c.name)) return false;
    const x = hsv(c.hex.toLowerCase());
    const apart = Math.min(Math.abs(x.h - k.h), 360 - Math.abs(x.h - k.h));
    if (x.s < 0.35 || x.v < 0.25 || apart > 55) return false;
    seen.add(c.name);
    return true;
  });
}


// Tells the Mac app which windows to open.
function send() {
  if (port) port.postMessage({ type: 'outputs', windows: windows() });
}

// What an output sends at in 4K, for its card and status: { uhd, format, why }. uhd: it goes out at 2160p;
// otherwise why says what it stays at and why (nothing while the picture is HD).
function pictureOf(o) {
  if (quality !== 'uhd') return { uhd: false, format: '', why: '' };
  if (o.mode === 'ndi') {
    const hd = NDI_FORMATS.find(f => f.id === o.ndiFormat);
    const uhd = uhdNdi(hd);
    return uhd ? { uhd: true, format: uhd.id, why: '' } : { uhd: false, format: hd.id, why: `${hd.id} has no 4K version, so it stays ${hd.id}` };
  }
  if (o.mode === 'decklink') {
    const device = decklink?.devices?.find(d => d.id === o.decklinkDevice);
    const sends = device && decklinkSends(device, o);
    if (!sends || !sends.mode) return { uhd: false, format: '', why: '' };
    const m = sends.mode;
    return sends.uhd ? { uhd: true, format: m.name, why: m.supported === false ? `${device.name} says it can't send ${m.name}` : '' }
      : { uhd: false, format: m.name, why: `${device.name} has no 4K version of ${m.name}, so it stays ${m.name}` };
  }
  if (o.mode === 'chroma' || o.mode === 'fillkey') return { uhd: false, format: '', why: 'a display draws at its own size (a 4K screen set to look like 1920 × 1080 is already 4K)' };
  return { uhd: false, format: '', why: '' };
}

// One output as the Output page shows it: its settings, colour, what it's sending and how that's going.
function outputState(o, clash, showing) {
  const mine = showing.filter(w => w.output === o.id);
  return {
    ...o, colour: COLOURS[o.slot], primary: o.id === PRIMARY, link: slug(o.name), ndiSource: ndiSource(o),
    chromaSafeNow: chromaSafe(o), showing: mine,
    // Into the switcher as: the key it comes into now (the usual one when not picked), and what it sends.
    keyerNow: keyerOf(o), signal: signalOf(o),
    clash: clash.get(o.id) ? clash.get(o.id).name : '',
    decklinkStatus: decklinkOutput === o.id ? decklinkStatus : { running: false },
    ndiStatus: ndiStatus.get(o.id) || { running: false },
    perf: perfNow()?.outputs[o.id] || null,
    picture: pictureOf(o),
    // Colours in the graphics a chroma key on chromaColor would cut into.
    nearKey: nearKey(competitionColours(), o.chromaColor),
  };
}

function state() {
  const clash = clashes(), showing = windows();
  const outputs = list.map(o => outputState(o, clash, showing));
  return {
    // The primary output's settings at the top, as before there could be more than one.
    ...outputs[0], outputs, quality, soft: quality === 'uhd' ? softPictures() : [], max: MAX, app: !!displays, displays: displays || [], decklink: decklink || { ok: false, error: '' },
    ndi: ndi || { ok: false, error: '' }, ndiFormats: NDI_FORMATS, showing,
    // previewSound: the primary output isn't on, so the Scene View plays the sound (listening: one does now).
    previewSound: sceneViewSound(), listening: listening(),
    perfTotal: perfNow()?.total || null,
  };
}

const find = ref => {
  const r = String(ref ?? '');
  return list.find(o => o.id === r) || list.find(o => String(o.slot) === r) || list.find(o => slug(o.name) === slug(r)) || null;
};

// Changes from the Output page: { output, ...settings } changes that output (the primary without one);
// { add: true } adds an output (off, with every source off, so nothing shows until something's turned
// on), { remove: id } removes one, { quality: 'hd' | 'uhd' } sets the picture for every output. Returns an error or null.
function change(changes = {}) {
  if (changes.quality !== undefined) {
    if (!QUALITY.includes(changes.quality)) return 'The picture is hd or uhd (4K).';
    quality = changes.quality;
    return null;
  }
  if (changes.add) {
    if (list.length >= MAX) return `Studio can send to ${MAX} outputs at most.`;
    const slot = [1, 2, 3, 4].find(n => !list.some(o => o.slot === n));
    const id = Math.random().toString(36).slice(2, 10);
    // Its NDI sources take its name, which no other output has, so they never take Output 1's.
    list.push(clean({ name: changes.name || `Output ${slot}`, slot, on: false }, { ...DEFAULTS, id }));
    tidy();
    log('info', 'outputs', `Added ${list.at(-1).name}`);
    return null;
  }
  if (changes.remove !== undefined) {
    const o = find(changes.remove);
    if (!o) return `No output "${changes.remove}".`;
    if (o.id === PRIMARY) return 'Output 1 is the primary output and can\'t be removed.';
    list.splice(list.indexOf(o), 1);
    log('info', 'outputs', `Removed ${o.name}`);
    onRemove(o.id);
    return null;
  }
  const o = changes.output === undefined ? primary() : find(changes.output);
  if (!o) return `No output "${changes.output}".`;
  const { output, id, slot, ...rest } = changes;
  // A source name sent on its own (a Stream Deck or an older page) is a name of the output's own; an empty one goes back to the output's.
  if (rest.ndiName !== undefined && rest.ndiOwnName === undefined) rest.ndiOwnName = !!ndiClean(rest.ndiName);
  list[list.indexOf(o)] = clean(rest, o);
  tidy();
  return null;
}

function apply(changes) {
  const before = new Map(list.map(o => [o.id, JSON.stringify(o)]));
  const wasQuality = quality;
  const error = change(changes || {});
  if (quality !== wasQuality) log('info', 'outputs', `Picture ${quality === 'uhd' ? '4K (2160p)' : 'HD'}`);
  if (quality !== wasQuality || list.length !== before.size || list.some(o => before.get(o.id) !== JSON.stringify(o))) {
    listenChanged();
    const w = windows();
    // Log each output that changed.
    for (const o of list) {
      if (before.get(o.id) === JSON.stringify(o)) continue;
      const mine = w.filter(x => x.output === o.id);
      log('info', 'outputs', `${o.name} ${o.on ? o.mode : 'off'}${mine.length ? `: ${mine.map(describe).join(', ')}` : ''}`);
    }
    save();
    try { onChange(); } catch (err) { log('warn', 'outputs', `After a change: ${err.message}`); }
  }
  return error;
}

const describe = x => (x.safe ? 'chroma key safe ' : '') + describe1(x);
const describe1 = x => x.kind === 'decklink' ? `${deviceName(x.device)} (${modeName(x.device, x.mode)}, ${x.keying === 'external' ? 'fill and key' : 'fill only'})`
  : x.kind === 'ndi' ? `NDI "${x.name}" (${x.format.id}, ${{ fillkey: 'fill and key', chroma: `chroma ${x.color}`, alpha: 'with transparency' }[x.signal]})`
  : `${x.kind} on ${label(x.display)}`;
const label = id => (displays || []).find(d => d.id === id)?.label || `display ${id}`;
const deviceName = id => decklink?.devices?.find(d => d.id === id)?.name || 'Blackmagic device';
const modeName = (id, mode) => decklink?.devices?.find(d => d.id === id)?.modes.find(m => m.mode === mode)?.name || 'video format';

// The sound moving to or from a Scene View (logged; the primary output plays it whenever it's on).
let wasListening = false;
function listenChanged() {
  if (listener && !sceneViewSound()) listener = null;
  const now = listening();
  if (now === wasListening) return;
  wasListening = now;
  log('info', 'outputs', now ? 'Sound from the Scene View (the primary output is off)' : 'The Scene View is silent');
}

// POST /api/outputs/listen { id, on, take }: an Output page (or the Scene View window) asking to play the
// sound in its Scene View (on), or letting go of it. take: someone clicked that Scene View, so it takes the
// sound from another page. Answers { sound }: whether that Scene View should play sound, which it never
// does while the primary output is on.
function listen({ id, on, take } = {}) {
  id = String(id || '');
  const mine = listener && listener.id === id;
  if (on && id && sceneViewSound() && (mine || take || !listening())) listener = { id, until: Date.now() + LISTEN_MS };
  else if (mine) listener = null;
  listenChanged();
  return { sound: listening() && listener.id === id };
}

async function route(req, res, url, { send: reply, readBody }) {
  if (url.pathname === '/api/outputs/listen' && req.method === 'POST') {
    reply(res, 200, listen(await readBody(req).catch(() => ({}))));
    return true;
  }
  if (url.pathname !== '/api/outputs') return false;
  if (req.method === 'POST') {
    const error = apply(await readBody(req));
    if (error) { reply(res, 400, { error, ...state() }); return true; }
  }
  // ?scan=1 (the Output page opening) asks the app to look for Blackmagic devices again.
  else if (url.searchParams.get('scan') === '1' && port) port.postMessage({ type: 'scan' });
  reply(res, 200, state());
  return true;
}

// /deck/output/on|off|toggle shows or blanks the primary output without changing its setup;
// /deck/output/<name or number>/on|off|toggle one output, /deck/output/all/on|off|toggle every one
// (toggle: all off if any is on, else all on). /deck/output/<name or number>/layer/... is the scene's.
function deck(parts) {
  if (parts[0] !== 'output') return null;
  const verbs = o => ({ on: true, off: false, toggle: !o.on });
  if (parts.length <= 2) {
    const on = verbs(primary())[parts[1]];
    if (on === undefined) return { status: 404, body: { error: 'Use /deck/output/on, off or toggle, or /deck/output/<output>/on, off or toggle.' } };
    apply({ on });
    return { status: 200, body: { ok: true, on: primary().on, mode: primary().mode, output: primary().name } };
  }
  if (parts[1] === 'all') {
    const any = list.some(o => o.on && o.mode !== 'off');
    const on = { on: true, off: false, toggle: !any }[parts[2]];
    if (on === undefined || parts.length > 3) return { status: 404, body: { error: 'Use /deck/output/all/on, off or toggle.' } };
    const before = JSON.stringify(list);
    for (const o of list) o.on = on && o.mode !== 'off'; // one set to Web links only stays off
    if (JSON.stringify(list) !== before) { listenChanged(); log('info', 'outputs', `Every output ${on ? 'on' : 'off'}`); save(); }
    return { status: 200, body: { ok: true, on } };
  }
  const o = find(parts[1]);
  if (!o) return { status: 404, body: { error: `No output "${parts[1]}". Use its name or number, as on the Output page.` } };
  if (parts.length > 3) return null; // /deck/output/<output>/layer/...: the scene's link
  const on = verbs(o)[parts[2]];
  if (on === undefined) return { status: 404, body: { error: `Use /deck/output/${slug(o.name)}/on, off or toggle.` } };
  apply({ output: o.id, on });
  const now = find(o.id);
  return { status: 200, body: { ok: true, on: now.on, mode: now.mode, output: now.name } };
}

// A message from the Mac app: its displays, Blackmagic devices, NDI and how they're doing.
function message(msg) {
  if (msg.type === 'displays' && Array.isArray(msg.displays)) {
    displays = msg.displays.map(d => ({ id: String(d.id), label: String(d.label || `Display ${d.id}`), width: d.width, height: d.height, scale: Number(d.scale) || 1, primary: !!d.primary }));
    send();
  }
  if (msg.type === 'decklink') {
    const before = JSON.stringify(windows());
    decklink = { ok: !!msg.ok, error: String(msg.error || ''), version: String(msg.version || ''), devices: Array.isArray(msg.devices) ? msg.devices : [] };
    if (JSON.stringify(windows()) !== before) send();
  }
  if (msg.type === 'decklinkStatus') { decklinkStatus = msg.status || { running: false }; decklinkOutput = String(msg.output || PRIMARY); }
  if (msg.type === 'ndi') {
    const before = JSON.stringify(windows());
    ndi = { ok: !!msg.ok, error: String(msg.error || ''), version: String(msg.version || ''), url: String(msg.url || '') };
    if (JSON.stringify(windows()) !== before) send();
  }
  if (msg.type === 'ndiStatus') ndiStatus.set(String(msg.output || PRIMARY), msg.status || { running: false });
  if (msg.type === 'perf') notePerf(msg);
  // Esc on an output window turns that output off, in case it covers the screen you work on.
  if (msg.type === 'escape') apply({ output: msg.output || PRIMARY, on: false });
  listenChanged(); // an output may have come or gone
}

const num = n => Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : 0;
const perfNow = () => perf && Date.now() - perf.at < PERF_STALE_MS ? perf : null;

function notePerf(msg) {
  const outputs = {};
  for (const [id, p] of Object.entries(msg.outputs || {})) {
    outputs[String(id)] = { cpu: num(p?.cpu), memMB: num(p?.memMB), fps: num(p?.fps), target: num(p?.target) };
  }
  const t = msg.total;
  perf = { at: Date.now(), outputs, total: t ? { cpu: num(t.cpu), memMB: num(t.memMB), gpu: num(t.gpu) } : null };
  if (!Object.keys(outputs).length) { perfSamples = []; return; }
  perfSamples.push(perf);
  if (!perfLoggedAt) perfLoggedAt = perf.at;
  if (perf.at - perfLoggedAt >= PERF_LOG_MS) logPerf();
}

// One line a minute while outputs are showing: each output's average CPU and memory and its frame rate
// (the lowest seen, against what it should draw at), and Studio as a whole.
function logPerf() {
  const samples = perfSamples;
  perfSamples = [];
  perfLoggedAt = Date.now();
  if (!samples.length) return;
  const avg = xs => Math.round(xs.reduce((n, x) => n + x, 0) / xs.length);
  const parts = list.map(o => {
    const mine = samples.map(s => s.outputs[o.id]).filter(Boolean);
    if (!mine.length) return '';
    const low = Math.min(...mine.map(p => p.fps));
    const target = mine.at(-1).target;
    return `${o.name} ${avg(mine.map(p => p.cpu))}% CPU, ${avg(mine.map(p => p.memMB))} MB, ${avg(mine.map(p => p.fps))} of ${target} fps (lowest ${low})`;
  }).filter(Boolean);
  const totals = samples.map(s => s.total).filter(Boolean);
  if (totals.length) parts.push(`Studio in all ${avg(totals.map(t => t.cpu))}% CPU, ${avg(totals.map(t => t.memMB))} MB, graphics processor ${avg(totals.map(t => t.gpu))}% CPU`);
  log('info', 'outputs', `Performance over the last minute: ${parts.join('; ')}`);
}

// colours(): the active competition's colours and club colours, [{ name, hex }].
// removed(id): an output was removed (the scene drops what was on for it). changed(): any setting changed.
// soft(): the pictures and videos that look soft in 4K, [{ what, name, width, height }].
function init(logger, { colours, removed, changed, soft } = {}) {
  log = logger;
  if (changed) onChange = changed;
  if (soft) softPictures = () => { try { return soft() || []; } catch (err) { log('warn', 'outputs', `Checking pictures for 4K: ${err.message}`); return []; } };
  if (colours) competitionColours = () => { try { return colours() || []; } catch { return []; } };
  if (removed) onRemove = id => { try { removed(id); } catch (err) { log('warn', 'outputs', `Removing an output: ${err.message}`); } };
  load();
  setInterval(listenChanged, 5000).unref(); // a preview that stopped checking in

  if (port) {
    port.on('message', e => message(e.data || {}));
    port.postMessage({ type: 'ready' });
  }
}

// The outputs' ids, names, numbers and colours, for the scene and the Output page:
// [{ id, slot, name, link, colour, primary, sponsors, sending }]. sending: it's sending the scene now (on, and not set to Web links only).
function summary() {
  const sending = new Set(windows().map(w => w.output));
  return list.map(o => ({ id: o.id, slot: o.slot, name: o.name, link: slug(o.name), colour: COLOURS[o.slot], primary: o.id === PRIMARY,
    sponsors: o.id === PRIMARY || o.sponsors, sending: sending.has(o.id) }));
}

// What each output sending something gives the switcher, for its key settings check (switcher.js):
// [{ id, name, slot, colour, keyer: 'dsk1' | 'usk2' | ... | 'none', fill, key, cameras, signal, premultiplied }]. signal is
// chroma (over a colour), fillkey (a fill and a key), fill (fill only) or alpha (one NDI source with transparency);
// premultiplied: the fill is premultiplied (Studio's always is, unless the Blackmagic device's Straight is ticked).
const signalOf = o => o.mode === 'chroma' ? 'chroma' : o.mode === 'fillkey' ? 'fillkey'
  : o.mode === 'decklink' ? (o.decklinkKeying === 'external' ? 'fillkey' : 'fill') : o.mode === 'ndi' ? o.ndiSignal : 'off';
const keyerOf = o => o.keyer || (signalOf(o) === 'chroma' || o.slot !== 1 ? `usk${o.slot}` : 'dsk1');
function switcherPlan() {
  return list.filter(o => o.mode !== 'off').map(o => ({ id: o.id, name: o.name, on: !!o.on, slot: o.slot, colour: COLOURS[o.slot], keyer: keyerOf(o),
    fill: o.swFill, key: o.swKey, cameras: o.swCameras, signal: signalOf(o), premultiplied: !(o.mode === 'decklink' && o.decklinkStraight) }));
}

// Sponsors are on air (for the exposure report) while an output that counts for them is sending: Output 1, or one
// with Counts for sponsors ticked. Output 1 can be off on a night another output goes to the switcher.
function sponsorsOnAir() {
  const counting = new Set(summary().filter(o => o.sponsors).map(o => o.id));
  return windows().some(w => counting.has(w.output));
}

module.exports = { init, route, deck, state, apply, windows, listen, message, summary, switcherPlan, sponsorsOnAir, find, PRIMARY, MAX, COLOURS };
