// A game picked by hand in the moments after Studio starts stays picked by hand: the first automatic run (a new night,
// which turns automatic selection back on) leaves a pick made that night alone. Once, on a fast Mac, it turned it back
// on under the story test, and the test's goals went to the wrong game.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');
const { createWorld } = require('./support/playhq');

test('a game picked by hand before the first automatic run stays picked by hand', async t => {
  const world = createWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const past = world.games['game-d1-r2-1'];
  await studio.post('/api/scoreboard', { type: 'selectGame', game: { id: past.id, division: past.division, date: past.date, time: past.time,
    home: { name: past.home, score: 0 }, away: { name: past.away, score: 0 } } });
  // The first automatic run (3 seconds after Studio starts) sets tonight's court.
  await studio.until(() => /so Scoreboard control follows/.test(studio.log()), 10000, 100);
  await wait(300);
  const b = await studio.get('/api/scoreboard');
  assert.equal(b.autoSelect, false, 'automatic selection stays off');
  assert.equal(b.gameId, past.id, 'the hand pick stays on');
  assert.doesNotMatch(studio.log(), /A new night, so automatic game selection is on/);
});
