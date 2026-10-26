// The Output page's Hide all with more than one output: it clears the output picked over the Scene View (where
// scene and sequence clicks go) and says which on the button, never every output at once, so clearing a
// commentary monitor can't blank the output on air.
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

test('Hide all clears only the output picked over the Scene View, and says which', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  const r = await studio.request('POST', '/api/outputs', { add: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const two = (await studio.get('/api/outputs')).outputs[1];
  const act = async a => { const res = await studio.request('POST', '/api/scene', a); assert.equal(res.status, 200, JSON.stringify(res.json)); };
  await act({ type: 'add', sources: [{ type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' }] });
  await act({ type: 'show', name: 'Scoreboard' });
  await act({ type: 'show', name: 'Scoreboard', output: two.id });
  const where = async () => { const s = (await studio.get('/api/scene')).sources.find(x => x.name === 'Scoreboard'); return { one: s.visible, two: !!s.out[two.id] }; };

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const page = await context.newPage();
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  // The Sources list's Show filter on All outputs, as in the review: still only the picked output is cleared.
  await page.waitForFunction(() => document.getElementById('hideAll').textContent === 'Hide all on Output 1');
  assert.equal(await page.$eval('#outFilter', e => e.value), 'all');

  await page.click(`.outTab:has-text("${two.name}")`);
  await page.waitForFunction(n => document.getElementById('hideAll').textContent === `Hide all on ${n}`, two.name);
  await page.click('#hideAll');
  await studio.until(async () => !(await where()).two);
  assert.deepEqual(await where(), { one: true, two: false }, 'Output 1 is still showing it');

  await page.click('.outTab:has-text("Output 1")');
  await page.waitForFunction(() => document.getElementById('hideAll').textContent === 'Hide all on Output 1');
  await page.click('#hideAll');
  await studio.until(async () => !(await where()).one);
  assert.deepEqual(await where(), { one: false, two: false });
});
