// The Commentator stats page's layout (commentatorstats.html): the team lists' column is as wide as the moments
// column on the right, and a list too tall for its box (a bench of three, long names) is scaled down but still fills
// its box's width, so the names get that room instead of being cut short (Matt, 2026-11-01).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('team lists match the moments column and fill their width when scaled down', async t => {
  if (!chromium) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('playwright is not installed');
    t.skip('playwright is not installed'); return;
  }
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined });
  t.after(() => browser.close());
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
