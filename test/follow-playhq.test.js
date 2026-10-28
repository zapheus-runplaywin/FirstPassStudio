// Following PlayHQ (server.js): Studio starts with today's game on its court, the score and the
// scorer's clock and quarter follow PlayHQ's live feed, a press by hand takes over, and PlayHQ
// isn't asked about a game before its electronic scoring starts. Against the stand-in PlayHQ
// (test/support/playhq.js), whose world.live is the scorer's tablet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');

let studio, live, game;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  game = studio.world.gameNow(0);
  live = studio.world.live[game.id];
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 }); // the quickest it reads PlayHQ
});
test.after(() => studio && studio.stop());

const board = () => studio.get('/api/scoreboard');
const act = a => studio.post('/api/scoreboard', a);
const left = b => Math.round(b.clock.lengthSec - b.clockElapsedMs / 1000);
// Waits until the board shows what PlayHQ now says (it reads PlayHQ every 3 seconds at most).
const settle = check => studio.until(async () => { const b = await board(); return check(b) && b; }, 8000, 250);

test('Studio starts with today\'s game on the default court, following PlayHQ and its clock', async () => {
  const b = await board();
  assert.equal(b.gameId, game.id);
  assert.equal(b.court, 'Court 1');
  assert.equal(b.home.name, game.home);
  assert.equal(b.source, 'playhq');
  assert.equal(b.followPlayhqClock, true);
  assert.equal(b.autoSelect, true);
  assert.match(b.autoNote, /^Next: Stormz v Semi Pro/);
});

test('the score follows the live feed, goal by goal, into the goal order', async () => {
  Object.assign(live, { home: 1, homeGoals: 1 });
  await settle(b => b.home.score === 1);
  Object.assign(live, { away: 1, awayGoals: 1 });
  await settle(b => b.away.score === 1);
  Object.assign(live, { home: 2, homeGoals: 2 });
  const b = await settle(b => b.home.score === 2);
  assert.equal(b.source, 'playhq');
  const goals = await studio.get('/api/goals');
  assert.deepEqual(goals.goals.filter(g => !g.gap).map(g => g.side).slice(-3), ['home', 'away', 'home']);
});

test('shooting % on the game stats comes from the feed\'s goal attempts', async () => {
  Object.assign(live, { home: live.home + 1, homeGoals: live.homeGoals + 1 });
  const made = live.homeGoals + live.homeSuper;
  live.homeShots = made + 2; // two missed
  await settle(b => b.home.score === live.home);
  const s = await studio.get('/api/stats');
  assert.deepEqual(s.stats.shooting.home, { made, shots: made + 2, percent: Math.round((made / (made + 2)) * 100) });
  delete live.homeShots;
});

test('a super shot in the feed (super goals up one, score up two) plays the super shot', async () => {
  const before = (await board()).superShot?.n || 0;
  Object.assign(live, { away: live.away + 2, awaySuper: live.awaySuper + 1 });
  const b = await settle(b => (b.superShot?.n || 0) > before);
  assert.equal(b.superShot.side, 'away');
  assert.equal(b.superShot.how, 'playhq');
  // Two normal goals between readings are not a super shot.
  Object.assign(live, { home: live.home + 2, homeGoals: live.homeGoals + 2 });
  await settle(b => b.home.score === live.home);
  assert.equal((await board()).superShot.n, before + 1);
});

test('the clock follows the scorer: stopped, then running, then the next quarter', async () => {
  live.clock = { status: 'PAUSE', time: '04:00', lastUpdatedAt: String(Date.now()) };
  let b = await settle(b => !b.clock.running && left(b) === 240);
  assert.equal(b.playhqClock.time, '04:00');
  live.clock = { status: 'RESUME', time: '03:30', lastUpdatedAt: String(Date.now()) };
  b = await settle(b => b.clock.running);
  assert.ok(left(b) <= 210 && left(b) >= 200, `about 3:30 left, got ${left(b)}`);
  live.period = 'SECOND_QTR';
  live.clock = { status: 'PAUSE', time: '10:00', lastUpdatedAt: String(Date.now()) };
  b = await settle(b => b.period === 2);
  assert.equal(left(b), 600);
});

test('a score press takes over by hand and stops following the clock; Follow PlayHQ brings both back', async () => {
  let b = await act({ type: 'score', side: 'home', delta: 1 });
  assert.equal(b.source, 'manual');
  assert.equal(b.followPlayhqClock, false);
  const mine = b.home.score;
  live.home += 3; live.homeGoals += 3;
  await wait(3500);
  b = await board();
  assert.equal(b.home.score, mine, 'PlayHQ no longer moves a manual score');
  b = await studio.get('/deck/source/playhq');
  b = await settle(b => b.home.score === live.home);
  assert.equal(b.source, 'playhq');
  assert.equal(b.followPlayhqClock, true);
});

test('a clock button stops following the PlayHQ clock but leaves the score following', async () => {
  let b = await act({ type: 'clockStart' });
  assert.equal(b.followPlayhqClock, false);
  assert.equal(b.source, 'playhq');
  b = await studio.get('/deck/clock/playhq/on');
  assert.equal((await board()).followPlayhqClock, true);
  await studio.get('/deck/clock/playhq/toggle');
  assert.equal((await board()).followPlayhqClock, false);
  await studio.get('/deck/clock/playhq/on');
});

test('PlayHQ isn\'t asked about a game before its electronic scoring starts', async () => {
  const later = studio.world.divisions[1].rounds[2].games[0]; // starts in 90 minutes, scoring opens 10 before
  const asked = () => studio.calls().filter(c => c.spectator && c.variables.id === later.id).length;
  await act({ type: 'selectGame', game: { id: later.id, roundId: later.roundId, division: later.division, court: later.court,
    date: later.date, time: later.time, home: { name: later.home }, away: { name: later.away } } });
  let b = await board();
  assert.equal(b.autoSelect, false, 'picking a game by hand turns automatic selection off');
  assert.equal(b.source, 'playhq');
  await wait(3500);
  b = await board();
  await studio.get('/api/teams');
  await studio.get('/api/goals');
  assert.equal(asked(), 0);
  assert.match(b.playhqWaiting, /Electronic scoring starts 10 minutes before the game/);
  assert.equal((await studio.get('/api/teams')).scoring, 'not-started');
});

test('turning automatic selection back on returns to the game being played on the court', async () => {
  await act({ type: 'autoSelect', value: true });
  const b = await board();
  assert.equal(b.gameId, game.id);
  assert.equal(b.autoSelect, true);
});

test('choosing a court follows that court\'s games', async () => {
  const other = studio.world.games['game-d1-r3-2'];
  const r = await studio.get('/deck/court/2');
  assert.equal(r.ok, true);
  const b = await board();
  assert.equal(b.autoCourt, '2');
  assert.equal(b.gameId, other.id);
  assert.equal(b.court, 'Court 2');
  await studio.get('/deck/court/1');
  assert.equal((await board()).gameId, game.id);
});

test('with a round picked by hand, the court\'s games are followed on their own date and time, not as if today', async () => {
  const later = studio.world.divisions[0].rounds[3].games[0]; // next week, Court 1
  const played = studio.world.divisions[0].rounds[0].games[0]; // two weeks ago, Court 1
  try {
    await studio.post('/api/rounds', { round: '4' });
    let b = await board();
    assert.equal(b.autoSelect, true);
    assert.equal(b.round, 'Round 4');
    assert.equal(b.court, 'Court 1');
    assert.equal(b.date, later.date, 'next week\'s game keeps next week\'s date');
    assert.notEqual(b.date, studio.world.today);
    // Its countdown and the sequences' "before the game" start go by that date too.
    assert.equal((await studio.get('/api/countdown')).date, later.date);
    assert.match(b.autoNote, /switches at .+ \w{3}, \d+ \w{3}\.$/, 'the next game\'s day is named when it isn\'t today');
    await studio.post('/api/rounds', { round: '1' });
    b = await board();
    assert.equal(b.round, 'Round 1');
    assert.equal(b.date, played.date);
    assert.match(b.autoNote, /^Last game on this court this round\.$/);
  } finally {
    await studio.post('/api/rounds', { round: '' });
  }
  assert.equal((await board()).gameId, game.id, 'back to automatic: today\'s game on the court');
});

test('when the live feed fails the board keeps its score and says why', async () => {
  const score = (await board()).home.score;
  studio.world.fail.live = 503;
  studio.world.fail.discoverGame = 503;
  studio.world.fail.discoverFixtureByRound = 503;
  try {
    await wait(3500);
    const b = await board();
    assert.equal(b.home.score, score);
    assert.match(b.playhqError || '', /HTTP 503/);
  } finally { studio.world.fail = {}; }
  await settle(b => !b.playhqError);
});
