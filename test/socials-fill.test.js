// A Socials picture fills its frame: a short ladder or a night's results grow into spare room (wider and taller, rows
// spread apart) without a name running out of a row it fits at the picture's own size, and a Story keeps its words and
// marks out of the top and bottom 200px, where Instagram draws its own bar and reply box.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('pictures grow into spare room, and a Story keeps clear of Instagram\'s bars', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the pictures in');
    t.skip('no browser to test the pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const date = (await studio.get('/api/socials')).nights[1].date;
  const SIZES = { square: 1080, portrait: 1350, story: 1920 };
  for (const [kind, extra] of [['results', ''], ['ladder', '&division=Division%201']]) {
    for (const [size, h] of Object.entries(SIZES)) {
      const page = await browser.newPage({ viewport: { width: 1080, height: h } });
      await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
      await page.goto(`${studio.base}/social.html?kind=${kind}&size=${size}&date=${date}${extra}`);
      await page.waitForFunction(() => window.socialReady !== undefined);
      await page.evaluate(() => window.socialReady);
      const r = await page.evaluate(() => {
        const fit = document.getElementById('fit'), body = document.getElementById('body').getBoundingClientRect();
        const box = fit.getBoundingClientRect();
        // Anything running out of its box that doesn't at the picture's own size (grown back after looking).
        const spills = () => [...fit.querySelectorAll('*')].map(e => (e.clientWidth ? e.scrollWidth - e.clientWidth : 0));
        const grown = spills(), was = [fit.style.scale, fit.style.width, fit.style.alignSelf, fit.style.getPropertyValue('--spread')];
        fit.style.scale = ''; fit.style.width = ''; fit.style.alignSelf = ''; fit.style.removeProperty('--spread');
        const own = spills();
        [fit.style.scale, fit.style.width, fit.style.alignSelf] = was; fit.style.setProperty('--spread', was[3]);
        const spilt = [...fit.querySelectorAll('*')].filter((e, i) => grown[i] > own[i] + 1).map(e => e.className);
        return { scale: Number(fit.style.scale || 1), spread: parseFloat(fit.style.getPropertyValue('--spread')) || 0,
          top: box.top, bottom: box.bottom, left: box.left, right: box.right, body: { top: body.top, bottom: body.bottom },
          head: document.getElementById('head').getBoundingClientRect().top,
          foot: document.getElementById('foot').getBoundingClientRect().bottom, spilt };
      });
      const at = `${kind} ${size}`;
      assert.ok(r.scale > 1 || r.spread > 0, `${at}: grows into the room (scale ${r.scale}, spread ${r.spread})`);
      assert.deepEqual(r.spilt, [], `${at}: nothing runs out of its box`);
      assert.ok(r.left >= 0 && r.right <= 1080, `${at}: inside the picture across`);
      assert.ok(r.top >= r.body.top - 2 && r.bottom <= r.body.bottom + 2, `${at}: between the head and the foot`);
      if (size === 'story') {
        assert.ok(r.head >= 200, `${at}: the head starts below Instagram's bar (${r.head})`);
        assert.ok(r.foot <= h - 200 + 1, `${at}: the foot ends above the reply box (${r.foot})`);
      }
      await page.close();
    }
  }
});
