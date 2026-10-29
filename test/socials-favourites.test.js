// The Socials tab's favourite templates: a star on each template set marks it a favourite, and Favourites only lists
// just those (with the one in use), remembered for the competition. With none starred, the tick lists them all.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('a star makes a template a favourite, and Favourites only lists just those', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Socials tab in');
    t.skip('no browser to test the Socials tab in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${studio.base}/socials.html`);
  await page.waitForSelector('#templates .set');
  const listed = () => page.$$eval('#templates .set', bs => bs.map(b => b.firstChild.textContent));
  const all = await listed();
  assert.equal(all.length, 22);

  // Ticking with nothing starred still lists every set.
  await page.click('.favonly input');
  await page.waitForFunction(() => document.querySelector('.favonly input').checked);
  assert.deepEqual(await listed(), all);
  await page.click('.favonly input');
  await page.waitForFunction(() => !document.querySelector('.favonly input').checked);

  // Star two (the star doesn't pick the set), tick, and the list narrows to them and the one in use.
  for (const name of ['Stadium', 'Court']) {
    await page.click(`#templates .set:has-text("${name}") .star`);
    await page.waitForSelector(`#templates .set:has-text("${name}") .star.on`);
  }
  await page.click('.favonly input');
  await page.waitForFunction(() => document.querySelectorAll('#templates .set').length === 3);
  assert.deepEqual(await listed(), ['Default', 'Court', 'Stadium']);
  assert.equal(await page.$eval('#templates [aria-pressed="true"]', b => b.firstChild.textContent), 'Default', 'still Default');
  assert.deepEqual((await studio.get('/api/socials')).settings.favourites, ['court', 'stadium'], 'saved');

  // Picking a favourite drops Default from the narrowed list; unticking lists them all again.
  await page.click('#templates .set:has-text("Court")');
  await page.waitForFunction(() => document.querySelectorAll('#templates .set').length === 2);
  assert.deepEqual(await listed(), ['Court', 'Stadium']);
  await page.click('.favonly input');
  await page.waitForFunction(() => document.querySelectorAll('#templates .set').length === 22);
  assert.equal(await page.$$eval('#templates .star.on', s => s.length), 2, 'still starred');
});
