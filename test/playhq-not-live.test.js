// PlayHQ not scoring live (board.js playhqTrouble): a scorebench off line doesn't make PlayHQ fail, it just stops
// the score moving. Studio says so on the bar's PlayHQ chip and the status board, from two signs: the live feed says
// the game isn't scored while it's under way, or nothing new comes from the scorer for 4 minutes while its clock
// runs. The first against the stand-in PlayHQ (as on 3 November, when a scorebench's wifi dropped until quarter
// time); the rest against the board on its own, with the time given.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startStudio } = require('./support/studio');

test('the live feed not scoring a game PlayHQ says is under way turns the PlayHQ chip red, and it clears when scoring comes back', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const game = studio.world.gameNow(0);
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId === game.id);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
  const live = studio.world.live[game.id];
  delete studio.world.live[game.id]; // the scorebench never reached PlayHQ: "not electronically scored"
  const h = await studio.until(async () => { const h = await studio.get('/api/health'); return h.playhq.trouble && h; }, 10000, 250);
  assert.equal(h.playhq.trouble, 'not-live');
  assert.equal(h.playhq.state, 'bad');
  assert.match(h.playhq.troubleSays, /scorebench may be off line/);
  assert.ok(h.playhq.readAgoMs !== null && h.playhq.readAgoMs < 10000, 'the "not scored" answer counts as PlayHQ answering');
  studio.world.live[game.id] = live; // back on line
  const back = await studio.until(async () => { const h = await studio.get('/api/health'); return !h.playhq.trouble && h; }, 10000, 250);
  assert.equal(back.playhq.state, 'ok');
  // By hand, nothing is said: the operator already knows.
  delete studio.world.live[game.id];
  await studio.post('/api/scoreboard', { type: 'source', value: 'manual' });
  assert.equal((await studio.get('/api/health')).playhq.trouble, '');
  studio.world.live[game.id] = live;
});

// The board alone, with a stand-in PlayHQ client whose live feed history the test sets.
function boardWith(seen) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-trouble-'));
  const control = { boards: {} };
  const b = require('../board').create({
    log: () => {}, datadir: { local: f => path.join(dir, f) },
    savefile: { readJson: (f, d) => d, writeFile: () => {} }, machine: {}, config: () => ({}),
    competitions: { superShotsFor: () => true }, scene: { publishBoard() {} },
    playhq: { getRoundGames: async () => [], liveScore: async () => null, scoringNotYet: () => '', PERIOD_NUMBER: {}, liveSeenFor: () => seen },
    control: { LASTING: [], get: () => control, save() {}, exists: () => true, markUnsaved() {} },
    logoFor: () => '', colourFor: () => '', rules: () => ({ periodLabel: 'Q', periods: 4 }), competitionName: () => '', warmTeamLists() {},
  });
  fs.rmSync(dir, { recursive: true, force: true });
  const board = b.board();
  Object.assign(board, { source: 'playhq', gameId: 'g1', roundId: 'r1', date: '2026-11-03', time: '18:30', playhqStatus: 'LIVE' });
  return { b, board };
}
const at = '2026-11-03T18:50:00'; // 20 minutes into the game
const now = new Date(at).getTime();
const running = { clock: { status: 'RESUME', time: '05:00' }, break: null };

test('a feed with nothing new for 4 minutes while the scorer\'s clock runs is "quiet"; on a break, or sooner, it isn\'t', () => {
  const seen = { okAt: now - 2000, notScoredAt: 0, changedAt: now - 4 * 60000 - 1000, live: running };
  const { b, board } = boardWith(seen);
  assert.equal(b.playhqTrouble(board, now), 'quiet');
  seen.changedAt = now - 3 * 60000; // the longest normal stretch seen was about 2.5 minutes
  assert.equal(b.playhqTrouble(board, now), '');
  seen.changedAt = now - 10 * 60000;
  seen.live = { clock: { status: 'RESUME', time: '00:00' }, break: 'END_OF_PERIOD' }; // a quarter break
  assert.equal(b.playhqTrouble(board, now), '');
  seen.live = { clock: { status: 'PAUSE', time: '05:00' }, break: null }; // the scorer stopped the clock
  assert.equal(b.playhqTrouble(board, now), '');
  seen.live = running;
  board.playhqStatus = 'FINAL';
  assert.equal(b.playhqTrouble(board, now), '', 'nothing to say once the game is finished');
  board.playhqStatus = 'LIVE';
  board.source = 'manual';
  assert.equal(b.playhqTrouble(board, now), '', 'nothing to say while scoring by hand');
  assert.match(b.troubleSays('quiet'), /Nothing new from PlayHQ's scorer for 4 minutes/);
});

test('"not electronically scored" is "not-live" once PlayHQ says the game is in progress or it is 5 minutes past the start', () => {
  const seen = { okAt: 0, notScoredAt: now - 1000, changedAt: 0 };
  const { b, board } = boardWith(seen);
  board.playhqStatus = 'UPCOMING';
  board.time = '18:47'; // 3 minutes in: the scorer may just be late starting
  assert.equal(b.playhqTrouble(board, now), '');
  board.time = '18:44';
  assert.equal(b.playhqTrouble(board, now), 'not-live');
  board.time = '18:49';
  board.playhqStatus = 'IN_PROGRESS';
  assert.equal(b.playhqTrouble(board, now), 'not-live');
  seen.okAt = now; // a reading since
  assert.equal(b.playhqTrouble(board, now), '');
});
