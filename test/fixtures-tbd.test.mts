// Next week's round before PlayHQ has its games: a grand final waits on tonight's qualifiers, so
// PlayHQ lists the round with no games. The fixture page shows that week's finals from the finals
// format (time and court TBC, undecided teams as "Winner ..."), and "teams to be decided" otherwise.
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, type Studio, type Json } from './support/studio.mts';
import { createWorld } from './support/playhq.mts';

const require = createRequire(import.meta.url);

let studio: Studio;
test.before(async () => {
  const world = createWorld();
  // Division 2 plays its first finals tonight; next week's finals round has no games yet.
  Object.assign(world.divisions[1].rounds[2], { name: 'Finals Round 1', number: 1 });
  Object.assign(world.divisions[1].rounds[3], { name: 'Finals Round 2', number: 2, games: [] });
  // Division 1's next round has no games yet either, and it isn't a finals round.
  world.divisions[0].rounds[3].games = [];
  studio = await startStudio(null, { competition: 'Thunder League', world });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
});
test.after(() => studio && studio.stop());

const get = (p: Json) => studio.get(p);

test('a finals round with no games in PlayHQ shows that week\'s finals from the finals format', async () => {
  const f = await get('/api/fixtures?round=%2B1&division=2');
  assert.equal(f.round, 'Finals Round 2');
  assert.equal(f.games.length, 1, 'the Page system\'s second week is the preliminary final');
  const g = f.games[0];
  assert.equal(g.toBeDecided, true);
  assert.equal(g.name, 'Preliminary final');
  assert.equal(g.time, '');
  assert.equal(g.court, '');
  assert.equal(g.round, 'Finals Round 2');
  assert.ok(g.home.placeholder && /major semi final/i.test(g.home.name), g.home.name);
  assert.ok(g.away.placeholder && /minor semi final/i.test(g.away.name), g.away.name);
  assert.deepEqual(f.waiting, []);
});

test('another round with no games is listed as waiting, and results never make up games', async () => {
  const f = await get('/api/fixtures?round=next');
  assert.deepEqual(f.waiting, [{ division: 'Division 1', round: 'Round 4' }]);
  assert.ok(f.games.every((g: Json) => g.division === 'Division 2' && g.toBeDecided));
  const r = await get('/api/fixtures?round=next&results=1');
  assert.deepEqual(r.games, []);
});

test('the page says the teams are to be decided instead of "No games found"', async t => {
  let chromium = null;
  try { ({ chromium } = require('playwright')); } catch { /* not installed */ }
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); }
  catch (err) { t.skip(`no browser (${(err as Error).message.split('\n')[0]})`); return; }
  if (!browser) { t.skip('playwright is not installed'); return; }
  try {
    const page = await browser.newPage();
    await page.goto(`${studio.base}/fixtures.html?round=next`);
    await page.waitForSelector('.fixture');
    const text = await page.locator('#list').innerText();
    assert.match(text, /Division 1 Round 4: teams to be decided/i);
    assert.match(text, /TBC/);
    assert.match(text, /Finals Round 2\s+·\s+Preliminary final/i, 'the round has a line of its own');
    assert.doesNotMatch(text, /No games found/);
    // An undecided team's name wraps rather than being cut off.
    const cut = await page.$$eval('.fixture__name--tbd', (els: Json) => els.filter((e: Json) => e.scrollWidth > e.clientWidth + 1).map((e: Json) => e.textContent));
    assert.deepEqual(cut, []);
    // VS sits on the centre line, under the heading.
    const mid = await page.evaluate(() => { const c = (r: Json) => { const b = document.querySelector(r).getBoundingClientRect(); return b.left + b.width / 2; }; return [c('.fixture__vs'), c('#round')]; });
    assert.ok(Math.abs(mid[0] - mid[1]) < 2, `VS at ${mid[0]}, heading at ${mid[1]}`);
  } finally { await browser.close(); }
});
