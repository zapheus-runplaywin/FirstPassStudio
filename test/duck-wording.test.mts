// One word for getting the music out of the way: Duck. The scene's and the sequence's tick says Ducks the music (its
// settings key stays quiet), a mic that a mixer fades says Never ducks, the stinger's choices both duck, and the
// status board says why the music is ducked in the same words. Nothing says "quiet the music" any more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio } from './support/studio.mts';
import { openPage } from './support/browser.mts';

test('the Output page says Duck for every way the music gets out of the way', async t => {
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  const label = (id: string) => page.$eval(`#${id}`, el => el.closest('label')!.textContent.replace(/\s+/g, ' ').trim());
  assert.match(await label('sdQuiet'), /^Ducks the music/);
  assert.match(await label('sqQuiet'), /^Ducks the music when this starts/);
  assert.equal(await page.$eval('label[for="sqQuiet"]', el => el.textContent), 'Duck');
  assert.match(await label('mxMixer'), /^Never ducks \(an external mixer does it\)$/);
  assert.deepEqual(await page.$$eval('#swStingerMusic option', os => os.map(o => o.textContent)), ['Carries on as it is', 'Ducks for the next scene', 'Ducks while it plays']);
  const text = (await page.content()).toLowerCase();
  assert.ok(!/quiet(s|ed)? (the music|for the next)/.test(text), 'no "quiet the music" left on the page');
  assert.deepEqual(page.errors, []);
});
