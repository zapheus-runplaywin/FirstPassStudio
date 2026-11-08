// The Remote (remote.html): the Output page's status and a Stream Deck's keys on a phone. It shows what's on air, the
// game, the sequence playing and the run order; Play next, Skip, Next step, Pause and Stop do what the Output page's
// do; each sequence's key plays it and lights while it plays, and a second press stops it. A phone that isn't allowed
// to change things is pointed at pairing.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('the Remote shows the status, plays and stops sequences by their keys and drives the run order', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Remote in');
    t.skip('no browser to test the Remote in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t);
  const post = a => studio.post('/api/scene', a);
  // Two sequences of two steps that each wait for Next, so they stay on until stopped, and nothing after them.
  for (const name of ['Pre-game', 'Quarter break']) {
    await post({ type: 'seqAdd', changes: { name, colour: name === 'Pre-game' ? 'green' : 'purple', then: { type: 'off' }, steps: [{ sources: [], length: { type: 'next' } }, { sources: [], length: { type: 'next' } }] } });
  }
  const seqs = (await studio.get('/api/scene')).sequences;
  assert.equal(seqs.length, 2);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${studio.base}/remote.html`);
  await page.waitForSelector('#keys button');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'nothing sticks out sideways');
  await page.waitForFunction(() => /Off air/.test(document.getElementById('status').textContent));
  assert.deepEqual(await page.$$eval('#keys button', bs => bs.map(b => b.textContent)), ['Pre-game', 'Quarter break']);
  assert.equal(await page.isDisabled('#seqStop'), true, 'nothing to stop');

  // A key plays its sequence and lights; Next steps it; a second press stops it.
  await page.click('#keys button >> text=Quarter break');
  await page.waitForSelector('#keys button.on');
  const playing = async () => (await studio.get('/api/scene')).playing;
  assert.equal((await playing()).id, seqs.find(s => s.name === 'Quarter break').id);
  assert.match(await page.textContent('#keys button.on'), /ON · 1\/2/);
  await page.click('#seqNext');
  await page.waitForFunction(() => /2\/2/.test(document.querySelector('#keys button.on')?.textContent || ''));
  await page.click('#seqPause');
  await page.waitForFunction(() => document.getElementById('seqPause').textContent === 'Carry on');
  assert.equal((await playing()).paused, true);
  await page.click('#seqPause');
  await page.click('#keys button.on');
  await page.waitForFunction(() => !document.querySelector('#keys button.on'));
  assert.equal(await playing(), null);

  // The run order: Play next plays its head, Skip drops one without playing it.
  for (const s of seqs) await post({ type: 'roAdd', kind: 'sequence', sequence: s.id, output: 'main' });
  await page.waitForFunction(() => /▶ Pre-game/.test(document.getElementById('roHead').textContent));
  assert.match(await page.textContent('#roHead'), /then Quarter break/);
  await page.click('#roNext');
  await page.waitForFunction(() => /Pre-game/.test(document.querySelector('#keys button.on')?.textContent || ''));
  await page.waitForFunction(() => /▶ Quarter break/.test(document.getElementById('roHead').textContent));
  await page.click('#roSkip');
  await page.waitForFunction(() => /^Empty/.test(document.getElementById('roHead').textContent));
  await page.waitForFunction(() => /Pre-game/.test(document.getElementById('status').textContent));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  // Refused (a phone that isn't paired, with the lock on): it says how to pair, and comes back here after.
  await page.route(url => new URL(url).pathname === '/api/scene', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 403, json: { error: 'Studio is set to take changes only from this computer' } }) : route.continue());
  await page.click('#seqStop');
  await page.waitForSelector('#err:not([hidden])');
  assert.equal(await page.getAttribute('#err a', 'href'), '/pair.html?then=%2Fremote.html');
});

test('on Manual the Remote has the scores, clock and quarter keys, and hides them while following PlayHQ', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Remote in');
    t.skip('no browser to test the Remote in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const g = studio.world.divisions[0].rounds[0].games[0];
  const sb = a => studio.post('/api/scoreboard', a);
  await sb({ type: 'selectGame', game: { id: g.id, roundId: g.roundId, division: g.division, court: g.court, date: g.date, time: g.time, home: { name: g.home }, away: { name: g.away } } });
  await sb({ type: 'source', value: 'playhq' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${studio.base}/remote.html`);
  await page.waitForFunction(() => /Following PlayHQ|PlayHQ/.test(document.getElementById('status').textContent));
  assert.equal(await page.isHidden('#scoreCard'), true, 'no scoring keys while following PlayHQ');

  await sb({ type: 'source', value: 'manual' });
  await sb({ type: 'resetScores' });
  await page.waitForSelector('#scoreCard:not([hidden])');
  assert.equal(await page.textContent('#homeName'), g.home);
  await page.waitForSelector('#scoreCard .super:not([hidden])'); // Thunder League's super shots are worth 2
  const board = () => studio.get('/api/scoreboard');
  await page.click('#scoreCard [data-side=home][data-delta="2"]');
  await page.click('#scoreCard [data-side=away][data-delta="1"]');
  await page.click('#scoreCard [data-side=away][data-delta="1"]');
  await page.click('#scoreCard [data-side=away][data-delta="-1"]');
  let b = await board();
  assert.deepEqual([Number(b.home.score), Number(b.away.score)], [2, 1]);
  await page.waitForFunction(() => document.getElementById('homePts').textContent === '2');
  await page.click('#clockToggle');
  assert.equal((await board()).clock.running, true);
  await page.waitForFunction(() => document.getElementById('clockToggle').textContent === 'Stop clock');
  await page.click('#clockToggle');
  assert.equal((await board()).clock.running, false);
  const was = (await board()).period;
  await page.click('#nextPeriod');
  assert.equal((await board()).period, was + 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'nothing sticks out sideways');
  if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2, fullPage: true });

  await sb({ type: 'source', value: 'playhq' });
  await page.waitForSelector('#scoreCard[hidden]', { state: 'attached' });
});
