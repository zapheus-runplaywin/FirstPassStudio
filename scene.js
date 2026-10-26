// FirstPass Studio - the scene: sources drawn as layers on one frame, built on the Output page.
//
// One scene, a list of sources drawn as layers, top layer first: Studio pages (or any web
// address), and images and videos from the media folder. Each source can be shown and hidden with its
// own fade, and placed and scaled on the 1920 x 1080 frame. The Output page (output.html)
// builds it, scene.html draws it, and the Stream Deck shows and hides sources with
// /deck/layer/<name>/on|off|toggle|restart, /deck/layer/<name>/sound/on|off|toggle and
// /deck/layers/off.
//
// Scenes are saved looks for those same sources: each one sets a source on or off, or leaves it
// as it is (not in its states). Going to a scene (/deck/scene/<name>, next, prev, again) turns
// sources on and off to match and leaves one that's already on running. Sources stay shared, so
// a source changed by hand afterwards is changed everywhere, and changed lists the ones that
// differ from the current scene's saved state.
//
// With more than one output (outputs.js), each source also has an on and off for each output besides the
// primary (out: { <output id>: true }), and scene.html?output=<id> draws that output's sources. Scenes and
// sequences are shared by every output: going to a scene (a.output, the primary unless set) sets its
// sources on that output, and each output has its own current scene (current for the primary, currentOut
// for the others) and its own playing sequence. Sponsor ads and the music stay with the primary, and only
// the primary plays sound. /deck/output/<output>/layer/<name>/on|off|toggle|restart,
// /deck/output/<output>/layers/off, /deck/output/<output>/scene/<name>|next|prev|again and
// /deck/output/<output>/sequence/... act on one output; the links above act on the primary.
//
// Saved as scene.json in the data folder; images and videos are kept in its media/ folder.
// Chromium can't play ProRes, so a .mov added to the media folder is converted to a WebM
// beside it (VP9, keeping transparency) with the ffmpeg the app bundles; the original is kept. Nothing here
// changes the other pages: each still works on its own at its own link.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const datadir = require('./datadir');
const savefile = require('./savefile');
const sequences = require('./sequences');
const music = require('./music');
const switcher = require('./switcher');
const sponsors = require('./sponsors');
const competitions = require('./competitions');
const exposure = require('./exposure');
const { unpacked } = require('./unpacked');
const uploads = require('./uploads');

const FILE = datadir.file('scene.json');
const MEDIA_DIR = datadir.file('media');
const WIDTH = 1920, HEIGHT = 1080;
const TYPES = ['browser', 'image', 'video'];
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const AUDIO_TYPES = music.AUDIO_TYPES;
const MEDIA_TYPES = { ...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES };
const MAX_IMAGE = 50 * 1024 * 1024, MAX_VIDEO = 20 * 1024 * 1024 * 1024, MAX_AUDIO = 2 * 1024 * 1024 * 1024;
// The Studio Stream Deck plugin (plugins/studio-deck), packed by the Mac app's build so it ships with the app.
const STREAMDECK_PLUGIN = unpacked(path.join(__dirname, 'plugins', 'studio-deck', 'dist', 'com.runplaywin.firstpass-studio.streamDeckPlugin'));
const kindOf = f => { const x = path.extname(f).toLowerCase(); return IMAGE_TYPES[x] ? 'image' : VIDEO_TYPES[x] ? 'video' : AUDIO_TYPES[x] ? 'audio' : null; };

// ─── Sponsor ads ─────────────────────────────────────────────────────────
// Ads play in their own sources, made the first time they're needed and kept on top of the scene: Sponsor
// ad (video), Sponsor ad (still) and House ad (ad.html, when no sponsor has an ad and the step allows it).
// Each ad sets the source's file; a new file reloads it. Returns what a sequence step needs, or null.
// Another output plays its ads in its own three (ad<v|i|h><output id>), so two outputs' ads never fight over one
// file; they go when the output does.
const AD_SOURCES = {
  video: { id: 'sponsoradvideo', type: 'video', name: 'Sponsor ad (video)', sound: true, hideWhenDone: true, restartOnShow: true },
  image: { id: 'sponsoradimage', type: 'image', name: 'Sponsor ad (still)' },
  house: { id: 'sponsoradhouse', type: 'browser', name: 'House ad', url: 'ad.html' },
};
const adSourceId = (kind, out) => out ? `ad${kind[0]}${out}` : AD_SOURCES[kind].id;
function adSource(kind, file, out = null) {
  const spec = AD_SOURCES[kind];
  const id = adSourceId(kind, out);
  let src = scene.sources.find(s => s.id === id);
  if (!src) {
    change({ type: 'add', sources: [{ ...spec, id, ...(out ? { name: `${spec.name}, ${outputName(out)}` } : {}), ...(file ? { file } : {}) }] });
    src = scene.sources.find(s => s.id === id);
  } else if (file && src.file !== file) {
    src.file = file;
    src.loadSeq++;
  }
  return src;
}
// Which sponsor's ad each Sponsor ad source has in it, for the exposure report (exposure.js).
const adSponsor = new Map();
// Whether what's on an output counts in the sponsors' exposure report: always the primary's; another output's
// only with Counts for sponsors ticked (Studio can't tell whether it's on the stream: a camera's keyer, a
// commentary monitor).
const countsForSponsors = out => !out || !!outputsApi.summary?.().find(o => o.id === out)?.sponsors;
// The sources on now, for the exposure report: [{ id, name, url, sponsor }], on the primary and on each output
// that counts for sponsors (named "Ladder (Wide camera)" there).
function showing() {
  const view = (s, where) => ({ id: s.id, name: where ? `${s.name} (${where})` : s.name, url: s.type === 'browser' ? s.url : '', sponsor: adSponsor.get(s.id) || null });
  const list = scene.sources.filter(s => s.visible).map(s => view(s, ''));
  for (const o of outputsApi.summary?.() || []) {
    if (o.id !== PRIMARY && o.sponsors) list.push(...scene.sources.filter(s => s.out[o.id]).map(s => view(s, o.name)));
  }
  return list;
}
// The next sponsor ad, in the ad sources of an output (null: the primary).
function sponsorAd(opts = {}, out = null) {
  const ad = sponsors.nextAd(competitions.activeId(), { exists: f => fs.existsSync(path.join(MEDIA_DIR, cleanFile(f))) });
  if (!ad && !opts.house) return null;
  const src = ad ? adSource(ad.kind, ad.file, out) : adSource('house', null, out);
  if (ad) {
    log('info', 'scene', `Sponsor ad: ${ad.sponsor.name} (${ad.file})${out ? ` on ${outputName(out)}` : ''}`);
    adSponsor.set(src.id, ad.sponsor.id);
    // A play counts where the time on screen does.
    if (countsForSponsors(out)) exposure.play(ad);
  }
  return { source: src.id, name: ad ? ad.sponsor.name : 'House ad', sponsor: ad ? ad.sponsor.id : null,
    length: ad && ad.kind === 'image' ? { type: 'time', sec: ad.seconds } : { type: 'done' } };
}

let log = () => {};
// The outputs (outputs.js), to find one by its name or number in a Stream Deck link. Without them, only
// the primary output.
const PRIMARY = 'main';
let outputsApi = { find: ref => (ref === PRIMARY || ref === '1' ? { id: PRIMARY } : null) };
let scene = { sources: [], scenes: [], current: null, currentOut: {} };
// Sources set on in the current scene that went off by themselves (a video that hides when it's
// done): not a change from the scene. The primary's (kept with the scene), and the other outputs' by id.
let ended = new Set();
const endedOut = new Map();
const endedOf = out => out ? (endedOut.get(out) || endedOut.set(out, new Set()).get(out)) : ended;
function clearEnded(out) { if (out) endedOut.delete(out); else ended = new Set(); }
// A source on (or off) on an output: null for the primary, else an output's id.
const isOn = (s, out) => out ? !!s.out[out] : s.visible;
function setOn(s, on, out) {
  if (!out) s.visible = on;
  else if (on) s.out[out] = true;
  else delete s.out[out];
}
// Videos that finished but stay on screen (not set to switch off when done): their sound has stopped.
const soundDone = new Set();
// Sources on after the last change, so each time one comes on its showSeq goes up: a page or video that
// says it's done names the showing it means, and a late word from an earlier showing is ignored.
let wasOn = new Set();
let stillTimer = null; // takes a still sponsor ad played by hand (/deck/sponsor/ad) off after its seconds
const COLOURS = ['blue', 'green', 'grey', 'yellow', 'purple'];
const STATES = ['on', 'off'];
// Scene link names that are the next/prev/again links instead.
const RESERVED = new Set(['next', 'prev', 'previous', 'again']);
let rev = 0;
const listeners = new Set(); // server-sent events (/api/scene/events): the Stream Deck plugin
const sockets = new Set();   // WebSockets (/api/scene/socket): Studio's own pages
// The scoreboard over the same socket, for the pages that asked for it ({"subscribe":"board"}): the
// scoreboard, the control page, the goals and the countdown follow it instead of polling. server.js
// gives boardSource (the scoreboard's JSON) and calls publishBoard when the board may have changed.
const boardSockets = new Set();
let boardSource = null;
// The switcher (switcher.js) the same way, for the pages that asked ({"subscribe":"switcher"}): the Output page.
const switcherSockets = new Set();
let switcherSource = null;
function switcherFrame(json) { return wsFrame(1, Buffer.from(JSON.stringify({ type: 'switcher', switcher: json }))); }
function setSwitcherSource(fn) { switcherSource = fn; }
function publishSwitcher() {
  if (!switcherSource || !switcherSockets.size) return;
  const frame = switcherFrame(switcherSource());
  for (const s of switcherSockets) s.write(frame);
}
let lastBoardKey = '';
function boardFrame(json) { return wsFrame(1, Buffer.from(JSON.stringify({ type: 'board', board: json }))); }
function setBoardSource(fn) { boardSource = fn; }
function publishBoard() {
  if (!boardSource || !boardSockets.size) return;
  const json = boardSource();
  const key = JSON.stringify({ ...json, serverNow: 0 }); // only a change is sent, not the clock reading
  if (key === lastBoardKey) return;
  lastBoardKey = key;
  const frame = boardFrame(json);
  for (const s of boardSockets) s.write(frame);
}

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
// The name used in Stream Deck links: "Up Next" is /deck/layer/up-next/on.
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);

// A browser source's address: a Studio page ("scoreboard.html?position=top-center") or a full http(s) link.
// A browser source's address: one of Studio's own pages (a relative link, or a full one on localhost
// made relative) or an http(s) page elsewhere. Anything else (javascript:, data:, file:) is dropped.
function cleanUrl(u) {
  const s = String(u || '').trim().replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i, '');
  let parsed;
  try { parsed = new URL(s, 'http://studio.invalid/'); } catch { return ''; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  if (/^https?:\/\//i.test(s)) return s;
  // Relative: a scheme-relative or protocol-less absolute form ("//evil", "\\evil") would leave Studio.
  if (/^[\\/]{2}/.test(s)) return '';
  return s.replace(/^\/+/, '');
}
const cleanFile = f => path.basename(String(f || ''));

function uniqueName(name, id) {
  const base = String(name || '').trim().slice(0, 60) || 'Source';
  const taken = new Set(scene.sources.filter(s => s.id !== id).map(s => slug(s.name)));
  if (!taken.has(slug(base)) && slug(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(slug(`${base} ${i}`))) return `${base} ${i}`;
}

function defaultName(src) {
  if (src.type !== 'browser') return path.basename(src.file || (src.type === 'video' ? 'Video' : 'Image'), path.extname(src.file || ''));
  const page = String(src.url || '').split(/[?#]/)[0].split('/').pop().replace(/\.html?$/i, '');
  const words = page.replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Browser';
}

// Fills in and tidies every setting, so a hand-edited or older scene.json is always usable.
function clean(src, existing = {}) {
  const s = { ...existing, ...src };
  const type = TYPES.includes(s.type) ? s.type : 'browser';
  const out = {
    id: String(existing.id || s.id || newId()).replace(/[^a-z0-9]/gi, '').slice(0, 20) || newId(),
    type,
    name: '',
    visible: !!s.visible,
    fadeMs: Math.round(clamp(s.fadeMs, 0, 10000, 500)),
    x: Math.round(clamp(s.x, -WIDTH, WIDTH * 2, 0)),
    y: Math.round(clamp(s.y, -HEIGHT, HEIGHT * 2, 0)),
    scale: clamp(s.scale, 1, 1000, 100),
    loadSeq: Math.round(clamp(s.loadSeq, 0, 1e9, 0)),
    showSeq: Math.round(clamp(s.showSeq, 0, 1e9, 0)),
    // On for each output besides the primary, and (not saved) each output's showSeq, as showSeq is the primary's.
    out: cleanOut(s.out),
    outSeq: { ...(s.outSeq && typeof s.outSeq === 'object' ? s.outSeq : {}) },
  };
  if (type === 'browser') {
    out.url = cleanUrl(s.url) || 'scoreboard.html';
    out.width = Math.round(clamp(s.width, 16, 7680, WIDTH));
    out.height = Math.round(clamp(s.height, 16, 4320, HEIGHT));
    out.reloadOnShow = s.reloadOnShow === undefined ? true : !!s.reloadOnShow;
  } else {
    out.file = cleanFile(s.file);
  }
  if (type === 'video') {
    out.loop = !!s.loop;
    out.restartOnShow = s.restartOnShow === undefined ? true : !!s.restartOnShow;
    out.hideWhenDone = s.hideWhenDone === undefined ? true : !!s.hideWhenDone;
    out.sound = !!s.sound;
    out.volume = Math.round(clamp(s.volume, 0, 100, 100));
  }
  out.name = uniqueName(s.name || defaultName(out), out.id);
  return out;
}

const OUTPUT_ID = /^[a-z0-9]{1,20}$/i;
function cleanOut(o) {
  const out = {};
  for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) if (v === true && OUTPUT_ID.test(k) && k !== PRIMARY) out[k] = true;
  return out;
}

function uniqueSceneName(name, id) {
  const base = String(name || '').trim().slice(0, 60) || 'Scene';
  const taken = new Set([...RESERVED, ...scene.scenes.filter(s => s.id !== id).map(s => slug(s.name))]);
  if (!taken.has(slug(base)) && slug(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(slug(`${base} ${i}`))) return `${base} ${i}`;
}

// A scene: its name, Stream Deck colour group, and on or off for each source it sets (by source id).
function cleanScene(sc, existing = {}) {
  const s = { ...existing, ...sc };
  const ids = new Set(scene.sources.map(x => x.id));
  const states = {};
  for (const [id, v] of Object.entries(s.states && typeof s.states === 'object' ? s.states : {})) if (ids.has(id) && STATES.includes(v)) states[id] = v;
  const out = {
    id: String(existing.id || s.id || newId()).replace(/[^a-z0-9]/gi, '').slice(0, 20) || newId(),
    name: '',
    colour: COLOURS.includes(s.colour) ? s.colour : 'blue',
    states,
    quiet: !!s.quiet,  // Quiet the music when this scene is picked (an interview on court)
  };
  // Switcher actions (switcher.js) done as the scene is picked on the primary.
  const sw = switcher.cleanActions(s.switcher);
  if (sw.length) out.switcher = sw;
  out.name = uniqueSceneName(s.name, out.id);
  return out;
}

// What's on and off now, for every source.
const liveStates = out => Object.fromEntries(scene.sources.map(s => [s.id, isOn(s, out) ? 'on' : 'off']));

function findScene(ref) {
  const r = String(ref || '');
  return scene.scenes.find(s => s.id === r) || scene.scenes.find(s => slug(s.name) === slug(r)) || null;
}
// The current scene on an output (null: the primary).
const currentScene = (out = null) => scene.scenes.find(s => s.id === (out ? scene.currentOut[out] : scene.current)) || null;
function setCurrent(out, id) {
  if (out) { if (id) scene.currentOut[out] = id; else delete scene.currentOut[out]; } else scene.current = id;
}

// The sources that differ from the current scene's saved state, on an output (null: the primary).
function changed(out = null) {
  const cur = currentScene(out);
  if (!cur) return [];
  const done = endedOf(out);
  return scene.sources.filter(s => {
    const want = cur.states[s.id];
    if (!want || (want === 'on') === isOn(s, out)) return false;
    return !(want === 'on' && done.has(s.id));
  }).map(s => s.id);
}

// Turns sources on and off to match a scene. A source already on stays as it is (a page isn't
// reloaded and a video doesn't start again), and a source the scene doesn't set is left alone.
// Picking a scene stops a playing sequence, unless it's the sequence's own Then going there.
// A sequence's scene step (step) leaves the music alone unless the scene quiets it. out: the output it's
// set on, null for the primary.
function goTo(sc, fromSequence, step, out = null) {
  if (!fromSequence) sequences.beforeScene(sc, out || PRIMARY);
  let on = 0, off = 0;
  for (const s of scene.sources) {
    const want = sc.states[s.id];
    if (!want) continue;
    if (want === 'on' && !isOn(s, out)) { setOn(s, true, out); on++; }
    if (want === 'off' && isOn(s, out)) { setOn(s, false, out); off++; }
  }
  clearEnded(out);
  setCurrent(out, sc.id);
  log('info', 'scene', `Went to scene "${sc.name}"${out ? ` on ${outputName(out)}` : ''}: ${on} on, ${off} off`);
  // The music is the primary's, and so is the switcher: its actions fire only for the primary, and any
  // still to come from the scene before are called off. A sequence's scene step's belong to the sequence
  // (sequences.js calls them off as it moves on or stops).
  if (!out && (!step || sc.quiet)) music.quiet(sc.quiet);
  if (!out) switcher.run(sc.switcher, `Scene "${sc.name}"`, fromSequence && step ? 'sequenceScene' : 'scene');
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    scene = { sources: [], scenes: [], current: null, currentOut: {} };
    for (const s of Array.isArray(saved.sources) ? saved.sources : []) scene.sources.push(clean(s));
    for (const sc of Array.isArray(saved.scenes) ? saved.scenes : []) if (sc && typeof sc === 'object') scene.scenes.push(cleanScene(sc));
    scene.current = scene.scenes.some(sc => sc.id === saved.current) ? saved.current : null;
    for (const [o, id] of Object.entries(saved.currentOut && typeof saved.currentOut === 'object' ? saved.currentOut : {})) {
      if (OUTPUT_ID.test(o) && o !== PRIMARY && scene.scenes.some(sc => sc.id === id)) scene.currentOut[o] = id;
    }
    ended = new Set((Array.isArray(saved.ended) ? saved.ended : []).filter(id => scene.sources.some(s => s.id === id)));
    wasOn = new Set(scene.sources.filter(s => s.visible).map(s => s.id));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'scene', `Could not read scene.json, starting with an empty scene: ${err.message}`);
    scene = { sources: [], scenes: [], current: null, currentOut: {} };
    ended = new Set();
  }
}

function save() {
  try { savefile.writeJsonSync(FILE, { sources: scene.sources.map(({ loadSeq, showSeq, outSeq, ...s }) => s), scenes: scene.scenes, current: scene.current, currentOut: scene.currentOut, ended: [...ended] }); }
  catch (err) { log('error', 'scene', `Could not save scene.json: ${err.message}`); }
  notify();
}
// Sends the scene to every open scene.html and Output page.
function notify() {
  videoSound();
  rev++;
  const json = JSON.stringify(state());
  const body = `data: ${json}\n\n`;
  for (const res of listeners) res.write(body);
  const frame = wsFrame(1, Buffer.from(json));
  for (const s of sockets) s.write(frame);
}

// The pages follow the scene over a WebSocket rather than server-sent events: a browser only keeps
// six ordinary connections open to Studio at once, and each scene.html (the preview, its pop out, the
// outputs) holding one used them up, so a click's request waited until a page closed. WebSockets
// don't count towards that. Just enough of the protocol for this: the server sends the scene as text,
// answers pings and closes.
function wsFrame(opcode, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}

// The http server's 'upgrade' event for /api/scene/socket: true when taken.
function upgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (new URL(req.url, 'http://localhost').pathname !== '/api/scene/socket' || !key) return false;
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  sockets.add(socket);
  const drop = () => { sockets.delete(socket); boardSockets.delete(socket); switcherSockets.delete(socket); socket.destroy(); };
  socket.on('close', drop);
  socket.on('error', drop);
  // Frames from the page (always masked): pings get a pong, a close is answered and ends it.
  let pending = Buffer.alloc(0);
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const opcode = pending[0] & 15;
      let len = pending[1] & 127, at = 2;
      if (len === 126) { if (pending.length < 4) return; len = pending.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (pending.length < 10) return; len = Number(pending.readBigUInt64BE(2)); at = 10; }
      const masked = pending[1] & 128;
      const end = at + (masked ? 4 : 0) + len;
      if (pending.length < end) return;
      const mask = masked ? pending.subarray(at, at + 4) : null;
      const payload = Buffer.from(pending.subarray(end - len, end));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      pending = pending.subarray(end);
      if (opcode === 8) { socket.end(wsFrame(8, Buffer.alloc(0))); sockets.delete(socket); return; }
      if (opcode === 9) socket.write(wsFrame(10, payload));
      if (opcode === 1) { // a text frame from the page: what it wants besides the scene
        let msg = null;
        try { msg = JSON.parse(payload.toString()); } catch { /* not for us */ }
        if (msg && msg.subscribe === 'board' && boardSource) { boardSockets.add(socket); socket.write(boardFrame(boardSource())); }
        if (msg && msg.subscribe === 'switcher' && switcherSource) { switcherSockets.add(socket); socket.write(switcherFrame(switcherSource())); }
      }
    }
  });
  socket.write(wsFrame(1, Buffer.from(JSON.stringify(state()))));
  return true;
}

function state() {
  // The other outputs' current scenes and changes by output id.
  const currentOut = {}, changedOut = {};
  for (const o of outputsApi.summary?.() || []) {
    if (o.id === PRIMARY) continue;
    const cur = currentScene(o.id);
    if (cur) { currentOut[o.id] = cur.id; changedOut[o.id] = changed(o.id); }
  }
  return { rev, width: WIDTH, height: HEIGHT, sources: scene.sources, scenes: orderedScenes(),
    current: currentScene() ? scene.current : null, currentOut, changed: changed(), changedOut,
    // The outputs, for the Stream Deck plugin's keys (each key acts on one, and lights in its colour).
    outputs: (outputsApi.summary?.() || []).map(({ id, slot, name, link, colour }) => ({ id, slot, name, link, colour })),
    converting: [...converting.keys()], ...sequences.state(), ...music.state() };
}

function find(ref) {
  const r = String(ref || '');
  return scene.sources.find(s => s.id === r) || scene.sources.find(s => slug(s.name) === slug(r)) || null;
}

// One change to the scene, from the Output page or the Stream Deck. Returns an error or null.
function apply(a) {
  const error = change(a);
  noteShowings();
  return error;
}
// Music gets out of the way while a video with its sound on plays, or a page playing a theme song (the intro and outro's
// ?theme=; its effects alone don't count).
const playsTheme = s => s.type === 'browser' && /[?&]theme=[^&]/.test(String(s.url || ''));
// A stinger with ?music=quiet or dip ducks the music as it comes on, by the time it covers the frame (0.22 of its length);
// dip brings it back up when it goes off.
function stingerMusic(s, on) {
  if (s.type !== 'browser' || !/^\/?stinger\.html(\?|$)/.test(String(s.url || ''))) return;
  const q = new URLSearchParams(String(s.url).split('?')[1] || '');
  const mode = q.get('music');
  if (mode !== 'quiet' && mode !== 'dip') return;
  const length = Math.min(3, Math.max(.5, parseFloat(q.get('length')) || 1));
  music.stinger(mode, on, Math.max(.2, .22 * length));
}
function videoSound() { music.videoSound(scene.sources.some(s => s.visible && ((s.type === 'video' && s.sound && !soundDone.has(s.id)) || playsTheme(s)))); }
function noteShowings() {
  videoSound();
  for (const s of scene.sources) if (s.visible !== wasOn.has(s.id)) stingerMusic(s, s.visible);
  for (const s of scene.sources) if (s.visible && !wasOn.has(s.id)) s.showSeq++;
  wasOn = new Set(scene.sources.filter(s => s.visible).map(s => s.id));
  for (const s of scene.sources) for (const o of Object.keys(s.out)) if (!wasOnOut.has(`${s.id}|${o}`)) s.outSeq[o] = (s.outSeq[o] || 0) + 1;
  wasOnOut = new Set(scene.sources.flatMap(s => Object.keys(s.out).map(o => `${s.id}|${o}`)));
}
let wasOnOut = new Set();

// The output a change is for: null for the primary (the source's own visible), an output's id for one of
// the others, or undefined if there's no such output.
function outputOf(a) {
  if (a.output === undefined || a.output === null || a.output === '' || a.output === PRIMARY) return null;
  const o = outputsApi.find(String(a.output));
  return !o ? undefined : o.id === PRIMARY ? null : o.id;
}
// A change to one source on an output other than the primary: on, off, toggle, ended (hides it there).
function changeOnOutput(a, src, out) {
  if (a.type === 'ended') {
    const seq = src.outSeq[out] || 0;
    if (!src.out[out] || Number(a.loadSeq) !== src.loadSeq || (a.showSeq !== undefined && Number(a.showSeq) !== seq)) return null;
    if (src.type === 'video' ? src.hideWhenDone && !src.loop : src.type === 'browser') {
      delete src.out[out];
      if (currentScene(out)?.states[src.id] === 'on') endedOf(out).add(src.id);
      log('info', 'scene', `"${src.name}" ${src.type === 'video' ? 'finished' : 'animated away'}, off on ${outputName(out)}`);
    }
    sequences.ended(src, out);
    return null;
  }
  const on = a.type === 'toggle' ? !src.out[out] : a.type === 'show';
  if (on) src.out[out] = true; else delete src.out[out];
  endedOf(out).delete(src.id);
  log('info', 'scene', `"${src.name}" ${on ? 'on' : 'off'} on ${outputName(out)}`);
  if (!on) sequences.turnedOff(src, out);
  return null;
}
const outputName = id => outputsApi.summary?.().find(o => o.id === id)?.name || 'another output';
// An output was removed: nothing is on for it any more.
function dropOutput(id) {
  let any = false;
  sequences.dropOutput(id);
  for (const s of scene.sources) if (s.out[id]) { delete s.out[id]; delete s.outSeq[id]; any = true; }
  if (scene.currentOut[id]) { delete scene.currentOut[id]; any = true; }
  endedOut.delete(id);
  // Its own ad sources go with it.
  for (const kind of Object.keys(AD_SOURCES)) if (find(adSourceId(kind, id))) { change({ type: 'remove', id: adSourceId(kind, id) }); any = true; }
  if (any) { noteShowings(); save(); }
}
function change(a) {
  const src = a.id || a.name ? find(a.id || a.name) : null;
  const need = () => src ? null : `No source "${a.id || a.name || ''}" in the scene.`;
  const out = outputOf(a);
  if (out === undefined) return `No output "${a.output}".`;
  if (out && ['show', 'hide', 'toggle', 'ended'].includes(a.type)) return need() || changeOnOutput(a, src, out);
  if (out && a.type === 'hideAll') {
    sequences.allOff(out);
    for (const s of scene.sources) delete s.out[out];
    clearEnded(out);
    log('info', 'scene', `Every source off on ${outputName(out)}`);
    return null;
  }
  // Scenes and sequences: a.output says which output they're played on (Go, Next, Play, Stop and the like).
  if (/^(scene|seq)/.test(a.type)) return applyScene({ ...a, output: out });
  if (out) return `"${a.type}" is for the primary output only.`;
  switch (a.type) {
    case 'add': {
      // One source (source) or several (sources, top first). New sources go on top, or just
      // above the source named by before (the one selected on the Output page).
      const list = (Array.isArray(a.sources) ? a.sources : [a.source]).filter(Boolean).slice(0, 100).map(x => clean({ ...x, visible: false }));
      if (!list.length) return 'Nothing to add.';
      const above = a.before ? find(a.before) : null;
      scene.sources.splice(above ? scene.sources.indexOf(above) : 0, 0, ...list);
      // A new source is off in every scene, so each scene still gives a known look.
      for (const sc of scene.scenes) for (const s of list) sc.states[s.id] = 'off';
      for (const s of list) log('info', 'scene', `Added ${s.type} source "${s.name}"${above ? ` above "${above.name}"` : ''}`);
      return null;
    }
    case 'update': {
      if (need()) return need();
      const i = scene.sources.indexOf(src);
      const { id, type, loadSeq, showSeq, ...changes } = a.changes || {};
      scene.sources[i] = clean(changes, src);
      return null;
    }
    case 'remove':
      if (need()) return need();
      scene.sources.splice(scene.sources.indexOf(src), 1);
      for (const sc of scene.scenes) delete sc.states[src.id];
      ended.delete(src.id);
      sequences.sourceRemoved(src.id);
      log('info', 'scene', `Removed source "${src.name}"`);
      return null;
    case 'move': {
      // up = one layer higher (earlier in the list), down = one lower; or to: an index.
      if (need()) return need();
      const from = scene.sources.indexOf(src);
      const to = a.to !== undefined ? clamp(a.to, 0, scene.sources.length - 1, from) : from + (a.direction === 'up' ? -1 : a.direction === 'down' ? 1 : 0);
      if (to < 0 || to >= scene.sources.length || to === from) return null;
      scene.sources.splice(from, 1);
      scene.sources.splice(to, 0, src);
      return null;
    }
    case 'show': case 'hide': case 'toggle':
      if (need()) return need();
      src.visible = a.type === 'toggle' ? !src.visible : a.type === 'show';
      ended.delete(src.id);
      soundDone.delete(src.id);
      log('info', 'scene', `"${src.name}" ${src.visible ? 'on' : 'off'}`);
      if (!src.visible) sequences.turnedOff(src);
      return null;
    case 'restart':
      if (need()) return need();
      src.loadSeq++;
      soundDone.delete(src.id);
      log('info', 'scene', `${src.type === 'video' ? 'Restarted' : 'Reloaded'} "${src.name}"`);
      return null;
    case 'soundOn': case 'soundOff': case 'soundToggle':
      if (need()) return need();
      if (src.type !== 'video') return `"${src.name}" has no sound to turn on or off.`;
      src.sound = a.type === 'soundToggle' ? !src.sound : a.type === 'soundOn';
      log('info', 'scene', `"${src.name}" sound ${src.sound ? 'on' : 'off'}`);
      return null;
    case 'ended': {
      // scene.html says a video finished (fade it out if it's set to hide when done) or a page animated
      // away (it only says so when it leaves the frame clear), and a sequence waiting for it moves on.
      // loadSeq and showSeq make sure it's this play that ended, not one from before a restart or from
      // the last time it was on.
      if (need()) return need();
      if (!src.visible || Number(a.loadSeq) !== src.loadSeq || (a.showSeq !== undefined && Number(a.showSeq) !== src.showSeq)) return null;
      if (src.type === 'video' ? src.hideWhenDone && !src.loop : src.type === 'browser') {
        src.visible = false;
        if (currentScene()?.states[src.id] === 'on') ended.add(src.id);
        log('info', 'scene', `"${src.name}" ${src.type === 'video' ? 'finished' : 'animated away'}, off`);
      } else if (src.type === 'video' && !src.loop) soundDone.add(src.id);
      sequences.ended(src);
      return null;
    }
    case 'hideAll':
      sequences.allOff();
      for (const s of scene.sources) s.visible = false;
      ended = new Set();
      log('info', 'scene', 'Every source off');
      return null;
    default:
      return applyScene(a);
  }
}

// The scenes in the order they're listed and Next and Previous go: by colour group, then name.
const orderedScenes = () => [...scene.scenes].sort(sequences.byColour);

// Changes to the scenes, and going to one. a.scene names the scene by id or name.
// a.output: the output (null for the primary) it's done on: Go, Again, Next, Previous, and saving what's on.
function applyScene(a) {
  const sc = a.scene ? findScene(a.scene) : null;
  const need = () => sc ? null : `No scene "${a.scene || ''}".`;
  const out = a.output || null;
  switch (a.type) {
    case 'sceneSave': {
      // A new scene from what's on now (it becomes the current scene), or from the states given, at the end of the list.
      const made = cleanScene({ name: a.name, colour: a.colour, states: a.states || liveStates(out) }, { id: newId() });
      scene.scenes.push(made);
      if (!a.states) { setCurrent(out, made.id); clearEnded(out); }
      log('info', 'scene', `Saved scene "${made.name}"`);
      return null;
    }
    case 'sceneUpdate': {
      // Name, colour, and states: 'on', 'off' or 'leave' for each source changed.
      if (need()) return need();
      const { id, ...changes } = a.changes || {};
      const states = { ...sc.states };
      for (const [k, v] of Object.entries(changes.states || {})) if (v === 'leave') delete states[k]; else states[k] = v;
      scene.scenes[scene.scenes.indexOf(sc)] = cleanScene({ ...changes, states }, sc);
      return null;
    }
    case 'sceneCapture': {
      // Saves what's on now over the scene. Sources it leaves as they are stay that way.
      if (need()) return need();
      for (const s of scene.sources) if (sc.states[s.id]) sc.states[s.id] = isOn(s, out) ? 'on' : 'off';
      if (currentScene(out) === sc) clearEnded(out);
      log('info', 'scene', `Saved what's on now over scene "${sc.name}"`);
      return null;
    }
    case 'sceneCopy': {
      if (need()) return need();
      const copy = cleanScene({ name: `${sc.name} copy`, colour: sc.colour, states: { ...sc.states } }, { id: newId() });
      scene.scenes.splice(scene.scenes.indexOf(sc) + 1, 0, copy);
      return null;
    }
    case 'sceneRemove':
      if (need()) return need();
      scene.scenes.splice(scene.scenes.indexOf(sc), 1);
      if (scene.current === sc.id) { scene.current = null; ended = new Set(); }
      for (const [o, id] of Object.entries(scene.currentOut)) if (id === sc.id) { delete scene.currentOut[o]; endedOut.delete(o); }
      log('info', 'scene', `Deleted scene "${sc.name}"`);
      return null;
    case 'sceneMove': {
      // up = earlier in the list (where Previous goes), down = later; or to: an index.
      if (need()) return need();
      const from = scene.scenes.indexOf(sc);
      const to = a.to !== undefined ? clamp(a.to, 0, scene.scenes.length - 1, from) : from + (a.direction === 'up' ? -1 : a.direction === 'down' ? 1 : 0);
      if (to < 0 || to >= scene.scenes.length || to === from) return null;
      scene.scenes.splice(from, 1);
      scene.scenes.splice(to, 0, sc);
      return null;
    }
    case 'sceneGo':
      if (need()) return need();
      goTo(sc, false, false, out);
      return null;
    case 'sceneAgain': {
      const cur = currentScene(out);
      if (!cur) return 'There is no current scene to go back to.';
      goTo(cur, false, false, out);
      return null;
    }
    case 'sceneNext': case 'scenePrev': {
      // Stops at the ends, from the output's current scene. With no current scene, Next goes to the first and Previous to the last.
      const list = orderedScenes();
      if (!list.length) return 'There are no scenes.';
      const i = list.indexOf(currentScene(out));
      const to = i < 0 ? (a.type === 'sceneNext' ? 0 : list.length - 1) : i + (a.type === 'sceneNext' ? 1 : -1);
      if (to >= 0 && to < list.length) goTo(list[to], false, false, out);
      return null;
    }
    default: {
      let error = sequences.apply(a);
      if (error === undefined) error = music.apply(a);
      return error === undefined ? `Unknown scene change "${a.type}".` : error;
    }
  }
}

// /deck/layer/<name>/on|off|toggle|restart, /deck/layer/<name>/sound/on|off|toggle,
// /deck/layers/off and /deck/scene/<name>|next|prev|again. Returns null when the link
// isn't a scene link, so the scoreboard's own links carry on as before.
function deck(parts, q = {}) {
  // /deck/output/<output>/layer/... and /deck/output/<output>/layers/off: one output's sources. The
  // primary's are the plain /deck/layer/... links.
  if (parts[0] === 'output' && ['layer', 'layers', 'scene', 'sequence'].includes(parts[2])) {
    const o = outputsApi.find(parts[1]);
    if (!o) return { status: 404, body: { error: `No output "${parts[1]}". Use its name or number, as on the Output page.` } };
    if (o.id === PRIMARY) return deck(parts.slice(2), q);
    // /deck/output/<output>/scene/<name>|next|prev|again and /deck/output/<output>/sequence/...
    if (parts[2] === 'scene') {
      if (!parts[3] || parts.length !== 4) return { status: 404, body: { error: `Use /deck/output/${parts[1]}/scene/<name>, next, prev or again.` } };
      const type = { next: 'sceneNext', prev: 'scenePrev', previous: 'scenePrev', again: 'sceneAgain' }[parts[3]];
      const error = apply(type ? { type, output: o.id } : { type: 'sceneGo', scene: parts[3], output: o.id });
      if (error) return { status: 404, body: { error } };
      save();
      const cur = currentScene(o.id);
      return { status: 200, body: { ok: true, output: outputName(o.id), scene: cur ? cur.name : null, changed: changed(o.id).length } };
    }
    if (parts[2] === 'sequence') {
      const r = sequences.deck(parts.slice(2), o.id);
      if (!r) return null;
      if (r.error) return { status: r.status, body: { error: r.error } };
      save();
      return { status: 200, body: { ...r.body, output: outputName(o.id) } };
    }
    const [, , w, n, v] = parts;
    let action = null;
    if (w === 'layers' && n === 'off' && parts.length === 4) action = { type: 'hideAll', output: o.id };
    const type = { on: 'show', show: 'show', off: 'hide', hide: 'hide', toggle: 'toggle' }[v];
    if (w === 'layer' && n && type && parts.length === 5) action = { type, name: n, output: o.id };
    if (w === 'layer' && n && (v === 'restart' || v === 'reload') && parts.length === 5) action = { type: 'restart', name: n };
    if (!action) return { status: 404, body: { error: `Use /deck/output/${parts[1]}/layer/<source>/on, off, toggle or restart, or /deck/output/${parts[1]}/layers/off.` } };
    const error = apply(action);
    if (error) return { status: 404, body: { error } };
    save();
    const src = action.name ? find(action.name) : null;
    return { status: 200, body: { ok: true, output: outputName(o.id), ...(src ? { name: src.name, visible: !!src.out[o.id] } : {}) } };
  }
  const [what, name, verb] = parts;
  if (what === 'music') {
    const r = music.deck(parts, q);
    if (!r) return null;
    if (r.error) return { status: r.status, body: { error: r.error } };
    notify();
    return { status: 200, body: r.body };
  }
  // /deck/sponsor/ad: the next sponsor ad, by hand. A video plays to its end and goes off; a still stays
  // for its seconds. It isn't part of a sequence, so a sequence playing carries on.
  if (what === 'sponsor' && name === 'ad' && !verb) {
    const ad = sponsorAd({ house: false });
    if (!ad) return { status: 404, body: { error: 'No sponsor of the competition in use has an ad to play. Add ads on the Sponsors page.' } };
    const src = find(ad.source);
    if (src.visible) { src.loadSeq++; soundDone.delete(src.id); } else apply({ type: 'show', id: src.id });
    if (ad.length.type === 'time') {
      clearTimeout(stillTimer);
      const file = src.file, load = src.loadSeq;
      stillTimer = setTimeout(() => { if (src.visible && src.file === file && src.loadSeq === load) { apply({ type: 'hide', id: src.id }); save(); } }, ad.length.sec * 1000);
    }
    save();
    return { status: 200, body: { ok: true, sponsor: ad.name, source: src.name } };
  }
  if (what === 'sequence') {
    const r = sequences.deck(parts);
    if (!r) return null;
    if (r.error) return { status: r.status, body: { error: r.error } };
    save();
    return { status: 200, body: r.body };
  }
  let action = null;
  if (what === 'layers' && name === 'off') action = { type: 'hideAll' };
  if (what === 'scene' && name && !verb) {
    action = { next: { type: 'sceneNext' }, prev: { type: 'scenePrev' }, previous: { type: 'scenePrev' }, again: { type: 'sceneAgain' } }[name]
      || { type: 'sceneGo', scene: name };
  }
  if (what === 'layer' && name) {
    const type = { on: 'show', show: 'show', off: 'hide', hide: 'hide', toggle: 'toggle', restart: 'restart', reload: 'restart' }[verb];
    if (type) action = { type, name };
    const sound = { on: 'soundOn', off: 'soundOff', toggle: 'soundToggle' }[parts[3]];
    if (verb === 'sound' && sound) action = { type: sound, name };
  }
  if (!action) return null;
  const error = apply(action);
  if (error) return { status: 404, body: { error } };
  save();
  if (what === 'scene') {
    const cur = currentScene();
    return { status: 200, body: { ok: true, scene: cur ? cur.name : null, changed: changed().length } };
  }
  const src = action.name ? find(action.name) : null;
  return { status: 200, body: { ok: true, ...(src ? { name: src.name, visible: src.visible, ...(src.type === 'video' ? { sound: src.sound } : {}) } : {}) } };
}

// ─── Media folder ─────────────────────────────────────────────────────────
const converting = new Map(); // .mov file -> its WebM, while ffmpeg runs
const opaque = new Map(); // .mov file -> its video codec, when it had no transparency to keep
// Pixel formats that carry alpha, as ffmpeg names them (ProRes 4444 with alpha is yuva444p12le).
const HAS_ALPHA = /^(yuva|gbrap|ya\d)|rgba|argb|bgra|abgr|ayuv/;
let ffmpegSetting = '';

// ffmpeg from config.json's ffmpegPath, else the one the Mac app bundles (vendor/ffmpeg,
// built by vendor/ffmpeg/build.sh), else Homebrew's, else the PATH.
const BUNDLED_FFMPEG = unpacked(path.join(__dirname, 'vendor', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
function ffmpegPath() {
  const candidates = [ffmpegSetting, BUNDLED_FFMPEG, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg',
    ...String(process.env.PATH || '').split(path.delimiter).map(d => path.join(d, 'ffmpeg'))];
  return candidates.find(c => { try { return c && fs.statSync(c).isFile(); } catch { return false; } }) || null;
}
const webmFor = f => path.basename(f, path.extname(f)) + '.webm';

// How long each video is, in seconds, from ffmpeg (null until it's been measured). A sequence's
// Until it finishes step waits that long at most, and the Output page shows it.
const durations = new Map(); // file -> { mtimeMs, sec } (sec null while measuring or if ffmpeg couldn't tell)
function duration(name) {
  const file = path.join(MEDIA_DIR, cleanFile(name));
  let mtimeMs;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch { return null; }
  const known = durations.get(name);
  if (known && known.mtimeMs === mtimeMs) return known.sec;
  const bin = ffmpegPath();
  if (!bin) return null;
  durations.set(name, { mtimeMs, sec: null });
  let out = '';
  const child = require('child_process').spawn(bin, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', d => { if (out.length < 20000) out += d; });
  child.on('error', () => {});
  child.on('close', () => {
    const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
    if (!m) return;
    durations.set(name, { mtimeMs, sec: Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 10) / 10 });
    notify();
  });
  return null;
}

function mediaList() {
  let files = [];
  try { files = fs.readdirSync(MEDIA_DIR).filter(f => kindOf(f) && !f.startsWith('.')).sort((a, b) => a.localeCompare(b)); } catch { /* none yet */ }
  return files.map(name => {
    const m = { name, kind: kindOf(name) };
    try { m.size = fs.statSync(path.join(MEDIA_DIR, name)).size; } catch { /* just gone */ }
    if (m.kind === 'video' || m.kind === 'audio') m.duration = duration(name);
    if (m.kind === 'audio') {
      if (converting.has(name)) m.converting = true;
      if (levelled(name)) m.levelled = true;
    }
    if (path.extname(name).toLowerCase() === '.mov') {
      if (converting.has(name)) m.converting = true;
      else if (files.includes(webmFor(name))) m.converted = webmFor(name);
      if (opaque.has(name)) m.opaque = opaque.get(name);
    }
    return m;
  });
}

// ─── Removing media ──────────────────────────────────────────────────────
// Where a media file is used: sources showing it, pages playing it as their ?theme=, the sequences (of every
// competition) whose music it is, the music player's playlists, super shot song and queue, and sponsors' ads.
// onAir marks a use that's on screen or playing now, which stops it being removed.
// A sequence names its track by file, or as a link spells it (music.js findTrack), which a file of that exact name wins.
const sameTrack = (ref, file) => ref === file || (!fs.existsSync(path.join(MEDIA_DIR, cleanFile(ref))) && slug(String(ref).replace(/\.[^.]+$/, '')) === slug(file.replace(/\.[^.]+$/, '')));
function sequenceFiles() {
  const files = new Map([[sequences.file(), null], [datadir.file('sequences.json'), null]]);
  for (const c of competitions.list()) files.set(path.join(competitions.DIR, c.id, 'sequences.json'), c.name);
  return [...files].filter(([f]) => f);
}
function mediaUses(file) {
  const uses = [];
  const ads = new Set(Object.values(AD_SOURCES).map(a => a.id));
  for (const s of scene.sources) {
    // The Sponsor ad sources hold whichever ad played last: only one on screen counts.
    if (s.type !== 'browser' && s.file === file && (!ads.has(s.id) || s.visible)) uses.push({ type: 'source', name: s.name, onAir: s.visible });
    if (s.type === 'browser') {
      let theme = '';
      try { theme = new URL(String(s.url || ''), 'http://studio/').searchParams.get('theme') || ''; } catch { /* not an address */ }
      if (theme === file) uses.push({ type: 'theme', name: s.name, onAir: s.visible });
    }
  }
  if (kindOf(file) === 'audio') {
    const seen = new Set();
    for (const [f, competition] of sequenceFiles()) {
      let list = [];
      try { list = JSON.parse(fs.readFileSync(f, 'utf8')).sequences || []; } catch { continue; }
      for (const sq of list) {
        const key = `${competition} ${sq.id}`;
        if (sq && sq.music && sq.music.track && !sq.music.playlist && sameTrack(sq.music.track, file) && !seen.has(key)) {
          seen.add(key);
          uses.push({ type: 'sequence', name: sq.name, ...(competition ? { competition } : {}) });
        }
      }
    }
    uses.push(...music.uses(file));
  }
  uses.push(...sponsors.adUses(file));
  return uses;
}
// Removes a file from the media folder (with a levelled song's original, and a .mov's WebM only if asked
// separately). Lists keeping it (playlists, the super shot song, sponsors' ads) let go of it; sources, page
// themes and sequence music keep its name and show it as missing, so their settings and Stream Deck keys stay
// for a replacement. Returns { error, status, uses } when it can't.
function removeMedia(file, force) {
  if (!file || file.startsWith('.') || !kindOf(file) || !fs.existsSync(path.join(MEDIA_DIR, file))) return { status: 404, error: `No ${file} in the media folder.` };
  if (converting.has(file) || [...converting.values()].includes(file)) return { status: 409, error: `${file} is still being converted. Try again once it's done.` };
  const uses = mediaUses(file);
  if (uses.some(u => u.onAir)) return { status: 409, error: `${file} is on air now. Turn it off (or stop the music) first.`, uses };
  if (uses.length && !force) return { status: 409, error: `${file} is still used. Remove it anyway with force=1.`, uses };
  fs.rmSync(path.join(MEDIA_DIR, file), { force: true });
  if (kindOf(file) === 'audio') {
    try { for (const f of fs.readdirSync(ORIGINALS)) if (path.basename(f, path.extname(f)) === path.basename(file, path.extname(file))) fs.rmSync(path.join(ORIGINALS, f), { force: true }); } catch { /* no originals */ }
    music.forget(file);
  }
  try { sponsors.dropAd(file); } catch (err) { log('warn', 'scene', `Kept ${file} in the sponsors' ads: ${err.message}`); }
  durations.delete(file);
  opaque.delete(file);
  log('info', 'scene', `Removed ${file} from the media folder${uses.length ? ` (it was used by ${uses.map(u => `${u.type} ${u.name}`).join(', ')})` : ''}`);
  notify();
  return { uses };
}

// Converts a .mov (ProRes 4444 keeps its transparency) to a VP9 WebM Chromium can play.
function convert(name) {
  const bin = ffmpegPath();
  if (!bin) { log('warn', 'scene', `Can't convert ${name}: no ffmpeg. The Mac app has its own; from a checkout run vendor/ffmpeg/build.sh or brew install ffmpeg, or set ffmpegPath in config.json`); return false; }
  if (converting.has(name)) return true;
  const out = webmFor(name), part = path.join(MEDIA_DIR, `.${out}.part`);
  converting.set(name, out);
  const started = Date.now();
  log('info', 'scene', `Converting ${name} to ${out} with ${bin}`);
  const args = ['-hide_banner', '-loglevel', 'info', '-nostats', '-y', '-i', path.join(MEDIA_DIR, name),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '20', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-auto-alt-ref', '0',
    '-c:a', 'libopus', '-b:a', '192k', '-f', 'webm', part];
  const child = require('child_process').spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '', head = '';
  child.stderr.on('data', d => {
    if (head.length < 8000) head += d;
    errors = (errors + d).slice(-2000);
  });
  // What the .mov holds, from ffmpeg's description of its first video stream.
  const source = () => {
    const m = /Stream #\d+:\d+[^\n]*?: Video: (\w+)[^\n]*?, (\w+)[(,\s]/.exec(head);
    return m ? { codec: m[1], pixels: m[2] } : null;
  };
  const finish = ok => {
    converting.delete(name);
    if (ok) {
      fs.renameSync(part, path.join(MEDIA_DIR, out));
      const src = source();
      log('info', 'scene', `Converted ${name} (${src ? `${src.codec}, ${src.pixels}` : 'unknown video'}) to ${out} in ${Math.round((Date.now() - started) / 1000)}s`);
      if (src && !HAS_ALPHA.test(src.pixels)) {
        opaque.set(name, src.codec);
        log('warn', 'scene', `${name} has no transparency (${src.codec}, ${src.pixels}), so ${out} won't either. Export it as Apple ProRes 4444 with alpha to keep it.`);
      } else opaque.delete(name);
      // Sources using the .mov switch to the WebM.
      let changed = false;
      for (const s of scene.sources) if (s.type === 'video' && s.file === name) { s.file = out; changed = true; }
      if (changed) save();
    } else {
      try { fs.unlinkSync(part); } catch { /* nothing written */ }
      log('error', 'scene', `Could not convert ${name}`, errors.trim());
    }
    notify();
  };
  child.on('error', err => { errors = err.message; finish(false); });
  child.on('close', code => { if (converting.has(name)) finish(code === 0); });
  return true;
}

// Evens out a song's loudness (EBU R128, -16 LUFS, like streaming services) into an M4A beside it, so
// tracks from different places play at the same level. The original is kept in media/originals.
const ORIGINALS = path.join(MEDIA_DIR, 'originals');
const levelled = name => { try { return fs.readdirSync(ORIGINALS).some(f => path.basename(f, path.extname(f)) === path.basename(name, path.extname(name))); } catch { return false; } };
function level(name) {
  const bin = ffmpegPath();
  if (!bin) { log('warn', 'scene', `Can't even out the loudness of ${name}: no ffmpeg`); return false; }
  const out = path.basename(name, path.extname(name)) + '.m4a', part = path.join(MEDIA_DIR, `.${out}.part`);
  fs.mkdirSync(ORIGINALS, { recursive: true });
  const original = path.join(ORIGINALS, name);
  fs.renameSync(path.join(MEDIA_DIR, name), original);
  converting.set(out, out);
  const started = Date.now();
  log('info', 'scene', `Evening out the loudness of ${name} into ${out}`);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-i', original, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-f', 'mp4', part];
  const child = require('child_process').spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', d => { errors = (errors + d).slice(-2000); });
  const finish = ok => {
    if (!converting.has(out)) return;
    converting.delete(out);
    if (ok) {
      fs.renameSync(part, path.join(MEDIA_DIR, out));
      log('info', 'scene', `Evened out ${name} into ${out} in ${Math.round((Date.now() - started) / 1000)}s (the original is in media/originals)`);
    } else {
      fs.rm(part, { force: true }, () => {});
      // Put the original back as it was.
      try { fs.renameSync(original, path.join(MEDIA_DIR, name)); } catch { /* left in originals */ }
      log('error', 'scene', `Could not even out the loudness of ${name}; kept it as it was`, errors.trim());
    }
    notify();
  };
  child.on('error', err => { errors = err.message; finish(false); });
  child.on('close', code => finish(code === 0));
  return out;
}

// Saves an upload straight to disk (videos can be gigabytes), then converts a .mov.
function saveUpload(req, name, max) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const part = path.join(MEDIA_DIR, `.${name}.part`);
    const out = fs.createWriteStream(part);
    let size = 0;
    req.on('data', d => { size += d.length; if (size > max) { req.destroy(); out.destroy(); fs.rm(part, { force: true }, () => {}); reject(new Error(`That file is over ${Math.round(max / 1048576)} MB.`)); } });
    req.pipe(out);
    out.on('finish', () => { if (size <= max) { fs.renameSync(part, path.join(MEDIA_DIR, name)); resolve(size); } });
    out.on('error', reject);
    req.on('error', reject);
  });
}

// Sends a media file, with byte ranges so videos can seek and loop. A range runs to at most MEDIA_CHUNK, and the
// browser asks for the next piece when it wants it: a video given the rest of the file reads it until its buffer is
// full and then holds the connection open, and a browser has only six to Studio. With three outputs and the Scene
// View each holding a few videos, every Studio page's requests waited (Next and Play took 15 s or more).
const MEDIA_CHUNK = 2 * 1024 * 1024;
function sendMedia(req, res, file, type, send) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = st.size - 1, status = 200;
    if (m && (m[1] || m[2])) {
      start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
      status = 206;
      end = Math.min(end, start + MEDIA_CHUNK - 1);
    }
    res.writeHead(status, { 'content-type': type, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'no-store',
      ...uploads.SERVE_HEADERS, ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${st.size}` } : {}) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

// ─── Export and import ────────────────────────────────────────────────────
// The export is a zip: scene.json (the sources, as the data folder keeps them) and, unless asked
// not to, a media/ folder with the images and videos the sources use. Importing one replaces the
// scene's sources, every one hidden, and copies its media in; a plain scene.json imports too.
// An export with scenes replaces the scenes too. One without (from before scenes) keeps the
// scenes there are, dropping sources that have gone; a source new to them is off in each.
const VERSION = (() => { try { return require('./package.json').version; } catch { return ''; } })();

function exportFiles(withMedia) {
  const sources = scene.sources.map(({ loadSeq, showSeq, ...s }) => s);
  const files = [{ name: 'scene.json', data: Buffer.from(JSON.stringify({ studio: VERSION, exported: new Date().toISOString(), sources, scenes: scene.scenes }, null, 2) + '\n') }];
  const missing = [];
  if (withMedia) {
    for (const f of new Set(sources.filter(s => s.file).map(s => s.file))) {
      const file = path.join(MEDIA_DIR, f);
      if (fs.existsSync(file)) files.push({ name: `media/${f}`, file }); else missing.push(f);
    }
  }
  return { files, missing };
}

// Compared by checksum, so a file already in the media folder isn't copied in twice.
const sha1 = f => new Promise((ok, fail) => { const h = crypto.createHash('sha1'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', fail); });
const sameFile = async (a, b) => fs.statSync(a).size === fs.statSync(b).size && await sha1(a) === await sha1(b);

// Imports an uploaded export (saved at file). Returns { sources, scenes, copied, missing }.
async function importFile(file) {
  const zip = require('./zip');
  const head = Buffer.alloc(2);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 2, 0);
  fs.closeSync(fd);
  let saved, list = [];
  if (head.toString('latin1') === 'PK') {
    list = zip.entries(file);
    // The scene.json at the top, or in the one folder Finder adds when it zips a folder.
    const json = list.find(e => /^([^/]+\/)?scene\.json$/i.test(e.name) && !e.name.startsWith('__MACOSX'));
    if (!json) throw new Error("There's no scene.json in that zip. Pick a file made with Export on the Output page.");
    const chunks = [];
    for await (const c of zip.open(file, json)) chunks.push(c);
    saved = Buffer.concat(chunks).toString('utf8');
  } else if (fs.statSync(file).size > 10 * 1024 * 1024) throw new Error("That isn't a scene export. Pick the .zip (or scene.json) made with Export on the Output page.");
  else saved = fs.readFileSync(file, 'utf8');
  let parsed;
  try { parsed = JSON.parse(saved); } catch { throw new Error("That isn't a scene export: its scene.json can't be read."); }
  if (!parsed || !Array.isArray(parsed.sources)) throw new Error("That isn't a scene export: it has no sources.");

  // Media: each file the zip has goes in the media folder. One already there with the same name
  // and contents is used as it is; one with the same name but different contents is kept under a
  // new name, so nothing in the media folder is overwritten.
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const renamed = new Map(), copied = [];
  for (const e of list) {
    const m = /^(?:[^/]+\/)?media\/([^/]+)$/.exec(e.name);
    if (!m || e.name.startsWith('__MACOSX') || m[1].startsWith('.') || !kindOf(m[1])) continue;
    const name = cleanFile(m[1]);
    const part = path.join(MEDIA_DIR, `.import-${name}.part`);
    await new Promise((resolve, reject) => zip.open(file, e).on('error', reject).pipe(fs.createWriteStream(part)).on('finish', resolve).on('error', reject));
    let target = name;
    for (let i = 2; fs.existsSync(path.join(MEDIA_DIR, target)); i++) {
      if (await sameFile(part, path.join(MEDIA_DIR, target))) break;
      target = `${path.basename(name, path.extname(name))} (${i})${path.extname(name)}`;
    }
    if (fs.existsSync(path.join(MEDIA_DIR, target))) fs.unlinkSync(part);
    else { fs.renameSync(part, path.join(MEDIA_DIR, target)); copied.push(target); }
    if (target !== name) renamed.set(name, target);
  }

  const sources = [];
  const before = new Set(scene.sources.map(s => s.id));
  const ids = new Map(); // the export's source id -> the id it has now
  scene.sources = [];
  for (const s of parsed.sources.slice(0, 500)) {
    if (!s || typeof s !== 'object') continue;
    const src = clean({ ...s, visible: false, file: renamed.get(cleanFile(s.file)) || s.file });
    // Two sources with the same id (an export edited by hand) would fight over Stream Deck keys.
    if (scene.sources.some(x => x.id === src.id)) src.id = newId();
    if (s.id && !ids.has(String(s.id))) ids.set(String(s.id), src.id);
    scene.sources.push(src);
    sources.push(src);
  }
  if (Array.isArray(parsed.scenes)) {
    scene.scenes = [];
    for (const sc of parsed.scenes.slice(0, 200)) {
      if (!sc || typeof sc !== 'object') continue;
      const states = Object.fromEntries(Object.entries(sc.states && typeof sc.states === 'object' ? sc.states : {}).map(([k, v]) => [ids.get(k) || k, v]));
      const made = cleanScene({ ...sc, states });
      if (scene.scenes.some(x => x.id === made.id)) made.id = newId();
      scene.scenes.push(made);
    }
  } else {
    scene.scenes = scene.scenes.map(sc => {
      const kept = cleanScene({}, sc);
      for (const s of sources) if (!before.has(s.id)) kept.states[s.id] = 'off';
      return kept;
    });
  }
  scene.current = null;
  scene.currentOut = {};
  ended = new Set();
  endedOut.clear();
  const missing = [...new Set(sources.filter(s => s.file && !fs.existsSync(path.join(MEDIA_DIR, s.file))).map(s => s.file))];
  // A .mov the sources play that hasn't been converted yet starts converting now.
  for (const f of new Set(sources.filter(s => s.type === 'video' && /\.mov$/i.test(s.file)).map(s => s.file))) {
    if (fs.existsSync(path.join(MEDIA_DIR, f)) && !fs.existsSync(path.join(MEDIA_DIR, webmFor(f)))) convert(f);
  }
  log('info', 'scene', `Imported a scene with ${sources.length} sources${Array.isArray(parsed.scenes) ? ` and ${scene.scenes.length} scenes` : ''}${parsed.studio ? ` (exported from Studio ${parsed.studio}${parsed.exported ? ` on ${parsed.exported}` : ''})` : ''}`
    + `${copied.length ? `, copied ${copied.join(', ')} to the media folder` : ''}${missing.length ? `; missing media ${missing.join(', ')}` : ''}`);
  return { sources: sources.length, scenes: Array.isArray(parsed.scenes) ? scene.scenes.length : null, copied, missing };
}

// The scene's HTTP routes: /api/scene, /api/scene/events, /api/scene/media (GET, POST and DELETE), /api/scene/export and
// /api/scene/import, and /media/<file>.
// Returns false for anything else.
async function route(req, res, url, { send, readBody }) {
  const p = url.pathname;
  if (p === '/api/scene' && req.method === 'GET') return send(res, 200, state()), true;
  if (p === '/api/scene' && req.method === 'POST') {
    const error = apply(await readBody(req));
    if (error) return send(res, 400, { error }), true;
    save();
    return send(res, 200, state()), true;
  }
  if (p === '/api/scene/events') {
    // Server-sent events: the whole scene now, then again on every change, for the Stream Deck
    // plugin (Studio's own pages use the WebSocket below instead).
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`retry: 1000\ndata: ${JSON.stringify(state())}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); });
    return true;
  }
  if (p === '/api/scene/export' && req.method === 'GET') {
    const { files, missing } = exportFiles(url.searchParams.get('media') !== '0');
    if (missing.length) log('warn', 'scene', `Exporting the scene without ${missing.join(', ')}: not in the media folder`);
    const day = new Date();
    const name = `FirstPass Studio scene ${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.zip`;
    res.writeHead(200, { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${name}"` });
    try {
      await require('./zip').write(res, files);
      log('info', 'scene', `Exported the scene: ${scene.sources.length} sources, ${scene.scenes.length} scenes and ${files.length - 1} media files`);
    } catch (err) { log('warn', 'scene', `Scene export stopped: ${err.message}`); res.destroy(); }
    return true;
  }
  if (p === '/api/scene/import' && req.method === 'POST') {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const upload = `.import-${newId()}.part`;
    try {
      await saveUpload(req, upload, MAX_VIDEO * 2);
      const result = await importFile(path.join(MEDIA_DIR, upload));
      save();
      return send(res, 200, { ...result, media: mediaList() }), true;
    } catch (err) {
      log('warn', 'scene', `Could not import the scene: ${err.message}`);
      return send(res, 400, { error: err.message }), true;
    } finally {
      fs.rm(path.join(MEDIA_DIR, upload), { force: true }, () => {});
      for (const f of fs.readdirSync(MEDIA_DIR)) if (/^\.import-.*\.part$/.test(f) && f !== upload) fs.rm(path.join(MEDIA_DIR, f), { force: true }, () => {});
    }
  }
  if (p === '/api/scene/streamdeck' && req.method === 'GET') return send(res, 200, { available: fs.existsSync(STREAMDECK_PLUGIN) }), true;
  if (p === '/api/scene/streamdeck' && req.method === 'POST') {
    // Opening the .streamDeckPlugin file hands it to the Stream Deck app, which installs (or updates) it.
    if (!fs.existsSync(STREAMDECK_PLUGIN)) return send(res, 404, { error: 'The Stream Deck plugin comes with the Mac app. From a checkout, run npm run pack in plugins/studio-deck first.' }), true;
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', STREAMDECK_PLUGIN]] : ['open', [STREAMDECK_PLUGIN]];
    require('child_process').spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', err => log('warn', 'scene', `Couldn't open the Stream Deck plugin: ${err.message}`)).unref();
    log('info', 'scene', 'Opened the Stream Deck plugin to install it');
    return send(res, 200, { ok: true }), true;
  }
  if (p === '/api/scene/media' && req.method === 'GET') {
    const media = mediaList();
    if (url.searchParams.get('uses') === '1') for (const m of media) m.uses = mediaUses(m.name);
    return send(res, 200, { media, canConvert: !!ffmpegPath() }), true;
  }
  if (p === '/api/scene/media' && req.method === 'DELETE') {
    const name = cleanFile(url.searchParams.get('name'));
    const out = removeMedia(name, url.searchParams.get('force') === '1');
    if (out.error) return send(res, out.status, { error: out.error, uses: out.uses || [] }), true;
    return send(res, 200, { removed: name, uses: out.uses, media: mediaList() }), true;
  }
  if (p === '/api/scene/media' && req.method === 'POST') {
    const name = cleanFile(url.searchParams.get('name')).replace(/[^\w .()'&+-]/g, '_').replace(/^\.+/, '');
    const kind = name && kindOf(name);
    if (!kind) return send(res, 400, { error: 'Pick a PNG, JPG, GIF, WebP or SVG image, an MP4, WebM or MOV video, or an MP3, M4A, AAC, WAV or AIFF song.' }), true;
    const size = await saveUpload(req, name, kind === 'video' ? MAX_VIDEO : kind === 'audio' ? MAX_AUDIO : MAX_IMAGE);
    if (kind === 'image') {
      // An image whose bytes aren't what its name says goes straight back out.
      const head = Buffer.alloc(4096);
      const fd = fs.openSync(path.join(MEDIA_DIR, name), 'r');
      const n = fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
      if (!uploads.looksLikeImage(name, head.subarray(0, n))) {
        fs.rmSync(path.join(MEDIA_DIR, name), { force: true });
        return send(res, 400, { error: `${name} isn't a ${path.extname(name).slice(1).toUpperCase()} file inside (its first bytes don't match). Export it again from the image program, or rename it to what it really is.` }), true;
      }
    }
    log('info', 'scene', `Saved ${name} to the media folder (${Math.round(size / 1024)} KB)`);
    // Songs are evened out unless the Output page's tick box says not to.
    if (kind === 'audio' && url.searchParams.get('level') !== '0') {
      const out = level(name);
      if (out) return send(res, 200, { file: out, converting: true, media: mediaList() }), true;
    }
    const converted = path.extname(name).toLowerCase() === '.mov' ? convert(name) : null;
    return send(res, 200, { file: name, converting: !!converted, cantConvert: converted === false, media: mediaList() }), true;
  }
  if (p === '/api/scene/convert' && req.method === 'POST') {
    const name = cleanFile(url.searchParams.get('name'));
    if (path.extname(name).toLowerCase() !== '.mov' || !fs.existsSync(path.join(MEDIA_DIR, name))) return send(res, 404, { error: `No ${name} in the media folder.` }), true;
    if (!convert(name)) return send(res, 409, { error: 'There is no ffmpeg to convert it with. The Mac app has its own; from a copy of the code, run vendor/ffmpeg/build.sh or brew install ffmpeg, then try again.' }), true;
    return send(res, 200, { converting: true, media: mediaList() }), true;
  }
  if (p.startsWith('/media/')) {
    const file = cleanFile(decodeURIComponent(p.slice(7)));
    const type = MEDIA_TYPES[path.extname(file).toLowerCase()];
    if (!type || file.startsWith('.')) return send(res, 404, 'Not found', 'text/plain'), true;
    sendMedia(req, res, path.join(MEDIA_DIR, file), type, send);
    return true;
  }
  return false;
}

// outputs: outputs.js's find and summary, for the outputs besides the primary.
function init(logger, { ffmpeg, sequencesFile, outputs } = {}) {
  log = logger || log;
  if (outputs) outputsApi = outputs;
  ffmpegSetting = ffmpeg || '';
  load();
  music.init(log, {
    duration: file => duration(file),
    files: () => mediaList().filter(m => m.kind === 'audio' && !m.converting).map(m => m.name),
    changed: () => save(),
  });
  sequences.init(log, {
    source: id => scene.sources.find(s => s.id === id) || null,
    isOn: (s, out) => isOn(s, out === PRIMARY ? null : out),
    setOn: (s, on, out) => { const o = out === PRIMARY ? null : out; setOn(s, on, o); endedOf(o).delete(s.id); },
    hasOutput: id => outputsApi.find(id)?.id === id,
    scene: id => scene.scenes.find(s => s.id === id) || null,
    goTo: (sc, step, out) => goTo(sc, true, step, out === PRIMARY ? null : out),
    duration,
    sponsorAd: (opts, out) => sponsorAd(opts, out === PRIMARY ? null : out),
    // A step's time ran out: sources it turned on are new showings too.
    changed: () => { noteShowings(); save(); },
  }, sequencesFile);
  if (scene.sources.length) log('info', 'scene', `Scene has ${scene.sources.length} sources`);
}

// The competition in use changed (or its setup was saved): load its sequences if it's another one.
function competitionChanged() { if (sequences.reload()) notify(); }

// The scoreboard, each second, for the sequences' game triggers (sequences.js game()) and the super shot song.
function game(snapshot) {
  sequences.game(snapshot);
  if (music.superShotPeriod(snapshot)) notify();
}

module.exports = { STREAMDECK_PLUGIN, dropOutput, cleanUrl, mediaUses, removeMedia, importFile, exportFiles, init, route, upgrade, deck, apply, state, showing, slug, competitionChanged, game, setBoardSource, publishBoard, setSwitcherSource, publishSwitcher, FILE, MEDIA_DIR };
