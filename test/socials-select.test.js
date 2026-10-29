// The Socials tab's Select all and Select none: they tick or untick every picture the night can make at once, and
// leave a picture that can't be made yet (no plan for On the stream, say) unticked.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('Select all and Select none tick and untick every picture', async t => {
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
  await page.waitForSelector('.pic[data-key]');
  // Each picture's "Save this one" tick.
  const ticks = () => page.$$eval('.pic[data-key]', ss => ss.map(s => s.querySelector('.pic__ticks input')).map(c => ({ on: c.checked, can: !c.disabled })));

  await page.click('#none');
  const none = await ticks();
  assert.ok(none.length > 3);
  assert.ok(none.every(c => !c.on), 'every picture unticked');
  assert.equal(await page.$$eval('.pic:not(.off)', s => s.length), 0, 'and greyed out');

  await page.click('#all');
  const all = await ticks();
  assert.ok(all.filter(c => c.can).every(c => c.on), 'every picture that can be made is ticked');
  assert.ok(all.some(c => !c.can), 'the stand-in night has a picture that can\'t be made yet');
  assert.ok(all.filter(c => !c.can).every(c => !c.on), 'which stays unticked');
});
