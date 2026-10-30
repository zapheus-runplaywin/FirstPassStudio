// 4K replay (replay.js): a recorded night's on-air layer goes back on the pages exactly as it went to air: the
// scene, the scoreboard and a graphic's reads come from the recording at the replay's point, the live scene and
// scoreboard are left as they were and can't be changed while it runs, and Stop puts the live ones back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { startStudio } = require('./support/studio');

test('a replay puts the recorded night on the pages, leaves the live setup alone and stops cleanly', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const live = await studio.get('/api/scene');

  const T0 = Date.now() - 2 * 86400000;
  const scene = on => ({ sources: [{ id: 'sb', name: 'Scoreboard', url: 'scoreboard.html', visible: on }, { id: 'lt', name: 'Ladder', url: 'ladder.html', visible: false }], scenes: [], current: null });
  const board = (t, home, period) => ({ t, k: 'board', board: { gameId: 'g1', period, home: { name: 'Red', score: home }, away: { name: 'Blue', score: 0 },
    clock: { running: true, startedAt: t - 1000, elapsedMs: 0, lengthSec: 600 }, serverNow: t } });
  const lines = [
    { t: T0, k: 'start' },
    { t: T0 + 1000, k: 'game', id: 'g1', home: 'Red', away: 'Blue' },
    { t: T0 + 2000, k: 'scene', scene: scene(false) },
    board(T0 + 2000, 0, 'FIRST_QTR'),
    { t: T0 + 3000, k: 'api', p: '/api/ladder?division=Open', body: { division: 'Open', pools: [[{ team: 'Red' }]], serverNow: T0 } },
    { t: T0 + 60000, k: 'scene', scene: scene(true) },
    board(T0 + 70000, 4, 'SECOND_QTR'),
    { t: T0 + 90000, k: 'end' },
  ];
  const name = 'replay-test.jsonl.gz'.replace('replay-test', new Date(T0).toISOString().slice(0, 10) + ' 1900');
  fs.writeFileSync(path.join(studio.dataDir, 'Recordings', name), zlib.gzipSync(lines.map(l => JSON.stringify(l)).join('\n') + '\n'));

  const s = await studio.post('/api/replay', { start: { recording: name, game: 'g1' } });
  assert.equal(s.active, true);
  assert.equal(s.paused, true, 'it waits at the game for Play');
  assert.deepEqual(s.events.map(e => e.label), ['Game: Red v Blue', 'Q1', 'Scoreboard on', 'Q2']);

  // The pages get the recorded scene, and a graphic its recorded read; a Studio page's read is live.
  await studio.until(async () => (await studio.get('/api/scene')).sources.some(x => x.id === 'sb'));
  let st = await studio.get('/api/scene');
  assert.equal(st.sources.find(x => x.id === 'sb').visible, false);
  const graphic = { referer: `${studio.base}/ladder.html?division=Open` };
  const ladder = (await studio.request('GET', '/api/ladder?division=Open', undefined, graphic)).json;
  assert.deepEqual(ladder.pools, [[{ team: 'Red' }]]);
  assert.ok(Math.abs(ladder.serverNow - Date.now()) < 5000, 'its serverNow is now');

  // Jump to the scoreboard coming on: the scene there, paused.
  const at = s.events.find(e => e.label === 'Scoreboard on').t;
  const j = await studio.post('/api/replay', { seek: at });
  assert.equal(j.position, at);
  st = await studio.get('/api/scene');
  assert.equal(st.sources.find(x => x.id === 'sb').visible, true);
  // The nudge moves it by a frame.
  assert.equal((await studio.post('/api/replay', { nudge: 40 })).position, at + 40);
  // Played, it moves on.
  await studio.post('/api/replay', { pause: false });
  await new Promise(r => setTimeout(r, 300));
  assert.ok((await studio.get('/api/replay')).position > at + 40);

  // Nothing live can be changed meanwhile, but the outputs can.
  const press = await studio.request('POST', '/api/scoreboard', { type: 'score', side: 'home', delta: 1 });
  assert.equal(press.status, 409);
  assert.match(press.text, /replay is running/);
  assert.equal((await studio.request('POST', '/api/scene', { type: 'show', id: 'x' })).status, 409);
  assert.equal((await studio.request('POST', '/api/practice', { start: { recording: name, game: 'g1' } })).status, 409);
  assert.equal((await studio.request('POST', '/api/outputs', { quality: 'uhd' })).status, 200);

  // Stop: the live scene again, and changes work.
  assert.equal((await studio.post('/api/replay', { stop: true })).active, false);
  st = await studio.get('/api/scene');
  assert.deepEqual(st.sources.map(x => x.id), live.sources.map(x => x.id));
  assert.equal((await studio.request('POST', '/api/scoreboard', { type: 'score', side: 'home', delta: 1 })).status, 200);
});
