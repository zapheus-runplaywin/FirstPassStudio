// Who on the network may change things (access.js, server.js): reading is always open, changes
// from other devices are refused with a plain message when config.json remoteChanges is false,
// the computer's own addresses always count as local, and Studio sends no CORS header.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const access = require('../access');
const { startStudio } = require('./support/studio');

test('changes: anything but GET and HEAD, and the Stream Deck links', () => {
  assert.equal(access.changes('GET', '/api/scoreboard'), false);
  assert.equal(access.changes('HEAD', '/ladder.html'), false);
  assert.equal(access.changes('POST', '/api/scoreboard'), true);
  assert.equal(access.changes('DELETE', '/api/scene/media'), true);
  assert.equal(access.changes('GET', '/deck/home/add1'), true);
  assert.equal(access.changes('GET', '/deck/scene/next'), true);
  assert.equal(access.changes('GET', '/deckchair.html'), false);
});

test('isLocal: loopback (IPv4, IPv6 and mapped) and every address of this computer', () => {
  const own = new Set(['127.0.0.1', '::1', '192.168.1.20']);
  assert.equal(access.isLocal('127.0.0.1', own), true);
  assert.equal(access.isLocal('::1', own), true);
  assert.equal(access.isLocal('::ffff:127.0.0.1', own), true);
  assert.equal(access.isLocal('::ffff:192.168.1.20', own), true);
  assert.equal(access.isLocal('192.168.1.20', own), true);
  assert.equal(access.isLocal('192.168.1.77', own), false);
  assert.equal(access.isLocal('fe80::1%en0', new Set(['fe80::1'])), true);
  assert.ok(access.ownAddresses().has('127.0.0.1'));
});

test('refusal: only when the setting is off, the request changes something, and it comes from elsewhere', () => {
  const own = new Set(['127.0.0.1']);
  assert.equal(access.refusal(undefined, 'POST', '/api/scoreboard', '10.0.0.5', own), null, 'open by default');
  assert.equal(access.refusal(true, 'POST', '/api/scoreboard', '10.0.0.5', own), null);
  assert.equal(access.refusal(false, 'GET', '/api/scoreboard', '10.0.0.5', own), null, 'reading stays open');
  assert.equal(access.refusal(false, 'POST', '/api/scoreboard', '127.0.0.1', own), null, 'this computer');
  const why = access.refusal(false, 'POST', '/api/scoreboard', '::ffff:10.0.0.5', own);
  assert.match(why, /only from this computer/);
  assert.match(why, /POST \/api\/scoreboard from 10\.0\.0\.5/);
  assert.match(why, /Let other devices change things/);
  assert.match(access.refusal(false, 'GET', '/deck/home/add1', '10.0.0.5', own), /GET \/deck\/home\/add1/);
});

test('Studio sends no CORS header, and with remoteChanges off still takes changes from this computer', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-access-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ remoteChanges: false }));
  const studio = await startStudio(null, { competition: 'Thunder League', dataDir });
  try {
    const res = await fetch(`${studio.base}/api/version`);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const r = await studio.post('/api/scoreboard', { type: 'score', side: 'home', delta: 1 });
    assert.equal(r.home.score, 1, 'a change from this computer goes through');
    assert.equal((await fetch(`${studio.base}/deck/home/add1`)).status, 200);
  } finally { await studio.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
