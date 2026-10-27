// When PlayHQ goes wrong mid-game: the PlayHQ client (playhq.js) against the stand-in PlayHQ
// (test/support/playhq.js), in this process, so each failure can be set up exactly. Graphics keep
// the last good reading where there is one, and every failure says what went wrong.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

// playhq.js keeps finished games in the data folder (datadir.js reads this when it's loaded).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-playhq-'));
process.env.FIRSTPASS_DATA_DIR = dataDir;
const { startPlayhq, createWorld } = require('./support/playhq');

let playhq, logged = [];
test.before(async () => { playhq = await startPlayhq(createWorld()); process.env.PLAYHQ_SPECTATOR_URL = playhq.spectatorUrl; });
test.after(async () => { await playhq.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
test.beforeEach(() => { playhq.world.fail = {}; playhq.world.answers = {}; playhq.world.calls.length = 0; logged = []; });

// A PlayHQ client for the Thunder League. cacheMs 0: every ladder is asked for again.
function client(opts = {}) {
  const c = require('../playhq').create({
    log: (level, source, message) => logged.push(`${level} ${source} ${message}`),
    apiUrl: opts.apiUrl || playhq.url, cacheMs: opts.cacheMs ?? 0, linkBase: 'http://studio.test:8080',
    config: () => ({ name: 'Thunder League', competitionName: 'Thunder League' }),
    leadMs: () => 10 * 60 * 1000, logoFor: () => '', positionOf: p => (p.playerPosition && p.playerPosition.shortName) || '',
  });
  c.setOrganisation(playhq.world.orgUrl);
  return c;
}
const asked = op => playhq.world.calls.filter(c => c.operationName === op);
const graphqlError = message => ({ status: 200, body: { errors: [{ message }] } });

test('the ladder keeps showing the last good one while PlayHQ is down, marked stale with the reason', async () => {
  const c = client();
  const good = await c.getLadder('grade-div1');
  assert.equal(good.pools[0].length, 4);
  assert.equal(good.stale, undefined);
  playhq.world.fail.gradeLadder = 503;
  const kept = await c.getLadder('grade-div1');
  assert.deepEqual(kept.pools, good.pools, 'the same standings as before PlayHQ went down');
  assert.equal(kept.updatedAt, good.updatedAt, 'still says when it was last read');
  assert.equal(kept.stale, true);
  assert.match(kept.error, /HTTP 503/);
  playhq.world.fail = {};
  const back = await c.getLadder('grade-div1');
  assert.equal(back.stale, undefined, 'fresh again once PlayHQ answers');
});

test('a round\'s games (the fixtures, up next, the game list) keep the last ones read while PlayHQ is down', async () => {
  const c = client();
  const good = await c.getRoundGames('grade-div1-r3', 0);
  assert.equal(good.length, 2);
  playhq.world.fail.discoverFixtureByRound = 503;
  const kept = await c.getRoundGames('grade-div1-r3', 0);
  assert.deepEqual([...kept], good);
  assert.match(kept.stale, /HTTP 503/, 'says why they aren\'t fresh');
  assert.ok(logged.some(l => /Keeping round grade-div1-r3's games as last read: PlayHQ answered HTTP 503/.test(l)), logged.join('\n'));
  assert.equal(asked('discoverFixtureByRound').length, 2, 'PlayHQ is still asked each time, so it\'s fresh once it\'s back');
  // A round never read fails as before.
  await assert.rejects(c.getRoundGames('grade-div1-r4', 0), /HTTP 503/);
});

test('a division\'s rounds keep the last ones read while PlayHQ is down', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const c = client();
  const good = await c.getRounds('grade-div1');
  t.mock.timers.tick(6 * 60 * 1000); // past the 5 minutes they're kept
  playhq.world.fail.gradeRounds = 503;
  await assert.rejects(c.getRounds('grade-div2'), /HTTP 503/, 'never read: fails');
  assert.deepEqual(await c.getRounds('grade-div1'), good);
});

test('the season\'s divisions keep the last ones read when PlayHQ fails as they\'re due to be read again', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const c = client();
  const good = await c.getStructure();
  t.mock.timers.tick(31 * 60 * 1000); // past the 30 minutes they're kept
  playhq.world.fail.discoverCompetitions = 503;
  assert.deepEqual(await c.getStructure(), good);
  assert.ok(logged.some(l => /Keeping the divisions read 31 minutes ago: PlayHQ answered HTTP 503/.test(l)), logged.join('\n'));
  // Back: read again.
  playhq.world.fail = {};
  playhq.world.calls.length = 0;
  await c.getStructure();
  assert.equal(asked('discoverCompetitions').length, 1);
});

test('the divisions never read fail with PlayHQ\'s reason', async () => {
  playhq.world.fail.discoverCompetitions = 503;
  await assert.rejects(client().getStructure(), /HTTP 503/);
});

test('a ladder never read before fails with PlayHQ\'s reason rather than showing an empty ladder', async () => {
  const c = client();
  playhq.world.fail.gradeLadder = 502;
  await assert.rejects(c.getLadder('grade-div2'), /PlayHQ answered HTTP 502/);
});

test('a "Request blocked" answer says PlayHQ blocked it for now and will be tried again', async () => {
  const c = client();
  playhq.world.fail.gradeLadder = 429; // the stand-in's error answers say "Request blocked"
  await assert.rejects(c.getLadder('grade-div1'), /HTTP 429 \(temporarily blocked, will retry\)/);
});

test('a ladder column PlayHQ doesn\'t have for the sport is left out, and the rest of the ladder is read', async () => {
  const c = client();
  playhq.world.answers.gradeLadder = ({ query }) => /\bbyes\b/.test(query)
    && { status: 400, body: { errors: [{ message: 'Cannot query field "byes" on type "DiscoverStanding".' }] } };
  const l = await c.getLadder('grade-div1');
  assert.equal(l.pools[0].length, 4);
  assert.equal(l.pools[0][0].byes, undefined);
  assert.equal(typeof l.pools[0][0].won, 'number');
  assert.equal(asked('gradeLadder').length, 2, 'asked once with byes and once without');
  await c.getLadder('grade-div2');
  assert.equal(asked('gradeLadder').length, 3, 'the missing column is remembered for the next ladder');
});

test('a ladder PlayHQ refuses for some other reason fails with that reason, without retrying column by column', async () => {
  const c = client();
  playhq.world.answers.gradeLadder = () => ({ status: 400, body: { errors: [{ message: 'Grade is archived' }] } });
  await assert.rejects(c.getLadder('grade-div1'), /HTTP 400: Grade is archived/);
  assert.equal(asked('gradeLadder').length, 1);
});

test('GraphQL errors in an answer that is otherwise OK fail with PlayHQ\'s message and are logged', async () => {
  const c = client();
  playhq.world.answers.gradeRounds = () => graphqlError('Internal server error');
  await assert.rejects(c.getRounds('grade-div1'), /^Error: Internal server error$/);
  assert.ok(logged.some(l => /^error playhq gradeRounds GraphQL errors/.test(l)), logged.join('\n'));
});

test('an answer that isn\'t JSON (a maintenance page) says so', async () => {
  const html = require('node:http').createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>maintenance</html>'); });
  await new Promise(r => html.listen(0, '127.0.0.1', r));
  try {
    const c = client({ apiUrl: `http://127.0.0.1:${html.address().port}/graphql` });
    await assert.rejects(c.getRounds('grade-div1'), /PlayHQ sent something that was not JSON/);
  } finally { await new Promise(r => html.close(r)); }
});

// A port nothing listens on, for a PlayHQ that can't be reached at all (the internet down).
function closedPort() {
  return new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
}

test('with the internet down, PlayHQ can\'t be reached: said in words, not as "fetch failed", and logged', async () => {
  const c = client({ apiUrl: `http://127.0.0.1:${await closedPort()}/graphql` });
  await assert.rejects(c.getRounds('grade-div1'), err => {
    assert.match(err.message, /^Can't reach PlayHQ \(ECONNREFUSED\)\. Is this Mac connected to the internet\?$/);
    assert.equal(err.unreachable, true);
    return true;
  });
  assert.ok(logged.some(l => /^error playhq Guest session: Can't reach PlayHQ/.test(l)), logged.join('\n'));
});

test('PlayHQ\'s live scoring that can\'t be reached says so in words too, and health hears it', async () => {
  const dead = `http://127.0.0.1:${await closedPort()}/spectator`;
  process.env.PLAYHQ_SPECTATOR_URL = dead;
  try {
    const c = client();
    const game = playhq.world.gameNow(0);
    await c.getRoundGames(game.roundId, 0);
    await assert.rejects(c.getLive(game.id, 0), err => /^Can't reach PlayHQ's live scoring \(ECONNREFUSED\)\./.test(err.message));
    assert.match(c.lastLive.error, /^Can't reach PlayHQ's live scoring/);
  } finally { process.env.PLAYHQ_SPECTATOR_URL = playhq.spectatorUrl; }
});

test('a refused session (HTTP 401) gets a new guest session and asks once more', async () => {
  const c = client();
  await c.getRounds('grade-div1'); // a session to start with
  let refusals = 0;
  playhq.world.answers.discoverFixtureByRound = () => refusals++ === 0 && { status: 401, body: { errors: [] } };
  const games = await c.getRoundGames('grade-div1-r3', 0);
  assert.equal(games.length, 2, 'the second try is answered');
  assert.equal(asked('discoverFixtureByRound').length, 2);
  assert.equal(asked('ProfileSearch').length, 2, 'a new session was asked for between the two');
});

test('a session that keeps being refused fails after one retry, not in a loop', async () => {
  const c = client();
  playhq.world.answers.discoverFixtureByRound = () => ({ status: 403, body: { errors: [] } });
  await assert.rejects(c.getRoundGames('grade-div1-r3', 0), /HTTP 403/);
  assert.equal(asked('discoverFixtureByRound').length, 2);
});

test('a season PlayHQ won\'t give division genders for is read without them', async () => {
  const c = client();
  playhq.world.answers.gradeListDiscoverSeason = ({ query }) => /gender/.test(query)
    && { status: 400, body: { errors: [{ message: 'Cannot query field "gender" on type "DiscoverGrade".' }] } };
  const st = await c.getStructure();
  assert.deepEqual(st.grades.map(g => [g.name, g.gender]), [['Division 1', ''], ['Division 2', '']]);
  assert.equal(st.season.name, 'Spring 2026');
  assert.ok(logged.some(l => /Division gender unavailable/.test(l)));
});

test('a season with division genders gives each division its gender', async () => {
  const st = await client().getStructure();
  assert.deepEqual(st.grades.map(g => [g.name, g.gender]), [['Division 1', ''], ['Division 2', 'male']]);
});

test('the live feed failing falls back to the game page\'s score, and health hears why', async () => {
  const c = client();
  const game = playhq.world.gameNow(0);
  await c.getRoundGames(game.roundId, 0); // the start time, so the live feed is asked
  Object.assign(playhq.world.live[game.id], { home: 5, away: 3 });
  playhq.world.answers.live = () => graphqlError('Spectator service unavailable');
  const s = await c.liveScore(game, 0);
  assert.equal(s.home, 5);
  assert.equal(s.away, 3);
  assert.equal(s.live, undefined, 'from the game page, not the live feed');
  assert.match(c.lastLive.error, /Spectator service unavailable/);
  assert.ok(logged.some(l => /^warn live Live feed failed for /.test(l)));
});

test('a game that isn\'t being scored yet is said once in the log, not on every check, and isn\'t an error', async () => {
  const c = client();
  const game = playhq.world.gameNow(0);
  await c.getRoundGames(game.roundId, 0);
  playhq.world.answers.live = () => graphqlError('The game could not be found or was not electronically scored');
  for (let i = 0; i < 3; i++) await assert.rejects(c.getLive(game.id, 0), err => err.notScored === true);
  assert.equal(logged.filter(l => /isn't being scored in PlayHQ yet/.test(l)).length, 1);
  assert.equal(c.lastLive.error, '', 'health doesn\'t count it as PlayHQ failing');
});

test('the live feed answering an HTTP error fails with the status', async () => {
  const c = client();
  const game = playhq.world.gameNow(0);
  await c.getRoundGames(game.roundId, 0);
  playhq.world.fail.live = 500;
  await assert.rejects(c.getLive(game.id, 0), /PlayHQ live feed answered HTTP 500/);
});

test('a game PlayHQ\'s live feed doesn\'t know fails saying so', async () => {
  const c = client();
  playhq.world.answers.live = () => ({ status: 200, body: { data: { game: null } } });
  await assert.rejects(c.getLive('game-unknown', 0), /live feed has no game game-unknown/);
});

test('both the live feed and the game page failing gives no score rather than 0-0', async () => {
  const c = client();
  const game = playhq.world.gameNow(0);
  await c.getRoundGames(game.roundId, 0);
  playhq.world.fail.live = 503;
  playhq.world.fail.discoverGame = 503;
  assert.equal(await c.liveScore(game, 0), null);
});

test('the same game asked for by several graphics at once is one request to PlayHQ', async () => {
  const c = client();
  const game = playhq.world.gameNow(0);
  await c.getRoundGames(game.roundId, 0);
  playhq.world.calls.length = 0;
  await Promise.all([c.getLive(game.id, 0), c.getLive(game.id, 0), c.getLive(game.id, 0)]);
  assert.equal(playhq.world.calls.filter(x => x.spectator).length, 1);
  await Promise.all([c.getRoundGames(game.roundId, 0), c.getRoundGames(game.roundId, 0)]);
  assert.equal(asked('discoverFixtureByRound').length, 1);
});
