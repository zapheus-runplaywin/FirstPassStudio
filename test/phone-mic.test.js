// A phone as a backup commentator headset (phonemic.js, commentator.html, scene.html): the phone's first offer adds a
// mic for it, Output 1's window answers and mixes what it sends and sends Output 1's sound back (without the phone's
// own voice), and a dropped connection says so on its card and the board. Chromium's stand-in microphone plays a beep; the "phone" here is this Mac (localhost is a secure page too).
// The browser: as in pages.test.js (Playwright's own, or STUDIO_TEST_CHROMIUM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const access = require('../access');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

test('the hand-over: an offer adds the phone\'s mic once, Output 1 takes it and answers, the phone collects the answer', async t => {
  const studio = await startStudio(t);
  assert.equal((await studio.request('POST', '/api/phonemic/offer', { sdp: 'nonsense' })).status, 409);
  const first = await studio.post('/api/phonemic/offer', { sdp: SDP });
  assert.equal(first.mic, 'This Mac');
  const mics = (await studio.get('/api/scene')).mics.mics;
  assert.deepEqual(mics.map(m => [m.name, m.on, m.phone, m.channel]), [['This Mac', 'phone', 'this-mac', 'both']]);
  assert.match((await studio.get(`/api/phonemic/${first.session}`)).why, /Output 1/, 'says what it waits for');
  // Starting again replaces the offer, and doesn't add a second mic.
  const again = await studio.post('/api/phonemic/offer', { sdp: SDP });
  assert.equal((await studio.get('/api/scene')).mics.mics.length, 1);
  const offers = (await studio.get('/api/phonemic/offers')).offers;
  assert.deepEqual(offers.map(o => [o.session, o.mic]), [[again.session, mics[0].id]]);
  assert.equal((await studio.request('GET', `/api/phonemic/${first.session}`)).status, 404, 'the old one is gone');
  await studio.post(`/api/phonemic/${again.session}/answer`, { sdp: SDP.replace('o=- 1', 'o=- 9') });
  assert.match((await studio.get(`/api/phonemic/${again.session}`)).answer, /o=- 9/);
  assert.deepEqual((await studio.get('/api/phonemic/offers')).offers, []);
  // Any allowed device may start a phone mic; only this Mac sees the offers.
  assert.equal(access.refusal(false, 'POST', '/api/phonemic/offer', '192.168.1.50', new Set(['127.0.0.1']), 'scoring'), null);
  assert.match(access.refusal(false, 'POST', '/api/phonemic/offer', '192.168.1.50', new Set(['127.0.0.1']), null), /refused/);
  assert.match(access.notThisMac('GET', '/api/phonemic/offers', '192.168.1.50', new Set(['127.0.0.1'])), /only be seen/);
});

test('the Commentator page sends the phone\'s mic to Output 1, which mixes it; a dropped phone says so', async t => {
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
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t);
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  await context.grantPermissions(['microphone'], { origin: studio.base });
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));

  const output = await context.newPage();
  await output.goto(`${studio.base}/scene.html?fit=1&bg=000000`, { waitUntil: 'load' });
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${studio.base}/commentator.html`);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, 'nothing sticks out sideways');
  assert.equal(await phone.isHidden('#err'), true, 'a secure page: no warning');
  await phone.click('#start');
  await phone.waitForFunction(() => document.getElementById('word').textContent === 'On air', null, { timeout: 15000 });
  assert.match(await phone.textContent('#why'), /Studio hears you as This Mac/);

  // Output 1 mixes it: the beep comes through to its meter.
  const id = (await studio.get('/api/scene')).mics.mics[0].id; // the phone's
  const heard = await studio.until(async () => { const l = await studio.get('/api/scene/mics/live'); return l.levels[id] > -60 && l; }, 15000);
  assert.equal(heard.problems[id], undefined);
  assert.equal(await output.evaluate(m => micChains.has(m), id), true);

  // Muted on the Mac: the phone says so.
  await studio.post('/api/scene', { type: 'micMute', mic: id, value: 'on' });
  await phone.waitForFunction(() => document.getElementById('word').textContent === 'Muted in Studio', null, { timeout: 5000 });
  await studio.post('/api/scene', { type: 'micMute', mic: id, value: 'off' });

  // Hear Studio: the phone hears Output 1 back, never its own voice. Alone, nothing comes back; a mic on the Mac does.
  await phone.waitForFunction(() => typeof backLevel === 'function' && document.getElementById('hearOn').getAttribute('aria-pressed') === 'true');
  // The stand-in mic beeps once a second: listen for the loudest moment over a few seconds.
  const loudest = () => phone.evaluate(() => new Promise(r => { let max = -100; const t = setInterval(() => { max = Math.max(max, backLevel()); }, 5); setTimeout(() => { clearInterval(t); r(max); }, 3000); }));
  await phone.waitForTimeout(1000);
  assert.ok(await loudest() < -60, 'its own voice doesn\'t come back');
  await studio.post('/api/scene', { type: 'micAdd', changes: { name: 'Court mic', device: '' } });
  await studio.until(async () => await loudest() > -60, 20000, 0);
  // Off: the volume goes to nothing.
  await phone.click('#hearOff');
  assert.equal(await phone.textContent('#hearPct'), 'Off');
  await phone.click('#hearOn');

  // The Output page: the phone's card, and + Phone mic's QR code (which warns that it needs the secure link here, on http).
  const page = await context.newPage();
  await page.goto(`${studio.base}/output.html`);
  await page.waitForSelector(`[data-mic="${id}"]`);
  await page.waitForFunction(m => /phone \(backup\)/.test(document.querySelector(`[data-mic="${m}"] .where`).textContent), id, { timeout: 5000 });
  await page.click('#mxPhone');
  await page.waitForSelector('#pmDialog[open] #pmCode svg');
  assert.match(await page.textContent('#pmLink'), /\/pair\.html\?then=%2Fcommentator\.html$/);
  assert.match(await page.textContent('#pmSecure'), /Secure phone link/);
  await page.click('#pmDone');

  // The phone goes away: Output 1 says it dropped, on the card and the board.
  await phone.close();
  const dropped = await studio.until(async () => { const l = await studio.get('/api/scene/mics/live'); return /^Dropped/.test(l.problems[id] || '') && l; }, 30000);
  assert.match(dropped.problems[id], /phone lost Studio/);
  await page.waitForFunction(m => /^Dropped/.test(document.querySelector(`[data-mic="${m}"] .where`).textContent), id, { timeout: 5000 });
});
