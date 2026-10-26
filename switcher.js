// FirstPass Studio - controlling a Blackmagic ATEM switcher over the network (optional).
//
// Studio finds the ATEMs on the network the way ATEM Software Control does (Bonjour, _blackmagic._tcp,
// browsed with macOS's own dns-sd), or takes a typed address, and keeps one connection to the one picked,
// using atem-connection (Blackmagic's control protocol over UDP port 9910). The switcher's own buttons,
// ATEM Software Control and other controllers keep working alongside it: Studio follows what they do and
// only sends something when a button, a Stream Deck key, a sequence step or a scene asks for it. On connecting
// or reconnecting it sends nothing, so a cut is never replayed late.
//
// It reads what the switcher has (its model, inputs and their names, upstream and downstream keys) rather
// than assuming a model, so an ATEM Mini Pro (1 upstream key, 1 downstream key, 4 inputs) works the same
// way as a Mini Extreme (4, 2 and 8), offering only what it has.
//
// Saved as switcher.json in the data folder: one switcher for the Mac, not per competition. The helper only
// runs while Studio is on air, so the connection opens when Studio goes on air and closes with it.
// Stream Deck: /deck/switcher/cut, auto, stinger, stinger/<input>, ftb, preview/<input>, program/<input>, usk/<n>/on|off|toggle,
// dsk/<n>/on|off|toggle|auto, macro/<n>.

'use strict';

const fs = require('fs');
const dns = require('dns');
const { spawn } = require('child_process');
const datadir = require('./datadir');
const savefile = require('./savefile');

const FILE = datadir.file('switcher.json');
const PORT = 9910;
// macOS's Bonjour browser. The tests point it at a stand-in.
const DNS_SD = process.env.FIRSTPASS_DNS_SD || '/usr/bin/dns-sd';
const SERVICE = '_blackmagic._tcp';
const FIND_MS = 2500;         // how long a search for switchers listens
const REFIND_MS = 15000;      // while a found switcher isn't answering, look for it again this often (its address may have changed)

let log = () => {};
let onChange = () => {};
// What's picked: null (not set up), { kind: 'found', name, host, port, address } or { kind: 'address', address, port }.
let pick = null;
let atem = null;              // the atem-connection client
let conn = 'off';             // off | connecting | connected | lost | error
let since = Date.now();
let error = '';
let address = '';             // the address it's connected (or connecting) to
let refindTimer = null;
let found = [];               // the last search's switchers
let finding = null;           // the search in progress (a promise)
let lastKey = '';
// Stinger cuts: Studio plays the scene's stinger (stinger.html) on Output 1 and cuts while it covers the frame.
let lineup = 0;               // frames to cut later (or earlier, below 0) than the middle of the cover, for the picture's delay into the switcher
let stingerApi = null;        // { find(ref), play(id) } from scene.js
let stingerWait = null;       // a stinger cut waiting to hear the stinger has started: { resolve }
const STINGER_WAIT_MS = 3000; // how long a stinger has to start (its page loads its logo first)
const LINEUP = [-25, 25];

const now = () => Date.now();
function setConn(c, why = '') {
  if (c === conn && why === error) return;
  conn = c;
  error = why;
  since = now();
  changed();
}
function changed() {
  const key = JSON.stringify(status());
  if (key === lastKey) return;
  lastKey = key;
  try { onChange(); } catch { /* a page update failing doesn't matter here */ }
}

// ─── Saved setting ────────────────────────────────────────────────────────
function cleanPick(p) {
  if (!p || typeof p !== 'object') return null;
  const port = Math.round(Number(p.port)) || PORT;
  const addr = String(p.address || '').trim().slice(0, 100);
  if (p.kind === 'found' && p.name) {
    return { kind: 'found', name: String(p.name).slice(0, 100), host: String(p.host || '').slice(0, 200), port, address: addr };
  }
  if (p.kind === 'address' && addr) return { kind: 'address', address: addr, port };
  return null;
}
const cleanLineup = v => Math.round(Math.min(LINEUP[1], Math.max(LINEUP[0], Number(v) || 0)));
function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    pick = cleanPick(saved.pick);
    lineup = cleanLineup(saved.lineup);
  } catch (err) { if (err.code !== 'ENOENT') log('warn', 'switcher', `Could not read switcher.json: ${err.message}`); pick = null; lineup = 0; }
}
function save() {
  try { savefile.writeJsonSync(FILE, { pick, lineup }); }
  catch (err) { log('error', 'switcher', `Could not save switcher.json: ${err.message}`); }
}

// A typed address: an IP address or name, with :port if it isn't the usual 9910.
function parseAddress(text) {
  const s = String(text || '').trim();
  const m = s.match(/^\[?([^\]\s]+?)\]?(?::(\d{1,5}))?$/);
  if (!m || !/^[a-z0-9.-]+$/i.test(m[1])) return null;
  return { address: m[1], port: m[2] ? Number(m[2]) : PORT };
}

// ─── Finding switchers (Bonjour) ──────────────────────────────────────────
// dns-sd prints, for -B, a line per service seen ("... Add  3  12 local.  _blackmagic._tcp.  ATEM Mini Extreme"),
// and for -L, where one is ("... can be reached at ATEM-Mini-Extreme.local.:9910 (interface 12)") followed by its
// TXT record ("class=AtemSwitcher name=ATEM\ Mini\ Extreme ..."). Other Blackmagic devices (HyperDecks, Web
// Presenters) share the service type: only ATEM switchers are kept.
function parseBrowse(text) {
  const names = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*\S+\s+Add\s+\d+\s+\d+\s+\S+\s+_blackmagic\._tcp\.\s+(.+?)\s*$/);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}
function parseTxt(text) {
  const out = {};
  for (const [, k, v] of String(text).matchAll(/(?:^|\s)((?:[^=\s\\]|\\.)+)=((?:[^\s\\]|\\.)*)/g)) {
    out[k.replace(/\\(.)/g, '$1').toLowerCase()] = v.replace(/\\(.)/g, '$1');
  }
  return out;
}
function parseLookup(text) {
  const s = String(text);
  const at = s.match(/can be reached at (\S+?)\.?:(\d+)/);
  if (!at) return null;
  const after = s.slice(at.index + at[0].length).split('\n').slice(1).join(' ');
  return { host: at[1], port: Number(at[2]), txt: parseTxt(after) };
}
const isSwitcher = info => info && (/atem/i.test(info.txt.class || '') || (!info.txt.class && info.port === PORT));

// Runs dns-sd for ms and gives what it printed (it never ends by itself).
function runDnsSd(args, ms) {
  return new Promise(resolve => {
    let out = '';
    let child;
    try { child = spawn(DNS_SD, args, { stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { resolve(''); return; }
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => resolve(out));
    const timer = setTimeout(() => child.kill(), ms);
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}
const lookupHost = host => new Promise(resolve => {
  if (!host) return resolve('');
  const timer = setTimeout(() => resolve(''), 3000);
  dns.lookup(host, { family: 4 }, (err, addr) => { clearTimeout(timer); resolve(err ? '' : addr); });
});
const canFind = () => { try { fs.accessSync(DNS_SD, fs.constants.X_OK); return true; } catch { return false; } };

// Looks for ATEMs on the network: [{ name, model, host, port, address }].
function find() {
  if (finding) return finding;
  finding = (async () => {
    if (!canFind()) return found;
    const names = parseBrowse(await runDnsSd(['-B', SERVICE, 'local.'], FIND_MS));
    const list = [];
    await Promise.all(names.map(async name => {
      const info = parseLookup(await runDnsSd(['-L', name, SERVICE, 'local.'], 1500));
      if (!isSwitcher(info)) return;
      list.push({ name, model: info.txt.name || name, host: info.host, port: info.port || PORT, address: await lookupHost(info.host) });
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    found = list;
    log('info', 'switcher', list.length ? `Found ${list.map(f => `${f.name}${f.address ? ` (${f.address})` : ''}`).join(', ')}` : 'Looked for switchers on the network and found none');
    changed();
    return found;
  })().finally(() => { finding = null; });
  return finding;
}

// ─── The connection ───────────────────────────────────────────────────────
function loadLibrary() {
  // Loaded only when a switcher is set up, so a problem with it never stops Studio starting.
  return require('atem-connection');
}
async function disconnect() {
  clearInterval(refindTimer);
  refindTimer = null;
  const a = atem;
  atem = null;
  address = '';
  if (a) { a.removeAllListeners(); await a.destroy().catch(() => {}); }
}
// Each connect() supersedes any still under way (the refind timer, Use this one, Try again can overlap): one
// that finds a newer one started while it waited stops there, so only the newest connection is kept.
let connectGen = 0;
async function connect() {
  const gen = ++connectGen;
  const current = () => gen === connectGen;
  await disconnect();
  if (!current()) return;
  if (!pick) { setConn('off'); return; }
  let lib;
  try { lib = loadLibrary(); }
  catch (err) { log('error', 'switcher', `Switcher control isn't available: ${err.message}`); setConn('error', `Switcher control isn't available in this copy of Studio (${err.message})`); return; }
  setConn('connecting');
  let target = pick.address;
  if (pick.kind === 'found') {
    // Remembered by name: ask the network where it is now, in case its address changed.
    const name = pick.name;
    const fresh = (await lookupHost(pick.host)) || ((await find()).find(f => f.name === name) || {}).address;
    if (!current()) return;
    if (fresh && fresh !== pick.address) { pick = { ...pick, address: fresh }; save(); }
    target = pick.address;
  }
  if (!target) { setConn('lost', `Can't find "${pick.name}" on the network`); startRefind(); return; }
  const a = new lib.Atem({ disableMultithreaded: true });
  atem = a;
  address = target;
  a.on('error', e => log('warn', 'switcher', `Switcher: ${e}`));
  a.on('connected', () => {
    if (atem !== a) return;
    clearInterval(refindTimer);
    refindTimer = null;
    const s = summary();
    log('info', 'switcher', `Connected to ${s.model} at ${target} (${s.inputs.length} inputs, ${s.usk.length} upstream keys, ${s.dsk.length} downstream keys)`);
    setConn('connected');
  });
  a.on('disconnected', () => {
    if (atem !== a) return;
    log('warn', 'switcher', `The switcher at ${target} stopped answering; trying again`);
    setConn('lost', 'Not answering');
    startRefind();
  });
  a.on('stateChanged', () => { if (atem === a) changed(); });
  try { await a.connect(target, pick.port); }
  catch (err) { if (atem === a) setConn('error', err.message); }
}
// A found switcher that isn't answering may have a new address (the venue's router handed out another):
// look for it by name every so often and reconnect if it has moved. The library keeps retrying the old one.
function startRefind() {
  if (refindTimer || !pick || pick.kind !== 'found') return;
  refindTimer = setInterval(async () => {
    if (conn === 'connected' || !pick || pick.kind !== 'found') return;
    const f = (await find()).find(x => x.name === pick.name);
    if (f && f.address && f.address !== address) { log('info', 'switcher', `"${pick.name}" is now at ${f.address}`); pick = { ...pick, address: f.address, host: f.host }; save(); connect(); }
  }, REFIND_MS);
  refindTimer.unref?.();
}

// ─── What the switcher has and shows ─────────────────────────────────────
const MODEL_NAMES = { 13: 'ATEM Mini', 14: 'ATEM Mini Pro', 15: 'ATEM Mini Pro ISO', 16: 'ATEM Mini Extreme', 17: 'ATEM Mini Extreme ISO' };
// Frames a second of the switcher's video standard (atem-connection's Enums.VideoMode, named like P1080p50 or
// N1080i5994): 50 when it isn't known.
function fpsOf(mode) {
  let Enums;
  try { ({ Enums } = loadLibrary()); } catch { return 50; }
  const m = /([pi])(\d+)/.exec(String(Enums.VideoMode[mode] || ''));
  if (!m) return 50;
  let n = Number(m[2]);
  if (n > 100) n /= 100;      // 5994 is 59.94, 5000 is 50
  return Math.round((m[1] === 'i' ? n / 2 : n) * 100) / 100;
}
function summary() {
  const st = atem && atem.state;
  if (!st || atem.status !== 2) return null; // 2: connected, with the whole state read
  const me = (st.video.mixEffects || [])[0] || {};
  const uskCount = ((st.info.mixEffects || [])[0] || {}).keyCount || 0;
  const dskCount = (st.info.capabilities || {}).downstreamKeyers || 0;
  // The inputs that are cameras and other things plugged in (not black, bars, media players or keys).
  const inputs = Object.values(st.inputs || {}).filter(i => i && i.internalPortType === 0)
    .sort((a, b) => a.inputId - b.inputId)
    .map(i => ({ id: i.inputId, name: i.longName || `Input ${i.inputId}`, short: i.shortName || String(i.inputId) }));
  return {
    model: st.info.productIdentifier || MODEL_NAMES[st.info.model] || 'ATEM switcher',
    inputs,
    program: me.programInput ?? null,
    preview: me.previewInput ?? null,
    inTransition: !!(me.transitionPosition && me.transitionPosition.inTransition),
    usk: Array.from({ length: uskCount }, (_, k) => !!((me.upstreamKeyers || [])[k] || {}).onAir),
    dsk: Array.from({ length: dskCount }, (_, k) => !!((st.video.downstreamKeyers || [])[k] || {}).onAir),
    ftb: !!(me.fadeToBlack && me.fadeToBlack.isFullyBlack),
    fps: fpsOf(st.settings && st.settings.videoMode),
  };
}
function status() {
  const s = conn === 'connected' ? summary() : null;
  return {
    setUp: !!pick,
    pick,
    state: conn,
    since,
    error,
    address,
    canFind: canFind(),
    finding: !!finding,
    found,
    lineup,
    stinger: (stingerApi && stingerApi.find()) ? stingerApi.find().name : '',
    ...(s || { model: '', inputs: [], program: null, preview: null, inTransition: false, usk: [], dsk: [], ftb: false }),
  };
}

// ─── Doing things ─────────────────────────────────────────────────────────
// An input by number, or by its name or short name on the switcher ("Camera 2", "CAM2", "camera-2").
function inputOf(s, v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return null;
  const slug = x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.inputs.find(i => String(i.id) === t) || s.inputs.find(i => i.name.toLowerCase() === t || i.short.toLowerCase() === t)
    || s.inputs.find(i => slug(i.name) === slug(t)) || null;
}
// The switcher answers a command before it sends what changed: wait a moment for that, so what's sent
// back (and shown on a Stream Deck key) is the switcher after the change.
const settled = () => new Promise(resolve => {
  const a = atem;
  if (!a) return resolve();
  const done = () => { clearTimeout(timer); a.off('stateChanged', done); resolve(); };
  const timer = setTimeout(done, 150);
  a.on('stateChanged', done);
});
const noInput = (s, v) => `No input "${v}" on the ${s.model}. Use its number or its name: ${s.inputs.map(x => `${x.id} ${x.name}`).join(', ')}.`;
const nameOf = (s, id) => (s.inputs.find(i => i.id === id) || {}).name || `input ${id}`;

// A stinger to an input (or what's on preview): the input goes on preview, the stinger plays on Output 1, and
// once its page says it has started (with when it covers the frame, from its own settings) the cut lands in
// the middle of the cover, moved by the line-up in frames. test cuts 2 frames after the cover starts instead,
// so a line-up that's out shows as the old picture flashing before the bands. With no stinger in the scene
// it's an auto; if the stinger doesn't start within 3 s, a plain cut.
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
// One at a time: a second press while one plays (a nervous double tap) is left out, so there's only ever one cut.
let stingerBusy = false;
async function stingerCut(s, a, why, test = false) {
  if (stingerBusy) {
    log('warn', 'switcher', `${why}: a stinger is already playing, so this one was left out`);
    return { error: 'A stinger is already playing, so this one was left out.', status: 409 };
  }
  stingerBusy = true;
  try { return await stingerPlay(s, a, why, test); } finally { stingerBusy = false; }
}
async function stingerPlay(s, a, why, test) {
  let to = s.preview;
  let onProgram = false; // the input is on program already: the stinger plays (over the graphics changing), with no cut
  if (a.input !== undefined && a.input !== null && a.input !== '') {
    const i = inputOf(s, a.input);
    if (!i) return { error: noInput(s, a.input), status: 404 };
    onProgram = i.id === s.program && !test;
    if (!onProgram && i.id !== s.preview) await atem.changePreviewInput(i.id, 0);
    to = i.id;
  }
  const name = nameOf(s, to);
  const src = stingerApi && stingerApi.find(a.source);
  if (!src) {
    if (onProgram) return `${name} is already on program`;
    log('warn', 'switcher', `${why}: there's no stinger in the scene (add the Stinger page as a source), so an auto instead`);
    await atem.autoTransition(0);
    return `auto to ${name} (no stinger in the scene)`;
  }
  const heard = new Promise(resolve => {
    const timer = setTimeout(() => { stingerWait = null; resolve(null); }, STINGER_WAIT_MS);
    stingerWait = { resolve: c => { clearTimeout(timer); stingerWait = null; resolve(c); } };
  });
  if (!stingerApi.play(src.id)) { stingerWait.resolve(null); }
  const cover = await heard;
  if (!atem || atem.status !== 2) throw new Error('the switcher stopped answering during the stinger');
  if (onProgram) return `stinger only (${name} is already on program)`;
  if (!cover) {
    log('warn', 'switcher', `${why}: the stinger "${src.name}" didn't start within ${STINGER_WAIT_MS / 1000} s, so a plain cut`);
    await atem.cut(0);
    return `cut to ${name} (the stinger didn't start)`;
  }
  const frame = 1000 / s.fps;
  const at = (test ? cover.from * 1000 + 2 * frame : (cover.from + cover.to) / 2 * 1000) + lineup * frame;
  await sleep(at - (now() - cover.at));
  if (!atem || atem.status !== 2) throw new Error('the switcher stopped answering during the stinger');
  await atem.cut(0);
  const secs = (at / 1000).toFixed(2);
  return `stinger to ${name} (cut at ${secs} s, covered ${cover.from.toFixed(2)} to ${cover.to.toFixed(2)} s${lineup ? `, line-up ${lineup > 0 ? '+' : ''}${lineup} frames` : ''})`;
}
// The stinger page (through scene.html on Output 1) says it has started: [from, to] seconds it covers the frame.
function stingerStarted(cover) {
  const c = Array.isArray(cover) ? cover.map(Number) : [];
  if (!stingerWait || c.length !== 2 || !c.every(x => Number.isFinite(x) && x >= 0 && x < 10) || c[1] <= c[0]) return;
  stingerWait.resolve({ from: c[0], to: c[1], at: now() });
}

// Does one thing on the switcher: { type: 'cut' | 'auto' | 'ftb' | 'preview' | 'program' (input) |
// 'usk' (key, on: true | false | 'toggle') | 'dsk' (key, on: true | false | 'toggle' | 'auto') | 'macro' (number) |
// 'stinger' (input, source: the stinger source when the scene has more than one; test) }.
// Keys and macros count from 1, as on the switcher. Gives { ok, ... } or { error }; nothing is queued
// for later when the switcher isn't answering.
async function act(a, why = 'Output page') {
  const s = conn === 'connected' ? summary() : null;
  const what = a && a.type;
  if (!s) {
    const err = !pick ? 'No switcher is set up: pick one on the Output page, under Switcher.' : `The switcher isn't answering, so nothing was sent (${what || 'nothing'}).`;
    log('warn', 'switcher', `${why}: ${err}`);
    return { error: err, status: 409 };
  }
  const key = (count, n) => { const k = Math.round(Number(n)); return k >= 1 && k <= count ? k : null; };
  let done;
  try {
    if (what === 'cut' || what === 'auto') {
      // To an input: it goes on preview first, then the cut or auto takes it (and what was on goes to preview).
      let to = s.preview;
      if (a.input !== undefined && a.input !== null && a.input !== '') {
        const i = inputOf(s, a.input);
        if (!i) return { error: noInput(s, a.input), status: 404 };
        if (i.id === s.program) return { ok: true, done: `${i.name} is already on program` };
        if (i.id !== s.preview) await atem.changePreviewInput(i.id, 0);
        to = i.id;
      }
      if (what === 'cut') await atem.cut(0); else await atem.autoTransition(0);
      done = `${what} to ${nameOf(s, to)}`;
    } else if (what === 'stinger') {
      done = await stingerCut(s, a, why, !!a.test);
      if (done.error) return done;
    } else if (what === 'ftb') {
      // on: 'on' fades to black, 'off' fades back; left out, it goes whichever way it isn't.
      if ((a.on === 'on' || a.on === true) && s.ftb) return { ok: true, done: 'already faded to black' };
      if ((a.on === 'off' || a.on === false) && !s.ftb) return { ok: true, done: 'not faded to black' };
      await atem.fadeToBlack(0);
      done = s.ftb ? 'fade back from black' : 'fade to black';
    }
    else if (what === 'preview' || what === 'program') {
      const i = inputOf(s, a.input);
      if (!i) return { error: noInput(s, a.input), status: 404 };
      if (what === 'preview') await atem.changePreviewInput(i.id, 0); else await atem.changeProgramInput(i.id, 0);
      done = `${what === 'preview' ? 'preview' : 'cut'} to ${i.name}`;
    } else if (what === 'usk' || what === 'dsk') {
      const list = what === 'usk' ? s.usk : s.dsk;
      const k = key(list.length, a.key);
      const label = what === 'usk' ? 'upstream key' : 'downstream key';
      if (!k) return { error: `The ${s.model} has ${list.length === 1 ? `one ${label}` : `${list.length} ${label}s`}${list.length > 1 ? ` (1 to ${list.length})` : ''}, so there's no ${label} ${a.key}.`, status: 404 };
      if (what === 'dsk' && (a.on === 'auto' || a.mix)) {
        // At the key's own rate: 'auto' goes whichever way it isn't; with mix, on or off as asked.
        const on = a.on === 'auto' || a.on === 'toggle' ? !list[k - 1] : a.on === true || a.on === 'on';
        if (on === list[k - 1]) return { ok: true, done: `downstream key ${k} is already ${on ? 'on' : 'off'}` };
        await atem.autoDownstreamKey(k - 1, on);
        done = `downstream key ${k} ${on ? 'on' : 'off'} (auto)`;
      } else {
        const on = a.on === 'toggle' ? !list[k - 1] : a.on === true || a.on === 'on';
        if (what === 'usk') await atem.setUpstreamKeyerOnAir(on, 0, k - 1); else await atem.setDownstreamKeyOnAir(on, k - 1);
        done = `${label} ${k} ${on ? 'on' : 'off'}`;
      }
    } else if (what === 'macro') {
      const n = Math.round(Number(a.macro));
      if (!(n >= 1 && n <= 100)) return { error: 'Macros are numbered from 1, as on the switcher.', status: 400 };
      await atem.macroRun(n - 1);
      done = `macro ${n}`;
    } else return { error: `Unknown switcher action "${what}".`, status: 400 };
  } catch (err) {
    log('warn', 'switcher', `${why}: ${what} failed: ${err && err.message || 'the switcher stopped answering'}`);
    return { error: `The switcher didn't take it (${err && err.message || 'it stopped answering'}).`, status: 502 };
  }
  log('info', 'switcher', `${why}: ${done}`);
  await settled();
  return { ok: true, done };
}

// ─── Switcher actions on sequence steps and scenes ─────────────────────────
// Saved on a sequence's source or scene step (step.switcher) and on a scene (scene.switcher): up to 8, each
// { type, input?, name?, key?, on?, mix?, macro?, atSec } done atSec seconds after the step starts or the
// scene is picked. input is the switcher's input number (name is its name when saved, to show while the
// switcher isn't answering). They fire only for what plays on the primary output.
const ACTION_TYPES = ['cut', 'auto', 'stinger', 'preview', 'usk', 'dsk', 'ftb', 'macro'];
const MAX_ACTIONS = 8;
function cleanActions(list) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) continue;
    const n = (v, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo; };
    const atSec = Math.round(Math.min(60, Math.max(0, Number(a.atSec) || 0)) * 10) / 10;
    const c = { type: a.type };
    if (['cut', 'auto', 'stinger', 'preview'].includes(a.type)) {
      const input = Math.round(Number(a.input));
      if (Number.isFinite(input) && input >= 1 && input <= 9999) {
        c.input = input;
        const name = String(a.name || '').trim().slice(0, 40);
        if (name) c.name = name;
      } else if (a.type === 'preview') continue; // preview needs an input; cut and auto take what's on preview
    } else if (a.type === 'usk' || a.type === 'dsk') {
      c.key = n(a.key, 1, 4);
      c.on = ['on', 'off', 'toggle'].includes(a.on) ? a.on : 'on';
      if (a.type === 'dsk' && a.mix) c.mix = true;
    } else if (a.type === 'ftb') c.on = a.on === 'off' ? 'off' : 'on';
    else if (a.type === 'macro') c.macro = n(a.macro, 1, 100);
    c.atSec = atSec;
    out.push(c);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}
// One action in words, for the log and the Output page ("cut to Court", "downstream key 1 on (auto)").
function describe(a) {
  const to = a.input ? ` to ${a.name || `input ${a.input}`}` : ' to what\'s on preview';
  const what = a.type === 'cut' ? `cut${to}` : a.type === 'auto' ? `auto${to}` : a.type === 'stinger' ? `stinger${to}`
    : a.type === 'preview' ? `${a.name || `input ${a.input}`} on preview`
    : a.type === 'usk' ? `upstream key ${a.key} ${a.on}`
    : a.type === 'dsk' ? `downstream key ${a.key} ${a.on}${a.mix ? ' (auto)' : ''}`
    : a.type === 'ftb' ? (a.on === 'off' ? 'fade back from black' : 'fade to black')
    : `macro ${a.macro}`;
  return a.atSec ? `${what} at ${a.atSec} s` : what;
}
// Does actions (cleaned) for owner ('sequence' or 'scene'): those at 0 s now, the rest on timers, each
// time's in order (a preview before the cut). Anything still waiting for that owner is called off first.
// When the switcher isn't answering, or hasn't what an action needs, it's skipped and logged, never queued.
const waiting = new Map(); // owner -> [timer]
function cancel(owner) {
  for (const t of waiting.get(owner) || []) clearTimeout(t);
  waiting.delete(owner);
}
function run(actions, why, owner) {
  cancel(owner);
  if (!actions || !actions.length) return;
  const at = new Map();
  for (const a of actions) at.set(a.atSec || 0, [...(at.get(a.atSec || 0) || []), a]);
  const go = async group => {
    for (const a of group) {
      const r = await act(a, why);
      // act logs a switcher that isn't there or didn't take it; what it hasn't got is logged here.
      if (r.error && r.status !== 409 && r.status !== 502) log('warn', 'switcher', `${why}: skipped ${describe({ ...a, atSec: 0 })}: ${r.error}`);
      if (r.status === 409) return; // nothing more to send it
    }
  };
  const timers = [];
  for (const [sec, group] of [...at].sort((x, y) => x[0] - y[0])) {
    if (!sec) go(group);
    else timers.push(setTimeout(() => go(group), sec * 1000));
  }
  if (timers.length) waiting.set(owner, timers);
}

// ─── Settings from the Output page ────────────────────────────────────────
// { type: 'use', name } a found switcher, { type: 'use', address } a typed one, { type: 'forget' },
// { type: 'reconnect' }.
async function settings(a) {
  if (a.type === 'forget') {
    if (pick) log('info', 'switcher', `Forgot the switcher (${pick.name || pick.address})`);
    pick = null;
    save();
    await connect();
    return { ok: true };
  }
  if (a.type === 'reconnect') { await connect(); return { ok: true }; }
  if (a.type === 'stingerStarted') { stingerStarted(a.cover); return { ok: true }; }
  if (a.type === 'lineup') {
    lineup = cleanLineup(a.frames);
    log('info', 'switcher', `Stinger line-up ${lineup} frames`);
    save();
    changed();
    return { ok: true };
  }
  if (a.type === 'lineupTest') return act({ type: 'stinger', test: true, input: a.input }, 'Line-up test');
  if (a.type !== 'use') return null;
  if (a.name) {
    const f = found.find(x => x.name === a.name);
    if (!f) return { error: `"${a.name}" wasn't found on the network. Look again, or type its address.`, status: 404 };
    pick = { kind: 'found', name: f.name, host: f.host, port: f.port, address: f.address };
  } else {
    const p = parseAddress(a.address);
    if (!p) return { error: 'Type the switcher\'s IP address, such as 192.168.10.240 (as set in ATEM Setup).', status: 400 };
    pick = { kind: 'address', ...p };
  }
  log('info', 'switcher', `Using the switcher ${pick.kind === 'found' ? `"${pick.name}"` : `at ${pick.address}${pick.port !== PORT ? `:${pick.port}` : ''}`}`);
  save();
  await connect();
  return { ok: true };
}

// ─── HTTP and Stream Deck links ───────────────────────────────────────────
const ACTIONS = ['cut', 'auto', 'stinger', 'ftb', 'preview', 'program', 'usk', 'dsk', 'macro'];
async function route(req, res, url, { send, readBody }) {
  if (url.pathname === '/api/switcher/find') {
    if (req.method === 'POST') await find();
    send(res, 200, status());
    return true;
  }
  if (url.pathname !== '/api/switcher') return false;
  if (req.method === 'POST') {
    const a = await readBody(req).catch(() => ({}));
    const r = ACTIONS.includes(a.type) ? await act(a) : await settings(a);
    if (!r) { send(res, 400, { error: `Unknown switcher request "${a.type}".` }); return true; }
    if (r.error) { send(res, r.status || 400, { error: r.error, ...status() }); return true; }
  }
  send(res, 200, status());
  return true;
}
// /deck/switcher/...: { status, body } or null when the link isn't one of the switcher's.
async function deck(parts) {
  if (parts[0] !== 'switcher') return null;
  const [, what, n, verb] = parts;
  const usage = { status: 404, body: { error: 'Use /deck/switcher/cut, auto, stinger (or stinger/<input>), ftb, preview/<input>, program/<input>, usk/<n>/on|off|toggle, dsk/<n>/on|off|toggle|auto or macro/<n>.' } };
  let a;
  if (['cut', 'auto', 'ftb'].includes(what) && !n) a = { type: what };
  else if ((what === 'preview' || what === 'program') && n) a = { type: what, input: n };
  else if (what === 'stinger' && !verb) a = n ? { type: what, input: n } : { type: what };
  else if (what === 'usk' && n && ['on', 'off', 'toggle'].includes(verb)) a = { type: 'usk', key: n, on: verb === 'toggle' ? 'toggle' : verb === 'on' };
  else if (what === 'dsk' && n && ['on', 'off', 'toggle', 'auto'].includes(verb)) a = { type: 'dsk', key: n, on: ['toggle', 'auto'].includes(verb) ? verb : verb === 'on' };
  else if (what === 'macro' && n) a = { type: 'macro', macro: n };
  else return usage;
  const r = await act(a, 'Stream Deck');
  if (r.error) return { status: r.status || 400, body: { error: r.error } };
  const s = status();
  return { status: 200, body: { ok: true, done: r.done, program: s.program, preview: s.preview, usk: s.usk, dsk: s.dsk } };
}

function init(logger, { changed: onChanged, stinger } = {}) {
  log = logger;
  if (onChanged) onChange = onChanged;
  if (stinger) stingerApi = stinger;
  load();
  if (pick) connect();
}

module.exports = { init, route, deck, act, run, cancel, cleanActions, describe, status, find, FILE, parseBrowse, parseLookup, parseAddress };
