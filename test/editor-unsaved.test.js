// Editors in a dialog (unsaved.js; the Competitions setup page is in setup-unsaved.test.js): with changes not saved yet, Escape asks Save, Don't save or
// Keep editing, and so does leaving the page from the Mac app's Go menu (window.studioBeforeLeave);
// a browser reload gets the browser's own question. In Chromium through Playwright, as
// pages.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('editors in a dialog ask before losing changes', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { /* none */ }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the editors in');
    t.skip('no browser to test the editors in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await browser.newPage();
  let leaveAsked = 0;
  page.on('dialog', d => { if (d.type() === 'beforeunload') leaveAsked++; d.accept(); });
  const ask = () => page.waitForSelector('dialog.fp-ask[open] .fp-ask__question');
  const press = label => page.click(`dialog.fp-ask button:text-is("${label}")`);
  const sponsors = async () => (await studio.get('/api/sponsors')).sponsors.map(s => s.name);

  await page.goto(studio.base + '/sponsors.html');
  await page.click('#addSponsor');
  await page.waitForSelector('#editor[open]');

  // Nothing typed: Escape just closes.
  await page.keyboard.press('Escape');
  await page.waitForSelector('#editor', { state: 'hidden' });

  // Typed: Escape asks; Keep editing keeps it open with the name.
  await page.click('#addSponsor');
  await page.fill('#edName', 'Acme Pies');
  await page.keyboard.press('Escape');
  await ask();
  assert.match(await page.textContent('dialog.fp-ask'), /Save your changes to Acme Pies/);
  await press('Keep editing');
  assert.equal(await page.inputValue('#edName'), 'Acme Pies');
  assert.ok(await page.$('#editor[open]'));

  // Don't save: closed, nothing saved.
  await page.keyboard.press('Escape');
  await ask();
  await press("Don't save");
  await page.waitForSelector('#editor', { state: 'hidden' });
  assert.deepEqual(await sponsors(), []);

  // Leaving from the Go menu: asks, Save saves and lets it go.
  await page.click('#addSponsor');
  await page.fill('#edName', 'Acme Pies');
  const leaving = page.evaluate(() => window.studioBeforeLeave());
  await ask();
  await press('Save');
  assert.equal(await leaving, true);
  assert.deepEqual(await sponsors(), ['Acme Pies']);

  // Reloading with changes: the browser's question.
  assert.ok(!await page.$('#editor[open]'), 'closed once saved');
  await page.click('#addSponsor');
  await page.fill('#edName', 'Changed name');
  await page.reload();
  assert.equal(leaveAsked, 1);

  // A playlist on the Output page: the Go menu's question, Keep editing stays.
  await page.goto(studio.base + '/output.html');
  await page.evaluate(() => [...document.querySelectorAll('.seq.addSeq')].find(b => /playlist/.test(b.textContent)).click());
  await page.waitForSelector('#plDialog[open]');
  await page.fill('#plName', 'Warm up');
  const staying = page.evaluate(() => window.studioBeforeLeave());
  await ask();
  await press('Keep editing');
  assert.equal(await staying, false);
  assert.ok(await page.$('#plDialog[open]'));
  await page.click('#plCancel');

  // A scene's switcher actions (the Edit scenes grid's Switcher button): changed, Escape asks;
  // Save keeps them on the scene.
  await page.click('#scenes .addScene');
  await page.fill('dialog.fp-ask input', 'Live');
  await page.click('dialog.fp-ask button[type=submit]');
  await page.waitForSelector('#scenes button.scene:has-text("Live")');
  const sceneId = await page.evaluate(() => { editSceneSwitcher(scene.scenes[0]); return scene.scenes[0].id; });
  await page.waitForSelector('#swSceneDialog[open]');
  await page.click('#swSceneActs button:has-text("+ Switcher action")');
  await page.keyboard.press('Escape');
  await ask();
  assert.match(await page.textContent('dialog.fp-ask'), /switcher actions/);
  await press('Save');
  await page.waitForSelector('#swSceneDialog', { state: 'hidden' });
  const swSaved = await page.evaluate(id => scene.scenes.find(s => s.id === id).switcher.length, sceneId);
  assert.equal(swSaved, 2);

  // A sequence opened and left as it was: Escape just closes it.
  await page.evaluate(() => [...document.querySelectorAll('.seq.addSeq')].find(b => /sequence/i.test(b.textContent)).click());
  await page.waitForSelector('#seqDialog[open]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#seqDialog', { state: 'hidden' });
  assert.equal(await page.evaluate(() => window.studioBeforeLeave()), true);
});
