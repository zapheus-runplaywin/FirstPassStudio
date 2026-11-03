// The Output page's sections right of the Sources (public/output.html .cols): two columns that line up all the way
// down, each section sitting right under the one above it, so a short section leaves no hole beside a tall one.
// A section never changes column, whether folded or with its settings open. Checked at the stream Macs' widths
// (15" 1512, 13" 1440), and on a narrow window.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

const NARROW = ['scenesSection', 'musicSection', 'duckSection'];
const WIDE = ['seqSection', 'micsSection', 'swSection', 'mediaSection'];

const boxes = page => page.evaluate(ids => ids.map(id => {
  const r = document.getElementById(id).getBoundingClientRect();
  return { id, left: Math.round(r.left), width: Math.round(r.width), top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY) };
}), [...NARROW, ...WIDE]);

function packed(all, ids) {
  const col = ids.map(id => all.find(b => b.id === id));
  assert.equal(new Set(col.map(b => b.left)).size, 1, `${ids.join(', ')} share a left edge`);
  assert.equal(new Set(col.map(b => b.width)).size, 1, `${ids.join(', ')} share a width`);
  for (let i = 1; i < col.length; i++) {
    const gap = col[i].top - col[i - 1].bottom;
    assert.ok(gap >= 0 && gap <= 16, `${col[i].id} sits right under ${col[i - 1].id} (gap ${gap}px)`);
  }
  return col;
}

test('Output page: Scenes, Music and Ducking stack in one column, Sequences, Mics, Switcher and Media in the other', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const { sources } = await studio.post('/api/scene', { type: 'add', sources: ['Ladder', 'Fixtures', 'Title'].map(name => ({ type: 'browser', name, url: 'title.html' })) });
  for (let i = 0; i < 7; i++) await studio.post('/api/scene', { type: 'seqAdd', changes: { name: `Sequence ${i + 1}`, steps: [{ sources: [sources[i % 3].id], length: { type: 'time', sec: 30 } }] } });
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  await page.waitForSelector('#seqs .seq');

  for (const width of [1512, 1440]) {
    await page.setViewportSize({ width, height: 982 });
    const all = await boxes(page);
    const narrow = packed(all, NARROW), wide = packed(all, WIDE);
    assert.ok(narrow[0].left < wide[0].left, 'Scenes, Music and Ducking on the left');
    assert.ok(narrow[0].width < wide[0].width, 'the sequences get the wider column');
    assert.equal(narrow[0].top, wide[0].top, 'the two columns start level');
    // The music player keeps its buttons in the narrower column.
    assert.equal(await page.evaluate(() => { const m = document.getElementById('musicSection'); return m.scrollWidth <= m.clientWidth + 1; }), true, `the music fits at ${width}px`);
  }

  // Folding Sequences pulls Mics up under it; the other column stays put.
  const before = await boxes(page);
  await page.click('#seqSection h2');
  await page.waitForFunction(() => document.getElementById('seqSection').classList.contains('folded'));
  const after = await boxes(page);
  packed(after, WIDE);
  assert.ok(after.find(b => b.id === 'micsSection').top < before.find(b => b.id === 'micsSection').top, 'Mics moves up');
  assert.deepEqual(after.filter(b => NARROW.includes(b.id)), before.filter(b => NARROW.includes(b.id)), 'the narrow column stays put');
  await page.click('#seqSection h2');
  await page.waitForFunction(() => !document.getElementById('seqSection').classList.contains('folded'));

  // Opening a section's settings only makes it taller: nothing changes column.
  const shut = await boxes(page);
  for (const cfg of ['#musicCfg', '#duckCfg', '#swSetup']) {
    await page.click(cfg);
    const open = await boxes(page);
    packed(open, NARROW); packed(open, WIDE);
    assert.deepEqual(open.map(b => [b.id, b.left, b.width]), shut.map(b => [b.id, b.left, b.width]), `${cfg}: every section keeps its column`);
    await page.click(cfg);
  }

  // A narrow window: one column, in the page's order.
  await page.setViewportSize({ width: 700, height: 900 });
  const one = await boxes(page);
  assert.equal(new Set(one.map(b => b.left)).size, 1, 'one column');
  const order = [...one].sort((a, b) => a.top - b.top).map(b => b.id);
  assert.deepEqual(order, [...NARROW, ...WIDE]);
});
