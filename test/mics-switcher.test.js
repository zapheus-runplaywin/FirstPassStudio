// Mics plugged into the ATEM switcher (mics.js, switcher.js), against the stand-in switcher (test/support/atem.js):
// Studio lists the switcher's mic inputs (not a camera's embedded sound), takes each fader as it finds it rather than
// moving it on connecting, moves it for the level, mutes and dips (fading in steps), follows a fader moved on the
// switcher, moves the left or right half of a split input, and says plainly what's wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');
const { startAtem } = require('./support/atem');

const MIC1 = '1301:-65280';

async function setUp(t, opts = {}) {
  const atem = await startAtem(opts);
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  await studio.until(async () => (await studio.get('/api/switcher')).state === 'connected', 8000, 100);
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  const mics = async () => (await studio.get('/api/scene')).mics;
  const live = () => studio.get('/api/scene/mics/live');
  return { atem, studio, act, mics, live };
}

test('the switcher\'s mic inputs are listed, and a mic on one is taken as its fader is, then moved for level, mute and dip', async t => {
  const { atem, studio, act, mics, live } = await setUp(t);
  atem.setFader(MIC1, -600); // someone left Mic 1 at -6 dB
  const l = await studio.until(async () => { const x = await live(); return x.switcher.inputs.length && x; });
  assert.deepEqual(l.switcher.inputs.map(i => [i.id, i.name, i.split]), [[1301, 'Mic 1', false], [1302, 'Mic 2', false]], 'the mic jacks, not camera 1\'s sound');

  const before = atem.received.filter(r => r.name === 'CFSP').length;
  await act({ type: 'micAdd', changes: { name: 'Court mic', on: 'atem', input: 1301 } });
  await wait(300);
  assert.equal(atem.received.filter(r => r.name === 'CFSP').length, before, 'adding it moves nothing');
  let m = (await mics()).mics[0];
  assert.equal(m.level, 50, '-6 dB is about half');
  assert.equal(atem.state.faders[MIC1], -600);

  // Level and mute move the fader.
  await act({ type: 'micLevel', mic: m.id, value: 100 });
  await studio.until(() => atem.state.faders[MIC1] === 0);
  await act({ type: 'micMute', mic: m.id, value: 'on' });
  await studio.until(() => atem.state.faders[MIC1] === -10000);
  await act({ type: 'micMute', mic: m.id, value: 'off' });
  await studio.until(() => atem.state.faders[MIC1] === 0);

  // A dip by hand to 30% fades down in steps, to about -10.5 dB, then back up.
  const steps = atem.received.filter(r => r.name === 'CFSP').length;
  await act({ type: 'micsDip', value: 'on' });
  await studio.until(() => atem.state.faders[MIC1] === -1050, 5000, 50);
  assert.ok(atem.received.filter(r => r.name === 'CFSP').length - steps >= 5, 'faded in steps, not one jump');
  await act({ type: 'micsDip', value: 'off' });
  await studio.until(() => atem.state.faders[MIC1] === 0, 5000, 50);
  assert.equal((await live()).faders[m.id], 0);

  // Moved on the switcher: that's its level now, and Studio doesn't put it back.
  await wait(1100);
  atem.setFader(MIC1, -1200);
  await studio.until(async () => (await mics()).mics[0].level === 25);
  await wait(500);
  assert.equal(atem.state.faders[MIC1], -1200);
  assert.match(studio.log(), /Court mic's fader moved on the switcher at -12 dB: its level is 25%/);

  // The Mac's window never opens a switcher mic.
  assert.deepEqual((await live()).problems, {});
});

test('a split input: the left and right mics move their own halves; trouble is said plainly', async t => {
  const { atem, act, mics, live, studio } = await setUp(t, { split: [1302], micOff: [1301] });
  await studio.until(async () => (await live()).switcher.inputs.length);
  await act({ type: 'micAdd', changes: { name: 'Baseline', on: 'atem', input: 1302, channel: 'left' } });
  await act({ type: 'micAdd', changes: { name: 'Crowd', on: 'atem', input: 1302, channel: 'right' } });
  await act({ type: 'micAdd', changes: { name: 'Bench', on: 'atem', input: 1301, channel: 'right' } });
  await act({ type: 'micAdd', changes: { name: 'Nowhere', on: 'atem', input: 1309 } });
  const [baseline, crowd] = (await mics()).mics;
  await act({ type: 'micLevel', mic: crowd.id, value: 50 });
  await studio.until(() => atem.state.faders['1302:-255'] === -600);
  assert.equal(atem.state.faders['1302:-256'], 0, 'the left half stays');
  await act({ type: 'micMute', mic: baseline.id, value: 'on' });
  await studio.until(() => atem.state.faders['1302:-256'] === -10000);
  assert.equal(atem.state.faders['1302:-255'], -600);

  const l = await live();
  assert.equal(l.switcher.inputs.find(i => i.id === 1302).split, true);
  const [, , bench, nowhere] = (await mics()).mics;
  assert.match(l.problems[bench.id], /Mic 1 isn't split into two mono channels/);
  assert.match(l.problems[nowhere.id], /no audio input 1309/);
  await act({ type: 'micUpdate', mic: bench.id, changes: { channel: 'both' } });
  assert.match((await live()).problems[bench.id], /Mic 1 is Off on the switcher/);
});

test('without the switcher connected, a switcher mic says so and Studio sends nothing', async t => {
  const studio = await startStudio(t);
  const r = await studio.request('POST', '/api/scene', { type: 'micAdd', changes: { name: 'Court mic', on: 'atem', input: 1301 } });
  assert.equal(r.status, 200);
  const m = r.json.mics.mics[0];
  assert.equal(m.on, 'atem');
  assert.equal(m.input, 1301);
  assert.match((await studio.get('/api/scene/mics/live')).problems[m.id], /switcher isn't connected/);
  assert.equal((await studio.request('GET', '/deck/mics/dip/on')).status, 200);
});
