// A Socials picture's title stays on one line at every size, shrinking a little to fit beside the competition logo
// rather than wrapping a word onto a second line; Poster's stacked title on a portrait or Story is left as it is.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('the title stays on one line beside the logo at every size', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the titles in');
    t.skip('no browser to test the titles in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const SIZES = { square: 1080, portrait: 1350, story: 1920 };
  for (const template of ['default', 'thunder', 'hero', 'final', 'goal', 'poster']) {
    for (const [size, h] of Object.entries(SIZES)) {
      if (template === 'poster' && size !== 'square') continue; // stacked a word a line there, on purpose
      const page = await browser.newPage({ viewport: { width: 1080, height: h } });
      await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
      await page.goto(`${studio.base}/social.html?kind=onstream&size=${size}&template=${template}&title=${encodeURIComponent('On the stream tonight')}`);
      await page.waitForFunction(() => window.socialReady !== undefined);
      await page.evaluate(() => window.socialReady);
      const r = await page.evaluate(() => {
        const head = document.getElementById('head').getBoundingClientRect();
        const words = [...document.querySelectorAll('#title .w')].map(w => w.getBoundingClientRect());
        // A word on a line of its own starts below the first word (Final's script word rises and dips, but stays beside it).
        const below = words.filter(w => w.top >= words[0].bottom - 4).length;
        return { lines: 1 + below, right: Math.max(...words.map(w => w.right)), headRight: head.right };
      });
      assert.equal(r.lines, 1, `${template} ${size}: one line`);
      assert.ok(r.right <= r.headRight + 40, `${template} ${size}: inside the head (${r.right} of ${r.headRight})`);
      await page.close();
    }
  }
});
