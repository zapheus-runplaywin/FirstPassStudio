// Studio reads the live score itself (server.ts refreshTick): with no page asking for the
// scoreboard, the board, the goal order and the game snapshot the sequences' triggers read still
// follow PlayHQ's live feed. Before this the reading only happened inside a page's request.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio.mts');

let studio, live, game;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  game = studio.world.gameNow(0);
  live = studio.world.live[game.id];
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
});
test.after(() => studio && studio.stop());

// Only this game's readings: Studio also follows the night's other games in the background (follow-others.test.js).
const liveCalls = () => studio.world.calls.filter(c => c.spectator && c.variables.id === game.id).length;

test('the score and goal order follow PlayHQ while nothing asks Studio for the scoreboard', async () => {
  const before = liveCalls();
  Object.assign(live, { home: 1, homeGoals: 1 }); // one goal: more in one check is PlayHQ catching up, listed as a gap
  // No request to Studio for 7 seconds: at 3 s a reading, PlayHQ is read by Studio alone.
  await wait(7000);
  assert.ok(liveCalls() > before, 'Studio asked PlayHQ for the live feed on its own');
  // The first request after the wait shows the score already on the board, and the goals already counted.
  const b = await studio.get('/api/scoreboard');
  assert.equal(b.home.score, 1);
  const goals = await studio.get('/api/goals');
  assert.ok(goals.goals.length >= 1);
});

test('the live feed is asked once per refresh period, not once per tick or per page request', async () => {
  const before = liveCalls();
  // Ten quick page requests inside one period, alongside Studio's own ticks.
  for (let i = 0; i < 10; i++) await studio.get('/api/scoreboard');
  await wait(6500);
  const made = liveCalls() - before;
  assert.ok(made >= 1 && made <= 3, `expected 1 to 3 live feed requests in 6.5 s at every 3 s (never one per request or per tick), got ${made}`);
});
