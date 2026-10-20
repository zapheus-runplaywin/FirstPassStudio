// Hot streaks for streak.html: 3 in a row is heating up, 5 is on fire, 10 one each way is goal
// for goal, each played once per run. Runs server.js and presses the scores like the control page.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function listen(server) { return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); }

test('hot streaks from score presses', async t => {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise(r => probe.close(r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), FIRSTPASS_DATA_DIR: dataDir, PLAYHQ_API_URL: 'http://127.0.0.1:1/graphql', PLAYHQ_SPECTATOR_URL: 'http://127.0.0.1:1/spectator' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => { if (/is running/.test(d)) resolve(); });
    server.on('exit', code => reject(new Error(`server.js exited (${code})`)));
  });

  const base = `http://127.0.0.1:${port}`;
  const post = async body => (await fetch(`${base}/api/scoreboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const goal = (side, delta = 1) => post({ type: 'score', side, delta });
  const streak = async () => ((await (await fetch(`${base}/api/scoreboard`)).json()).streak) || { n: 0 };

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
