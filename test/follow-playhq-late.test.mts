// A PlayHQ reading still on its way when scores are switched to Manual is dropped: it belongs to before the switch, so
// it never puts PlayHQ's score over the one being scored by hand (once, on a slow Mac, a late reading did, and a
// streamed game's story lost its "every goal seen").
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, wait, type Json } from './support/studio.mts';

test('a PlayHQ reading that lands after switching to Manual leaves the hand score alone', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const board = () => studio.get('/api/scoreboard');
  const act = (a: Json) => studio.post('/api/scoreboard', a);
  await studio.until(async () => (await board()).gameId);
  await act({ type: 'playhqRefresh', value: 3 });
  const gameId = (await board()).gameId;
  const live = studio.world.live[gameId];
  live.home = 20; live.homeGoals = 20; live.away = 15; live.awayGoals = 15;
  await studio.until(async () => (await board()).home.score === 20, 8000, 250);

  // The next reading is held back 2 seconds; while it's on its way, scoring goes to Manual and starts again from 0-0.
  studio.world.delay.live = 2000;
  live.home = 30; live.homeGoals = 30;
  // This game's readings only: the night's other games are read in the background too.
  const readings = () => studio.world.calls.filter(c => c.spectator && c.variables.id === gameId).length;
  const asked = readings();
  await studio.until(() => readings() > asked, 8000, 50);
  await act({ type: 'source', value: 'manual' });
  await act({ type: 'resetScores' });
  await act({ type: 'score', side: 'home', delta: 1 });
  await wait(2600);
  const b = await board();
  assert.equal(b.source, 'manual');
  assert.deepEqual([b.home.score, b.away.score], [1, 0], 'the late reading is dropped');
  assert.ok(!b.goals || !b.goals.some((g: Json) => g.gap), 'and leaves no gap in the goals');
});
