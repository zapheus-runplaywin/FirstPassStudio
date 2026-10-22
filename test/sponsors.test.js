// Sponsors (sponsors.js, the Sponsors page): sponsors kept once and shown on competitions at a tier
// in each, the competition's tier names, what an empty tier's spots do, the vacancy card, logos and
// QR codes, through the helper as sponsors.html uses it.
const test = require('node:test');
const assert = require('node:assert/strict');
const qrcode = require('qrcode-generator');
const { startStudio } = require('./support/studio');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let studio, comp;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  comp = (await studio.get('/api/sponsors')).competition.id;
});
test.after(() => studio && studio.stop());

const add = (s, tier) => studio.post('/api/sponsors', { ...s, competitions: tier ? { [comp]: { tier } } : {} });
const pick = (tier, place = 'card') => studio.get(`/api/sponsors/pick?tier=${tier}&place=${place}`);
const reset = async () => { for (const s of (await studio.get('/api/sponsors')).sponsors) await studio.del(`/api/sponsors?id=${s.id}`); };

test('a sponsor is added, cleaned up and shown at its tier on the competition in use', async () => {
  await reset();
  const view = await add({ name: '  Golds Bakery ', website: 'goldsbakery.com.au', colour: '#B91C1C', start: 'soon', targetSeconds: '450', tagline: 'x'.repeat(200) }, 'naming');
  const s = view.sponsors.find(x => x.name === 'Golds Bakery');
  assert.equal(s.id, 'golds-bakery');
  assert.equal(s.website, 'https://goldsbakery.com.au');
  assert.equal(s.colour, '#b91c1c');
  assert.equal(s.start, '', 'a date that isn\'t one is dropped');
  assert.equal(s.targetSeconds, 450);
  assert.equal(s.tagline.length, 120);
  assert.deepEqual(s.competitions, { [comp]: { tier: 'naming' } });
  assert.equal(s.state, 'current');
  assert.equal(view.competition.name, 'Thunder League');
  assert.deepEqual(view.tiers.map(t => [t.key, t.name, t.share]),
    [['naming', 'Naming rights', 5], ['elite', 'Elite', 3], ['major', 'Major', 2], ['partner', 'Partner', 1], ['supporter', 'Supporter', 0.5]]);
  const again = await add({ name: 'Golds Bakery' }, 'major');
  assert.ok(again.sponsors.some(x => x.id === 'golds-bakery-2'), 'a second sponsor of the same name gets its own id');
});

test('tier names: Names, Metals or the competition\'s own', async () => {
  let view = await studio.post('/api/sponsors/settings', { sponsorTierNames: 'metals' });
  assert.deepEqual(view.tiers.map(t => t.name), ['Naming rights', 'Platinum', 'Gold', 'Silver', 'Bronze']);
  view = await studio.post('/api/sponsors/settings', { sponsorTierNames: 'own', sponsorOwnNames: { elite: 'Diamond', supporter: '' } });
  assert.deepEqual(view.tiers.map(t => t.name), ['Naming rights', 'Diamond', 'Major', 'Partner', 'Supporter'], 'a blank own name keeps the Names one');
  view = await studio.post('/api/sponsors/settings', { sponsorTierNames: 'nonsense' });
  assert.equal(view.tierNames, 'names');
  const setup = await studio.get(`/api/setup/${comp}`);
  assert.equal(setup.settings.sponsorTierNames, 'names', 'kept in the competition\'s own settings');
  assert.deepEqual(setup.settings.sponsorOwnNames, { elite: 'Diamond' });
});

test('an empty tier pulls up or down past empty tiers, skips, or shows the vacancy card where a card fits', async () => {
  await reset();
  await studio.post('/api/sponsors/settings', { sponsorEmpty: {}, sponsorVacancy: {} });
  const view = await studio.get('/api/sponsors');
  assert.deepEqual(Object.fromEntries(view.tiers.map(t => [t.key, t.empty])),
    { naming: 'vacancy', elite: 'down', major: 'down', partner: 'up', supporter: 'skip' }, 'the defaults');

  await add({ name: 'Wave Physio', website: 'wavephysio.com.au' }, 'major');
  await add({ name: 'Surf Club' }, 'partner');
  let r = await pick('major');
  assert.deepEqual(r.sponsors.map(s => s.name), ['Wave Physio']);
  assert.equal(r.tier, 'major');
  r = await pick('elite');
  assert.equal(r.tier, 'major', 'Elite pulls up from Major');
  assert.equal(r.from, 'elite');
  assert.equal(r.sponsors[0].logoUrl, null);
  assert.match(r.sponsors[0].qrLink, /^https:\/\/wavephysio\.com\.au\/\?utm_source=livestream&utm_medium=qr&utm_campaign=thunder-league&utm_content=card$/);
  assert.deepEqual(await pick('supporter'), { skip: true });

  // Naming rights advertises the vacancy, but only once the card has a link, and only where a card fits.
  assert.deepEqual(await pick('naming'), { skip: true }, 'no link yet');
  await studio.post('/api/sponsors/settings', { sponsorVacancy: { link: 'sponsors@thunder.com.au', contact: 'Matt' } });
  r = await pick('naming');
  assert.equal(r.vacancy.link, 'mailto:sponsors@thunder.com.au');
  assert.equal(r.vacancy.heading, 'Your business here');
  assert.equal(r.vacancy.contact, 'Matt');
  assert.deepEqual(await pick('naming', 'tab'), { skip: true }, 'a scoreboard tab can\'t hold a card');

  // Pull down keeps going past an empty tier, and gives up at the top.
  await studio.post('/api/sponsors/settings', { sponsorEmpty: { supporter: 'up', naming: 'down' } });
  r = await pick('supporter');
  assert.equal(r.tier, 'partner');
  await studio.del(`/api/sponsors?id=surf-club`);
  r = await pick('supporter');
  assert.equal(r.tier, 'major', 'past the empty Partner tier');
  r = await pick('naming');
  assert.equal(r.tier, 'major', 'Naming rights set to pull up');
  await studio.del(`/api/sponsors?id=wave-physio`);
  assert.deepEqual(await pick('supporter'), { skip: true }, 'nothing above: skipped');
  const bad = await studio.request('GET', '/api/sponsors/pick?tier=diamond');
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /no sponsor tier "diamond"/);
});

test('a sponsor outside its deal dates is skipped', async () => {
  await reset();
  await studio.post('/api/sponsors/settings', { sponsorEmpty: { major: 'skip' } });
  await add({ name: 'Old Deal', end: '2020-01-31' }, 'major');
  await add({ name: 'Next Year', start: '2099-01-01' }, 'major');
  const view = await studio.get('/api/sponsors');
  assert.equal(view.sponsors.find(s => s.name === 'Old Deal').state, 'ended');
  assert.equal(view.sponsors.find(s => s.name === 'Next Year').state, 'starts');
  assert.deepEqual(await pick('major'), { skip: true });
  await add({ name: 'Now', start: '2020-01-01', end: '2099-12-31' }, 'major');
  assert.deepEqual((await pick('major')).sponsors.map(s => s.name), ['Now']);
});

test('a sponsor shown on two competitions is kept once, at its own tier in each', async () => {
  await reset();
  await studio.post('/api/setup-new', { name: 'WANL' });
  const view = await studio.post('/api/sponsors', { name: 'Bayside Auto', competitions: { [comp]: { tier: 'elite' }, wanl: { tier: 'partner' }, 'no such comp': { tier: 'major' } } });
  const s = view.sponsors.find(x => x.name === 'Bayside Auto');
  assert.deepEqual(s.competitions, { [comp]: { tier: 'elite' }, wanl: { tier: 'partner' } });
  const other = await studio.get('/api/sponsors?competition=wanl');
  assert.equal(other.competition.name, 'WANL');
  assert.equal(other.sponsors.find(x => x.name === 'Bayside Auto').competitions.wanl.tier, 'partner');
  assert.deepEqual(other.competitions.map(c => c.id)[0], 'wanl', 'the competition itself first');
  // Deleting a competition leaves the sponsor on the others.
  await studio.del('/api/setup/wanl');
  const after = (await studio.get('/api/sponsors')).sponsors.find(x => x.name === 'Bayside Auto');
  assert.deepEqual(after.competitions, { [comp]: { tier: 'elite' } });
});

test('logos: a colour and a white one, replaced and removed, and served for the graphics', async () => {
  await reset();
  await add({ name: 'Corner Cafe' }, 'partner');
  let view = await studio.request('POST', '/api/sponsors/logo?id=corner-cafe&which=logo&name=cafe.png', PNG);
  assert.equal(view.status, 200);
  let s = view.json.sponsors.find(x => x.id === 'corner-cafe');
  assert.equal(s.logo, 'cafe.png');
  assert.equal(s.logoUrl, '/sponsors/corner-cafe/cafe.png');
  const img = await studio.request('GET', s.logoUrl);
  assert.equal(img.type, 'image/png');
  view = await studio.request('POST', '/api/sponsors/logo?id=corner-cafe&which=logoWhite&name=cafe-white.png', PNG);
  s = view.json.sponsors.find(x => x.id === 'corner-cafe');
  assert.equal(s.logoWhiteUrl, '/sponsors/corner-cafe/cafe-white.png');
  // A new colour logo replaces the old file.
  await studio.request('POST', '/api/sponsors/logo?id=corner-cafe&which=logo&name=cafe2.png', PNG);
  assert.equal((await studio.request('GET', '/sponsors/corner-cafe/cafe.png')).status, 404);
  const bad = await studio.request('POST', '/api/sponsors/logo?id=corner-cafe&which=logo&name=cafe.exe', PNG);
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /PNG, JPG, WebP, SVG or GIF/);
  assert.equal((await studio.request('GET', '/sponsors/corner-cafe/..%2F..%2Fsponsors.json')).status, 404);
  view = await studio.request('DELETE', '/api/sponsors/logo?id=corner-cafe&which=logoWhite');
  assert.equal(view.json.sponsors.find(x => x.id === 'corner-cafe').logoWhite, '');
  await studio.del('/api/sponsors?id=corner-cafe');
  assert.equal((await studio.request('GET', '/sponsors/corner-cafe/cafe2.png')).status, 404, 'deleting a sponsor deletes its logos');
});

test('QR codes: the sponsor\'s tracked website or the vacancy card\'s link, as SVG', async () => {
  await reset();
  await add({ name: 'Wave Physio', website: 'https://wavephysio.com.au/book' }, 'major');
  const r = await studio.request('GET', '/api/sponsors/qr.svg?id=wave-physio&place=quarter time');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'image/svg+xml');
  // The same modules as the QR library makes for the tracked link, with a four-module border.
  const link = 'https://wavephysio.com.au/book?utm_source=livestream&utm_medium=qr&utm_campaign=thunder-league&utm_content=quarter-time';
  const qr = qrcode(0, 'M'); qr.addData(link, 'Byte'); qr.make();
  const n = qr.getModuleCount();
  assert.match(r.text, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`));
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) dark++;
  const drawn = [...r.text.matchAll(/h(\d+)v1/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert.equal(drawn, dark);
  // Tracking off, or a link with its own tags: left as it is.
  await studio.post('/api/sponsors', { ...(await studio.get('/api/sponsors')).sponsors[0], tracking: false });
  assert.equal((await studio.get('/api/sponsors')).sponsors[0].qrLink, 'https://wavephysio.com.au/book');
  await studio.post('/api/sponsors', { ...(await studio.get('/api/sponsors')).sponsors[0], tracking: true, website: 'https://wave.com/?utm_source=poster' });
  assert.equal((await studio.get('/api/sponsors')).sponsors[0].qrLink, 'https://wave.com/?utm_source=poster');
  assert.equal((await studio.request('GET', '/api/sponsors/qr.svg?id=nobody')).status, 404);
  await studio.post('/api/sponsors/settings', { sponsorVacancy: { link: 'thunderleague.com.au/sponsor' } });
  const v = await studio.request('GET', '/api/sponsors/qr.svg?vacancy=1');
  assert.equal(v.status, 200);
  await studio.post('/api/sponsors/settings', { sponsorVacancy: {} });
  assert.equal((await studio.request('GET', '/api/sponsors/qr.svg?vacancy=1')).status, 404, 'no link, no QR code');
});

test('the sponsor card rotates fairly by tier share, never the same twice running, competitors kept apart', async () => {
  await reset();
  await studio.post('/api/sponsors/settings', { sponsorEmpty: { naming: 'skip', elite: 'skip' }, sponsorVacancy: {} });
  await add({ name: 'Big Bank', category: 'Bank' }, 'naming');            // share 5
  await add({ name: 'Wave Physio', category: 'Physio' }, 'major');        // share 2
  await add({ name: 'Back Physio', category: 'Physio' }, 'major');        // share 2
  const seen = [];
  for (let i = 0; i < 18; i++) {
    const r = await studio.get('/api/sponsors/next?place=card');
    seen.push(r.sponsor.name);
  }
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], `the same sponsor twice running at ${i}: ${seen.join(', ')}`);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(!(seen[i].includes('Physio') && seen[i - 1].includes('Physio')), `two physios back to back at ${i}: ${seen.join(', ')}`);
  }
  const n = name => seen.filter(x => x === name).length;
  assert.ok(n('Big Bank') >= 8, `naming rights gets the biggest share: ${seen.join(', ')}`);
  assert.ok(n('Wave Physio') >= 4 && n('Back Physio') >= 4, `both majors get turns: ${seen.join(', ')}`);
  // One sponsor by name, without counting a turn; a tier list; the vacancy card in the rotation.
  const one = await studio.get('/api/sponsors/next?sponsor=wave%20physio');
  assert.equal(one.sponsor.id, 'wave-physio');
  assert.equal(one.sponsor.tierName, 'Major');
  assert.deepEqual(await studio.get('/api/sponsors/next?sponsor=nobody'), { none: true });
  assert.equal((await studio.get('/api/sponsors/next?tiers=naming')).sponsor.name, 'Big Bank');
  await studio.post('/api/sponsors/settings', { sponsorEmpty: { elite: 'vacancy' }, sponsorVacancy: { link: 'thunder.com.au/sponsor', contact: 'Matt' } });
  const names = [];
  for (let i = 0; i < 12; i++) { const r = await studio.get('/api/sponsors/next'); names.push(r.vacancy ? 'vacancy' : r.sponsor.name); }
  assert.ok(names.includes('vacancy'), `the vacancy card takes the empty Elite tier's turns: ${names.join(', ')}`);
});

test('the sponsor wall: every tier with a sponsor, top first, and the vacancy card in an empty tier', async () => {
  await reset();
  await studio.post('/api/sponsors/settings', { sponsorTierNames: 'metals', sponsorEmpty: {}, sponsorVacancy: { link: 'thunder.com.au/sponsor' } });
  await add({ name: 'Surf Club' }, 'partner');
  await add({ name: 'Golds Bakery', website: 'golds.com.au' }, 'major');
  await add({ name: 'Old Deal', end: '2020-01-01' }, 'major');
  const w = await studio.get('/api/sponsors/wall');
  assert.equal(w.competition, 'Thunder League');
  assert.deepEqual(w.tiers.map(t => [t.name, t.sponsors.map(s => s.name), !!t.vacancy]),
    [['Naming rights', [], true], ['Gold', ['Golds Bakery'], false], ['Silver', ['Surf Club'], false]],
    'Platinum pulls up from Gold (not shown), Bronze skips, Naming rights advertises, ended deals are left out');
  assert.equal(w.tiers[1].sponsors[0].website, 'golds.com.au');
  const some = await studio.get('/api/sponsors/wall?tiers=partner,supporter');
  assert.deepEqual(some.tiers.map(t => t.key), ['partner']);
  await studio.post('/api/sponsors/settings', { sponsorTierNames: 'names', sponsorVacancy: {} });
});

test('a competition template carries its sponsors and logos; importing merges them by name', async () => {
  await reset();
  await add({ name: 'Golds Bakery', website: 'golds.com.au', tagline: 'Fresh bread' }, 'naming');
  await studio.request('POST', '/api/sponsors/logo?id=golds-bakery&which=logo&name=golds.png', PNG);
  await studio.post('/api/sponsors', { name: 'Elsewhere Only', competitions: { 'some-other-comp': { tier: 'major' } } });
  const tpl = await studio.get(`/api/setup/${comp}/template`);
  assert.deepEqual(tpl.sponsors.map(s => [s.name, s.tier, Object.keys(s.logos)]), [['Golds Bakery', 'naming', ['golds.png']]], 'only this competition\'s sponsors go');
  assert.equal(tpl.sponsors[0].id, undefined, 'ids are this Studio\'s own');

  // A sponsor already here by the same name is shared with the new competition, not doubled.
  tpl.sponsors.push({ name: 'Surf Club', tier: 'partner', website: 'surf.com.au', logo: 'surf.png', logos: { 'surf.png': PNG.toString('base64') } });
  const imported = await studio.post('/api/setup-template?name=Thunder%20Copy', JSON.stringify(tpl));
  const view = await studio.get('/api/sponsors');
  const golds = view.sponsors.filter(s => s.name === 'Golds Bakery');
  assert.equal(golds.length, 1);
  assert.deepEqual(golds[0].competitions, { [comp]: { tier: 'naming' }, [imported.id]: { tier: 'naming' } });
  const surf = view.sponsors.find(s => s.name === 'Surf Club');
  assert.deepEqual(surf.competitions, { [imported.id]: { tier: 'partner' } });
  assert.equal(surf.logo, 'surf.png');
  assert.equal(surf.website, 'https://surf.com.au');
  await studio.del(`/api/setup/${imported.id}`);
});
