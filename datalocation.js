// FirstPass Studio - keeping the settings folder in iCloud Drive.
//
// The data folder (datadir.js) is on this Mac by default. It can instead live in a folder in
// iCloud Drive picked from the Mac app's menu, inside a subfolder named after this Mac (its Local hostname),
// so two Macs signed in to the same Apple account each keep their own settings:
//   iCloud Drive/FirstPass Studio/Studio-MacBook-Pro/competitions/...
// Where it is, is saved on this Mac only, in data-location.json in the local folder:
//   { "provider": "icloud", "folder": "<the folder picked>", "dataDir": "<folder>/<this Mac>", ... }
// dataDir is saved as it was when the folder was picked, so renaming the Mac later doesn't
// lose the settings. studio-computer.json in the subfolder records which Mac uses it, so a
// second Mac with the same name is caught instead of sharing (and fighting over) one folder.
//
// Some files stay on this Mac whichever folder holds the settings (LOCAL_ONLY): the debug
// logs (written all the time), the scores and clock (saved every few seconds while a game is
// live), caches, the app's window positions and this file. Only settings sync.
//
// Another Mac's settings can be restored onto this one (restore()): they are copied, never
// moved, so the other Mac keeps its own.
//
// PROVIDERS is the list of cloud drives; only iCloud Drive for now. Others (Dropbox, Google
// Drive, OneDrive all live under ~/Library/CloudStorage on a Mac) can be added beside it.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

const LOCATION_FILE = 'data-location.json';
const COMPUTER_FILE = 'studio-computer.json';
// Kept in the local folder (or recreated there) whichever folder holds the settings.
const LOCAL_ONLY = new Set([
  LOCATION_FILE, 'app-settings.json', 'logs', 'backups',
  'scoreboard-state.json', 'game-cache.json', 'last-game-summary.json',
]);
const SKIP = name => LOCAL_ONLY.has(name) || name.startsWith('.') || name === COMPUTER_FILE;

const PROVIDERS = {
  icloud: {
    name: 'iCloud Drive',
    root: () => path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
    // Everything iCloud syncs (iCloud Drive and apps' own iCloud folders) is under Mobile Documents.
    contains: p => isInside(p, path.join(os.homedir(), 'Library', 'Mobile Documents')),
  },
};

function isInside(p, dir) {
  const real = q => { try { return fs.realpathSync(q); } catch { return path.resolve(q); } };
  const rel = path.relative(real(dir), real(p));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// This Mac's name for its subfolder: the Local hostname (System Settings > General > Sharing),
// which macOS keeps unique on the network and which is safe in a file name.
function computerName() {
  let name = '';
  if (process.platform === 'darwin') {
    try { name = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 2000 }).trim(); } catch { /* below */ }
  }
  if (!name) name = os.hostname().replace(/\.local$/i, '').split('.')[0];
  return name.replace(/[^A-Za-z0-9 ._-]/g, '-').replace(/^[.\s]+/, '').slice(0, 60) || 'This Mac';
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }

// Where the settings are: { local: true, dataDir } or { provider, name, folder, dataDir, computer, computerId }.
function current(localDir) {
  const saved = readJson(path.join(localDir, LOCATION_FILE)) || {};
  if (saved.provider && PROVIDERS[saved.provider] && saved.dataDir) {
    return { ...saved, name: PROVIDERS[saved.provider].name, dataDir: path.resolve(saved.dataDir) };
  }
  return { local: true, dataDir: localDir, computerId: saved.computerId };
}

// A random id for this Mac, made once and kept in the local folder.
function computerId(localDir) {
  const file = path.join(localDir, LOCATION_FILE);
  const saved = readJson(file) || {};
  if (saved.computerId) return saved.computerId;
  const id = crypto.randomUUID();
  fs.mkdirSync(localDir, { recursive: true });
  writeJson(file, { ...saved, computerId: id });
  return id;
}

// What's in a folder that Studio would move: the settings, not the local-only files.
function movable(dir) {
  try { return fs.readdirSync(dir).filter(n => !SKIP(n)).sort(); } catch { return []; }
}
function hasSettings(dir) { return movable(dir).length > 0; }

// Who uses a cloud subfolder: null if nobody has yet.
function owner(dir) { return readJson(path.join(dir, COMPUTER_FILE)); }
// Whether another Mac (not this one) uses the subfolder.
function usedByAnother(dir, localDir) {
  const o = owner(dir);
  return !!(o && o.computerId && o.computerId !== computerId(localDir)) ? o : null;
}

// Checks a folder picked for the settings. Returns { ok, error } or { ok, provider, folder, dataDir, computer }.
function check(folder, provider = 'icloud', { computer = computerName() } = {}) {
  const p = PROVIDERS[provider];
  if (!p) return { ok: false, error: 'Unknown cloud drive.' };
  if (!fs.existsSync(p.root())) return { ok: false, error: `${p.name} isn't turned on for this Mac. Turn it on in System Settings > your name > iCloud > iCloud Drive, then try again.` };
  if (!folder || !p.contains(folder)) return { ok: false, error: `That folder isn't in ${p.name}. Pick a folder inside ${p.name}.` };
  return { ok: true, provider, folder, dataDir: path.join(folder, computer), computer };
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.copyFileSync(a, b);
  }
}
// Every file under the given names in a folder, with its size, for checking a copy.
function listing(dir, names) {
  const out = {};
  const walk = rel => {
    const p = path.join(dir, rel);
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(rel, n));
    else if (st.isFile()) out[rel] = st.size;
  };
  for (const n of names) walk(n);
  return out;
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

// Moves the settings from one folder to another. Before anything changes, the settings in
// `from` are copied to the local folder's backups/<date>-before-move, and kept.
//   existing: what to do when `to` already holds settings: 'use' keeps those (this Mac's
//   settings go only to the backup), 'replace' backs them up too and then puts this Mac's there.
// The originals are removed only once every file is in place with the right size.
// Returns { backup, kept } (kept: the settings already in `to` were used).
function move({ from, to, localDir, existing, log = () => {} }) {
  from = path.resolve(from); to = path.resolve(to);
  if (from === to) return { backup: null, kept: true };
  const names = movable(from);
  const there = hasSettings(to);
  if (there && !existing) throw new Error('The new folder already holds settings: choose whether to use them or replace them.');
  const backups = path.join(localDir, 'backups');
  let backup = null;
  if (names.length) {
    backup = path.join(backups, `${stamp()}-before-move`);
    for (const n of names) {
      const p = path.join(from, n);
      if (fs.statSync(p).isDirectory()) copyDir(p, path.join(backup, n)); else { fs.mkdirSync(backup, { recursive: true }); fs.copyFileSync(p, path.join(backup, n)); }
    }
    log(`Backed up the settings to ${backup}`);
  }
  fs.mkdirSync(to, { recursive: true });
  if (there && existing === 'use') {
    log(`Using the settings already in ${to}`);
    for (const n of names) fs.rmSync(path.join(from, n), { recursive: true, force: true });
    return { backup, kept: true };
  }
  if (there) {
    const old = path.join(backups, `${stamp()}-replaced`);
    copyDir(to, old);
    for (const n of movable(to)) fs.rmSync(path.join(to, n), { recursive: true, force: true });
    log(`Backed up the settings that were in ${to} to ${old}`);
  }
  const want = listing(from, names);
  try {
    for (const n of names) {
      const a = path.join(from, n), b = path.join(to, n);
      if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
    }
    const got = listing(to, names);
    const bad = Object.keys(want).find(k => got[k] !== want[k]);
    if (bad) throw new Error(`${bad} didn't copy across in full`);
  } catch (err) {
    for (const n of names) fs.rmSync(path.join(to, n), { recursive: true, force: true });
    throw new Error(`Couldn't copy the settings: ${err.message}. Nothing was moved.`);
  }
  for (const n of names) fs.rmSync(path.join(from, n), { recursive: true, force: true });
  log(`Moved ${Object.keys(want).length} files from ${from} to ${to}`);
  return { backup, kept: false };
}

// Restores another Mac's settings over this Mac's: copies the settings in `from` (another Mac's
// subfolder, left as it is) into `to` (this Mac's settings folder). This Mac's settings are
// first copied to the local backups/<date>-before-restore. The copy goes into a hidden folder
// beside them and is checked file by file before it takes their place, so a failed copy
// leaves this Mac's settings untouched. Returns { backup, files }.
function restore({ from, to, localDir, log = () => {} }) {
  from = path.resolve(from); to = path.resolve(to);
  if (from === to) throw new Error('That is this Mac\'s own settings folder.');
  const names = movable(from);
  if (!names.length) throw new Error('That folder has no FirstPass Studio settings in it.');
  const mine = movable(to);
  const backup = backupTo(to, mine, path.join(localDir, 'backups', `${stamp()}-before-restore`));
  if (backup) log(`Backed up this Mac's settings to ${backup}`);
  const staging = path.join(to, `.restoring-${stamp()}`);
  const want = listing(from, names);
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const n of names) {
      const a = path.join(from, n), b = path.join(staging, n);
      if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
    }
    const got = listing(staging, names);
    const bad = Object.keys(want).find(k => got[k] !== want[k]);
    if (bad) throw new Error(`${bad} didn't copy across in full`);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`Couldn't copy the settings: ${err.message}. This Mac's settings weren't changed.`);
  }
  for (const n of mine) fs.rmSync(path.join(to, n), { recursive: true, force: true });
  for (const n of names) fs.renameSync(path.join(staging, n), path.join(to, n));
  fs.rmSync(staging, { recursive: true, force: true });
  log(`Restored ${Object.keys(want).length} files from ${from} to ${to}`);
  return { backup, files: Object.keys(want).length };
}

function backupTo(dir, names, backup) {
  if (!names.length) return null;
  fs.mkdirSync(backup, { recursive: true });
  for (const n of names) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) copyDir(p, path.join(backup, n)); else fs.copyFileSync(p, path.join(backup, n));
  }
  return backup;
}

// Restores another Mac's settings for a Mac whose settings are on the Mac itself: they go into
// a new subfolder for this Mac beside the other Mac's in the cloud folder, and this Mac then
// keeps its settings there. This Mac's old settings are backed up, then removed from the Mac.
// Returns { backup, files, target }.
function restoreToCloud({ from, localDir, provider = 'icloud', computer = computerName(), log = () => {} }) {
  const target = check(path.dirname(path.resolve(from)), provider, { computer });
  if (!target.ok) throw new Error(target.error);
  if (path.resolve(target.dataDir) === path.resolve(from)) throw new Error(`That folder is named after this Mac (${computer}). Pick the folder named after the other Mac.`);
  const other = usedByAnother(target.dataDir, localDir);
  if (other) throw new Error(`Another Mac called ${other.computer} already uses ${target.dataDir}. Give this Mac its own name in System Settings > General > Sharing > Local hostname, then try again.`);
  const mine = movable(localDir);
  const backup = backupTo(localDir, mine, path.join(localDir, 'backups', `${stamp()}-before-restore`));
  if (backup) log(`Backed up this Mac's settings to ${backup}`);
  fs.mkdirSync(target.dataDir, { recursive: true });
  const { files, backup: replaced } = restore({ from, to: target.dataDir, localDir, log });
  save(localDir, target);
  for (const n of mine) fs.rmSync(path.join(localDir, n), { recursive: true, force: true });
  log(`Settings now in ${target.dataDir}`);
  return { backup: backup || replaced, files, target };
}

// The other Macs' settings folders beside this one in a cloud folder: [{ dir, computer, since }].
function otherMacs(folder, dataDir) {
  let list; try { list = fs.readdirSync(folder, { withFileTypes: true }); } catch { return []; }
  return list.filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => path.join(folder, e.name))
    .filter(d => path.resolve(d) !== path.resolve(dataDir || '') && hasSettings(d))
    .map(d => ({ dir: d, computer: (owner(d) || {}).computer || path.basename(d), since: (owner(d) || {}).since }));
}

// Points this Mac at a cloud folder (or back at the local one with provider null), and marks
// the cloud subfolder as this Mac's.
function save(localDir, { provider, folder, dataDir, computer }) {
  const id = computerId(localDir);
  const file = path.join(localDir, LOCATION_FILE);
  if (!provider) return writeJson(file, { computerId: id });
  writeJson(path.join(dataDir, COMPUTER_FILE), { computerId: id, computer, since: new Date().toISOString() });
  writeJson(file, { provider, folder, dataDir, computer, computerId: id });
}

// iCloud can keep only a placeholder of a file on this Mac (Optimise Mac Storage): the file is
// gone and .<name>.icloud stands in for it. Lists the placeholders under a folder.
function placeholders(dir) {
  const out = [];
  const walk = d => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (/^\..+\.icloud$/.test(e.name)) out.push(path.join(d, e.name.slice(1, -'.icloud'.length)));
    }
  };
  walk(dir);
  return out;
}

// Asks iCloud to download every placeholder in the folder and waits (up to timeoutMs) until
// they are all here. Resolves with the files still missing.
async function download(dir, { timeoutMs = 60000 } = {}) {
  let left = placeholders(dir);
  if (!left.length) return [];
  await new Promise(r => execFile('/usr/bin/brctl', ['download', dir], { timeout: 10000 }, () => r()));
  for (const f of left) execFile('/usr/bin/brctl', ['download', f], { timeout: 10000 }, () => {});
  const end = Date.now() + timeoutMs;
  while ((left = placeholders(dir)).length && Date.now() < end) await new Promise(r => setTimeout(r, 500));
  return left;
}

module.exports = { PROVIDERS, LOCAL_ONLY, LOCATION_FILE, COMPUTER_FILE, computerName, current, computerId, movable, hasSettings, owner, usedByAnother, check, move, restore, restoreToCloud, otherMacs, save, placeholders, download, isInside };
