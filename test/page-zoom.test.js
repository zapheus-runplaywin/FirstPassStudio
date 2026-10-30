// Graphics at 4K (public/zoom.js): a graphic opened bigger than 1920 x 1080, such as a browser source set to
// 3840 x 2160, zooms by the whole number of times the frame fits, so it's laid out again sharp rather than stretched;
// at 1920 x 1080, in the scene's own frames or with ?fit=1 nothing changes. A 4K output draws the scene at twice the
// density instead, and the canvases (The Clash, winner, streaks) are sized for every real pixel either way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');
const { openBrowser } = require('./support/browser');

const ROOT = path.join(__dirname, '..');
const APP_PAGES = ['api', 'athletes', 'control', 'devices', 'graphics', 'output', 'pair', 'planner', 'preview', 'pvw', 'recordings', 'setup', 'social', 'socials', 'sponsorreport', 'sponsors'];
const graphicsPages = () => fs.readdirSync(path.join(ROOT, 'public')).filter(n => n.endsWith('.html') && !APP_PAGES.includes(n.replace('.html', '')));

test('every graphics page loads zoom.js, and the canvas pages draw through sharpCanvas', () => {
  const missing = graphicsPages().filter(n => !fs.readFileSync(path.join(ROOT, 'public', n), 'utf8').includes('<script src="zoom.js"></script>'));
  assert.deepEqual(missing, []);
  for (const n of graphicsPages()) {
    const src = fs.readFileSync(path.join(ROOT, 'public', n), 'utf8');
    if (/<canvas/.test(src)) assert.match(src, /sharpCanvas\(/, `${n} sizes its canvas for 4K`);
  }
});

test('a graphic zooms in a 4K window, and its canvases follow', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Title', url: 'title.html' }] });
  await studio.post('/api/scene', { type: 'show', name: 'Title' });
  const open = async (link, viewport, deviceScaleFactor = 1) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor });
    t.after(() => context.close());
    await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
    const page = await context.newPage();
    await page.goto(studio.base + link, { waitUntil: 'load' });
    return page;
  };
  const uhd = { width: 3840, height: 2160 }, hd = { width: 1920, height: 1080 };
  const zoomOf = page => page.evaluate(() => [document.documentElement.style.zoom, window.studioZoom]);
  // The embers canvas starts as soon as The Clash plays.
  const embers = page => page.waitForFunction(() => document.getElementById('embers').width !== 0 && document.getElementById('embers').style.width === '1920px')
    .then(() => page.evaluate(() => document.getElementById('embers').width));

  assert.deepEqual(await zoomOf(await open('/title.html', uhd)), ['2', 2]);
  assert.deepEqual(await zoomOf(await open('/title.html', hd)), ['', 1]);
  assert.deepEqual(await zoomOf(await open('/title.html?fit=1', uhd)), ['', 1], 'a page the scene fits itself is left alone');

  assert.equal(await embers(await open('/clash.html', uhd)), 3840, 'zoomed: the canvas has a pixel for every real pixel');
  assert.equal(await embers(await open('/clash.html', hd, 2)), 3840, 'at twice the density, as a 4K output draws');
  assert.equal(await embers(await open('/clash.html', hd)), 1920, 'HD as before');

  // The scene in a 4K window: zoomed, and its graphics drawn at twice the density inside their 1920 x 1080 frames.
  const scene = await open('/scene.html', uhd);
  // Once the title in the scene has loaded (on a busy machine the frame is blank for a while).
  await scene.waitForFunction(() => { const f = document.querySelector('iframe'); return f && f.contentWindow && f.contentWindow.studioZoom !== undefined; });
  assert.deepEqual(await zoomOf(scene), ['2', 2]);
  const inside = await scene.evaluate(() => { const w = document.querySelector('iframe').contentWindow; return [w.innerWidth, w.devicePixelRatio, w.studioZoom]; });
  assert.deepEqual(inside, [1920, 2, 1]);
});
