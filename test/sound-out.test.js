// Where the sound is going, and how loud, at a glance: the status board's Sound out tile (a row for each place each
// output's sound goes, with what it plays at and a meter for each side) and "Sound: …" on each output's card, from
// Sound goes to, how each destination is doing (outputs.js soundState) and the levels the windows report
// (POST /api/outputs/level, GET /api/outputs/sound). The Mac app's windows can't run here, so the page is handed
// outputs as the app would report them, and the levels are posted as the windows would.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openBrowser } = require('./support/browser');

test('the levels the windows report are read back while fresh, and only for outputs that exist', async t => {
  const studio = await startStudio(t);
  const post = b => studio.request('POST', '/api/outputs/level', b);
  await post({ output: 'main', device: 'own', peak: [0.5, 0.25], rate: 48000, channels: 2 });
  await post({ output: 'main', device: 'DLZ Creator XS', peak: [0.1], rate: 44100, channels: 2 });
  await post({ output: 'nope', device: 'own', peak: [1, 1] });
  await post({ output: 'main', device: 'sdi', peak: [1, 1] }); // only the Mac app reports the SDI
  const { levels } = await studio.get('/api/outputs/sound');
  assert.deepEqual(levels, {
    'main|own': { peak: [0.5, 0.25], rate: 48000, channels: 2, dry: 0 },
    'main|DLZ Creator XS': { peak: [0.1, 0.1], rate: 44100, channels: 2, dry: 0 },
  });
});

test('the status board\'s Sound out tile and the output cards say where the sound goes, what it plays at and how loud', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const studio = await startStudio(t);
  const ok = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  await ok({ type: 'micAdd', changes: { name: 'Crowd mic', device: '' } });
  const added = await studio.request('POST', '/api/outputs', { add: true });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  const mic = (await studio.get('/api/scene')).mics.mics[0].id;

  // How the outputs look to the page: Output 1 a Blackmagic output into the SDI and the mixer (with the crowd mic), the second on NDI.
  let one = {
    mode: 'decklink', decklinkKeying: 'off', decklinkStatus: { running: true, name: 'UltraStudio HD Mini', sound: 'sdi' },
    sound: [{ device: 'own', mics: [] }, { device: 'Mixer', mics: [mic] }], soundState: [{ state: 'sending' }, { state: 'sending' }],
  };
  let levels = {
    'main|sdi': { peak: [0.5, 0.25], rate: 0, channels: 0, dry: 0 },
    'main|Mixer': { peak: [0.01, 0.01], rate: 44100, channels: 2, dry: 0 },
  };
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
  await context.route(url => new URL(String(url)).pathname === '/api/outputs/sound', route => route.fulfill({ json: { levels } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  // Each row: [light, device, the line under it, format, level].
  const rows = () => page.$$eval('#board .stile .srow', rs => rs.map(r => [r.querySelector('.dot').className.replace('dot', '').trim(),
    r.querySelector('.sname b').textContent, (r.querySelector('.sname small') || {}).textContent || '', r.querySelector('.sfmt').textContent, (r.querySelector('.sdb') || r.querySelector('.snone')).textContent]));
  const says = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector('#board .stile')?.textContent || ''), re);
  await says('Mixer');
  await says('−6 dB');
  await says('44.1 kHz');
  // With two outputs, each one's rows sit under its name; the second is on NDI, off.
  assert.deepEqual(await page.$$eval('#board .stile .sout', s => s.map(x => x.textContent)), ['Output 1', 'Output 2']);
  assert.deepEqual(await rows(), [
    ['ok', 'SDI', 'UltraStudio HD Mini · embedded', 'PCM 16-bit · 48 kHz · stereo · 1.5 Mbps', '−6 dB'],
    ['ok', 'Mixer', 'with Crowd mic', '44.1 kHz · stereo', '−40 dB'],
    ['', 'Mac, not over NDI', 'when Output 2 is on', '–', '–'],
  ]);
  // The meters: each side's level as a width on -60 to 0 dB (-6 dB is 90%, -12 dB 80%), amber from -12 dB.
  const meters = () => page.$$eval('#board .stile .srow .smeter i', is => is.slice(0, 2).map(i => [Math.round(parseFloat(i.style.width)), i.className]));
  assert.deepEqual(await meters(), [[90, 'warm'], [80, '']]); // 0.25 is just under -12 dB
  // The Sound out tile spans the board, with the Switcher beside the Recording under it.
  const order = await page.$$eval('#board .sgrid > *', els => els.map(e => e.classList.contains('stile') ? 'Sound out' : e.querySelector('.lbl').textContent));
  assert.deepEqual(order, ['Sequence', 'Run order', 'Music', 'Mics', 'Sound out', 'Switcher', 'Recording', 'Next game']);
  const cards = await page.$$eval('#outList .outCard small', cs => cs.map(c => c.textContent));
  assert.match(cards[0], /Sound: SDI \+ Mixer \(Crowd mic\)/);
  assert.match(cards[1], /Sound: Mac, not over NDI/);
  // The cards follow the mics' names straight away (the outputs are only read every 5 s): a rename, or the scene
  // arriving after the outputs, draws them again.
  const cardSays = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector('#outList .outCard small').textContent), re, { timeout: 1500 });
  await ok({ type: 'micUpdate', mic, changes: { name: 'Bench mic' } });
  await cardSays('Sound: SDI \\+ Mixer \\(Bench mic\\)');
  await ok({ type: 'micUpdate', mic, changes: { name: 'Crowd mic' } });
  await cardSays('Sound: SDI \\+ Mixer \\(Crowd mic\\)');

  // The SDI running dry: amber, with how often.
  levels = { ...levels, 'main|sdi': { ...levels['main|sdi'], dry: 3 } };
  await says('ran dry 3 times in the last minute');
  assert.equal((await rows())[0][0], 'warn');

  // A destination that fails: red, with why.
  one = { ...one, soundState: [{ state: 'problem', error: 'The UltraStudio wouldn\'t take sound' }, { state: 'sending' }] };
  await page.evaluate(() => loadOut());
  await says('wouldn\'t take sound');
  assert.deepEqual((await rows())[0].slice(0, 3), ['bad', 'SDI', 'The UltraStudio wouldn\'t take sound']);

  // Output 1 off: no levels, and when it'll have sound.
  one = { ...one, soundState: [{ state: 'off' }, { state: 'off' }] };
  await page.evaluate(() => loadOut());
  await says('when Output 1 is on');
  assert.deepEqual((await rows())[1], ['', 'Mixer', 'when Output 1 is on', '–', '–']);

  // No sound: one row saying No Audio where the meter goes, and the card says none.
  one = { ...one, sound: [], soundState: [] };
  await page.evaluate(() => loadOut());
  await says('No Audio');
  assert.deepEqual((await rows())[0], ['', 'Nowhere', 'No sound', '–', 'No Audio']);
  assert.equal(await page.$$eval('#board .stile .srow .smeter', m => m.length), 1, 'no meter for it (only Output 2\'s)');
  await cardSays('Sound: none');

  // Web links only: the sound is in the output canvas link.
  one = { ...one, mode: 'off' };
  await page.evaluate(() => loadOut());
  await says('Web links only');
  assert.deepEqual((await rows())[0].slice(0, 3), ['', 'Web links only', 'sound in the output canvas link']);
  assert.deepEqual(errors, []);
});
