// The FirstPass figures graphics may show (firstpassfigures.ts): HQ's events folded with @firstpass/engine, then only
// the club's side, its named shooters and team totals. The team totals rule: an athlete is named only when HQ's
// line-up says they may be (may_publish), matched by name; everyone else counts in team totals only. Then the
// three graphics (Shooting stats, Game stats, Commentator stats) with those figures, and Studio's route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Json } from './support/studio.mts';
import type { TestContext } from 'node:test';

const require = createRequire(import.meta.url);
const figures: typeof import('../out/firstpassfigures.js') = require('../out/firstpassfigures.js');
const engine: typeof import('@firstpass/engine') = require('@firstpass/engine');
const { startStudio } = require('./support/studio.mts') as typeof import('./support/studio.mts');
const { openBrowser } = require('./support/browser.mts') as typeof import('./support/browser.mts');

const GAME = '0b6c8f8e-3f7a-4d1e-9a51-2a7c1d9e4b10';
const BOARD = { home: 'Thunder 17U', away: 'Warriors' };
let seq = 0;
const ev = (type: string, payload: Json) => ({ id: `e${++seq}`, gameId: GAME, stream: 'primary', seq, type, payload, recordedAt: '2026-11-14T09:00:00Z' });
const shot = (player: string, action: 'Goal' | 'Miss', clockMs: number) => ev('action', { period: 1, clockMs, team: 'us', player, action });

// Q1 so far: Ava Smith at GS 2 from 3, Junior Jones at GA 1 from 2.
function game(lineup = [{ profileId: 'a1', name: 'Ava Smith', selection: 'final', mayPublish: true }, { profileId: 'a2', name: 'Junior Jones', selection: 'final', mayPublish: false }]) {
  seq = 0;
  const events = [
    ev('lineup_change', { period: 1, clockMs: 600000, team: 'us', lineup: { GS: 'Ava Smith', GA: 'Junior Jones' }, bench: [], detail: '' }),
    ev('period_start', { period: 1, clockMs: 600000, attackEnd: 'left', centrePass: 'us', mode: 'core' }),
    shot('GS', 'Goal', 590000), shot('GA', 'Miss', 580000), shot('GS', 'Miss', 570000), shot('GA', 'Goal', 560000), shot('GS', 'Goal', 550000),
  ];
  return {
    game: { id: GAME, playhqGameId: '123456', status: 'live', teamName: 'Thunder 17U', config: { us: 'Thunder', them: 'Warriors', quarterMs: 600000, q1AttackEnd: 'left', firstCentrePass: 'us' }, finishedAt: null },
    snapshot: null as Json, events, lineup,
  };
}

test('only athletes HQ allows are named with their own figures; everyone counts in the team totals', () => {
  const f = figures.onAir(game(), BOARD)!;
  assert.equal(f.side, 'home');
  assert.equal(f.team, 'Thunder 17U');
  assert.deepEqual(f.shooting.players, [{ name: 'Ava Smith', positions: ['GS'], goals: 2, shots: 3 }]);
  assert.deepEqual(f.shooting.team, { goals: 3, shots: 5 });
  assert.deepEqual(f.score, { us: 3, them: 0 });
  assert.deepEqual([f.named, f.teamTotalsOnly], [1, 1]);
  // Nothing in the answer names Junior Jones or carries an event, a profile id or the line-up.
  assert.doesNotMatch(JSON.stringify(f), /Junior|a2|a1|lineup|e\d/);
  // The same figures as the engine works out from the same events.
  const state = engine.deriveGame(game().game.config as Json, game().events as Json);
  assert.deepEqual(f.centrePass, state.centrePass);
});

test('a name HQ\'s line-up doesn\'t have, or has twice, is never shown', () => {
  const nobody = figures.onAir(game([{ profileId: 'a9', name: 'Someone Else', selection: 'final', mayPublish: true }]), BOARD)!;
  assert.deepEqual(nobody.shooting.players, []);
  assert.deepEqual(nobody.shooting.team, { goals: 3, shots: 5 });
  const twice = figures.onAir(game([
    { profileId: 'a1', name: 'Ava Smith', selection: 'final', mayPublish: true }, { profileId: 'a3', name: 'ava  smith', selection: 'partner', mayPublish: true },
  ]), BOARD)!;
  assert.deepEqual(twice.shooting.players, []);
  // Case and spacing don't matter for one clear match; HQ's spelling is the one shown.
  const cased = figures.onAir(game([{ profileId: 'a1', name: ' AVA smith ', selection: 'final', mayPublish: true }]), BOARD)!;
  assert.deepEqual(cased.shooting.players.map(p => p.name), [' AVA smith ']);
});

test('the club\'s side is the scoreboard team whose name matches HQ\'s; no clear match keeps PlayHQ\'s figures', () => {
  assert.equal(figures.sideOf(['Thunder 17U', 'Thunder'], { home: 'Warriors', away: 'West Coast Thunder 17U' }), 'away');
  assert.equal(figures.sideOf(['Thunder'], { home: 'Thunder Gold', away: 'Thunder Purple' }), null);
  assert.equal(figures.sideOf(['Thunder'], { home: 'Warriors', away: 'Comets' }), null);
  assert.equal(figures.onAir(game(), { home: 'Warriors', away: 'Comets' }), null);
  assert.equal(figures.onAir(null, BOARD), null);
});

test('a break snapshot from the same engine line is the starting point; one from another line waits', () => {
  const g = game();
  const through = g.events.slice(0, 5);
  const state = engine.deriveGame(g.game.config as Json, through as Json);
  g.snapshot = { throughSeq: 5, engineVersion: engine.ENGINE_VERSION, state, createdAt: '' };
  g.events = g.events.slice(5);
  const f = figures.onAir(g, BOARD)!;
  assert.deepEqual(f.shooting.team, { goals: 3, shots: 5 });
  assert.deepEqual(f.shooting.players, [{ name: 'Ava Smith', positions: ['GS'], goals: 2, shots: 3 }]);
  assert.equal(figures.sameLine('0.1.0', '0.1.7'), true);
  assert.equal(figures.sameLine('0.1.0', '0.2.0'), false);
  assert.equal(figures.sameLine('1.2.0', '1.9.0'), true);
  g.snapshot.engineVersion = '9.0.0';
  assert.equal(figures.onAir(g, BOARD), null);
  g.snapshot = { throughSeq: 5, engineVersion: engine.ENGINE_VERSION, state: { nonsense: true }, createdAt: '' };
  assert.equal(figures.onAir(g, BOARD), null);
});

// What the graphics get from Studio, answered by the test: the scoreboard's game, PlayHQ's sheets and FirstPass's figures.
const ONAIR = {
  side: 'home', team: 'Thunder 17U', period: 1, score: { us: 3, them: 2 },
  shooting: { players: [{ name: 'Ava Smith', positions: ['GS'], goals: 2, shots: 3 }], team: { goals: 3, shots: 5 } },
  centrePass: { us: { received: 4, goals: 2 }, them: { received: 3, goals: 1 } }, gains: 2, turnovers: 1, named: 1, teamTotalsOnly: 6,
};
const SHEETS = {
  home: { name: 'Thunder 17U', players: [{ name: 'Junior Jones', number: 7, position: 'GA', shooting: { goals: 9, superGoals: 1, shots: 12, points: 11 } }], totals: { goals: 9, superGoals: 1, shots: 12 } },
  away: { name: 'Warriors', players: [{ name: 'Wren Ward', number: 1, position: 'GS', shooting: { goals: 2, superGoals: 0, shots: 4, points: 2 } }], totals: { goals: 2, superGoals: 0, shots: 4 } },
  period: 1, score: { home: 3, away: 2 }, rules: { superShots: true },
};
async function graphic(t: TestContext, path: string, onair: Json) {
  const studio = await startStudio(t);
  const browser = await openBrowser(t);
  if (!browser) return null;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), r => r.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await context.route(`${studio.base}/api/teams`, r => r.fulfill({ json: SHEETS }));
  await context.route(`${studio.base}/api/firstpass/onair`, r => (onair === 403 ? r.fulfill({ status: 403, json: { error: 'no' } }) : r.fulfill({ json: onair })));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(studio.base + path, { waitUntil: 'load' });
  t.after(() => assert.deepEqual(errors, []));
  return { page, studio };
}

test('Shooting stats: the club\'s team from FirstPass (named shooters only, everyone in the Team row), the other from PlayHQ', async t => {
  const g = await graphic(t, '/shooting.html', ONAIR);
  if (!g) return;
  await g.page.waitForSelector('#card:not([hidden]) #home tfoot');
  const rows = (sel: string) => g.page.$$eval(sel, trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent)));
  assert.deepEqual(await rows('#home tbody tr'), [['GSAva Smith', '2', '–', '3', '67%']]);
  assert.deepEqual(await rows('#home tfoot tr'), [['Team', '3', '–', '5', '60%']]);
  assert.doesNotMatch(await g.page.textContent('#home') || '', /Junior/);
  assert.deepEqual(await rows('#away tbody tr'), [['GSWren Ward', '2', '0', '4', '50%']]);
});

test('Shooting stats elsewhere than this Mac, or with no FirstPass game: PlayHQ\'s figures as before', async t => {
  const g = await graphic(t, '/shooting.html', 403);
  if (!g) return;
  await g.page.waitForSelector('#card:not([hidden]) #home tfoot');
  assert.match(await g.page.textContent('#home tbody') || '', /Junior Jones/);
});

test('Game stats adds centre pass to goal for both teams from FirstPass', async t => {
  const g = await graphic(t, '/gamestats.html', ONAIR);
  if (!g) return;
  await g.studio.post('/api/scoreboard', { type: 'setTeams', home: 'Thunder 17U', away: 'Warriors' });
  await g.page.reload({ waitUntil: 'load' });
  await g.page.waitForSelector('#card:not([hidden])');
  const row = await g.page.$$eval('.gamestats__row', rs => rs.map(r => r.textContent || '').find(x => x.includes('Centre pass to goal')));
  assert.ok(row, 'a Centre pass to goal row');
  assert.match(row!, /50%2 of 4.*33%1 of 3/);
});

test('Studio answers the graphics\' FirstPass figures with nothing when no club is signed in', async t => {
  const studio = await startStudio(t, { env: { STUDIO_KEYCHAIN: '0' } });
  assert.deepEqual(await studio.get('/api/firstpass/onair'), {});
});

test('Commentator stats: the club\'s shooting and centre passes from FirstPass, and its named shooters only', async t => {
  const g = await graphic(t, '/commentatorstats.html?refresh=0', ONAIR);
  if (!g) return;
  await g.studio.post('/api/scoreboard', { type: 'setTeams', home: 'Thunder 17U', away: 'Warriors' });
  await g.page.reload({ waitUntil: 'load' });
  await g.page.waitForSelector('.gs__fp');
  assert.equal(await g.page.textContent('.gs__fp'), 'Thunder 17U shooters: Ava Smith 2/3');
  const rows = await g.page.$$eval('.gs__row', rs => rs.map(r => r.textContent || ''));
  assert.ok(rows.some(r => /60%3\/5.*Shooting/.test(r)), rows.join(' | '));
  assert.ok(rows.some(r => /Centre pass to goal/.test(r) && /50%2\/4/.test(r) && /33%1\/3/.test(r)), rows.join(' | '));
});
