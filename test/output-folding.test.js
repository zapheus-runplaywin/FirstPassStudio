// The Output page's sections fold down to their header rows, and stay folded after the page is opened again (so on the
// next launch too): the Media folder starts folded, a link to #mediaSection opens it, and buttons in a folded section's
// header row (Output on) stay in reach. Long explanations wait behind Expand for info.
// The browser: as in pages.test.js (Playwright's own, or STUDIO_TEST_CHROMIUM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

async function launch(t) {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try { browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); }
    catch (err) { why = err.message.split('\n')[0]; }
  }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail(`no browser to test the pages in: ${why}`);
    t.skip(`no browser to test the pages in (${why}); run npx playwright install chromium`);
    return null;
  }
  t.after(() => browser.close());
  return browser;
}

test('Output page sections fold, stay folded when the page opens again, and keep their header buttons', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const page = await context.newPage();
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });

  // At first every section is open but the Media folder.
  const folded = () => page.$$eval('section[data-fold]', s => s.filter(x => x.classList.contains('folded')).map(x => x.dataset.fold));
  assert.deepEqual(await folded(), ['media']);
  assert.equal(await page.isVisible('#mediaList'), false);
  // The switcher's set-up waits behind Set up.
  assert.equal(await page.isVisible('#swAddress'), false);
  await page.click('#swSetup');
  assert.equal(await page.isVisible('#swAddress'), true);

  // Fold Music (its arrow) and Output settings (its title, once Settings over the picture has opened the drawer);
  // Output on stays in reach, the player doesn't show.
  await page.click('#musicSection button.fold');
  await page.click('#outCfg');
  await page.click('#outSection h2');
  assert.deepEqual(await folded(), ['output', 'music', 'media']);
  assert.equal(await page.isVisible('#mPlay'), false);
  assert.equal(await page.isVisible('#outOn'), true);
  assert.equal(await page.getAttribute('#musicSection button.fold', 'aria-expanded'), 'false');

  // Open again: the same sections are folded. Opening the Media folder loads its list.
  await page.reload({ waitUntil: 'load' });
  assert.deepEqual(await folded(), ['output', 'music', 'media']);
  await page.click('#mediaSection button.fold');
  await page.waitForSelector('#mediaList li');
  await page.click('#musicSection h2');
  assert.equal(await page.isVisible('#mPlay'), true);
  await page.reload({ waitUntil: 'load' });
  assert.deepEqual(await folded(), ['output']);

  // A folded Media folder opens for a link to it (the Sponsors page's), without changing what's remembered.
  await page.click('#mediaSection button.fold');
  await page.goto(`${studio.base}/output.html#mediaSection`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.isVisible('#mediaKind'), true);
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  assert.deepEqual(await folded(), ['output', 'media']);
});
