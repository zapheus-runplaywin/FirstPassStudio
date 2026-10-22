// FirstPass Studio - the scene: sources drawn as layers on one frame, built on the Output page.
//
// One scene, a list of sources drawn as layers, top layer first: Studio pages (or any web
// address), and images and videos from the media folder. Each source can be shown and hidden with its
// own fade, and placed and scaled on the 1920 x 1080 frame. The Output page (output.html)
// builds it, scene.html draws it, and the Stream Deck shows and hides sources with
// ─── Sponsor ads ─────────────────────────────────────────────────────────
// Ads play in their own sources, made the first time they're needed and kept on top of the scene: Sponsor
// ad (video), Sponsor ad (still) and House ad (ad.html, when no sponsor has an ad and the step allows it).
// Each ad sets the source's file; a new file reloads it. Returns what a sequence step needs, or null.
const AD_SOURCES = {
  video: { id: 'sponsoradvideo', type: 'video', name: 'Sponsor ad (video)', sound: true, hideWhenDone: true, restartOnShow: true },
  image: { id: 'sponsoradimage', type: 'image', name: 'Sponsor ad (still)' },
  house: { id: 'sponsoradhouse', type: 'browser', name: 'House ad', url: 'ad.html' },
};
function adSource(kind, file) {
  const spec = AD_SOURCES[kind];
  let src = scene.sources.find(s => s.id === spec.id);
  if (!src) {
    change({ type: 'add', sources: [{ ...spec, ...(file ? { file } : {}) }] });
    src = scene.sources.find(s => s.id === spec.id);
  } else if (file && src.file !== file) {
    src.file = file;
    src.loadSeq++;
  }
  return src;
}
function sponsorAd(opts = {}) {
  const ad = sponsors.nextAd(competitions.activeId(), { exists: f => fs.existsSync(path.join(MEDIA_DIR, cleanFile(f))) });
  if (!ad && !opts.house) return null;
  const src = ad ? adSource(ad.kind, ad.file) : adSource('house');
  if (ad) log('info', 'scene', `Sponsor ad: ${ad.sponsor.name} (${ad.file})`);
  return { source: src.id, name: ad ? ad.sponsor.name : 'House ad', sponsor: ad ? ad.sponsor.id : null,
    length: ad && ad.kind === 'image' ? { type: 'time', sec: ad.seconds } : { type: 'done' } };
}

// /deck/layer/<name>/on|off|toggle|restart, /deck/layer/<name>/sound/on|off|toggle and
// /deck/layers/off.
//
// Scenes are saved looks for those same sources: each one sets a source on or off, or leaves it
// as it is (not in its states). Going to a scene (/deck/scene/<name>, next, prev, again) turns
// sources on and off to match and leaves one that's already on running. Sources stay shared, so
// a source changed by hand afterwards is changed everywhere, and changed lists the ones that
// differ from the current scene's saved state.
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
const sequences = require('./sequences');
const music = require('./music');
const sponsors = require('./sponsors');
const competitions = require('./competitions');

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
const STREAMDECK_PLUGIN = path.join(__dirname, 'plugins', 'studio-deck', 'dist', 'com.runplaywin.firstpass-studio.streamDeckPlugin');
const kindOf = f => { const x = path.extname(f).toLowerCase(); return IMAGE_TYPES[x] ? 'image' : VIDEO_TYPES[x] ? 'video' : AUDIO_TYPES[x] ? 'audio' : null; };

let log = () => {};
let scene = { sources: [], scenes: [], current: null };
// Sources set on in the current scene that went off by themselves (a video that hides when it's
// done): not a change from the scene.
let ended = new Set();
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

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
// The name used in Stream Deck links: "Up Next" is /deck/layer/up-next/on.
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);

// A browser source's address: a Studio page ("scoreboard.html?position=top-center") or a full http(s) link.
function cleanUrl(u) {
  const s = String(u || '').trim().replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i, '');
  if (/^https?:\/\//i.test(s)) return s;
  return s.replace(/^\/+/, '').replace(/^javascript:/i, '');
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
  out.name = uniqueSceneName(s.name, out.id);
  return out;
}

// What's on and off now, for every source.
const liveStates = () => Object.fromEntries(scene.sources.map(s => [s.id, s.visible ? 'on' : 'off']));

function findScene(ref) {
  const r = String(ref || '');
  return scene.scenes.find(s => s.id === r) || scene.scenes.find(s => slug(s.name) === slug(r)) || null;
}
const currentScene = () => scene.scenes.find(s => s.id === scene.current) || null;

// The sources that differ from the current scene's saved state.
function changed() {
  const cur = currentScene();
  if (!cur) return [];
  return scene.sources.filter(s => {
    const want = cur.states[s.id];
    if (!want || (want === 'on') === s.visible) return false;
    return !(want === 'on' && ended.has(s.id));
  }).map(s => s.id);
}

// Turns sources on and off to match a scene. A source already on stays as it is (a page isn't
// reloaded and a video doesn't start again), and a source the scene doesn't set is left alone.
// Picking a scene stops a playing sequence, unless it's the sequence's own Then going there.
// A sequence's scene step (step) leaves the music alone unless the scene quiets it.
function goTo(sc, fromSequence, step) {
  if (!fromSequence) sequences.beforeScene(sc);
  let on = 0, off = 0;
  for (const s of scene.sources) {
    const want = sc.states[s.id];
    if (!want) continue;
    if (want === 'on' && !s.visible) { s.visible = true; on++; }
    if (want === 'off' && s.visible) { s.visible = false; off++; }
  }
  ended = new Set();
  scene.current = sc.id;
  log('info', 'scene', `Went to scene "${sc.name}": ${on} on, ${off} off`);
  if (!step || sc.quiet) music.quiet(sc.quiet);
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    scene = { sources: [], scenes: [], current: null };
    for (const s of Array.isArray(saved.sources) ? saved.sources : []) scene.sources.push(clean(s));
    for (const sc of Array.isArray(saved.scenes) ? saved.scenes : []) if (sc && typeof sc === 'object') scene.scenes.push(cleanScene(sc));
    scene.current = scene.scenes.some(sc => sc.id === saved.current) ? saved.current : null;
    ended = new Set((Array.isArray(saved.ended) ? saved.ended : []).filter(id => scene.sources.some(s => s.id === id)));
    wasOn = new Set(scene.sources.filter(s => s.visible).map(s => s.id));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'scene', `Could not read scene.json, starting with an empty scene: ${err.message}`);
    scene = { sources: [], scenes: [], current: null };
    ended = new Set();
  }
}

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify({ sources: scene.sources.map(({ loadSeq, showSeq, ...s }) => s), scenes: scene.scenes, current: scene.current, ended: [...ended] }, null, 2) + '\n'); }
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
  const drop = () => { sockets.delete(socket); socket.destroy(); };
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
    }
  });
  socket.write(wsFrame(1, Buffer.from(JSON.stringify(state()))));
  return true;
}

function state() {
  return { rev, width: WIDTH, height: HEIGHT, sources: scene.sources, scenes: orderedScenes(), current: currentScene() ? scene.current : null,
    changed: changed(), converting: [...converting.keys()], ...sequences.state(), ...music.state() };
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
// Music gets out of the way while a video with its sound on plays.
function videoSound() { music.videoSound(scene.sources.some(s => s.type === 'video' && s.visible && s.sound && !soundDone.has(s.id))); }
function noteShowings() {
  videoSound();
  for (const s of scene.sources) if (s.visible && !wasOn.has(s.id)) s.showSeq++;
  wasOn = new Set(scene.sources.filter(s => s.visible).map(s => s.id));
}
function change(a) {
  const src = a.id || a.name ? find(a.id || a.name) : null;
  const need = () => src ? null : `No source "${a.id || a.name || ''}" in the scene.`;
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
function applyScene(a) {
  const sc = a.scene ? findScene(a.scene) : null;
  const need = () => sc ? null : `No scene "${a.scene || ''}".`;
  switch (a.type) {
    case 'sceneSave': {
      // A new scene from what's on now (it becomes the current scene), or from the states given, at the end of the list.
      const made = cleanScene({ name: a.name, colour: a.colour, states: a.states || liveStates() }, { id: newId() });
      scene.scenes.push(made);
      if (!a.states) { scene.current = made.id; ended = new Set(); }
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
      for (const s of scene.sources) if (sc.states[s.id]) sc.states[s.id] = s.visible ? 'on' : 'off';
      if (scene.current === sc.id) ended = new Set();
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
      goTo(sc);
      return null;
    case 'sceneAgain': {
      const cur = currentScene();
      if (!cur) return 'There is no current scene to go back to.';
      goTo(cur);
      return null;
    }
    case 'sceneNext': case 'scenePrev': {
      // Stops at the ends. With no current scene, Next goes to the first and Previous to the last.
      const list = orderedScenes();
      if (!list.length) return 'There are no scenes.';
      const i = list.indexOf(currentScene());
      const to = i < 0 ? (a.type === 'sceneNext' ? 0 : list.length - 1) : i + (a.type === 'sceneNext' ? 1 : -1);
      if (to >= 0 && to < list.length) goTo(list[to]);
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
const BUNDLED_FFMPEG = path.join(__dirname, 'vendor', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
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

// Sends a media file, with byte ranges so videos can seek and loop.
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
    }
    res.writeHead(status, { 'content-type': type, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'no-store',
      ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${st.size}` } : {}) });
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
  ended = new Set();
  const missing = [...new Set(sources.filter(s => s.file && !fs.existsSync(path.join(MEDIA_DIR, s.file))).map(s => s.file))];
  // A .mov the sources play that hasn't been converted yet starts converting now.
  for (const f of new Set(sources.filter(s => s.type === 'video' && /\.mov$/i.test(s.file)).map(s => s.file))) {
    if (fs.existsSync(path.join(MEDIA_DIR, f)) && !fs.existsSync(path.join(MEDIA_DIR, webmFor(f)))) convert(f);
  }
  log('info', 'scene', `Imported a scene with ${sources.length} sources${Array.isArray(parsed.scenes) ? ` and ${scene.scenes.length} scenes` : ''}${parsed.studio ? ` (exported from Studio ${parsed.studio}${parsed.exported ? ` on ${parsed.exported}` : ''})` : ''}`
    + `${copied.length ? `, copied ${copied.join(', ')} to the media folder` : ''}${missing.length ? `; missing media ${missing.join(', ')}` : ''}`);
  return { sources: sources.length, scenes: Array.isArray(parsed.scenes) ? scene.scenes.length : null, copied, missing };
}

// The scene's HTTP routes: /api/scene, /api/scene/events, /api/scene/media, /api/scene/export and
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
  if (p === '/api/scene/media' && req.method === 'GET') return send(res, 200, { media: mediaList(), canConvert: !!ffmpegPath() }), true;
  if (p === '/api/scene/media' && req.method === 'POST') {
    const name = cleanFile(url.searchParams.get('name')).replace(/[^\w .()'&+-]/g, '_').replace(/^\.+/, '');
    const kind = name && kindOf(name);
    if (!kind) return send(res, 400, { error: 'Pick a PNG, JPG, GIF, WebP or SVG image, an MP4, WebM or MOV video, or an MP3, M4A, AAC, WAV or AIFF song.' }), true;
    const size = await saveUpload(req, name, kind === 'video' ? MAX_VIDEO : kind === 'audio' ? MAX_AUDIO : MAX_IMAGE);
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

function init(logger, { ffmpeg, sequencesFile } = {}) {
  log = logger || log;
  ffmpegSetting = ffmpeg || '';
  load();
  music.init(log, {
    duration: file => duration(file),
    files: () => mediaList().filter(m => m.kind === 'audio' && !m.converting).map(m => m.name),
    changed: () => save(),
  });
  sequences.init(log, {
    source: id => scene.sources.find(s => s.id === id) || null,
    setVisible: (s, on) => { s.visible = on; ended.delete(s.id); },
    scene: id => scene.scenes.find(s => s.id === id) || null,
    goTo: (sc, step) => goTo(sc, true, step),
    duration,
    sponsorAd,
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

module.exports = { STREAMDECK_PLUGIN, importFile, exportFiles, init, route, upgrade, deck, apply, state, slug, competitionChanged, game, FILE, MEDIA_DIR };
