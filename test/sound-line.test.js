// Where the sound is going, at a glance: the status board's Sound line for Output 1 (the music and the mics go with
// it) and "Sound: …" on each output's card, from Sound goes to and how each destination is doing (outputs.js soundState).
// The Mac app's windows can't run here, so the page is handed outputs as the app would report them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openBrowser } = require('./support/browser');

test('the status board\'s Sound line and the output cards say where the sound goes and how it is doing', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const studio = await startStudio(t);
  const ok = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  await ok({ type: 'micAdd', changes: { name: 'Crowd mic', device: '' } });
  const added = await studio.request('POST', '/api/outputs', { add: true });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  const mic = (await studio.get('/api/scene')).mics.mics[0].id;

  // How the outputs look to the page: Output 1 a Blackmagic output into the SDI and the mixer (with the crowd mic), the second on NDI.
  let one = { mode: 'decklink', sound: [{ device: 'own', mics: [] }, { device: 'Mixer', mics: [mic] }], soundState: [{ state: 'sending' }, { state: 'sending' }] };
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await context.route(url => new URL(String(url)).pathname === '/api/outputs', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    body.outputs = body.outputs.map(o => o.primary ? { ...o, ...one } : { ...o, mode: 'ndi', sound: [{ device: 'own', mics: [] }], soundState: [{ state: 'off' }] });
    await route.fulfill({ response: res, json: body });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  const line = () => page.evaluate(() => {
    const l = [...document.querySelectorAll('#board .line')].find(x => x.querySelector('.lbl').textContent === 'Sound');
    return l && [l.querySelector('.dot').className.replace('dot', '').trim(), l.querySelector('b').textContent, (l.querySelector('small') || {}).textContent || ''];
  });
  await page.waitForFunction(() => [...document.querySelectorAll('#board .line .lbl')].some(x => x.textContent === 'Sound'));
  await page.waitForFunction(() => /SDI \+ Mixer/.test(document.getElementById('board').textContent));
  assert.deepEqual(await line(), ['ok', 'SDI + Mixer', 'Crowd mic to Mixer']);
  const cards = await page.$$eval('#outList .outCard small', cs => cs.map(c => c.textContent));
  assert.match(cards[0], /Sound: SDI \+ Mixer \(Crowd mic\)/);
  assert.match(cards[1], /Sound: Mac, not over NDI/);

  // A destination that fails: red, with why.
  one = { ...one, soundState: [{ state: 'problem', error: 'The UltraStudio wouldn\'t take sound' }, { state: 'sending' }] };
  await page.evaluate(() => loadOut());
  await page.waitForFunction(() => /wouldn't take sound/.test(document.getElementById('board').textContent));
  assert.deepEqual(await line(), ['bad', 'SDI + Mixer', 'The UltraStudio wouldn\'t take sound']);

  // Output 1 off: no sound until it's on.
  one = { ...one, soundState: [{ state: 'off' }, { state: 'off' }] };
  await page.evaluate(() => loadOut());
  await page.waitForFunction(() => /no sound until Output 1 is on/.test(document.getElementById('board').textContent));
  assert.deepEqual(await line(), ['', 'Off', 'no sound until Output 1 is on (SDI + Mixer)']);

  // Web links only: the sound is in the output canvas link.
  one = { ...one, mode: 'off' };
  await page.evaluate(() => loadOut());
  await page.waitForFunction(() => /Web links only/.test(document.getElementById('board').textContent));
  assert.deepEqual(await line(), ['', 'Web links only', 'sound in the output canvas link']);
  assert.deepEqual(errors, []);
});
