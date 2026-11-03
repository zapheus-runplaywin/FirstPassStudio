// The Ducking card on the Output page: everything that takes the music and the mics down in one place. A row per
// cause, a column each for the music and the mics: under a video the music pauses or is left (Lower to has gone), the
// mics' ticks, one Duck to each, the mics' times. Folded, its line says the levels and the causes. Music Settings no
// longer has the video and duck rows, and Mics has no Settings of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

test('the Ducking card sets the music\'s and the mics\' ducking, and its line says what it does', async t => {
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  const scene = () => studio.get('/api/scene');
  await page.waitForFunction(() => /^Music to 25% \(pauses under a video, ducks for a scene or sequence\) · mics to 30% for a video, a scene or sequence$/.test(document.querySelector('#dkSummary').textContent));
  assert.equal(await page.isVisible('#dkMusicVideo'), false, 'folded behind Settings');
  assert.equal(await page.$('#micsCfg'), null, 'Mics has no Settings of its own');
  assert.equal(await page.$('#mUnder'), null);
  assert.equal(await page.$('#mLowerTo'), null);
  assert.equal(await page.$('#mDuckHalf'), null);

  await page.click('#duckCfg');
  assert.equal(await page.isVisible('#dkMusicVideo'), true);
  assert.equal(await page.isVisible('#dkSummary'), false);
  // Under a video: leave the music.
  await page.uncheck('#dkMusicVideo');
  await studio.until(async () => (await scene()).musicSettings.underVideo === 'leave', 5000, 50);
  // One Duck to for the music, one for the mics, and the mics' times and ticks.
  await page.fill('#mDuckTo', '40');
  await page.press('#mDuckTo', 'Tab');
  await studio.until(async () => (await scene()).musicSettings.duckTo === 40, 5000, 50);
  await page.fill('#mxDipTo', '20');
  await page.press('#mxDipTo', 'Tab');
  await page.check('#mxDipMusic');
  await page.uncheck('#mxDipVideo');
  await page.fill('#mxDown', '0.5');
  await page.press('#mxDown', 'Tab');
  await studio.until(async () => { const x = (await scene()).mics; return x.dipTo === 20 && x.dipMusic && !x.dipVideo && x.dipDownSec === 0.5; }, 5000, 50);

  await page.click('#duckCfg');
  await page.waitForFunction(() => document.querySelector('#dkSummary').textContent === 'Music to 40% (ducks for a scene or sequence) · mics to 20% for a scene or sequence, music');
  assert.deepEqual(page.errors, []);
});
