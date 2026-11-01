// Studio on a new computer (an empty data folder, no competition yet): the pages are served,
// the API explains what's missing instead of failing, and the debug log works.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio, ROOT } = require('./support/studio');

let studio;
test.before(async () => { studio = await startStudio(null); });
test.after(() => studio && studio.stop());

test('every page in public/ is served with the right type', async () => {
  for (const name of fs.readdirSync(path.join(ROOT, 'public')).filter(n => n.endsWith('.html'))) {
    const r = await studio.request('GET', `/${name}`);
    assert.equal(r.status, 200, name);
    assert.match(r.type, /text\/html/, name);
  }
  // The home page is the Output page. The Docs page (graphics.html, the home page at /index.html before that) is now the
  // user guide, so old links to either land there.
  const home = await studio.request('GET', '/');
  assert.equal(home.status, 200);
  assert.equal(home.text, fs.readFileSync(path.join(ROOT, 'public', 'output.html'), 'utf8'));
  for (const was of ['/index.html?division=2', '/graphics.html', '/graphics.html#output']) {
    const old = await fetch(`${studio.base}${was}`, { redirect: 'manual' });
    assert.equal(old.status, 302, was);
    assert.equal(old.headers.get('location'), '/guide/', was);
  }
  assert.equal((await studio.request('GET', '/results.html')).text, fs.readFileSync(path.join(ROOT, 'public', 'fixtures.html'), 'utf8'));
  assert.match((await studio.request('GET', '/studio.css')).type, /text\/css/);
  assert.match((await studio.request('GET', '/scoreboard.js')).type, /javascript/);
  assert.match((await studio.request('GET', '/openapi.yaml')).type, /yaml/);
});

test('unknown files are 404 and nothing outside public/ can be read', async () => {
  assert.equal((await studio.request('GET', '/nothing-here.html')).status, 404);
  for (const p of ['/..%2fserver.js', '/%2e%2e/config.json', '/../package.json']) {
    const r = await studio.request('GET', p);
    assert.ok(r.status === 403 || r.status === 404, `${p} answered ${r.status}`);
    assert.doesNotMatch(r.text, /require\(|"port"|"dependencies"/, p);
  }
});

test('with no competition, the API says what to set up rather than failing', async () => {
  const r = await studio.request('GET', '/api/structure');
  assert.equal(r.status, 502);
  assert.match(r.json.error, /competition setup page/);
  const setup = await studio.get('/api/setup');
  assert.equal(setup.active, null);
  assert.deepEqual(setup.competitions, []);
  assert.ok(setup.fonts.includes('Montserrat'));
  assert.ok(setup.finalsFormats.length > 0);
  // The scoreboard works by hand without one.
  const b = await studio.get('/api/scoreboard');
  assert.equal(b.source, 'manual');
  assert.equal(b.home.name, 'Home');
  assert.match((await studio.request('GET', '/theme.css')).text, /:root \{/);
  assert.equal(studio.calls().filter(c => c.operationName && !/ProfileSearch|TenantConfig/.test(c.operationName)).length, 0, 'PlayHQ not asked');
});

test('version: the page version and the link base', async () => {
  const v = await studio.get('/api/version');
  assert.match(v.version, /^\d+$/);
  assert.match(v.base, /^http:\/\/[^/]+:\d+$/);
  assert.equal((await studio.get('/api/version')).version, v.version, 'the same until something changes');
});

test('the debug log: pages write to it, and it can be read', async () => {
  const r = await studio.request('POST', '/api/log', { level: 'warn', page: 'test.html', message: 'Something to look at', detail: { n: 1 } });
  assert.equal(r.status, 204);
  const log = await studio.request('GET', '/api/log');
  assert.match(log.type, /text\/plain/);
  assert.match(log.text, /WARN  \[page test\.html\] Something to look at \{"n":1\}/);
  assert.match(log.text, /\[helper\] Started on port/);
  assert.match(studio.log(), /Something to look at/, 'in logs/playhq-graphics.log in the data folder');
});

test('the data folder gets its version, and the control page\'s settings file', async () => {
  const version = JSON.parse(fs.readFileSync(path.join(studio.dataDir, 'data-version.json'), 'utf8'));
  assert.equal(version.version, require('../migrations').VERSION);
  assert.ok(fs.existsSync(path.join(studio.dataDir, 'control.json')));
});
