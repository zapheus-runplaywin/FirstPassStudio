// Game stories shared between Studio Macs (stories.ts): over the network (GET /api/stories) and through iCloud Drive.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const savefile = require('../out/savefile');
const { create, browsed, reached, better } = require('../out/stories');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-stories-'));
const story = (id, extra = {}) => ({ gameId: id, date: '2026-11-03', division: 'Div 1', round: 'Round 4', ended: true, savedAt: Date.now(),
  stats: { quarters: [] }, worm: { points: [] }, moments: [], ...extra });
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const store = (studio, more = {}) => create({ dir: tmp(), savefile, studio, bonjour: false, ...more });

// One Studio answering /api/stories on a free port, as server.ts does.
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

test('the other Studio\'s stories are copied over the network, and one no better never replaces this Mac\'s own', async () => {
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


// A story of a game this Mac only followed in the background, and the same game streamed by another Mac.
const gaps = n => ({ worm: { points: [], gaps: Array.from({ length: n }, (_, i) => ({ from: i, to: i + 0.1 })) } });
test('the better story of a game is kept: fewer gaps, then streamed over followed, then the later copy', () => {
  const at = Date.now();
  assert.ok(better(story('g', gaps(0)), story('g', gaps(1))), 'fewer gaps wins');
  assert.ok(!better(story('g', { ...gaps(1) }), story('g', { ...gaps(0), followed: true })), 'a gap loses even to a followed story');
  assert.ok(better(story('g'), story('g', { followed: true })), 'streamed beats followed on the same gaps');
  assert.ok(!better(story('g', { followed: true, savedAt: at + 1 }), story('g', { savedAt: at })), 'a later followed copy doesn\'t beat a streamed one');
  assert.ok(better(story('g', { savedAt: at + 1 }), story('g', { savedAt: at })), 'then the later one');
  assert.ok(!better(story('g', { savedAt: at + 1 }), story('g', { savedAt: at }), { byTime: false }), 'unless time doesn\'t count (this Mac\'s own)');
});

test('a streamed story from the other court\'s Mac replaces the one this Mac only followed, and this Mac doesn\'t write over it', async () => {
  const court2 = store('Court-2');
  court2.keep(story('g2'), { final: true }); // streamed on court 2
  court2.keep(story('g1', { followed: true, stats: { court2: true } }), { final: true }); // followed on court 2, streamed here
  const { base, close } = await serve(court2);
  try {
    const list = await (await fetch(`${base}/api/stories`)).json();
    assert.deepStrictEqual(list.stories.map(s => [s.gameId, s.gaps, !!s.followed]).sort(), [['g1', 0, true], ['g2', 0, false]]);
    const court1 = store('Court-1', { peers: [base] });
    court1.keep(story('g1', { stats: { court1: true } }), { final: true });
    court1.keep(story('g2', { followed: true, stats: { court1: true } }));
    assert.strictEqual(await court1.sync(), 1, 'only the better story is copied');
    assert.deepStrictEqual(court1.read('g2').stats, { quarters: [] }, 'court 2\'s streamed story of its game');
    assert.deepStrictEqual(court1.read('g2').from, { studio: 'Court-2', via: 'network' });
    assert.deepStrictEqual(court1.read('g1').stats, { court1: true }, 'this Mac\'s streamed story stays');
    court1.keep(story('g2', { followed: true, stats: { court1: 'again' } }), { final: true }); // still following it here
    assert.deepStrictEqual(court1.read('g2').from, { studio: 'Court-2', via: 'network' }, 'the followed story doesn\'t write over the streamed copy');
    // A followed story with no gaps beats a streamed one that picked the game up part way through.
    const court3 = store('Court-3');
    court3.keep(story('g3', gaps(1)), { final: true });
    assert.ok(court3.accept({ ...story('g3', { followed: true }), studio: 'Court-2', studioId: 'c2' }, 'network'));
  } finally { close(); }
});

test('Bonjour\'s answers are read (dns-sd -B and -L)', () => {
  assert.deepStrictEqual(browsed('12:00:01.123  Add        2   4 local.               _firstpass-studio._tcp. Court 2 MacBook'), { add: true, name: 'Court 2 MacBook' });
  assert.deepStrictEqual(browsed('12:09:30.001  Rmv        0   4 local.               _firstpass-studio._tcp. Court-2'), { add: false, name: 'Court-2' });
  assert.strictEqual(browsed('Timestamp     A/R    Flags  if Domain               Service Type         Instance Name'), null);
  assert.strictEqual(reached('Lookup Court-2._firstpass-studio._tcp.local\n12:00:02.000  Court-2._firstpass-studio._tcp.local. can be reached at Court-2.local.:8080 (interface 4)'),
    'http://Court-2.local:8080');
  assert.strictEqual(reached('Lookup Court-2'), null);
});

test('a game left part way (Studio quit) goes to iCloud Drive once it counts as finished, never over another Mac\'s better story', async () => {
  const cloud = tmp();
  const court2 = store('Court-2', { cloudDir: cloud, studioId: 'c2' });
  court2.keep(story('left', { ended: false, savedAt: Date.now() - 31 * 60 * 1000 })); // quit mid-game 31 minutes ago: never final
  court2.keep(story('playing', { ended: false })); // still going
  assert.deepStrictEqual(fs.readdirSync(cloud), []);
  await court2.sync();
  assert.deepStrictEqual(fs.readdirSync(cloud), ['left.json'], 'only the finished one');
  // Another Mac's story of a game, with fewer gaps, already there: left alone.
  const theirs = { ...story('both', gaps(0)), studio: 'Court-1', studioId: 'c1' };
  fs.writeFileSync(path.join(cloud, 'both.json'), JSON.stringify(theirs));
  court2.keep(story('both', { ...gaps(2), ended: false, savedAt: Date.now() - 31 * 60 * 1000 }));
  await court2.sync();
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(cloud, 'both.json'), 'utf8')).studioId, 'c1');
  const court1 = store('Court-1', { cloudDir: cloud, studioId: 'c1b' });
  await court1.sync();
  assert.deepStrictEqual(court1.read('left').from, { studio: 'Court-2', via: 'icloud' });
});
