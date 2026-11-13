// The countdown's mini size and its 3 x 3 positions (countdown.html ?size=mini, ?position=): a small timer the size
// of the title banner, its middle level with the title in the top row, 100px in from the frame's edges at the sides
// (Matt, 2026-11-04). The full card takes the same positions. In a real browser; skipped without one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio.mts');
const { openBrowser } = require('./support/browser.mts');

test('mini countdown: the title banner\'s size, in each of the nine spots', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const g = await studio.get('/api/countdown');
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  // 4 minutes 32 seconds to go, whatever the test game's start: Studio's answer with the start moved (leftMs from now).
  // Long team names (names) when a check needs them.
  let leftMs = 272400;
  let names = null;
  await context.route(url => String(url).startsWith(`${studio.base}/api/countdown`), async route => {
    const res = await route.fetch();
    const body = await res.json();
    const teams = names ? { home: { ...body.home, name: names[0] }, away: { ...body.away, name: names[1] } } : {};
    route.fulfill({ response: res, json: { ...body, ...teams, start: body.serverNow + leftMs } });
  });
  const open = async query => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${studio.base}/countdown.html?${query}`);
    await page.waitForFunction(() => !document.getElementById('mini').hidden || !document.getElementById('card').hidden);
    await page.waitForTimeout(700);
    t.after(() => page.close());
    return { page, errors };
  };
  const box = (page, id) => page.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2, centre: (r.left + r.right) / 2, width: r.width }; }, id);

  const { page, errors } = await open('size=mini');
  assert.equal(await page.isVisible('#card'), false, 'the big card stays hidden');
  assert.equal(await page.textContent('#miniTime'), '4:32');
  assert.equal(await page.textContent('#miniLabel'), 'Starting in');
  assert.equal(await page.textContent('#miniTeams'), `${g.home.name} v ${g.away.name}`);
  const b = await box(page, 'mini');
  assert.ok(b.width < 600 && b.width > 450, `drawn at the title's 80% (${b.width}px wide)`);
  assert.ok(Math.abs(b.centre - 960) <= 1 && Math.abs(b.mid - 540) <= 1, `the middle by default (${b.centre}, ${b.mid})`);
  assert.deepEqual(errors, []);

  // Long team names scale it down further, no wider than 600px, so at the top it still fits between the branding logos.
  names = ['Travis\' Disciples Reserves', 'The Mighty Blizzardz United'];
  const long = await open('size=mini');
  assert.equal(await long.page.textContent('#miniTeams'), 'Travis\' Disciples Reserves v The Mighty Blizzardz United');
  assert.ok((await box(long.page, 'mini')).width <= 600.5, 'long names: no wider than 600px');
  names = null;
  await long.page.close();

  const spots = {
    'top-left': b => Math.abs(b.left - 100) <= 1 && Math.abs(b.mid - 95) <= 1,
    top: b => Math.abs(b.centre - 960) <= 1 && Math.abs(b.mid - 95) <= 1,
    'top-right': b => Math.abs(b.right - 1820) <= 1 && Math.abs(b.mid - 95) <= 1,
    left: b => Math.abs(b.left - 100) <= 1 && Math.abs(b.mid - 540) <= 1,
    right: b => Math.abs(b.right - 1820) <= 1 && Math.abs(b.mid - 540) <= 1,
    'bottom-left': b => Math.abs(b.left - 100) <= 1 && Math.abs(b.mid - 985) <= 1,
    bottom: b => Math.abs(b.centre - 960) <= 1 && Math.abs(b.mid - 985) <= 1,
    'bottom-right': b => Math.abs(b.right - 1820) <= 1 && Math.abs(b.mid - 985) <= 1,
  };
  for (const [spot, ok] of Object.entries(spots)) {
    const { page } = await open(`size=mini&position=${spot}`);
    const at = await box(page, 'mini');
    assert.ok(ok(at), `${spot}: ${JSON.stringify(at)}`);
  }

  // Clock only, and no sponsor (no room under it).
  const bare = await open('size=mini&teams=0');
  assert.equal(await bare.page.isVisible('#miniTeams'), false);
  assert.equal(await bare.page.isVisible('#sponsor'), false);

  // At zero: the words at zero, or gone with ?end=hide.
  leftMs = -1000;
  const end = await open('size=mini&end=Game%20on');
  await end.page.waitForFunction(() => document.getElementById('miniTime').textContent === 'Game on');
  const hide = await open('size=mini&end=hide');
  await hide.page.waitForFunction(() => document.getElementById('mini').classList.contains('is-gone'));

  // The full card takes the side spots too: 100px in from the edge.
  leftMs = 272400;
  const full = await open('position=bottom-right');
  const card = await box(full.page, 'card');
  assert.ok(Math.abs(card.right - 1820) <= 1, `the card sits 100px in from the right (${card.right})`);
});
