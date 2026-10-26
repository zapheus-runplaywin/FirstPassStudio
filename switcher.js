// FirstPass Studio - controlling a Blackmagic ATEM switcher over the network (optional).
//
// Studio finds the ATEMs on the network the way ATEM Software Control does (Bonjour, _blackmagic._tcp,
// browsed with macOS's own dns-sd), or takes a typed address, and keeps one connection to the one picked,
// using atem-connection (Blackmagic's control protocol over UDP port 9910). The switcher's own buttons,
// ATEM Software Control and other controllers keep working alongside it: Studio follows what they do and
// only sends something when a button, a Stream Deck key or (later) a sequence asks for it. On connecting
// or reconnecting it sends nothing, so a cut is never replayed late.
//
// It reads what the switcher has (its model, inputs and their names, upstream and downstream keys) rather
// than assuming a model, so an ATEM Mini Pro (1 upstream key, 1 downstream key, 4 inputs) works the same
// way as a Mini Extreme (4, 2 and 8), offering only what it has.
//
// Saved as switcher.json in the data folder: one switcher for the Mac, not per competition. The helper only
// runs while Studio is on air, so the connection opens when Studio goes on air and closes with it.
// Stream Deck: /deck/switcher/cut, auto, ftb, preview/<input>, program/<input>, usk/<n>/on|off|toggle,
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
function load() {
  try { pick = cleanPick(JSON.parse(fs.readFileSync(FILE, 'utf8')).pick); }
  catch (err) { if (err.code !== 'ENOENT') log('warn', 'switcher', `Could not read switcher.json: ${err.message}`); pick = null; }
}
function save() {
  try { savefile.writeJsonSync(FILE, { pick }); }
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
async function connect() {
  await disconnect();
  if (!pick) { setConn('off'); return; }
  let lib;
  try { lib = loadLibrary(); }
  catch (err) { log('error', 'switcher', `Switcher control isn't available: ${err.message}`); setConn('error', `Switcher control isn't available in this copy of Studio (${err.message})`); return; }
  setConn('connecting');
  let target = pick.address;
  if (pick.kind === 'found') {
    // Remembered by name: ask the network where it is now, in case its address changed.
    const fresh = (await lookupHost(pick.host)) || ((await find()).find(f => f.name === pick.name) || {}).address;
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
  catch (err) { setConn('error', err.message); }
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
const nameOf = (s, id) => (s.inputs.find(i => i.id === id) || {}).name || `input ${id}`;

// Does one thing on the switcher: { type: 'cut' | 'auto' | 'ftb' | 'preview' | 'program' (input) |
// 'usk' (key, on: true | false | 'toggle') | 'dsk' (key, on: true | false | 'toggle' | 'auto') | 'macro' (number) }.
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
    if (what === 'cut') { await atem.cut(0); done = `cut to ${nameOf(s, s.preview)}`; }
    else if (what === 'auto') { await atem.autoTransition(0); done = `auto to ${nameOf(s, s.preview)}`; }
    else if (what === 'ftb') { await atem.fadeToBlack(0); done = s.ftb ? 'fade back from black' : 'fade to black'; }
    else if (what === 'preview' || what === 'program') {
      const i = inputOf(s, a.input);
      if (!i) return { error: `No input "${a.input}" on the ${s.model}. Use its number or its name: ${s.inputs.map(x => `${x.id} ${x.name}`).join(', ')}.`, status: 404 };
      if (what === 'preview') await atem.changePreviewInput(i.id, 0); else await atem.changeProgramInput(i.id, 0);
      done = `${what === 'preview' ? 'preview' : 'cut'} to ${i.name}`;
    } else if (what === 'usk' || what === 'dsk') {
      const list = what === 'usk' ? s.usk : s.dsk;
      const k = key(list.length, a.key);
      const label = what === 'usk' ? 'upstream key' : 'downstream key';
      if (!k) return { error: `The ${s.model} has ${list.length === 1 ? `one ${label}` : `${list.length} ${label}s`}${list.length > 1 ? ` (1 to ${list.length})` : ''}, so there's no ${label} ${a.key}.`, status: 404 };
      if (what === 'dsk' && a.on === 'auto') { await atem.autoDownstreamKey(k - 1, !list[k - 1]); done = `downstream key ${k} ${list[k - 1] ? 'off' : 'on'} (auto)`; }
      else {
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
const ACTIONS = ['cut', 'auto', 'ftb', 'preview', 'program', 'usk', 'dsk', 'macro'];
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
  const usage = { status: 404, body: { error: 'Use /deck/switcher/cut, auto, ftb, preview/<input>, program/<input>, usk/<n>/on|off|toggle, dsk/<n>/on|off|toggle|auto or macro/<n>.' } };
  let a;
  if (['cut', 'auto', 'ftb'].includes(what) && !n) a = { type: what };
  else if ((what === 'preview' || what === 'program') && n) a = { type: what, input: n };
  else if (what === 'usk' && n && ['on', 'off', 'toggle'].includes(verb)) a = { type: 'usk', key: n, on: verb === 'toggle' ? 'toggle' : verb === 'on' };
  else if (what === 'dsk' && n && ['on', 'off', 'toggle', 'auto'].includes(verb)) a = { type: 'dsk', key: n, on: ['toggle', 'auto'].includes(verb) ? verb : verb === 'on' };
  else if (what === 'macro' && n) a = { type: 'macro', macro: n };
  else return usage;
  const r = await act(a, 'Stream Deck');
  if (r.error) return { status: r.status || 400, body: { error: r.error } };
  const s = status();
  return { status: 200, body: { ok: true, done: r.done, program: s.program, preview: s.preview, usk: s.usk, dsk: s.dsk } };
}

function init(logger, { changed: onChanged } = {}) {
  log = logger;
  if (onChanged) onChange = onChanged;
  load();
  if (pick) connect();
}

module.exports = { init, route, deck, act, status, find, FILE, parseBrowse, parseLookup, parseAddress };
