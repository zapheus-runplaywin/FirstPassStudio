// Last 10 goals sits where ?y= (top, middle, bottom) and ?x= (left, center, right) say, in either layout: in the space
// between the title and the scoreboard (fit.js: 244px to 894px), 60px in from the sides. Its old single position
// option mixed the two layouts, so most of its choices did nothing (Matt, 2026-11-03).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio.mts');
const { openPage } = require('./support/browser.mts');

const TOP = 244, BOTTOM = 894, MARGIN = 60, NEAR = 2;

test('the last 10 goals goes where Up and down and Across put it, horizontal and vertical', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const p = await openPage(t, studio, '/goals.html');
  if (!p) return;
  await p.setViewportSize({ width: 1920, height: 1080 });
  const boxOf = async query => {
    await p.goto(`${studio.base}/goals.html?${query}`);
    await p.waitForFunction(() => !document.getElementById('card').hidden);
    await p.waitForTimeout(700); // the rise animation
    return p.evaluate(() => { const r = document.getElementById('card').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
  };
  const near = (got, want, what) => assert.ok(Math.abs(got - want) <= NEAR, `${what}: ${Math.round(got)}, not ${want}`);
  for (const layout of ['', 'layout=vertical&']) {
    const name = layout ? 'vertical' : 'horizontal';
    let b = await boxOf(`${layout}x=left&y=top`);
    near(b.left, MARGIN, `${name} left`); near(b.top, TOP, `${name} top`);
    b = await boxOf(`${layout}x=right&y=bottom`);
    near(b.right, 1920 - MARGIN, `${name} right`); near(b.bottom, BOTTOM, `${name} bottom`);
    b = await boxOf(`${layout}x=center&y=middle`);
    near((b.left + b.right) / 2, 960, `${name} centre`); near((b.top + b.bottom) / 2, (TOP + BOTTOM) / 2, `${name} middle`);
  }
  // The defaults: horizontal bottom centre, just above the scoreboard; vertical middle right.
  let b = await boxOf('');
  near((b.left + b.right) / 2, 960, 'horizontal default centre'); near(b.bottom, BOTTOM, 'horizontal default bottom');
  b = await boxOf('layout=vertical');
  near(b.right, 1920 - MARGIN, 'vertical default right'); near((b.top + b.bottom) / 2, (TOP + BOTTOM) / 2, 'vertical default middle');
  assert.deepEqual(p.errors, []);
});
