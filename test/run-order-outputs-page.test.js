// The Run order panel with more than one output (public/output/runorder.js): a sequence that plays on other outputs
// too says so on its row, with what each other output does after it (its own run order, else its own Then).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

test('Run order: a row says which other outputs also play the sequence and what each does after it', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.request('POST', '/api/outputs', { add: true });
  const two = (await studio.get('/api/outputs')).outputs[1];
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }] });
  const ladder = (await studio.get('/api/scene')).sources.find(s => s.name === 'Ladder').id;
  await studio.post('/api/scene', { type: 'seqAdd', changes: { name: 'Commentary loop', steps: [{ sources: [ladder], length: { type: 'time', sec: 20 } }] } });
  const loop = (await studio.get('/api/scene')).sequences.find(s => s.name === 'Commentary loop').id;
  await studio.post('/api/scene', { type: 'seqAdd', changes: { name: 'Run-up', playsOn: ['main', two.id], then: { type: 'off' },
    thenOn: { [two.id]: { type: 'sequence', sequence: loop } }, steps: [{ sources: [ladder], length: { type: 'time', sec: 20 } }] } });
  await studio.post('/api/scene', { type: 'roAdd', kind: 'sequence', name: 'Run-up' });
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  await page.waitForSelector('#roList li small.also');
  assert.equal(await page.textContent('#roList li small.also'), `also on ${two.name} · then Commentary loop`);
});
