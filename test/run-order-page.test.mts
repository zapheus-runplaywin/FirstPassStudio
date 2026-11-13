// The Run order panel on the Output page (public/output/runorder.ts): Add… queues scenes and sequences, Play next
// plays the head and the list moves on, a sequence that ends plays what's queued after it, the board's Run order line and the
// bar's Run order chip say what Play next plays and what follows, and Saved… keeps tonight's order under a name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, wait, type Json } from './support/studio.mts';
import { openPage, type StudioPage } from './support/browser.mts';

const order = (page: StudioPage) => page.$$eval('#roList li', (lis: Json) => lis.map((li: Json) => `${li.querySelector('b').textContent}${li.classList.contains('head') ? ' *' : ''}`));
async function orderIs(page: StudioPage, want: string[], timeout = 5000) {
  const end = Date.now() + timeout;
  let got;
  while (Date.now() < end) { got = await order(page); if (JSON.stringify(got) === JSON.stringify(want)) return; await wait(100); }
  assert.deepEqual(got, want, 'the run order');
}

test('Run order panel: add, Next, the queue after a sequence ends, the board and bar, save and load', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  await page.waitForSelector('#board .line');
  // Two sources, a Live scene (scoreboard on) and a sequence of one 1-second step.
  for (const file of ['scoreboard.html', 'ladder.html']) {
    await page.click('#addBrowser');
    await page.selectOption('#newPage', file);
    await page.click('#addGo');
    await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#addDialog')!.open);
  }
  const scoreboard = await studio.get('/api/scene');
  const sb = scoreboard.sources.find((s: Json) => s.name === 'Scoreboard'), ladder = scoreboard.sources.find((s: Json) => s.name !== 'Scoreboard');
  await studio.post('/api/scene', { type: 'show', id: sb.id });
  await studio.post('/api/scene', { type: 'sceneSave', name: 'Live' });
  await studio.post('/api/scene', { type: 'hide', id: sb.id });
  await studio.post('/api/scene', { type: 'seqAdd', changes: { name: 'Promo', then: { type: 'off' }, steps: [{ sources: [ladder.id], length: { type: 'time', sec: 1 } }] } });
  await page.waitForSelector('#seqs .seq');

  // Empty to start: Next does nothing yet, and the empty note says how it works.
  assert.equal(await page.isVisible('#roEmpty'), true);
  assert.equal(await page.isDisabled('#roNext'), true);
  // Add… queues Promo, Live, Promo.
  const seqId = (await studio.get('/api/scene')).sequences[0].id, sceneId = (await studio.get('/api/scene')).scenes[0].id;
  await page.selectOption('#roAdd', `sequence:${seqId}`);
  await page.selectOption('#roAdd', `scene:${sceneId}`);
  await page.selectOption('#roAdd', `sequence:${seqId}`);
  await orderIs(page, ['Promo *', 'Live', 'Promo']);
  assert.equal(await page.inputValue('#roAdd'), '', 'the picker resets');
  assert.match((await page.textContent('#roNote'))!, /^▶ Promo\s+⏭ Live/);
  await page.waitForFunction(() => /Run order.*▶.*Promo.*⏭.*Live/.test(document.querySelector('#board .line:nth-child(2)')!.textContent), null, { timeout: 4000 });
  // Next plays Promo; it ends after a second and the queue takes it to Live, then Promo is the head again.
  await page.click('#roNext');
  await page.waitForSelector('#seqs .seq.run');
  await orderIs(page, ['Live *', 'Promo']);
  // What's playing is the ON AIR row above the queue, with its step and time left.
  await page.waitForFunction(() => /ON AIR\s*Promo/.test(document.querySelector('#roPlayed li.air b')?.textContent || ''));
  assert.match((await page.textContent('#roPlayed li.air small'))!, /^step 1 of 1/);
  await orderIs(page, ['Promo *']);
  // Promo ended and the Live scene is on: Promo is greyed as played, Live is on air.
  await page.waitForFunction(() => /ON AIR\s*Live/.test(document.querySelector('#roPlayed li.air b')?.textContent || ''));
  assert.deepEqual(await page.$$eval('#roPlayed li.done b', bs => bs.map(b => b.textContent)), ['Promo']);
  await page.waitForFunction(() => !document.querySelector('#seqs .seq.run'));
  const after = await studio.get('/api/scene');
  assert.equal(after.current, sceneId, 'the queued Live scene is on');
  assert.equal(after.sources.find((s: Json) => s.id === sb.id).visible, true);
  // The bar's Run order chip says what Play next plays (no ⏭ with one queued); Skip drops it and the chip goes.
  await page.waitForFunction(() => [...document.querySelectorAll('.fp-chips .chip')].some(c => /^Run order\s*▶\s*Promo$/.test(c.textContent.trim())), null, { timeout: 6000 });
  await page.click('#roSkip');
  await orderIs(page, []);
  assert.deepEqual(await page.$$eval('#roPlayed li.done b', bs => bs.map(b => b.textContent)), ['Promo'], 'a skipped item isn\'t played');
  // Save tonight's order under a name and load it again; the arrows reorder.
  await page.selectOption('#roAdd', `sequence:${seqId}`);
  await page.selectOption('#roAdd', `scene:${sceneId}`);
  await orderIs(page, ['Promo *', 'Live']);
  await page.waitForFunction(() => [...document.querySelectorAll('.fp-chips .chip')].some(c => /^Run order\s*▶\s*Promo\s*⏭\s*Live$/.test(c.textContent.trim())), null, { timeout: 6000 });
  await page.click('#roList li:nth-child(2) .up');
  await orderIs(page, ['Live *', 'Promo']);
  await page.selectOption('#roSaved', 'save');
  await page.fill('dialog.fp-ask input', 'Thursday');
  await page.click('dialog.fp-ask button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('#roSaved option')].some(o => /Thursday \(2\)/.test(o.textContent)));
  await page.click('#roList li:nth-child(1) .del');
  await orderIs(page, ['Promo *']);
  const saved = (await studio.get('/api/scene')).runOrders[0];
  await page.selectOption('#roSaved', `load:${saved.id}`);
  await page.waitForSelector('dialog.fp-ask[open]');
  await page.click('dialog.fp-ask button[type=submit]:not(.alt)');
  await orderIs(page, ['Live *', 'Promo']);
  assert.deepEqual(page.errors, []);
});

test('Run order panel: it is Output 1\'s whichever output tab is picked, and acts on Output 1 from any tab', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const r = await studio.request('POST', '/api/outputs', { add: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const two = (await studio.get('/api/outputs')).outputs[1];
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }] });
  const ladder = (await studio.get('/api/scene')).sources.find((s: Json) => s.name === 'Ladder');
  await studio.post('/api/scene', { type: 'seqAdd', changes: { name: 'Promo', then: { type: 'off' }, steps: [{ sources: [ladder.id], length: { type: 'time', sec: 30 } }] } });
  await studio.post('/api/scene', { type: 'seqAdd', changes: { name: 'Walk out', then: { type: 'off' }, steps: [{ sources: [ladder.id], length: { type: 'time', sec: 30 } }] } });
  await studio.post('/api/scene', { type: 'roAdd', kind: 'sequence', name: 'Promo' });
  await orderIs(page, ['Promo *']);
  // Another output's tab: the run order still lists Output 1's, and its heading says so.
  await page.click(`.outTab:has-text("${two.name}")`);
  await page.waitForFunction(n => document.querySelector('#seqHead .outChip')?.textContent === n, two.name);
  await orderIs(page, ['Promo *']);
  assert.equal(await page.$eval('#roHead .outChip', c => c.textContent), 'Output 1');
  // Added and played from there, it's Output 1's run order that changes and Output 1 that plays.
  const walk = (await studio.get('/api/scene')).sequences.find((s: Json) => s.name === 'Walk out');
  await page.selectOption('#roAdd', `sequence:${walk.id}`);
  await orderIs(page, ['Promo *', 'Walk out']);
  await page.click('#roNext');
  await orderIs(page, ['Walk out *']);
  const after = await studio.get('/api/scene');
  assert.equal(after.sequences.find((s: Json) => s.id === after.playing?.id)?.name, 'Promo', 'playing on Output 1');
  assert.equal((after.playingOut || {})[two.id], undefined, 'not on the other output');
  await page.waitForFunction(() => /Promo/.test(document.querySelector('#roPlayed li.air')?.textContent || ''), null, { timeout: 5000 });
  await studio.post('/api/scene', { type: 'seqStop' });
  assert.deepEqual(page.errors, []);
});
