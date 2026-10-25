// The scoreboard (server.js): scoring by hand, the clock, quarters, the Stream Deck links, the
// ticker speed, and keeping it all over a restart. No PlayHQ game is needed for any of it, so
// Studio runs with an empty data folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');

let studio;
test.before(async () => { studio = await startStudio(null, { keepDataDir: true }); });
test.after(async () => { if (studio) { await studio.stop(); require('node:fs').rmSync(studio.dataDir, { recursive: true, force: true }); } });

const act = a => studio.post('/api/scoreboard', a);
const deck = async p => {
  const r = await studio.request('GET', `/deck/${p}`);
  assert.equal(r.status, 200, `/deck/${p} answered ${r.status}: ${r.text}`);
  return r.json;
};
const board = () => studio.get('/api/scoreboard');
const left = b => Math.round(b.clock.lengthSec - b.clockElapsedMs / 1000);

test('a fresh scoreboard: Home v Away, 0-0, first quarter, 10 minute clock stopped', async () => {
  const b = await act({ type: 'reset' });
  assert.equal(b.home.name, 'Home');
  assert.equal(b.away.name, 'Away');
  assert.deepEqual([b.home.score, b.away.score], [0, 0]);
  assert.equal(b.period, 1);
  assert.equal(b.periodLabel, 'Q');
  assert.equal(b.clock.lengthSec, 600);
  assert.equal(b.clock.running, false);
  assert.equal(b.source, 'manual');
  assert.equal(typeof b.serverNow, 'number');
});

test('scoring by hand: +1, +2, -1, -2, never below zero, set and reset', async () => {
  await act({ type: 'reset' });
  let b = await act({ type: 'score', side: 'home', delta: 1 });
  b = await act({ type: 'score', side: 'home', delta: 2 });
  b = await act({ type: 'score', side: 'away', delta: 1 });
  assert.deepEqual([b.home.score, b.away.score], [3, 1]);
  b = await act({ type: 'score', side: 'home', delta: -1 });
  assert.equal(b.home.score, 2);
  b = await act({ type: 'score', side: 'away', delta: -2 });
  assert.equal(b.away.score, 0, 'never below zero');
  b = await act({ type: 'setScore', side: 'away', value: 17 });
  assert.equal(b.away.score, 17);
  b = await act({ type: 'setTeams', home: 'Blizzardz', away: "Travis' Disciples", division: 'Division 1', court: 'Court 3' });
  assert.equal(b.home.name, 'Blizzardz');
  assert.equal(b.away.name, "Travis' Disciples");
  assert.equal(b.court, 'Court 3');
  b = await act({ type: 'resetScores' });
  assert.deepEqual([b.home.score, b.away.score], [0, 0]);
  assert.equal(b.home.name, 'Blizzardz', 'names stay');
});

test('a +2 press plays the super shot and the goals go into the goal order', async () => {
  await act({ type: 'reset' });
  let b = await act({ type: 'score', side: 'home', delta: 1 });
  const before = (b.superShot && b.superShot.n) || 0;
  b = await act({ type: 'score', side: 'away', delta: 2 });
  assert.equal(b.superShot.n, before + 1);
  assert.equal(b.superShot.side, 'away');
  b = await act({ type: 'superShot', side: 'home' });
  assert.equal(b.superShot.n, before + 2, 'the test button plays it too');
  assert.equal(b.away.score, 2, 'without changing the score');
  const goals = await studio.get('/api/goals');
  assert.deepEqual(goals.goals.map(g => [g.side, g.points]), [['home', 1], ['away', 2]]);
  assert.deepEqual(goals.tally.away, { goals: 1, points: 2 });
  assert.equal(goals.run.side, 'away');
});

test('quarters: next and prev, extra time after the fourth, and back', async () => {
  await act({ type: 'reset' });
  let b;
  for (const want of [2, 3, 4, 5]) { b = await act({ type: 'period', value: 'next' }); assert.equal(b.period, want); }
  b = await act({ type: 'period', value: 'next' });
  assert.equal(b.period, 5, 'no quarter after extra time');
  b = await act({ type: 'period', value: 'prev' });
  assert.equal(b.period, 4, 'back from extra time to the fourth');
  b = await act({ type: 'period', value: 1 });
  b = await act({ type: 'period', value: 'prev' });
  assert.equal(b.period, 1);
  b = await act({ type: 'periodLabel', value: 'QUARTER' });
  assert.equal(b.clock.lengthSec, 600);
});

test('the clock: start, stop, set, adjust, length, reset and toggle', async () => {
  await act({ type: 'reset' });
  let b = await act({ type: 'clockStart' });
  assert.equal(b.clock.running, true);
  await wait(1100);
  b = await act({ type: 'clockStop' });
  assert.equal(b.clock.running, false);
  assert.ok(b.clockElapsedMs >= 1000 && b.clockElapsedMs < 3000, `ran ${b.clockElapsedMs}ms`);
  const stopped = b.clockElapsedMs;
  await wait(300);
  assert.equal((await board()).clockElapsedMs, stopped, 'a stopped clock stays put');

  b = await act({ type: 'clockSet', secondsLeft: 125 });
  assert.equal(left(b), 125);
  b = await act({ type: 'clockAdjust', deltaSec: 10 });
  assert.equal(left(b), 135);
  b = await act({ type: 'clockAdjust', deltaSec: -200 });
  assert.equal(left(b), 0, 'never below zero');
  b = await act({ type: 'clockSet', secondsLeft: 900 });
  assert.equal(b.clock.lengthSec, 900, 'a longer time stretches the period (extra time)');
  b = await act({ type: 'clockLength', value: 12 * 60 });
  assert.equal(b.clock.lengthSec, 720);
  b = await act({ type: 'clockReset' });
  assert.equal(left(b), 720);
  assert.equal(b.clock.running, false);
  b = await act({ type: 'clockToggle' });
  assert.equal(b.clock.running, true);
  b = await act({ type: 'clockToggle' });
  assert.equal(b.clock.running, false);
  b = await act({ type: 'clockLength', value: 10 });
  assert.equal(b.clock.lengthSec, 60, 'at least a minute');
  await act({ type: 'clockLength', value: 600 });
});

test('Stream Deck links score, run the clock and change the quarter', async () => {
  await act({ type: 'reset' });
  let r = await deck('home/add2');
  assert.deepEqual([r.home, r.away], [2, 0]);
  r = await deck('away/add1');
  r = await deck('away/plus2');
  r = await deck('home/minus1');
  assert.deepEqual([r.home, r.away], [1, 3]);
  assert.equal(r.source, 'manual');
  r = await deck('clock/start');
  assert.equal(r.clockRunning, true);
  r = await deck('clock/toggle');
  assert.equal(r.clockRunning, false);
  await deck('clock/set/5:30');
  assert.equal(left(await board()), 330);
  await deck('clock/adjust/-1m');
  assert.equal(left(await board()), 270);
  await deck('clock/adjust/15');
  assert.equal(left(await board()), 285);
  await deck('clock/adjust?minutes=1&seconds=-30');
  assert.equal(left(await board()), 315);
  await deck('clock/length/12');
  assert.equal((await board()).clock.lengthSec, 720);
  await deck('clock/reset');
  assert.equal(left(await board()), 720);
  await deck('quarter/next');
  await deck('quarter/next');
  assert.equal((await board()).period, 3);
  await deck('quarter/5');
  assert.equal((await board()).period, 5);
  await deck('period/prev');
  assert.equal((await board()).period, 4);
  r = await deck('scores/reset');
  assert.deepEqual([r.home, r.away], [0, 0]);
  const before = (await board()).superShot?.n || 0;
  await deck('away/supershot');
  assert.equal((await board()).superShot.n, before + 1);
  await deck('streak/fire/home');
  assert.equal((await board()).streak.kind, 'fire');
  await act({ type: 'clockLength', value: 600 });
});

test('Stream Deck: unknown links answer 404 and change nothing', async () => {
  await act({ type: 'reset' });
  for (const p of ['home/add9x', 'clock/set/soon', 'quarter/7', 'nothing', 'source/maybe']) {
    const r = await studio.request('GET', `/deck/${p}`);
    assert.equal(r.status, 404, p);
    assert.match(r.json.error, /Unknown Stream Deck link/);
  }
  const b = await board();
  assert.deepEqual([b.home.score, b.away.score, b.period], [0, 0, 1]);
});

test('ticker speed: faster, slower, normal, a number, within 20 to 600, and kept by a reset', async () => {
  await deck('ticker/normal');
  await deck('ticker/faster');
  assert.equal((await studio.get('/api/ticker/speed')).speed, 140);
  await deck('ticker/slower');
  await deck('ticker/slower');
  assert.equal((await studio.get('/api/ticker/speed')).speed, 100);
  await deck('ticker/speed/9999');
  assert.equal((await studio.get('/api/ticker/speed')).speed, 600);
  await act({ type: 'tickerSpeed', value: 1 });
  assert.equal((await studio.get('/api/ticker/speed')).speed, 20);
  await act({ type: 'tickerSpeed', value: 150 });
  await act({ type: 'reset' });
  assert.equal((await studio.get('/api/ticker/speed')).speed, 150, 'a reset keeps the ticker speed');
  await deck('ticker/normal');
});

test('settings with limits: PlayHQ checks every 3 to 120 seconds, the clock shown or hidden', async () => {
  assert.equal((await act({ type: 'playhqRefresh', value: 1 })).playhqRefreshSec, 1);
  assert.equal((await act({ type: 'playhqRefresh', value: -4 })).playhqRefreshSec, 1);
  assert.equal((await act({ type: 'playhqRefresh', value: 500 })).playhqRefreshSec, 120);
  assert.equal((await act({ type: 'playhqRefresh', value: 5 })).playhqRefreshSec, 5);
  assert.equal((await act({ type: 'showClock', value: false })).showClock, false);
  assert.equal((await act({ type: 'showClock', value: true })).showClock, true);
});

test('following PlayHQ needs a game: with none picked, scores stay manual', async () => {
  await act({ type: 'reset' });
  let b = await act({ type: 'source', value: 'playhq' });
  assert.equal(b.source, 'manual');
  b = await act({ type: 'source', value: 'toggle' });
  assert.equal(b.source, 'manual');
  const teams = await studio.get('/api/teams');
  assert.match(teams.error, /No PlayHQ game picked/);
  const countdown = await studio.get('/api/countdown');
  assert.match(countdown.error, /No game picked/);
});

test('the score, clock and lasting settings are kept over a restart', async () => {
  await act({ type: 'reset' });
  await act({ type: 'setTeams', home: 'Knights', away: 'Mavericks' });
  await act({ type: 'setScore', side: 'home', value: 12 });
  await act({ type: 'setScore', side: 'away', value: 9 });
  await act({ type: 'period', value: 3 });
  await act({ type: 'clockSet', secondsLeft: 200 });
  await act({ type: 'tickerSpeed', value: 220 });
  await act({ type: 'playhqRefresh', value: 8 });
  await wait(300); // scoreboard-state.json is written in the background
  await studio.stop();
  studio = await startStudio(null, { dataDir: studio.dataDir, keepDataDir: true });
  const b = await board();
  assert.equal(b.home.name, 'Knights');
  assert.deepEqual([b.home.score, b.away.score], [12, 9]);
  assert.equal(b.period, 3);
  assert.equal(left(b), 200);
  assert.equal(b.tickerSpeed, 220);
  assert.equal(b.playhqRefreshSec, 8);
});
