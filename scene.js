// FirstPass Studio - the scene: Studio's own replacement for an OBS scene (optional).
//
// One scene, a list of sources drawn as layers, top layer first: Studio pages (or any web
// address) and images from the media folder. Each source can be shown and hidden with its
// own fade, and placed and scaled on the 1920 x 1080 frame. The Output page (output.html)
// builds it, scene.html draws it, and the Stream Deck shows and hides sources with
// /deck/layer/<name>/on|off|toggle|restart and /deck/layers/off.
//
// Saved as scene.json in the data folder; images are kept in its media/ folder. OBS still
// works exactly as before: nothing here changes the other pages, and scene.html can itself
// go into OBS as one browser source.

'use strict';

const fs = require('fs');
const path = require('path');
const datadir = require('./datadir');

const FILE = datadir.file('scene.json');
const MEDIA_DIR = datadir.file('media');
const WIDTH = 1920, HEIGHT = 1080;
const TYPES = ['browser', 'image'];
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const MAX_IMAGE = 50 * 1024 * 1024;

let log = () => {};
let scene = { sources: [] };
let rev = 0;
const listeners = new Set();

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
// The name used in Stream Deck links: "Up Next" is /deck/layer/up-next/on.
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);

// A browser source's address: a Studio page ("scoreboard.html?board=2") or a full http(s) link.
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
  if (src.type === 'image') return path.basename(src.file || 'Image', path.extname(src.file || ''));
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
    fadeMs: Math.round(clamp(s.fadeMs, 0, 10000, 300)),
    x: Math.round(clamp(s.x, -WIDTH, WIDTH * 2, 0)),
    y: Math.round(clamp(s.y, -HEIGHT, HEIGHT * 2, 0)),
    scale: clamp(s.scale, 1, 1000, 100),
    loadSeq: Math.round(clamp(s.loadSeq, 0, 1e9, 0)),
  };
  if (type === 'browser') {
    out.url = cleanUrl(s.url) || 'scoreboard.html';
    out.width = Math.round(clamp(s.width, 16, 7680, WIDTH));
    out.height = Math.round(clamp(s.height, 16, 4320, HEIGHT));
    out.reloadOnShow = s.reloadOnShow === undefined ? true : !!s.reloadOnShow;
  } else {
    out.file = cleanFile(s.file);
  }
  out.name = uniqueName(s.name || defaultName(out), out.id);
  return out;
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    scene = { sources: [] };
    for (const s of Array.isArray(saved.sources) ? saved.sources : []) scene.sources.push(clean(s));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'scene', `Could not read scene.json, starting with an empty scene: ${err.message}`);
    scene = { sources: [] };
  }
}

function save() {
  rev++;
  try { fs.writeFileSync(FILE, JSON.stringify({ sources: scene.sources.map(({ loadSeq, ...s }) => s) }, null, 2) + '\n'); }
  catch (err) { log('error', 'scene', `Could not save scene.json: ${err.message}`); }
  const body = `data: ${JSON.stringify(state())}\n\n`;
  for (const res of listeners) res.write(body);
}

function state() { return { rev, width: WIDTH, height: HEIGHT, sources: scene.sources }; }

function find(ref) {
  const r = String(ref || '');
  return scene.sources.find(s => s.id === r) || scene.sources.find(s => slug(s.name) === slug(r)) || null;
}

// One change to the scene, from the Output page or the Stream Deck. Returns an error or null.
function apply(a) {
  const src = a.id || a.name ? find(a.id || a.name) : null;
  const need = () => src ? null : `No source "${a.id || a.name || ''}" in the scene.`;
  switch (a.type) {
    case 'add': {
      const s = clean({ ...a.source, visible: false });
      scene.sources.unshift(s); // new sources go on top, like OBS
      log('info', 'scene', `Added ${s.type} source "${s.name}"`);
      return null;
    }
    case 'update': {
      if (need()) return need();
      const i = scene.sources.indexOf(src);
      const { id, type, loadSeq, ...changes } = a.changes || {};
      scene.sources[i] = clean(changes, src);
      return null;
    }
    case 'remove':
      if (need()) return need();
      scene.sources.splice(scene.sources.indexOf(src), 1);
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
      log('info', 'scene', `"${src.name}" ${src.visible ? 'on' : 'off'}`);
      return null;
    case 'restart':
      if (need()) return need();
      src.loadSeq++;
      log('info', 'scene', `Reloaded "${src.name}"`);
      return null;
    case 'hideAll':
      for (const s of scene.sources) s.visible = false;
      log('info', 'scene', 'Every source off');
      return null;
    default:
      return `Unknown scene change "${a.type}".`;
  }
}

// /deck/layer/<name>/on|off|toggle|restart and /deck/layers/off. Returns null when the link
// isn't a scene link, so the scoreboard's own links carry on as before.
function deck(parts) {
  const [what, name, verb] = parts;
  let action = null;
  if (what === 'layers' && name === 'off') action = { type: 'hideAll' };
  if (what === 'layer' && name) {
    const type = { on: 'show', show: 'show', off: 'hide', hide: 'hide', toggle: 'toggle', restart: 'restart', reload: 'restart' }[verb];
    if (type) action = { type, name };
  }
  if (!action) return null;
  const error = apply(action);
  if (error) return { status: 404, body: { error } };
  save();
  const src = action.name ? find(action.name) : null;
  return { status: 200, body: { ok: true, ...(src ? { name: src.name, visible: src.visible } : {}) } };
}

function mediaList() {
  try {
    return fs.readdirSync(MEDIA_DIR).filter(f => IMAGE_TYPES[path.extname(f).toLowerCase()]).sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

// The scene's HTTP routes: /api/scene, /api/scene/events, /api/scene/media and /media/<file>.
// Returns false for anything else.
async function route(req, res, url, { send, readBody, readRaw }) {
  const p = url.pathname;
  if (p === '/api/scene' && req.method === 'GET') return send(res, 200, state()), true;
  if (p === '/api/scene' && req.method === 'POST') {
    const error = apply(await readBody(req));
    if (error) return send(res, 400, { error }), true;
    save();
    return send(res, 200, state()), true;
  }
  if (p === '/api/scene/events') {
    // Server-sent events: the whole scene now, then again on every change, so a Stream Deck
    // press shows in scene.html straight away without polling.
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`retry: 1000\ndata: ${JSON.stringify(state())}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); });
    return true;
  }
  if (p === '/api/scene/media' && req.method === 'GET') return send(res, 200, { files: mediaList() }), true;
  if (p === '/api/scene/media' && req.method === 'POST') {
    const name = cleanFile(url.searchParams.get('name')).replace(/[^\w .()'&+-]/g, '_');
    if (!name || !IMAGE_TYPES[path.extname(name).toLowerCase()]) return send(res, 400, { error: 'Pick a PNG, JPG, GIF, WebP or SVG image.' }), true;
    const buf = await readRaw(req, MAX_IMAGE);
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, name), buf);
    log('info', 'scene', `Saved ${name} to the media folder (${Math.round(buf.length / 1024)} KB)`);
    return send(res, 200, { file: name, files: mediaList() }), true;
  }
  if (p.startsWith('/media/')) {
    const file = cleanFile(decodeURIComponent(p.slice(7)));
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type) return send(res, 404, 'Not found', 'text/plain'), true;
    fs.readFile(path.join(MEDIA_DIR, file), (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, type));
    return true;
  }
  return false;
}

function init(logger) {
  log = logger || log;
  load();
  if (scene.sources.length) log('info', 'scene', `Scene has ${scene.sources.length} sources`);
}

module.exports = { init, route, deck, apply, state, slug, FILE, MEDIA_DIR };
