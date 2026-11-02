// An output's canvas (scene.html?canvas=1, the canvas links on the Devices tab): another program's copy of what the
// Output page's preview of that output shows. It follows that output's sources, plays no sound unless ?sound=1, never
// opens the Mac's mics. In a 3840 x 2160 window (a 4K source) it's drawn at 2x, the pages inside at twice the density.
// The browser: as in pages.test.js (Playwright's own, or STUDIO_TEST_CHROMIUM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

async function launch(t) {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try { browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch (err) { why = err.message.split('\n')[0]; }
  }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail(`no browser to test the pages in: ${why}`);
    t.skip(`no browser to test the pages in (${why}); run npx playwright install chromium`);
    return null;
  }
  t.after(() => browser.close());
  return browser;
}

test('an output\'s canvas follows that output, is silent unless asked, never opens the mics, and is sharp in a 4K window', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  await act({ type: 'add', sources: [{ type: 'browser', name: 'Pattern', url: 'testpattern.html' }, { type: 'browser', name: 'Ladder', url: 'ladder.html' }] });
  await act({ type: 'micAdd', changes: { name: 'Court mic', device: '' } });
  const added = await studio.request('POST', '/api/outputs', { add: true });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  const two = (await studio.get('/api/outputs')).outputs[1].id;
  await act({ type: 'show', name: 'Pattern' });
  await act({ type: 'show', name: 'Ladder', output: two });

  const context = await browser.newContext({ viewport: { width: 3840, height: 2160 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const shown = page => page.evaluate(() => [...document.querySelectorAll('.layer.on')].map(l => l.querySelector('iframe').title).sort());

  // Output 1's canvas at 4K: its sources, drawn over the whole 3840 x 2160 at twice the density, with no sound or mics.
  const one = await context.newPage();
  await one.goto(`${studio.base}/scene.html?canvas=1`, { waitUntil: 'load' });
  await one.waitForFunction(() => document.querySelectorAll('.layer.on').length === 1, null, { timeout: 15000 });
  assert.deepEqual(await shown(one), ['Pattern']);
  assert.equal(await one.evaluate('studioZoom'), 2, 'laid out again at 2x, not stretched');
  const box = await one.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.width, r.height]; });
  assert.deepEqual(box, [3840, 2160]);
  const inner = one.frames().find(f => f.url().includes('testpattern.html'));
  assert.deepEqual(await inner.evaluate(() => [devicePixelRatio, innerWidth, innerHeight]), [2, 1920, 1080], 'the page keeps its 1920 x 1080 layout, drawn at 2x');
  assert.equal(await one.evaluate('silent'), true, 'silent by default');
  assert.equal(await one.evaluate('micsHere'), false, 'never opens the Mac\'s mics');

  // ?sound=1 plays the output's sound; ?output= follows that output's own sources.
  const loud = await context.newPage();
  await loud.goto(`${studio.base}/scene.html?canvas=1&sound=1&output=${two}`, { waitUntil: 'load' });
  await loud.waitForFunction(() => document.querySelectorAll('.layer.on').length === 1, null, { timeout: 15000 });
  assert.deepEqual(await shown(loud), ['Ladder']);
  assert.equal(await loud.evaluate('silent'), false);
  assert.equal(await loud.evaluate('micsHere'), false);

  // It follows the scene live, like the preview.
  await act({ type: 'hide', name: 'Pattern' });
  await one.waitForFunction(() => document.querySelectorAll('.layer.on').length === 0, null, { timeout: 15000 });
});

test('the Devices tab\'s Links gives the output canvas one link per output', async t => {
  const { openPage } = require('./support/browser');
  const studio = await startStudio(t);
  const added = await studio.request('POST', '/api/outputs', { add: true });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  const two = (await studio.get('/api/outputs')).outputs[1];
  const page = await openPage(t, studio, '/api.html');
  if (!page) return;
  const card = page.locator('#links-scene .lnk', { hasText: 'Output canvas' });
  await card.locator('.lnk__link').nth(1).waitFor();
  const rows = await card.locator('.lnk__link').evaluateAll(rs => rs.map(r => [r.querySelector('.lnk__label')?.textContent, r.querySelector('code').textContent]));
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], 'Output 1');
  assert.match(rows[0][1], /\/scene\.html\?canvas=1$/);
  assert.equal(rows[1][0], two.name);
  assert.ok(rows[1][1].endsWith(`/scene.html?canvas=1&output=${two.id}`), rows[1][1]);
  assert.deepEqual(page.errors, []);
});
