// A Studio Mac turned on part way through a game another Studio Mac is following (board.ts fillFromPeers, stories.ts
// liveFrom): it picks the game up at the score then, with a gap, asks the other Mac for its story of the game so far,
// fills the gap with its goals there and then, and carries on following the game by itself. Against the stand-in
// PlayHQ (test/support/playhq.mts), both Studios reading the same game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio } from './support/studio.mts';
import { createWorld } from './support/playhq.mts';

test('a Mac that picks a game up part way fills the start of it from the other Mac\'s story, and carries on', { timeout: 120000 }, async t => {
  const world = createWorld();
  const court1 = await startStudio(t, { competition: 'Thunder League', world });
  const game = world.gameNow(0);
  const live = world.live[game.id];
  await court1.until(async () => (await court1.get('/api/scoreboard')).gameId === game.id);
  await court1.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
  // Court 1 sees the first five goals one by one.
  for (let n = 1; n <= 5; n++) {
    Object.assign(live, { home: n, homeGoals: n });
    await court1.until(async () => (await court1.get('/api/scoreboard')).home.score === n, 15000, 250);
  }
  // Court 2's Mac is turned on now: 5-0 is too big a jump to list, so it starts with a gap, then fills it.
  const court2 = await startStudio(t, { competition: 'Thunder League', world, env: { FIRSTPASS_OTHER_STUDIOS: court1.base } });
  await court2.until(async () => (await court2.get('/api/scoreboard')).gameId === game.id);
  await court2.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
  await court2.until(async () => (await court2.get('/api/scoreboard')).home.score === 5, 15000, 250);
  const goals = await court2.until(async () => { const g = await court2.get('/api/goals'); return !g.gapInHistory && g; }, 60000, 500);
  assert.equal(goals.totalGoals, 5, 'the goals court 1 saw');
  // And it carries on by itself.
  Object.assign(live, { away: 1, awayGoals: 1 });
  await court2.until(async () => (await court2.get('/api/goals')).totalGoals === 6, 15000, 250);
  const stats = await court2.get('/api/stats');
  assert.equal(stats.stats.longestRun.home, 5);
  assert.equal(stats.gapInHistory, false);
  const b = await court2.get('/api/scoreboard');
  assert.equal(b.streak?.n || 0, 0, 'the heating up and on fire it filled in aren\'t played on air');
});
