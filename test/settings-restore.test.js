// Restore from a backup: a zip made with Back up… goes back in place of this Mac's settings,
// after backing them up, keeping this Mac's media when the backup has none, and never writing
// outside the settings folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const location = require('../datalocation');
const zip = require('../zip');

function folder(round) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-restore-'));
  fs.mkdirSync(path.join(dir, 'competitions', 'thunder', 'logos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'competitions', 'thunder', 'settings.json'), JSON.stringify({ name: `Thunder ${round}` }));
  fs.writeFileSync(path.join(dir, 'competitions', 'thunder', 'logos', 'Titans.png'), Buffer.alloc(5000, round));
  fs.writeFileSync(path.join(dir, 'control.json'), JSON.stringify({ round }));
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', `intro-${round}.mp4`), Buffer.alloc(2000, round));
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.writeFileSync(path.join(dir, 'logs', 'playhq-graphics.log'), 'log');
  return dir;
}
async function save(file, list) {
  const out = fs.createWriteStream(file);
  const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
  await zip.write(out, list);
  await done;
}
const read = f => fs.readFileSync(f, 'utf8');

test('a backup restores over this Mac\'s settings, which are backed up first', async t => {
  const old = folder(3), mine = folder(7);
  t.after(() => { fs.rmSync(old, { recursive: true, force: true }); fs.rmSync(mine, { recursive: true, force: true }); });
  const file = path.join(old, 'backup.zip');
  await save(file, location.exportEntries(old, { folder: 'FirstPassStudioBackup-x', about: { studio: '1.2.3' }, notes: 'Before round 6' }).list);
  const { about, summary } = await location.readBackup(file);
  assert.equal(about.studio, '1.2.3');
  assert.equal(location.backupNotes(summary), 'Before round 6');
  const result = await location.restoreBackup({ file, to: mine, localDir: mine });
  assert.equal(read(path.join(mine, 'control.json')), '{"round":3}');
  assert.equal(JSON.parse(read(path.join(mine, 'competitions', 'thunder', 'settings.json'))).name, 'Thunder 3');
  assert.ok(fs.existsSync(path.join(mine, 'media', 'intro-3.mp4')));
  assert.ok(!fs.existsSync(path.join(mine, 'media', 'intro-7.mp4')), 'the media is the backup\'s');
  assert.ok(!fs.existsSync(path.join(mine, 'studio-export.json')) && !fs.existsSync(path.join(mine, 'summary.txt')));
  assert.equal(read(path.join(mine, 'logs', 'playhq-graphics.log')), 'log', 'local files untouched');
  assert.equal(read(path.join(result.backup, 'control.json')), '{"round":7}', 'this Mac\'s settings were backed up');
  assert.ok(!fs.readdirSync(mine).some(n => n.startsWith('.unpacking-')), 'the unpacked copy is cleaned up');
});

test('a backup made without the media folder keeps this Mac\'s media', async t => {
  const old = folder(3), mine = folder(7);
  t.after(() => { fs.rmSync(old, { recursive: true, force: true }); fs.rmSync(mine, { recursive: true, force: true }); });
  const file = path.join(old, 'backup.zip');
  await save(file, location.exportEntries(old, { folder: 'B', media: false }).list);
  await location.restoreBackup({ file, to: mine, localDir: mine });
  assert.equal(read(path.join(mine, 'control.json')), '{"round":3}');
  assert.ok(fs.existsSync(path.join(mine, 'media', 'intro-7.mp4')));
});

test('a zip that isn\'t a backup is refused, and nothing in one lands outside the settings', async t => {
  const mine = folder(7);
  t.after(() => fs.rmSync(mine, { recursive: true, force: true }));
  const plain = path.join(mine, 'plain.zip');
  await save(plain, [{ name: 'control.json', data: Buffer.from('{}') }]);
  await assert.rejects(location.restoreBackup({ file: plain, to: mine, localDir: mine }), /isn't a FirstPass Studio backup/);
  assert.equal(read(path.join(mine, 'control.json')), '{"round":7}');
  const evil = path.join(mine, 'evil.zip');
  await save(evil, [
    { name: 'B/studio-export.json', data: Buffer.from('{}') },
    { name: 'B/control.json', data: Buffer.from('{"round":1}') },
    { name: 'B/../../escaped.txt', data: Buffer.from('x') },
    { name: 'B/competitions/../../escaped2.txt', data: Buffer.from('x') },
    { name: 'B/logs/playhq-graphics.log', data: Buffer.from('replaced') },
  ]);
  await location.restoreBackup({ file: evil, to: mine, localDir: mine });
  assert.equal(read(path.join(mine, 'control.json')), '{"round":1}');
  assert.ok(!fs.existsSync(path.join(mine, '..', 'escaped.txt')) && !fs.existsSync(path.join(mine, 'escaped2.txt')));
  assert.equal(read(path.join(mine, 'logs', 'playhq-graphics.log')), 'log');
});
