// The strip under every Studio page's tab bar (studiobar.js) says when a practice game or a 4K replay runs. It reads
// /api/playback, which answers both at once, and takes its look from studio.css rather than inline styles (review
// finding 9, 30 Oct 2026). In Chromium through Playwright, as pages.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('/api/playback answers the replay and the practice game together', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const pb = await studio.get('/api/playback');
  assert.equal(pb.replay.active, false);
  assert.equal(pb.practice.active, false);
  assert.deepEqual(pb.replay, await studio.get('/api/replay'));
  assert.equal(pb.practice.active, (await studio.get('/api/practice')).active);
});

test('the strip is styled by studio.css and hidden while nothing plays back', async t => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'studiobar.js'), 'utf8');
  assert.doesNotMatch(js, /style\.cssText|style="/, 'studiobar.js carries no inline styles');
  assert.match(js, /\/api\/playback/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.css'), 'utf8'), /\.fp-practice\[hidden\]/);
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { /* none */ }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the strip in');
    t.skip('no browser to test the strip in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await browser.newPage();
  const reads = [];
  page.on('request', r => { if (/\/api\/(playback|practice|replay)$/.test(r.url())) reads.push(new URL(r.url()).pathname); });
  await page.goto(studio.base + '/sponsors.html');
  await page.waitForTimeout(500);
  assert.deepEqual(reads, ['/api/playback'], 'one read for both');
  assert.equal(await page.$eval('.fp-practice', el => el.hidden && getComputedStyle(el).display), 'none');
  // Shown: red, flex, with the stop button from the stylesheet.
  const look = await page.$eval('.fp-practice', el => { el.hidden = false; el.innerHTML = '<span>x</span><button>Stop</button>'; const cs = getComputedStyle(el); return [cs.display, cs.backgroundColor, getComputedStyle(el.querySelector('button')).borderTopColor]; });
  assert.deepEqual(look, ['flex', 'rgb(198, 40, 40)', 'rgb(255, 255, 255)']);
});
