// The mics in the browser (scene.html, the Output page): only the primary output's own window opens them (never a
// Scene View or the key output), it mixes them at their levels and mutes, says what it hears, and says plainly when a
// device isn't plugged in. Chromium's stand-in microphone plays a beep.
// The browser: as in pages.test.js (Playwright's own, or STUDIO_TEST_CHROMIUM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

async function launch(t) {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try {
      browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined,
        args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    } catch (err) { why = err.message.split('\n')[0]; }
  }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail(`no browser to test the pages in: ${why}`);
    t.skip(`no browser to test the pages in (${why}); run npx playwright install chromium`);
    return null;
  }
  t.after(() => browser.close());
  return browser;
}

test('the primary output\'s window mixes the mics, a Scene View and the key never open them, and the Output page shows them', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.grantPermissions(['microphone'], { origin: studio.base });
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  const added = await act({ type: 'micAdd', changes: { name: 'Court mic', device: '' } });
  const id = added.mics.mics[0].id;

  const output = await context.newPage(), view = await context.newPage(), key = await context.newPage();
  await output.goto(`${studio.base}/scene.html?fit=1&bg=000000`, { waitUntil: 'load' });
  await view.goto(`${studio.base}/scene.html?mute=1`, { waitUntil: 'load' });
  await key.goto(`${studio.base}/scene.html?fit=1&mute=1&key=1`, { waitUntil: 'load' });

  // The output window opens the Mac's input and hears the beep.
  const heard = await studio.until(async () => { const l = await studio.get('/api/scene/mics/live'); return l.mixing && l.levels[id] > -60 && l; }, 15000);
  assert.ok(heard.levels[id] <= 0);
  assert.equal(await output.evaluate('micChains.size'), 1);
  assert.equal(await view.evaluate('micChains.size + micDevices.size'), 0, 'a Scene View never opens the mics');
  assert.equal(await key.evaluate('micChains.size + micDevices.size'), 0, 'nor does the key output');

  // Its level follows the mute and the level.
  const gain = () => output.evaluate(m => micChains.get(m).gain.gain.value, id);
  await output.waitForFunction(m => micChains.get(m).gain.gain.value > .9, id, { timeout: 5000 });
  await act({ type: 'micMute', mic: id, value: 'on' });
  await output.waitForFunction(m => micChains.get(m).gain.gain.value < .01, id, { timeout: 5000 });
  await act({ type: 'micMute', mic: id, value: 'off' });
  await act({ type: 'micsLevel', value: 50 });
  await output.waitForFunction(m => Math.abs(micChains.get(m).gain.gain.value - .5) < .02, id, { timeout: 5000 });
  // Dipped by hand to 30%: half of that.
  await act({ type: 'micsDip', value: 'on' });
  await output.waitForFunction(m => Math.abs(micChains.get(m).gain.gain.value - .15) < .02, id, { timeout: 8000 });
  await act({ type: 'micsDip', value: 'off' });
  assert.ok(await gain() < .5);

  // A device that isn't plugged in says so.
  await act({ type: 'micAdd', changes: { name: 'Crowd mic', device: 'Nowhere Wireless RX' } });
  const crowd = (await studio.get('/api/scene')).mics.mics[1].id;
  const missing = await studio.until(async () => (await studio.get('/api/scene/mics/live')).problems[crowd]);
  assert.match(missing, /Nowhere Wireless RX isn't plugged in/);

  // The Output page lists them, says Output 1 is off (so they aren't heard), and shows the trouble.
  const page = await context.newPage();
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#mxList [data-mic]').length === 2);
  assert.equal(await page.textContent('#mxList [data-mic] b'), 'Court mic');
  assert.match(await page.textContent('#mxHeard'), /Output 1 is off/);
  await page.click('#mxDip');
  await studio.until(async () => (await studio.get('/api/scene')).mics.hand);
  await page.click('#mxList [data-mic] .edit');
  assert.equal(await page.inputValue('#mxName'), 'Court mic');
  await page.fill('#mxName', 'Baseline mic');
  await page.click('#mxSave');
  await studio.until(async () => (await studio.get('/api/scene')).mics.mics[0].name === 'Baseline mic');
});
