// A name cut short on a Studio page shows in full as a tooltip on hover (public/studiobar.js), so the operator never
// clicks a source just to read its name. Only cut names get one, and a source's shows its name without the type tag.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

test('a cut source name shows in full on hover; a name that fits gets no tooltip', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const long = 'Live game stats with the shooting percentages for both teams'; // 60 letters, the most a name keeps
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: long, url: 'title.html' }, { type: 'browser', name: 'Ad', url: 'title.html' }] });
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  await page.setViewportSize({ width: 1440, height: 900 }); // the 13" Mac
  const name = n => page.locator('.sources li .name', { hasText: new RegExp(`^${n}page$`) }).first();
  await page.waitForSelector('.sources li .name');
  await name(long).waitFor();
  await name(long).hover();
  assert.equal(await name(long).getAttribute('title'), long, 'the whole name, without its "page" tag');
  await name('Ad').hover();
  assert.equal(await name('Ad').getAttribute('title'), null, 'it fits: no tooltip');
});
