// FirstPass Studio - sending the scene to the Mac's own displays or a Blackmagic device (optional).
//
// Three ways, picked on the Output page:
//   chroma   - the scene over a solid colour on one extra display (a single HDMI into a switcher
//              that keys on that colour);
//   fill+key - the scene over black on one display (fill) and its transparency as white on black
//              on another (key), for a switcher's fill and key inputs;
//   decklink - out of a Blackmagic UltraStudio or DeckLink, as fill and key over SDI (its external
//              keyer) or fill only.
// The Mac app does the sending (desktop/outputs.js, desktop/decklink.js): it tells the helper which
// displays and Blackmagic devices it has and the helper tells it what to show, over the utility
// process's message port. Run without the app (npm start) there are none, and the Output page says so.
//
// Saved as outputs.json in the data folder. Stream Deck: /deck/output/on|off|toggle.

'use strict';

const fs = require('fs');
const datadir = require('./datadir');

const FILE = datadir.file('outputs.json');
const MODES = ['off', 'chroma', 'fillkey', 'decklink'];
const KEYING = ['external', 'off'];
const DEFAULT_CHROMA = '#00b140';

let log = () => {};
let settings = {
  mode: 'off', on: true, chromaDisplay: '', chromaColor: DEFAULT_CHROMA, fillDisplay: '', keyDisplay: '',
  decklinkDevice: '', decklinkMode: 0, decklinkKeying: 'external', decklinkStraight: false, previewSound: false,
};
// The Mac app's displays: [{ id, label, width, height, primary }]; null when not run by the app.
let displays = null;
// The Mac app's Blackmagic devices: { ok, version, devices: [{ id, name, externalKeying, modes }] } or
// { ok: false, error }, and how its output is doing: { running, error, name, late, dropped }.
let decklink = null;
let decklinkStatus = { running: false };
const port = process.parentPort || null;
// The Output page whose preview plays the sound (previewSound): { id, until }. Only one at a time, and
// while it does the outputs are muted, so the same sound never plays twice. It checks in every few
// seconds; if it stops (the page closed without saying so) the outputs get their sound back.
let listener = null;
const LISTEN_MS = 70000; // a hidden page's timers can slow to once a minute

const hex = c => /^#?[0-9a-f]{6}$/i.test(String(c || '')) ? `#${String(c).replace('#', '').toLowerCase()}` : DEFAULT_CHROMA;

function clean(s, old = settings) {
  const pick = (k, d) => (s[k] === undefined ? old[k] : s[k]) ?? d;
  return {
    mode: MODES.includes(pick('mode')) ? pick('mode') : 'off',
    on: pick('on', true) !== false,
    chromaDisplay: String(pick('chromaDisplay', '')),
    chromaColor: hex(pick('chromaColor')),
    fillDisplay: String(pick('fillDisplay', '')),
    keyDisplay: String(pick('keyDisplay', '')),
    decklinkDevice: String(pick('decklinkDevice', '')),
    decklinkMode: Number(pick('decklinkMode', 0)) || 0,
    decklinkKeying: KEYING.includes(pick('decklinkKeying')) ? pick('decklinkKeying') : 'external',
    decklinkStraight: pick('decklinkStraight', false) === true,
    previewSound: pick('previewSound', false) === true,
  };
}

function load() {
  try { settings = clean(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (err) { if (err.code !== 'ENOENT') log('warn', 'outputs', `Could not read outputs.json: ${err.message}`); }
}

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n'); }
  catch (err) { log('error', 'outputs', `Could not save outputs.json: ${err.message}`); }
  send();
}

const listening = () => !!(settings.previewSound && listener && listener.until > Date.now());

// What each display should show now: [{ display, kind: 'fill' | 'key' | 'chroma', color, muted }], or the
// Blackmagic output: [{ kind: 'decklink', device, mode, keying, straight, muted }]. muted: the
// Output page's preview is playing the sound instead.
function windows() {
  const muted = listening();
  return outputWindows().map(w => ({ ...w, muted }));
}

function outputWindows() {
  if (!settings.on) return [];
  if (settings.mode === 'decklink') {
    const device = decklink?.devices?.find(d => d.id === settings.decklinkDevice);
    if (!device || !device.modes.some(m => m.mode === settings.decklinkMode)) return [];
    return [{ kind: 'decklink', device: device.id, mode: settings.decklinkMode, keying: settings.decklinkKeying, straight: settings.decklinkStraight }];
  }
  if (!displays) return [];
  const have = id => displays.some(d => d.id === id);
  if (settings.mode === 'chroma' && have(settings.chromaDisplay)) return [{ display: settings.chromaDisplay, kind: 'chroma', color: settings.chromaColor }];
  if (settings.mode === 'fillkey') {
    const out = [];
    if (have(settings.fillDisplay)) out.push({ display: settings.fillDisplay, kind: 'fill' });
    if (have(settings.keyDisplay) && settings.keyDisplay !== settings.fillDisplay) out.push({ display: settings.keyDisplay, kind: 'key' });
    return out;
  }
  return [];
}

// Tells the Mac app which windows to open.
function send() {
  if (port) port.postMessage({ type: 'outputs', windows: windows() });
}

function state() {
  return { ...settings, app: !!displays, displays: displays || [], decklink: decklink || { ok: false, error: '' }, decklinkStatus, showing: windows(), listening: listening() };
}

function apply(changes) {
  const before = JSON.stringify(settings);
  settings = clean(changes || {});
  if (JSON.stringify(settings) !== before) {
    if (!settings.previewSound) listener = null;
    listenChanged();
    const w = windows();
    log('info', 'outputs', `Output ${settings.on ? settings.mode : 'off'}${w.length ? `: ${w.map(x => x.kind === 'decklink' ? `${deviceName(x.device)} (${modeName(x.device, x.mode)}, ${x.keying === 'external' ? 'fill and key' : 'fill only'})` : `${x.kind} on ${label(x.display)}`).join(', ')}` : ''}`);
    save();
  }
}

const label = id => (displays || []).find(d => d.id === id)?.label || `display ${id}`;
const deviceName = id => decklink?.devices?.find(d => d.id === id)?.name || 'Blackmagic device';
const modeName = (id, mode) => decklink?.devices?.find(d => d.id === id)?.modes.find(m => m.mode === mode)?.name || 'video format';

// The preview's sound moving to or from the Output page: mute or unmute the outputs.
let wasListening = false;
function listenChanged() {
  const now = listening();
  if (now === wasListening) return;
  wasListening = now;
  log('info', 'outputs', now ? 'Sound from the Output page preview; the outputs are muted' : 'Sound from the outputs again');
  send();
}

// POST /api/outputs/listen { id, on }: an Output page asking to play the sound in its preview (on), or
// letting go of it. Answers { sound }: whether that page's preview should play sound.
function listen({ id, on } = {}) {
  id = String(id || '');
  const mine = listener && listener.id === id;
  if (on && id && settings.previewSound && (mine || !listening())) listener = { id, until: Date.now() + LISTEN_MS };
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
  if (req.method === 'POST') apply(await readBody(req));
  // ?scan=1 (the Output page opening) asks the app to look for Blackmagic devices again.
  else if (url.searchParams.get('scan') === '1' && port) port.postMessage({ type: 'scan' });
  reply(res, 200, state());
  return true;
}

// /deck/output/on|off|toggle: shows or blanks the displays without changing the setup.
function deck(parts) {
  if (parts[0] !== 'output') return null;
  const on = { on: true, off: false, toggle: !settings.on }[parts[1]];
  if (on === undefined) return { status: 404, body: { error: 'Use /deck/output/on, off or toggle.' } };
  apply({ on });
  return { status: 200, body: { ok: true, on: settings.on, mode: settings.mode } };
}

function init(logger) {
  log = logger;
  load();
  setInterval(listenChanged, 5000).unref(); // a preview that stopped checking in

  if (port) {
    port.on('message', e => {
      const msg = e.data || {};
      if (msg.type === 'displays' && Array.isArray(msg.displays)) {
        displays = msg.displays.map(d => ({ id: String(d.id), label: String(d.label || `Display ${d.id}`), width: d.width, height: d.height, primary: !!d.primary }));
        send();
      }
      if (msg.type === 'decklink') {
        const before = JSON.stringify(windows());
        decklink = { ok: !!msg.ok, error: String(msg.error || ''), version: String(msg.version || ''), devices: Array.isArray(msg.devices) ? msg.devices : [] };
        if (JSON.stringify(windows()) !== before) send();
      }
      if (msg.type === 'decklinkStatus') decklinkStatus = msg.status || { running: false };
      // Esc on an output window turns the output off, in case it covers the screen you work on.
      if (msg.type === 'escape') apply({ on: false });
    });
    port.postMessage({ type: 'ready' });
  }
}

module.exports = { init, route, deck, state, apply, windows };
