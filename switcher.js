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
// Outputs on an upstream key can name the cameras their graphics go with: Studio's own cuts, autos and stingers take
// those keys in the same transition as the camera (the switcher's next transition selection), and with Keys follow
// the camera on, a cut made anywhere else (the switcher's panel, ATEM Software Control) brings them straight after.
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
const listeners = new Set(); // server-sent events (/api/switcher/events): the Stream Deck plugin's Switcher keys
// Stinger cuts: Studio plays the scene's stinger (stinger.html) on Output 1 and cuts while it covers the frame.
let follow = true;            // Keys follow the camera: after a cut made elsewhere, paired outputs' keys follow the program camera
let lastProgram = null;       // the program input Keys follow the camera last saw
let followTimer = null;
let lineup = 0;               // frames to cut later (or earlier, below 0) than the middle of the cover, for the picture's delay into the switcher
let stingerApi = null;        // { find(ref), play(id) } from scene.js
let outputsPlan = () => [];   // what each output gives the switcher (outputs.js switcherPlan), for the key settings check
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
  for (const res of listeners) res.write(`data: ${key}\n\n`);
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
    follow = saved.follow !== false;
  } catch (err) { if (err.code !== 'ENOENT') log('warn', 'switcher', `Could not read switcher.json: ${err.message}`); pick = null; lineup = 0; follow = true; }
}
function save() {
  try { savefile.writeJsonSync(FILE, { pick, lineup, follow }); }
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
    lastProgram = s.program; // what's on now isn't a cut to follow: nothing is sent on connecting
    setConn('connected');
  });
  a.on('disconnected', () => {
    if (atem !== a) return;
    log('warn', 'switcher', `The switcher at ${target} stopped answering; trying again`);
    setConn('lost', 'Not answering');
    startRefind();
  });
  a.on('stateChanged', () => { if (atem === a) { changed(); followSoon(); } });
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
    follow,
    stinger: (stingerApi && stingerApi.find()) ? stingerApi.find().name : '',
    keys: s ? keyChecks(s) : [],
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
    const keys = await take(s, 'auto', to);
    return `auto to ${name}${keys} (no stinger in the scene)`;
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
    const keys = await take(s, 'cut', to);
    return `cut to ${name}${keys} (the stinger didn't start)`;
  }
  const frame = 1000 / s.fps;
  const at = (test ? cover.from * 1000 + 2 * frame : (cover.from + cover.to) / 2 * 1000) + lineup * frame;
  await sleep(at - (now() - cover.at));
  if (!atem || atem.status !== 2) throw new Error('the switcher stopped answering during the stinger');
  const keys = await take(s, 'cut', to);
  const secs = (at / 1000).toFixed(2);
  return `stinger to ${name}${keys} (cut at ${secs} s, covered ${cover.from.toFixed(2)} to ${cover.to.toFixed(2)} s${lineup ? `, line-up ${lineup > 0 ? '+' : ''}${lineup} frames` : ''})`;
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
      done = `${what} to ${nameOf(s, to)}${await take(s, what, to)}`;
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
      if (what === 'preview') await atem.changePreviewInput(i.id, 0);
      else {
        // Straight to program (the program bus, preview stays): the paired keys follow straight after.
        const changes = pairedChanges(s, i.id);
        await atem.changeProgramInput(i.id, 0);
        for (const c of changes) await atem.setUpstreamKeyerOnAir(c.on, 0, c.k);
        lastProgram = i.id;
        done = `cut to ${i.name}${keysText(changes)}`;
      }
      if (what === 'preview') done = `preview to ${i.name}`;
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
// owner -> a number that goes up each time its actions are called off, so a group part way through (waiting
// for a stinger, say) stops before its next action too.
const runs = new Map();
function cancel(owner) {
  for (const t of waiting.get(owner) || []) clearTimeout(t);
  waiting.delete(owner);
  runs.set(owner, (runs.get(owner) || 0) + 1);
}
function run(actions, why, owner) {
  cancel(owner);
  if (!actions || !actions.length) return;
  const mine = runs.get(owner);
  const at = new Map();
  for (const a of actions) at.set(a.atSec || 0, [...(at.get(a.atSec || 0) || []), a]);
  const go = async group => {
    for (const a of group) {
      if (runs.get(owner) !== mine) return; // called off
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

// ─── Cameras and their outputs' keys ──────────────────────────────────────
// An output on an upstream key with cameras named goes on air with them: its key should be on while one of its
// cameras is on program and off otherwise. Outputs whose key check has a problem (two on one key, a key the switcher
// hasn't got) are left alone, as are downstream keys (over every camera) and outputs with no cameras.
const KEY_BIT = k => 2 << k;  // the switcher's next transition selection: bit 0 the background, bits 1 to 4 upstream keys 1 to 4
function pairedChanges(s, to) {
  const out = [];
  for (const c of keyChecks(s)) {
    if (!c.cameras.length || c.problems.length || !c.keyer.startsWith('usk')) continue;
    const k = Number(c.keyer.slice(3)) - 1;
    const on = c.cameras.includes(to);
    if (s.usk[k] !== on) out.push({ k, on, name: c.name });
  }
  return out;
}
const keysText = changes => changes.length ? `, with ${changes.map(c => `${c.name}'s key ${c.on ? 'on' : 'off'}`).join(' and ')}` : '';
// Cuts or autos to input to (already on preview), taking the paired keys that need to change in the same
// transition, so the camera and its graphics change on the same frame. The switcher's next transition selection is
// put back as it was afterwards, so the panel's BKGD and KEY buttons are as the operator left them. Gives the keys in words.
async function take(s, kind, to) {
  const changes = pairedChanges(summary() || s, to); // as the keys are now (a stinger may have played meanwhile)
  const go = () => (kind === 'auto' ? atem.autoTransition(0) : atem.cut(0));
  if (!changes.length) { await go(); return ''; }
  const { Enums } = loadLibrary();
  const me = (atem.state.video.mixEffects || [])[0] || {};
  const before = ((me.transitionProperties || {}).nextSelection || [Enums.TransitionSelection.Background]).slice();
  const mask = changes.reduce((m, c) => m | KEY_BIT(c.k), 1);
  const sel = Object.values(Enums.TransitionSelection).filter(v => typeof v === 'number' && (mask & v));
  await atem.setTransitionStyle({ nextSelection: sel }, 0);
  await go();
  const a = atem;
  // A cut has happened by the time the switcher answers; an auto takes its rate, and the selection is put back once it's over.
  const restore = async () => {
    for (let n = 0; kind === 'auto' && n < 100 && a === atem && a.state.video.mixEffects[0].transitionPosition?.inTransition; n++) await sleep(50);
    if (a === atem && a.status === 2) await a.setTransitionStyle({ nextSelection: before }, 0).catch(() => {});
  };
  if (kind === 'auto') restore(); else { await settled(); await restore(); }
  return keysText(changes);
}
// Keys follow the camera: a cut made anywhere else changes program, and the paired outputs' keys follow a moment
// later (one or two frames). Only on a change of program camera, so a key turned on or off by hand stays as it is;
// never while connecting. Studio's own cuts already took the keys, so there's nothing left to send then.
function followSoon() {
  const st = atem && atem.status === 2 && atem.state;
  const program = st ? ((st.video.mixEffects || [])[0] || {}).programInput : null;
  if (program === undefined || program === null || program === lastProgram) return;
  lastProgram = program;
  if (!follow) return;
  clearTimeout(followTimer);
  followTimer = setTimeout(followNow, 40);
}
async function followNow() {
  const s = conn === 'connected' ? summary() : null;
  if (!s || !follow) return;
  if (s.inTransition) { followTimer = setTimeout(followNow, 40); return; } // an auto on the panel: once it's done
  const changes = pairedChanges(s, s.program);
  if (!changes.length) return;
  try {
    for (const c of changes) await atem.setUpstreamKeyerOnAir(c.on, 0, c.k);
    log('info', 'switcher', `Keys follow the camera: ${nameOf(s, s.program)} on program${keysText(changes)}`);
  } catch (err) { log('warn', 'switcher', `Keys follow the camera: ${err && err.message || 'the switcher stopped answering'}`); }
}

// ─── The outputs' keys: a check of their settings, and setting them up ───────
// Each output comes into one of the switcher's keys (its Into the switcher as on the Output page). Studio reads how
// that key is set up in ATEM Software Control and says what doesn't suit the output's signal: the key's fill and
// key inputs, its type (a chroma output needs an upstream key on Chroma), and Pre Multiplied Key (on for Studio's
// premultiplied fill, off only for a Blackmagic device sending Straight). It only reads: the key is changed only when
// Set up this key for me is pressed (keySetup), and never its on air, colour, clip, gain or position.
const KEYER_LABEL = k => `${k.startsWith('dsk') ? 'downstream' : 'upstream'} key ${k.slice(3)}`;
const ucFirst = t => t.charAt(0).toUpperCase() + t.slice(1);
function keyChecks(s) {
  let plan;
  try { plan = outputsPlan() || []; } catch { plan = []; }
  const st = atem.state;
  const me = (st.video.mixEffects || [])[0] || {};
  const src = id => { const i = (st.inputs || {})[id]; return i ? i.longName || `input ${id}` : `input ${id}`; };
  const yes = b => (b ? 'on' : 'off');
  return plan.map(o => {
    const c = { output: o.id, name: o.name, colour: o.colour, keyer: o.keyer, label: o.keyer === 'none' ? '' : ucFirst(KEYER_LABEL(o.keyer)),
      onAir: false, problems: [], fixes: [], cameras: o.keyer.startsWith('usk') ? o.cameras || [] : [], withCamera: '' };
    if (o.keyer === 'none') return c;
    const usk = o.keyer.startsWith('usk');
    const k = Number(o.keyer.slice(3)) - 1;
    const count = usk ? s.usk.length : s.dsk.length;
    const label = KEYER_LABEL(o.keyer);
    if (k >= count) {
      c.problems.push(`The ${s.model} has ${count === 1 ? 'one' : count || 'no'} ${usk ? 'upstream' : 'downstream'} key${count === 1 ? '' : 's'}, so there's no ${label}: pick another.`);
      return c;
    }
    c.onAir = usk ? s.usk[k] : s.dsk[k];
    // With its cameras: "On air with Court", or "Waiting for Court or Bench" while another camera is on program.
    if (c.cameras.length) {
      c.withCamera = c.cameras.includes(s.program) ? `${c.onAir ? 'On air' : 'Off air'} with ${src(s.program)}`
        : `Waiting for ${c.cameras.map(src).join(' or ')}`;
    }
    // Shown on both outputs, so whichever one the operator looks at says so.
    const others = plan.filter(x => x !== o && x.keyer === o.keyer).map(x => x.name);
    if (others.length) c.problems.push(`${others.join(' and ')} ${others.length === 1 ? 'comes' : 'come'} into ${label} too: pick another key for one of them.`);
    if (o.signal === 'alpha') c.problems.push('An ATEM can\'t key NDI with transparency: send it as Fill and key (two NDI sources) or Chroma.');
    if (o.signal === 'fill') c.problems.push('Fill only has no key for the switcher to key with: send Fill and key.');
    if (o.signal === 'chroma' && !usk) c.problems.push('A chroma key needs an upstream key (a downstream key only keys fill and key): pick an upstream key.');
    const chroma = o.signal === 'chroma';
    if (!o.fill) c.problems.push(`Pick the switcher input ${chroma ? 'it' : 'its fill'} comes into.`);
    if (!chroma && o.signal === 'fillkey' && !o.key) c.problems.push('Pick the switcher input its key comes into.');
    if (!chroma && o.fill && o.fill === o.key) c.problems.push('Its fill and key come into different inputs: pick each one.');
    for (const id of [o.fill, chroma ? 0 : o.key]) if (id && !s.inputs.some(i => i.id === id)) c.problems.push(`The ${s.model} has no input ${id}.`);
    if (c.problems.length) return c;
    // What the key has, against what the output needs.
    const want = { fill: o.fill, cut: chroma ? null : o.key, pre: chroma ? null : o.premultiplied, type: usk ? (chroma ? 1 : 0) : null };
    const has = usk ? (() => { const u = (me.upstreamKeyers || [])[k] || {};
      return { fill: u.fillSource, cut: u.cutSource, pre: !!(u.lumaSettings && u.lumaSettings.preMultiplied), type: u.mixEffectKeyType }; })()
      : (() => { const d = (st.video.downstreamKeyers || [])[k] || {};
        return { fill: (d.sources || {}).fillSource, cut: (d.sources || {}).cutSource, pre: !!(d.properties && d.properties.preMultiply), type: null }; })();
    const TYPES = ['Luma', 'Chroma', 'Pattern', 'DVE'];
    if (want.type !== null && has.type !== want.type) c.fixes.push(`Key type is ${TYPES[has.type] || 'something else'}, should be ${TYPES[want.type]}`);
    if (has.fill !== want.fill) c.fixes.push(`Fill source is ${src(has.fill)}, should be ${src(want.fill)}`);
    if (want.cut !== null && has.cut !== want.cut) c.fixes.push(`Key source is ${src(has.cut)}, should be ${src(want.cut)}`);
    if (want.pre !== null && has.pre !== want.pre) c.fixes.push(`Pre Multiplied Key is ${yes(has.pre)}, should be ${yes(want.pre)}`);
    c.want = want;
    return c;
  });
}
// Set up this key for me: changes only what the check found different, on the key the output comes into.
async function keySetup(a) {
  const s = conn === 'connected' ? summary() : null;
  if (!s) return { error: !pick ? 'No switcher is set up: pick one on the Output page, under Switcher.' : 'The switcher isn\'t answering, so nothing was changed.', status: 409 };
  const c = keyChecks(s).find(x => x.output === String(a.output));
  if (!c) return { error: `No output "${a.output}" sending to the switcher.`, status: 404 };
  if (c.keyer === 'none') return { error: `${c.name} isn't keyed by the switcher.`, status: 400 };
  if (c.problems.length) return { error: c.problems[0], status: 409 };
  if (!c.fixes.length) return { ok: true, done: `${c.label} is already set up for ${c.name}` };
  const k = Number(c.keyer.slice(3)) - 1;
  const w = c.want;
  try {
    if (c.keyer.startsWith('usk')) {
      await atem.setUpstreamKeyerType({ mixEffectKeyType: w.type }, 0, k);
      await atem.setUpstreamKeyerFillSource(w.fill, 0, k);
      if (w.cut !== null) await atem.setUpstreamKeyerCutSource(w.cut, 0, k);
      if (w.pre !== null) await atem.setUpstreamKeyerLumaSettings({ preMultiplied: w.pre }, 0, k);
    } else {
      await atem.setDownstreamKeyFillSource(w.fill, k);
      await atem.setDownstreamKeyCutSource(w.cut, k);
      await atem.setDownstreamKeyGeneralProperties({ preMultiply: w.pre }, k);
    }
  } catch (err) {
    log('warn', 'switcher', `Setting up ${KEYER_LABEL(c.keyer)} for ${c.name} failed: ${err && err.message || 'the switcher stopped answering'}`);
    return { error: `The switcher didn't take it (${err && err.message || 'it stopped answering'}).`, status: 502 };
  }
  const done = `set up ${KEYER_LABEL(c.keyer)} for ${c.name}: ${c.fixes.map(f => f.replace(/ is .*, should be /, ' ')).join(', ')}`;
  log('info', 'switcher', `Output page: ${done}`);
  await settled();
  return { ok: true, done };
}

// ─── Settings from the Output page ────────────────────────────────────────
// { type: 'use', name } a found switcher, { type: 'use', address } a typed one, { type: 'forget' },
// { type: 'reconnect' }, { type: 'keySetup', output } (an output's key, as its key settings check says).
async function settings(a) {
  if (a.type === 'keySetup') return keySetup(a);
  if (a.type === 'follow') {
    follow = a.on !== false;
    log('info', 'switcher', `Keys follow the camera ${follow ? 'on' : 'off'}`);
    save();
    changed();
    return { ok: true };
  }
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
  if (url.pathname === '/api/switcher/events') {
    // Server-sent events: the switcher now, then again on every change (tally, keys, losing it), for the
    // Stream Deck plugin. The Output page has it over the scene socket instead.
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`retry: 1000\ndata: ${JSON.stringify(status())}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); });
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

// changed(): the switcher's state changed; stinger: { find, play } (scene.js); outputs(): outputs.js switcherPlan.
function init(logger, { changed: onChanged, stinger, outputs } = {}) {
  log = logger;
  if (outputs) outputsPlan = outputs;
  if (onChanged) onChange = onChanged;
  if (stinger) stingerApi = stinger;
  load();
  if (pick) connect();
}

// The outputs changed: their key settings check may say something else now.
const refresh = () => changed();

module.exports = { init, route, deck, act, run, cancel, cleanActions, describe, status, find, refresh, FILE, parseBrowse, parseLookup, parseAddress };
