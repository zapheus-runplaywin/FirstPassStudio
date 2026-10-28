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
    const { key } = await studio.get('/api/deck-key');
    assert.equal((await fetch(`${studio.base}/k/${key}/deck/home/add1`)).status, 200);
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
    const { key } = await studio.get('/api/deck-key');
    assert.equal((await fetch(`${studio.base}/k/${key}/deck/home/add1`, { headers: { origin: own, 'sec-fetch-site': 'same-origin' } })).status, 200);
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

test('Stream Deck links: only the key, the plugin\'s header or Studio\'s own pages press them', async t => {
  const http = require('node:http');
  // fetch won't send a made-up Referer for another site, so plain http.
  const press = (studio, p, headers = {}) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p, headers }, r => {
    let body = ''; r.on('data', d => { body += d; }); r.on('end', () => resolve({ status: r.statusCode, body }));
  }));
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const k = await studio.get('/api/deck-key');
  assert.match(k.key, /^[\w-]{12}$/);
  assert.ok(k.base.endsWith(`/k/${k.key}`), k.base);
  assert.equal(fs.readFileSync(path.join(studio.dataDir, 'deck-key.txt'), 'utf8').trim(), k.key, 'kept on this Mac');
  await studio.stop();

  // The same key comes back from the data folder, and only the key, the header or Studio's own pages press.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-deck-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'deck-key.txt'), k.key + '\n');
  // A config.json from before keys were always required changes nothing.
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ deckKeyRequired: false }));
  const locked = await startStudio(t, { competition: 'Thunder League', dataDir });
  assert.equal((await locked.get('/api/deck-key')).key, k.key);
  const refused = await press(locked, '/deck/home/add1');
  assert.equal(refused.status, 403);
  assert.match(refused.body, /no Stream Deck key, or one this Mac has given up .*Copy the link again from the Output page/);
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
  assert.equal(access.deckPress('/api/scoreboard', {}, {}, 8080, hosts), null);
  assert.equal(access.deckPress('/deck/home/add1', { keyOk: true }, {}, 8080, hosts), true);
  assert.equal(access.deckPress('/deck/home/add1', { signed: true }, {}, 8080, hosts), true);
  assert.equal(access.deckPress('/deck/home/add1', {}, {}, 8080, hosts), false);
  assert.equal(access.deckPress('/deck/home/add1', { headerOk: true }, { 'x-studio-deck': '1' }, 8080, hosts), true, 'the old header, until a plugin pairs');
  assert.equal(access.deckPress('/deck/home/add1', { headerOk: false }, { 'x-studio-deck': '1' }, 8080, hosts), false, 'and not after');
  assert.equal(access.deckPress('/deck/home/add1', {}, { referer: 'http://studio.local:8080/' }, 8080, hosts), true);
  assert.equal(access.deckPress('/deck/home/add1', {}, { referer: 'https://studio.local:8080/' }, 8080, hosts), false);
  assert.equal(access.deckPress('/deck/home/add1', {}, { referer: 'not a url' }, 8080, hosts), false);
});

test('notThisMac: the devices list answers only this Mac, ticked or not', () => {
  const own = new Set(['127.0.0.1', '::1', '192.168.1.20']);
  assert.equal(access.notThisMac('GET', '/api/devices', '127.0.0.1', own), null);
  assert.equal(access.notThisMac('POST', '/api/devices/mac-links/revoke', '::ffff:192.168.1.20', own), null, 'the Mac by its LAN address');
  assert.match(access.notThisMac('GET', '/api/devices', '192.168.1.50', own), /only be seen and changed on the Mac running Studio.*192\.168\.1\.50/);
  assert.match(access.notThisMac('POST', '/api/devices/mac-links/revoke', '192.168.1.50', own), /Devices…/);
  assert.equal(access.notThisMac('GET', '/api/scoreboard', '192.168.1.50', own), null, 'everything else is up to the lock');
  assert.equal(access.privateRead('GET', '/api/devices'), true, 'a rebinding page can\'t read it either (foreignHost)');
});

test('Devices: This Mac\'s links keep the old key, the list has no secrets, and a new key retires the old links', async t => {
  const http = require('node:http');
  const press = (studio, p) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)); }));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-devices-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'deck-key.txt'), 'oldkeyoldkey\n');
  const studio = await startStudio(t, { competition: 'Thunder League', dataDir });
  assert.equal((await studio.get('/api/deck-key')).key, 'oldkeyoldkey', 'links already on a Stream Deck keep working');
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'devices.json'), 'utf8'));
  assert.equal(saved[0].secret, 'oldkeyoldkey');

  const { devices } = await studio.get('/api/devices');
  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'This Mac\'s links');
  assert.equal(devices[0].level, 'full');
  assert.equal(devices[0].lastSeen, null);
  assert.ok(!JSON.stringify(devices).includes('oldkeyoldkey') && !('secret' in devices[0]), 'no secrets in the list');

  assert.equal(await press(studio, '/k/oldkeyoldkey/deck/home/add1'), 200);
  assert.ok((await studio.get('/api/devices')).devices[0].lastSeen, 'a press counts as used');

  const renewed = await studio.request('POST', '/api/devices/mac-links/revoke');
  assert.equal(renewed.status, 200);
  const k = await studio.get('/api/deck-key');
  assert.notEqual(k.key, 'oldkeyoldkey');
  assert.equal(await press(studio, '/k/oldkeyoldkey/deck/home/add1'), 403, 'the old links stop working');
  assert.equal(await press(studio, `/k/${k.key}/deck/home/add1`), 200, 'the new ones work');
  assert.equal(fs.readFileSync(path.join(dataDir, 'deck-key.txt'), 'utf8').trim(), k.key, 'an older Studio would use the new key too');
  assert.equal((await studio.request('POST', '/api/devices/nothing/revoke')).status, 404);
});

test('refusal: asking to be added works while the lock is on', () => {
  const own = new Set(['127.0.0.1']);
  assert.equal(access.refusal(false, 'POST', '/api/pair', '192.168.1.50', own), null);
  assert.equal(access.refusal(false, 'GET', '/api/pair/abc', '192.168.1.50', own), null);
  assert.match(access.refusal(false, 'POST', '/api/scoreboard', '192.168.1.50', own), /only from this computer/);
});

test('Pairing: a device asks, the Mac allows or denies, and an allowed device gets its own key', async t => {
  const http = require('node:http');
  const press = (studio, p) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)); }));
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const collect = (id, token) => studio.request('GET', `/api/pair/${id}`, undefined, token ? { 'x-studio-pair': token } : {});

  assert.equal((await studio.request('POST', '/api/pair', { name: '  ' })).status, 409, 'a name is needed');
  const asked = await studio.request('POST', '/api/pair', { name: 'Office\u0007 Stream   Deck' });
  assert.equal(asked.status, 202);
  const { id, token } = asked.json;
  assert.ok(id && token && asked.json.expires);
  const busy = await studio.request('POST', '/api/pair', { name: 'Someone else' });
  assert.equal(busy.status, 409);
  assert.match(busy.json.error, /Another device is asking already/);

  assert.equal((await collect(id)).status, 404, 'no token');
  assert.equal((await collect(id, 'wrong')).status, 404, 'a wrong token');
  assert.equal((await collect(id, token)).json.status, 'waiting');
  const { asking } = await studio.get('/api/devices');
  assert.equal(asking.name, 'Office Stream Deck', 'control characters and runs of spaces are cleaned');
  assert.equal(asking.address, '127.0.0.1');
  assert.ok(!('token' in asking), 'the page never sees the token');

  assert.equal((await studio.request('POST', `/api/devices/requests/${id}/allow`)).status, 200);
  assert.equal((await studio.request('POST', `/api/devices/requests/${id}/deny`)).status, 404, 'answered once');
  const got = await collect(id, token);
  assert.equal(got.json.status, 'allowed');
  assert.ok(got.json.base.endsWith(`/k/${got.json.key}`));
  assert.equal((await collect(id, token)).status, 404, 'the key is handed over once');
  assert.equal(await press(studio, `/k/${got.json.key}/deck/home/add1`), 200, 'its own key presses links');
  const listed = (await studio.get('/api/devices')).devices.find(d => d.id === got.json.device);
  assert.equal(listed.name, 'Office Stream Deck');
  assert.equal(listed.kind, 'program');
  assert.ok(listed.lastSeen);
  assert.equal((await studio.request('POST', `/api/devices/${got.json.device}/revoke`)).status, 200);
  assert.ok(!(await studio.get('/api/devices')).devices.some(d => d.id === got.json.device), 'taken away alone');
  assert.equal(await press(studio, `/k/${got.json.key}/deck/home/add1`), 403);
  assert.equal(await press(studio, `/k/${(await studio.get('/api/deck-key')).key}/deck/home/add1`), 200, 'This Mac\'s links still work');

  // Deny: the device hears so, and waits a minute before asking again.
  const again = (await studio.request('POST', '/api/pair', { name: 'Stranger' })).json;
  assert.equal((await studio.request('POST', `/api/devices/requests/${again.id}/deny`)).status, 200);
  assert.equal((await collect(again.id, again.token)).json.status, 'denied');
  const soon = await studio.request('POST', '/api/pair', { name: 'Stranger' });
  assert.equal(soon.status, 409);
  assert.match(soon.json.error, /just denied/);
});

test('Pairing: a device unused for 90 days drops off the list', async t => {
  const http = require('node:http');
  const press = (studio, p) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)); }));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-unused-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const day = 24 * 3600 * 1000;
  const old = new Date(Date.now() - 100 * day).toISOString();
  const recent = new Date(Date.now() - 10 * day).toISOString();
  fs.writeFileSync(path.join(dataDir, 'devices.json'), JSON.stringify([
    { id: 'mac-links', name: 'This Mac\'s links', kind: 'links', level: 'full', secret: 'maclinkskey1', created: old, lastSeen: old },
    { id: 'gone1', name: 'Old laptop', kind: 'program', level: 'full', secret: 'oldlaptopkey', created: old, lastSeen: old },
    { id: 'kept1', name: 'Office', kind: 'program', level: 'full', secret: 'officekey123', created: old, lastSeen: recent },
    { id: 'set1', name: 'Bench Stream Deck', kind: 'links', level: 'full', secret: 'benchkey1234', created: old, lastSeen: old },
  ]));
  const studio = await startStudio(t, { competition: 'Thunder League', dataDir });
  assert.deepEqual((await studio.get('/api/devices')).devices.map(d => d.id), ['mac-links', 'kept1', 'set1'], 'link sets never run out');
  assert.equal(await press(studio, '/k/benchkey1234/deck/home/add1'), 200);
  assert.equal(await press(studio, '/k/oldlaptopkey/deck/home/add1'), 403);
  assert.equal(await press(studio, '/k/officekey123/deck/home/add1'), 200);
  assert.equal(await press(studio, '/k/maclinkskey1/deck/home/add1'), 200);
});

test('Pairing the plugin: it signs each press, a signature counts once and for a minute, and the old header retires', async t => {
  const crypto = require('node:crypto');
  const http = require('node:http');
  const press = (studio, p, headers = {}) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p, headers }, r => {
    let body = ''; r.on('data', d => { body += d; }); r.on('end', () => resolve({ status: r.statusCode, body: body ? JSON.parse(body) : {} }));
  }));
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const sign = (device, p, time = Date.now(), key = privateKey) => ({
    'x-studio-device': device, 'x-studio-time': String(time),
    'x-studio-sign': crypto.sign(null, Buffer.from(`GET\n${p}\n${time}`), key).toString('base64url'),
  });

  // Before any plugin pairs, the old header still presses (older plugins keep working until a new one is allowed).
  assert.equal((await press(studio, '/deck/home/add1', { 'x-studio-deck': '1' })).status, 200);

  assert.equal((await studio.request('POST', '/api/pair', { name: 'Stream Deck on Office', publicKey: 'not a key' })).status, 409);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  assert.match((await studio.request('POST', '/api/pair', { name: 'x', publicKey: rsa })).json.error, /Ed25519/);
  const { id, token } = (await studio.request('POST', '/api/pair', { name: 'Stream Deck on Office', publicKey: pub })).json;
  await studio.post(`/api/devices/requests/${id}/allow`);
  const got = (await studio.request('GET', `/api/pair/${id}`, undefined, { 'x-studio-pair': token })).json;
  assert.equal(got.status, 'allowed');
  assert.ok(got.device && !got.key, 'a plugin gets no key: it signs');
  const listed = (await studio.get('/api/devices')).devices.find(d => d.id === got.device);
  assert.equal(listed.kind, 'plugin');
  assert.ok(!('publicKey' in listed));

  const p = '/deck/home/add1';
  const headers = sign(got.device, p);
  assert.equal((await press(studio, p, headers)).status, 200, 'signed');
  const again = await press(studio, p, headers);
  assert.equal(again.status, 403, 'the same signature twice');
  assert.match(again.body.error, /signature didn't check out/);
  assert.equal((await press(studio, '/deck/away/add1', sign(got.device, p))).status, 403, 'signed for another link');
  assert.equal((await press(studio, p, sign(got.device, p, Date.now() - 2 * 60 * 1000))).status, 403, 'two minutes old');
  assert.equal((await press(studio, p, sign(got.device, p, Date.now(), crypto.generateKeyPairSync('ed25519').privateKey))).status, 403, 'another key');
  const q = '/deck/home/add1?n=2';
  assert.equal((await press(studio, q, sign(got.device, q))).status, 200, 'the query is signed too');
  assert.ok((await studio.get('/api/devices')).devices.find(d => d.id === got.device).lastSeen);

  // Now a plugin has paired, the bare header is refused, and the plugin is told to ask.
  const old = await press(studio, p, { 'x-studio-deck': '1' });
  assert.equal(old.status, 403);
  assert.equal(old.body.pair, true);
  assert.match(old.body.error, /hasn't been allowed yet/);

  // Removed in Devices…: the plugin hears it should ask again.
  await studio.post(`/api/devices/${got.device}/revoke`);
  const gone = await press(studio, p, sign(got.device, p));
  assert.equal(gone.status, 403);
  assert.equal(gone.body.pair, true);
  assert.match(gone.body.error, /removed in Devices/);
  assert.equal((await press(studio, p, { 'x-studio-deck': '1' })).status, 200, 'no plugin paired any more: the header counts again');
});

test('Link sets: each has its own key, given a new one or removed without touching the others', async t => {
  const http = require('node:http');
  const press = (studio, p) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)); }));
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const mac = (await studio.get('/api/deck-key')).key;
  assert.equal((await studio.request('POST', '/api/devices/links', { name: ' ' })).status, 400);
  const office = await studio.post('/api/devices/links', { name: 'Office Stream Deck' });
  const bench = await studio.post('/api/devices/links', { name: 'Bench Stream Deck' });
  assert.equal(office.kind, 'links');
  assert.ok(!('secret' in office));
  const officeKey = (await studio.get(`/api/devices/${office.id}/key`)).key;
  const benchKey = bench.base.split('/k/')[1];
  assert.ok(office.base.endsWith(`/k/${officeKey}`));
  assert.ok(new Set([mac, officeKey, benchKey]).size === 3, 'a key each');
  for (const k of [mac, officeKey, benchKey]) assert.equal(await press(studio, `/k/${k}/deck/home/add1`), 200);
  assert.ok((await studio.get('/api/devices')).devices.find(d => d.id === office.id).lastSeen, 'used');

  const renewed = await studio.post(`/api/devices/${office.id}/renew`);
  assert.notEqual(renewed.key, officeKey);
  assert.equal(await press(studio, `/k/${officeKey}/deck/home/add1`), 403, 'the office set\'s old links stop');
  assert.equal(await press(studio, `/k/${renewed.key}/deck/home/add1`), 200);
  assert.equal(await press(studio, `/k/${benchKey}/deck/home/add1`), 200, 'the bench set is untouched');
  assert.equal(await press(studio, `/k/${mac}/deck/home/add1`), 200, 'and so are This Mac\'s links');

  await studio.post(`/api/devices/${bench.id}/revoke`);
  assert.equal(await press(studio, `/k/${benchKey}/deck/home/add1`), 403);
  assert.equal((await studio.request('GET', `/api/devices/${bench.id}/key`)).status, 404);
  await studio.post('/api/devices/mac-links/revoke');
  assert.ok((await studio.get('/api/devices')).devices.some(d => d.id === 'mac-links'), 'This Mac\'s links get a new key rather than go');
  assert.equal(await press(studio, `/k/${mac}/deck/home/add1`), 403);
  assert.equal((await studio.request('POST', '/api/devices/nope/renew')).status, 404);
});

test('refusal: while locked, allowed devices pass within their level', () => {
  const own = new Set(['127.0.0.1']);
  const lan = '192.168.1.50';
  assert.match(access.refusal(false, 'POST', '/api/scoreboard', lan, own, null), /open Studio's \/pair\.html on it/);
  assert.equal(access.refusal(false, 'POST', '/api/scene', lan, own, 'full'), null, 'everything');
  assert.equal(access.refusal(false, 'GET', '/api/athletes', lan, own, 'full'), null, 'private reads too');
  assert.equal(access.refusal(false, 'POST', '/api/scoreboard', lan, own, 'scoring'), null);
  assert.equal(access.refusal(false, 'POST', '/api/rounds', lan, own, 'scoring'), null);
  for (const p of ['/deck/home/add1', '/deck/clock/toggle', '/deck/quarter/next', '/deck/scores/reset', '/deck/source/manual', '/deck/auto/toggle', '/deck/court/2']) {
    assert.equal(access.refusal(false, 'GET', p, lan, own, 'scoring'), null, p);
  }
  for (const [m, p] of [['POST', '/api/scene'], ['GET', '/deck/layer/up-next/on'], ['GET', '/deck/scene/next'], ['POST', '/api/settings/import'], ['GET', '/api/athletes']]) {
    assert.match(access.refusal(false, m, p, lan, own, 'scoring'), /allowed to score only/, `${m} ${p}`);
  }
  assert.equal(access.scoring('GET', '/api/scoreboard'), false, 'reading is never a change');
});

test('Pairing a browser: allowed to score or for everything, with an HttpOnly SameSite=Strict cookie', async t => {
  const http = require('node:http');
  const get = (studio, p, headers = {}) => new Promise(resolve => http.get({ host: '127.0.0.1', port: studio.port, path: p, headers }, r => {
    let body = ''; r.on('data', d => { body += d; }); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, json: body ? JSON.parse(body) : {} }));
  }));
  const studio = await startStudio(t, { competition: 'Thunder League' });
  assert.deepEqual((await get(studio, '/api/pair/me')).json, { paired: false });

  const asked = (await studio.request('POST', '/api/pair', { name: 'Helper iPhone', browser: true })).json;
  assert.equal((await studio.get('/api/devices')).asking.browser, true);
  await studio.post(`/api/devices/requests/${asked.id}/allow`, {});
  const got = await get(studio, `/api/pair/${asked.id}`, { 'x-studio-pair': asked.token });
  assert.equal(got.json.status, 'allowed');
  assert.equal(got.json.level, 'scoring', 'scoring only unless said otherwise');
  assert.ok(!got.json.key && !got.json.cookie, 'the key goes only in the cookie');
  const cookie = got.headers['set-cookie'][0];
  assert.match(cookie, /^studio_device=[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
  const jar = cookie.split(';')[0];

  assert.deepEqual((await get(studio, '/api/pair/me', { cookie: jar })).json, { paired: true, name: 'Helper iPhone', level: 'scoring' });
  const listed = (await studio.get('/api/devices')).devices.find(d => d.name === 'Helper iPhone');
  assert.equal(listed.kind, 'browser');
  assert.ok(listed.lastSeen, 'its cookie counts as used');
  assert.equal((await get(studio, `/k/${jar.split('=')[1]}/deck/home/add1`)).status, 403, 'a browser\'s key is no Stream Deck key');

  assert.equal((await studio.request('POST', `/api/devices/${listed.id}/level`, { level: 'full' })).status, 200);
  assert.equal((await get(studio, '/api/pair/me', { cookie: jar })).json.level, 'full');
  assert.equal((await studio.request('POST', `/api/devices/${listed.id}/level`, { level: 'root' })).status, 404);
  assert.equal((await studio.request('POST', '/api/devices/mac-links/level', { level: 'scoring' })).status, 404, 'only browsers have a level to change');

  // Allowed for everything from the start.
  const second = (await studio.request('POST', '/api/pair', { name: 'Office laptop', browser: true })).json;
  await studio.post(`/api/devices/requests/${second.id}/allow`, { level: 'full' });
  assert.equal((await get(studio, `/api/pair/${second.id}`, { 'x-studio-pair': second.token })).json.level, 'full');

  await studio.post(`/api/devices/${listed.id}/revoke`);
  assert.deepEqual((await get(studio, '/api/pair/me', { cookie: jar })).json, { paired: false }, 'removed: the cookie counts for nothing');
});
