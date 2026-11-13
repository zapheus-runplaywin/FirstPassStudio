// Sponsored moments (sponsors.ts moment, /api/sponsors/moment, sponsorSpot.moment): the super shot, hot streak and
// game moment animations say who they're "brought to you by": the moment's owner, or the Elite sponsors taking turns.
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStudio, type Json } from './support/studio.mts';

const require = createRequire(import.meta.url);

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-moments-'));
const competitions: typeof import('../out/competitions.js') = require('../out/competitions.js');
const sponsors: typeof import('../out/sponsors.js') = require('../out/sponsors.js');
competitions.init(() => {});
const comp = competitions.create('Thunder League');
const add = (name: string, tier: Json, extra = {}) => sponsors.save({ name, ...extra, competitions: { [comp]: { tier } } });
const names = (key: string, n: Json) => Array.from({ length: n }, () => (sponsors.moment(comp, key) || {}).name || null);

test('the Elite sponsors take turns; an owner has the moment to itself; off tags no one', () => {
  const wave = add('Wave Physio', 'elite');
  add('Surf Club', 'elite');
  add('Golds Bakery', 'naming');
  assert.deepEqual(new Set(names('superShot', 4)), new Set(['Wave Physio', 'Surf Club']));
  competitions.save(comp, { sponsorMoments: { superShot: wave.id, fire: 'off', lead: 'Not an id!' } });
  assert.deepEqual(competitions.get(comp).sponsorMoments, { superShot: wave.id, fire: 'off' }, 'only sponsor ids and off are kept');
  assert.deepEqual(names('superShot', 3), ['Wave Physio', 'Wave Physio', 'Wave Physio']);
  assert.deepEqual(names('fire', 2), [null, null]);
  assert.throws(() => sponsors.moment(comp, 'quarterTime'), /no sponsored moment/);
});

test('an owner whose deal has ended, or who left the competition, hands back to the turns; an empty Elite follows its rule', () => {
  const wave = sponsors.all().find(s => s.name === 'Wave Physio');
  sponsors.save({ ...wave, end: '2020-01-01' });
  assert.deepEqual(new Set(names('superShot', 2)), new Set(['Surf Club']));
  for (const s of sponsors.all()) if (s.competitions[comp].tier === 'elite') sponsors.remove(s.id);
  add('Corner Store', 'major');
  assert.deepEqual(names('heating', 2), ['Corner Store', 'Corner Store'], 'Elite is empty: pulled up from Major (its default rule)');
  competitions.save(comp, { sponsorEmpty: { elite: 'vacancy' } });
  assert.deepEqual(names('heating', 1), [null], 'a vacancy card does not fit a moment');
});

test('/api/sponsors/moment answers each play, saves owners from the Sponsors page, and counts the tag on screen', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const id = (await studio.get('/api/sponsors')).competition.id;
  const golds = await studio.post('/api/sponsors', { name: 'Golds Bakery', competitions: { [id]: { tier: 'elite' } } });
  const gid = golds.sponsors.find((s: Json) => s.name === 'Golds Bakery').id;
  assert.equal((await studio.get('/api/sponsors/moment?moment=superShot')).sponsor.name, 'Golds Bakery');
  const bad = await fetch(`${studio.base}/api/sponsors/moment?moment=nope`);
  assert.equal(bad.status, 400);

  const v = await studio.post('/api/sponsors/settings', { sponsorMoments: { lead: 'off' } });
  assert.deepEqual(v.moments.find((m: Json) => m.key === 'lead'), { key: 'lead', name: 'Hits the front', owner: 'off' });
  assert.ok((await studio.get('/api/sponsors/moment?moment=lead')).none);
  assert.equal((await studio.get('/api/sponsors/moment?moment=lead&sponsor=Golds%20Bakery')).sponsor.id, gid, '?sponsor= on the page wins');

  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Super shot', url: 'supershot.html' }] });
  const src = (await studio.get('/api/scene')).sources.find((s: Json) => s.name === 'Super shot');
  await studio.post('/api/scene', { type: 'show', id: src.id });
  await fetch(`${studio.base}/api/sponsors/moment?moment=superShot&seconds=2`, { headers: { referer: `${studio.base}/supershot.html` } });
  const r = await studio.get(`/api/sponsors/report?offair=1&competition=${id}`);
  assert.equal(r.sponsors.find((s: Json) => s.id === gid).places.moment, 2);
});

test('the super shot shows "brought to you by" in a real browser, and ?sponsor=0 leaves it off', async t => {
  let chromium = null, browser = null;
  try { ({ chromium } = require('playwright')); browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the pages in');
    t.skip('no browser to test the pages in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const id = (await studio.get('/api/sponsors')).competition.id;
  await studio.post('/api/sponsors', { name: 'Wave Physio', competitions: { [id]: { tier: 'elite' } } });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route((url: string) => !String(url).startsWith(studio.base), (route: Json) => route.fulfill({ status: 200, body: '' }));
  const errors: string[] = [];
  page.on('pageerror', (err: Json) => errors.push(err.message));
  const tag = async (link: string) => {
    await page.goto(`${studio.base}/${link}`);
    await page.waitForTimeout(1600);
    return page.evaluate(() => { const t = document.querySelector<HTMLElement>('.sponsor-moment'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
  };
  assert.equal(await tag('supershot.html?team=none'), 'BROUGHT TO YOU BY WAVE PHYSIO');
  assert.equal(await tag('streak.html?play=fire&team=home'), 'BROUGHT TO YOU BY WAVE PHYSIO');
  assert.equal(await tag('supershot.html?team=none&sponsor=0'), '');
  assert.deepEqual(errors, []);
});
