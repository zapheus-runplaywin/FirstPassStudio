// The competition setup page's API (/api/setup..., server.js): finding the competition on PlayHQ,
// making, saving, switching and deleting setups, logos, and template files, through the
// helper as setup.html uses it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio, ROOT } = require('./support/studio');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let studio;
test.before(async () => { studio = await startStudio(null); });
test.after(() => studio && studio.stop());

test('finding the organisation\'s competitions from its PlayHQ link', async () => {
  const found = await studio.get(`/api/setup-find?url=${encodeURIComponent(studio.world.orgUrl)}`);
  assert.equal(found.organisationId, 'a9434809');
  assert.equal(found.tenant, 'netball-australia');
  assert.equal(found.organisation, 'West Coast Mens and Mixed Netball Association');
  const tl = found.competitions.find(c => c.name === 'Thunder League');
  assert.deepEqual(tl.seasons, ['Autumn 2026', 'Spring 2026']);
  assert.equal(tl.currentSeason, 'Spring 2026');
  const bad = await studio.request('GET', '/api/setup-find?url=https%3A%2F%2Fexample.com%2F');
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /doesn't look like a PlayHQ organisation link/);
});

test('a new setup, saved, put to use: the helper follows it straight away', async () => {
  const made = await studio.post('/api/setup-new', { name: 'My League' });
  assert.equal(made.id, 'my-league');
  assert.equal(made.settings.name, 'My League');
  let list = await studio.get('/api/setup');
  assert.equal(list.active, null, 'making one doesn\'t put it to use');
  const saved = await studio.post('/api/setup/my-league', { organisationUrl: studio.world.orgUrl, competitionName: 'Thunder League', quarterMinutes: 12, venueName: 'The Hall' });
  assert.equal(saved.settings.quarterMinutes, 12);
  const used = await studio.post('/api/setup/my-league/activate');
  assert.equal(used.active, true);
  list = await studio.get('/api/setup');
  assert.equal(list.active, 'my-league');
  const st = await studio.get('/api/structure');
  assert.equal(st.setup, 'My League');
  assert.equal(st.rules.periodMinutes, 12);
  assert.equal((await studio.get('/api/scoreboard')).clock.lengthSec, 720, 'the new quarter length on a clock not yet started');
  const teams = await studio.get('/api/setup-teams');
  assert.equal(teams.competition, 'Thunder League');
  assert.equal(teams.teams.length, 8);
  assert.ok(teams.teams.every(x => x.division && x.club));
});

test('logos: uploaded, served to the pages, listed, and removed', async () => {
  let r = await studio.request('POST', '/api/setup/my-league/image?kind=logos&name=Knights.png', PNG, { 'content-type': 'application/octet-stream' });
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'Knights.png');
  assert.deepEqual(r.json.logos, ['Knights.png']);
  r = await studio.request('POST', '/api/setup/my-league/image?kind=brand&name=League.png', PNG, { 'content-type': 'application/octet-stream' });
  assert.deepEqual(r.json.brand, ['League.png']);
  const served = await studio.request('GET', '/logos/Knights.png');
  assert.equal(served.status, 200);
  assert.equal((await studio.request('GET', '/api/setup/my-league/image?kind=logos&name=Knights.png')).status, 200);
  const games = await studio.get('/api/fixtures?round=1');
  assert.ok(games.games.some(g => g.home.name === 'Knights' && g.home.logo === '/logos/Knights.png') ||
    games.games.some(g => g.away.name === 'Knights' && g.away.logo === '/logos/Knights.png'), 'the fixture shows the logo');
  const bad = await studio.request('POST', '/api/setup/my-league/image?kind=logos&name=notes.txt', 'hello', { 'content-type': 'text/plain' });
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /must be PNG/);
  r = await studio.del('/api/setup/my-league/image?kind=logos&name=Knights.png');
  assert.deepEqual(r.logos, []);
  assert.equal((await studio.request('GET', '/logos/Knights.png')).status, 404);
});

test('font files: added to a competition, picked, loaded by theme.css, and only fonts', async () => {
  const r = await studio.request('POST', '/api/setup/my-league/image?kind=fonts&name=ClubSans-Bold.woff2', Buffer.from('wOF2 font'), { 'content-type': 'application/octet-stream' });
  assert.equal(r.status, 200);
  assert.equal(r.json.family, 'Club Sans');
  assert.deepEqual(r.json.fonts, ['ClubSans-Bold.woff2']);
  assert.deepEqual(r.json.fontFamilies, ['Club Sans']);
  await studio.post('/api/setup/my-league', { ...(await studio.get('/api/setup/my-league')).settings, font: 'Club Sans' });
  const css = (await studio.request('GET', '/theme.css')).text;
  assert.match(css, /--font: "Club Sans", "Montserrat"/);
  assert.match(css, /font-family: "Club Sans"; font-style: normal; font-weight: 700;.*url\("\/fonts\/ClubSans-Bold\.woff2"\) format\("woff2"\)/);
  const served = await studio.request('GET', '/fonts/ClubSans-Bold.woff2');
  assert.equal(served.status, 200);
  assert.equal(served.type, 'font/woff2');
  const preview = await studio.request('GET', '/api/setup/my-league/fontcss?font=Club%20Sans');
  assert.match(preview.text, /url\("\/api\/setup\/my-league\/image\?kind=fonts&name=ClubSans-Bold\.woff2"\)/);
  const bad = await studio.request('POST', '/api/setup/my-league/image?kind=fonts&name=Knights.png', PNG, { 'content-type': 'application/octet-stream' });
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /Fonts must be TTF, OTF, WOFF or WOFF2/);
  // The Mac app workflow runs the tests on a Mac, which has fonts of its own; anywhere else there are none.
  const { mac } = await studio.get('/api/setup-fonts');
  if (process.platform === 'darwin') {
    assert.ok(mac.length > 0, 'the Mac lists its fonts');
    assert.ok(mac.every(f => typeof f === 'string' && f && !f.startsWith('.')), 'only plain font family names');
    assert.deepEqual(mac, [...mac].sort((a, b) => a.localeCompare(b)), 'sorted by name');
  } else {
    assert.deepEqual(mac, [], 'no Mac fonts off a Mac');
  }
});

test('a template file exported from one setup and imported as another', async () => {
  const tpl = await studio.get('/api/setup/my-league/template');
  assert.equal(tpl.format, 'firstpass-studio-competition');
  assert.equal(tpl.settings.venueName, 'The Hall');
  assert.ok(tpl.brand['League.png']);
  const imported = await studio.post('/api/setup-template?name=Copy%20of%20My%20League', JSON.stringify(tpl));
  assert.equal(imported.settings.name, 'Copy of My League');
  assert.equal(imported.settings.venueName, 'The Hall');
  assert.deepEqual(imported.brand, ['League.png']);
  assert.deepEqual(imported.fonts, ['ClubSans-Bold.woff2'], 'added fonts go with it');
  assert.equal(imported.settings.font, 'Club Sans');
  assert.equal(imported.active, false, 'importing another doesn\'t change the one in use');
  const bad = await studio.request('POST', '/api/setup-template', 'not json');
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /isn't a FirstPass Studio competition template/);
});

test('every template in templates/ imports through the setup page', async () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'templates')).filter(n => n.endsWith('.json'))) {
    const r = await studio.request('POST', '/api/setup-template', fs.readFileSync(path.join(ROOT, 'templates', f)));
    assert.equal(r.status, 200, `${f}: ${r.text.slice(0, 200)}`);
    assert.equal(r.json.settings.name, JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8')).settings.name);
  }
});

test('switching competition starts that competition\'s scoreboard afresh', async () => {
  await studio.post('/api/scoreboard', { type: 'setScore', side: 'home', value: 9 });
  const other = (await studio.get('/api/setup')).competitions.find(c => c.name === 'AMMNA Nationals');
  await studio.post(`/api/setup/${other.id}/activate`);
  const b = await studio.get('/api/scoreboard');
  assert.equal(b.competitionSetup, 'AMMNA Nationals');
  assert.notEqual(b.home.score, 9);
  await studio.post('/api/setup/my-league/activate');
});

test('deleting the setup in use moves to another, and unknown setups are refused', async () => {
  const before = (await studio.get('/api/setup')).competitions.length;
  const r = await studio.del('/api/setup/my-league');
  assert.equal(r.ok, true);
  assert.ok(r.active && r.active !== 'my-league');
  const list = await studio.get('/api/setup');
  assert.equal(list.competitions.length, before - 1);
  assert.equal(list.active, r.active);
  assert.equal((await studio.request('POST', '/api/setup/no-such-one/activate')).status, 502);
  assert.equal((await studio.request('GET', '/api/setup/Bad%20Id')).status, 404);
});

test('a data folder from a newer Studio: setups can be read but not changed', async t => {
  const data = studio.dataDir;
  const newer = await startStudio(t, { keepDataDir: true, dataDir: fs.mkdtempSync(path.join(path.dirname(data), 'studio-newer-')) });
  await newer.post('/api/setup-new', { name: 'Kept' });
  await newer.stop();
  fs.writeFileSync(path.join(newer.dataDir, 'data-version.json'), JSON.stringify({ version: 999 }));
  const old = await startStudio(t, { dataDir: newer.dataDir });
  t.after(() => fs.rmSync(newer.dataDir, { recursive: true, force: true }));
  const list = await old.get('/api/setup');
  assert.equal(list.readOnly, true);
  assert.deepEqual(list.competitions.map(c => c.name), ['Kept']);
  const r = await old.request('POST', '/api/setup/kept', { venueName: 'Changed' });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /saved by a newer version of FirstPass Studio/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(newer.dataDir, 'data-version.json'), 'utf8')).version, 999);
});
