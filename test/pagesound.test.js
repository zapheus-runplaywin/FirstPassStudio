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
