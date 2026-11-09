// The secure phone link (securelink.js, route53.js, acme.js): Studio points its own name at this Mac in Route 53, gets
// a certificate by the DNS check, and answers on https with it; its https pages count as Studio's own. Against a
// stand-in Route 53 and a stand-in Let's Encrypt here, which check every signature. The certificate is signed with
// openssl, so that part is skipped without it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { startStudio } = require('./support/studio');
const route53 = require('../route53');
const acme = require('../acme');
const access = require('../access');

let openssl = false;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); openssl = true; } catch { /* not installed */ }

const b64u = b => Buffer.from(b).toString('base64url');
const pem = (der, label) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const listen = handler => new Promise(r => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => r(s)); });
const body = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => r(d)); });

test('Route 53 requests are signed as AWS says (Signature Version 4, its get-vanilla example)', () => {
  const h = route53.sign({ method: 'GET', path: '/', host: 'example.amazonaws.com', body: '' },
    { keyId: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }, new Date('2015-08-30T12:36:00Z'), 'us-east-1', 'service');
  assert.equal(h['x-amz-date'], '20150830T123600Z');
  assert.match(h.authorization, /Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/);
  assert.equal(route53.zoneIdOf(' /hostedzone/Z123ABC '), 'Z123ABC');
  assert.match(route53.explain(403, 'SignatureDoesNotMatch'), /secret/);
});

test('the certificate request carries the name and checks out', { skip: !openssl && 'no openssl' }, () => {
  const key = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csr-'));
  try {
    fs.writeFileSync(path.join(dir, 'r.csr'), pem(acme.csr('k3f9x2.studio.firstpass.pivt.au', key), 'CERTIFICATE REQUEST'));
    const out = execFileSync('openssl', ['req', '-in', path.join(dir, 'r.csr'), '-noout', '-verify', '-text'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /DNS:k3f9x2\.studio\.firstpass\.pivt\.au/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the secure link\'s https pages are Studio\'s own; its settings answer this Mac only', () => {
  const hosts = access.ownHosts(['matts-mac.local', 'k3f9x2.studio.firstpass.pivt.au'], new Set(['127.0.0.1']));
  const secure = { host: 'k3f9x2.studio.firstpass.pivt.au', port: 8443 };
  const check = (origin, s = secure) => access.crossSite('POST', '/api/scene', { origin, host: 'k3f9x2.studio.firstpass.pivt.au:8443' }, 8080, hosts, s);
  assert.equal(check('https://k3f9x2.studio.firstpass.pivt.au:8443'), null);
  assert.match(check('https://k3f9x2.studio.firstpass.pivt.au:8443', null), /another site|refused/, 'not while it\'s off');
  assert.match(check('https://k3f9x2.studio.firstpass.pivt.au:9999'), /refused/);
  assert.match(check('https://evil.studio.firstpass.pivt.au:8443'), /refused/);
  assert.match(check('http://k3f9x2.studio.firstpass.pivt.au:8443'), /refused/);
  assert.match(access.notThisMac('GET', '/api/securelink', '192.168.1.50', new Set(['127.0.0.1'])), /only be seen and changed on the Mac/);
});

test('turned on, Studio points its name at the Mac, gets a certificate and answers on https', { skip: !openssl && 'no openssl' }, async t => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'securelink-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  // A CA for the stand-in Let's Encrypt to sign with.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-subj', '/CN=Stand-in CA', '-days', '2',
    '-keyout', path.join(work, 'ca.key'), '-out', path.join(work, 'ca.pem')], { stdio: 'ignore' });

  // The stand-in Route 53: checks each request is signed with the key, keeps the records.
  const records = new Map(); // "name TYPE" -> [values]
  const changes = [];
  let asked = 0; // every request to Route 53
  const r53 = await listen(async (req, res) => {
    asked++;
    const text = await body(req);
    const want = route53.sign({ method: req.method, path: req.url, host: req.headers.host, body: text }, { keyId: 'AKIATESTKEY000000001', secret: 'test/secret+key0123456789abcdefghijklmn' }, new Date(Date.UTC(
      ...(m => [m[1], m[2] - 1, m[3], m[4], m[5], m[6]])(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(req.headers['x-amz-date'])))));
    if (req.headers.authorization !== want.authorization) { res.writeHead(403); return res.end('<ErrorResponse><Error><Code>SignatureDoesNotMatch</Code><Message>no</Message></Error></ErrorResponse>'); }
    const zones = { ZTESTZONE123: 'studio.firstpass.pivt.au.', ZOTHERZONE99: 'studio.example.org.' };
    const list = /^\/2013-04-01\/hostedzone\/(\w+)\/rrset\?maxitems=1$/.exec(req.url);
    if (req.method === 'GET' && list) { res.writeHead(200); return res.end(`<ListResourceRecordSetsResponse><ResourceRecordSets><ResourceRecordSet><Name>${zones[list[1]]}</Name><Type>NS</Type></ResourceRecordSet></ResourceRecordSets></ListResourceRecordSetsResponse>`); }
    if (req.method === 'GET') { res.writeHead(200); return res.end('<GetChangeResponse><ChangeInfo><Id>/change/C1</Id><Status>INSYNC</Status></ChangeInfo></GetChangeResponse>'); }
    assert.match(req.url, /^\/2013-04-01\/hostedzone\/(ZTESTZONE123|ZOTHERZONE99)\/rrset$/);
    const tag = n => [...text.matchAll(new RegExp(`<${n}>([^<]*)</${n}>`, 'g'))].map(m => m[1]);
    const [action] = tag('Action'), [name] = tag('Name'), [type] = tag('Type');
    const values = tag('Value').map(v => v.replace(/^"|"$/g, ''));
    changes.push({ action, name, type, values });
    if (action === 'DELETE') records.delete(`${name} ${type}`); else records.set(`${name} ${type}`, values);
    res.writeHead(200); res.end('<ChangeResourceRecordSetsResponse><ChangeInfo><Id>/change/C1</Id><Status>PENDING</Status></ChangeInfo></ChangeResourceRecordSetsResponse>');
  });
  t.after(() => r53.close());

  // The stand-in Let's Encrypt: checks each request's signature and nonce, and the TXT record before saying valid.
  let base = '';
  let accountJwk = null;
  const nonces = new Set();
  const order = { status: 'pending', name: '', token: b64u(crypto.randomBytes(16)), authz: 'pending', cert: '' };
  const lets = await listen(async (req, res) => {
    const nonce = b64u(crypto.randomBytes(12)); nonces.add(nonce);
    const json = (status, obj, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'replay-nonce': nonce, ...extra }); res.end(JSON.stringify(obj)); };
    if (req.url === '/directory') return json(200, { newNonce: `${base}/nonce`, newAccount: `${base}/account`, newOrder: `${base}/order` });
    if (req.url === '/nonce') { res.writeHead(200, { 'replay-nonce': nonce }); return res.end(); }
    const jws = JSON.parse(await body(req));
    const head = JSON.parse(Buffer.from(jws.protected, 'base64url'));
    assert.ok(nonces.delete(head.nonce), 'a nonce is used once');
    assert.equal(head.url, `${base}${req.url}`);
    const jwk = head.jwk || (head.kid === `${base}/acct/1` && accountJwk);
    assert.ok(jwk, 'a known account');
    assert.ok(crypto.verify('sha256', Buffer.from(`${jws.protected}.${jws.payload}`), { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(jws.signature, 'base64url')), 'signed by the account');
    const payload = jws.payload ? JSON.parse(Buffer.from(jws.payload, 'base64url')) : null;
    if (req.url === '/account') { accountJwk = head.jwk; return json(201, { status: 'valid' }, { location: `${base}/acct/1` }); }
    if (req.url === '/order') { order.name = payload.identifiers[0].value; return json(201, { status: 'pending', authorizations: [`${base}/authz`], finalize: `${base}/finalize` }, { location: `${base}/order/1` }); }
    if (req.url === '/authz') return json(200, { status: order.authz, challenges: [{ type: 'http-01', url: `${base}/nope`, token: 'x' }, { type: 'dns-01', url: `${base}/chall`, token: order.token }] });
    if (req.url === '/chall') {
      const thumb = b64u(crypto.createHash('sha256').update(JSON.stringify({ crv: accountJwk.crv, kty: accountJwk.kty, x: accountJwk.x, y: accountJwk.y })).digest());
      const want = b64u(crypto.createHash('sha256').update(`${order.token}.${thumb}`).digest());
      order.authz = (records.get(`_acme-challenge.${order.name} TXT`) || []).includes(want) ? 'valid' : 'invalid';
      return json(200, { status: 'processing' });
    }
    if (req.url === '/finalize') {
      fs.writeFileSync(path.join(work, 'r.csr'), pem(Buffer.from(payload.csr, 'base64url'), 'CERTIFICATE REQUEST'));
      fs.writeFileSync(path.join(work, 'ext'), `subjectAltName=DNS:${order.name}\n`);
      execFileSync('openssl', ['x509', '-req', '-in', path.join(work, 'r.csr'), '-CA', path.join(work, 'ca.pem'), '-CAkey', path.join(work, 'ca.key'), '-CAcreateserial',
        '-days', '90', '-extfile', path.join(work, 'ext'), '-out', path.join(work, 'cert.pem')], { stdio: 'ignore' });
      order.cert = fs.readFileSync(path.join(work, 'cert.pem'), 'utf8') + fs.readFileSync(path.join(work, 'ca.pem'), 'utf8');
      order.status = 'valid';
      return json(200, { status: 'processing' });
    }
    if (req.url === '/order/1') return json(200, { status: order.status, certificate: `${base}/cert` });
    if (req.url === '/cert') { res.writeHead(200, { 'content-type': 'application/pem-certificate-chain', 'replay-nonce': nonce }); return res.end(order.cert); }
    json(404, { type: 'urn:ietf:params:acme:error:malformed', detail: req.url });
  });
  t.after(() => lets.close());
  base = `http://127.0.0.1:${lets.address().port}`;

  const securePort = await freePort();
  const studio = await startStudio(t, { env: {
    SECURELINK_ROUTE53_URL: `http://127.0.0.1:${r53.address().port}`, SECURELINK_ACME_DIRECTORY: `${base}/directory`,
    SECURELINK_ADDRESS: '127.0.0.1', SECURELINK_KEYCHAIN: '0', SECURELINK_POLL_MS: '50', SECURE_PORT: String(securePort),
  } });

  const off = await studio.get('/api/securelink');
  assert.equal(off.state, 'off');
  assert.equal(off.link, null);
  assert.match((await studio.get('/api/phone-link?page=/remote.html')).link, /^http:\/\//, 'the http link while it\'s off');
  assert.equal((await studio.request('POST', '/api/securelink', { zoneId: 'not a zone' })).status, 400);
  assert.match((await studio.post('/api/securelink', { on: true })).problem, /Fill in/, 'not without the key');

  const started = await studio.post('/api/securelink', { zoneId: '/hostedzone/ZTESTZONE123', keyId: 'AKIATESTKEY000000001', secret: 'test/secret+key0123456789abcdefghijklmn', on: true });
  assert.equal(started.hasSecret, true);
  assert.equal(JSON.stringify(started).includes('test/secret'), false, 'the secret is never read back');
  const ready = await studio.until(async () => { const s = await studio.get('/api/securelink'); assert.notEqual(s.state, 'problem', s.problem); return s.state === 'ready' && s; }, 20000);
  const host = ready.host;
  assert.match(host, /^[a-z0-9]{6}\.studio\.firstpass\.pivt\.au$/, 'the name is in the zone, read from Route 53');
  assert.equal(ready.domain, 'studio.firstpass.pivt.au');
  assert.equal(ready.link, `https://${host}:${securePort}`);
  assert.deepEqual(records.get(`${host} A`), ['127.0.0.1'], 'the name points at the Mac');
  assert.ok(changes.some(c => c.type === 'TXT' && c.action === 'UPSERT') && !records.has(`_acme-challenge.${host} TXT`), 'the check record went up and came down');
  assert.equal((await studio.get('/api/phone-link?page=/remote.html')).link, `https://${host}:${securePort}/pair.html?then=%2Fremote.html`);

  // Studio on https, by its name, with the certificate it was given.
  const get = (p, headers = {}, method = 'GET', data) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: securePort, servername: host, path: p, method, headers: { host: `${host}:${securePort}`, ...headers }, rejectUnauthorized: false }, res => {
      const cert = res.socket.getPeerCertificate();
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, text: d, cert }));
    });
    req.on('error', reject);
    req.end(data);
  });
  const page = await get('/api/version');
  assert.equal(page.status, 200);
  assert.match(page.cert.subjectaltname, new RegExp(`DNS:${host.replace(/\./g, '\\.')}`));
  assert.equal(page.cert.issuer.CN, 'Stand-in CA');
  // A change from its own https page passes the other-site check; one from another site doesn't.
  const change = origin => get('/api/scoreboard', { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, 'POST', JSON.stringify({ type: 'noop' }));
  assert.notEqual((await change(`https://${host}:${securePort}`)).status, 403);
  assert.equal((await change('https://example.com')).status, 403);

  // Another zone: Studio reads its name, and the Mac's name moves into it with a new certificate.
  await studio.post('/api/securelink', { zoneId: 'ZOTHERZONE99' });
  const moved = await studio.until(async () => { const s = await studio.get('/api/securelink'); assert.notEqual(s.state, 'problem', s.problem); return s.state === 'ready' && s.host !== host && s; }, 20000);
  assert.equal(moved.host, host.replace('studio.firstpass.pivt.au', 'studio.example.org'));
  assert.deepEqual(records.get(`${moved.host} A`), ['127.0.0.1']);
  const other = await new Promise((resolve, reject) => https.get({ host: '127.0.0.1', port: securePort, servername: moved.host, path: '/api/version', headers: { host: `${moved.host}:${securePort}` }, rejectUnauthorized: false }, res => { resolve(res.socket.getPeerCertificate()); res.resume(); }).on('error', reject));
  assert.match(other.subjectaltname, /studio\.example\.org/);

  // Studio starting again on the same network (a copy of its settings, beside this one): https answers at once with
  // the saved certificate, and nothing is asked of Route 53 (the name already points here).
  const again = fs.mkdtempSync(path.join(os.tmpdir(), 'securelink-again-'));
  fs.copyFileSync(path.join(studio.dataDir, 'securelink.json'), path.join(again, 'securelink.json'));
  const asking = asked;
  const securePort2 = await freePort();
  const restarted = await startStudio(t, { dataDir: again, removeDataDir: true, env: {
    SECURELINK_ROUTE53_URL: `http://127.0.0.1:${r53.address().port}`, SECURELINK_ACME_DIRECTORY: `${base}/directory`,
    SECURELINK_ADDRESS: '127.0.0.1', SECURELINK_KEYCHAIN: '0', SECURELINK_POLL_MS: '50', SECURE_PORT: String(securePort2),
  } });
  const at = await restarted.until(async () => { const st = await restarted.get('/api/securelink'); return st.state === 'ready' && st; }, 3000);
  assert.equal(at.host, moved.host);
  const quick = await new Promise((resolve, reject) => https.get({ host: '127.0.0.1', port: securePort2, servername: moved.host, path: '/api/version', headers: { host: `${moved.host}:${securePort2}` }, rejectUnauthorized: false }, res => { resolve(res.statusCode); res.resume(); }).on('error', reject));
  assert.equal(quick, 200);
  await new Promise(r => setTimeout(r, 500));
  assert.equal(asked, asking, 'nothing sent to Route 53');
  await restarted.stop();

  // Turned off: no https, the http link again; the certificate is kept for next time.
  const stopped = await studio.post('/api/securelink', { on: false });
  assert.equal(stopped.state, 'off');
  assert.ok(stopped.expires);
  await assert.rejects(get('/api/version'));
  assert.match((await studio.get('/api/phone-link')).link, /^http:\/\//);
  assert.match(studio.log(), /Got a certificate for/);
});

test('the Devices tab shows the Secure phone link card on the Mac and says what\'s missing', async t => {
  let chromium = null;
  try { ({ chromium } = require('playwright')); } catch { /* not installed */ }
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Devices tab in');
    t.skip('no browser to test the Devices tab in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { env: { SECURELINK_KEYCHAIN: '0', SECURE_PORT: String(await freePort()) } });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${studio.base}/api.html`);
  await page.waitForSelector('#secureSection:not([hidden])');
  assert.match(await page.textContent('#secureSays'), /^Off/);
  await page.click('#secureOn');
  await page.waitForFunction(() => /Fill in the hosted zone ID/.test(document.getElementById('secureSays').textContent));
  assert.equal(await page.textContent('#secureOn'), 'Turn off');
  await page.fill('#secureZone', 'nonsense');
  await page.dispatchEvent('#secureZone', 'change');
  await page.waitForFunction(() => /hosted zone ID starts with Z/.test(document.body.textContent));
  await page.click('#secureOn');
  await page.waitForFunction(() => /^Off/.test(document.getElementById('secureSays').textContent));
});
