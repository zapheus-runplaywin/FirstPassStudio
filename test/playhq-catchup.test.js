// PlayHQ catching up (board.ts catchUpIn): a scorebench back on line sends minutes of scoring at once. More than one
// goal or super shot for a team in one 5 s check can't happen live, so it's noted as a gap for both teams: no goals
// listed in made-up order, and no super shot or moment played for scoring that happened minutes ago. One super shot
// in a check is still a super shot.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');

let studio, live;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  const game = studio.world.gameNow(0);
  live = studio.world.live[game.id];
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId === game.id);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
});
test.after(() => studio && studio.stop());

const board = () => studio.get('/api/scoreboard');
const settle = check => studio.until(async () => { const b = await board(); return check(b) && b; }, 10000, 250);

test('a goal and a super shot in one check is PlayHQ catching up: a gap, no goals listed, no super shot played', async () => {
  await settle(b => b.home.score === live.home);
  await wait(3500); // the board has read the feed as it is
  const before = await board();
  const goals = (await studio.get('/api/goals')).totalGoals;
  Object.assign(live, { home: live.home + 3, homeGoals: live.homeGoals + 1, homeSuper: live.homeSuper + 1 });
  const b = await settle(b => b.home.score === live.home);
  assert.equal(b.superShot?.n || 0, before.superShot?.n || 0, 'no super shot played');
  assert.equal(b.streak?.n || 0, before.streak?.n || 0, 'no moment played');
  const g = await studio.get('/api/goals');
  assert.equal(g.totalGoals, goals, 'no goals listed');
  assert.equal(g.gapInHistory, true);
});

test('one super shot in a check is still a super shot, and goals one at a time are still listed', async () => {
  const before = (await board()).superShot?.n || 0;
  const goals = (await studio.get('/api/goals')).totalGoals;
  Object.assign(live, { away: live.away + 2, awaySuper: live.awaySuper + 1 });
  await settle(b => (b.superShot?.n || 0) > before);
  Object.assign(live, { away: live.away + 1, awayGoals: live.awayGoals + 1 });
  await settle(b => b.away.score === live.away);
  assert.equal((await studio.get('/api/goals')).totalGoals, goals + 2);
});

test('a catch-up while PlayHQ is still on the quarter keeps that quarter sure on the game stats; one that comes with the next quarter doesn\'t', async () => {
  const q = (await board()).period;
  const before = (await studio.get('/api/stats')).quarters.find(x => x.n === q);
  assert.equal(before.sure, true);
  Object.assign(live, { home: live.home + 5, homeGoals: live.homeGoals + 5 }); // still this quarter in PlayHQ
  await settle(b => b.home.score === live.home);
  let s = await studio.get('/api/stats');
  const now = s.quarters.find(x => x.n === q);
  assert.equal(now.home, before.home + 5);
  assert.equal(now.sure, true, 'all five were this quarter\'s: PlayHQ was still on it');
  // A catch-up that arrives with PlayHQ already in the next quarter may hold some of its goals: not sure.
  Object.assign(live, { away: live.away + 5, awayGoals: live.awayGoals + 5, period: 'THIRD_QTR' });
  await settle(b => b.away.score === live.away);
  s = await studio.get('/api/stats');
  assert.equal(s.quarters.find(x => x.n === q).sure, false);
});
