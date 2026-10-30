// studio.js, on every Studio page: a change Studio refuses (403) shows one banner under the tab bar with the reason and
// Pair this device, on whichever page asked, and it goes when a later change is accepted; studioStatus() is the one
// "Saved" line. Review findings 4 and 5 (30 Oct 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openBrowser, openPage } = require('./support/browser');

const REFUSED = 'Studio is set to change things only from this computer, so POST /api/planner from 10.0.0.9 was refused. To let this device in, open Studio\'s /pair.html on it and press Allow on the Mac.';

test('a refused change shows the banner with Pair this device on the page that asked, and an accepted one clears it', async t => {
  const studio = await startStudio(t);
  const browser = await openBrowser(t);
  if (!browser) return;
  for (const path of ['/planner.html', '/control.html']) {
    const page = await openPage(t, studio, path, { browser });
    let refuse = true;
    await page.route(u => /\/api\/(planner|scoreboard)$/.test(String(u)), route => {
      if (route.request().method() === 'POST' && refuse) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: REFUSED }) });
      return route.continue();
    });
    await page.evaluate(p => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), path === '/planner.html' ? '/api/planner' : '/api/scoreboard');
    await page.waitForSelector('.fp-refused:not([hidden])');
    assert.equal(await page.textContent('.fp-refused span'), REFUSED, `${path} shows Studio's reason`);
    assert.equal(await page.getAttribute('.fp-refused a', 'href'), '/pair.html', `${path} offers pairing`);
    assert.equal(await page.$eval('header.fp-bar', h => h.nextElementSibling.nextElementSibling.className), 'fp-refused', 'under the bar and the practice strip');
    // The next accepted change takes it away.
    refuse = false;
    await page.evaluate(() => fetch('/api/scoreboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'tickerSpeed', value: 120 }) }));
    await page.waitForSelector('.fp-refused', { state: 'hidden' });
    assert.deepEqual(page.errors, []);
  }
});

test('studioStatus shows Saved briefly and keeps an error until the next status', async t => {
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/recordings.html');
  if (!page) return;
  await page.evaluate(() => studioStatus('Saved'));
  assert.equal(await page.textContent('.fp-status'), 'Saved');
  assert.equal(await page.isVisible('.fp-status'), true);
  await page.waitForSelector('.fp-status', { state: 'hidden', timeout: 5000 });
  await page.evaluate(() => studioStatus("Couldn't save: no", 'error'));
  await page.waitForTimeout(3000);
  assert.equal(await page.isVisible('.fp-status.error'), true, 'an error stays');
  // The Record switch says Saved through the same line.
  await page.waitForFunction(() => document.querySelector('#record') && !document.querySelector('#record').disabled);
  await page.click('#record');
  await page.waitForFunction(() => document.querySelector('.fp-status').textContent === 'Saved' && !document.querySelector('.fp-status').hidden);
  assert.deepEqual(page.errors, []);
});
