// The ATEM switcher (switcher.js), against a stand-in that speaks the switcher's own protocol
// (test/support/atem.js): finding it on the network, connecting, the Output page's and Stream Deck's
// cuts, previews and keys, what a smaller switcher doesn't have, and losing it mid-night.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startStudio, wait } = require('./support/studio');
const { startAtem } = require('./support/atem');
const { parseBrowse, parseLookup, parseAddress } = require('../switcher');

const connected = (studio, ms = 8000) => studio.until(async () => { const s = await studio.get('/api/switcher'); return s.state === 'connected' && s; }, ms, 100);
const link = async (studio, p) => studio.request('GET', `/deck/switcher/${p}`);

test('dns-sd output is read for ATEM switchers only, and typed addresses take an optional port', () => {
  const browse = [
    'Browsing for _blackmagic._tcp.local.',
    'DATE: ---Mon 26 Oct 2026---',
    ' 8:20:01.123  ...STARTING...',
    'Timestamp     A/R    Flags  if Domain               Service Type         Instance Name',
    ' 8:20:01.456  Add        3  12 local.               _blackmagic._tcp.    ATEM Mini Extreme',
    ' 8:20:01.457  Add        2  12 local.               _blackmagic._tcp.    HyperDeck Studio',
    ' 8:20:01.458  Add        2  12 local.               _blackmagic._tcp.    ATEM Mini Extreme',
  ].join('\n');
  assert.deepEqual(parseBrowse(browse), ['ATEM Mini Extreme', 'HyperDeck Studio']);
  const atem = parseLookup([
    'Lookup ATEM Mini Extreme._blackmagic._tcp.local.',
    ' 8:20:02.001  ATEM\\032Mini\\032Extreme._blackmagic._tcp.local. can be reached at ATEM-Mini-Extreme-7c2e.local.:9910 (interface 12)',
    ' txtvers=1 name=ATEM\\ Mini\\ Extreme class=AtemSwitcher protocol\\ version=0.0 unique\\ id=7c2e0dabc123',
  ].join('\n'));
  assert.equal(atem.host, 'ATEM-Mini-Extreme-7c2e.local');
  assert.equal(atem.port, 9910);
  assert.equal(atem.txt.class, 'AtemSwitcher');
  assert.equal(atem.txt.name, 'ATEM Mini Extreme');
  assert.equal(atem.txt['unique id'], '7c2e0dabc123');
  assert.deepEqual(parseAddress('192.168.10.240'), { address: '192.168.10.240', port: 9910 });
  assert.deepEqual(parseAddress(' 10.0.0.5:9911 '), { address: '10.0.0.5', port: 9911 });
  assert.equal(parseAddress('http://nope'), null);
  assert.equal(parseAddress(''), null);
});

test('with no switcher set up, Studio says so and the links send nothing', async t => {
  const studio = await startStudio(t);
  const s = await studio.get('/api/switcher');
  assert.equal(s.setUp, false);
  assert.equal(s.state, 'off');
  const r = await link(studio, 'cut');
  assert.equal(r.status, 409);
  assert.match(r.json.error, /No switcher is set up/);
  assert.doesNotMatch(r.json.error, /Unknown Stream Deck link/);
});

test('an ATEM Mini Extreme by its address: inputs, keys, cuts and previews from the page and the Stream Deck', async t => {
  const atem = await startAtem({ model: 'MiniExtreme', names: ['Wide', 'Court', 'Bench'] });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  const s = await connected(studio);
  assert.equal(s.model, 'ATEM Mini Extreme');
  assert.deepEqual(s.inputs.map(i => i.name), ['Wide', 'Court', 'Bench', 'Camera 4', 'Camera 5', 'Camera 6', 'Camera 7', 'Camera 8']);
  assert.equal(s.usk.length, 4);
  assert.equal(s.dsk.length, 2);
  assert.equal(s.program, 1);
  assert.equal(s.preview, 2);
  assert.equal(atem.received.length, 0, 'nothing is sent on connecting');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(studio.dataDir, 'switcher.json'), 'utf8')).pick, { kind: 'address', address: '127.0.0.1', port: atem.port });

  // The Output page: a click puts an input on preview; Cut takes it.
  await studio.post('/api/switcher', { type: 'preview', input: 3 });
  await studio.post('/api/switcher', { type: 'cut' });
  assert.equal(atem.state.program, 3);
  // Stream Deck links, by number or by the switcher's name, and the answer shows the switcher after the change.
  let r = await link(studio, 'preview/Court');
  assert.equal(r.status, 200);
  assert.equal(r.json.preview, 2);
  r = await link(studio, 'auto');
  assert.equal(r.json.program, 2);
  r = await link(studio, 'program/camera-5');
  assert.equal(atem.state.program, 5);
  r = await link(studio, 'usk/4/toggle');
  assert.deepEqual(r.json.usk, [false, false, false, true]);
  r = await link(studio, 'dsk/1/on');
  assert.deepEqual(r.json.dsk, [true, false]);
  r = await link(studio, 'dsk/2/auto');
  assert.deepEqual(r.json.dsk, [true, true]);
  assert.equal((await link(studio, 'ftb')).status, 200);
  assert.equal(atem.state.ftb, true);
  assert.equal((await link(studio, 'macro/2')).status, 200);
  const macro = atem.received.find(c => c.name === 'MAct');
  assert.equal(macro.data.readUInt16BE(0), 1, 'macro 2 is the switcher\'s second macro (index 1)');
  assert.deepEqual(atem.received.map(c => c.name), ['CPvI', 'DCut', 'CPvI', 'DAut', 'CPgI', 'CKOn', 'CDsL', 'DDsA', 'FtbA', 'MAct']);

  // Someone presses a button on the switcher itself: Studio follows it.
  atem.set({ program: 7, preview: 8 });
  await studio.until(async () => { const x = await studio.get('/api/switcher'); return x.program === 7 && x.preview === 8; }, 3000, 50);

  // Wrong numbers and names are refused clearly.
  r = await link(studio, 'preview/Nowhere');
  assert.equal(r.status, 404);
  assert.match(r.json.error, /No input "Nowhere"/);
  r = await link(studio, 'dsk/3/on');
  assert.equal(r.status, 404);
  assert.match(r.json.error, /2 downstream keys/);
  assert.equal((await link(studio, 'usk/1/sideways')).status, 404);
  assert.match(studio.log(), /Stream Deck: cut to Camera 5|Stream Deck: auto to Court/);
});

test('an ATEM Mini Pro: one upstream key and one downstream key, and its limits said plainly', async t => {
  const atem = await startAtem({ model: 'MiniPro' });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  const s = await connected(studio);
  assert.equal(s.model, 'ATEM Mini Pro');
  assert.equal(s.inputs.length, 4);
  assert.deepEqual(s.usk, [false]);
  assert.deepEqual(s.dsk, [false]);
  const r = await link(studio, 'usk/2/on');
  assert.equal(r.status, 404);
  assert.match(r.json.error, /The ATEM Mini Pro has one upstream key, so there's no upstream key 2/);
  assert.equal((await link(studio, 'usk/1/on')).status, 200);
  assert.deepEqual(atem.state.usk, [true]);
});

test('a switcher that stops answering: shown within seconds, links refused, nothing replayed when it is back', async t => {
  const atem = await startAtem({ model: 'MiniExtreme' });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  await connected(studio);
  atem.drop();
  const lost = await studio.until(async () => { const s = await studio.get('/api/switcher'); return s.state === 'lost' && s; }, 10000, 200);
  assert.equal(lost.inputs.length, 0);
  const r = await link(studio, 'cut');
  assert.equal(r.status, 409);
  assert.match(r.json.error, /isn't answering, so nothing was sent/);
  const sent = atem.received.length;
  atem.resume();
  await connected(studio, 10000);
  await wait(300);
  assert.equal(atem.received.length, sent, 'the refused cut is not sent once the switcher is back');
  assert.match(studio.log(), /stopped answering/);
});

test('found on the network by name, remembered by name, and pushed to the Output page over the scene socket', async t => {
  const atem = await startAtem({ model: 'MiniExtreme' });
  t.after(() => atem.close());
  // A stand-in for macOS's dns-sd: one ATEM and one HyperDeck on the network.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnssd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = path.join(dir, 'dns-sd');
  fs.writeFileSync(fake, `#!/bin/sh
if [ "$1" = "-B" ]; then
  echo "Timestamp     A/R    Flags  if Domain               Service Type         Instance Name"
  echo " 8:20:01.456  Add        3  12 local.               _blackmagic._tcp.    Court ATEM"
  echo " 8:20:01.457  Add        2  12 local.               _blackmagic._tcp.    HyperDeck Studio"
elif [ "$2" = "Court ATEM" ]; then
  echo " 8:20:02.001  Court\\\\032ATEM._blackmagic._tcp.local. can be reached at localhost.:${atem.port} (interface 1)"
  echo " txtvers=1 name=ATEM\\\\ Mini\\\\ Extreme class=AtemSwitcher"
else
  echo " 8:20:02.002  HyperDeck._blackmagic._tcp.local. can be reached at localhost.:9993 (interface 1)"
  echo " txtvers=1 class=HyperDeck"
fi
sleep 5
`);
  fs.chmodSync(fake, 0o755);
  const studio = await startStudio(t, { env: { FIRSTPASS_DNS_SD: fake } });

  const ws = new WebSocket(`ws://127.0.0.1:${studio.port}/api/scene/socket`);
  const pushed = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.type === 'switcher') pushed.push(m.switcher); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.send(JSON.stringify({ subscribe: 'switcher' }));
  t.after(() => ws.close());

  const s = await studio.post('/api/switcher/find');
  assert.equal(s.canFind, true);
  assert.deepEqual(s.found.map(f => [f.name, f.model, f.port]), [['Court ATEM', 'ATEM Mini Extreme', atem.port]]);
  await studio.post('/api/switcher', { type: 'use', name: 'Court ATEM' });
  const c = await connected(studio);
  assert.equal(c.pick.kind, 'found');
  assert.equal(c.pick.name, 'Court ATEM');
  await studio.until(() => pushed.some(p => p.state === 'connected' && p.inputs.length === 8), 3000, 50);
  await link(studio, 'usk/2/on');
  await studio.until(() => pushed.some(p => p.usk[1] === true), 3000, 50);
  // A name not on the network is refused, and Forget lets it go.
  assert.equal((await studio.request('POST', '/api/switcher', { type: 'use', name: 'Gone' })).status, 404);
  await studio.post('/api/switcher', { type: 'forget' });
  const f = await studio.get('/api/switcher');
  assert.equal(f.setUp, false);
  assert.equal(f.state, 'off');
});

test('a sequence and a scene drive the switcher: in order, on time, and what a Mini Pro hasn\'t got is skipped and logged', async t => {
  const atem = await startAtem({ model: 'MiniPro', names: ['Wide', 'Court', 'Bench', 'Coach'] });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  await connected(studio);
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }] });
  const ladder = (await studio.get('/api/scene')).sources[0].id;
  await studio.post('/api/scene', { type: 'sceneSave', name: 'Live' });
  await studio.post('/api/scene', { type: 'sceneUpdate', scene: 'Live', changes: { switcher: [{ type: 'auto', input: 2, name: 'Court' }] } });
  await studio.post('/api/scene', { type: 'seqAdd', changes: { name: 'Walk out', steps: [
    { sources: [ladder], length: { type: 'time', sec: 2 }, switcher: [
      { type: 'preview', input: 3, name: 'Bench' }, { type: 'cut' },
      { type: 'usk', key: 2, on: 'on' },                       // the Mini Pro has one upstream key
      { type: 'dsk', key: 1, on: 'on', mix: true, atSec: 0.5 },
    ] },
  ] } });
  await studio.post('/api/scene', { type: 'seqPlay', sequence: 'Walk out' });
  await studio.until(() => atem.state.program === 3, 3000, 20);
  assert.deepEqual(atem.received.map(c => c.name), ['CPvI', 'DCut'], 'the preview, then the cut; the key it hasn\'t got isn\'t sent');
  assert.equal(atem.state.dsk[0], false, 'the key waits its half second');
  await studio.until(() => atem.state.dsk[0] === true, 3000, 20);
  assert.equal(atem.received.at(-1).name, 'DDsA');
  assert.match(studio.log(), /Sequence "Walk out" step 1: skipped upstream key 2 on: The ATEM Mini Pro has one upstream key/);
  assert.match(studio.log(), /Sequence "Walk out" step 1: downstream key 1 on \(auto\)/);

  // A scene picked on the Output page: its auto goes to Court.
  await studio.post('/api/scene', { type: 'sceneGo', scene: 'Live' });
  await studio.until(() => atem.state.program === 2, 3000, 20);
  assert.deepEqual(atem.received.slice(-2).map(c => c.name), ['CPvI', 'DAut']);

  // With the switcher not answering, a scene's actions are skipped, logged, and never sent once it's back.
  atem.drop();
  await studio.until(async () => (await studio.get('/api/switcher')).state === 'lost', 10000, 200);
  const sent = atem.received.length;
  await studio.post('/api/scene', { type: 'sceneGo', scene: 'Live' });
  atem.resume();
  await connected(studio, 10000);
  await wait(300);
  assert.equal(atem.received.length, sent);
  assert.match(studio.log(), /Scene "Live": The switcher isn't answering, so nothing was sent \(auto\)/);
});

test('Stop calls off switcher actions still to come, a scene step\'s scene\'s too: nothing lands over a hand cut', async t => {
  const atem = await startAtem({ model: 'MiniExtreme' });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  await connected(studio);
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }] });
  await studio.post('/api/scene', { type: 'sceneSave', name: 'Live' });
  await studio.post('/api/scene', { type: 'sceneUpdate', scene: 'Live', changes: { switcher: [{ type: 'dsk', key: 1, on: 'on', atSec: 0.8 }] } });
  const live = (await studio.get('/api/scene')).scenes[0].id;
  await studio.post('/api/scene', { type: 'seqAdd', changes: { name: 'Walk out', steps: [
    { kind: 'scene', scene: live, length: { type: 'time', sec: 20 }, switcher: [{ type: 'usk', key: 1, on: 'on', atSec: 0.8 }] },
  ] } });
  await studio.post('/api/scene', { type: 'seqPlay', sequence: 'Walk out' });
  await wait(200);
  await studio.post('/api/scene', { type: 'seqStop' });
  await wait(1200);
  assert.deepEqual(atem.received.map(c => c.name), [], 'neither the step\'s key nor its scene\'s');
  assert.deepEqual(atem.state.dsk, [false, false]);
  assert.deepEqual(atem.state.usk, [false, false, false, false]);
});
