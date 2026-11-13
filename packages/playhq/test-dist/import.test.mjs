// The built ES module, as an ESM consumer (or a bundler) imports it. Run after `npm run build`.
import test from 'node:test';
import assert from 'node:assert';
import { createKeeper, parseSeasonLink, parseGame } from '../dist/index.js';

test('import gives the same API as require', async () => {
  assert.deepEqual(parseSeasonLink('playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d'), {
    tenant: 'netball-australia', seasonCode: 'ec69e46d', url: 'https://www.playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d',
  });
  const g = parseGame({ id: 'g', status: { value: 'FINAL' }, home: { id: 'h', name: 'H' }, away: { id: 'a', name: 'A' }, result: { home: { score: 30 }, away: { score: 20 } } });
  assert.equal(g.home.score, 30);
  const keep = createKeeper();
  assert.equal((await keep.get('k', 1000, async () => 1)).value, 1);
});
