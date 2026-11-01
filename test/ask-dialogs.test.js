// Every question a Studio page asks goes through asktext.js (askConfirm, askChoice, askText, tell) in Studio's own
// dialog: no browser confirm(), alert() or prompt(), which look nothing like Studio and (prompt) do nothing in the
// Mac app. Review finding 3 (30 Oct 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

const PUBLIC = path.join(__dirname, '..', 'public');
const FILES = ['output', 'planner', 'control', 'recordings', 'socials', 'setup', 'sponsors', 'athletes', 'api', 'devices', 'sponsorreport']
  .map(n => `${n}.html`).concat(fs.readdirSync(path.join(PUBLIC, 'output')).map(f => `output/${f}`));

test('no Studio page uses the browser\'s confirm(), alert() or prompt()', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(PUBLIC, f), 'utf8').replace(/\/\/[^\n]*/g, '');
    const hits = [...src.matchAll(/(?<![\w.])(confirm|alert|prompt)\(/g)].map(m => m[1]);
    assert.deepEqual(hits, [], `${f} calls ${hits.join(', ')}`);
    if (f.endsWith('.html') && /askConfirm|askChoice|askText|tell\(/.test(src)) assert.match(src, /asktext\.js/, `${f} loads asktext.js`);
  }
});

test('Reset scores on Scoreboard control asks in Studio\'s dialog, and only resets on the named button', async t => {
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/control.html');
  if (!page) return;
  await page.waitForFunction(() => document.querySelector('#homeScore').textContent !== '');
  await page.click('[data-side="home"][data-delta="1"]');
  await page.waitForFunction(() => document.querySelector('#homeScore').textContent === '1');
  // Cancel keeps the score.
  await page.click('#resetScores');
  await page.waitForSelector('dialog.fp-ask[open]');
  assert.equal(await page.textContent('dialog.fp-ask .fp-ask__question'), 'Set both scores back to 0?');
  assert.deepEqual(await page.$$eval('dialog.fp-ask button', bs => bs.map(b => b.textContent)), ['Cancel', 'Reset scores']);
  await page.click('dialog.fp-ask button.alt');
  await page.waitForSelector('dialog.fp-ask', { state: 'detached' });
  assert.equal(await page.textContent('#homeScore'), '1');
  // The named button does it.
  await page.click('#resetScores');
  await page.waitForSelector('dialog.fp-ask[open]');
  await page.click('dialog.fp-ask button:not(.alt)');
  await page.waitForFunction(() => document.querySelector('#homeScore').textContent === '0');
  assert.deepEqual(page.errors, []);
});
