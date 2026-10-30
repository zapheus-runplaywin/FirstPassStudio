// 4K replay (replay.js): a recorded night's on-air layer goes back on the pages exactly as it went to air: the
// scene, the scoreboard and a graphic's reads come from the recording at the replay's point, the live scene and
// scoreboard are left as they were and can't be changed while it runs, and Stop puts the live ones back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { startStudio } = require('./support/studio');
const { localZone } = require('./support/playhq');

// Studio runs in the stand-in PlayHQ's time zone: the test reads timecode as a time of day in the same one.
process.env.TZ = localZone().tz;

test('a replay puts the recorded night on the pages, leaves the live setup alone and stops cleanly', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const live = await studio.get('/api/scene');

  const T0 = Date.now() - 2 * 86400000;
  const scene = on => ({ sources: [{ id: 'sb', name: 'Scoreboard', url: 'scoreboard.html', visible: on }, { id: 'lt', name: 'Ladder', url: 'ladder.html', visible: false }], scenes: [], current: null });
  const board = (t, home, period) => ({ t, k: 'board', board: { gameId: 'g1', period, home: { name: 'Red', score: home }, away: { name: 'Blue', score: 0 },
    clock: { running: true, startedAt: t - 1000, elapsedMs: 0, lengthSec: 600 }, serverNow: t } });
  const lines = [
    { t: T0, k: 'start' },
    { t: T0 + 1000, k: 'game', id: 'g1', home: 'Red', away: 'Blue' },
    { t: T0 + 2000, k: 'scene', scene: scene(false) },
    board(T0 + 2000, 0, 'FIRST_QTR'),
    { t: T0 + 3000, k: 'api', p: '/api/ladder?division=Open', body: { division: 'Open', pools: [[{ team: 'Red' }]], serverNow: T0 } },
    { t: T0 + 60000, k: 'scene', scene: scene(true) },
    board(T0 + 70000, 4, 'SECOND_QTR'),
    { t: T0 + 90000, k: 'end' },
  ];
  const name = 'replay-test.jsonl.gz'.replace('replay-test', new Date(T0).toISOString().slice(0, 10) + ' 1900');
  fs.writeFileSync(path.join(studio.dataDir, 'Recordings', name), zlib.gzipSync(lines.map(l => JSON.stringify(l)).join('\n') + '\n'));

  const s = await studio.post('/api/replay', { start: { recording: name, game: 'g1' } });
  assert.equal(s.active, true);
  assert.equal(s.paused, true, 'it waits at the game for Play');
  assert.deepEqual(s.events.map(e => e.label), ['Game: Red v Blue', 'Q1', 'Scoreboard on', 'Q2']);

  // The pages get the recorded scene, and a graphic its recorded read; a Studio page's read is live.
  await studio.until(async () => (await studio.get('/api/scene')).sources.some(x => x.id === 'sb'));
  let st = await studio.get('/api/scene');
  assert.equal(st.sources.find(x => x.id === 'sb').visible, false);
  const graphic = { referer: `${studio.base}/ladder.html?division=Open` };
  const ladder = (await studio.request('GET', '/api/ladder?division=Open', undefined, graphic)).json;
  assert.deepEqual(ladder.pools, [[{ team: 'Red' }]]);
  assert.ok(Math.abs(ladder.serverNow - Date.now()) < 5000, 'its serverNow is now');

  // Jump to the scoreboard coming on: the scene there, paused.
  const at = s.events.find(e => e.label === 'Scoreboard on').t;
  const j = await studio.post('/api/replay', { seek: at });
  assert.equal(j.position, at);
  st = await studio.get('/api/scene');
  assert.equal(st.sources.find(x => x.id === 'sb').visible, true);
  // The nudge moves it by a frame.
  assert.equal((await studio.post('/api/replay', { nudge: 40 })).position, at + 40);
  // Played, it moves on.
  await studio.post('/api/replay', { pause: false });
  await new Promise(r => setTimeout(r, 300));
  assert.ok((await studio.get('/api/replay')).position > at + 40);

  // Nothing live can be changed meanwhile, but the outputs can.
  const press = await studio.request('POST', '/api/scoreboard', { type: 'score', side: 'home', delta: 1 });
  assert.equal(press.status, 409);
  assert.match(press.text, /replay is running/);
  assert.equal((await studio.request('POST', '/api/scene', { type: 'show', id: 'x' })).status, 409);
  assert.equal((await studio.request('POST', '/api/practice', { start: { recording: name, game: 'g1' } })).status, 409);
  assert.equal((await studio.request('POST', '/api/outputs', { quality: 'uhd' })).status, 200);

  // Stop: the live scene again, and changes work.
  assert.equal((await studio.post('/api/replay', { stop: true })).active, false);
  st = await studio.get('/api/scene');
  assert.deepEqual(st.sources.map(x => x.id), live.sources.map(x => x.id));
  assert.equal((await studio.request('POST', '/api/scoreboard', { type: 'score', side: 'home', delta: 1 })).status, 200);
});

// Following a HyperDeck (hyperdeck.js): its protocol's answers, and its timecode as the moment of the night.
const net = require('node:net');
const hyperdeck = require('../hyperdeck');

test("a HyperDeck's answers and timecode are read", () => {
  const { blocks, rest } = hyperdeck.parseBlocks('500 connection info:\r\nprotocol version: 1.12\r\nmodel: HyperDeck Studio 4K Pro\r\n\r\n200 ok\r\n208 transport info:\r\nstatus: play\r\nspeed: 100\r\n');
  assert.deepEqual(blocks.map(b => b.code), [500, 200]);
  assert.equal(blocks[0].fields.model, 'HyperDeck Studio 4K Pro');
  assert.match(rest, /^208 transport info:/, 'a block not yet ended waits for the rest');
  assert.equal(hyperdeck.fpsOf('1080p25'), 25);
  assert.equal(hyperdeck.fpsOf('4Kp50'), 25);
  assert.equal(hyperdeck.fpsOf('1080i5994'), 30);
  assert.equal(hyperdeck.fpsOf('1080p2997'), 30);
  assert.equal(hyperdeck.tcMs('19:42:10:12', 25), ((19 * 60 + 42) * 60 + 10) * 1000 + 480);
  assert.equal(hyperdeck.tcMs('nonsense'), null);
  assert.deepEqual(hyperdeck.parseAddress('192.168.1.50'), { address: '192.168.1.50', port: 9993 });
  assert.equal(hyperdeck.parseAddress('not an address!'), null);
});

// A stand-in HyperDeck: answers transport info with whatever deck says.
function fakeHyperDeck(t) {
  const deck = { status: 'stopped', tc: '00:00:00:00', heard: [] };
  const sockets = new Set();
  const server = net.createServer(s => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => {});
    s.write('500 connection info:\r\nprotocol version: 1.12\r\nmodel: HyperDeck Studio HD Plus\r\n\r\n');
    s.on('data', d => {
      for (const line of String(d).split('\r\n').filter(Boolean)) {
        deck.heard.push(line);
        if (line === 'transport info') s.write(`208 transport info:\r\nstatus: ${deck.status}\r\nspeed: ${deck.status === 'play' ? 100 : 0}\r\ndisplay timecode: ${deck.tc}\r\ntimecode: ${deck.tc}\r\nvideo format: 1080p25\r\n\r\n`);
        else s.write('200 ok\r\n');
      }
    });
  });
  t.after(() => { for (const s of sockets) s.destroy(); server.close(); });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ deck, port: server.address().port })));
}
const two = n => String(n).padStart(2, '0');
const tcOf = t => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}:${two(Math.floor(d.getMilliseconds() / 40))}`; };

test("a replay follows a HyperDeck's timecode, and Jump there and the nudge sync it", async t => {
  const { deck, port } = await fakeHyperDeck(t);
  const studio = await startStudio(t, { competition: 'Thunder League' });
  // A night two days ago, at a time of day well away from midnight.
  const day = new Date(Date.now() - 2 * 86400000);
  day.setHours(19, 0, 0, 0);
  const T0 = day.getTime();
  const scene = on => ({ sources: [{ id: 'sb', name: 'Scoreboard', url: 'scoreboard.html', visible: on }], scenes: [], current: null });
  const lines = [
    { t: T0, k: 'start' },
    { t: T0 + 1000, k: 'game', id: 'g1', home: 'Red', away: 'Blue' },
    { t: T0 + 2000, k: 'scene', scene: scene(false) },
    { t: T0 + 60000, k: 'scene', scene: scene(true) },
    { t: T0 + 600000, k: 'end' },
  ];
  const name = `${new Date(T0).toISOString().slice(0, 10)} 1900.jsonl.gz`;
  fs.writeFileSync(path.join(studio.dataDir, 'Recordings', name), zlib.gzipSync(lines.map(l => JSON.stringify(l)).join('\n') + '\n'));

  // The video stopped 30 s in: the replay goes there.
  deck.tc = tcOf(T0 + 30000);
  await studio.post('/api/replay', { start: { recording: name, game: 'g1' } });
  let s = await studio.post('/api/replay', { follow: { kind: 'hyperdeck', address: `127.0.0.1:${port}` } });
  assert.equal(s.follow.kind, 'hyperdeck');
  s = await studio.until(async () => { const r = await studio.get('/api/replay'); return r.follow.hyperdeck.conn === 'connected' && Math.abs(r.position - (T0 + 30000)) < 50 && r; });
  assert.equal(s.paused, true);
  assert.ok(deck.heard.includes('notify: transport: true'));
  assert.ok(deck.heard.every(l => l === 'transport info' || l.startsWith('notify:')), 'Studio only asks, never controls the HyperDeck');
  // Studio's own Play is the HyperDeck's while it follows.
  assert.equal((await studio.request('POST', '/api/replay', { pause: false })).status, 400);

  // Played on the HyperDeck, the replay plays from there.
  deck.status = 'play';
  s = await studio.until(async () => { const r = await studio.get('/api/replay'); return !r.paused && r; });
  assert.ok(s.position > T0 + 29000);

  // Stopped on the scoreboard coming on, but the HyperDeck's clock is 5 s behind: Jump there syncs it.
  deck.status = 'stopped';
  deck.tc = tcOf(T0 + 55000);
  const at = s.events.find(e => e.label === 'Scoreboard on').t;
  await studio.until(async () => { const r = await studio.get('/api/replay'); return r.paused && Math.abs(r.position - (T0 + 55000)) < 50; });
  s = await studio.post('/api/replay', { seek: at });
  assert.ok(Math.abs(s.follow.offset - 5000) < 50, `offset ${s.follow.offset}`);
  s = await studio.until(async () => { const r = await studio.get('/api/replay'); return Math.abs(r.position - at) < 50 && r; });
  assert.equal((await studio.get('/api/scene')).sources[0].visible, true);
  // The nudge moves the graphics against the video, and the sync is kept for the recording.
  s = await studio.post('/api/replay', { nudge: 40 });
  assert.ok(Math.abs(s.follow.offset - 5040) < 50);
  const kept = JSON.parse(fs.readFileSync(path.join(studio.dataDir, 'replay.json'), 'utf8'));
  assert.equal(kept.follow, 'hyperdeck');
  assert.equal(kept.hyperdeck, `127.0.0.1:${port}`);
  assert.ok(Math.abs(kept.offsets[name] - 5040) < 50);

  // Follow nothing: Play is Studio's again. Stop lets go of the HyperDeck.
  s = await studio.post('/api/replay', { follow: { kind: 'none' } });
  assert.equal(s.follow.kind, 'none');
  assert.equal((await studio.request('POST', '/api/replay', { pause: false })).status, 200);
  // The SDI input's timecode is read by the Mac app: the helper on its own says so.
  s = await studio.post('/api/replay', { follow: { kind: 'sdi' } });
  assert.equal(s.follow.kind, 'sdi');
  assert.equal(s.follow.sdi.error, 'Only in the Mac app.');
  assert.equal((await studio.request('POST', '/api/replay', { seek: at })).status, 400);
  await studio.post('/api/replay', { follow: { kind: 'hyperdeck' } });
  await studio.post('/api/replay', { stop: true });
  assert.equal((await studio.request('POST', '/api/replay', { follow: { kind: 'hyperdeck', address: 'not an address!' } })).status, 400);
});

// Following the SDI input's timecode (sditimecode.js): the Mac app sends what comes into the UltraStudio.
test("the SDI input's timecode is followed: moving on a frame at a time is playing, the same one is stopped", async () => {
  const sdi = require('../sditimecode');
  const { EventEmitter } = require('node:events');
  const port = new EventEmitter();
  const asked = [];
  port.postMessage = m => asked.push(m);
  sdi.init(() => {}, { port });
  const say = m => port.emit('message', { data: { type: 'sdiTimecode', name: 'UltraStudio 4K Mini', signal: true, fps: 50, ...m } });
  const wait = ms => new Promise(r => setTimeout(r, ms));

  sdi.follow({ device: '' });
  assert.deepEqual(asked[0], { type: 'readTimecode', device: '' });
  assert.equal(sdi.state().conn, 'connecting');
  say({ timecode: '19:30:00:00' });
  assert.equal(sdi.now().playing, false, 'one timecode is stopped');
  assert.equal(sdi.now().ms, ((19 * 60 + 30) * 60) * 1000);
  // A frame on each 40 ms (50p counts frame pairs: 25 a second), so it's playing, and runs on between frames.
  for (let f = 1; f <= 3; f++) { await wait(40); say({ timecode: `19:30:00:0${f}` }); }
  let n = sdi.now();
  assert.equal(n.playing, true);
  await wait(20);
  assert.ok(sdi.now().ms > n.ms, 'it runs on between frames');
  assert.equal(sdi.state().status, 'play');
  // The same timecode again and again: stopped there.
  for (let i = 0; i < 4; i++) { await wait(40); say({ timecode: '19:30:00:03' }); }
  n = sdi.now();
  assert.equal(n.playing, false);
  assert.equal(n.ms, ((19 * 60 + 30) * 60) * 1000 + 120);
  // A jump (scrubbing) isn't playing.
  say({ timecode: '19:31:00:00' });
  assert.equal(sdi.now().playing, false);
  // No signal: nothing to follow, and it says why.
  say({ signal: false, timecode: '' });
  assert.equal(sdi.now(), null);
  assert.equal(sdi.state().error, 'no signal');
  sdi.follow(null);
  assert.deepEqual(asked.at(-1), { type: 'readTimecode', device: null });
  assert.equal(sdi.state().conn, 'off');
});
