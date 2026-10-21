// /api/teams says whether PlayHQ is scoring the game (scoring: 'not-started', 'live' or
// 'finished'), and the line ups appear once it is. Runs server.js against a stand-in PlayHQ.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runServer } = require('./support/studio');

const GAME = 'game-1';
const state = { status: 'UPCOMING', scoring: false, lineups: false };

const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
const players = prefix => POSITIONS.map((pos, i) => ({
  playerNumber: String(i + 1),
  player: { __typename: 'DiscoverParticipant', id: `${prefix}${i}`, profile: { firstName: prefix, lastName: pos } },
  statistics: [], playerPosition: { shortName: pos }, captain: null,
}));

// PlayHQ's game page: no statistics at all until the game is being scored.
function discoverGame() {
  return {
    id: GAME, date: '2026-10-20', status: { value: state.status },
    home: { __typename: 'DiscoverTeam', id: 'h', name: 'Thunder' },
    away: { __typename: 'DiscoverTeam', id: 'a', name: 'Warriors' },
    result: null,
    statistics: state.lineups ? { home: { players: players('Home'), statistics: [] }, away: { players: players('Away'), statistics: [] } } : null,
  };
}
// The live feed: "not electronically scored" until the scorer starts.
function liveGame() {
  if (!state.scoring) return { errors: [{ message: 'The game could not be found or was not electronically scored' }] };
  const side = { statisticsV2: [{ type: { value: 'TOTAL_SCORE' }, count: 0 }] };
  return { data: { game: { id: GAME, status: 'IN_PROGRESS', updatedAt: null, break: null, statistics: { home: side, away: side },
    result: { home: { statistics: [] }, away: { statistics: [] }, currentPeriod: { value: 'FIRST_QTR' } }, clock: null } } };
}

function listen(server) { return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); }
const wait = ms => new Promise(r => setTimeout(r, ms));

test('position match ups: scoring state and line ups through a game', async t => {
  const playhq = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const { operationName } = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/spectator')) return res.end(JSON.stringify(liveGame()));
      if (operationName === 'discoverGame') return res.end(JSON.stringify({ data: { discoverGame: discoverGame() } }));
      res.end(JSON.stringify({ data: {} }));
    });
  });
  const playhqPort = await listen(playhq);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  const server = await runServer({ FIRSTPASS_DATA_DIR: dataDir,
    PLAYHQ_API_URL: `http://127.0.0.1:${playhqPort}/graphql`, PLAYHQ_SPECTATOR_URL: `http://127.0.0.1:${playhqPort}/spectator` });
  const { port } = server;
  t.after(async () => { server.child.kill(); await server.exit; playhq.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const base = `http://127.0.0.1:${port}`;
  const teams = async () => (await fetch(`${base}/api/teams`)).json();
  const post = body => fetch(`${base}/api/scoreboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  let d = await teams();
  assert.match(d.error, /No PlayHQ game picked/);

  await post({ type: 'playhqRefresh', value: 3 });
  await post({ type: 'selectGame', game: { id: GAME, roundId: 'r1', home: { name: 'Thunder' }, away: { name: 'Warriors' } } });

  // Before live scoring: no line ups, and the page is told scoring hasn't started.
  d = await teams();
  assert.equal(d.scoring, 'not-started');
  assert.equal(d.home.players.filter(p => !p.fromSquad).length, 0);
  assert.equal(d.away.players.filter(p => !p.fromSquad).length, 0);

  // Live scoring starts with the line ups entered: they come through on the next reading.
  Object.assign(state, { status: 'IN_PROGRESS', scoring: true, lineups: true });
  await wait(3200);
  d = await teams();
  assert.equal(d.scoring, 'live');
  assert.deepEqual(d.home.players.map(p => p.position), POSITIONS);
  assert.deepEqual(d.away.players.map(p => p.position), POSITIONS);

  // Finished: the game's status wins over the live feed.
  state.status = 'FINAL';
  await wait(3200);
  d = await teams();
  assert.equal(d.scoring, 'finished');
});
