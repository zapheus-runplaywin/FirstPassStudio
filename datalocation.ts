// FirstPass Studio - keeping the settings folder in iCloud Drive.
//
// The data folder (datadir.ts) is on this Mac by default. It can instead live in a folder in
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
// live) and the night's other games followed in the background, caches, the Socials tab's polaroid photos, the games' stories (which stories.ts shares with the other Studio Macs itself), FirstPass stats (firstpass.ts: private, never in iCloud or a backup), the app's window positions, the AI captions' provider and spend (captions.ts) and this file. Only settings sync.
//
// Another Mac's settings can be restored onto this one (restore()): they are copied, never
// moved, so the other Mac keeps its own.
//
// PROVIDERS is the list of cloud drives; only iCloud Drive for now. Others (Dropbox, Google
// Drive, OneDrive all live under ~/Library/CloudStorage on a Mac) can be added beside it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import * as savefile from './savefile';
import * as zip from './zip';
import { errorMessage } from './errors';
import { arr as list0, obj, str } from './check';

type ProviderId = 'icloud';
// Where the settings are: on this computer, or a cloud drive's folder named after this Mac (data-location.json).
interface Location { local?: boolean; provider?: ProviderId; name?: string; folder?: string; dataDir: string; computer?: string; computerId?: string }
// A cloud drive folder checked for the settings (check()).
type Target = { ok: false; error: string } | { ok: true; provider: ProviderId; folder: string; dataDir: string; computer: string };
// Who uses a cloud folder (studio-computer.json).
interface Owner { computerId?: string; computer?: string; since?: string }
type Say = (message: string) => void;

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
  'scoreboard-state.json', 'followed-games.json', 'game-cache.json', 'last-game-summary.json', 'stream-keys.json', 'deck-key.txt', 'devices.json', 'socials-photos', 'game-stories', 'recordings.json', 'Recordings', 'demos.json', 'replay.json', 'securelink.json', 'firstpass', 'hq-signins.json', 'hq-tokens.json', 'captions.json',
]);

const PROVIDERS: Record<ProviderId, { name: string; root: () => string; contains: (p: string) => boolean }> = {
  icloud: {
    name: 'iCloud Drive',
    root: () => path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
    // Everything iCloud syncs (iCloud Drive and apps' own iCloud folders) is under Mobile Documents.
    contains: (p: string) => isInside(p, path.join(os.homedir(), 'Library', 'Mobile Documents')),
  },
};

function isInside(p: string, dir: string): boolean {
  // A path not made yet resolves through its nearest folder that exists, so a symlinked
  // parent (macOS's /var is /private/var) resolves the same for both paths.
  const real = (q: string): string => {
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
function computerName(): string {
  let name = '';
  if (process.platform === 'darwin') {
    try { name = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 2000 }).trim(); } catch { /* below */ }
  }
  if (!name) name = os.hostname().replace(/\.local$/i, '').split('.')[0];
  return name.replace(/[^A-Za-z0-9 ._-]/g, '-').replace(/^[.\s]+/, '').slice(0, 60) || 'This Mac';
}

// A JSON file, unchecked (null when there is none or it can't be read).
function readJson(file: string): unknown { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file: string, value: unknown) { savefile.writeJsonSync(file, value); }
const isProvider = (p: unknown): p is ProviderId => typeof p === 'string' && Object.hasOwn(PROVIDERS, p);

// Where the settings are: { local: true, dataDir } or { provider, name, folder, dataDir, computer, computerId }.
function current(localDir: string): Location {
  const saved = obj(readJson(path.join(localDir, LOCATION_FILE)));
  if (isProvider(saved.provider) && typeof saved.dataDir === 'string' && saved.dataDir) {
    return { ...saved, provider: saved.provider, name: PROVIDERS[saved.provider].name, dataDir: path.resolve(saved.dataDir),
      folder: str(saved.folder), computer: str(saved.computer), computerId: str(saved.computerId) || undefined };
  }
  return { local: true, dataDir: localDir, computerId: str(saved.computerId) || undefined };
}

// A random id for this Mac, made once and kept in the local folder.
function computerId(localDir: string): string {
  const file = path.join(localDir, LOCATION_FILE);
  const saved = obj(readJson(file));
  if (typeof saved.computerId === 'string' && saved.computerId) return saved.computerId;
  const id = crypto.randomUUID();
  fs.mkdirSync(localDir, { recursive: true });
  writeJson(file, { ...saved, computerId: id });
  return id;
}

// What's in a folder that Studio would move: the settings, not the local-only files.
function movable(dir: string): string[] {
  const real = (n: string) => { try { const st = fs.lstatSync(path.join(dir, n)); return st.isFile() || st.isDirectory(); } catch { return false; } };
  try { return fs.readdirSync(dir).filter(n => SETTINGS.has(n) && real(n)).sort(); } catch { return []; }
}
function hasSettings(dir: string): boolean { return movable(dir).length > 0; }

// Who uses a cloud subfolder: null if nobody has yet.
function owner(dir: string): Owner | null { const o = readJson(path.join(dir, COMPUTER_FILE)); return o && typeof o === 'object' ? o : null; }
// Whether another Mac (not this one) uses the subfolder.
function usedByAnother(dir: string, localDir: string): Owner | null {
  const o = owner(dir);
  return !!(o && o.computerId && o.computerId !== computerId(localDir)) ? o : null;
}

// Checks a folder picked for the settings. Returns { ok, error } or { ok, provider, folder, dataDir, computer }.
function check(folder: string | null | undefined, provider: unknown = 'icloud', { computer = computerName() } = {}): Target {
  if (!isProvider(provider)) return { ok: false, error: 'Unknown cloud drive.' };
  const p = PROVIDERS[provider];
  if (!fs.existsSync(p.root())) return { ok: false, error: `${p.name} isn't turned on for this Mac. Turn it on in System Settings > your name > iCloud > iCloud Drive, then try again.` };
  if (!folder || !p.contains(folder)) return { ok: false, error: `That folder isn't in ${p.name}. Pick a folder inside ${p.name}.` };
  return { ok: true, provider, folder, dataDir: path.join(folder, computer), computer };
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.copyFileSync(a, b);
  }
}
// Every file under the given names in a folder, with its size, for checking a copy.
function listing(dir: string, names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (rel: string) => {
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
function move({ from, to, localDir, existing, log = () => {} }: { from: string; to: string; localDir: string; existing?: 'use' | 'replace' | null; log?: Say }): { backup: string | null; kept: boolean } {
  from = path.resolve(from); to = path.resolve(to);
  if (from === to) return { backup: null, kept: true };
  const names = movable(from);
  const there = hasSettings(to);
  if (there && !existing) throw new Error('The new folder already holds settings: choose whether to use them or replace them.');
  const backups = path.join(localDir, 'backups');
  let backup: string | null = null;
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
    throw new Error(`Couldn't copy the settings: ${errorMessage(err)}. Nothing was moved.`);
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
function restore({ from, to, localDir, keep = [], machineFrom = to, log = () => {} }: {
  from: string; to: string; localDir: string; keep?: string[]; machineFrom?: string; log?: Say;
}): { backup: string | null; files: number } {
  from = path.resolve(from); to = path.resolve(to);
  if (from === to) throw new Error('That is this Mac\'s own settings folder.');
  const names = movable(from);
  if (!names.length) throw new Error('That folder has no FirstPass Studio settings in it.');
  const mine = movable(to);
  const ownConfig = obj(readJson(path.join(machineFrom, 'config.json')));
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
    throw new Error(`Couldn't copy the settings: ${errorMessage(err)}. This Mac's settings weren't changed.`);
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
function keepMachineKeys(dir: string, own: Record<string, unknown>): void {
  const file = path.join(dir, 'config.json');
  const cfg = readJson(file);
  if (!cfg && !MACHINE_ONLY.some(k => k in own)) return;
  const out = { ...obj(cfg) };
  for (const k of MACHINE_ONLY) { if (k in own) out[k] = own[k]; else delete out[k]; }
  writeJson(file, out);
}

function backupTo(dir: string, names: string[], backup: string): string | null {
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
function restoreToCloud({ from, localDir, provider = 'icloud', computer = computerName(), log = () => {} }: {
  from: string; localDir: string; provider?: unknown; computer?: string; log?: Say;
}) {
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
function otherMacs(folder: string, dataDir: string | null | undefined): { dir: string; computer: string; since?: string }[] {
  let list: fs.Dirent[]; try { list = fs.readdirSync(folder, { withFileTypes: true }); } catch { return []; }
  return list.filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => path.join(folder, e.name))
    .filter(d => path.resolve(d) !== path.resolve(dataDir || '') && hasSettings(d))
    .map(d => ({ dir: d, computer: (owner(d) || {}).computer || path.basename(d), since: (owner(d) || {}).since }));
}

// The settings as zip entries ({ name, file }, zip.ts), for Export settings as a zip: every
// file under SETTINGS in the folder, inside one folder named like the zip, plus
// studio-export.json saying where and when they came from (folder: exportName()). The local-only files (logs, scores
// and clock, caches) aren't settings, so they aren't in it. Hidden files (.DS_Store, a copy
// half made, iCloud's placeholders) are left out; skipped lists the placeholders, files iCloud
// hasn't downloaded. media: false leaves out the media folder (videos, music, images).
// summary.txt (exportSummary()) goes in too. Returns { list, skipped, bytes, summary }.
function exportEntries(dir: string, { media = true, folder = exportName(), about = {}, notes = '' }: { media?: boolean; folder?: string; about?: { studio?: string } & Record<string, unknown>; notes?: string } = {}) {
  const list: zip.Entry[] = [], skipped: string[] = [];
  let bytes = 0;
  const walk = (rel: string) => {
    const p = path.join(dir, rel);
    let st: fs.Stats; try { st = fs.lstatSync(p); } catch { return; }
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
function exportSummary(dir: string, { name = exportName(), about = {}, files = 0, bytes = 0, media = true, skipped = [], notes = '' }: {
  name?: string; about?: { studio?: string }; files?: number; bytes?: number; media?: boolean; skipped?: string[]; notes?: string;
} = {}): string {
  const json = (...p: string[]) => obj(readJson(path.join(dir, ...p)));
  const arr = (v: unknown) => list0(v).filter(x => x && typeof x === 'object').map(obj);
  const lines = [name, '', `Made ${new Date().toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' })} on ${computerName()}${about.studio ? `, FirstPass Studio ${about.studio}` : ''}.`,
    `${files} files, ${bytes < 1e6 ? '<1' : Math.round(bytes / 1e6)} MB${media ? '' : ', without the media folder'}.`];
  if (skipped.length) lines.push(`Not included, still only in iCloud: ${skipped.join(', ')}.`);
  notes = String(notes || '').trim();
  if (notes) lines.push('', 'Notes', notes);
  const section = (title: string, items: string[]) => { lines.push('', `${title} (${items.length})`); for (const i of items) lines.push(`- ${i}`); if (!items.length) lines.push('- none'); };
  const seqNames = (file: string) => arr(obj(readJson(file)).sequences).map(q => str(q.name) || 'Untitled sequence');
  let comps: string[] = [];
  try { comps = fs.readdirSync(path.join(dir, 'competitions'), { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort(); } catch { /* none */ }
  const active = json('competitions', 'active.json').active;
  const compName: Record<string, string> = {};
  for (const id of comps) { const c = json('competitions', id, 'settings.json'); compName[id] = str(c.name) || str(c.displayName) || id; }
  comps.sort((a, b) => compName[a].localeCompare(compName[b]));
  section('Competitions', comps.map(id => `${compName[id]}${id === active ? ' (in use)' : ''}`));
  const seqs: [string, string[]][] = comps.map(id => [compName[id], seqNames(path.join(dir, 'competitions', id, 'sequences.json'))]);
  const loose = seqNames(path.join(dir, 'sequences.json'));
  if (loose.length) seqs.push(['No competition', loose]);
  section('Sequences', seqs.flatMap(([c, list]) => list.map(q => `${q} (${c})`)));
  section('Playlists', arr(json('music.json').playlists).map(pl => `${str(pl.name) || 'Playlist'} (${list0(pl.tracks).length} songs)`));
  section('Mics', arr(json('mics.json').mics).map(m => `${str(m.name) || 'Mic'}${m.device ? ` (${str(m.device)})` : ''}`));
  const scene = json('scene.json');
  section('Sources', arr(scene.sources).map(src => `${str(src.name) || str(src.id) || 'Source'}${src.type ? ` (${str(src.type)})` : ''}`));
  section('Scenes', arr(scene.scenes).map(sc => str(sc.name) || 'Untitled scene'));
  section('Sponsors', arr(json('sponsors', 'sponsors.json').sponsors).map(sp => {
    const on = Object.keys(obj(sp.competitions)).map(id => compName[id] || id);
    return `${str(sp.name) || 'Sponsor'}${on.length ? ` (${on.join(', ')})` : ''}`;
  }));
  return lines.join('\n') + '\n';
}

// The name for an exported zip (without .zip): the prefix, then the date and time (this Mac's
// time), so each one is new and they sort oldest to newest: FirstPassStudioBackup-2026-10-24_10-46-02
function exportName(d = new Date()) {
  const two = (n: number) => String(n).padStart(2, '0');
  return `FirstPassStudioBackup-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

// A backup zip made by Back up… (exportEntries): its folder, studio-export.json and summary.txt.
// Throws if it isn't one. Returns { list, root, about, summary }.
async function readBackup(file: string): Promise<{ list: zip.ZipEntry[]; root: string; about: { media?: boolean } & Record<string, unknown>; summary: string }> {
  const list = zip.entries(file);
  const about = list.find(e => /^[^/]+\/studio-export\.json$/.test(e.name));
  if (!about) throw new Error("That zip isn't a FirstPass Studio backup: there's no studio-export.json in it. Pick a zip made with Back up….");
  const root = about.name.split('/')[0];
  const text = async (ent: zip.ZipEntry) => { const chunks: Buffer[] = []; for await (const c of zip.open(file, ent)) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); };
  let info: Record<string, unknown> = {};
  try { info = obj(JSON.parse(await text(about))); } catch { throw new Error('The backup is damaged: its studio-export.json can\'t be read.'); }
  const sum = list.find(e => e.name === `${root}/summary.txt`);
  return { list, root, about: info, summary: sum ? await text(sum) : '' };
}

// The notes typed in when a backup was made, from its summary (exportSummary).
function backupNotes(summary: unknown): string {
  const m = /\n\nNotes\n([\s\S]*?)\n\n[A-Z][a-z]+ \(\d+\)\n/.exec(String(summary || ''));
  return m ? m[1].trim() : '';
}

// Restores a backup zip over this Mac's settings in `to`: the zip's settings are unpacked into
// a hidden folder in localDir and then restored with restore(), so this Mac's settings are
// backed up first and only replaced once the copy checks out. A backup without the media
// folder keeps this Mac's media. Only the names in SETTINGS are taken; nothing in the zip can
// land outside the folder. Returns { backup, files, about }.
async function restoreBackup({ file, to, localDir, log = () => {} }: { file: string; to: string; localDir: string; log?: Say }) {
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
      await new Promise<void>((resolve, reject) => zip.open(file, e).on('error', reject).pipe(fs.createWriteStream(out)).on('finish', resolve).on('error', reject));
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
function save(localDir: string, { provider, folder, dataDir, computer }: { provider?: ProviderId | null; folder?: string; dataDir?: string; computer?: string }): void {
  const id = computerId(localDir);
  const file = path.join(localDir, LOCATION_FILE);
  if (!provider) return writeJson(file, { computerId: id });
  writeJson(path.join(dataDir ?? '', COMPUTER_FILE), { computerId: id, computer, since: new Date().toISOString() });
  writeJson(file, { provider, folder, dataDir, computer, computerId: id });
}

// iCloud can keep only a placeholder of a file on this Mac (Optimise Mac Storage): the file is
// gone and .<name>.icloud stands in for it. Lists the placeholders under a folder.
function placeholders(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let list: fs.Dirent[]; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
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
async function download(dir: string, { timeoutMs = 60000 } = {}): Promise<string[]> {
  let left = placeholders(dir);
  if (!left.length) return [];
  await new Promise<void>(r => execFile('/usr/bin/brctl', ['download', dir], { timeout: 10000 }, () => r()));
  for (const f of left) execFile('/usr/bin/brctl', ['download', f], { timeout: 10000 }, () => {});
  const end = Date.now() + timeoutMs;
  while ((left = placeholders(dir)).length && Date.now() < end) await new Promise(r => setTimeout(r, 500));
  return left;
}

export type { Location, Target, Owner, ProviderId };
export { PROVIDERS, SETTINGS, LOCAL_ONLY, LOCATION_FILE, COMPUTER_FILE, computerName, current, computerId, movable, hasSettings, owner, usedByAnother, check, move, restore, restoreToCloud, otherMacs, exportEntries, exportSummary, exportName, readBackup, backupNotes, restoreBackup, save, placeholders, download, isInside };
