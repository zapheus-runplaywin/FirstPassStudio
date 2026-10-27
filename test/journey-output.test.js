// Operator journeys on the Output page: building the night's look (adding pages, turning them on and off,
// layers, scenes) and checking what the output itself (scene.html, what goes to the stream) shows after each
// click. The browser: see test/support/browser.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');
const { openBrowser, openPage } = require('./support/browser');

// The output as it is drawn: each layer's page and whether it's showing, bottom to top.
const layers = page => page.$$eval('.layer', els => els
  .map(el => ({ name: el.querySelector('iframe, img, video')?.title || '', on: el.classList.contains('on'), z: Number(el.style.zIndex) }))
  .sort((a, b) => a.z - b.z).map(l => `${l.name}${l.on ? ' on' : ''}`));
// Waits until the output shows these layers (and fails saying what it shows instead).
async function outputShows(page, want, timeout = 8000) {
  const end = Date.now() + timeout;
  let got;
  while (Date.now() < end) { got = await layers(page); if (JSON.stringify(got) === JSON.stringify(want)) return; await wait(100); }
  assert.deepEqual(got, want, 'what the output shows');
}
// The Sources list, top to bottom: name and On or Off.
const sourceList = page => page.$$eval('#sources li', lis => lis.map(li => `${li.querySelector('.name').firstChild.textContent} ${li.querySelector('.eye').textContent}`));
async function listShows(page, want, timeout = 5000) {
  const end = Date.now() + timeout;
  let got;
  while (Date.now() < end) { got = await sourceList(page); if (JSON.stringify(got) === JSON.stringify(want)) return; await wait(100); }
  assert.deepEqual(got, want, 'the Sources list');
}
// Waits for the "changes from saved" note to say this (it's redrawn as each change by hand arrives).
async function driftSays(page, re, timeout = 5000) {
  try { await page.waitForFunction(([src, flags]) => new RegExp(src, flags).test(document.querySelector('#drift').textContent), [re.source, re.flags], { timeout }); }
  catch { assert.match(await page.textContent('#drift'), re); }
}
const source = (page, name) => page.locator('#sources li', { has: page.locator('.name', { hasText: name }) });

async function addPage(page, file) {
  await page.click('#addBrowser');
  await page.selectOption('#newPage', file);
  await page.click('#addGo');
  await page.waitForFunction(() => !document.querySelector('#addDialog').open);
}
// + Save what's on now, named in the page's own dialog.
async function saveScene(page, name, button = '#scenes .addScene') {
  await page.click(button);
  await page.fill('dialog.fp-ask input', name);
  await page.click('dialog.fp-ask button[type=submit]');
  await page.waitForSelector(`#scenes button.scene:has-text("${name}")`);
}

async function setUp(t) {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const browser = await openBrowser(t);
  if (!browser) return {};
  const control = await openPage(t, studio, '/output.html', { browser });
  const output = await openPage(t, studio, '/scene.html', { browser });
  // The output on air never reloads as the operator works (a reload is a flash on the stream).
  output.reloads = 0;
  output.on('load', () => { output.reloads++; });
  return { studio, control, output };
}

test('building the night\'s look: pages added hidden, turned on and off, and the output follows each click', async t => {
  const { control, output } = await setUp(t);
  if (!control) return;
  await control.waitForSelector('#sources li.empty');
  await addPage(control, 'scoreboard.html');
  await addPage(control, 'ladder.html');
  // Each goes in hidden, above the one selected (the one just added).
  await listShows(control, ['Ladder Off', 'Scoreboard Off']);
  await outputShows(output, ['Scoreboard', 'Ladder']);
  await source(control, 'Scoreboard').locator('.eye').click();
  await listShows(control, ['Ladder Off', 'Scoreboard On']);
  await outputShows(output, ['Scoreboard on', 'Ladder']);
  assert.match(await output.getAttribute('.layer.on iframe', 'src'), /scoreboard\.html/);
  await source(control, 'Ladder').locator('.eye').click();
  await outputShows(output, ['Scoreboard on', 'Ladder on']);
  // Hide all: nothing on the stream.
  await control.click('#hideAll');
  await outputShows(output, ['Scoreboard', 'Ladder']);
  await listShows(control, ['Ladder Off', 'Scoreboard Off']);
  assert.deepEqual(control.errors, []);
  assert.deepEqual(output.errors, []);
});

test('layers: moving a source up or down changes what covers what on the output, and it stays after a reload', async t => {
  const { control, output } = await setUp(t);
  if (!control) return;
  await control.waitForSelector('#sources li.empty');
  for (const p of ['scoreboard.html', 'ladder.html', 'fixtures.html']) await addPage(control, p);
  await listShows(control, ['Round fixture Off', 'Ladder Off', 'Scoreboard Off']);
  // The top one can't go up, the bottom one can't go down.
  assert.equal(await source(control, 'Round fixture').locator('.up').isDisabled(), true);
  assert.equal(await source(control, 'Scoreboard').locator('.down').isDisabled(), true);
  await source(control, 'Scoreboard').locator('.up').click();
  await listShows(control, ['Round fixture Off', 'Scoreboard Off', 'Ladder Off']);
  await outputShows(output, ['Ladder', 'Scoreboard', 'Round fixture']);
  await source(control, 'Round fixture').locator('.down').click();
  await listShows(control, ['Scoreboard Off', 'Round fixture Off', 'Ladder Off']);
  await outputShows(output, ['Ladder', 'Round fixture', 'Scoreboard']);
  await control.reload({ waitUntil: 'load' });
  await listShows(control, ['Scoreboard Off', 'Round fixture Off', 'Ladder Off']);
  assert.deepEqual(control.errors, []);
});

test('scenes: save the looks, go between them, see what changed by hand, and go back to saved', async t => {
  const { control, output } = await setUp(t);
  if (!control) return;
  await control.waitForSelector('#sources li.empty');
  await addPage(control, 'scoreboard.html');
  await addPage(control, 'ladder.html');
  // Live: the scoreboard on its own.
  await source(control, 'Scoreboard').locator('.eye').click();
  await saveScene(control, 'Live');
  assert.equal(await control.textContent('#scenes button.scene:has-text("Live") small'), '1 on · 1 off');
  // Quarter time: the ladder on its own.
  await source(control, 'Scoreboard').locator('.eye').click();
  await source(control, 'Ladder').locator('.eye').click();
  await driftSays(control, /2 changes from saved Live: Ladder on, Scoreboard off\./);
  await control.click('#drift .asNew');
  await control.fill('dialog.fp-ask input', 'Quarter time');
  await control.click('dialog.fp-ask button[type=submit]');
  await control.waitForSelector('#scenes button.scene.cur:has-text("Quarter time")');
  await outputShows(output, ['Scoreboard', 'Ladder on']);
  // Going to a scene puts the output back to its look.
  await control.click('#scenes button.scene:has-text("Live")');
  await outputShows(output, ['Scoreboard on', 'Ladder']);
  await control.waitForSelector('#scenes button.scene.cur:has-text("Live")');
  assert.equal(await control.isVisible('#drift'), false);
  // A change by hand shows as changed; Back to saved undoes it.
  await source(control, 'Ladder').locator('.eye').click();
  await outputShows(output, ['Scoreboard on', 'Ladder on']);
  await control.waitForSelector('#scenes button.scene.cur.changed:has-text("Live")');
  await driftSays(control, /1 change from saved Live: Ladder on\./);
  await control.click('#drift .back');
  await outputShows(output, ['Scoreboard on', 'Ladder']);
  // Save over: Live now has both on.
  await source(control, 'Ladder').locator('.eye').click();
  await control.waitForSelector('#drift:not(.hidden)');
  await control.click('#drift .over');
  await control.waitForSelector('#drift.hidden', { state: 'attached' });
  await control.click('#scenes button.scene:has-text("Quarter time")');
  await outputShows(output, ['Scoreboard', 'Ladder on']);
  await control.click('#scenes button.scene:has-text("Live")');
  await outputShows(output, ['Scoreboard on', 'Ladder on']);
  assert.deepEqual(control.errors, []);
  assert.deepEqual(output.errors, []);
});

test('Edit scenes: a cell set to Leave keeps that source as it is, Copy makes a copy, and Delete asks first', async t => {
  const { studio, control, output } = await setUp(t);
  if (!control) return;
  await control.waitForSelector('#sources li.empty');
  await addPage(control, 'scoreboard.html');
  await addPage(control, 'ladder.html');
  await source(control, 'Scoreboard').locator('.eye').click();
  await saveScene(control, 'Live');
  await control.click('#editScenes');
  await control.waitForSelector('#sceneGrid table');
  // Live's Ladder cell is Off; one click makes it Leave (the grid changes the saved scene, not what's on now).
  const ladderCell = control.locator('#sceneGrid tbody tr', { hasText: 'Ladder' }).locator('button.cell');
  assert.equal(await ladderCell.textContent(), 'Off');
  await ladderCell.click();
  await control.waitForFunction(() => [...document.querySelectorAll('#sceneGrid tbody tr')].find(r => r.textContent.includes('Ladder'))?.querySelector('button.cell')?.textContent === 'Leave');
  await outputShows(output, ['Scoreboard on', 'Ladder']);
  // Now the ladder stays on when Live is picked.
  await source(control, 'Ladder').locator('.eye').click();
  await control.click('#scenes button.scene:has-text("Live")');
  await wait(500);
  await outputShows(output, ['Scoreboard on', 'Ladder on']);
  // Copy, then Delete the copy: Cancel keeps it, OK deletes it.
  await control.click('#sceneGrid th .copy');
  await control.waitForSelector('#scenes button.scene:has-text("Live copy")');
  control.once('dialog', d => d.dismiss());
  await control.locator('#sceneGrid th').nth(2).locator('.del').click();
  await wait(300);
  assert.equal((await studio.get('/api/scene')).scenes.length, 2);
  control.once('dialog', d => d.accept());
  await control.locator('#sceneGrid th').nth(2).locator('.del').click();
  await control.waitForFunction(() => document.querySelectorAll('#scenes button.scene:not(.addScene)').length === 1);
  // Renamed in the grid.
  await control.fill('#sceneGrid th input', 'Live play');
  await control.press('#sceneGrid th input', 'Enter');
  await control.waitForSelector('#scenes button.scene:has-text("Live play")');
  assert.deepEqual(control.errors, []);
});

test('a quarter-break sequence built in the editor: Save and play runs its steps on the output, Next moves on, and it tidies up', async t => {
  const { studio, control, output } = await setUp(t);
  if (!control) return;
  await control.waitForSelector('#sources li.empty');
  for (const p of ['scoreboard.html', 'ladder.html', 'fixtures.html']) await addPage(control, p);
  await source(control, 'Scoreboard').locator('.eye').click();
  await saveScene(control, 'Live');
  // + New sequence: Ladder for 2 seconds, then the fixture until Next, then back to Live.
  await control.click('#seqs .addSeq');
  await control.fill('#sqName', 'Quarter break');
  await control.click('#sqAddStep');
  await control.selectOption('#sqSteps .stepRow >> nth=0 >> select[aria-label="Add a source"]', { label: 'Ladder' });
  await control.fill('#sqSteps .stepRow >> nth=0 >> .sec', '2');
  await control.click('#sqAddStep');
  await control.selectOption('#sqSteps .stepRow >> nth=1 >> select[aria-label="Add a source"]', { label: 'Round fixture' });
  await control.selectOption('#sqSteps .stepRow >> nth=1 >> .type', 'next');
  await control.selectOption('#sqThen', { label: 'Go to scene: Live' });
  await control.click('#sqTry');
  // Step 1: the ladder over the scoreboard.
  await control.waitForSelector('#seqs .seq.run');
  await outputShows(output, ['Scoreboard on', 'Ladder on', 'Round fixture']);
  assert.match(await control.textContent('#seqs .seq.run .nowLine'), /^1 of 2 · Ladder/);
  // Step 2 after 2 seconds: the fixture, and it waits for Next.
  await outputShows(output, ['Scoreboard on', 'Ladder', 'Round fixture on'], 6000);
  await wait(1500);
  await outputShows(output, ['Scoreboard on', 'Ladder', 'Round fixture on']);
  await control.click('#seqs .seq.run .next');
  // Then: back to Live, and the card is ready to play again.
  await outputShows(output, ['Scoreboard on', 'Ladder', 'Round fixture']);
  await control.waitForSelector('#seqs .seq:not(.run) .play');
  assert.match(await control.textContent('#seqs .seq:not(.addSeq) small'), /2 steps · runs at least 0:02 · .* · then Live$/);
  // Stop part way: the step's sources go off as its Then says.
  await control.click('#seqs .seq .play');
  await outputShows(output, ['Scoreboard on', 'Ladder on', 'Round fixture']);
  await control.click('#seqs .seq.run .stop');
  await outputShows(output, ['Scoreboard on', 'Ladder', 'Round fixture']);
  // Copy from the editor, then delete the copy (it asks first).
  await control.click('#seqs .seq .edit');
  await control.click('#sqCopy');
  await control.waitForSelector('#seqs .seq b:has-text("Quarter break copy")');
  await control.locator('#seqs .seq', { hasText: 'Quarter break copy' }).locator('.edit').click();
  control.once('dialog', d => d.accept());
  await control.click('#sqDelete');
  await control.waitForFunction(() => document.querySelectorAll('#seqs .seq:not(.addSeq)').length === 1);
  assert.deepEqual((await studio.get('/api/scene')).sequences.map(s => s.name), ['Quarter break']);
  await wait(5500); // the pages check for a new version every 5 seconds
  assert.equal(output.reloads, 0, 'saving sequences didn\'t reload the output');
  assert.deepEqual(control.errors, []);
  assert.deepEqual(output.errors, []);
});

test('the sequence editor won\'t save a sequence without a name or steps, and says why', async t => {
  const { control } = await setUp(t);
  if (!control) return;
  await control.waitForSelector('#sources li.empty');
  await control.click('#seqs .addSeq');
  await control.click('#sqSave');
  assert.equal(await control.textContent('#sqErr'), 'Give the sequence a name.');
  await control.fill('#sqName', 'Walk out');
  await control.click('#sqSave');
  assert.equal(await control.textContent('#sqErr'), 'Add at least one step.');
  await control.click('#sqAddScene');
  await control.click('#sqSave');
  assert.equal(await control.textContent('#sqErr'), 'Pick a scene for each scene step.');
  assert.equal(await control.isVisible('#seqDialog'), true, 'still open, nothing lost');
});
