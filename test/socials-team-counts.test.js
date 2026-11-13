// Team and night totals on the Socials tab come from PlayHQ's own team counts, not the players added up: PlayHQ can
// give a goal to a team without naming the shooter, and private players are left out of the line ups. A game PlayHQ's
// game page doesn't yet call finished is never kept in game-cache.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio.mts');
const { createWorld, discoverGame } = require('./support/playhq.mts');

const stat = (type, count) => ({ type: { value: type }, count });

test('Night in numbers and Game stats count the super shots PlayHQ gave a team without a shooter', async t => {
  const world = createWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const second = world.games['game-d1-r2-1'].date;
  const before = await studio.get(`/api/socials/night?date=${second}&with=numbers,gamestats&game=game-d1-r2-1`);
  const home = before.gameStats.game.home;

  // A fresh Studio (nothing kept) where Blizzardz' game page has the team's own counts: 2 more super shots and 1 more
  // goal than its named players (one from a private player, the rest given to the team only).
  await studio.stop();
  const again = await startStudio(t, { competition: 'Thunder League', world });
  world.answers.discoverGame = ({ variables }) => {
    if (variables.gameID !== 'game-d1-r2-1') return null;
    const g = discoverGame(world, variables.gameID);
    g.statistics.home.statistics.push(stat('1_POINT_SCORE', home.goals + 1), stat('2_POINT_SCORE', home.superGoals + 2), stat('GOAL_ATTEMPT', home.shots + 4));
    g.statistics.home.players.push({ playerNumber: '8', player: { __typename: 'DiscoverAnonymousParticipant', id: 'anon', name: 'Private player' },
      statistics: [stat('2_POINT_SCORE', 1), stat('GOAL_ATTEMPT', 1)], playerPosition: { shortName: 'GA' }, captain: null });
    return { body: { data: { discoverGame: g } } };
  };
  const n = await again.get(`/api/socials/night?date=${second}&with=numbers,gamestats&game=game-d1-r2-1`);
  assert.equal(n.numbers.superShots, before.numbers.superShots + 2, 'the night counts the team-only super shots');
  assert.equal(n.numbers.notCounted, 0);
  const h = n.gameStats.game.home;
  assert.deepEqual([h.goals, h.superGoals, h.shots], [home.goals + 1, home.superGoals + 2, home.shots + 4]);
  assert.equal(h.points, h.goals + 2 * h.superGoals);
  assert.equal(h.misses, undefined, 'no misses: having the most isn\'t a win');
  assert.ok(!h.shooters.some(p => /Private/.test(p.name)), 'a private player is never named');
});

test('a finished game PlayHQ\'s game page still has as being played is read again, not kept', async t => {
  const world = createWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const second = world.games['game-d1-r2-1'].date;
  world.answers.discoverGame = ({ variables }) => {
    if (variables.gameID !== 'game-d1-r2-1') return null;
    return { body: { data: { discoverGame: { ...discoverGame(world, variables.gameID), status: { value: 'IN_PROGRESS' } } } } };
  };
  await studio.get(`/api/socials/night?date=${second}&with=numbers`);
  const file = path.join(studio.dataDir, 'game-cache.json');
  await studio.until(() => fs.existsSync(file) && Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).games).length > 0);
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(kept.version, 2);
  assert.ok(!kept.games['game-d1-r2-1'], 'not kept while PlayHQ says it is being played');
  assert.ok(kept.games['game-d1-r2-2'], 'the night\'s other games are kept');
});
