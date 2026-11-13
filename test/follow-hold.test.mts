// Back to Follow PlayHQ from a score kept by hand (board.ts holdHandScore): with the scorebench off line, the operator
// scores by hand, then presses Follow PlayHQ. While PlayHQ is behind and its feed hasn't changed, the board keeps the
// hand score (and its goals); once PlayHQ catches up, or has anything new, the board follows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, wait, type Studio, type Json } from './support/studio.mts';
import type { Live } from './support/playhq.mts';

let studio: Studio, live: Live;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  const game = studio.world.gameNow(0);
  live = studio.world.live[game.id];
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId === game.id);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
});
test.after(() => studio && studio.stop());

const board = () => studio.get('/api/scoreboard');
const act = (a: Json) => studio.post('/api/scoreboard', a);
const settle = (check: Json) => studio.until(async () => { const b = await board(); return check(b) && b; }, 10000, 250);

test('Follow PlayHQ keeps a hand score PlayHQ is behind, then follows once PlayHQ catches up', async () => {
  await settle((b: Json) => b.home.score === live.home && b.away.score === live.away);
  const start = { home: live.home, away: live.away };
  // The scorebench drops off line: PlayHQ's score stops; two goals by hand.
  await act({ type: 'score', side: 'home', delta: 1 });
  let b = await act({ type: 'score', side: 'home', delta: 1 });
  assert.equal(b.source, 'manual');
  const goalsBefore = (await studio.get('/api/goals')).totalGoals;
  await studio.get('/deck/source/playhq');
  await wait(4000); // more than one check
  b = await board();
  assert.equal(b.source, 'playhq');
  assert.equal(b.home.score, start.home + 2, 'the hand score stays while PlayHQ is behind');
  assert.equal((await studio.get('/api/goals')).totalGoals, goalsBefore, 'and so do the goals scored by hand');
  const h = await studio.get('/api/health');
  assert.equal(h.playhq.holding, true);
  // The scorebench is back and PlayHQ catches up, and one more.
  Object.assign(live, { home: start.home + 3, homeGoals: live.homeGoals + 3 });
  b = await settle((b: Json) => b.home.score === start.home + 3);
  assert.equal((await studio.get('/api/goals')).totalGoals, goalsBefore + 1, 'PlayHQ\'s next goal goes on top of the ones by hand');
  assert.equal((await studio.get('/api/health')).playhq.holding, false);
});

test('anything new from PlayHQ ends the hold, even a score below the board\'s: PlayHQ is the scorer\'s word', async () => {
  const start = { home: live.home, away: live.away };
  await act({ type: 'score', side: 'away', delta: 1 });
  await act({ type: 'score', side: 'away', delta: 1 });
  await studio.get('/deck/source/playhq');
  await wait(4000);
  assert.equal((await board()).away.score, start.away + 2);
  // The scorebench comes back with one of the two (the other was a hand mistake).
  Object.assign(live, { away: start.away + 1, awayGoals: live.awayGoals + 1 });
  const b = await settle((b: Json) => b.away.score === start.away + 1);
  assert.equal(b.source, 'playhq');
});
