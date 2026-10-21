// Hot streaks for streak.html: 3 in a row is heating up, 5 is on fire, 10 one each way is goal
// for goal, each played once per run. Runs server.js and presses the scores like the control page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runServer } = require('./support/studio');


async function start(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  const server = await runServer({ FIRSTPASS_DATA_DIR: dataDir, PLAYHQ_API_URL: 'http://127.0.0.1:1/graphql', PLAYHQ_SPECTATOR_URL: 'http://127.0.0.1:1/spectator' });
  const { port } = server;
  t.after(async () => { server.child.kill(); await server.exit; fs.rmSync(dataDir, { recursive: true, force: true }); });

  const base = `http://127.0.0.1:${port}`;
  const post = async body => (await fetch(`${base}/api/scoreboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const goal = (side, delta = 1) => post({ type: 'score', side, delta });
  const streak = async () => ((await (await fetch(`${base}/api/scoreboard`)).json()).streak) || { n: 0 };
  return { base, post, goal, streak };
}

test('hot streaks from score presses', async t => {
  const { base, post, goal, streak } = await start(t);

  await post({ type: 'setTeams', home: 'Thunder', away: 'Warriors' });
  await post({ type: 'resetScores' });

  // Two in a row is nothing; the third (a super shot is one goal) is heating up.
  await goal('home'); await goal('home');
  assert.equal((await streak()).n, 0);
  await goal('home', 2);
  let s = await streak();
  assert.deepEqual([s.n, s.kind, s.side, s.goals], [1, 'heating', 'home', 3]);

  // The fourth plays nothing; the fifth is on fire; the sixth plays nothing more.
  await goal('home');
  assert.equal((await streak()).n, 1);
  await goal('home');
  s = await streak();
  assert.deepEqual([s.n, s.kind, s.side], [2, 'fire', 'home']);
  await goal('home');
  assert.equal((await streak()).n, 2);

  // A correction and the goal again doesn't replay the run.
  await goal('home', -1); await goal('home');
  assert.equal((await streak()).n, 2);

  // A new run by the other team starts from scratch.
  await goal('away'); await goal('away'); await goal('away');
  s = await streak();
  assert.deepEqual([s.n, s.kind, s.side], [3, 'heating', 'away']);

  // Ten goals one each way is goal for goal (the last away goal above starts the stretch), once.
  for (let i = 0; i < 5; i++) { await goal('home'); if (i < 4) await goal('away'); }
  s = await streak();
  assert.deepEqual([s.n, s.kind, s.side, s.goals, s.from], [4, 'goalForGoal', '', 10, 'away']);
  await goal('away'); await goal('home');
  assert.equal((await streak()).n, 4);

  // A new game starts the runs again.
  await post({ type: 'resetScores' });
  await goal('home'); await goal('home');
  assert.equal((await streak()).n, 4);

  // The Stream Deck test links play one without changing the score.
  const before = await (await fetch(`${base}/api/scoreboard`)).json();
  await fetch(`${base}/deck/streak/fire/away`);
  s = await streak();
  assert.deepEqual([s.n, s.kind, s.side, s.how], [5, 'fire', 'away', 'test']);
  await fetch(`${base}/deck/streak/goalforgoal`);
  s = await streak();
  assert.deepEqual([s.n, s.kind, s.side], [6, 'goalForGoal', '']);
  const after = await (await fetch(`${base}/api/scoreboard`)).json();
  assert.deepEqual([after.home.score, after.away.score], [before.home.score, before.away.score]);
});

test('game moments: lead, all square, comeback, siren, back to back', async t => {
  const { post, goal, streak } = await start(t);
  await post({ type: 'setTeams', home: 'Thunder', away: 'Warriors' });
  await post({ type: 'resetScores' });
  const kind = async () => { const s = await streak(); return [s.n, s.kind, s.side]; };

  // The first team ahead isn't "hits the front"; the other team going ahead is.
  await goal('home');
  assert.deepEqual(await kind(), [0, undefined, undefined]);
  await goal('away');
  await goal('away');
  assert.deepEqual(await kind(), [1, 'lead', 'away']);

  // Level isn't all square until the last 2 minutes of the quarter.
  await goal('home');
  assert.equal((await streak()).n, 1);
  await post({ type: 'clockSet', secondsLeft: 90 });
  await goal('home'); // 3-2, home back in front
  assert.deepEqual(await kind(), [2, 'lead', 'home']);
  await goal('away'); // 3-3 late
  let s = await streak();
  assert.deepEqual([s.n, s.kind, s.score], [3, 'level', { home: 3, away: 3 }]);

  // Comeback: away goes 6 down (and on fire on the way), then gets within 2.
  await post({ type: 'clockSet', secondsLeft: 500 });
  for (let i = 0; i < 6; i++) await goal('home'); // 9-3
  assert.deepEqual(await kind(), [5, 'fire', 'home']); // heating up at 3 in a row, then on fire at 5
  for (let i = 0; i < 3; i++) await goal('away'); // 9-6: heating up for away
  assert.deepEqual(await kind(), [6, 'heating', 'away']);
  await goal('away'); // 9-7: within 2
  s = await streak();
  assert.deepEqual([s.n, s.kind, s.side, s.down], [7, 'comeback', 'away', 6]);
  await goal('away'); // 9-8: no comeback again; on fire for away
  assert.deepEqual(await kind(), [8, 'fire', 'away']);

  // On the siren: a goal with 10 seconds or less left while the clock is running.
  await post({ type: 'clockSet', secondsLeft: 8 });
  await post({ type: 'clockStart' });
  await goal('home'); // 10-8
  s = await streak();
  assert.deepEqual([s.n, s.kind, s.side], [9, 'siren', 'home']);
  await post({ type: 'clockStop' });
  await post({ type: 'clockSet', secondsLeft: 300 });

  // Back to back super shots (also 3 in a row here: one moment per goal, back to back wins).
  await goal('home', 2);
  assert.equal((await streak()).n, 9);
  await goal('home', 2);
  assert.deepEqual(await kind(), [10, 'backToBack', 'home']);

  // The page gets the last few in a log, so two close together both play.
  const log = (await post({ type: 'showClock', value: true })).streakLog;
  assert.deepEqual(log.slice(-2).map(e => e.kind), ['siren', 'backToBack']);
});
