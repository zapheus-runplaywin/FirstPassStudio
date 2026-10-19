// FirstPass Studio - sending the scene to the Mac's own displays (optional).
//
// Two ways, picked on the Output page:
//   chroma   - the scene over a solid colour on one extra display (a single HDMI into a switcher
//              that keys on that colour);
//   fill+key - the scene over black on one display (fill) and its transparency as white on black
//              on another (key), for a switcher's fill and key inputs.
// The Mac app opens the windows (desktop/outputs.js): it tells the helper which displays it has and
// the helper tells it what to show, over the utility process's message port. Run without the app
// (npm start) there are no displays, and the Output page says so.
//
// Saved as outputs.json in the data folder. Stream Deck: /deck/output/on|off|toggle.

'use strict';

const fs = require('fs');
const datadir = require('./datadir');

const FILE = datadir.file('outputs.json');
const MODES = ['off', 'chroma', 'fillkey'];
const DEFAULT_CHROMA = '#00b140';

let log = () => {};
let settings = { mode: 'off', on: true, chromaDisplay: '', chromaColor: DEFAULT_CHROMA, fillDisplay: '', keyDisplay: '' };
// The Mac app's displays: [{ id, label, width, height, primary }]; null when not run by the app.
let displays = null;
const port = process.parentPort || null;

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

// What each display should show now: [{ display, kind: 'fill' | 'key' | 'chroma', color }].
function windows() {
  if (!settings.on || !displays) return [];
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
  return { ...settings, app: !!displays, displays: displays || [], showing: windows() };
}

function apply(changes) {
  const before = JSON.stringify(settings);
  settings = clean(changes || {});
  if (JSON.stringify(settings) !== before) {
    const w = windows();
    log('info', 'outputs', `Output ${settings.on ? settings.mode : 'off'}${w.length ? `: ${w.map(x => `${x.kind} on ${label(x.display)}`).join(', ')}` : ''}`);
    save();
  }
}

const label = id => (displays || []).find(d => d.id === id)?.label || `display ${id}`;

async function route(req, res, url, { send: reply, readBody }) {
  if (url.pathname !== '/api/outputs') return false;
  if (req.method === 'POST') apply(await readBody(req));
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
  if (port) {
    port.on('message', e => {
      const msg = e.data || {};
      if (msg.type === 'displays' && Array.isArray(msg.displays)) {
        displays = msg.displays.map(d => ({ id: String(d.id), label: String(d.label || `Display ${d.id}`), width: d.width, height: d.height, primary: !!d.primary }));
        send();
      }
      // Esc on an output window turns the output off, in case it covers the screen you work on.
      if (msg.type === 'escape') apply({ on: false });
    });
    port.postMessage({ type: 'ready' });
  }
}

module.exports = { init, route, deck, state, apply, windows };
