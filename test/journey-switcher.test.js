// Operator journeys on the Output page's Switcher section, against the stand-in ATEM (test/support/atem.js):
// what an operator clicks on stream night, and what the switcher and the page then show. The browser: see
// test/support/browser.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');
const { startAtem } = require('./support/atem');
const { openPage } = require('./support/browser');

// The input buttons as the page draws them: [name, 'prg' | 'pvw' | ''].
const tally = page => page.$$eval('#swInputs button', bs => bs.map(b => [b.textContent, b.className]));
// Waits until the page's input buttons show this program and preview input (by name).
const shows = (page, program, preview) => page.waitForFunction(([p, v]) => {
  const b = [...document.querySelectorAll('#swInputs button')];
  return b.some(x => x.textContent === p && x.className === 'prg') && b.some(x => x.textContent === v && x.className === 'pvw');
}, [program, preview], { timeout: 5000 });
const text = (page, sel) => page.textContent(sel);

async function setUp(t, opts = {}) {
  const atem = await startAtem({ model: 'MiniExtreme', names: ['Court', 'Bench', 'Wide', 'Crowd'], ...opts });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/output.html');
  return { atem, studio, page };
}

// Set up on the Output page by its address, as the first time at a venue.
async function useAddress(page, atem) {
  await page.click('#swSetup');
  await page.fill('#swAddress', `127.0.0.1:${atem.port}`);
  await page.click('#swUseAddress');
  await page.waitForFunction(() => /connected/.test(document.querySelector('#swText').textContent), null, { timeout: 10000 });
}

test('a mistyped address is refused with what to type, and Forget lets the switcher go', async t => {
  const { atem, page } = await setUp(t);
  if (!page) return;
  await page.click('#swSetup');
  await page.fill('#swAddress', 'court atem please');
  await page.press('#swAddress', 'Enter');
  await page.waitForFunction(() => document.querySelector('#swErr').textContent !== '', null, { timeout: 5000 });
  assert.match(await text(page, '#swErr'), /Type the switcher's IP address, such as 192\.168\.10\.240/);
  assert.equal(await text(page, '#swText'), 'Not set up');
  await page.fill('#swAddress', `127.0.0.1:${atem.port}`);
  await page.click('#swUseAddress');
  await page.waitForFunction(() => /connected/.test(document.querySelector('#swText').textContent), null, { timeout: 10000 });
  assert.equal(await text(page, '#swErr'), '', 'the old error goes once it works');
  // Forget asks first; Cancel keeps it.
  page.once('dialog', d => d.dismiss());
  await page.click('#swForget');
  await wait(300);
  assert.match(await text(page, '#swText'), /connected/);
  page.once('dialog', d => d.accept());
  await page.click('#swForget');
  await page.waitForFunction(() => document.querySelector('#swText').textContent === 'Not set up', null, { timeout: 5000 });
  assert.equal(await page.isVisible('#swLive'), false);
  // Forgotten for good: it's still not set up after the page is opened again.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#swText').textContent === 'Not set up', null, { timeout: 5000 });
  assert.equal(await text(page, '#swSetup'), 'Set up');
});
