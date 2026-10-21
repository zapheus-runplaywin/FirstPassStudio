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
