// Operator journeys on the Output page's Switcher section, against the stand-in ATEM (test/support/atem.js):
// what an operator clicks on stream night, and what the switcher and the page then show. The browser: see
// test/support/browser.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');
const { startAtem } = require('./support/atem');
const { openPage } = require('./support/browser');

// The input buttons as the page draws them: [name, 'prg' | 'pvw' | ''].
const tally = page => page.$$eval('#swInputs button', bs => bs.map(b => [b.textContent, b.className]));
// Waits until the page's input buttons show this program and preview input (by name).
const shows = (page, program, preview) => page.waitForFunction(([p, v]) => {
  const b = [...document.querySelectorAll('#swInputs button')];
  return b.some(x => x.textContent === p && x.className === 'prg') && b.some(x => x.textContent === v && x.className === 'pvw');
}, [program, preview], { timeout: 5000 });
const text = (page, sel) => page.textContent(sel);

async function setUp(t, opts = {}) {
  const atem = await startAtem({ model: 'MiniExtreme', names: ['Court', 'Bench', 'Wide', 'Crowd'], ...opts });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/output.html');
  return { atem, studio, page };
}

// Set up on the Output page by its address, as the first time at a venue.
async function useAddress(page, atem) {
  await page.click('#swSetup');
  await page.fill('#swAddress', `127.0.0.1:${atem.port}`);
  await page.click('#swUseAddress');
  await page.waitForFunction(() => /connected/.test(document.querySelector('#swText').textContent), null, { timeout: 10000 });
}

test('setting up the switcher by its address: its model, inputs by name, and program and preview in tally colours', async t => {
  const { atem, page } = await setUp(t);
  if (!page) return;
  assert.equal(await text(page, '#swText'), 'Not set up');
  assert.equal(await page.isVisible('#swLive'), false);
  await useAddress(page, atem);
  assert.equal(await text(page, '#swText'), 'ATEM Mini Extreme connected');
  assert.equal(await text(page, '#swHas'), '8 inputs, 4 upstream keys, 2 downstream keys');
  const t0 = await tally(page);
  assert.deepEqual(t0.slice(0, 4), [['Court', 'prg'], ['Bench', 'pvw'], ['Wide', ''], ['Crowd', '']]);
  assert.equal(await page.isVisible('#swRetry'), false);
  // Done closes the form; the address stays filled in for next time.
  await page.click('#swSetup');
  assert.equal(await page.isVisible('#swForm'), false);
  assert.equal(await text(page, '#swSetup'), 'Change');
  assert.deepEqual(page.errors, []);
});

test('picking the next camera and cutting to it from the page, then a cut on the switcher itself shows straight away', async t => {
  const { atem, page } = await setUp(t);
  if (!page) return;
  await useAddress(page, atem);
  // Wide on preview, then Cut: Wide is on program and Court comes to preview, as on the switcher.
  await page.click('#swInputs button:has-text("Wide")');
  await shows(page, 'Court', 'Wide');
  assert.equal(atem.state.preview, 3);
  await page.click('#swCut');
  await shows(page, 'Wide', 'Court');
  assert.equal(atem.state.program, 3);
  // Auto does the same with the switcher's transition.
  await page.click('#swAuto');
  await shows(page, 'Court', 'Wide');
  assert.equal(atem.state.program, 1);
  // Someone presses Crowd on the switcher's own panel: the page follows without a click.
  atem.set({ program: 4, preview: 2 });
  await shows(page, 'Crowd', 'Bench');
  // A program input's button says it's on program rather than offering to preview it.
  assert.equal(await page.getAttribute('#swInputs button:has-text("Crowd")', 'title'), 'Crowd is on program');
  assert.deepEqual(page.errors, []);
});

test('keys and fade to black from the page: each button lights while its key is on air', async t => {
  const { atem, page } = await setUp(t);
  if (!page) return;
  await useAddress(page, atem);
  assert.deepEqual(await page.$$eval('#swUsk button', bs => bs.map(b => b.textContent)), ['Key 1', 'Key 2', 'Key 3', 'Key 4']);
  await page.click('#swUsk button:has-text("Key 2")');
  await page.waitForSelector('#swUsk button.on:has-text("Key 2")', { timeout: 5000 });
  assert.deepEqual(atem.state.usk, [false, true, false, false]);
  await page.click('#swUsk button:has-text("Key 2")');
  await page.waitForSelector('#swUsk button:not(.on):has-text("Key 2")', { timeout: 5000 });
  assert.deepEqual(atem.state.usk, [false, false, false, false]);
  // DSK 1 on with a cut, DSK 2 with its Auto.
  await page.click('#swDsk button:has-text("DSK 1")');
  await page.waitForSelector('#swDsk button.on:has-text("DSK 1")', { timeout: 5000 });
  await page.click('#swDsk button.alt >> nth=1');
  await page.waitForSelector('#swDsk button.on:has-text("DSK 2")', { timeout: 5000 });
  assert.deepEqual(atem.state.dsk, [true, true]);
  // Fade to black and back.
  await page.click('#swFtb');
  await page.waitForFunction(() => document.querySelector('#swFtb').textContent === 'Faded to black', null, { timeout: 5000 });
  assert.equal(atem.state.ftb, true);
  assert.match(await text(page, '#swHas'), /faded to black/);
  await page.click('#swFtb');
  await page.waitForFunction(() => document.querySelector('#swFtb').textContent === 'Fade to black', null, { timeout: 5000 });
  assert.equal(atem.state.ftb, false);
  assert.deepEqual(page.errors, []);
});

test('the switcher\'s cable pulled mid-stream: the page says so within seconds, then carries on by itself when it\'s back', async t => {
  const { atem, page } = await setUp(t);
  if (!page) return;
  await useAddress(page, atem);
  atem.drop();
  await page.waitForFunction(() => /not answering since .+, trying again/.test(document.querySelector('#swText').textContent), null, { timeout: 10000 });
  assert.match(await text(page, '#swText'), /^127\.0\.0\.1 not answering since/);
  assert.equal(await page.getAttribute('#swDot', 'class'), 'hdot bad');
  assert.equal(await page.isVisible('#swLive'), false, 'no input buttons to press that would do nothing');
  assert.equal(await page.isVisible('#swRetry'), true);
  const sent = atem.received.length;
  // Back on the network: connected again without a click, showing the switcher as it is now.
  atem.state.program = 2; atem.state.preview = 3;
  atem.resume();
  await page.waitForFunction(() => /connected/.test(document.querySelector('#swText').textContent), null, { timeout: 15000 });
  await shows(page, 'Bench', 'Wide');
  assert.equal(await page.isVisible('#swRetry'), false);
  await wait(300);
  assert.equal(atem.received.filter(c => !/^(InCm|TiRq)$/.test(c.name)).length,
    atem.received.slice(0, sent).filter(c => !/^(InCm|TiRq)$/.test(c.name)).length, 'nothing pressed while it was gone is sent now');
  // And it takes cuts again.
  await page.click('#swCut');
  await shows(page, 'Wide', 'Bench');
  assert.deepEqual(page.errors, []);
});

test('Try again while the switcher is still gone keeps saying it isn\'t answering', async t => {
  const { atem, page } = await setUp(t);
  if (!page) return;
  await useAddress(page, atem);
  atem.drop();
  await page.waitForSelector('#swRetry:not(.hidden)', { timeout: 10000 });
  await page.click('#swRetry');
  // Connecting… for a few seconds, then not answering again (not Connecting… for ever).
  await page.waitForFunction(() => /^Connecting to/.test(document.querySelector('#swText').textContent), null, { timeout: 5000 });
  await page.waitForFunction(() => /not answering/.test(document.querySelector('#swText').textContent), null, { timeout: 10000 });
  assert.equal(await text(page, '#swErr'), '');
  assert.equal(await page.isVisible('#swRetry'), true, 'Try again is there to press again');
  // Back: connected without another press.
  atem.resume();
  await page.waitForFunction(() => /connected/.test(document.querySelector('#swText').textContent), null, { timeout: 15000 });
});

test('an answer that arrives after the switcher has connected doesn\'t put the page back to Connecting', async t => {
  const { atem, studio, page } = await setUp(t);
  if (!page) return;
  // Studio's answer to Use is held back until it has connected (as on a busy Mac): the connected news, over the
  // scene's socket, gets to the page first.
  await page.route('**/api/switcher', async route => {
    const answer = await route.fetch();
    await studio.until(async () => (await studio.get('/api/switcher')).state === 'connected');
    await wait(500);
    await route.fulfill({ response: answer });
  });
  await page.click('#swSetup');
  await page.fill('#swAddress', `127.0.0.1:${atem.port}`);
  await page.click('#swUseAddress');
  await page.waitForFunction(() => /connected/.test(document.querySelector('#swText').textContent), null, { timeout: 10000 });
  await page.waitForResponse('**/api/switcher');
  await wait(300);
  assert.match(await text(page, '#swText'), /ATEM Mini Extreme connected/);
  await shows(page, 'Court', 'Bench');
  assert.deepEqual(page.errors, []);
});

test('a mistyped address is refused with what to type, and Forget lets the switcher go', async t => {
  const { atem, page } = await setUp(t);
  if (!page) return;
  await page.click('#swSetup');
  await page.fill('#swAddress', 'court atem please');
  await page.press('#swAddress', 'Enter');
  await page.waitForFunction(() => document.querySelector('#swErr').textContent !== '', null, { timeout: 5000 });
  assert.match(await text(page, '#swErr'), /Type the switcher's IP address, such as 192\.168\.10\.240/);
  assert.equal(await text(page, '#swText'), 'Not set up');
  await page.fill('#swAddress', `127.0.0.1:${atem.port}`);
  await page.click('#swUseAddress');
  await page.waitForFunction(() => /connected/.test(document.querySelector('#swText').textContent), null, { timeout: 10000 });
  assert.equal(await text(page, '#swErr'), '', 'the old error goes once it works');
  // Forget asks first; Cancel keeps it.
  page.once('dialog', d => d.dismiss());
  await page.click('#swForget');
  await wait(300);
  assert.match(await text(page, '#swText'), /connected/);
  page.once('dialog', d => d.accept());
  await page.click('#swForget');
  await page.waitForFunction(() => document.querySelector('#swText').textContent === 'Not set up', null, { timeout: 5000 });
  assert.equal(await page.isVisible('#swLive'), false);
  // Forgotten for good: it's still not set up after the page is opened again.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#swText').textContent === 'Not set up', null, { timeout: 5000 });
  assert.equal(await text(page, '#swSetup'), 'Set up');
});

test('the switcher set up last time is connected again when Studio starts, and the page shows it at once', async t => {
  const atem = await startAtem({ model: 'MiniExtreme', names: ['Court', 'Bench'] });
  t.after(() => atem.close());
  const first = await startStudio(t, { keepDataDir: true });
  await first.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  await first.until(async () => (await first.get('/api/switcher')).state === 'connected');
  await first.stop();
  // Next stream night: the same data folder.
  const studio = await startStudio(t, { dataDir: first.dataDir });
  t.after(() => require('node:fs').rmSync(first.dataDir, { recursive: true, force: true }));
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  await page.waitForFunction(() => /connected/.test(document.querySelector('#swText').textContent), null, { timeout: 10000 });
  await shows(page, 'Court', 'Bench');
});
