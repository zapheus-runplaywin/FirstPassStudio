// Game stats for gamestats.html: points by quarter from the score on the board, quarters won,
// best quarter, super shots and goal runs. Runs server.js and presses the scores like the control page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runServer } = require('./support/studio');

async function start(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  const server = await runServer({ FIRSTPASS_DATA_DIR: dataDir, PLAYHQ_API_URL: 'http://127.0.0.1:1/graphql', PLAYHQ_SPECTATOR_URL: 'http://127.0.0.1:1/spectator' });
  t.after(async () => { server.child.kill(); await server.exit; fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.port}`;
  const post = async body => (await fetch(`${base}/api/scoreboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const goals = async (side, ...deltas) => { for (const delta of deltas) await post({ type: 'score', side, delta }); };
  const stats = async () => (await fetch(`${base}/api/stats`)).json();
  return { post, goals, stats };
}

test('quarters, best quarter, super shots and runs from score presses', async t => {
  const { post, goals, stats } = await start(t);
  await post({ type: 'setTeams', home: 'Thunder', away: 'Warriors' });
  await post({ type: 'resetScores' });
  await post({ type: 'period', value: 1 });

  // Q1: home 5 in a row (one a super shot, 6 points), then away 2: home wins it 6-2.
  await goals('home', 1, 1, 2, 1, 1);
  await goals('away', 1, 1);
  await post({ type: 'period', value: 'next' });
  // Q2: away 3 in a row, home 1: away wins 3-1.
  await goals('away', 1, 1, 1);
  await goals('home', 1);
  await post({ type: 'period', value: 'next' });
  // Q3: level 2-2 (a correction on the way doesn't count twice).
  await goals('home', 1);
  await goals('away', 1);
  await goals('home', 1, -1, 1);
  await goals('away', 1);
  await post({ type: 'period', value: 'next' });
  // Q4: home 4 (two super shots), away 1.
  await goals('home', 2);
  await goals('away', 1);
  await goals('home', 2);

  const s = await stats();
  assert.deepEqual(s.quarters.map(q => [q.label, q.home, q.away, q.sure]),
    [['Q1', 6, 2, true], ['Q2', 1, 3, true], ['Q3', 2, 2, true], ['Q4', 4, 1, true]]);
  assert.deepEqual([s.home.score, s.away.score], [13, 8]);
  assert.deepEqual(s.stats.quartersWon, { home: 2, away: 1, drawn: 1, of: 4 });
  assert.deepEqual(s.stats.bestQuarter.home, { n: 1, label: 'Q1', points: 6 });
  assert.equal(s.stats.bestQuarter.away.points, 3);
  assert.deepEqual(s.stats.superShots, { home: 3, away: 0 });
  // Home ran 5 (Q1); away ran 2+3 = 5 across the break (Q1 end into Q2).
  assert.deepEqual(s.stats.longestRun, { home: 5, away: 5 });
  assert.deepEqual(s.stats.runs3, { home: 1, away: 1 });
  assert.deepEqual(s.stats.runs5, { home: 1, away: 1 });
});

test('a score typed in mid quarter makes that quarter unsure', async t => {
  const { post, goals, stats } = await start(t);
  await post({ type: 'setTeams', home: 'Thunder', away: 'Warriors' });
  await post({ type: 'resetScores' });
  await post({ type: 'period', value: 1 });
  await goals('home', 1);
  await post({ type: 'period', value: 2 });
  await post({ type: 'setScore', side: 'home', value: 12 });
  await goals('away', 1);
  const s = await stats();
  assert.deepEqual(s.quarters.slice(0, 2).map(q => [q.home, q.away, q.sure]), [[1, 0, true], [11, 1, false]]);
  assert.deepEqual(s.stats.quartersWon, { home: 1, away: 0, drawn: 0, of: 1 }); // only Q1 counts
  await post({ type: 'resetScores' });
  assert.deepEqual((await stats()).quarters.map(q => q.home), [null, 0, null, null]); // starts again from the quarter that is on
});

test('following PlayHQ, a goal in the same reading as the next quarter starting stays in the last quarter', async t => {
  const { startStudio } = require('./support/studio');
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const game = studio.world.gameNow(0);
  const live = studio.world.live[game.id];
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
  const settle = check => studio.until(async () => { const s = await studio.get('/api/stats'); return check(s) && s; }, 8000, 250);

  Object.assign(live, { home: 1, homeGoals: 1 });
  await settle(s => s.home.score === 1);
  Object.assign(live, { home: 2, homeGoals: 2, period: 'SECOND_QTR' });
  await settle(s => s.period === 2);
  Object.assign(live, { away: 1, awayGoals: 1 });
  const s = await settle(s => s.away.score === 1);
  assert.deepEqual(s.quarters.slice(0, 2).map(q => [q.home, q.away, q.sure]), [[2, 0, true], [0, 1, true]]);
  assert.deepEqual(s.stats.quartersWon, { home: 1, away: 1, drawn: 0, of: 2 });
});

test('points put on extra time when the game wasn\'t level go on the last quarter', async t => {
  const { post, goals, stats } = await start(t);
  await post({ type: 'setTeams', home: 'Thunder', away: 'Warriors' });
  await post({ type: 'resetScores' });
  await post({ type: 'period', value: 4 });
  await goals('home', 1, 1);
  await post({ type: 'period', value: 'next' }); // pressed at the siren
  await goals('away', 1); // the shot after the siren
  const s = await stats();
  assert.deepEqual(s.quarters.map(q => q.label), ['Q1', 'Q2', 'Q3', 'Q4']);
  assert.deepEqual([s.quarters[3].home, s.quarters[3].away], [2, 1]);
});
