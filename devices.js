// FirstPass Studio - the devices allowed to change things from another device, listed in the Devices… window.
//
// For now the list holds one entry: "This Mac's links", the key in every Stream Deck link copied from Studio
// (/k/<key>/deck/..., access.deckPress()). Later each Stream Deck, set of Website keys, phone and browser gets its
// own entry, approved once on the Mac and removable alone (the device pairing design).
//
// devices.json in the local data folder: never in iCloud, a backup or a template (datalocation.js LOCAL_ONLY).
//   [{ id, name, kind: 'links', level: 'full', secret, created, lastSeen }]
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

let log = () => {};
let devices = null;
let seenSaved = 0;

const newSecret = () => crypto.randomBytes(9).toString('base64url');
const validKey = k => /^[\w-]{8,}$/.test(k);

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
  if (!devices.some(d => d.id === LINKS)) {
    const key = oldKey() || newSecret();
    devices.unshift({ id: LINKS, name: 'This Mac\'s links', kind: 'links', level: 'full', secret: key, created: new Date().toISOString(), lastSeen: null });
    save();
    saveOldKey(key);
  }
  return devices;
}
const all = () => devices || load();

// This Mac's key, for the links the Output page copies.
const linkKey = () => all().find(d => d.id === LINKS).secret;

// The device whose secret this is, or null. Compared in constant time; a match counts as the device being used.
function match(given) {
  if (!given) return null;
  const g = Buffer.from(String(given));
  const found = all().find(d => { const s = Buffer.from(d.secret); return s.length === g.length && crypto.timingSafeEqual(s, g); });
  if (found) {
    found.lastSeen = new Date().toISOString();
    if (Date.now() - seenSaved > SEEN_EVERY) { seenSaved = Date.now(); save(); }
  }
  return found || null;
}

// Every device, without its secret.
const list = () => all().map(({ secret, ...d }) => d);

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

module.exports = { load, linkKey, match, list, revoke, FILE, LINKS };
