// The team lists are warmed up when a game is picked (and at start up), and finished games'
// line ups are kept in game-cache.json, so a restart doesn't read the season from PlayHQ again.
// Runs server.js against a stand-in PlayHQ.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runServer } = require('./support/studio');

const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
const players = prefix => POSITIONS.map((pos, i) => ({
  playerNumber: String(i + 1),
  player: { __typename: 'DiscoverParticipant', id: `${prefix}${i}`, profile: { firstName: prefix, lastName: pos } },
  statistics: [], playerPosition: { shortName: pos }, captain: null,
}));
const team = name => ({ __typename: 'DiscoverTeam', id: name, name });
const today = new Date().toISOString().slice(0, 10);
const side = score => ({ outcome: null, statistics: score == null ? [] : [{ count: score, type: { value: 'TOTAL_SCORE' } }] });
const fixture = (id, date, status, scores) => ({ id, date, dates: [date], status: { value: status }, home: team('Thunder'), away: team('Warriors'),
  result: { home: side(scores && scores[0]), away: side(scores && scores[1]) }, allocation: { time: '23:59:00', court: { name: 'Court 1', venue: { name: 'Hall' } } } });
// Two finished games with full line ups, and tonight's game with none yet.
const ROUNDS = {
  r1: [fixture('done-1', '2026-01-10', 'FINAL', [20, 18])],
  r2: [fixture('done-2', '2026-01-17', 'FINAL', [15, 22])],
  r3: [fixture('tonight', today, 'UPCOMING')],
};

function listen(server) { return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); }
const wait = ms => new Promise(r => setTimeout(r, ms));

test('team lists: warmed up when a game is picked, and finished games kept across restarts', async t => {
  const asked = { games: [], genderProbes: 0 };
  const playhq = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const { operationName, query, variables } = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      const answer = data => res.end(JSON.stringify({ data }));
      if (req.url.startsWith('/spectator')) return res.end(JSON.stringify({ errors: [{ message: 'not electronically scored' }] }));
      if (operationName === 'discoverCompetitions') return answer({ discoverCompetitions: [{ id: 'c1', name: 'Test League', organisation: { id: 'o1', name: 'Org' },
        seasons: [{ id: 's1', name: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: { name: 'Active', value: 'ACTIVE' } }] }] });
      if (operationName === 'gradeListDiscoverSeason') return answer({ discoverSeason: { id: 's1', name: '2026', competition: { id: 'c1', name: 'Test League' }, grades: [{ id: 'g1', name: 'Div 1' }] } });
      if (operationName === 'gradeRounds') return answer({ discoverGrade: { id: 'g1', name: 'Div 1', rounds: [
        { id: 'r1', name: 'Round 1', number: 1, current: false }, { id: 'r2', name: 'Round 2', number: 2, current: false }, { id: 'r3', name: 'Round 3', number: 3, current: true }] } });
      if (operationName === 'discoverFixtureByRound') return answer({ discoverFixtureByRound: { games: ROUNDS[variables.roundID] || [] } });
      if (operationName === 'discoverGame') {
        // PlayHQ doesn't know a plain "gender" field: the helper has to find that out once.
        if (/lastName gender \}/.test(query)) {
          asked.genderProbes++;
          res.statusCode = 400;
          return res.end(JSON.stringify({ errors: [{ message: 'Cannot query field "gender" on type "DiscoverProfile".' }] }));
        }
        asked.games.push(variables.gameID);
        const f = Object.values(ROUNDS).flat().find(g => g.id === variables.gameID);
        const done = f.status.value === 'FINAL';
        return answer({ discoverGame: { id: f.id, date: f.date, status: f.status, home: f.home, away: f.away, result: null,
          statistics: done ? { home: { players: players('Home'), statistics: [] }, away: { players: players('Away'), statistics: [] } } : null } });
      }
      answer({});
    });
  });
  const playhqPort = await listen(playhq);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  fs.mkdirSync(path.join(dataDir, 'competitions', 'test'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'competitions', 'test', 'settings.json'), JSON.stringify({
    name: 'Test League', organisationUrl: 'https://www.playhq.com/netball-australia/org/test-org/a1b2c3d4', competitionName: 'Test League' }));
  fs.writeFileSync(path.join(dataDir, 'competitions', 'active.json'), JSON.stringify({ active: 'test' }));
  const logFile = path.join(dataDir, 'logs', 'playhq-graphics.log');
  const readyLines = () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(l => /Team lists ready/.test(l)); } catch { return []; } };

  let server = null;
  t.after(async () => { if (server) { server.child.kill(); await server.exit; } playhq.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  async function start() {
    server = await runServer({ FIRSTPASS_DATA_DIR: dataDir,
      PLAYHQ_API_URL: `http://127.0.0.1:${playhqPort}/graphql`, PLAYHQ_SPECTATOR_URL: `http://127.0.0.1:${playhqPort}/spectator` });
    return `http://127.0.0.1:${server.port}`;
  }
  async function stop() {
    const s = server; server = null;
    s.child.kill(); await s.exit;
  }
  async function untilReady(count) {
    for (let i = 0; i < 100 && readyLines().length < count; i++) await wait(100);
    if (readyLines().length < count) console.error(fs.readFileSync(logFile, 'utf8').split('\n').filter(l => /teams|warn|error/i.test(l)).slice(-15).join('\n'));
    assert.equal(readyLines().length, count, 'the team lists were warmed up');
  }

  // First run: picking tonight's game reads both finished games once, ahead of the team list.
  let base = await start();
  await fetch(`${base}/api/scoreboard`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'selectGame', game: { id: 'tonight', roundId: 'r3', division: 'Div 1', date: today, time: '23:59:00', home: { name: 'Thunder' }, away: { name: 'Warriors' } } }) });
  await untilReady(1);
  assert.equal(asked.games.filter(id => id === 'done-1').length, 1);
  assert.equal(asked.games.filter(id => id === 'done-2').length, 1);
  assert.equal(asked.genderProbes, 1);

  const before = asked.games.length;
  const d = await (await fetch(`${base}/api/teams`)).json();
  assert.equal(d.home.name, 'Thunder');
  assert.equal(d.home.players.length, 7, 'the season squad stands in for the missing line up');
  assert.ok(d.home.players.every(p => p.fromSquad));
  assert.ok(!asked.games.slice(before).some(id => id.startsWith('done-')), 'the team list read no finished games itself');

  await wait(2500); // game-cache.json is written a moment after
  await stop();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'game-cache.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.games).sort(), ['done-1', 'done-2']);
  assert.equal(saved.genderField, 'gender { value }');

  // Second run: the start up warm up needs only tonight's game, and no gender probing.
  const gamesBefore = asked.games.length;
  base = await start();
  await untilReady(2);
  const second = asked.games.slice(gamesBefore);
  assert.ok(!second.some(id => id.startsWith('done-')), `finished games came from game-cache.json (asked ${second.join(', ')})`);
  assert.ok(second.includes('tonight'));
  assert.equal(asked.genderProbes, 1);
  const again = await (await fetch(`${base}/api/teams`)).json();
  assert.equal(again.away.players.length, 7);
});
