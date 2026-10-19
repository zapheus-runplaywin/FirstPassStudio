// FirstPass Studio - the scene: Studio's own replacement for an OBS scene (optional).
//
// One scene, a list of sources drawn as layers, top layer first: Studio pages (or any web
// address), and images and videos from the media folder. Each source can be shown and hidden with its
// own fade, and placed and scaled on the 1920 x 1080 frame. The Output page (output.html)
// builds it, scene.html draws it, and the Stream Deck shows and hides sources with
// /deck/layer/<name>/on|off|toggle|restart, /deck/layer/<name>/sound/on|off|toggle and
// /deck/layers/off.
//
// Saved as scene.json in the data folder; images and videos are kept in its media/ folder.
// Chromium can't play ProRes, so a .mov added to the media folder is converted to a WebM
// beside it (VP9, keeping transparency) with the ffmpeg the app bundles; the original is kept. OBS still
// works exactly as before: nothing here changes the other pages, and scene.html can itself
// go into OBS as one browser source.

'use strict';

const fs = require('fs');
const path = require('path');
const datadir = require('./datadir');

const FILE = datadir.file('scene.json');
const MEDIA_DIR = datadir.file('media');
const WIDTH = 1920, HEIGHT = 1080;
const TYPES = ['browser', 'image', 'video'];
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const MEDIA_TYPES = { ...IMAGE_TYPES, ...VIDEO_TYPES };
const MAX_IMAGE = 50 * 1024 * 1024, MAX_VIDEO = 20 * 1024 * 1024 * 1024;
// The Studio Stream Deck plugin (plugins/studio-deck), packed by the Mac app's build so it ships with the app.
const STREAMDECK_PLUGIN = path.join(__dirname, 'plugins', 'studio-deck', 'dist', 'com.runplaywin.firstpass-studio.streamDeckPlugin');
const kindOf = f => IMAGE_TYPES[path.extname(f).toLowerCase()] ? 'image' : VIDEO_TYPES[path.extname(f).toLowerCase()] ? 'video' : null;

let log = () => {};
let scene = { sources: [] };
let rev = 0;
const listeners = new Set();

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
  try { fs.writeFileSync(FILE, JSON.stringify({ sources: scene.sources.map(({ loadSeq, ...s }) => s) }, null, 2) + '\n'); }
  catch (err) { log('error', 'scene', `Could not save scene.json: ${err.message}`); }
  notify();
}
// Sends the scene to every open scene.html and Output page.
function notify() {
  rev++;
  const body = `data: ${JSON.stringify(state())}\n\n`;
  for (const res of listeners) res.write(body);
}

function state() { return { rev, width: WIDTH, height: HEIGHT, sources: scene.sources, converting: [...converting.keys()] }; }

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
      // One source (source) or several (sources, top first). New sources go on top, like OBS, or just
      // above the source named by before (the one selected on the Output page).
      const list = (Array.isArray(a.sources) ? a.sources : [a.source]).filter(Boolean).slice(0, 100).map(x => clean({ ...x, visible: false }));
      if (!list.length) return 'Nothing to add.';
      const above = a.before ? find(a.before) : null;
      scene.sources.splice(above ? scene.sources.indexOf(above) : 0, 0, ...list);
      for (const s of list) log('info', 'scene', `Added ${s.type} source "${s.name}"${above ? ` above "${above.name}"` : ''}`);
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
      log('info', 'scene', `${src.type === 'video' ? 'Restarted' : 'Reloaded'} "${src.name}"`);
      return null;
    case 'soundOn': case 'soundOff': case 'soundToggle':
      if (need()) return need();
      if (src.type !== 'video') return `"${src.name}" has no sound to turn on or off.`;
      src.sound = a.type === 'soundToggle' ? !src.sound : a.type === 'soundOn';
      log('info', 'scene', `"${src.name}" sound ${src.sound ? 'on' : 'off'}`);
      return null;
    case 'ended':
      // scene.html says a video finished: fade it out if it's set to hide when done. loadSeq
      // makes sure it's this play that ended, not one from before a restart.
      if (need()) return need();
      if (src.type === 'video' && src.visible && src.hideWhenDone && !src.loop && Number(a.loadSeq) === src.loadSeq) {
        src.visible = false;
        log('info', 'scene', `"${src.name}" finished, off`);
      }
      return null;
    case 'hideAll':
      for (const s of scene.sources) s.visible = false;
      log('info', 'scene', 'Every source off');
      return null;
    default:
      return `Unknown scene change "${a.type}".`;
  }
}

// /deck/layer/<name>/on|off|toggle|restart, /deck/layer/<name>/sound/on|off|toggle and
// /deck/layers/off. Returns null when the link
// isn't a scene link, so the scoreboard's own links carry on as before.
function deck(parts) {
  const [what, name, verb] = parts;
  let action = null;
  if (what === 'layers' && name === 'off') action = { type: 'hideAll' };
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

function mediaList() {
  let files = [];
  try { files = fs.readdirSync(MEDIA_DIR).filter(f => kindOf(f) && !f.startsWith('.')).sort((a, b) => a.localeCompare(b)); } catch { /* none yet */ }
  return files.map(name => {
    const m = { name, kind: kindOf(name) };
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

// The scene's HTTP routes: /api/scene, /api/scene/events, /api/scene/media and /media/<file>.
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
    // Server-sent events: the whole scene now, then again on every change, so a Stream Deck
    // press shows in scene.html straight away without polling.
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`retry: 1000\ndata: ${JSON.stringify(state())}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); });
    return true;
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
    if (!kind) return send(res, 400, { error: 'Pick a PNG, JPG, GIF, WebP or SVG image, or an MP4, WebM or MOV video.' }), true;
    const size = await saveUpload(req, name, kind === 'video' ? MAX_VIDEO : MAX_IMAGE);
    log('info', 'scene', `Saved ${name} to the media folder (${Math.round(size / 1024)} KB)`);
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

function init(logger, { ffmpeg } = {}) {
  log = logger || log;
  ffmpegSetting = ffmpeg || '';
  load();
  if (scene.sources.length) log('info', 'scene', `Scene has ${scene.sources.length} sources`);
}

module.exports = { STREAMDECK_PLUGIN, init, route, deck, apply, state, slug, FILE, MEDIA_DIR };
