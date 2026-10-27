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

test('privateRead: backups, the athlete register, the log, sponsor reports and the setup, on GET only', () => {
  assert.equal(access.privateRead('GET', '/api/settings/export'), true);
  assert.equal(access.privateRead('GET', '/api/scene/export'), true);
  assert.equal(access.privateRead('GET', '/api/athletes'), true);
  assert.equal(access.privateRead('GET', '/api/athletes/games'), false, 'the positions graphic');
  assert.equal(access.privateRead('GET', '/api/log'), true);
  assert.equal(access.privateRead('GET', '/api/sponsors/report'), true);
  assert.equal(access.privateRead('GET', '/api/setup'), true);
  assert.equal(access.privateRead('GET', '/api/setup/thunder-league/template'), true);
  assert.equal(access.privateRead('GET', '/api/setup-teams'), true);
  assert.equal(access.privateRead('GET', '/api/scoreboard'), false);
  assert.equal(access.privateRead('GET', '/api/viewers'), false, 'the live viewers graphic');
  assert.equal(access.privateRead('GET', '/api/teams'), false, 'the team list graphic');
  assert.equal(access.privateRead('GET', '/media/song.mp3'), false);
  assert.equal(access.privateRead('POST', '/api/log'), false, 'a change, covered by changes()');
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
  assert.match(why, /Only this Mac can change things/);
  assert.match(access.refusal(false, 'GET', '/deck/home/add1', '10.0.0.5', own), /GET \/deck\/home\/add1/);
  const priv = access.refusal(false, 'GET', '/api/settings/export', '10.0.0.5', own);
  assert.match(priv, /private data/);
  assert.match(priv, /GET \/api\/settings\/export from 10\.0\.0\.5/);
  assert.equal(access.refusal(false, 'GET', '/api/settings/export', '127.0.0.1', own), null, 'this computer reads everything');
  assert.equal(access.refusal(true, 'GET', '/api/settings/export', '10.0.0.5', own), null, 'open when the switch is on');
  assert.equal(access.refusal(false, 'GET', '/api/athletes/games', '10.0.0.5', own), null, 'graphics stay open');
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
    assert.equal((await fetch(`${studio.base}/api/log`)).status, 200, 'private reads from this computer go through');
    assert.equal((await fetch(`${studio.base}/api/athletes`)).status, 200);
  } finally { await studio.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('crossSite: a change from another web page is refused, Studio\'s own pages and programs pass', () => {
  const hosts = access.ownHosts(['matts-mac.local', 'studio.lan'], new Set(['127.0.0.1', '::1', '192.168.1.20']));
  const ok = headers => access.crossSite('POST', '/api/scoreboard', headers, 8080, hosts);
  // Programs send no browser headers at all.
  assert.equal(ok({}), null, 'curl or the Stream Deck plugin');
  assert.equal(ok({ host: 'localhost:8080' }), null);
  assert.equal(ok({ host: '192.168.1.20:8080' }), null);
  assert.equal(ok({ host: '[::1]:8080' }), null);
  // Studio's own pages: same origin, by any of the names it answers to.
  assert.equal(ok({ host: 'localhost:8080', origin: 'http://localhost:8080', 'sec-fetch-site': 'same-origin' }), null);
  assert.equal(ok({ host: 'matts-mac.local:8080', origin: 'http://matts-mac.local:8080', 'sec-fetch-site': 'same-origin' }), null);
  assert.equal(ok({ host: 'other-mac.local:8080', origin: 'http://Other-Mac.local:8080' }), null, 'any .local name is this network');
  assert.equal(ok({ host: 'studio.lan:8080', origin: 'http://studio.lan:8080' }), null, 'the configured linkHost');
  assert.equal(ok({ host: '192.168.1.20:8080', origin: 'http://192.168.1.20:8080', 'sec-fetch-site': 'same-origin' }), null);
  // Another site: an image tag or a fetch from a page elsewhere.
  assert.match(ok({ host: 'localhost:8080', 'sec-fetch-site': 'cross-site' }), /another site/);
  assert.match(ok({ host: 'localhost:8080', origin: 'https://evil.example' }), /evil\.example/);
  assert.match(ok({ host: 'localhost:8080', origin: 'null' }), /unknown site|null/);
  assert.match(ok({ host: 'localhost:8080', origin: 'http://localhost:3000' }), /localhost:3000/, 'another port is another origin');
  assert.match(ok({ host: 'localhost:8080', origin: 'http://192.168.1.77:8080' }), /192\.168\.1\.77/);
  // DNS rebinding: the page's own name pointed at this computer.
  const rebound = ok({ host: 'evil.example:8080', origin: 'http://evil.example:8080', 'sec-fetch-site': 'same-origin' });
  assert.match(rebound, /"evil\.example", a name this computer doesn't answer to/);
  assert.match(rebound, /"linkHost": "evil\.example"/);
  assert.equal(access.hostOf('[fe80::1]:8080'), 'fe80::1');
  assert.equal(access.portOf('https://a.example'), 443);
  assert.equal(access.portOf('http://a.example'), 80);
});

test('Studio refuses changes from another site over HTTP and WebSocket, and still takes its own', async () => {
  const studio = await startStudio(null, { competition: 'Thunder League' });
  try {
    const own = `http://127.0.0.1:${studio.port}`;
    let res = await fetch(`${studio.base}/api/scoreboard`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ type: 'score', side: 'home', delta: 1 }) });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /another site|evil\.example/);
    res = await fetch(`${studio.base}/deck/home/add1`, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(res.status, 403, 'an image tag on another site pressing a Stream Deck link');
    // fetch won't send a made-up Host header, so plain http for the DNS rebinding case.
    const http = require('node:http');
    const rebound = await new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: '/deck/home/add1', headers: { host: 'evil.example' } }, r => { r.resume(); resolve(r.statusCode); }));
    assert.equal(rebound, 403, 'DNS rebinding');
    // A rebinding page can't read private data either, but graphics answer to any name.
    const getAs = (p, host) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p, headers: { host } }, r => { r.resume(); resolve(r.statusCode); }));
    for (const p of ['/api/log', '/api/settings/export', '/api/athletes', '/api/setup']) assert.equal(await getAs(p, 'evil.example:8080'), 403, `${p} by a rebinding page`);
    assert.equal(await getAs('/api/log', `localhost:${studio.port}`), 200, 'the log by Studio\'s own name');
    assert.equal(await getAs('/api/scoreboard', 'evil.example:8080'), 200, 'a graphic by any name');
    assert.equal((await studio.get('/api/scoreboard')).home.score, 0, 'nothing changed');
    // Reads from another site still answer (they can't be read there: no CORS header).
    res = await fetch(`${studio.base}/api/scoreboard`, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(res.status, 200);
    // Studio's own pages.
    res = await fetch(`${studio.base}/api/scoreboard`, { method: 'POST', headers: { 'content-type': 'application/json', origin: own, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ type: 'score', side: 'home', delta: 1 }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).home.score, 1);
    assert.equal((await fetch(`${studio.base}/deck/home/add1`, { headers: { origin: own, 'sec-fetch-site': 'same-origin' } })).status, 200);
    // The scene socket: refused from another site, opened for Studio's pages.
    const upgrade = headers => new Promise(resolve => {
      const req = http.request({ host: '127.0.0.1', port: studio.port, path: '/api/scene/socket', headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
      req.on('upgrade', (r, socket) => { socket.destroy(); resolve(101); });
      req.on('response', r => { r.resume(); resolve(r.statusCode); });
      req.on('error', () => resolve(-1));
      req.end();
    });
    assert.equal(await upgrade({ origin: 'https://evil.example' }), 403);
    assert.equal(await upgrade({ origin: own }), 101);
    assert.equal(await upgrade({}), 101, 'a program with no Origin');
  } finally { await studio.stop(); }
});

test('a refused socket that hangs up straight away closes just that connection, and Studio keeps running', async t => {
  const net = require('node:net');
  const studio = await startStudio(t);
  const request = 'GET /api/scene/socket HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: Upgrade\r\nupgrade: websocket\r\n'
    + 'sec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\norigin: https://evil.example\r\n\r\n';
  // Each one sends the request and resets the connection at once, so Studio's refusal is written to a socket already gone.
  for (let i = 0; i < 50; i++) {
    await new Promise(resolve => {
      const s = net.connect(studio.port, '127.0.0.1', () => { s.write(request); s.resetAndDestroy(); });
      s.on('close', resolve);
      s.on('error', () => {});
    });
  }
  await new Promise(r => setTimeout(r, 300));
  assert.equal(studio.exited(), null, `Studio stopped:\n${studio.output.join('')}`);
  assert.equal((await studio.request('GET', '/api/health')).status, 200);
});

test('Stream Deck links: the key, the plugin\'s header or Studio\'s own pages; without them only while keys aren\'t required', async t => {
  const http = require('node:http');
  // fetch won't send a made-up Referer for another site, so plain http.
  const press = (studio, p, headers = {}) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p, headers }, r => {
    let body = ''; r.on('data', d => { body += d; }); r.on('end', () => resolve({ status: r.statusCode, body }));
  }));
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const k = await studio.get('/api/deck-key');
  assert.match(k.key, /^[\w-]{12}$/);
  assert.ok(k.base.endsWith(`/k/${k.key}`), k.base);
  assert.equal(k.required, false);
  assert.equal(fs.readFileSync(path.join(studio.dataDir, 'deck-key.txt'), 'utf8').trim(), k.key, 'kept on this Mac');
  // Not required yet: a plain link, and even one an image on another site fires, still work, and are logged once.
  assert.equal((await press(studio, '/deck/home/add1')).status, 200);
  assert.equal((await press(studio, '/deck/home/add1', { referer: 'http://evil.example/' })).status, 200);
  assert.equal((await press(studio, `/k/${k.key}/deck/home/add1`)).status, 200, 'with the key');
  assert.equal((await studio.get('/api/scoreboard')).home.score, 3);
  assert.equal((studio.log().match(/without its key/g) || []).length, 1, 'logged once per address');
  await studio.stop();

  // Required: the same key (kept in the data folder), and only the key, the header or Studio's own pages press.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-deck-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'deck-key.txt'), k.key + '\n');
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ deckKeyRequired: true }));
  const locked = await startStudio(t, { competition: 'Thunder League', dataDir });
  assert.equal((await locked.get('/api/deck-key')).required, true);
  const refused = await press(locked, '/deck/home/add1');
  assert.equal(refused.status, 403);
  assert.match(refused.body, /no Stream Deck key\. Copy the link again from the Output page/);
  assert.equal((await press(locked, '/deck/home/add1', { referer: 'http://evil.example/' })).status, 403, 'an image on another site');
  assert.equal((await press(locked, '/k/wrongwrongwr/deck/home/add1')).status, 403, 'a wrong key');
  assert.equal((await press(locked, `/k/${k.key}/deck/home/add1`)).status, 200, 'the key');
  assert.equal((await press(locked, `/k/${k.key}/deck/home/add1?x=1`)).status, 200, 'the key, with a query');
  assert.equal((await press(locked, '/deck/home/add1', { 'x-studio-deck': '1' })).status, 200, 'the Studio plugin');
  assert.equal((await press(locked, '/deck/home/add1', { referer: `http://localhost:${locked.port}/api.html` })).status, 200, 'Studio\'s API page');
  assert.equal((await press(locked, '/deck/home/add1', { referer: `http://localhost:${locked.port + 1}/` })).status, 403, 'another port is another site');
  assert.equal((await locked.get('/api/scoreboard')).home.score, 4);
  // Everything else is untouched.
  assert.equal((await press(locked, '/api/scoreboard')).status, 200);
  assert.equal((await press(locked, '/k/whatever/scoreboard.html')).status, 404, 'only Stream Deck links take a key');
});

test('deckPress: only Stream Deck links are checked', () => {
  const hosts = access.ownHosts(['studio.local']);
  assert.equal(access.deckPress('/api/scoreboard', null, 'k', {}, 8080, hosts), null);
  assert.equal(access.deckPress('/deck/home/add1', 'k', 'k', {}, 8080, hosts), true);
  assert.equal(access.deckPress('/deck/home/add1', 'x', 'k', {}, 8080, hosts), false);
  assert.equal(access.deckPress('/deck/home/add1', null, 'k', { referer: 'http://studio.local:8080/' }, 8080, hosts), true);
  assert.equal(access.deckPress('/deck/home/add1', null, 'k', { referer: 'https://studio.local:8080/' }, 8080, hosts), false);
  assert.equal(access.deckPress('/deck/home/add1', null, 'k', { referer: 'not a url' }, 8080, hosts), false);
});
