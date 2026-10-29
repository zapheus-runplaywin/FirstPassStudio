// The Output page's Scene View popped out into its own window (preview.html) and brought back:
// Bring it back here puts the Scene View back on the Output page, Pop out opens the window again,
// and a window that goes without saying so (the Mac app's windows can) doesn't leave the Output
// page stuck on "The Scene View is in its own window".
// The browser: as in pages.test.js (Playwright's own, or STUDIO_TEST_CHROMIUM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

// The browser, closed when the test ends; null (and the test skipped) when there isn't one.
async function launch(t) {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try { browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); }
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

test('the Scene View pops out, comes back and pops out again', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));

  const output = await context.newPage();
  await output.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  const state = () => output.evaluate(() => ({
    frame: document.getElementById('previewFrame').getAttribute('src'),
    placeholder: !document.getElementById('previewOff').classList.contains('hidden'),
    button: document.getElementById('popOut').textContent,
  }));
  const here = { frame: '/scene.html?mute=1', placeholder: false, button: 'Pop out' };
  const away = { frame: 'about:blank', placeholder: true, button: 'Show window' };
  const becomes = async want => {
    await output.waitForFunction(w => document.getElementById('previewFrame').getAttribute('src') === w.frame
      && document.getElementById('previewOff').classList.contains('hidden') !== w.placeholder
      && document.getElementById('popOut').textContent === w.button, want, { timeout: 10000 }).catch(() => {});
    assert.deepEqual(await state(), want);
  };
  const popOut = async () => {
    const [win] = await Promise.all([output.waitForEvent('popup'), output.click('#popOut')]);
    await win.waitForLoadState('load');
    await becomes(away);
    return win;
  };
  await becomes(here);

  // Pop out, then Bring it back here: the window closes and the Scene View is back.
  let win = await popOut();
  // Listening before the click: the window can close before a slow runner's click returns.
  await Promise.all([win.waitForEvent('close'), output.click('#popIn')]);
  await becomes(here);

  // Pop out works again afterwards.
  win = await popOut();

  // A window that goes without a word (as the Mac app's can): the Output page notices it's gone.
  await win.evaluate(() => { channel.close(); });
  await win.close();
  await becomes(here);

  // And Show window on a window that's gone opens a new one.
  win = await popOut();
  await win.evaluate(() => { channel.close(); });
  await win.close();
  const [again] = await Promise.all([output.waitForEvent('popup'), output.click('#popOut')]);
  await again.waitForLoadState('load');
  await becomes(away);
});

// The popped-out window behind the Output page (where sequences are played from) gets no frames to
// draw: it still follows one sequence after another, without being brought back and opened again.
test('the popped-out Scene View follows each sequence played while it is covered', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  await studio.post('/api/scene', { type: 'add', sources: [
    { type: 'browser', name: 'Ladder', url: 'testpattern.html' },
    { type: 'browser', name: 'Fixtures', url: 'testpattern.html?b=1' },
  ] });
  const { sources } = await studio.get('/api/scene');
  const id = name => sources.find(s => s.name === name).id;
  for (const name of ['Ladder', 'Fixtures']) {
    await studio.post('/api/scene', { type: 'seqAdd', changes: { name: `Show ${name}`, steps: [{ sources: [id(name)], length: { type: 'time', sec: 60 } }] } });
  }
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  // A covered window: the scene inside the pop-out never gets an animation frame.
  await context.addInitScript(() => {
    if (location.pathname === '/scene.html' && window.parent !== window && window.parent.location.pathname === '/preview.html') window.requestAnimationFrame = () => 0;
  });

  const output = await context.newPage();
  await output.goto(`${studio.base}/output.html`, { waitUntil: 'load' });
  const [win] = await Promise.all([output.waitForEvent('popup'), output.click('#popOut')]);
  await win.waitForLoadState('load');
  const showing = want => win.waitForFunction(w => {
    const doc = document.getElementById('frame').contentDocument;
    return doc && JSON.stringify([...doc.querySelectorAll('.layer.on')].map(l => l.dataset.id)) === JSON.stringify(w);
  }, want, { timeout: 5000 }).then(() => true, () => false);

  await studio.post('/api/scene', { type: 'seqPlay', sequence: 'Show Ladder' });
  assert.ok(await showing([id('Ladder')]), 'the first sequence shows in the pop-out');
  await studio.post('/api/scene', { type: 'seqPlay', sequence: 'Show Fixtures' });
  assert.ok(await showing([id('Fixtures')]), 'the next sequence shows in the pop-out too');
});
