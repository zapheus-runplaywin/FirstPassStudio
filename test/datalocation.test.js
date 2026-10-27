// Keeping the settings in iCloud Drive (datalocation.js): moving them in and back safely, a
// subfolder per Mac, and the files that stay on the Mac.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-home-'));
process.env.HOME = HOME;
const location = require('../datalocation.js');

const ICLOUD = path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
let n = 0;
function setup() {
  const local = path.join(HOME, `local-${++n}`);
  fs.mkdirSync(path.join(local, 'competitions', 'thunder', 'logos'), { recursive: true });
  fs.writeFileSync(path.join(local, 'competitions', 'thunder', 'settings.json'), '{"displayName":"Thunder"}');
  fs.writeFileSync(path.join(local, 'competitions', 'thunder', 'logos', 'Titans.png'), Buffer.alloc(5000, 7));
  fs.writeFileSync(path.join(local, 'control.json'), '{"round":"3"}');
  fs.writeFileSync(path.join(local, 'scoreboard-state.json'), '{"home":4}');
  fs.mkdirSync(path.join(local, 'logs'));
  fs.writeFileSync(path.join(local, 'logs', 'playhq-graphics.log'), 'log');
  fs.writeFileSync(path.join(local, 'app-settings.json'), '{}');
  // Electron's own files in the Mac app's folder: never moved (a dangling symlink among them).
  fs.mkdirSync(path.join(local, 'Cache'));
  fs.writeFileSync(path.join(local, 'Preferences'), '{}');
  fs.symlinkSync('/nowhere/at/all', path.join(local, 'SingletonCookie'));
  return local;
}
const read = f => fs.readFileSync(f, 'utf8');

test('a folder outside iCloud Drive, or iCloud Drive turned off, is refused', () => {
  assert.match(location.check(path.join(HOME, 'Documents'), 'icloud').error, /isn't turned on/);
  fs.mkdirSync(path.join(ICLOUD, 'FirstPass Studio'), { recursive: true });
  assert.match(location.check(path.join(HOME, 'Documents'), 'icloud').error, /isn't in iCloud Drive/);
  const ok = location.check(path.join(ICLOUD, 'FirstPass Studio'), 'icloud', { computer: 'Studio-Mac' });
  assert.equal(ok.ok, true);
  assert.equal(ok.dataDir, path.join(ICLOUD, 'FirstPass Studio', 'Studio-Mac'));
});

test('moving to iCloud Drive backs up, moves the settings into the Mac\'s subfolder and keeps local files local', () => {
  const local = setup();
  const target = location.check(path.join(ICLOUD, 'FirstPass Studio'), 'icloud', { computer: `Mac-${n}` });
  const { backup } = location.move({ from: local, to: target.dataDir, localDir: local });
  location.save(local, target);
  assert.equal(read(path.join(target.dataDir, 'competitions', 'thunder', 'settings.json')), '{"displayName":"Thunder"}');
  assert.equal(fs.statSync(path.join(target.dataDir, 'competitions', 'thunder', 'logos', 'Titans.png')).size, 5000);
  assert.equal(read(path.join(target.dataDir, 'control.json')), '{"round":"3"}');
  // Moved, not copied; the local-only files stay.
  assert.ok(!fs.existsSync(path.join(local, 'competitions')));
  assert.ok(!fs.existsSync(path.join(target.dataDir, 'scoreboard-state.json')));
  assert.ok(fs.existsSync(path.join(local, 'scoreboard-state.json')));
  assert.ok(fs.existsSync(path.join(local, 'logs', 'playhq-graphics.log')));
  for (const n of ['Cache', 'Preferences', 'SingletonCookie']) {
    assert.ok(fs.lstatSync(path.join(local, n)), `${n} stays`);
    assert.ok(!fs.existsSync(path.join(target.dataDir, n)), `${n} isn't moved`);
  }
  assert.equal(read(path.join(backup, 'control.json')), '{"round":"3"}');
  assert.ok(backup.startsWith(path.join(local, 'backups')));
  // Where they are is remembered on this Mac, and the subfolder is marked as this Mac's.
  const where = location.current(local);
  assert.equal(where.provider, 'icloud');
  assert.equal(where.dataDir, target.dataDir);
  assert.equal(location.owner(target.dataDir).computer, `Mac-${n}`);
  assert.equal(location.usedByAnother(target.dataDir, local), null);

  // And back again.
  location.move({ from: where.dataDir, to: local, localDir: local });
  location.save(local, { provider: null });
  assert.equal(read(path.join(local, 'control.json')), '{"round":"3"}');
  assert.ok(location.current(local).local);
  assert.equal(location.current(local).dataDir, local);
});

test('a second Mac with the same name is spotted', () => {
  const a = setup(), b = setup();
  const target = location.check(path.join(ICLOUD, 'FirstPass Studio'), 'icloud', { computer: 'Same-Name' });
  location.move({ from: a, to: target.dataDir, localDir: a });
  location.save(a, target);
  assert.equal(location.usedByAnother(target.dataDir, b).computer, 'Same-Name');
});

test('settings already in the folder are used or replaced, with both backed up', () => {
  const local = setup();
  const dir = path.join(ICLOUD, 'FirstPass Studio', `Mac-${n}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'control.json'), '{"round":"9"}');
  assert.throws(() => location.move({ from: local, to: dir, localDir: local }), /already holds settings/);
  assert.equal(read(path.join(local, 'control.json')), '{"round":"3"}');

  location.move({ from: local, to: dir, localDir: local, existing: 'replace' });
  assert.equal(read(path.join(dir, 'control.json')), '{"round":"3"}');
  const replaced = fs.readdirSync(path.join(local, 'backups')).find(f => f.endsWith('-replaced'));
  assert.equal(read(path.join(local, 'backups', replaced, 'control.json')), '{"round":"9"}');

  const other = setup();
  fs.writeFileSync(path.join(other, 'control.json'), '{"round":"1"}');
  const { kept } = location.move({ from: other, to: dir, localDir: other, existing: 'use' });
  assert.equal(kept, true);
  assert.equal(read(path.join(dir, 'control.json')), '{"round":"3"}');
  assert.ok(!fs.existsSync(path.join(other, 'control.json')));
});

test('iCloud placeholders of evicted files are found', () => {
  const dir = path.join(ICLOUD, 'evicted', 'competitions', 'thunder');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.settings.json.icloud'), '');
  assert.deepEqual(location.placeholders(path.join(ICLOUD, 'evicted')), [path.join(dir, 'settings.json')]);
});

test('Studio follows data-location.json and refuses to start on a missing iCloud folder', () => {
  const { execFileSync } = require('node:child_process');
  const local = setup();
  const dataDir = path.join(ICLOUD, 'gone', 'Mac');
  fs.writeFileSync(path.join(local, location.LOCATION_FILE), JSON.stringify({ provider: 'icloud', folder: path.dirname(dataDir), dataDir, computer: 'Mac' }));
  const run = () => execFileSync(process.execPath, ['-e', 'const d = require("./datadir"); console.log(d.DATA_DIR + "|" + d.local("logs"))'],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, FIRSTPASS_LOCAL_DIR: local, FIRSTPASS_DATA_DIR: '' }, encoding: 'utf8', stdio: 'pipe' });
  assert.throws(run, /can't be found/);
  assert.ok(!fs.existsSync(dataDir));
  fs.mkdirSync(dataDir, { recursive: true });
  assert.equal(run().trim(), `${dataDir}|${path.join(local, 'logs')}`);
});

test('another Mac\'s settings are restored over this Mac\'s, backed up first, and the other Mac keeps its own', () => {
  const folder = path.join(ICLOUD, 'Restore');
  const other = path.join(folder, 'Other-Mac'), mine = path.join(folder, 'This-Mac');
  fs.mkdirSync(path.join(other, 'competitions', 'wanl'), { recursive: true });
  fs.writeFileSync(path.join(other, 'competitions', 'wanl', 'settings.json'), '{"displayName":"WANL"}');
  fs.writeFileSync(path.join(other, 'control.json'), '{"round":"7"}');
  fs.writeFileSync(path.join(other, location.COMPUTER_FILE), '{"computerId":"other","computer":"Other-Mac"}');
  fs.mkdirSync(path.join(mine, 'competitions', 'thunder'), { recursive: true });
  fs.writeFileSync(path.join(mine, 'competitions', 'thunder', 'settings.json'), '{"displayName":"Thunder"}');
  fs.writeFileSync(path.join(mine, 'control.json'), '{"round":"3"}');
  fs.writeFileSync(path.join(mine, location.COMPUTER_FILE), '{"computerId":"mine","computer":"This-Mac"}');
  const local = setup();

  assert.deepEqual(location.otherMacs(folder, mine).map(o => o.computer), ['Other-Mac']);
  assert.throws(() => location.restore({ from: mine, to: mine, localDir: local }), /own settings folder/);
  assert.throws(() => location.restore({ from: path.join(folder, 'nope'), to: mine, localDir: local }), /no FirstPass Studio settings/);

  const { backup } = location.restore({ from: other, to: mine, localDir: local });
  assert.equal(read(path.join(mine, 'control.json')), '{"round":"7"}');
  assert.equal(read(path.join(mine, 'competitions', 'wanl', 'settings.json')), '{"displayName":"WANL"}');
  assert.ok(!fs.existsSync(path.join(mine, 'competitions', 'thunder')));
  // This Mac stays this Mac's; the other Mac's folder is untouched; no staging left behind.
  assert.equal(location.owner(mine).computer, 'This-Mac');
  assert.equal(read(path.join(other, 'control.json')), '{"round":"7"}');
  assert.deepEqual(fs.readdirSync(mine).filter(n => n.startsWith('.restoring')), []);
  assert.equal(read(path.join(backup, 'control.json')), '{"round":"3"}');
  assert.equal(read(path.join(backup, 'competitions', 'thunder', 'settings.json')), '{"displayName":"Thunder"}');
});

test('restoring onto a Mac whose settings are on the Mac puts them in its own iCloud subfolder', () => {
  const folder = path.join(ICLOUD, 'RestoreLocal');
  const other = path.join(folder, 'Other-Mac');
  fs.mkdirSync(path.join(other, 'competitions', 'wanl'), { recursive: true });
  fs.writeFileSync(path.join(other, 'control.json'), '{"round":"7"}');
  fs.writeFileSync(path.join(other, location.COMPUTER_FILE), '{"computerId":"other","computer":"Other-Mac"}');
  const local = setup();
  assert.throws(() => location.restoreToCloud({ from: other, localDir: local, computer: 'Other-Mac' }), /named after this Mac/);

  const { backup, target } = location.restoreToCloud({ from: other, localDir: local, computer: 'New-Mac' });
  assert.equal(target.dataDir, path.join(folder, 'New-Mac'));
  assert.equal(read(path.join(target.dataDir, 'control.json')), '{"round":"7"}');
  assert.equal(location.current(local).dataDir, target.dataDir);
  assert.equal(location.owner(target.dataDir).computer, 'New-Mac');
  // The Mac's old settings are backed up and gone from the Mac; local-only files stay.
  assert.equal(read(path.join(backup, 'control.json')), '{"round":"3"}');
  assert.ok(!fs.existsSync(path.join(local, 'control.json')));
  assert.ok(fs.existsSync(path.join(local, 'scoreboard-state.json')));
  assert.equal(read(path.join(other, 'control.json')), '{"round":"7"}');
});

test('restored settings never bring another Mac\'s lock, ffmpeg or PlayHQ address with them', async () => {
  const folder = path.join(ICLOUD, 'RestoreMachine');
  const other = path.join(folder, 'Other-Mac'), mine = path.join(folder, 'This-Mac');
  const theirs = { remoteChanges: true, ffmpegPath: '/tmp/evil-ffmpeg', apiBaseUrl: 'https://evil.example', port: 9999, playhqRefreshSeconds: 3 };
  for (const [dir, cfg] of [[other, theirs], [mine, { remoteChanges: false, playhqRefreshSeconds: 5 }]]) {
    fs.mkdirSync(path.join(dir, 'competitions', 'wanl'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'control.json'), '{}');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  }
  location.restore({ from: other, to: mine, localDir: setup() });
  assert.deepEqual(JSON.parse(read(path.join(mine, 'config.json'))), { remoteChanges: false, playhqRefreshSeconds: 3 },
    'this Mac\'s lock stays, their machine settings are dropped, the rest comes across');
  // From a backup zip too, onto a Mac with no config.json of its own.
  const zip = require('../zip');
  const file = path.join(folder, 'backup.zip');
  const out = fs.createWriteStream(file);
  const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
  await zip.write(out, location.exportEntries(other, { folder: 'FirstPassStudioBackup-x' }).list);
  await done;
  fs.rmSync(path.join(mine, 'config.json'));
  await location.restoreBackup({ file, to: mine, localDir: setup() });
  assert.deepEqual(JSON.parse(read(path.join(mine, 'config.json'))), { playhqRefreshSeconds: 3 });
  // And into this Mac's own iCloud folder, keeping the lock the Mac had.
  const local = setup();
  fs.writeFileSync(path.join(local, 'config.json'), JSON.stringify({ remoteChanges: false }));
  const { target } = location.restoreToCloud({ from: other, localDir: local, computer: 'Machine-Mac' });
  assert.deepEqual(JSON.parse(read(path.join(target.dataDir, 'config.json'))), { remoteChanges: false, playhqRefreshSeconds: 3 });
});

test('every file Studio saves is either a setting that moves or one that stays on the Mac', () => {
  const ROOT = path.join(__dirname, '..');
  const names = { file: new Set(), local: new Set() };
  for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [, kind, name] of src.matchAll(/(?:datadir\.(file|local)|\b(?:DATA))\(['"]([^'"\/]+)['"]/g)) names[kind === 'local' ? 'local' : 'file'].add(name);
  }
  assert.ok(names.file.has('competitions') && names.local.has('logs'));
  for (const n of names.file) assert.ok(location.SETTINGS.has(n), `${n} is saved with datadir.file() but isn't in SETTINGS, so it wouldn't move`);
  for (const n of names.local) assert.ok(location.LOCAL_ONLY.has(n), `${n} is saved with datadir.local() but isn't in LOCAL_ONLY`);
});

test('a file not made yet is inside its folder when the folder is reached through a symlink (macOS\'s /var)', () => {
  const real = path.join(HOME, 'real-var');
  fs.mkdirSync(path.join(real, 'unpack'), { recursive: true });
  fs.symlinkSync(real, path.join(HOME, 'var'));
  const unpack = path.join(HOME, 'var', 'unpack');
  assert.ok(location.isInside(path.join(unpack, 'control.json'), unpack));
  assert.ok(location.isInside(path.join(unpack, 'competitions', 'thunder', 'settings.json'), unpack));
  assert.ok(!location.isInside(path.join(HOME, 'var', 'elsewhere.json'), unpack));
});
