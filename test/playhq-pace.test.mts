// Being kind to PlayHQ (playhq.js "Being kind to PlayHQ"): a game is read at Check PlayHQ every only while it's played,
// from 2 minutes before its start until 2 minutes after PlayHQ finishes it; every 30 s once its scoring opens before
// that; every 5 minutes otherwise. The fixtures and ladders are read every minute while a game is on, every 5 minutes
// when none is, and afresh when Refresh list asks. The PlayHQ client against the stand-in PlayHQ, in this process.
import { createRequire } from 'node:module';

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPlayhq, createWorld, localZone, type StandIn } from './support/playhq.mts';

const require = createRequire(import.meta.url);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pace-'));
process.env.FIRSTPASS_DATA_DIR = dataDir;
process.env.TZ = localZone().tz; // the stand-in's game times are wall-clock times where it's about midday

const MIN = 60 * 1000;
let playhq: StandIn;
test.before(async () => { playhq = await startPlayhq(createWorld()); process.env.PLAYHQ_SPECTATOR_URL = playhq.spectatorUrl; });
test.after(async () => { await playhq.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

// A fresh world each test, so a game's time or status changed by one test doesn't reach the next.
test.beforeEach(() => {
  Object.assign(playhq.world, createWorld());
});

function client() {
  const c = (require('../out/playhq.js') as typeof import('../out/playhq.js')).create({
    log: () => {}, apiUrl: playhq.url, linkBase: 'http://studio.test:8080',
    config: () => ({ name: 'Thunder League', competitionName: 'Thunder League' }),
    leadMs: () => 10 * MIN, logoFor: () => '', positionOf: () => '',
  });
  c.setOrganisation(playhq.world.orgUrl);
  return c;
}
// HH:MM:SS where the stand-in's games are, so many minutes from now.
const timeIn = (minutes: number) => new Date(Date.now() + minutes * MIN + localZone().offset * 3600000).toISOString().slice(11, 16) + ':00';
// Division 2's court 1 game today (starts in 90 minutes, not scored yet), moved to start in so many minutes.
function upcomingIn(minutes: number) {
  const g = playhq.world.divisions[1].rounds[2].games[0];
  g.time = timeIn(minutes);
  return g;
}
const liveCalls = () => playhq.world.calls.filter(x => x.spectator).length;
const asked = (op: string) => playhq.world.calls.filter(x => x.operationName === op).length;

test('a game being played is read at Check PlayHQ every', async () => {
  const c = client();
  const game = playhq.world.gameNow(0); // started 30 minutes ago, being scored
  await c.getRoundGames(game.roundId, 0);
  assert.equal(c.pace(game.id), 'game');
  assert.equal(c.liveAge(game.id, 1000), 1000);
  await c.getLive(game.id, 0);
  await c.getLive(game.id, 0);
  assert.equal(liveCalls(), 2, 'asked each time with Check PlayHQ every at 0');
});

test('from 2 minutes before the start, a game is read at Check PlayHQ every', async () => {
  const c = client();
  const game = upcomingIn(1);
  await c.getRoundGames(game.roundId, 0);
  assert.equal(c.pace(game.id), 'game');
  assert.equal(c.liveAge(game.id, 1000), 1000);
});

test('once its scoring opens, until 2 minutes before, a game is read every 30 seconds, and not before then at all', async () => {
  const c = client();
  const game = upcomingIn(6);
  await c.getRoundGames(game.roundId, 0);
  assert.equal(c.pace(game.id), 'warmup');
  assert.equal(c.liveAge(game.id, 1000), 30 * 1000);
  assert.equal(c.liveAge(game.id, 60 * 1000), 60 * 1000, 'a caller asking less often is left as it asks');
  // The scorer hasn't started: "not electronically scored" is kept as long as a reading, not asked every second.
  playhq.world.answers.live = () => ({ status: 200, body: { errors: [{ message: 'The game could not be found or was not electronically scored' }] } });
  for (let i = 0; i < 3; i++) await assert.rejects(c.getLive(game.id, 1000), (err: { notScored?: boolean }) => err.notScored === true);
  assert.equal(liveCalls(), 1, 'asked once in 30 seconds');
  // A scorer who starts early: the game is under way, so it's read at Check PlayHQ every from then.
  delete playhq.world.answers.live;
  playhq.world.live[game.id] = { home: 1, away: 0, homeGoals: 1, awayGoals: 0, homeSuper: 0, awaySuper: 0,
    period: 'FIRST_QTR', clock: { status: 'RESUME', time: '09:30', lastUpdatedAt: String(Date.now()) }, break: null };
  const later = client(); // a reading that sees it under way (a fresh client, so the kept "not scored" doesn't wait 30 s)
  await later.getRoundGames(game.roundId, 0);
  await later.getLive(game.id, 1000);
  assert.equal(later.pace(game.id), 'game');

  const far = upcomingIn(30);
  const c3 = client();
  await c3.getRoundGames(far.roundId, 0);
  assert.equal(c3.pace(far.id), 'gentle');
  await assert.rejects(c3.getLive(far.id, 1000), (err: { notYet?: boolean }) => err.notYet === true, 'not asked before scoring opens');
});

test('2 minutes after PlayHQ finishes a game it is read every 5 minutes', async t => {
  const c = client();
  const game = playhq.world.gameNow(0);
  await c.getRoundGames(game.roundId, 0);
  playhq.world.games[game.id].status = 'FINAL';
  playhq.world.live[game.id].status = 'FINAL';
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  await c.getLive(game.id, 0);
  assert.equal(c.pace(game.id), 'game', 'still at Check PlayHQ every just after full time');
  t.mock.timers.tick(2 * MIN + 1000);
  assert.equal(c.pace(game.id), 'gentle');
  assert.equal(c.liveAge(game.id, 1000), 5 * MIN);
});

test('a game PlayHQ has no start time for is read every 5 minutes', async () => {
  const c = client();
  assert.equal(c.pace('game-with-no-fixture'), 'gentle');
  assert.equal(c.liveAge('game-with-no-fixture', 1000), 5 * MIN);
});

test('with no game on, the fixtures and ladders are read every 5 minutes; Refresh list reads them afresh', async () => {
  const c = client();
  // Nothing on today: every game of round 3 moved to tonight, hours away.
  for (const d of playhq.world.divisions) for (const g of d.rounds[2].games) { g.time = timeIn(5 * 60); g.status = 'UPCOMING'; delete playhq.world.live[g.id]; }
  const round = playhq.world.divisions[0].rounds[2].id;
  await c.getRoundGames(round, 60 * 1000);
  await c.getLadder('grade-div1');
  assert.equal(c.gameOn(), false);
  playhq.world.calls.length = 0;
  await c.getRoundGames(round, 0);
  await c.getLadder('grade-div1');
  assert.equal(asked('discoverFixtureByRound'), 0, 'the round kept, though asked for at 0');
  assert.equal(asked('gradeLadder'), 0, 'the ladder kept');
  c.askAgain();
  await c.getRoundGames(round, 60 * 1000);
  await c.getLadder('grade-div1');
  assert.equal(asked('discoverFixtureByRound'), 1, 'Refresh list asks PlayHQ for the round');
  assert.equal(asked('gradeLadder'), 1, 'and the ladder');
  await c.getRoundGames(round, 60 * 1000);
  assert.equal(asked('discoverFixtureByRound'), 1, 'once: then kept again');
});

test('Refresh list reads each once, even when the read lands in the same millisecond as the press', async t => {
  const c = client();
  for (const d of playhq.world.divisions) for (const g of d.rounds[2].games) { g.time = timeIn(5 * 60); g.status = 'UPCOMING'; delete playhq.world.live[g.id]; }
  const round = playhq.world.divisions[0].rounds[2].id;
  await c.getRoundGames(round, 60 * 1000);
  // The clock stands still, so the press and the fresh read share one millisecond.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 1000 });
  playhq.world.calls.length = 0;
  c.askAgain();
  await c.getRoundGames(round, 60 * 1000);
  await c.getRoundGames(round, 60 * 1000);
  await c.getRoundGames(round, 60 * 1000);
  assert.equal(asked('discoverFixtureByRound'), 1, 'read afresh once, then kept');
});

test('with a game on, the fixtures are read as often as asked', async () => {
  const c = client();
  const game = playhq.world.gameNow(0);
  await c.getRoundGames(game.roundId, 0);
  assert.equal(c.gameOn(), true);
  playhq.world.calls.length = 0;
  await c.getRoundGames(game.roundId, 0);
  assert.equal(asked('discoverFixtureByRound'), 1);
});
