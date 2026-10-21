// The score worm for worm.html: the margin over game time from the goal order, with a gap
// where Studio didn't see the goals. Runs server.js and presses the scores like the control page.
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
  const worm = async () => (await fetch(`${base}/api/worm`)).json();
  return { post, goals, worm };
}

test('margins in goal order, quarter by quarter, with the biggest leads and lead changes', async t => {
  const { post, goals, worm } = await start(t);
  await post({ type: 'setTeams', home: 'Thunder', away: 'Warriors' });
  await post({ type: 'resetScores' });
  await post({ type: 'period', value: 1 });
  await goals('home', 1, 2, 1); // home +4
  await goals('away', 1);       // +3
  await post({ type: 'period', value: 2 });
  await goals('away', 1, 1, 1, 1, 1); // away +2
  await goals('home', 1);             // away +1

  const w = await worm();
  assert.equal(w.segments.length, 1);
  const line = w.segments[0];
  assert.deepEqual(line.map(p => p.margin), [0, 1, 3, 4, 3, 2, 1, 0, -1, -2, -1]);
  // The clock wasn't run, so each quarter's goals are spread evenly across it.
  assert.ok(line.slice(1, 5).every(p => p.t > 0 && p.t < 1));
  assert.ok(line.slice(5).every(p => p.t > 1 && p.t < 2));
  assert.ok(line.every((p, i) => !i || p.t >= line[i - 1].t));
  assert.deepEqual(w.gaps, []);
  assert.equal(w.biggestLead.home.margin, 4);
  assert.equal(w.biggestLead.away.margin, 2);
  assert.equal(w.leadChanges, 1);
  assert.equal(w.periods, 4);
  assert.equal(w.periodLabel, 'Q');
});

test('a score typed in is a gap, and the line carries on from the new score', async t => {
  const { post, goals, worm } = await start(t);
  await post({ type: 'setTeams', home: 'Thunder', away: 'Warriors' });
  await post({ type: 'resetScores' });
  await post({ type: 'period', value: 1 });
  await goals('home', 1);
  await post({ type: 'period', value: 3 });
  await post({ type: 'setScore', side: 'away', value: 9 });
  await goals('home', 1);

  const w = await worm();
  assert.equal(w.segments.length, 2);
  assert.deepEqual(w.segments[0].map(p => p.margin), [0, 1]);
  assert.deepEqual(w.segments[1].map(p => [p.home, p.away]), [[1, 9], [2, 9]]);
  assert.equal(w.gaps.length, 1);
  assert.ok(w.gaps[0].to >= 2 && w.gaps[0].from < 1); // from Q1's last goal to when the score was typed in Q3
});
