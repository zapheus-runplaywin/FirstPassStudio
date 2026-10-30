// The Commentary team picture: one a game, with that game's commentators side by side, their names at one size that keeps
// every word whole, and the game's time and teams once under the headshots. The Socials tab lists one for each called game.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('a Commentary team picture a game, with the game once under the headshots', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the commentary team in');
    t.skip('no browser to test the commentary team in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const pl = await studio.post('/api/planner/pool', { pool: [{ name: 'Sam Lee' }, { name: 'Alexandra Montgomery-Fitzwilliam', guest: true }, { name: 'Maximilian Papadopoulos' }] });
  const [sam, alex, max] = pl.pool.map(x => x.id);
  const times = [...new Set(pl.nights.find(x => x.date === studio.world.today).games.filter(g => g.court === 'Court 2').map(g => g.time))];
  assert.ok(times.length >= 2, 'two games on Court 2');
  // Sam calls both games: with the other two on the first, alone on the second.
  await studio.post('/api/planner/night', { date: studio.world.today, court: 'Court 2', slots: { [times[0]]: [sam, alex, max], [times[1]]: [sam] } });
  const slots = (await studio.get(`/api/socials/night?date=${studio.world.today}`)).stream.slots;
  assert.ok(slots.every(s => s.id), 'each game on the stream has its id');

  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const draw = async game => {
    await page.goto(`${studio.base}/social.html?kind=commentators&date=${studio.world.today}&game=${game.id}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    assert.equal(await page.evaluate(() => window.socialReady), true);
    return page.evaluate(() => ({
      names: [...document.querySelectorAll('.mic__name')].map(n => ({ text: n.textContent, size: getComputedStyle(n).fontSize,
        whole: [...n.querySelectorAll('span')].every(w => w.offsetWidth <= n.clientWidth + 1 && w.getClientRects().length === 1) })),
      tops: [...document.querySelectorAll('.mic__name')].map(n => Math.round(n.getBoundingClientRect().top)),
      games: [...document.querySelectorAll('.crew__game')].map(g => g.textContent),
    }));
  };
  const first = await draw(slots[0]);
  assert.deepEqual(first.names.map(n => n.text), ['Sam Lee', 'Alexandra Montgomery-Fitzwilliam', 'Maximilian Papadopoulos']);
  assert.equal(new Set(first.names.map(n => n.size)).size, 1, 'the names share one size');
  assert.ok(first.names.every(n => n.whole), 'no word is broken up');
  assert.equal(new Set(first.tops).size, 1, 'the names start on one line, the guest tag or not');
  assert.equal(first.games.length, 1, 'the game once');
  assert.ok(first.games[0].includes(`${slots[0].home.name} v ${slots[0].away.name}`));

  const second = await draw(slots[1]);
  assert.deepEqual(second.names.map(n => n.text), ['Sam Lee'], 'on each game they call');
  assert.ok(second.games[0].includes(`${slots[1].home.name} v ${slots[1].away.name}`));
});
