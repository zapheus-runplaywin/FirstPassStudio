// Sound from graphics pages (the intro and outro): the page sends its plan to the scene (pagesound.js), every scene
// window plays it (a silent one at no volume) until the source goes off, and the Output page's source options warn
// when the theme and the animation are more than 25% apart, checking again when the style changes.
// The browser: as in pages.test.js (Playwright's own, or STUDIO_TEST_CHROMIUM).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

async function launch(t) {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try { browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] }); }
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

// sec seconds of quiet as a WAV.
function quiet(sec) {
  const rate = 8000, bytes = Math.round(rate * sec) * 2, wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  return wav;
}

test('an intro plays its sound in the scene until it goes off, and the Output page compares the theme with the animation', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'Stinger.wav'), quiet(2));
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  await act({ type: 'add', sources: [{ type: 'browser', name: 'Intro', url: 'introoutro.html?style=orbit&theme=Stinger.wav&themefit=logo' }] });

  // Two scene windows: one that makes sound, and the key output's silent one. Both play it.
  const loud = await context.newPage(), silent = await context.newPage();
  await loud.goto(`${studio.base}/scene.html`, { waitUntil: 'load' });
  await silent.goto(`${studio.base}/scene.html?mute=1`, { waitUntil: 'load' });
  await act({ type: 'show', name: 'Intro' });
  const playing = page => page.waitForFunction(() => window.soundState().pages === 1, null, { timeout: 15000 }).then(() => true, () => false);
  assert.ok(await playing(loud), 'the scene plays the intro\'s sound');
  assert.ok(await playing(silent), 'a silent scene window plays it at no volume');
  await act({ type: 'hide', name: 'Intro' });
  await loud.waitForFunction(() => window.soundState().pages === 0, null, { timeout: 5000 });

  // The Output page: the theme is a choice, and the note under Theme timing compares the lengths.
  const output = await context.newPage();
  await output.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  await output.click('#sources li:has-text("Intro") .name'); // the name, not the row's centre: the sound column put Off there
  await output.waitForSelector('#opt-theme');
  assert.ok(await output.$eval('#opt-theme', s => [...s.options].some(o => o.value === 'Stinger.wav')), 'songs in the media folder are offered');
  const note = async want => {
    await output.waitForFunction(w => (document.getElementById('optLengthCheck')?.textContent || '').includes(w), want, { timeout: 10000 }).catch(() => {});
    return output.$eval('#optLengthCheck', n => n.textContent);
  };
  assert.match(await note('more than 25% apart'), /The theme is 2\.0 s and this animation [\d.]+ s with \d+ teams\. They're more than 25% apart: the theme is longer than the 1\.1 s before the logo lands, so its first 0\.9 s are skipped\./);
  // A new style is checked again.
  await output.selectOption('#opt-style', 'court');
  const court = await note('this animation 1');
  assert.match(court, /this animation 1\d\.\d s/, 'court runs longer');
  await output.selectOption('#opt-themefit', 'stretch');
  assert.match(await note('stretching goes only 25%'), /stretching goes only 25%, so it plays at 1\.25× and the theme ends [\d.]+ s early/);
  // A sound added right there goes into the media folder and becomes the theme.
  await output.setInputFiles('#opt-theme-add', { name: 'Thunder League.wav', mimeType: 'audio/wav', buffer: quiet(1.5) });
  await studio.until(async () => /theme=Thunder(\+|%20)League\.wav/.test((await studio.get('/api/scene')).sources.find(s => s.name === 'Intro').url));
  assert.ok(fs.existsSync(path.join(studio.dataDir, 'media', 'Thunder League.wav')));
  await output.waitForFunction(() => document.getElementById('opt-theme')?.value === 'Thunder League.wav', null, { timeout: 5000 });
  const url = (await studio.get('/api/scene')).sources.find(s => s.name === 'Intro').url;
  assert.match(url, /style=court/);
  assert.match(url, /themefit=stretch/);
});

test('cut to a sequence with music of its own, the scene plays the old song fading out under the new one', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'Bed.wav'), quiet(60));
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'Walk.wav'), quiet(60));
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  await act({ type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }] });
  const ladder = (await studio.get('/api/scene')).sources.find(s => s.name === 'Ladder').id;
  const steps = [{ sources: [ladder], length: { type: 'time', sec: 60 } }];
  await act({ type: 'seqAdd', changes: { name: 'Bed', music: { track: 'Bed.wav', fadeInSec: 0 }, musicEnd: { type: 'fade', sec: 6 }, steps } });
  await act({ type: 'seqAdd', changes: { name: 'Walk', music: { track: 'Walk.wav', fadeInSec: 0 }, steps } });

  const page = await context.newPage();
  await page.goto(`${studio.base}/scene.html`, { waitUntil: 'load' });
  await act({ type: 'seqPlay', sequence: 'Bed' });
  await page.waitForFunction(() => window.musicPlayers().music.playing && window.musicPlayers().music.src === 'Bed.wav', null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await act({ type: 'seqPlay', sequence: 'Walk' });
  await page.waitForFunction(() => { const p = window.musicPlayers(); return p.music.src === 'Walk.wav' && p.music.playing && p.tail.src === 'Bed.wav' && p.tail.playing; }, null, { timeout: 10000 });
  // The old song starts at its full volume (80%) and eases down over its 6 s.
  await page.waitForFunction(() => { const v = window.musicPlayers().tail.volume; return v > 0 && v < 0.6; }, null, { timeout: 6000 });
  const mid = await page.evaluate(() => window.musicPlayers());
  assert.ok(mid.tail.playing, 'still playing as it fades');
  assert.ok(mid.tail.at > 1, 'it carries on from where it was, on the same player');
  await page.waitForFunction(() => !window.musicPlayers().tail.playing, null, { timeout: 12000 });
  assert.equal((await page.evaluate(() => window.musicPlayers())).music.src, 'Walk.wav');
  await act({ type: 'seqStop' });
});

test("switching the Output page's Scene View to another output keeps the music going: the new view stands by until it plays", async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'Bed.wav'), quiet(120));
  assert.equal((await studio.request('POST', '/api/outputs', { add: true })).status, 200);
  const two = (await studio.get('/api/outputs')).outputs[1];
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  await act({ type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }] });
  const ladder = (await studio.get('/api/scene')).sources.find(s => s.name === 'Ladder').id;
  await act({ type: 'seqAdd', changes: { name: 'Bed', playsOn: ['main', two.id], music: { track: 'Bed.wav', fadeInSec: 0 }, steps: [{ sources: [ladder], length: { type: 'time', sec: 120 } }] } });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  await act({ type: 'seqPlay', sequence: 'Bed' });
  // What each Scene View frame on the page plays: its output, and the music's volume (0 when it isn't playing).
  // Read in one go in the page: a frame the page removes between finding it and reading it would read as silent.
  const frames = () => page.evaluate(() => [...document.querySelectorAll('#preview iframe')].map(f => {
    const src = f.getAttribute('src') || '';
    let p = null;
    try { p = f.contentWindow.musicPlayers?.(); } catch {}
    return { id: f.id, output: (src.match(/output=([^&]+)/) || [])[1] || 'main', hidden: f.style.visibility === 'hidden', volume: p && p.music.playing ? p.music.volume : 0 };
  }));
  await page.waitForFunction(() => { const f = document.getElementById('previewFrame'); try { const p = f.contentWindow.musicPlayers(); return p.music.playing && p.music.volume > 0.5; } catch { return false; } }, null, { timeout: 15000 });
  await page.click(`#outTabs button:has-text("${two.name}")`);
  // Until the new view takes over, the one showing keeps playing at its level; then the new one plays straight on at it.
  const seen = [];
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const f = await frames();
    seen.push(f);
    const showing = f.find(x => x.id === 'previewFrame');
    assert.ok(showing && showing.volume > 0.5, `the Scene View's music never stops: ${JSON.stringify(f)}`);
    if (f.length === 1 && showing.output === two.id) break;
    await page.waitForTimeout(20);
  }
  const last = seen[seen.length - 1];
  assert.equal(last.length, 1, 'the old view is gone once the new one took over');
  assert.equal(last[0].output, two.id);
  assert.ok(seen.some(f => f.length === 2 && f.some(x => x.hidden && x.output === two.id)), 'the new view stood by, hidden, beside the old one');
  assert.equal(await page.evaluate(() => window.previewSwitching()), false);
  // Back to Output 1 the same way.
  await page.click('#outTabs button >> nth=0');
  await page.waitForFunction(() => !window.previewSwitching() && !/output=/.test(document.getElementById('previewFrame').getAttribute('src')), null, { timeout: 10000 });
  assert.ok((await frames())[0].volume > 0.5);
  assert.deepEqual(errors, []);
  await act({ type: 'seqStop' });
});

test("the Scene View goes silent as soon as the output it shows starts sending, not at its next check-in", async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  assert.equal((await studio.request('POST', '/api/outputs', { add: true })).status, 200);
  const two = (await studio.get('/api/outputs')).outputs[1];
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  await page.click(`#outTabs button:has-text("${two.name}")`);
  await page.waitForFunction(id => previewOutput === id && !previewSwitching(), two.id, { timeout: 10000 });
  const note = () => page.$eval('#previewSoundNote', el => el.textContent);
  assert.doesNotMatch(await note(), /this output is on/);
  // Output 2 starts sending (Output 1 stays off): the Scene View showing it is told at once.
  const asks = [];
  page.on('request', r => { if (r.url().endsWith('/api/outputs/listen')) asks.push(JSON.parse(r.postData() || '{}')); });
  await page.evaluate(id => showOut({ ...out, outputs: out.outputs.map(o => o.id === id ? { ...o, previewSound: false } : o) }), two.id);
  await page.waitForFunction(() => /this output is on, so it plays its own sound/.test(document.getElementById('previewSoundNote').textContent), null, { timeout: 1500 });
  assert.ok(asks.some(a => a.output === two.id && a.on === false), JSON.stringify(asks));
  // And back off: it may play that output's sound again straight away.
  await page.evaluate(id => showOut({ ...out, outputs: out.outputs.map(o => o.id === id ? { ...o, previewSound: true } : o) }), two.id);
  await page.waitForFunction(() => !/this output is on/.test(document.getElementById('previewSoundNote').textContent), null, { timeout: 1500 });
  assert.ok(asks.some(a => a.output === two.id && a.on === true), JSON.stringify(asks));
  assert.deepEqual(errors, []);
});
