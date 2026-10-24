// Export settings as a zip: every setting, in a folder named with the date and time, without the
// local-only files; the zip Studio serves at /api/settings/export reads back file for file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const location = require('../datalocation');
const zip = require('../zip');
const { startStudio } = require('./support/studio');

function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-export-'));
  fs.mkdirSync(path.join(dir, 'competitions', 'thunder', 'logos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'competitions', 'thunder', 'settings.json'), '{"displayName":"Thunder"}');
  fs.writeFileSync(path.join(dir, 'competitions', 'thunder', 'logos', 'Titans.png'), Buffer.alloc(5000, 7));
  fs.writeFileSync(path.join(dir, 'competitions', 'thunder', 'logos', '.DS_Store'), 'x');
  fs.writeFileSync(path.join(dir, 'competitions', 'thunder', 'logos', '.Hawks.png.icloud'), 'placeholder');
  fs.writeFileSync(path.join(dir, 'control.json'), '{"round":"3"}');
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'intro.mp4'), Buffer.alloc(2000, 1));
  fs.writeFileSync(path.join(dir, 'scoreboard-state.json'), '{"home":4}');
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.writeFileSync(path.join(dir, 'logs', 'playhq-graphics.log'), 'log');
  fs.mkdirSync(path.join(dir, 'Cache'));
  return dir;
}

test('the zip name starts FirstPassStudioBackup- then the date and time, so they sort oldest to newest', () => {
  assert.equal(location.exportName(new Date(2026, 9, 24, 9, 5, 2)), 'FirstPassStudioBackup-2026-10-24_09-05-02');
  const names = [new Date(2026, 9, 24, 10, 0, 0), new Date(2025, 11, 31, 23, 59, 59), new Date(2026, 0, 2, 8, 0, 0)].map(d => location.exportName(d));
  assert.deepEqual([...names].sort(), [names[1], names[2], names[0]]);
});

test('the export holds the settings only, in one folder, with studio-export.json', t => {
  const dir = folder();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { list, skipped } = location.exportEntries(dir, { folder: 'Backup', about: { studio: '1.2.3' } });
  assert.deepEqual(list.map(e => e.name).sort(), [
    'Backup/competitions/thunder/logos/Titans.png', 'Backup/competitions/thunder/settings.json',
    'Backup/control.json', 'Backup/media/intro.mp4', 'Backup/studio-export.json', 'Backup/summary.txt',
  ]);
  assert.deepEqual(skipped, [path.join('competitions', 'thunder', 'logos', 'Hawks.png')]);
  const about = JSON.parse(list.find(e => e.name === 'Backup/studio-export.json').data);
  assert.equal(about.studio, '1.2.3');
  assert.equal(about.files, 4);
  assert.equal(about.media, true);
  const noMedia = location.exportEntries(dir, { folder: 'Backup', media: false }).list.map(e => e.name);
  assert.ok(!noMedia.some(n => n.startsWith('Backup/media/')));
  assert.ok(noMedia.includes('Backup/control.json'));
});

test('the summary names the competitions, sequences, playlists, sources, scenes and sponsors, under the notes', t => {
  const dir = folder();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (f, v) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(v)); };
  put('competitions/thunder/settings.json', { name: 'Thunder League' });
  put('competitions/wanl/settings.json', { name: 'GIG WANL' });
  put('competitions/active.json', { active: 'thunder' });
  put('competitions/thunder/sequences.json', { sequences: [{ name: 'Pre-game' }, { name: 'Quarter time' }] });
  put('music.json', { playlists: [{ name: 'Warm up', tracks: ['a.mp3', 'b.mp3'] }] });
  put('scene.json', { sources: [{ name: 'Scoreboard', type: 'browser' }], scenes: [{ name: 'Live' }] });
  put('sponsors/sponsors.json', { sponsors: [{ name: 'Gold Bakery', competitions: { thunder: { tier: 'major' } } }] });
  const { summary } = location.exportEntries(dir, { folder: 'FirstPassStudioBackup-x', about: { studio: '1.2.3' }, notes: 'Before round 6 changes' });
  for (const line of ['FirstPassStudioBackup-x', 'Notes\nBefore round 6 changes', 'Competitions (2)\n- GIG WANL\n- Thunder League (in use)',
    'Sequences (2)\n- Pre-game (Thunder League)\n- Quarter time (Thunder League)', 'Playlists (1)\n- Warm up (2 songs)',
    'Sources (1)\n- Scoreboard (browser)', 'Scenes (1)\n- Live', 'Sponsors (1)\n- Gold Bakery (Thunder League)', 'FirstPass Studio 1.2.3']) {
    assert.ok(summary.includes(line), `${line}\n---\n${summary}`);
  }
  assert.ok(!location.exportSummary(dir).includes('Notes'), 'no notes, no Notes heading');
});

test('/api/settings/export downloads every setting as a zip named with the date and time', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'intro.mp4'), Buffer.alloc(3000, 2));
  const res = await fetch(`${studio.base}/api/settings/export`);
  assert.equal(res.status, 200);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition'))[1];
  assert.match(name, /^FirstPassStudioBackup-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.zip$/);
  const file = path.join(studio.dataDir, 'download.zip');
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const names = zip.entries(file).map(e => e.name);
  const top = name.replace(/\.zip$/, '');
  assert.ok(names.every(n => n.startsWith(`${top}/`)), 'all inside one folder');
  assert.ok(names.includes(`${top}/competitions/active.json`));
  assert.ok(names.some(n => /\/competitions\/[^/]+\/settings\.json$/.test(n)));
  assert.ok(names.includes(`${top}/media/intro.mp4`));
  assert.ok(names.includes(`${top}/studio-export.json`));
  assert.ok(names.includes(`${top}/summary.txt`));
  assert.ok(!names.some(n => /logs\/|scoreboard-state\.json|game-cache\.json/.test(n)), 'local-only files stay out');
  // Each file reads back as it is in the settings folder.
  const ent = zip.entries(file).find(e => e.name === `${top}/media/intro.mp4`);
  const chunks = []; for await (const c of zip.open(file, ent)) chunks.push(c);
  assert.equal(Buffer.concat(chunks).length, 3000);
  const small = path.join(studio.dataDir, 'small.zip');
  fs.writeFileSync(small, Buffer.from(await (await fetch(`${studio.base}/api/settings/export?media=0`)).arrayBuffer()));
  assert.ok(!zip.entries(small).some(e => e.name.includes('/media/')));
});
