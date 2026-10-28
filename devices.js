// FirstPass Studio - the devices allowed to change things from another device, listed in the Devices… window.
//
// The list starts with "This Mac's links", the key in every Stream Deck link copied from Studio (/k/<key>/deck/...,
// access.deckPress()). A program on another device (a script, curl, later the Stream Deck plugin, phones and browsers)
// asks to be added (ask()): the Mac shows a dialog naming it and its address (desktop/main.js), or the Devices page
// shows the request, and nothing is added until someone there presses Allow. One request at a time, for five minutes.
// An allowed program collects its own key once (collect()) and uses it like This Mac's key, in /k/<key>/deck/ links;
// it can be taken away alone. One unused for 90 days drops off the list and has to ask again.
//
// devices.json in the local data folder: never in iCloud, a backup or a template (datalocation.js LOCAL_ONLY).
//   [{ id, name, kind: 'links' | 'program', level: 'full', secret, address, created, lastSeen }]
// The secrets never leave this module except as This Mac's key (linkKey(), which the Output page puts in the links
// it copies); list() leaves them out.
//
// The first time, This Mac's links takes its key from deck-key.txt, where Studio kept it before, so every link
// already on a Stream Deck keeps working. deck-key.txt is kept in step when the key is renewed, so an older Studio
// opened on this Mac uses the same key rather than one that was given up.

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const datadir = require('./datadir');
const savefile = require('./savefile');

const FILE = datadir.local('devices.json');
const OLD_KEY_FILE = datadir.local('deck-key.txt');
const LINKS = 'mac-links';
// lastSeen is saved at most this often, so a run of key presses doesn't write the file each time.
const SEEN_EVERY = 60 * 1000;
// How long a request waits for Allow, how long an address waits to ask again after Deny, and how long an allowed
// device may go unused.
const ASK_MS = 5 * 60 * 1000;
const DENIED_MS = 60 * 1000;
const UNUSED_MS = 90 * 24 * 3600 * 1000;
// The Mac app, when Studio runs inside it: it shows the Allow dialog (desktop/main.js).
const app = process.parentPort || null;

let log = () => {};
let devices = null;
let seenSaved = 0;
// The open request: { id, token, name, address, at, answer: null | 'allow' | 'deny', secret, deviceId }.
let asking = null;
let askTimer = null;
const deniedAt = new Map(); // address -> when it was last denied

const newSecret = () => crypto.randomBytes(9).toString('base64url');
const validKey = k => /^[\w-]{8,}$/.test(k);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const unused = d => d.id !== LINKS && Date.now() - Date.parse(d.lastSeen || d.created) > UNUSED_MS;

function oldKey() {
  try { const k = fs.readFileSync(OLD_KEY_FILE, 'utf8').trim(); if (validKey(k)) return k; } catch { /* never made */ }
  return null;
}

function save() {
  try { savefile.writeJsonSync(FILE, devices); } catch (err) { log('error', 'devices', `Couldn't save the devices list: ${err.message}`); }
}
function saveOldKey(key) {
  try { savefile.writeFileSync(OLD_KEY_FILE, key + '\n'); } catch (err) { log('error', 'devices', `Couldn't save the Stream Deck key: ${err.message}`); }
}

// Reads devices.json, making This Mac's links if it isn't there. log(level, source, message) is server.js's log.
function load(logger) {
  if (logger) log = logger;
  const read = savefile.readJson(FILE, null, (err, movedTo) => log('error', 'devices', `devices.json couldn't be read (${err.message})${movedTo ? `; moved aside as ${movedTo}` : ''}`));
  devices = Array.isArray(read) ? read.filter(d => d && d.id && validKey(String(d.secret || ''))) : [];
  const before = devices.length;
  devices = devices.filter(d => !unused(d));
  if (devices.length < before) log('info', 'devices', `${before - devices.length} device(s) unused for 90 days dropped off the list`);
  if (!devices.some(d => d.id === LINKS)) {
    const key = oldKey() || newSecret();
    devices.unshift({ id: LINKS, name: 'This Mac\'s links', kind: 'links', level: 'full', secret: key, created: new Date().toISOString(), lastSeen: null });
    save();
    saveOldKey(key);
  } else if (devices.length < before) save();
  if (app) app.on('message', e => { const m = e.data || {}; if (m.type === 'pairAnswer') answer(m.id, m.allow === true); });
  return devices;
}
const all = () => devices || load();

// This Mac's key, for the links the Output page copies.
const linkKey = () => all().find(d => d.id === LINKS).secret;

// The device whose secret this is, or null. Compared in constant time; a match counts as the device being used.
function match(given) {
  if (!given) return null;
  const found = all().find(d => same(d.secret, given) && !unused(d));
  if (found) {
    found.lastSeen = new Date().toISOString();
    if (Date.now() - seenSaved > SEEN_EVERY) { seenSaved = Date.now(); save(); }
  }
  return found || null;
}

// Every device, without its secret.
const list = () => all().filter(d => !unused(d)).map(({ secret, ...d }) => d);

// Takes a device's access away. This Mac's links stay in the list with a new key, so every link made before stops
// working and the links copied from now on work. Returns false for a device that isn't in the list.
function revoke(id) {
  const d = all().find(x => x.id === id);
  if (!d) return false;
  if (d.id === LINKS) {
    d.secret = newSecret();
    d.created = new Date().toISOString();
    d.lastSeen = null;
    saveOldKey(d.secret);
  } else {
    devices = devices.filter(x => x !== d);
  }
  save();
  log('info', 'devices', d.id === LINKS ? 'This Mac\'s links have a new key; links copied before no longer work' : `${d.name} can no longer change things`);
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

// A device at address asks to be added under name. { id, token, expires } (token collects the answer), or
// { error } when another request is open or this address was just denied.
function ask(name, address) {
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!clean) return { error: 'Give the device a name, such as "Office Stream Deck", so whoever is at the Mac knows what is asking.' };
  if (Date.now() - (deniedAt.get(address) || 0) < DENIED_MS) return { error: 'This device was just denied. Wait a minute before asking again.' };
  if (asking && !asking.answer) return { error: 'Another device is asking already. Try again once it is answered, or in five minutes.' };
  endAsking();
  asking = { id: crypto.randomBytes(6).toString('base64url'), token: crypto.randomBytes(16).toString('base64url'), name: clean, address, at: Date.now(), answer: null };
  askTimer = setTimeout(() => { log('info', 'devices', `${asking.name} at ${asking.address} wasn't answered in five minutes`); endAsking(); }, ASK_MS);
  askTimer.unref?.();
  log('info', 'devices', `${clean} at ${address} asks to control Studio`);
  if (app) app.postMessage({ type: 'pair', request: { id: asking.id, name: clean, address } });
  return { id: asking.id, token: asking.token, expires: new Date(asking.at + ASK_MS).toISOString() };
}

// Allow or Deny, from the dialog or the Devices page. false when there is no such open request.
function answer(id, allow) {
  if (!asking || asking.id !== id || asking.answer) return false;
  if (allow) {
    const d = { id: crypto.randomBytes(6).toString('base64url'), name: asking.name, kind: 'program', level: 'full', secret: newSecret(), address: asking.address, created: new Date().toISOString(), lastSeen: null };
    all().push(d);
    save();
    asking.secret = d.secret;
    asking.deviceId = d.id;
  } else {
    deniedAt.set(asking.address, Date.now());
  }
  asking.answer = allow ? 'allow' : 'deny';
  if (app) app.postMessage({ type: 'pairDone', id });
  log('info', 'devices', `${asking.name} at ${asking.address} was ${allow ? 'allowed to control Studio' : 'denied'}`);
  return true;
}

// The asking device collects the answer with its token: { status: 'waiting' | 'allowed' | 'denied' | 'gone' }, and
// once allowed its key and device id. The key is handed over once; the request ends with any answer.
function collect(id, token) {
  if (!asking || asking.id !== id || !same(asking.token, token || '')) return { status: 'gone' };
  if (!asking.answer) return { status: 'waiting', expires: new Date(asking.at + ASK_MS).toISOString() };
  const done = asking.answer === 'allow' ? { status: 'allowed', key: asking.secret, device: asking.deviceId } : { status: 'denied' };
  endAsking();
  return done;
}

// The open request, for the Devices page: { id, name, address, at, expires }, or null.
const pending = () => asking && !asking.answer
  ? { id: asking.id, name: asking.name, address: asking.address, at: new Date(asking.at).toISOString(), expires: new Date(asking.at + ASK_MS).toISOString() }
  : null;

module.exports = { load, linkKey, match, list, revoke, ask, answer, collect, pending, FILE, LINKS };
