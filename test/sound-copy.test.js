// Also send the sound to (outputs.js copySound, desktop/soundcopy.js, scene.html?copy=1): an output's sound sent to
// one more of the Mac's sound outputs too, such as the commentators' mixer, with only the mics ticked for it. The Mac
// app opens the copy only while its output is on; the copy's window finds the device by name and plays everything
// there (never on the Mac's own speakers), opens only its own mics, and says how it's doing for the Output page.
// The browser: as in mics-mixing.test.js (Chromium's stand-in devices: Fake Audio Output 1 and 2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('a copy is sent only while its output is on, with its mics, and says how it is doing', () => {
  process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sound-copy-'));
  const outputs = require('../outputs');
  const logged = [];
  outputs.init((level, area, text) => logged.push(text));
  outputs.message({ type: 'displays', displays: [{ id: 1, label: 'Built-in', primary: true }, { id: 2, label: 'HDMI' }] });
  const main = () => outputs.state().outputs[0];

  assert.equal(main().copySound, '', 'nowhere else to start with');
  assert.deepEqual(main().copyMics, []);
  assert.equal(outputs.apply({ copySound: '  PodTrak P8\n', copyMics: ['abc', 'abc', 'd-e f', ''] }), null);
  assert.equal(main().copySound, 'PodTrak P8');
  assert.deepEqual(main().copyMics, ['abc', 'def'], 'mic ids, once each');
  assert.deepEqual(outputs.copies(), [], 'Output 1 is off: no copy');
  assert.equal(main().copy.state, 'off');

  outputs.apply({ mode: 'chroma', chromaDisplay: '2', on: true });
  assert.deepEqual(outputs.copies(), [{ output: 'main', device: 'PodTrak P8', mics: ['abc', 'def'] }]);
  assert.equal(main().copy.state, 'waiting', 'nothing heard from its window yet');

  const r = { send: (res, code, body) => Object.assign(res, { code, body }) };
  const post = body => outputs.route({ method: 'POST' }, {}, new URL('http://x/api/outputs/copy'), { ...r, readBody: async () => body });
  return (async () => {
    await post({ output: 'main', device: 'PodTrak P8', error: '' });
    assert.equal(main().copy.state, 'sending');
    assert.match(logged.join('\n'), /Output 1's sound also goes to PodTrak P8/);
    await post({ output: 'main', device: 'PodTrak P8', error: 'PodTrak P8 isn\'t plugged in' });
    assert.deepEqual(main().copy, { state: 'problem', error: 'PodTrak P8 isn\'t plugged in' });
    // Changed to another device: waiting for the window to find it.
    outputs.apply({ copySound: 'RODECaster Pro II' });
    assert.equal(main().copy.state, 'waiting');
    // Off again: no copy, and nowhere else stops it too.
    outputs.apply({ on: false });
    assert.deepEqual(outputs.copies(), []);
    outputs.apply({ on: true, copySound: '' });
    assert.deepEqual(outputs.copies(), []);
    assert.equal(main().copy.state, 'off');
  })();
});

test('the copy\'s window plays to its device only, opens only its own mics and says so; the Output page sets it', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.grantPermissions(['microphone'], { origin: studio.base });
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  await act({ type: 'micAdd', changes: { name: 'Commentator mic', device: '' } });
  const crowd = (await act({ type: 'micAdd', changes: { name: 'Crowd mic', device: 'Fake Audio Input 1' } })).mics.mics[1].id;

  // A device that isn't there: it says so and plays nothing (not on the Mac's speakers either).
  const lost = await context.newPage();
  await lost.goto(`${studio.base}/scene.html?copy=1&sink=${encodeURIComponent('Mixer that is not here')}&mics=${crowd}`, { waitUntil: 'load' });
  await lost.waitForFunction(() => copyError, null, { timeout: 10000 });
  assert.match(await lost.evaluate('copyError'), /Mixer that is not here isn't plugged in/);
  assert.equal(await lost.evaluate('silent && sinkId === null && micDevices.size === 0'), true, 'silent until its device is found');
  await lost.close();

  // Found: every player goes to the device, and only the ticked mic (the crowd) is opened, to the same device.
  const copy = await context.newPage();
  await copy.goto(`${studio.base}/scene.html?copy=1&sink=${encodeURIComponent('Fake Audio Output 1')}&mics=${crowd}`, { waitUntil: 'load' });
  await copy.waitForFunction(() => sinkId && !silent, null, { timeout: 10000 });
  const sink = await copy.evaluate('sinkId');
  assert.equal(await copy.evaluate('audio.sinkId === sinkId && tail.sinkId === sinkId'), true, 'the music plays to the device');
  await copy.waitForFunction(id => micChains.size === 1 && micChains.has(id), crowd, { timeout: 15000 });
  assert.equal(await copy.evaluate('micCtx.sinkId'), sink, 'the mics play to the device too');
  // It never tells Studio what the mics hear: the output's own window does.
  assert.equal((await studio.get('/api/scene/mics/live')).mixing, false);

  // The Output page in the app lists the Mac's sound outputs, and picking one and a mic saves them.
  await studio.request('POST', '/api/outputs', { mode: 'chroma' });
  const page = await context.newPage();
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('#outCopy option')].some(o => o.value === 'Fake Audio Output 2'), null, { timeout: 10000 });
  await page.evaluate(() => { const s = document.querySelector('#outCopy'); s.value = 'Fake Audio Output 2'; s.dispatchEvent(new Event('change')); });
  await studio.until(async () => (await studio.get('/api/outputs')).copySound === 'Fake Audio Output 2');
  await page.waitForFunction(() => document.querySelectorAll('#outCopyMics input').length === 2, null, { timeout: 5000 });
  await page.evaluate(() => { const c = document.querySelectorAll('#outCopyMics input')[1]; c.checked = true; c.dispatchEvent(new Event('change')); });
  await studio.until(async () => (await studio.get('/api/outputs')).copyMics.join() === crowd);
  assert.match(await page.textContent('#outCopyStatus'), /Starts when this output is on/);
});
