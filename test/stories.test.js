// Game stories shared between Studio Macs (stories.js): over the network (GET /api/stories) and through iCloud Drive.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const savefile = require('../savefile');
const { create, browsed, reached } = require('../stories');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-stories-'));
const story = (id, extra = {}) => ({ gameId: id, date: '2026-11-03', division: 'Div 1', round: 'Round 4', ended: true, savedAt: Date.now(),
  stats: { quarters: [] }, worm: { points: [] }, moments: [], ...extra });
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const store = (studio, more = {}) => create({ dir: tmp(), savefile, studio, bonjour: false, ...more });

// One Studio answering /api/stories on a free port, as server.js does.
async function serve(s) {
  const server = http.createServer((req, res) => { if (!s.route(req, res, new URL(req.url, 'http://x'), { send })) send(res, 404, {}); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('a Studio shares only its own finished stories', async () => {
  const court2 = store('Court-2');
  court2.keep(story('done'), { final: true });
  court2.keep(story('playing', { ended: false }));
  court2.keep(story('moved-on', { ended: false }), { final: true }); // the scoreboard picked another game
  court2.accept({ ...story('copy'), studio: 'Court-3', studioId: 'c3' }, 'network'); // someone else's story isn't passed on
  fs.writeFileSync(path.join(court2.dir, 'old.json'), JSON.stringify(story('old'))); // kept before stories were shared
  const { base, close } = await serve(court2);
  try {
    const list = await (await fetch(`${base}/api/stories`)).json();
    assert.strictEqual(list.studio, 'Court-2');
    assert.deepStrictEqual(list.stories.map(s => s.gameId).sort(), ['done', 'moved-on', 'old']);
    assert.strictEqual((await (await fetch(`${base}/api/stories/old`)).json()).studioId, 'Court-2', 'an older story says whose it is');
    assert.strictEqual((await fetch(`${base}/api/stories/playing`)).status, 404, 'a game still being played is not shared');
    assert.strictEqual((await fetch(`${base}/api/stories/copy`)).status, 404);
    assert.strictEqual((await fetch(`${base}/api/stories`, { method: 'POST' })).status, 405, 'sharing is read only');
  } finally { close(); }
});

test('the other Studio\'s stories are copied over the network, and never replace this Mac\'s own', async () => {
  const court2 = store('Court-2');
  court2.keep(story('g2'), { final: true });
  court2.keep(story('g1', { stats: { theirs: true } }), { final: true });
  const { base, close } = await serve(court2);
  try {
    const court1 = store('Court-1', { peers: [base] });
    court1.keep(story('g1', { stats: { mine: true } }), { final: true });
    assert.strictEqual(await court1.sync(), 1);
    assert.deepStrictEqual(court1.read('g2').from, { studio: 'Court-2', via: 'network' });
    assert.deepStrictEqual(court1.read('g1').stats, { mine: true }, 'this Mac\'s own story stays');
    assert.strictEqual(await court1.sync(), 0, 'nothing copied twice');
    assert.deepStrictEqual(court1.sources(['g1', 'g2', 'none']), [{ studio: 'Court-2', via: 'network', games: 1 }]);
  } finally { close(); }
});

test('a Studio that can\'t be reached is skipped', async () => {
  const court1 = store('Court-1', { peers: ['http://127.0.0.1:9'] });
  assert.strictEqual(await court1.sync(), 0);
});

test('iCloud Drive carries finished stories between Macs that never met', () => {
  const cloud = tmp();
  const court1 = store('Court-1', { cloudDir: cloud }), court2 = store('Court-2', { cloudDir: cloud });
  court2.keep(story('g7', { ended: false })); // a save mid-game stays on the Mac
  assert.deepStrictEqual(fs.readdirSync(cloud), []);
  court2.keep(story('g7'), { final: true });
  assert.deepStrictEqual(fs.readdirSync(cloud), ['g7.json']);
  assert.strictEqual(court1.read('g7'), null);
  return court1.sync().then(n => {
    assert.strictEqual(n, 1);
    assert.deepStrictEqual(court1.read('g7').from, { studio: 'Court-2', via: 'icloud' });
    return court2.sync().then(m => assert.strictEqual(m, 0, 'a Mac doesn\'t copy its own story back'));
  });
});

test('a later copy replaces an older one, whichever way it came', () => {
  const s = store('Court-1');
  const older = { ...story('g9', { savedAt: Date.now() - 60000, stats: { v: 1 } }), studio: 'Court-2', studioId: 'c2' };
  const newer = { ...older, savedAt: Date.now(), stats: { v: 2 } };
  assert.ok(s.accept(newer, 'network'));
  assert.ok(!s.accept(older, 'icloud'), 'an older copy is left out');
  assert.deepStrictEqual(s.read('g9').stats, { v: 2 });
  assert.ok(!s.accept({ gameId: 'bad' }, 'network'), 'something that isn\'t a story is left out');
  assert.ok(!s.accept({ ...story('g10', { ended: false }), studio: 'Court-2', studioId: 'c2' }, 'network'), 'a game still being played is left out');
});


test('Bonjour\'s answers are read (dns-sd -B and -L)', () => {
  assert.deepStrictEqual(browsed('12:00:01.123  Add        2   4 local.               _firstpass-studio._tcp. Court 2 MacBook'), { add: true, name: 'Court 2 MacBook' });
  assert.deepStrictEqual(browsed('12:09:30.001  Rmv        0   4 local.               _firstpass-studio._tcp. Court-2'), { add: false, name: 'Court-2' });
  assert.strictEqual(browsed('Timestamp     A/R    Flags  if Domain               Service Type         Instance Name'), null);
  assert.strictEqual(reached('Lookup Court-2._firstpass-studio._tcp.local\n12:00:02.000  Court-2._firstpass-studio._tcp.local. can be reached at Court-2.local.:8080 (interface 4)'),
    'http://Court-2.local:8080');
  assert.strictEqual(reached('Lookup Court-2'), null);
});
