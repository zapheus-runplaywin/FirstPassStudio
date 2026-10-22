// Removing media (scene.js mediaUses and removeMedia, DELETE /api/scene/media): where a file is used, the
// warning before it goes, nothing on air removed, and the lists that keep it letting go.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startStudio } = require('./support/studio');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-mediaremove-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const competitions = require('../competitions');
const sponsors = require('../sponsors');
const scene = require('../scene');
competitions.init(() => {});
const comp = competitions.create('Thunder League');
competitions.setActive(comp);
scene.init(() => {}, { sequencesFile: () => path.join(competitions.DIR, competitions.activeId(), 'sequences.json') });

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = name => st().sources.find(s => s.name === name).id;
const has = f => fs.existsSync(path.join(scene.MEDIA_DIR, f));
const media = f => { fs.mkdirSync(scene.MEDIA_DIR, { recursive: true }); fs.writeFileSync(path.join(scene.MEDIA_DIR, f), 'x'); };
const kinds = f => scene.mediaUses(f).map(u => `${u.type} ${u.name}${u.onAir ? ' on air' : ''}`).sort();

function reset() {
  scene.apply({ type: 'seqStop' });
  ok({ type: 'musicStop', fade: 0 });
  for (const s of [...st().sequences]) ok({ type: 'seqRemove', sequence: s.id });
  for (const s of [...st().playlists]) ok({ type: 'playlistRemove', playlist: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  for (const s of sponsors.all()) sponsors.remove(s.id);
  ok({ type: 'musicSettings', settings: { superShotSong: '' } });
}

test('an unused file is removed straight away', () => {
  reset();
  media('Spare.png');
  assert.deepEqual(scene.mediaUses('Spare.png'), []);
  assert.deepEqual(scene.removeMedia('Spare.png', false), { uses: [] });
  assert.equal(has('Spare.png'), false);
  assert.equal(scene.removeMedia('Spare.png', true).status, 404, 'gone');
});

test('a used file lists where, and goes only when forced; lists let go of it, sources keep its name', () => {
  reset();
  media('Bed.mp3'); media('Other.mp3'); media('Golds.png');
  ok({ type: 'add', sources: [{ type: 'image', name: 'Sponsor still', file: 'Golds.png' }, { type: 'browser', name: 'Intro', url: 'introoutro.html?theme=Bed.mp3' }] });
  ok({ type: 'playlistAdd', changes: { name: 'Pre-game', tracks: ['Bed.mp3', 'Other.mp3'] } });
  ok({ type: 'musicSettings', settings: { superShotSong: 'Bed.mp3' } });
  ok({ type: 'seqAdd', changes: { name: 'Run-up', music: { track: 'Bed.mp3' }, steps: [{ sources: [id('Intro')], length: { type: 'time', sec: 10 } }] } });
  sponsors.save({ name: "Gold's Bakery", ads: [{ file: 'Golds.png', seconds: 8 }], competitions: { [comp]: { tier: 'major' } } });

  assert.deepEqual(kinds('Bed.mp3'), ['playlist Pre-game', 'sequence Run-up', 'superShot Super shot song', 'theme Intro']);
  assert.deepEqual(kinds('Golds.png'), ["source Sponsor still", "sponsor Gold's Bakery"]);
  assert.equal(scene.mediaUses('Bed.mp3').find(u => u.type === 'sequence').competition, 'Thunder League');

  const asked = scene.removeMedia('Bed.mp3', false);
  assert.equal(asked.status, 409);
  assert.equal(asked.uses.length, 4);
  assert.equal(has('Bed.mp3'), true, 'kept until forced');

  assert.equal(scene.removeMedia('Bed.mp3', true).error, undefined);
  assert.equal(has('Bed.mp3'), false);
  assert.deepEqual(st().playlists[0].tracks, ['Other.mp3']);
  assert.equal(st().musicSettings.superShotSong, '');
  assert.equal(st().sequences[0].music.track, 'Bed.mp3', 'the sequence keeps its music, shown as missing');
  assert.match(st().sources.find(s => s.name === 'Intro').url, /theme=Bed\.mp3/);

  assert.equal(scene.removeMedia('Golds.png', true).error, undefined);
  assert.deepEqual(sponsors.all()[0].ads, []);
  assert.equal(st().sources.find(s => s.name === 'Sponsor still').file, 'Golds.png', 'the source keeps its file name');
});

test('nothing on air is removed: a source showing it, or the song playing', () => {
  reset();
  media('Wave.mp4'); media('Walk out.m4a');
  ok({ type: 'add', sources: [{ type: 'video', name: 'Wave', file: 'Wave.mp4' }] });
  ok({ type: 'show', id: id('Wave') });
  assert.deepEqual(kinds('Wave.mp4'), ['source Wave on air']);
  const r = scene.removeMedia('Wave.mp4', true);
  assert.equal(r.status, 409);
  assert.match(r.error, /on air/);
  assert.equal(has('Wave.mp4'), true);
  ok({ type: 'hide', id: id('Wave') });
  assert.equal(scene.removeMedia('Wave.mp4', true).error, undefined);

  ok({ type: 'musicLoad', track: 'Walk out.m4a' });
  ok({ type: 'musicPlay', fade: 0 });
  assert.deepEqual(kinds('Walk out.m4a'), ['player The music player on air']);
  assert.equal(scene.removeMedia('Walk out.m4a', true).status, 409);
  ok({ type: 'musicStop', fade: 0 });
  mock.timers.tick(100);
  assert.equal(scene.removeMedia('Walk out.m4a', true).error, undefined);
  assert.equal(st().music.track, null, 'out of the player too');
});

test('a levelled song goes with its original', () => {
  reset();
  media('Anthem.m4a');
  fs.mkdirSync(path.join(scene.MEDIA_DIR, 'originals'), { recursive: true });
  fs.writeFileSync(path.join(scene.MEDIA_DIR, 'originals', 'Anthem.wav'), 'x');
  assert.equal(scene.removeMedia('Anthem.m4a', false).error, undefined);
  assert.equal(fs.existsSync(path.join(scene.MEDIA_DIR, 'originals', 'Anthem.wav')), false);
});

test('DELETE /api/scene/media asks, then removes with force=1; GET ?uses=1 lists the uses', async t => {
  const studio = await startStudio(t);
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'Logo.png'), 'x');
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'image', name: 'Logo', file: 'Logo.png' }] });
  const list = await studio.get('/api/scene/media?uses=1');
  const logo = list.media.find(m => m.name === 'Logo.png');
  assert.equal(logo.size, 1);
  assert.deepEqual(logo.uses, [{ type: 'source', name: 'Logo', onAir: false }]);

  const asked = await studio.request('DELETE', '/api/scene/media?name=Logo.png');
  assert.equal(asked.status, 409);
  assert.equal(asked.json.uses.length, 1);
  const done = await studio.del('/api/scene/media?name=Logo.png&force=1');
  assert.equal(done.removed, 'Logo.png');
  assert.equal(done.media.some(m => m.name === 'Logo.png'), false);
  assert.equal((await studio.request('DELETE', '/api/scene/media?name=Logo.png')).status, 404);
  assert.equal((await studio.request('DELETE', '/api/scene/media?name=..%2Fscene.json&force=1')).status, 404, 'only media files');
});
