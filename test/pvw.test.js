// Previews (the Output page's PVW button, the Docs page's Preview buttons) open pvw.html in a
// 960 x 540 window with the page laid out at 1920 x 1080 and scaled to half size.
// The browser: as in pages.test.js (Playwright's own, or STUDIO_TEST_CHROMIUM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('a Docs page preview opens at half size', async t => {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try { browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); }
    catch (err) { why = err.message.split('\n')[0]; }
  }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail(`no browser to test the pages in: ${why}`);
    t.skip(`no browser to test the pages in (${why}); run npx playwright install chromium`);
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));

  const page = await context.newPage();
  await page.goto(studio.base + '/graphics.html');
  const link = page.locator('a.pvw').first();
  await link.waitFor();
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await popup.waitForLoadState();
  assert.match(popup.url(), /\/pvw\.html\?src=/);
  const size = await popup.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  assert.deepEqual(size, { w: 960, h: 540 });
  const frame = await popup.evaluate(() => {
    const f = document.querySelector('#box iframe');
    return { w: f.offsetWidth, h: f.offsetHeight, transform: f.style.transform };
  });
  assert.deepEqual(frame, { w: 1920, h: 1080, transform: 'scale(0.5)' });
});
