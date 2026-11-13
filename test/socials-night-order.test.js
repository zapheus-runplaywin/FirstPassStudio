// Night in numbers' goal order tiles (socials.ts goalOrderNumbers): the lead changes, the most goals in a row and the
// runs of 5 goals across the night, only when Studio has every finished game's whole story, so no game is left out of
// a night-wide number (Matt, 2026-11-05: night totals must work for every game).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');

test('Night in numbers adds lead changes, goals in a row and runs of 5 only once every game has a whole story', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const nights = (await studio.get('/api/socials')).nights.map(n => n.date);
  const date = nights[1];
  const games = (await studio.get(`/api/socials/night?date=${date}`)).games.filter(g => g.finished);
  assert.ok(games.length > 1);
  const dir = path.join(studio.dataDir, 'game-stories');
  fs.mkdirSync(dir, { recursive: true });
  // A whole story of each game: its final score, no gap, its runs and lead changes.
  const keep = (g, i, extra = {}) => fs.writeFileSync(path.join(dir, `${g.id}.json`), JSON.stringify({ gameId: g.id, date, ended: true, savedAt: Date.now(),
    stats: { home: { score: g.home.score }, away: { score: g.away.score }, gapInHistory: false,
      stats: { longestRun: { home: 3 + i, away: 2 }, runs5: { home: i ? 1 : 0, away: 0 } } },
    worm: { leadChanges: 2, gaps: [] }, moments: [], ...extra }));
  games.forEach((g, i) => keep(g, i, i === 0 ? { stats: { home: { score: g.home.score }, away: { score: g.away.score }, gapInHistory: true, stats: {} } } : {}));
  let n = (await studio.get(`/api/socials/night?date=${date}&with=numbers`)).numbers;
  assert.deepEqual(n.goalOrder, { complete: games.length - 1, of: games.length, missing: [`${games[0].home.name} v ${games[0].away.name}`] }, 'a game with a gap holds them back');
  assert.equal(n.leadChanges, undefined);
  assert.equal(n.longestRun, undefined);

  games.forEach((g, i) => keep(g, i));
  n = (await studio.get(`/api/socials/night?date=${date}&with=numbers`)).numbers;
  assert.deepEqual(n.goalOrder, { complete: games.length, of: games.length, missing: [] });
  assert.equal(n.leadChanges, 2 * games.length);
  assert.deepEqual(n.longestRun, { n: 3 + games.length - 1, team: games.at(-1).home.name });
  assert.equal(n.runs5, games.length - 1);
});
