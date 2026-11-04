// Sound goes to (outputs.js sound, desktop/soundcopy.js, scene.html?copy=1): where an output's sound plays. The first
// destination is the output's own route; a destination that is one of the Mac's sound outputs by name, such as the
// commentators' mixer, is a sound copy with only the mics ticked for it. The Mac app opens a copy only while its
// output is on; the copy's window finds the device by name and plays everything there (never on the Mac's own
// speakers), opens only its own mics, and says how it's doing for the Output page.
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

test('the first destination is the output\'s own route; a named one is a copy sent only while the output is on, with its mics, that says how it is doing', () => {
  process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sound-copy-'));
  // Saved before Sound goes to was a list: Sound (in the SDI and on the Mac) and Also send the sound to become it.
  fs.writeFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'outputs.json'), JSON.stringify({ outputs: [
    { id: 'main', slot: 1, name: 'Output 1', mode: 'decklink', decklinkSound: 'both', copySound: 'PodTrak P8', copyMics: ['abc'] }] }));
  const outputs = require('../outputs');
  const logged = [];
  outputs.init((level, area, text) => logged.push(text));
  outputs.message({ type: 'displays', displays: [{ id: 1, label: 'Built-in', primary: true }, { id: 2, label: 'HDMI' }] });
  const main = () => outputs.state().outputs[0];
  assert.deepEqual(main().sound, [{ device: 'own', mics: [] }, { device: 'mac', mics: [] }, { device: 'PodTrak P8', mics: ['abc'] }], 'the older settings as one list');

  assert.equal(outputs.apply({ sound: [{ device: 'own' }, { device: '  PodTrak P8\n', mics: ['abc', 'abc', 'd-e f', ''] }, { device: 'PodTrak P8' }] }), null);
  assert.deepEqual(main().sound, [{ device: 'own', mics: [] }, { device: 'PodTrak P8', mics: ['abc', 'def'] }], 'mic ids once each; a device once');
  assert.deepEqual(outputs.copies(), [], 'Output 1 is off: no copy');
  assert.deepEqual(main().soundState.map(s => s.state), ['off', 'off']);

  outputs.apply({ mode: 'chroma', chromaDisplay: '2', on: true });
  assert.equal(outputs.windows()[0].sound, 'mac', 'its own window plays to the Mac\'s sound output');
  assert.deepEqual(outputs.copies(), [{ output: 'main', device: 'PodTrak P8', mics: ['abc', 'def'], main: false }]);
  assert.deepEqual(main().soundState.map(s => s.state), ['sending', 'waiting'], 'nothing heard from the copy\'s window yet');

  const r = { send: (res, code, body) => Object.assign(res, { code, body }) };
  const post = body => outputs.route({ method: 'POST' }, {}, new URL('http://x/api/outputs/copy'), { ...r, readBody: async () => body });
  return (async () => {
    await post({ output: 'main', device: 'PodTrak P8', error: '' });
    assert.equal(main().soundState[1].state, 'sending');
    assert.match(logged.join('\n'), /Output 1's sound goes to PodTrak P8/);
    await post({ output: 'main', device: 'PodTrak P8', error: 'PodTrak P8 isn\'t plugged in' });
    assert.deepEqual(main().soundState[1], { device: 'PodTrak P8', mics: ['abc', 'def'], state: 'problem', error: 'PodTrak P8 isn\'t plugged in' });
    // Changed to another device: waiting for the window to find it.
    outputs.apply({ sound: [{ device: 'own' }, { device: 'RODECaster Pro II' }] });
    assert.equal(main().soundState[1].state, 'waiting');
    // The mixer as the only destination: the output's own window is muted, and the copy carries every mic and reports them.
    outputs.apply({ sound: [{ device: 'RODECaster Pro II' }] });
    assert.equal(outputs.windows()[0].sound, 'none');
    assert.deepEqual(outputs.copies(), [{ output: 'main', device: 'RODECaster Pro II', mics: 'all', main: true }]);
    // Off again: no copy. Nothing given goes back to the output's own route.
    outputs.apply({ on: false });
    assert.deepEqual(outputs.copies(), []);
    outputs.apply({ on: true, sound: [] });
    assert.deepEqual(main().sound, [{ device: 'own', mics: [] }]);
    assert.deepEqual(outputs.copies(), []);
    assert.equal(main().soundState[0].state, 'sending');
    // Another output never carries the mics, whatever its destinations.
    outputs.apply({ add: true });
    const two = outputs.state().outputs[1].id;
    outputs.apply({ output: two, mode: 'chroma', chromaDisplay: '1', on: true, sound: [{ device: 'PodTrak P8', mics: ['abc'] }, { device: 'Mixer', mics: ['abc'] }] });
    assert.deepEqual(outputs.copies(), [{ output: two, device: 'PodTrak P8', mics: [], main: true }, { output: two, device: 'Mixer', mics: [], main: false }]);
  })();
});

test('the copy\'s window plays to its device only, opens only its own mics (or every mic as the main destination) and says so; the Output page sets it', async t => {
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
  await copy.close();

  // As the output's main destination (?mics=all&main=1): every mic, and it reports their meters, since the own window is muted.
  const main = await context.newPage();
  await main.goto(`${studio.base}/scene.html?copy=1&sink=${encodeURIComponent('Fake Audio Output 1')}&mics=all&main=1`, { waitUntil: 'load' });
  await main.waitForFunction(() => sinkId && !silent && micChains.size === 2, null, { timeout: 15000 });
  await studio.until(async () => (await studio.get('/api/scene/mics/live')).mixing, 15000);
  await main.close();

  // The Output page in the app lists the Mac's sound outputs: Add a destination takes the first spare one, and a mic can be ticked for it.
  await studio.request('POST', '/api/outputs', { mode: 'chroma' });
  const page = await context.newPage();
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('#outSound select')].length === 1 && !document.getElementById('outSoundAdd').disabled, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => document.querySelector('#outSound select').value), 'own');
  await page.evaluate(() => document.getElementById('outSoundAdd').click());
  await studio.until(async () => (await studio.get('/api/outputs')).sound[1]?.device === 'Fake Audio Output 1');
  await page.waitForFunction(() => document.querySelectorAll('#outSound .soundDest:nth-child(2) input').length === 2, null, { timeout: 5000 });
  await page.evaluate(() => { const c = document.querySelectorAll('#outSound .soundDest:nth-child(2) input')[1]; c.checked = true; c.dispatchEvent(new Event('change')); });
  await studio.until(async () => (await studio.get('/api/outputs')).sound[1].mics.join() === crowd);
  assert.match(await page.textContent('#outSound .soundDest:nth-child(2) .sdStatus'), /Starts when this output is on/);
  // Its device can be changed to the other one, and the first destination lists the Mac's sound output only (no SDI: not a Blackmagic output).
  await page.evaluate(() => { const s = document.querySelectorAll('#outSound select')[1]; s.value = 'Fake Audio Output 2'; s.dispatchEvent(new Event('change')); });
  await studio.until(async () => (await studio.get('/api/outputs')).sound[1].device === 'Fake Audio Output 2');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#outSound select')[0].options].map(o => o.value).slice(0, 2)), ['own', 'Fake Audio Output 1']);
  // Removed: back to the one.
  await page.evaluate(() => document.querySelector('#outSound .soundDest:nth-child(2) button').click());
  await studio.until(async () => (await studio.get('/api/outputs')).sound.length === 1);
});

// 3 Nov: an AD's sound reached the SDI but not the commentators' mixer. The copy had played videos through a sound-only
// player, which stayed silent on the Mac for that file; it now plays them as the output does, in a video element.
test('the copy plays a video\'s sound the way the output does, to its device, and from the start when it was already on', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'clip-sound.webm'), path.join(studio.dataDir, 'media', 'Ad.webm'));
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.grantPermissions(['microphone'], { origin: studio.base });
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  const id = (await act({ type: 'add', sources: [{ type: 'video', name: 'Ad', file: 'Ad.webm', sound: true, loop: true }] })).sources[0].id;
  const playing = page => page.waitForFunction(() => [...layers.values()].some(L => {
    const v = L.el.querySelector('video');
    return v && v.tagName === 'VIDEO' && !v.paused && !v.muted && v.currentTime > 0.3 && v.sinkId === sinkId;
  }), null, { timeout: 10000 }).catch(async err => {
    console.log(await page.evaluate(() => [...layers.values()].map(L => { const v = L.el.querySelector('video'); return v && { tag: v.tagName, paused: v.paused, muted: v.muted, t: v.currentTime, sink: v.sinkId, want: sinkId, err: v.error && v.error.message, vis: L.src.visible }; })));
    throw err;
  });

  // Shown after the copy found its device.
  const copy = await context.newPage();
  await copy.goto(`${studio.base}/scene.html?copy=1&sink=${encodeURIComponent('Fake Audio Output 1')}`, { waitUntil: 'load' });
  await copy.waitForFunction(() => sinkId && !silent, null, { timeout: 10000 });
  await act({ type: 'show', id });
  await playing(copy);
  // It says how loud it plays and what its device plays at, for the status board's Sound out (heard from a copy of
  // the video's sound, so the video plays on as it was).
  await studio.until(async () => {
    const l = (await studio.get('/api/outputs/sound')).levels['main|Fake Audio Output 1'];
    return l && l.peak[0] > 0.01 && l.rate > 0 && l.channels > 0;
  }, 10000);
  await playing(copy);

  // Already on when a copy opens (the output turned on part way through): it isn't left muted while it loads.
  const late = await context.newPage();
  await late.goto(`${studio.base}/scene.html?copy=1&sink=${encodeURIComponent('Fake Audio Output 2')}`, { waitUntil: 'load' });
  await playing(late);
  assert.doesNotMatch(studio.log(), /Sound copy: "Ad" isn't playing/);
});
