// FirstPass stats are private (firstpass.ts, access.ts, devices.ts; security review re-check, 13 November 2026):
// only this Mac and browsers paired over the secure link may read them, over https; they are kept on this Mac only and
// deleted 30 days after the game or when the club is signed out; and nothing secret reaches the debug log.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// devices.ts keeps devices.json in the data folder it is given when first loaded.
process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-devices-'));
const access = require('../out/access');
const firstpass = require('../out/firstpass');
const location = require('../out/datalocation');
const devices = require('../out/devices');
const { startStudio } = require('./support/studio.mts');

const own = new Set(['127.0.0.1', '::1', '192.168.1.20']);
const GAME = '0b6c8f8e-3f7a-4d1e-9a51-2a7c1d9e4b10';
const OTHER = '7d2e1c44-90ab-4cde-8f01-23456789abcd';

test('FirstPass stats are a private read of their own', () => {
  assert.equal(access.firstpass('/api/firstpass'), true);
  assert.equal(access.firstpass('/api/firstpass/games'), true);
  assert.equal(access.firstpass('/api/firstpassing'), false);
  assert.equal(access.privateRead('GET', '/api/firstpass/games'), true, 'so a DNS rebinding page is refused and a 4K replay never records them');
});

test('only this Mac, or a browser paired over the secure link asking over it, may read them, whatever the lock says', () => {
  const secure = { kind: 'browser', secure: true };
  const plain = { kind: 'browser' };
  // This Mac, by any of its addresses, over http or https.
  assert.equal(access.firstpassRefusal('GET', '/api/firstpass/games', '127.0.0.1', null, false, own), null);
  assert.equal(access.firstpassRefusal('GET', '/api/firstpass/games', '::ffff:192.168.1.20', null, true, own), null);
  // A browser paired over the secure link, asking over it.
  assert.equal(access.firstpassRefusal('GET', '/api/firstpass/games', '192.168.1.77', secure, true, own), null);
  // The same browser over plain http: refused, and told to use the secure link.
  assert.match(access.firstpassRefusal('GET', '/api/firstpass/games', '192.168.1.77', secure, false, own), /secure link \(https\)/);
  // A browser paired over plain http, even asking over https (its cookie may have been copied off the Wi-Fi).
  assert.match(access.firstpassRefusal('GET', '/api/firstpass/games', '192.168.1.77', plain, true, own), /pair\.html by the secure link/);
  // A Stream Deck plugin, a link set or a program, and nobody at all.
  assert.ok(access.firstpassRefusal('GET', '/api/firstpass/games', '192.168.1.77', { kind: 'plugin', secure: true }, true, own));
  assert.ok(access.firstpassRefusal('GET', '/api/firstpass/games', '192.168.1.77', { kind: 'links' }, true, own));
  assert.ok(access.firstpassRefusal('GET', '/api/firstpass/games', '192.168.1.77', null, true, own));
  // Changes too, not only reads.
  assert.ok(access.firstpassRefusal('POST', '/api/firstpass/clubs', '192.168.1.77', null, true, own));
  // Everything else is up to the other rules.
  assert.equal(access.firstpassRefusal('GET', '/api/scoreboard', '192.168.1.77', null, false, own), null);
  // The lock doesn't open them: refusal() with the lock off lets every private read through, firstpassRefusal() doesn't.
  assert.equal(access.refusal(true, 'GET', '/api/firstpass/games', '192.168.1.77', own), null);
});

test('the kept stats stay on this Mac: never in iCloud Drive or a settings backup', () => {
  assert.ok(location.LOCAL_ONLY.has('firstpass'));
  assert.equal(location.SETTINGS.has('firstpass'), false);
});

function store(now) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-store-'));
  const lines = [];
  const s = firstpass.create({ log: (...a) => lines.push(a.join(' ')), dir, now: () => now.t });
  return { s, dir, lines };
}

test('a game\'s stats are kept per club and read back; bad club codes and game ids are refused', () => {
  const now = { t: Date.parse('2026-11-13T09:00:00Z') };
  const { s, dir } = store(now);
  assert.equal(s.save('THUNDER', GAME, { events: 3 }, { finishedAt: '2026-11-13T08:00:00Z' }), true);
  assert.deepEqual(s.read('THUNDER', GAME).data, { events: 3 });
  assert.equal(s.read('THUNDER', GAME).finishedAt, '2026-11-13T08:00:00Z');
  assert.deepEqual(s.clubs(), ['THUNDER']);
  assert.deepEqual(s.games('THUNDER'), [GAME]);
  assert.ok(fs.existsSync(path.join(dir, 'THUNDER', `${GAME}.json`)));
  assert.equal(s.save('../etc', GAME, {}), false);
  assert.equal(s.save('thunder', GAME, {}), false, 'club codes are capitals and digits');
  assert.equal(s.save('THUNDER', '../x', {}), false);
  assert.equal(s.read('THUNDER', OTHER), null);
});

test('signing a club out deletes everything kept for it, and only it', () => {
  const now = { t: Date.parse('2026-11-13T09:00:00Z') };
  const { s, dir, lines } = store(now);
  s.save('THUNDER', GAME, {});
  s.save('THUNDER', OTHER, {});
  s.save('STORM', GAME, {});
  assert.equal(s.forget('THUNDER'), 2);
  assert.equal(fs.existsSync(path.join(dir, 'THUNDER')), false);
  assert.deepEqual(s.clubs(), ['STORM']);
  assert.match(lines.join('\n'), /Deleted 2 game\(s\) of THUNDER's FirstPass stats \(signed out\)/);
});

test('a game\'s stats are deleted 30 days after it finished, or after the last save while it has no finish', () => {
  const now = { t: Date.parse('2026-11-01T09:00:00Z') };
  const { s, dir } = store(now);
  s.save('THUNDER', GAME, {}, { finishedAt: '2026-11-01T08:00:00Z' }); // finished
  s.save('THUNDER', OTHER, {}); // never finished, saved now
  now.t = Date.parse('2026-11-30T09:00:00Z'); // 29 days on
  assert.equal(s.sweep(), 0);
  now.t = Date.parse('2026-12-01T08:30:00Z'); // just over 30 days after the finish, just under after the save
  assert.equal(s.sweep(), 1);
  assert.deepEqual(s.games('THUNDER'), [OTHER]);
  now.t = Date.parse('2026-12-02T09:00:00Z');
  assert.equal(s.sweep(), 1);
  assert.equal(fs.existsSync(path.join(dir, 'THUNDER')), false, 'an empty club folder goes too');
  // A file that can't be read is deleted rather than kept for ever.
  fs.mkdirSync(path.join(dir, 'STORM'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'STORM', `${GAME}.json`), 'not json');
  assert.equal(s.sweep(), 1);
});

test('nothing secret reaches the log: tokens, sign-in codes and keys are scrubbed', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdGhsZXRlIn0.c2lnbmF0dXJlLXZhbHVl';
  const cases = [
    [`GET /auth/v1/token?grant_type=refresh_token&refresh_token=r3fr3sh-T0ken failed`, 'r3fr3sh-T0ken'],
    [`callback /?code=4f6a-77b2-pkce&state=x`, '4f6a-77b2-pkce'],
    [`{"access_token":"${jwt}","refresh_token":"abc123def"}`, 'abc123def'],
    [`Authorization: Bearer ${jwt}`, jwt],
    [`sent apikey=sb_publishable_xyz and code_verifier=verif1er`, 'verif1er'],
    [`a token ${jwt} in plain text`, jwt],
  ];
  for (const [line, secret] of cases) {
    const out = firstpass.scrub(line);
    assert.ok(!out.includes(secret), `${out} still has ${secret}`);
    assert.ok(!out.includes(jwt), `${out} still has the token`);
    assert.match(out, /\[hidden\]/);
  }
  assert.equal(firstpass.scrub('Caught up on game 12 (40 events)'), 'Caught up on game 12 (40 events)', 'counts and ids stay');
  // The store's own log, and anything logged through privateLog(), extra included.
  const lines = [];
  const log = firstpass.privateLog((...a) => lines.push(a));
  log('warn', 'hq', `refresh failed for refresh_token=abc`, { access_token: jwt });
  assert.doesNotMatch(JSON.stringify(lines), /refresh_token=abc/);
  assert.match(JSON.stringify(lines), /refresh_token=\[hidden\]/);
  assert.ok(!JSON.stringify(lines).includes(jwt));
});

test('a browser that collects its cookie over the secure link is marked secure; one over plain http is not', () => {
  devices.load(() => {});
  const pair = (secure) => {
    const asked = devices.ask('Phone', '192.168.1.77', undefined, true);
    assert.ok(asked.id, JSON.stringify(asked));
    assert.equal(devices.answer(asked.id, true, 'full'), true);
    const got = devices.collect(asked.id, asked.token, secure);
    assert.equal(got.status, 'allowed');
    return devices.list().find(d => d.id === got.device);
  };
  assert.equal(pair(true).secure, true);
  assert.equal(pair(false).secure, undefined);
});

test('Studio lets this Mac through, logs FirstPass requests without their query, and deletes old stats as it starts', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fp-'));
  const old = path.join(dataDir, 'firstpass', 'THUNDER');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, `${GAME}.json`), JSON.stringify({ gameId: GAME, savedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:00Z', data: {} }));
  const studio = await startStudio(t, { dataDir, removeDataDir: true });
  const res = await fetch(`${studio.base}/api/firstpass/nothing-yet?refresh_token=abc123`);
  assert.equal(res.status, 404, 'from this Mac it gets past the access rules');
  await studio.until(() => /\/api\/firstpass\/nothing-yet 404/.test(studio.log()));
  assert.doesNotMatch(studio.log(), /abc123/);
  assert.equal(fs.existsSync(path.join(old, `${GAME}.json`)), false);
  assert.match(studio.log(), /Deleted 1 game\(s\) of FirstPass stats more than 30 days old/);
});
