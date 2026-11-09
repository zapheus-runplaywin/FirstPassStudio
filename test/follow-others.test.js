// Following the night's other games in the background (board.js followGames, refreshFollowed): while the scoreboard
// follows court 1, Studio follows the other game being scored (court 2) from PlayHQ's live feed, so it gets a story of
// its own, with nothing of it on air; picking it hands its goals to the scoreboard, leaving it hands them back; a
// failing read waits longer; and the switch on Scoreboard control turns it off. Against the stand-in PlayHQ
// (test/support/playhq.js), where both division 1 games started 30 minutes ago.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startStudio } = require('./support/studio');

let studio, main, other, live;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League', env: { FIRSTPASS_FOLLOW_LIST_MS: '2000' } });
  main = studio.world.gameNow(0);
  other = studio.world.divisions[0].rounds[2].games[1]; // division 1's game on court 2, being scored too
  live = studio.world.live[other.id];
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId === main.id);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 }); // the quickest it reads PlayHQ
});
test.after(() => studio && studio.stop());

const board = () => studio.get('/api/scoreboard');
const act = a => studio.post('/api/scoreboard', a);
const followedOf = (b, id = other.id) => (b.followedGames || []).find(g => g.gameId === id);
const settle = check => studio.until(async () => { const b = await board(); return check(b) && b; }, 15000, 250);
const liveCalls = id => studio.world.calls.filter(c => c.spectator && c.variables.id === id).length;

test('the other game being scored is followed in the background, goal by goal, with nothing on air', async () => {
  let b = await settle(b => followedOf(b)?.started);
  assert.equal(b.followOthers, true, 'on by default');
  const later = studio.world.divisions[1].rounds[2].games[0];
  assert.ok(followedOf(b, later.id), 'a game later tonight is listed');
  assert.equal(followedOf(b, main.id), undefined, 'not the scoreboard\'s own game');
  const before = { super: b.superShot?.n || 0, streak: b.streak?.n || 0 };
  Object.assign(live, { home: 1, homeGoals: 1 });
  await settle(b => followedOf(b).score.home === 1);
  Object.assign(live, { home: 3, homeSuper: 1 }); // a super shot
  await settle(b => followedOf(b).score.home === 3);
  Object.assign(live, { home: 4, homeGoals: 2 }); // a third goal in a row: heating up, on its own board
  b = await settle(b => followedOf(b).score.home === 4);
  assert.equal(followedOf(b).goals, 3);
  assert.deepEqual(b.home.score, 0, 'the scoreboard\'s game is untouched');
  assert.equal(b.superShot?.n || 0, before.super, 'no super shot plays for it');
  assert.equal(b.streak?.n || 0, before.streak, 'no moment plays for it');
  assert.equal(liveCalls(later.id), 0, 'a game whose scoring hasn\'t opened isn\'t asked about');
  // Its story is kept as it goes, marked followed, with its runs and moments.
  const file = path.join(studio.dataDir, 'game-stories', `${other.id}.json`);
  const story = await studio.until(() => { try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return s.worm.totalGoals === 3 && s; } catch { return null; } }, 20000, 250);
  assert.equal(story.followed, true);
  assert.equal(story.stats.stats.longestRun.home, 3);
  assert.deepEqual(story.moments.map(m => m.kind), ['heating']);
  assert.equal(story.stats.gapInHistory, false, 'followed from 0-0, so no gap');
});

test('picking the followed game takes over its goals, and the game left goes on being followed', async () => {
  Object.assign(studio.world.live[main.id], { away: 1, awayGoals: 1 });
  await settle(b => b.away.score === 1);
  await act({ type: 'selectGame', game: { ...other, home: { name: other.home }, away: { name: other.away } } });
  let b = await board();
  assert.equal(b.gameId, other.id);
  assert.equal(b.home.score, 4, 'carries on from the followed score, not 0-0');
  const goals = await studio.get('/api/goals');
  assert.equal(goals.totalGoals, 3);
  assert.equal(goals.gapInHistory, false, 'no gap: the goals came with it');
  assert.equal(followedOf(b), undefined, 'no longer followed in the background');
  assert.ok(followedOf(b, main.id), 'the game the scoreboard left is followed from where it was');
  assert.equal(followedOf(b, main.id).goals, 1);
  Object.assign(live, { away: 1, awayGoals: 1 });
  b = await settle(b => b.away.score === 1);
  assert.equal((await studio.get('/api/goals')).totalGoals, 4);
  // Back to the first game: it comes back with its goals, and this one is followed again.
  await act({ type: 'selectGame', game: { ...main, home: { name: main.home }, away: { name: main.away } } });
  b = await board();
  assert.equal(b.gameId, main.id);
  assert.equal(b.away.score, 1);
  assert.equal((await studio.get('/api/goals')).gapInHistory, false);
  assert.equal(followedOf(b).goals, 4);
});

test('a failing read waits longer before the next, and the game is read again once PlayHQ answers', async () => {
  studio.world.answers.live = ({ variables }) => variables.id === other.id && { status: 503, body: { errors: [{ message: 'busy' }] } };
  const start = liveCalls(other.id);
  await settle(b => followedOf(b).waiting);
  const failed = liveCalls(other.id) - start;
  await new Promise(r => setTimeout(r, 6000));
  assert.ok(liveCalls(other.id) - start <= failed + 1, 'not asked every few seconds while it fails');
  delete studio.world.answers.live;
  Object.assign(live, { away: 2, awayGoals: 2 });
  await settle(b => !followedOf(b).waiting && followedOf(b).score.away === 2);
});

test('a game that finishes in the background keeps its story, shared', async () => {
  studio.world.games[other.id].status = 'FINAL';
  await settle(b => followedOf(b).done);
  const list = await studio.get('/api/stories');
  const mine = list.stories.find(s => s.gameId === other.id);
  assert.ok(mine, 'shared once it\'s finished');
  assert.equal(mine.followed, undefined, 'it was on the scoreboard for a while, so it counts as streamed');
  const calls = liveCalls(other.id);
  await new Promise(r => setTimeout(r, 4000));
  assert.equal(liveCalls(other.id), calls, 'a finished game isn\'t read again');
});

test('turning it off on Scoreboard control lets the other games go', async () => {
  let b = await act({ type: 'followOthers', value: false });
  assert.equal(b.followOthers, false);
  b = await settle(b => !(b.followedGames || []).length);
  b = await act({ type: 'followOthers', value: true });
  assert.equal(b.followOthers, true);
  await settle(b => (b.followedGames || []).length > 0);
});
