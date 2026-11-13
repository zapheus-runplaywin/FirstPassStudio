// Signing in to each club's FirstPass HQ (hqauth.ts, keychain.ts, the FirstPass HQ card on the Devices tab): Google
// sign-in with PKCE through a one-time 127.0.0.1 address, the Studio role checked, the refresh token kept in the
// Keychain (a local file outside the Mac app) and nowhere else, and signing out, HQ ending the session or the role
// going all delete the token and that club's FirstPass stats. A stand-in HQ plays the club's Supabase project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
process.env.STUDIO_KEYCHAIN = '0';
const hqauth = require('../out/hqauth');
const keychain = require('../out/keychain');
const firstpass = require('../out/firstpass');
const access = require('../out/access');
const location = require('../out/datalocation');
const { startStudio } = require('./support/studio.mts');
const { openPage } = require('./support/browser.mts');

const GAME = '0b6c8f8e-3f7a-4d1e-9a51-2a7c1d9e4b10';
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return fn(); };
const jwt = n => `eyJhbGciOiJIUzI1NiJ9.eyJuIjo${n}fQ.c2lnbmF0dXJl${n}`;

// The club's Supabase project, as far as signing in goes. hq.role says whether the account has the Studio role.
async function startHq() {
  const hq = { role: true, email: 'streamer@example.com', challenge: '', refresh: '', access: '', n: 0, calls: [], refuseRefresh: false, error: '' };
  const issue = () => {
    hq.n++;
    hq.access = jwt(hq.n);
    hq.refresh = `refresh-${hq.n}-${crypto.randomBytes(4).toString('hex')}`;
    return { access_token: hq.access, refresh_token: hq.refresh, expires_in: 3600, token_type: 'bearer', user: { email: hq.email } };
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : {};
    const send = (status, j) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(j === undefined ? '' : JSON.stringify(j)); };
    hq.calls.push(`${req.method} ${url.pathname}${url.searchParams.get('grant_type') ? `?${url.searchParams.get('grant_type')}` : ''}`);
    if (url.pathname === '/auth/v1/authorize') {
      assert.equal(url.searchParams.get('provider'), 'google');
      assert.equal(url.searchParams.get('code_challenge_method'), 's256');
      hq.challenge = url.searchParams.get('code_challenge');
      const back = new URL(url.searchParams.get('redirect_to'));
      assert.equal(back.hostname, '127.0.0.1');
      if (hq.error) back.searchParams.set('error_description', hq.error); else back.searchParams.set('code', 'one-time-code');
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const ok = json.auth_code === 'one-time-code' && crypto.createHash('sha256').update(json.code_verifier || '').digest('base64url') === hq.challenge;
      return ok ? send(200, issue()) : send(400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      if (hq.refuseRefresh || json.refresh_token !== hq.refresh) return send(400, { error_code: 'refresh_token_not_found' });
      return send(200, issue());
    }
    if (url.pathname === '/rest/v1/rpc/has_role') {
      assert.equal(json.p_role, 'studio');
      if (req.headers.authorization !== `Bearer ${hq.access}`) return send(401, { message: 'JWT expired' });
      return send(200, hq.role);
    }
    if (url.pathname === '/auth/v1/logout') return send(204);
    send(404, {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  hq.url = `http://127.0.0.1:${server.address().port}`;
  hq.close = () => new Promise(r => server.close(r));
  return hq;
}

function clubsFile(hq) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-clubs-'));
  const file = path.join(dir, 'hqclubs.json');
  fs.writeFileSync(file, JSON.stringify({ clubs: [{ code: 'THUNDER', name: 'West Coast Thunder', supabaseUrl: hq.url, anonKey: 'public-anon-key' }] }));
  return file;
}

// hqauth.create() with a stand-in HQ, a keychain file and a FirstPass store in a folder of their own.
async function setup(t) {
  const hq = await startHq();
  t.after(() => hq.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-auth-'));
  const lines = [];
  const log = (...a) => lines.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  const store = firstpass.create({ log, dir: path.join(dir, 'firstpass') });
  const tokens = keychain.create('FirstPass Studio HQ sign-in', path.join(dir, 'hq-tokens.json'));
  const auth = hqauth.create({ log, store, tokens, metaFile: path.join(dir, 'hq-signins.json'), clubs: hqauth.readClubs(clubsFile(hq)) });
  t.after(() => auth.stop());
  // The browser: opens the sign-in page and follows HQ back to Studio's one-time address.
  const browse = async url => { const r = await fetch(url); return { status: r.status, text: await r.text(), at: r.url }; };
  return { hq, dir, lines, store, tokens, auth, browse };
}

test('the clubs list keeps only clubs with a code, a name, an https address and a public key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-list-'));
  const file = path.join(dir, 'hqclubs.json');
  fs.writeFileSync(file, JSON.stringify({ clubs: [
    { code: ' thunder ', name: 'West Coast Thunder', supabaseUrl: 'https://abcd.supabase.co/', anonKey: 'k' },
    { code: 'THUNDER', name: 'Again', supabaseUrl: 'https://efgh.supabase.co', anonKey: 'k' },
    { code: 'PLAIN', name: 'Plain http', supabaseUrl: 'http://abcd.supabase.co', anonKey: 'k' },
    { code: 'NOKEY', name: 'No key', supabaseUrl: 'https://abcd.supabase.co' },
    { code: 'bad code!', name: 'Bad', supabaseUrl: 'https://abcd.supabase.co', anonKey: 'k' },
  ] }));
  assert.deepEqual(hqauth.readClubs(file), [{ code: 'THUNDER', name: 'West Coast Thunder', supabaseUrl: 'https://abcd.supabase.co', anonKey: 'k' }]);
  assert.deepEqual(hqauth.readClubs(path.join(dir, 'missing.json')), []);
  // The list the app ships with reads, and every club in it is a real one.
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hqclubs.json'), 'utf8'));
  assert.equal(hqauth.readClubs(path.join(__dirname, '..', 'hqclubs.json')).length, shipped.clubs.length);
});

test('signing in: PKCE through a one-time 127.0.0.1 address, the role checked, the refresh token kept in the Keychain only', async t => {
  const { hq, dir, lines, tokens, auth, browse } = await setup(t);
  assert.equal(auth.list()[0].state, 'signed-out');
  const started = await auth.signIn('THUNDER');
  const url = new URL(started.url);
  assert.equal(url.origin + url.pathname, `${hq.url}/auth/v1/authorize`);
  assert.match(url.searchParams.get('redirect_to'), /^http:\/\/127\.0\.0\.1:\d+\/firstpass-[\w-]{20,}$/);
  assert.equal(auth.list()[0].state, 'signing-in');
  const page = await browse(started.url);
  assert.match(page.text, /Signed in/);
  assert.match(page.text, /West Coast Thunder/);
  const club = auth.list()[0];
  assert.equal(club.state, 'signed-in');
  assert.equal(club.email, 'streamer@example.com');
  assert.equal(await tokens.get('THUNDER'), hq.refresh);
  assert.equal(await auth.accessToken('THUNDER'), hq.access);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'hq-signins.json'), 'utf8'))), ['THUNDER']);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'hq-signins.json'), 'utf8'), /refresh-|eyJ/, 'only who and when, never a token');
  // The one-time address answers once: it is closed now.
  await assert.rejects(fetch(url.searchParams.get('redirect_to') + '?code=again'));
  // Nothing secret in the log.
  assert.doesNotMatch(lines.join('\n'), /refresh-\d|eyJ|one-time-code/);
  assert.match(lines.join('\n'), /THUNDER: signed in/);
  // Both keychain files stay on this Mac.
  for (const f of ['hq-tokens.json', 'hq-signins.json', 'firstpass']) assert.ok(location.LOCAL_ONLY.has(f), f);
  assert.equal(fs.statSync(path.join(dir, 'hq-tokens.json')).mode & 0o077, 0, 'the fallback file is readable by this user only');
});

test('an account without the Studio role keeps nothing, and the card says why', async t => {
  const { hq, tokens, auth, browse } = await setup(t);
  hq.role = false;
  const page = await browse((await auth.signIn('THUNDER')).url);
  assert.match(page.text, /Not signed in/);
  const club = auth.list()[0];
  assert.equal(club.state, 'signed-out');
  assert.match(club.problem, /streamer@example\.com doesn't have the Studio role in West Coast Thunder's FirstPass HQ/);
  assert.equal(await tokens.get('THUNDER'), '');
  assert.ok(await until(() => hq.calls.includes('POST /auth/v1/logout')), 'the session HQ made is ended');
});

test('a sign-in HQ turns down, or a code that isn\'t this Studio\'s, keeps nothing', async t => {
  const { hq, tokens, auth, browse } = await setup(t);
  hq.error = 'Access denied by the user';
  const page = await browse((await auth.signIn('THUNDER')).url);
  assert.match(page.text, /Access denied by the user/);
  assert.match(auth.list()[0].problem, /Access denied/);
  assert.equal(await tokens.get('THUNDER'), '');
  // A sign-in started twice: only the latest one-time address is listening.
  hq.error = '';
  const first = await auth.signIn('THUNDER');
  const second = await auth.signIn('THUNDER');
  await assert.rejects(fetch(new URL(first.url).searchParams.get('redirect_to') + '?code=one-time-code'));
  assert.match((await browse(second.url)).text, /Signed in/);
});

test('signing out deletes the token, who signed in, and every FirstPass stat kept for the club', async t => {
  const { hq, dir, store, tokens, auth, browse } = await setup(t);
  await browse((await auth.signIn('THUNDER')).url);
  store.save('THUNDER', GAME, { goals: 3 });
  assert.equal(await auth.signOut('THUNDER'), true);
  assert.equal(await tokens.get('THUNDER'), '');
  assert.equal(auth.list()[0].state, 'signed-out');
  assert.equal(auth.list()[0].problem, '');
  assert.equal(fs.existsSync(path.join(dir, 'firstpass', 'THUNDER')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'hq-tokens.json'), 'utf8')), {});
  assert.equal(await auth.accessToken('THUNDER'), '');
  assert.ok(await until(() => hq.calls.includes('POST /auth/v1/logout')));
});

test('a refresh keeps the new refresh token; HQ ending the session or the role going signs the club out and deletes its stats', async t => {
  const { hq, dir, store, tokens, auth, browse } = await setup(t);
  await browse((await auth.signIn('THUNDER')).url);
  const first = hq.refresh;
  assert.equal(await auth.refresh('THUNDER'), true);
  assert.notEqual(hq.refresh, first);
  assert.equal(await tokens.get('THUNDER'), hq.refresh, 'HQ rotates the refresh token, so the new one is kept');
  // Two at once share one refresh, so the old token is never used twice.
  const calls = hq.calls.length;
  assert.deepEqual(await Promise.all([auth.refresh('THUNDER'), auth.refresh('THUNDER')]), [true, true]);
  assert.equal(hq.calls.slice(calls).filter(c => c.endsWith('?refresh_token')).length, 1);
  // The role removed or paused in HQ.
  store.save('THUNDER', GAME, {});
  hq.role = false;
  assert.equal(await auth.refresh('THUNDER'), false);
  assert.equal(auth.list()[0].state, 'signed-out');
  assert.match(auth.list()[0].problem, /Studio role was removed or paused/);
  assert.equal(fs.existsSync(path.join(dir, 'firstpass', 'THUNDER')), false);
  assert.equal(await tokens.get('THUNDER'), '');
  // Signed in again, then HQ ends the session.
  hq.role = true;
  await browse((await auth.signIn('THUNDER')).url);
  store.save('THUNDER', GAME, {});
  hq.refuseRefresh = true;
  assert.equal(await auth.refresh('THUNDER'), false);
  assert.match(auth.list()[0].problem, /HQ ended the sign-in/);
  assert.equal(fs.existsSync(path.join(dir, 'firstpass', 'THUNDER')), false);
});

test('HQ out of reach keeps the sign-in and the stats, and says so', async t => {
  const { hq, dir, store, tokens, auth, browse } = await setup(t);
  await browse((await auth.signIn('THUNDER')).url);
  store.save('THUNDER', GAME, {});
  const kept = await tokens.get('THUNDER');
  await hq.close();
  assert.equal(await auth.refresh('THUNDER'), false);
  assert.equal(auth.list()[0].state, 'offline');
  assert.match(auth.list()[0].problem, /can't be reached/);
  assert.equal(await tokens.get('THUNDER'), kept);
  assert.ok(fs.existsSync(path.join(dir, 'firstpass', 'THUNDER', `${GAME}.json`)));
});

test('signing in is for this Mac only', () => {
  assert.match(access.notThisMac('GET', '/api/firstpass/clubs', '10.0.0.5', new Set(['127.0.0.1'])), /only be seen and changed on the Mac/);
  assert.match(access.notThisMac('POST', '/api/firstpass/clubs/THUNDER/signin', '10.0.0.5', new Set(['127.0.0.1'])), /Mac/);
  assert.equal(access.notThisMac('POST', '/api/firstpass/clubs/THUNDER/signin', '127.0.0.1', new Set(['127.0.0.1'])), null);
});

test('Studio signs in from the Devices tab\'s card and signs out again', async t => {
  const hq = await startHq();
  t.after(() => hq.close());
  const studio = await startStudio(t, { env: { HQ_CLUBS_FILE: clubsFile(hq), STUDIO_NO_BROWSER: '1', STUDIO_KEYCHAIN: '0' } });
  assert.deepEqual((await studio.get('/api/firstpass/clubs')).clubs.map(c => [c.code, c.state]), [['THUNDER', 'signed-out']]);
  assert.equal((await studio.request('POST', '/api/firstpass/clubs/NOPE/signin')).status, 404);
  const started = await studio.post('/api/firstpass/clubs/THUNDER/signin');
  assert.match(started.url, /\/auth\/v1\/authorize\?/);
  const page = await (await fetch(started.url)).text();
  assert.match(page, /Signed in/);
  const club = (await studio.get('/api/firstpass/clubs')).clubs[0];
  assert.equal(club.state, 'signed-in');
  assert.equal(club.email, 'streamer@example.com');
  assert.match(fs.readFileSync(path.join(studio.dataDir, 'hq-tokens.json'), 'utf8'), /refresh-1-/);
  assert.doesNotMatch(studio.log(), /refresh-1-|eyJ|one-time-code/);
  // A settings backup never carries it.
  const backup = await studio.request('GET', '/api/settings/export');
  assert.equal(backup.status, 200);
  assert.doesNotMatch(backup.text, /refresh-1-|hq-tokens|hq-signins/);
  const out = await studio.post('/api/firstpass/clubs/THUNDER/signout');
  assert.equal(out.clubs[0].state, 'signed-out');
  assert.doesNotMatch(fs.readFileSync(path.join(studio.dataDir, 'hq-tokens.json'), 'utf8'), /refresh-/);
});

test('the Devices tab shows the FirstPass HQ card on the Mac, with each club and Sign in', async t => {
  const hq = await startHq();
  t.after(() => hq.close());
  const studio = await startStudio(t, { env: { HQ_CLUBS_FILE: clubsFile(hq), STUDIO_NO_BROWSER: '1', STUDIO_KEYCHAIN: '0' } });
  const page = await openPage(t, studio, '/api.html');
  if (!page) return;
  await page.waitForSelector('#hqSection:not([hidden]) .club');
  assert.match(await page.textContent('#hqClubs'), /West Coast Thunder: not signed in/);
  await page.click('#hqClubs button:has-text("Sign in")');
  await page.waitForSelector('#hqClubs a:has-text("Open the sign-in page")');
  assert.match(await page.textContent('#hqClubs'), /waiting for the sign-in/);
  const href = await page.getAttribute('#hqClubs a', 'href');
  await fetch(href);
  await page.waitForFunction(() => /signed in as streamer@example\.com/.test(document.getElementById('hqClubs').textContent));
  assert.match(await page.textContent('#hqClubs button'), /Sign out/);
});
