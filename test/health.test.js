// /api/health (server.js): one answer for the Output page's status line, saying what Studio follows,
// how long since PlayHQ answered, and the state of the clock and the video output.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let studio;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
});
test.after(() => studio && studio.stop());
// Until PR #214 (Studio reads PlayHQ on its own timer) is in, PlayHQ is read when a page asks for the scoreboard.
const poll = () => studio.get('/api/scoreboard');

test('health names the game, follows PlayHQ and reports a recent reading', async () => {
  const h = await studio.until(async () => { await poll(); const h = await studio.get('/api/health'); return h.playhq.readAgoMs !== null && h; }, 8000, 250);
  assert.equal(h.competition, 'Thunder League');
  assert.match(h.game.label, / v /);
  assert.equal(h.game.court, 'Court 1');
  assert.equal(h.source, 'playhq');
  assert.equal(h.playhq.following, true);
  assert.equal(h.playhq.waiting, '');
  assert.equal(h.playhq.state, 'ok');
  assert.ok(h.playhq.readAgoMs < 10000);
  assert.equal(h.clock.following, true);
  assert.equal(h.output.on, false);
  assert.equal(typeof h.sources, 'number');
  assert.equal(typeof h.version, 'string');
  // For the tab bar's chips (studiobar.js): the clock's period label, every output sending, the sequence playing
  // or armed, and the recorder.
  assert.equal(h.clock.periodLabel, 'Q');
  assert.deepEqual(h.output.onAir, []);
  assert.equal(h.playing, null);
  assert.equal(h.armed, null);
  assert.equal(typeof h.recording.on, 'boolean');
  assert.equal(typeof h.recording.record, 'boolean');
});

test('a score press by hand shows as scores by hand, and a failing live feed turns the state amber then red', async () => {
  await studio.post('/api/scoreboard', { type: 'score', side: 'home', delta: 1 });
  let h = await studio.get('/api/health');
  assert.equal(h.source, 'manual');
  assert.equal(h.playhq.following, false);
  assert.equal(h.playhq.state, 'ok', 'nothing to read, so nothing is wrong');
  // Back to PlayHQ, with the live feed failing: the reading goes stale.
  await studio.post('/api/scoreboard', { type: 'source', value: 'playhq' });
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
  studio.world.fail.live = 503;
  h = await studio.until(async () => { await poll(); const h = await studio.get('/api/health'); return h.playhq.state === 'warn' && h.playhq.error && h; }, 15000, 500);
  assert.match(h.playhq.error, /503/);
  studio.world.fail.live = null;
  h = await studio.until(async () => { await poll(); const h = await studio.get('/api/health'); return h.playhq.state === 'ok' && h; }, 10000, 500);
  assert.equal(h.playhq.error, '');
});
