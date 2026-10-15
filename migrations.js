// FirstPass Studio - bringing saved settings up to date after an update.
//
// The data folder (datadir.js) has a version number in data-version.json. Each release
// that changes how settings are saved adds a step below that turns version N into N+1;
// on start every step the folder hasn't had yet runs in order. Before any step runs, the
// whole folder (except logs and earlier backups) is copied to backups/<date>-v<N>, so an
// update can be undone by copying that folder back. The newest 5 backups are kept.
//
// A new setting needs no step: competitions.js fills in its default when it's missing.
// Steps are for settings that are renamed, moved or change meaning.
//
// If the folder was saved by a newer Studio (its version is higher than VERSION), nothing
// is changed and competitions open read-only, so an older copy can't throw away settings
// it doesn't understand.

'use strict';

const fs = require('fs');
const path = require('path');
const { APP_DIR, DATA_DIR, IMPORTS_DIR } = require('./datadir');

const VERSION_FILE = path.join(DATA_DIR, 'data-version.json');
const BACKUPS = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 5;

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
const exists = p => fs.existsSync(p);
const validId = id => /^[a-z0-9-]{1,40}$/.test(id);

// ─── Steps ──────────────────────────────────────────────────────────────────
// Each step gets { log } and works on DATA_DIR. Never change a step once released;
// add a new one instead.
const STEPS = [
  {
    to: 1,
    what: 'Move settings out of the app folder into the data folder',
    // Before October 2026 settings were saved inside the app folder: competitions/ (and
    // settings/ before that), control.json, round-choice.json and scoreboard-state.json.
    // Bring across whatever is still there. A competition whose settings.json went with
    // the move to imports/ (git removes tracked files) but left photos or an athlete
    // register behind is rebuilt from its import config, keeping those.
    run({ log }) {
      if (path.resolve(APP_DIR) === path.resolve(DATA_DIR)) return;
      const dest = path.join(DATA_DIR, 'competitions');
      let active = null;
      for (const [src, activeFile] of [
        [path.join(APP_DIR, 'settings', 'competitions'), path.join(APP_DIR, 'settings', 'active.json')],
        [path.join(APP_DIR, 'competitions'), path.join(APP_DIR, 'competitions', 'active.json')],
      ]) {
        if (!exists(src)) continue;
        for (const e of fs.readdirSync(src, { withFileTypes: true })) {
          if (!e.isDirectory() || !validId(e.name) || exists(path.join(dest, e.name))) continue;
          const from = path.join(src, e.name), to = path.join(dest, e.name);
          if (exists(path.join(from, 'settings.json'))) copyDir(from, to);
          else if (exists(path.join(IMPORTS_DIR, e.name, 'settings.json'))) { copyDir(path.join(IMPORTS_DIR, e.name), to); copyDir(from, to); }
          else continue;
          log('info', 'migrate', `Moved the ${e.name} competition into the data folder`);
        }
        try { active = active || JSON.parse(fs.readFileSync(activeFile, 'utf8')).active; } catch { /* none */ }
      }
      if (active && exists(path.join(dest, active, 'settings.json')) && !exists(path.join(dest, 'active.json'))) {
        fs.writeFileSync(path.join(dest, 'active.json'), JSON.stringify({ active }, null, 2) + '\n');
      }
      for (const [from, to] of [
        [path.join(APP_DIR, 'settings', 'control.json'), 'control.json'],
        [path.join(APP_DIR, 'control.json'), 'control.json'],
        [path.join(APP_DIR, 'round-choice.json'), 'round-choice.json'],
        [path.join(APP_DIR, 'scoreboard-state.json'), 'scoreboard-state.json'],
      ]) {
        if (exists(from) && !exists(path.join(DATA_DIR, to))) { fs.copyFileSync(from, path.join(DATA_DIR, to)); log('info', 'migrate', `Moved ${to} into the data folder`); }
      }
    },
  },
];
const VERSION = STEPS.length ? STEPS[STEPS.length - 1].to : 0;

function readVersion() {
  try { return Number(JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).version) || 0; } catch { return 0; }
}
function writeVersion(v) { fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: v }, null, 2) + '\n'); }

function backup(from, log) {
  const has = fs.readdirSync(DATA_DIR).some(n => !['logs', 'backups', 'data-version.json', '.DS_Store'].includes(n));
  if (!has) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(BACKUPS, `${stamp}-v${from}`);
  copyDir(DATA_DIR, dir, n => n === 'logs' || n === 'backups');
  log('info', 'migrate', `Backed up the data folder to ${dir}`);
  const old = fs.readdirSync(BACKUPS).sort().slice(0, -KEEP_BACKUPS);
  for (const n of old) fs.rmSync(path.join(BACKUPS, n), { recursive: true, force: true });
  return dir;
}

// Runs on start. Returns { version, readOnly, backup }.
function run(log) {
  const from = readVersion();
  if (from > VERSION) {
    log('warn', 'migrate', `The data folder was saved by a newer FirstPass Studio (data version ${from}, this one knows ${VERSION}). Competitions are read-only until Studio is updated.`);
    return { version: from, readOnly: true };
  }
  if (from === VERSION) return { version: from, readOnly: false };
  const saved = backup(from, log);
  for (const step of STEPS.filter(s => s.to > from)) {
    log('info', 'migrate', `Data version ${step.to - 1} to ${step.to}: ${step.what}`);
    step.run({ log });
    writeVersion(step.to);
  }
  return { version: VERSION, readOnly: false, backup: saved };
}

module.exports = { VERSION, run, copyDir };
