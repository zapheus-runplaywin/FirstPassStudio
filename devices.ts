// FirstPass Studio - the devices allowed to change things from another device, listed in the Devices… window.
//
// The list starts with "This Mac's links", the key in every Stream Deck link copied from Studio (/k/<key>/deck/...,
// access.deckPress()). More named link sets ("Office Stream Deck") can be made on the Mac (addLinks()), each with its
// own key, so the Website keys on one Stream Deck can be given a new key, or removed, without touching the others.
// A program on another device (a script, curl, the Stream Deck plugin, a phone or another computer's browser)
// asks to be added (ask()): the Mac shows a dialog naming it and its address (desktop/main.js), or the Devices page
// shows the request, and nothing is added until someone there presses Allow. One request at a time, for five minutes.
// An allowed program collects its own key once (collect()) and uses it like This Mac's key, in /k/<key>/deck/ links;
// it can be taken away alone. One unused for 90 days drops off the list and has to ask again (link sets never do:
// Website keys sit unpressed through an off-season).
//
// The Studio Stream Deck plugin asks with its Ed25519 public key instead, and gets no key: it signs each press
// (signed()) over "GET\n<path and query>\n<time in ms>", sent with x-studio-device, x-studio-time and x-studio-sign.
// A signature counts only within a minute of its time and only once, so a press seen on the network can't be sent
// again. Once any plugin has paired, the plugin's old x-studio-deck header stops counting (pluginPaired()).
//
// A phone, iPad or another computer's browser asks from Studio's pair page (public/pair.html): browsers can't sign on
// plain http, so it gets a device cookie instead (HttpOnly, SameSite=Strict; fromCookie()), set when it collects the
// answer. Whoever allows it picks its level: 'scoring' (the scoreboard control page and the score and clock links,
// access.scoring()) or 'full'; Devices… can change it later. Every allowed device, link set and plugin can change
// things while "Only this Mac can change things" is ticked (access.refusal()), within its level.
//
// devices.json in the local data folder: never in iCloud, a backup or a template (datalocation.ts LOCAL_ONLY).
//   [{ id, name, kind: 'links' | 'program' | 'plugin' | 'browser', level: 'full' | 'scoring', secret | publicKey, address,
//      created, lastSeen }]
// The secrets never leave this module except as This Mac's key (linkKey(), which the Output page puts in the links
// it copies); list() leaves them out.
//
// The first time, This Mac's links takes its key from deck-key.txt, where Studio kept it before, so every link
// already on a Stream Deck keeps working. deck-key.txt is kept in step when the key is renewed, so an older Studio
// opened on this Mac uses the same key rather than one that was given up.

import fs from 'node:fs';
import crypto from 'node:crypto';
import * as datadir from './datadir';
import * as savefile from './savefile';
import { errorMessage } from './errors';
import { obj } from './check';
import type { IncomingHttpHeaders } from 'node:http';
import type { Log } from './types';

type Kind = 'links' | 'program' | 'plugin' | 'browser';
type Level = 'full' | 'scoring';
// A device in devices.json: secret for a link set, program or browser; publicKey for a plugin.
interface Device {
  id: string; name: string; kind: Kind; level: Level; secret?: string; publicKey?: string; address?: string;
  created: string; lastSeen: string | null;
}
// The open request to be added.
interface Asking {
  id: string; token: string; name: string; address: string; publicKey?: string; browser: boolean; at: number;
  answer: null | 'allow' | 'deny'; kind?: Kind; level?: Level; secret?: string; deviceId?: string;
}

const FILE = datadir.local('devices.json');
const OLD_KEY_FILE = datadir.local('deck-key.txt');
const LINKS = 'mac-links';
const LEVELS: readonly Level[] = ['scoring', 'full'];
const isLevel = (v: unknown): v is Level => LEVELS.includes(v as Level);
// The device cookie a paired browser sends (server.ts sets it).
const COOKIE = 'studio_device';
// lastSeen is saved at most this often, so a run of key presses doesn't write the file each time.
const SEEN_EVERY = 60 * 1000;
// How long a request waits for Allow, how long an address waits to ask again after Deny, and how long an allowed
// device may go unused.
const ASK_MS = 5 * 60 * 1000;
const DENIED_MS = 60 * 1000;
const UNUSED_MS = 90 * 24 * 3600 * 1000;
// The Mac app, when Studio runs inside it: it shows the Allow dialog (desktop/main.js).
const app = process.parentPort || null;

let log: Log = () => {};
let devices: Device[] | null = null;
let seenSaved = 0;
let asking: Asking | null = null;
let askTimer: NodeJS.Timeout | undefined;
const deniedAt = new Map<string, number>(); // address -> when it was last denied
// Signatures already taken, until they are too old to count anyway: signature -> when it can be forgotten.
const SIGNED_MS = 60 * 1000;
const seenSigs = new Map<string, number>();
const publicKeys = new Map<string, crypto.KeyObject | null>(); // device id -> its key

const newSecret = () => crypto.randomBytes(9).toString('base64url');
const validKey = (k: string) => /^[\w-]{8,}$/.test(k);
const same = (a: unknown, b: unknown) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// An Ed25519 public key as the plugin sends it (SPKI DER, base64url), or null.
function publicKeyOf(text: unknown): crypto.KeyObject | null {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(String(text), 'base64url'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch { return null; }
}
const unused = (d: Device) => d.kind !== 'links' && Date.now() - Date.parse(d.lastSeen || d.created) > UNUSED_MS;

function oldKey(): string | null {
  try { const k = fs.readFileSync(OLD_KEY_FILE, 'utf8').trim(); if (validKey(k)) return k; } catch { /* never made */ }
  return null;
}

function save() {
  try { savefile.writeJsonSync(FILE, devices); } catch (err) { log('error', 'devices', `Couldn't save the devices list: ${errorMessage(err)}`); }
}
function saveOldKey(key: string) {
  try { savefile.writeFileSync(OLD_KEY_FILE, key + '\n'); } catch (err) { log('error', 'devices', `Couldn't save the Stream Deck key: ${errorMessage(err)}`); }
}

// Reads devices.json, making This Mac's links if it isn't there. log(level, source, message) is server.ts's log.
function load(logger?: Log): Device[] {
  if (logger) log = logger;
  const read = savefile.readJson<Device[] | null>(FILE, null, (err, movedTo) => log('error', 'devices', `devices.json couldn't be read (${errorMessage(err)})${movedTo ? `; moved aside as ${movedTo}` : ''}`));
  let list = Array.isArray(read) ? read.filter(d => d && d.id && (validKey(String(d.secret || '')) || (d.publicKey && publicKeyOf(d.publicKey)))) : [];
  const before = list.length;
  list = list.filter(d => !unused(d));
  devices = list;
  if (devices.length < before) log('info', 'devices', `${before - devices.length} device(s) unused for 90 days dropped off the list`);
  if (!list.some(d => d.id === LINKS)) {
    const key = oldKey() || newSecret();
    list.unshift({ id: LINKS, name: 'This Mac\'s links', kind: 'links', level: 'full', secret: key, created: new Date().toISOString(), lastSeen: null });
    save();
    saveOldKey(key);
  } else if (list.length < before) save();
  if (app) app.on('message', e => { const m = obj(e.data); if (m.type === 'pairAnswer') answer(String(m.id), m.allow === true, m.level); });
  return list;
}
const all = (): Device[] => devices || load();

// The key of a link set (This Mac's links unless another is named), for the links the Output page copies; null for
// anything that isn't a link set.
const linkKey = (id = LINKS): string | null => { const d = all().find(x => x.id === id && x.kind === 'links'); return d?.secret ?? null; };

// Makes a named link set, with its own key. Returns it without its key, or null without a name.
function addLinks(name: unknown): Omit<Device, 'secret'> | null {
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!clean) return null;
  const d: Device = { id: crypto.randomBytes(6).toString('base64url'), name: clean, kind: 'links', level: 'full', secret: newSecret(), created: new Date().toISOString(), lastSeen: null };
  all().push(d);
  save();
  log('info', 'devices', `New Stream Deck link set: ${clean}`);
  const { secret, ...shown } = d;
  return shown;
}

// Gives a link set a new key: every link made with the old one stops working. false for anything else.
function renew(id: string): boolean {
  const d = all().find(x => x.id === id && x.kind === 'links');
  if (!d) return false;
  d.secret = newSecret();
  d.created = new Date().toISOString();
  d.lastSeen = null;
  if (d.id === LINKS) saveOldKey(d.secret);
  save();
  log('info', 'devices', `${d.name} have a new key; links copied before no longer work`);
  return true;
}

// The device whose secret this is, or null. Compared in constant time; a match counts as the device being used.
// kinds: which devices' secrets count (link keys for /k/ links; a browser's goes only in its cookie).
function match(given: string | null | undefined, kinds: Kind[] = ['links', 'program']): Device | null {
  if (!given) return null;
  const found = all().find(d => d.secret && kinds.includes(d.kind) && same(d.secret, given) && !unused(d));
  if (found) {
    found.lastSeen = new Date().toISOString();
    if (Date.now() - seenSaved > SEEN_EVERY) { seenSaved = Date.now(); save(); }
  }
  return found || null;
}

// The paired browser whose cookie is in this Cookie header, or null.
function fromCookie(header: unknown): Device | null {
  const m = String(header || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`));
  return m ? match(m[1], ['browser']) : null;
}

// The device a signed press came from (after signed() said 'ok'), or null.
const byId = (id: string): Device | null => all().find(d => d.id === id && !unused(d)) || null;

// Changes an allowed browser's level ('scoring' or 'full'). false for anything else.
function setLevel(id: string, level: unknown): boolean {
  const d = all().find(x => x.id === id && x.kind === 'browser');
  if (!d || !isLevel(level)) return false;
  d.level = level;
  save();
  log('info', 'devices', `${d.name} can now ${level === 'scoring' ? 'only score' : 'change everything'}`);
  return true;
}

// Every device, without its secret.
const list = () => all().filter(d => !unused(d)).map(({ secret, publicKey, ...d }) => d);

// Whether a press is signed by a paired plugin: null when it carries no signature, 'ok', 'unknown' (no such device,
// removed in Devices… or unused for 90 days: the plugin should ask again) or 'bad' (wrong, too old, or sent before).
function signed(method: string, url: string, headers: IncomingHttpHeaders | null | undefined): null | 'ok' | 'unknown' | 'bad' {
  const h = headers || {};
  const id = h['x-studio-device'], time = Number(h['x-studio-time']), sig = String(h['x-studio-sign'] || '');
  if (!id && !sig) return null;
  const d = all().find(x => x.id === id && x.publicKey);
  if (!d || unused(d)) return 'unknown';
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > SIGNED_MS || !sig || seenSigs.has(sig)) return 'bad';
  if (!publicKeys.has(d.id)) publicKeys.set(d.id, publicKeyOf(d.publicKey));
  const key = publicKeys.get(d.id);
  let ok = false;
  try { ok = !!key && crypto.verify(null, Buffer.from(`${method}\n${url}\n${h['x-studio-time']}`), key, Buffer.from(sig, 'base64url')); } catch { ok = false; }
  if (!ok) return 'bad';
  const now = Date.now();
  for (const [s, until] of seenSigs) if (until < now) seenSigs.delete(s);
  seenSigs.set(sig, now + SIGNED_MS);
  d.lastSeen = new Date().toISOString();
  if (now - seenSaved > SEEN_EVERY) { seenSaved = now; save(); }
  return 'ok';
}

// Whether a Studio Stream Deck plugin has paired: from then on a plugin must sign, and the old header doesn't count.
const pluginPaired = () => all().some(d => d.kind === 'plugin' && !unused(d));

// Takes a device's access away. This Mac's links can't be removed: they get a new key instead (renew()), so every link
// made before stops working and the links copied from now on work. Returns false for a device that isn't in the list.
function revoke(id: string): boolean {
  if (id === LINKS) return renew(id);
  const d = all().find(x => x.id === id);
  if (!d) return false;
  devices = all().filter(x => x !== d);
  publicKeys.delete(d.id);
  save();
  log('info', 'devices', `${d.name} can no longer change things`);
  return true;
}

// ─── Asking to be added ──────────────────────────────────────────────────────

// Ends the open request (answered and collected, or run out), telling the Mac app to close its dialog.
function endAsking() {
  if (!asking) return;
  if (!asking.answer && app) app.postMessage({ type: 'pairDone', id: asking.id });
  clearTimeout(askTimer);
  asking = null;
}

// A device at address asks to be added under name, with its public key if it signs (the Studio plugin).
// { id, token, expires } (token collects the answer), or { error } when another request is open or this address was
// just denied.
function ask(name: unknown, address: string, publicKey?: string, browser = false): { error: string } | { id: string; token: string; expires: string } {
  if (publicKey !== undefined && !publicKeyOf(publicKey)) return { error: 'That public key isn\'t an Ed25519 key (SPKI DER, base64url).' };
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!clean) return { error: 'Give the device a name, such as "Office Stream Deck", so whoever is at the Mac knows what is asking.' };
  if (Date.now() - (deniedAt.get(address) || 0) < DENIED_MS) return { error: 'This device was just denied. Wait a minute before asking again.' };
  if (asking && !asking.answer) return { error: 'Another device is asking already. Try again once it is answered, or in five minutes.' };
  endAsking();
  const open: Asking = { id: crypto.randomBytes(6).toString('base64url'), token: crypto.randomBytes(16).toString('base64url'), name: clean, address, publicKey, browser: !publicKey && browser === true, at: Date.now(), answer: null };
  asking = open;
  askTimer = setTimeout(() => { log('info', 'devices', `${open.name} at ${open.address} wasn't answered in five minutes`); endAsking(); }, ASK_MS);
  askTimer.unref?.();
  log('info', 'devices', `${clean} at ${address} asks to control Studio`);
  if (app) app.postMessage({ type: 'pair', request: { id: open.id, name: clean, address, browser: open.browser } });
  return { id: open.id, token: open.token, expires: new Date(open.at + ASK_MS).toISOString() };
}

// Allow or Deny, from the dialog or the Devices page; level ('scoring' or 'full') for a browser, which is 'scoring'
// unless said otherwise. false when there is no such open request.
function answer(id: string, allow: boolean, level?: unknown): boolean {
  if (!asking || asking.id !== id || asking.answer) return false;
  if (allow) {
    const base = { id: crypto.randomBytes(6).toString('base64url'), name: asking.name, level: 'full' as Level, address: asking.address, created: new Date().toISOString(), lastSeen: null };
    const d: Device = asking.publicKey ? { ...base, kind: 'plugin', publicKey: asking.publicKey }
      : asking.browser ? { ...base, kind: 'browser', level: isLevel(level) ? level : 'scoring', secret: newSecret() }
        : { ...base, kind: 'program', secret: newSecret() };
    asking.kind = d.kind;
    asking.level = d.level;
    // A plugin asking again with the same key (its settings were lost) replaces its old entry.
    if (d.publicKey) devices = all().filter(x => x.publicKey !== d.publicKey);
    all().push(d);
    save();
    asking.secret = d.secret;
    asking.deviceId = d.id;
  } else {
    deniedAt.set(asking.address, Date.now());
  }
  asking.answer = allow ? 'allow' : 'deny';
  if (app) app.postMessage({ type: 'pairDone', id });
  log('info', 'devices', `${asking.name} at ${asking.address} was ${allow ? (asking.level === 'scoring' ? 'allowed to score' : 'allowed to control Studio') : 'denied'}`);
  return true;
}

// The asking device collects the answer with its token: { status: 'waiting' | 'allowed' | 'denied' | 'gone' }, and
// once allowed its device id, level and its key (a program; a browser gets it as cookie, for server.ts to set as a
// cookie and never show). The key is handed over once; the request ends with any answer.
function collect(id: string, token: unknown) {
  if (!asking || asking.id !== id || !same(asking.token, token || '')) return { status: 'gone' };
  if (!asking.answer) return { status: 'waiting', expires: new Date(asking.at + ASK_MS).toISOString() };
  const secret = asking.secret ? (asking.kind === 'browser' ? { cookie: asking.secret } : { key: asking.secret }) : {};
  const done = asking.answer === 'allow' ? { status: 'allowed', ...secret, device: asking.deviceId, level: asking.level } : { status: 'denied' };
  endAsking();
  return done;
}

// The open request, for the Devices page: { id, name, address, at, expires }, or null.
const pending = () => asking && !asking.answer
  ? { id: asking.id, name: asking.name, address: asking.address, browser: asking.browser, at: new Date(asking.at).toISOString(), expires: new Date(asking.at + ASK_MS).toISOString() }
  : null;

export type { Device, Kind, Level };
export { load, linkKey, addLinks, renew, match, fromCookie, byId, setLevel, list, revoke, signed, pluginPaired, ask, answer, collect, pending, FILE, LINKS, COOKIE };
