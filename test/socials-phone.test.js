// The Socials tab on a phone: it fits the screen, Save hands the pictures to the phone (the Mac makes them), and the
// ones made show as pictures to press and hold and Add to Photos, with a Download link each, and their captions to copy.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

// A 1 x 1 PNG for the made pictures.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('on a phone the Socials tab fits the screen and Save brings the pictures to the phone', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Socials tab in');
    t.skip('no browser to test the Socials tab in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  // As a paired phone sees it: the Mac app is there, and the page isn't open on the Mac.
  await page.route(url => new URL(url).pathname === '/api/socials', async route => {
    const r = await route.fetch();
    route.fulfill({ response: r, json: { ...await r.json(), app: true, here: false } });
  });
  // A plain http .local link isn't a secure one, so the phone's browser has no share sheet for files.
  await page.addInitScript(() => { delete Navigator.prototype.canShare; delete Navigator.prototype.share; });
  let sent = null;
  await page.route(url => new URL(url).pathname === '/api/socials/export', route => {
    sent = JSON.parse(route.request().postData());
    route.fulfill({ json: { folder: null, files: ['01 Game night fixture (square).png'], skipped: [],
      zip: null, shared: false, made: { pictures: [{ name: '01 Game night fixture (square).png', url: '/api/socials/made/x/1' }], zip: null } } });
  });
  await page.route(url => new URL(url).pathname === '/api/socials/made/x/1', route => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.goto(`${studio.base}/socials.html`);
  await page.waitForSelector('.pic[data-key]');

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'nothing sticks out sideways');
  assert.equal(await page.textContent('#save'), 'Save to this device');
  assert.equal(await page.isHidden('#share'), true, 'no share sheet on a plain http link');

  await page.click('#none');
  await page.locator('.pic[data-key] .pic__ticks input:not([disabled])').first().check();
  // A caption typed for it comes back with the pictures, to copy into the post.
  const first = page.locator('.pic[data-key]:has(.pic__ticks input:not([disabled]))').first();
  await first.locator('.caption summary').click();
  await first.locator('.caption textarea').fill('Big night ahead!');
  await page.click('#save');
  await page.waitForSelector('#madeBox[open] img');
  assert.equal(sent.toDevice, true);
  assert.deepEqual(sent.captions.map(c => c.text), ['Big night ahead!']);
  assert.equal(await page.textContent('#madeBox .cap'), 'Big night ahead!');
  assert.equal(await page.getAttribute('#madeBox img', 'src'), '/api/socials/made/x/1');
  assert.equal(await page.getAttribute('#madeBox figcaption a', 'download'), '01 Game night fixture (square).png');
  assert.match(await page.textContent('#madeBox'), /Press and hold a picture, then Add to Photos/);
  const box = await page.locator('#madeBox').boundingBox();
  assert.ok(box.width <= 390 - 32 + 1, 'the list fits the phone');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.click('#madeBox button:text("Done")');
  assert.equal(await page.isHidden('#madeBox'), true);
  assert.equal(await page.isEnabled('#save'), true);
});
