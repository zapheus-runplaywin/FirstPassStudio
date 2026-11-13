// Every question a Studio page asks goes through asktext.js (askConfirm, askChoice, askText, tell) in Studio's own
// dialog: no browser confirm(), alert() or prompt(), which look nothing like Studio and (prompt) do nothing in the
// Mac app. Review finding 3 (30 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStudio, type Json } from './support/studio.mts';
import { openPage } from './support/browser.mts';

const PUBLIC = path.join(import.meta.dirname, '..', 'public');
const PAGES = ['output', 'planner', 'control', 'recordings', 'socials', 'setup', 'sponsors', 'athletes', 'api', 'devices', 'sponsorreport'];
// A page's own script: public/<page>.ts beside it, or for the Output page its parts in public/output/.
const scriptsOf = (n: string) => n === 'output'
  ? fs.readdirSync(path.join(PUBLIC, 'output')).filter(f => f.endsWith('.ts')).map(f => `output/${f}`)
  : fs.existsSync(path.join(PUBLIC, `${n}.ts`)) ? [`${n}.ts`] : [];
const read = (f: Json) => fs.readFileSync(path.join(PUBLIC, f), 'utf8').replace(/\/\/[^\n]*/g, '');

test('no Studio page uses the browser\'s confirm(), alert() or prompt()', () => {
  for (const n of PAGES) {
    const html = read(`${n}.html`);
    for (const f of [`${n}.html`, ...scriptsOf(n)]) {
      const hits = [...read(f).matchAll(/(?<![\w.])(confirm|alert|prompt)\(/g)].map(m => m[1]);
      assert.deepEqual(hits, [], `${f} calls ${hits.join(', ')}`);
    }
    const src = [html, ...scriptsOf(n).map(read)].join('\n');
    if (/askConfirm|askChoice|askText|tell\(/.test(src)) assert.match(html, /asktext\.js/, `${n}.html loads asktext.js`);
  }
});

test('Reset scores on Scoreboard control asks in Studio\'s dialog, and only resets on the named button', async t => {
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/control.html');
  if (!page) return;
  await page.waitForFunction(() => document.querySelector('#homeScore')!.textContent !== '');
  await page.click('[data-side="home"][data-delta="1"]');
  await page.waitForFunction(() => document.querySelector('#homeScore')!.textContent === '1');
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
  await page.waitForFunction(() => document.querySelector('#homeScore')!.textContent === '0');
  assert.deepEqual(page.errors, []);
});
