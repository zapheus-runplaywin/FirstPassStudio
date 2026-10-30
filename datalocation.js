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
// Only the settings Studio saves move (SETTINGS); the Mac app's folder also holds Electron's
// own files, which never do. Some files stay on this Mac whichever folder holds the settings (LOCAL_ONLY): the debug
// logs (written all the time), the scores and clock (saved every few seconds while a game is
// live), caches, the Socials tab's polaroid photos, the app's window positions and this file. Only settings sync.
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
const savefile = require('./savefile');

const LOCATION_FILE = 'data-location.json';
const COMPUTER_FILE = 'studio-computer.json';
// The settings that move: only these. The Mac app's folder also holds Electron's own files
// (caches, cookies, SingletonLock...), which must never move. A new file saved with
// datadir.file() must be added here (test/datalocation.test.js checks).
const SETTINGS = new Set([
  'competitions', 'config.json', 'control.json', 'round-choice.json', 'data-version.json',
  'scene.json', 'media', 'outputs.json', 'music.json', 'mics.json', 'sequences.json', 'sequence-settings.json', 'sponsors', 'switcher.json',
]);
// Kept in the local folder whichever folder holds the settings (saved with datadir.local()).
const LOCAL_ONLY = new Set([
  LOCATION_FILE, 'app-settings.json', 'logs', 'backups',
  'scoreboard-state.json', 'game-cache.json', 'last-game-summary.json', 'stream-keys.json', 'deck-key.txt', 'devices.json', 'socials-photos', 'recordings.json', 'Recordings', 'demos.json',
]);

const PROVIDERS = {
  icloud: {
    name: 'iCloud Drive',
    root: () => path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
    // Everything iCloud syncs (iCloud Drive and apps' own iCloud folders) is under Mobile Documents.
    contains: p => isInside(p, path.join(os.homedir(), 'Library', 'Mobile Documents')),
  },
};

function isInside(p, dir) {
  // A path not made yet resolves through its nearest folder that exists, so a symlinked
  // parent (macOS's /var is /private/var) resolves the same for both paths.
  const real = q => {
    q = path.resolve(q);
    try { return fs.realpathSync(q); } catch { /* not made yet */ }
    const up = path.dirname(q);
    return up === q ? q : path.join(real(up), path.basename(q));
  };
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
function writeJson(file, value) { savefile.writeJsonSync(file, value); }

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
  const real = n => { try { const st = fs.lstatSync(path.join(dir, n)); return st.isFile() || st.isDirectory(); } catch { return false; } };
  try { return fs.readdirSync(dir).filter(n => SETTINGS.has(n) && real(n)).sort(); } catch { return []; }
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
//   keep: names this Mac keeps when `from` has none of its own (a backup made without the media folder).
function restore({ from, to, localDir, keep = [], machineFrom = to, log = () => {} }) {
  from = path.resolve(from); to = path.resolve(to);
  if (from === to) throw new Error('That is this Mac\'s own settings folder.');
  const names = movable(from);
  if (!names.length) throw new Error('That folder has no FirstPass Studio settings in it.');
  const mine = movable(to);
  const ownConfig = readJson(path.join(machineFrom, 'config.json')) || {};
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
  for (const n of mine) if (names.includes(n) || !keep.includes(n)) fs.rmSync(path.join(to, n), { recursive: true, force: true });
  for (const n of names) fs.renameSync(path.join(staging, n), path.join(to, n));
  fs.rmSync(staging, { recursive: true, force: true });
  keepMachineKeys(to, ownConfig);
  log(`Restored ${Object.keys(want).length} files from ${from} to ${to}`);
  return { backup, files: Object.keys(want).length };
}

// config.json settings that belong to this Mac and never come with restored settings: who on the network may change
// things, which program runs as ffmpeg, where Studio sends the PlayHQ Client ID, and this Mac's own port and name.
// A backup or another Mac's folder could otherwise turn the lock off, or point them somewhere else.
const MACHINE_ONLY = ['remoteChanges', 'ffmpegPath', 'apiBaseUrl', 'gameSummaryPath', 'port', 'linkHost'];
function keepMachineKeys(dir, own) {
  const file = path.join(dir, 'config.json');
  const cfg = readJson(file);
  if (!cfg && !MACHINE_ONLY.some(k => k in own)) return;
  const out = { ...(cfg || {}) };
  for (const k of MACHINE_ONLY) { if (k in own) out[k] = own[k]; else delete out[k]; }
  writeJson(file, out);
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
  const { files, backup: replaced } = restore({ from, to: target.dataDir, localDir, machineFrom: localDir, log });
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

// The settings as zip entries ({ name, file }, zip.js), for Export settings as a zip: every
// file under SETTINGS in the folder, inside one folder named like the zip, plus
// studio-export.json saying where and when they came from (folder: exportName()). The local-only files (logs, scores
// and clock, caches) aren't settings, so they aren't in it. Hidden files (.DS_Store, a copy
// half made, iCloud's placeholders) are left out; skipped lists the placeholders, files iCloud
// hasn't downloaded. media: false leaves out the media folder (videos, music, images).
// summary.txt (exportSummary()) goes in too. Returns { list, skipped, bytes, summary }.
function exportEntries(dir, { media = true, folder = exportName(), about = {}, notes = '' } = {}) {
  const list = [], skipped = [];
  let bytes = 0;
  const walk = rel => {
    const p = path.join(dir, rel);
    let st; try { st = fs.lstatSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const n of fs.readdirSync(p).sort()) {
        const m = /^\.(.+)\.icloud$/.exec(n);
        if (m) skipped.push(path.join(rel, m[1]));
        else if (!n.startsWith('.')) walk(path.join(rel, n));
      }
    } else if (st.isFile()) {
      list.push({ name: `${folder}/${rel.split(path.sep).join('/')}`, file: p });
      bytes += st.size;
    }
  };
  for (const n of movable(dir)) if (media || n !== 'media') walk(n);
  const manifest = { exported: new Date().toISOString(), computer: computerName(), media, files: list.length, ...about };
  const summary = exportSummary(dir, { name: folder, about, files: list.length, bytes, media, skipped, notes });
  list.unshift({ name: `${folder}/studio-export.json`, data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
    { name: `${folder}/summary.txt`, data: Buffer.from(summary) });
  return { list, skipped, bytes, summary };
}

// A summary of the settings in a folder, as plain text, saved beside an exported zip and in it:
// the competitions with their sequences, the playlists, the sources, the scenes and the
// sponsors, by name, under the notes typed in when backing up. It reads the saved files as they are, so it works with Studio off air.
function exportSummary(dir, { name = exportName(), about = {}, files = 0, bytes = 0, media = true, skipped = [], notes = '' } = {}) {
  const json = (...p) => readJson(path.join(dir, ...p)) || {};
  const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
  const lines = [name, '', `Made ${new Date().toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' })} on ${computerName()}${about.studio ? `, FirstPass Studio ${about.studio}` : ''}.`,
    `${files} files, ${bytes < 1e6 ? '<1' : Math.round(bytes / 1e6)} MB${media ? '' : ', without the media folder'}.`];
  if (skipped.length) lines.push(`Not included, still only in iCloud: ${skipped.join(', ')}.`);
  notes = String(notes || '').trim();
  if (notes) lines.push('', 'Notes', notes);
  const section = (title, items) => { lines.push('', `${title} (${items.length})`); for (const i of items) lines.push(`- ${i}`); if (!items.length) lines.push('- none'); };
  const seqNames = file => arr((readJson(file) || {}).sequences).map(q => q.name || 'Untitled sequence');
  let comps = [];
  try { comps = fs.readdirSync(path.join(dir, 'competitions'), { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort(); } catch { /* none */ }
  const active = json('competitions', 'active.json').active;
  const compName = {};
  for (const id of comps) { const c = json('competitions', id, 'settings.json'); compName[id] = c.name || c.displayName || id; }
  comps.sort((a, b) => compName[a].localeCompare(compName[b]));
  section('Competitions', comps.map(id => `${compName[id]}${id === active ? ' (in use)' : ''}`));
  const seqs = comps.map(id => [compName[id], seqNames(path.join(dir, 'competitions', id, 'sequences.json'))]);
  const loose = seqNames(path.join(dir, 'sequences.json'));
  if (loose.length) seqs.push(['No competition', loose]);
  section('Sequences', seqs.flatMap(([c, list]) => list.map(q => `${q} (${c})`)));
  section('Playlists', arr(json('music.json').playlists).map(pl => `${pl.name || 'Playlist'} (${(pl.tracks || []).length} songs)`));
  section('Mics', arr(json('mics.json').mics).map(m => `${m.name || 'Mic'}${m.device ? ` (${m.device})` : ''}`));
  const scene = json('scene.json');
  section('Sources', arr(scene.sources).map(src => `${src.name || src.id || 'Source'}${src.type ? ` (${src.type})` : ''}`));
  section('Scenes', arr(scene.scenes).map(sc => sc.name || 'Untitled scene'));
  section('Sponsors', arr(json('sponsors', 'sponsors.json').sponsors).map(sp => {
    const on = Object.keys(sp.competitions || {}).map(id => compName[id] || id);
    return `${sp.name || 'Sponsor'}${on.length ? ` (${on.join(', ')})` : ''}`;
  }));
  return lines.join('\n') + '\n';
}

// The name for an exported zip (without .zip): the prefix, then the date and time (this Mac's
// time), so each one is new and they sort oldest to newest: FirstPassStudioBackup-2026-10-24_10-46-02
function exportName(d = new Date()) {
  const two = n => String(n).padStart(2, '0');
  return `FirstPassStudioBackup-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

// A backup zip made by Back up… (exportEntries): its folder, studio-export.json and summary.txt.
// Throws if it isn't one. Returns { list, root, about, summary }.
async function readBackup(file) {
  const zip = require('./zip');
  const list = zip.entries(file);
  const about = list.find(e => /^[^/]+\/studio-export\.json$/.test(e.name));
  if (!about) throw new Error("That zip isn't a FirstPass Studio backup: there's no studio-export.json in it. Pick a zip made with Back up….");
  const root = about.name.split('/')[0];
  const text = async ent => { const chunks = []; for await (const c of zip.open(file, ent)) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); };
  let info = {};
  try { info = JSON.parse(await text(about)); } catch { throw new Error('The backup is damaged: its studio-export.json can\'t be read.'); }
  const sum = list.find(e => e.name === `${root}/summary.txt`);
  return { list, root, about: info, summary: sum ? await text(sum) : '' };
}

// The notes typed in when a backup was made, from its summary (exportSummary).
function backupNotes(summary) {
  const m = /\n\nNotes\n([\s\S]*?)\n\n[A-Z][a-z]+ \(\d+\)\n/.exec(String(summary || ''));
  return m ? m[1].trim() : '';
}

// Restores a backup zip over this Mac's settings in `to`: the zip's settings are unpacked into
// a hidden folder in localDir and then restored with restore(), so this Mac's settings are
// backed up first and only replaced once the copy checks out. A backup without the media
// folder keeps this Mac's media. Only the names in SETTINGS are taken; nothing in the zip can
// land outside the folder. Returns { backup, files, about }.
async function restoreBackup({ file, to, localDir, log = () => {} }) {
  const zip = require('./zip');
  const { list, root, about } = await readBackup(file);
  const unpack = path.join(localDir, `.unpacking-${stamp()}`);
  try {
    for (const e of list) {
      if (!e.name.startsWith(`${root}/`) || e.name.endsWith('/')) continue;
      const rel = e.name.slice(root.length + 1);
      const parts = rel.split('/');
      if (!SETTINGS.has(parts[0]) || parts.some(p => !p || p === '.' || p === '..' || p.includes('\\'))) continue;
      const out = path.join(unpack, ...parts);
      if (!isInside(out, unpack)) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await new Promise((resolve, reject) => zip.open(file, e).on('error', reject).pipe(fs.createWriteStream(out)).on('finish', resolve).on('error', reject));
      if (fs.statSync(out).size !== e.size) throw new Error(`${rel} didn't unpack in full`);
    }
    if (!hasSettings(unpack)) throw new Error('That backup has no settings in it.');
    const result = restore({ from: unpack, to, localDir, keep: about.media === false ? ['media'] : [], log });
    return { ...result, about };
  } finally {
    fs.rmSync(unpack, { recursive: true, force: true });
  }
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

module.exports = { PROVIDERS, SETTINGS, LOCAL_ONLY, LOCATION_FILE, COMPUTER_FILE, computerName, current, computerId, movable, hasSettings, owner, usedByAnother, check, move, restore, restoreToCloud, otherMacs, exportEntries, exportSummary, exportName, readBackup, backupNotes, restoreBackup, save, placeholders, download, isInside };
