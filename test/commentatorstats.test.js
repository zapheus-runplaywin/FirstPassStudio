// The Commentator stats page's layout (commentatorstats.html): the team lists' column is as wide as the moments
// column on the right, and a list too tall for its box (a bench of three, long names) is scaled down but still fills
// its box's width, so the names get that room instead of being cut short (Matt, 2026-11-01).
const test = require('node:test');
const assert = require('node:assert/strict');
// The browser comes from support/browser.js, so the test is skipped where there is none (the Mac app build).
const { startStudio } = require('./support/studio');
const { openBrowser } = require('./support/browser');

test('team lists match the moments column and fill their width when scaled down', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.goto(`${studio.base}/commentatorstats.html?refresh=0`);
  await page.waitForFunction(() => document.querySelectorAll('#home .player').length >= 7, null, { timeout: 15000 });

  const widths = await page.evaluate(() => ({ teams: document.getElementById('teams').offsetWidth, moments: document.getElementById('moments').offsetWidth }));
  assert.equal(widths.teams, widths.moments, 'the team lists are as wide as the moments');

  // A real line up: long names and a bench of three, so the list has to shrink to fit.
  const fit = await page.evaluate(() => {
    const names = ['Brooklyn-Rose Whittaker', 'Mackenzie Fitzgerald', 'Charlotte Vandenberg', 'Georgia McAllister-Brown'];
    for (const side of ['home', 'away']) {
      const list = document.querySelector(`#${side} .team__list`); const first = list.querySelector('.player');
      list.querySelectorAll('.pname').forEach((n, i) => { n.textContent = names[i % names.length]; });
      list.append(Object.assign(document.createElement('li'), { className: 'team__bench', textContent: 'Bench' }));
      for (let i = 0; i < 3; i++) { const r = first.cloneNode(true); r.querySelector('.pname').textContent = names[i]; list.append(r); }
    }
    dispatchEvent(new Event('resize'));
    return ['home', 'away'].map(id => {
      const e = document.getElementById(id), box = e.parentElement.getBoundingClientRect(), r = e.getBoundingClientRect();
      return { id, scale: Number(e.style.scale || 1), left: r.left - box.left, right: box.right - r.right, bottom: box.bottom - r.bottom,
        cut: [...e.querySelectorAll('.pname')].filter(n => n.scrollWidth > n.clientWidth).map(n => n.textContent) };
    });
  });
  for (const f of fit) {
    assert.ok(f.scale < 1, `${f.id}: the longer list is scaled down (${f.scale})`);
    assert.ok(Math.abs(f.left) < 1 && Math.abs(f.right) < 2, `${f.id}: fills its box's width (${f.left}, ${f.right})`);
    assert.ok(f.bottom > -1, `${f.id}: fits its box's height (${f.bottom})`);
    assert.deepEqual(f.cut, [], `${f.id}: no name is cut short`);
  }
});

// Every moment a goal makes is listed, not just the one the stream plays: a third in a row that also takes the lead shows
// "Lead change" and "heating up" (Matt, 2026-11-03: heating up and the like weren't coming through). And a page opened part
// way through a game starts with that game's moments so far.
test('moments: every moment a goal makes, and the earlier ones after a reload', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.goto(`${studio.base}/commentatorstats.html?refresh=0`);
  await page.waitForFunction(() => document.querySelectorAll('#home .player').length >= 1);
  const moments = () => page.$$eval('#momentList .t', ts => ts.map(e => e.textContent));
  for (const side of ['away', 'away', 'home', 'home', 'home']) await studio.post('/api/scoreboard', { type: 'score', side, delta: 1 });
  await page.waitForFunction(() => document.querySelectorAll('#momentList .t').length >= 2);
  const live = await moments();
  assert.ok(live.some(m => /^Lead change: .+ hit the front$/.test(m)), `lead change listed: ${live}`);
  assert.ok(live.some(m => /heating up: 3 in a row$/.test(m)), `heating up listed: ${live}`);

  // A super shot (home's fourth in a row, no new moment), then a reload: the list comes back with this game's moments, each at its own game time.
  await studio.post('/api/scoreboard', { type: 'score', side: 'home', delta: 2 });
  await page.waitForFunction(() => [...document.querySelectorAll('#momentList .t')].some(e => /^Super shot/.test(e.textContent)));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#momentList .t').length >= 3);
  const after = await moments();
  assert.equal(after.filter(m => /^Lead change/.test(m)).length, 1, `lead change once: ${after}`);
  assert.equal(after.filter(m => /heating up/.test(m)).length, 1, `heating up once: ${after}`);
  assert.equal(after.filter(m => /^Super shot/.test(m)).length, 1, `super shot once: ${after}`);
  const when = await page.$$eval('#momentList .ago', e => e.map(x => x.textContent));
  assert.ok(when.every(w => /^Q1 \d+:\d\d/.test(w)), `each has its quarter and game time: ${when}`);
});

// At a break the pill under the clock counts down for the commentary team (Matt, 2026-11-04): from when the clock hits
// 0:00, by the setup's break minutes, through the quarter moving on, until the clock runs again.
test('the pill under the clock counts down to the end of a break', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.goto(`${studio.base}/commentatorstats.html?refresh=0`);
  const pill = () => page.$eval('#super', e => (e.hidden ? '' : e.textContent));

  await studio.post('/api/scoreboard', { type: 'clockSet', secondsLeft: 0 });
  await page.waitForFunction(() => /^Back in 2:5\d · Quarter time$/.test(document.getElementById('superText').textContent));
  const b = await studio.get('/api/scoreboard');
  assert.equal(b.countdown.kind, 'break');
  assert.ok(Math.abs(b.countdown.at - b.breakFrom.at - 3 * 60000) < 1, 'three minutes from the clock hitting 0:00');

  // The quarter moving on during the break keeps the countdown; the clock running ends it.
  await studio.post('/api/scoreboard', { type: 'period', value: 'next' });
  await studio.post('/api/scoreboard', { type: 'clockReset' });
  assert.equal((await studio.get('/api/scoreboard')).countdown.at, b.countdown.at);
  assert.match(await pill(), /^Back in /);
  await studio.post('/api/scoreboard', { type: 'clockStart' });
  await page.waitForFunction(() => !/Back in/.test(document.getElementById('superText').textContent) || document.getElementById('super').hidden);
  assert.equal((await studio.get('/api/scoreboard')).countdown, null);
});
