// playhqnet.js: what talking to PlayHQ costs, for the PlayHQ line above the score on the Output page's status board.
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, answerBytes } = require('../playhqnet');

const clock = () => { let t = 1_000_000; const now = () => t; now.add = ms => { t += ms; }; return now; };

test('nothing asked yet: no ping, nothing downloaded', () => {
  const s = create(clock()).snapshot();
  assert.equal(s.pingMs, null);
  assert.equal(s.failed, false);
  assert.equal(s.bytes, 0);
  assert.equal(s.bytesPerSec, 0);
  assert.equal(s.requests, 0);
});

test('totals add up and the bandwidth is the last minute only', () => {
  const now = clock();
  const n = create(now);
  now.add(60_000);
  n.note({ ms: 120, bytes: 3000 });
  n.note({ ms: 90, bytes: 3000 });
  let s = n.snapshot();
  assert.equal(s.bytes, 6000);
  assert.equal(s.requests, 2);
  assert.equal(s.bytesPerSec, 100); // 6000 B over the minute
  now.add(61_000);
  s = n.snapshot();
  assert.equal(s.bytes, 6000, 'the total is kept');
  assert.equal(s.bytesPerSec, 0, 'but the minute has passed');
});

test('the bandwidth counts only the time since going on air in the first minute', () => {
  const now = clock();
  const n = create(now);
  now.add(10_000);
  n.note({ ms: 50, bytes: 5000 });
  assert.equal(n.snapshot().bytesPerSec, 500);
});

test('the ping is the live score while it is read, else the latest answer', () => {
  const now = clock();
  const n = create(now);
  n.note({ ms: 300, bytes: 10, live: true });
  n.note({ ms: 900, bytes: 10 });
  assert.equal(n.snapshot().pingMs, 300);
  now.add(3 * 60_000);
  assert.equal(n.snapshot().pingMs, 900, 'the live feed went quiet, so the latest answer');
});

test('a request with no answer shows until the next answer', () => {
  const n = create(clock());
  n.note({ ms: 200, bytes: 10 });
  n.failed();
  assert.equal(n.snapshot().failed, true);
  n.note({ ms: 210, bytes: 10 });
  assert.equal(n.snapshot().failed, false);
});

test('answer size: Content-Length when PlayHQ sends it, else the text', () => {
  const res = len => ({ headers: { get: k => (k === 'content-length' ? len : null) } });
  assert.equal(answerBytes(res('420'), 'x'.repeat(2000)), 420);
  assert.equal(answerBytes(res(null), 'héllo'), 6);
  assert.equal(answerBytes(res(null), null), 0);
});
