// Filling one Mac's gaps in a game's story from another Mac's story of the same game (board.ts mergeStories, used by
// stories.ts when it keeps or copies a story): where one Studio missed goals (its internet dropped, or it picked the
// game up part way), the other may have seen them one by one, so the gap is filled with them and the stats, worm and
// moments worked out again. No extra reading of PlayHQ: only the stories the Macs already share.
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as savefile from '../out/savefile.js';
import { create } from '../out/stories.js';
import type { Send } from '../out/types.js';

const require = createRequire(import.meta.url);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-gaps-'));
// The board alone, for its mergeStories.
function theBoard() {
  const dir = tmp();
  const control = { boards: {} };
  const board: typeof import('../out/board.js') = require('../out/board.js');
  // Only what mergeStories reaches is stood in for.
  const deps = {
    log: () => {}, datadir: { local: (f: string) => path.join(dir, f) },
    savefile: { readJson: <T,>(f: string, d: T) => d, writeFile: () => {} }, machine: {}, config: () => ({}),
    competitions: { superShotsFor: () => true }, scene: { publishBoard() {} },
    playhq: { getRoundGames: async () => [], liveScore: async () => null, scoringNotYet: () => '', PERIOD_NUMBER: {}, liveSeenFor: () => null },
    control: { LASTING: [], get: () => control, save() {}, exists: () => true, markUnsaved() {} },
    logoFor: () => '', colourFor: () => '', rules: () => ({ periodLabel: 'Q', periods: 4, superShots: true, periodMinutes: 10, periodType: 'quarters' }),
    competitionName: () => '', warmTeamLists() {},
  };
  const b = board.create(deps as unknown as Parameters<typeof board.create>[0]);
  fs.rmSync(dir, { recursive: true, force: true });
  return b;
}
const { mergeStories } = theBoard();

// A goal order from a list like 'H A H H | 5-3 | H' (quarters split by /): H or A a goal, h or a a super shot,
// | 5-3 | a gap to that score. Each quarter's goals are spread over its 10 minutes.
type Score = { home: number; away: number };
type Goal = { id: number; period: number; clockLeft: number; periodSec: number }
  & ({ gap: true; set: Score } | { gap?: undefined; side: 'home' | 'away'; points: number; how: string });
function goalsOf(text: string) {
  const goals: Goal[] = [];
  text.split('/').forEach((q, i) => {
    const items = q.trim().split(/\s+/).filter(Boolean);
    items.forEach((x, k) => {
      const at = { period: i + 1, clockLeft: Math.round(600 - (600 * (k + 1)) / (items.length + 1)), periodSec: 600 };
      const gap = /^(\d+)-(\d+)$/.exec(x);
      if (gap) goals.push({ id: goals.length + 1, gap: true, set: { home: +gap[1], away: +gap[2] }, ...at });
      else if (x !== '|') goals.push({ id: goals.length + 1, side: /h/i.test(x) ? 'home' : 'away', points: x === 'h' || x === 'a' ? 2 : 1, how: 'playhq', ...at });
    });
  });
  return goals;
}
function story(text: string, extra = {}) {
  const goals = goalsOf(text);
  const score = { home: 0, away: 0 };
  for (const g of goals) if (g.gap) Object.assign(score, g.set); else score[g.side] += g.points;
  const period = Math.max(...goals.map(g => g.period));
  const tally = (p: number) => goals.reduce((t, g) => (g.gap || g.period !== p ? t : { ...t, [g.side]: t[g.side] + g.points }), { home: 0, away: 0 });
  const periods = Object.fromEntries([...Array(period)].map((_, i) => [i + 1, { ...tally(i + 1), sure: !goals.some(g => g.gap && g.period === i + 1) }]));
  const s = { gameId: 'g1', date: '2026-11-09', division: 'Division 1', round: 'Round 3', ended: true, savedAt: Date.now(), stats: {}, worm: {}, moments: [],
    goalOrder: { home: { name: 'Blizzardz', score: score.home }, away: { name: 'Mavericks', score: score.away }, court: 'Court 2', period,
      clock: { lengthSec: 600, elapsedMs: 600000 }, goals, counts: null, periodTrack: { gameId: 'g1', period, base: score, periods } }, ...extra };
  s.worm = { gaps: goals.filter(g => g.gap).map((g, i) => ({ from: i, to: i + 0.5 })) };
  return s;
}

test('a gap is filled with the goals the other story saw there, and the stats, worm and moments worked out again', () => {
  // This Mac lost PlayHQ for a while in the second quarter: 3-2, then a gap to 7-3. The other Mac saw it all.
  const mine = story('H A H / A H | 7-3 / A / H A');
  const theirs = story('H A H / A H H H H A H / A / H A', { followed: true });
  const m = mergeStories(mine, theirs);
  assert.ok(m);
  assert.equal(m.filledGaps, 1);
  assert.equal(m.goalOrder.goals.filter(g => g.gap).length, 0);
  assert.deepEqual(m.goalOrder.goals.map(g => g.id), m.goalOrder.goals.map((_, i) => i + 1), 'numbered again');
  assert.equal(m.stats.gapInHistory, false);
  assert.equal(m.stats.totalGoals, 13);
  assert.deepEqual(m.worm.gaps, []);
  assert.equal(m.worm.segments.flat().at(-1)!.margin, 8 - 5);
  assert.equal(m.stats.stats.longestRun.home, 4, 'a run the gap hid');
  assert.deepEqual(m.stats.quarters.slice(0, 2).map(q => [q.home, q.away, q.sure]), [[2, 1, true], [5, 2, true]], 'the second quarter is known now');
  assert.ok(m.moments!.some(x => x.kind === 'heating' && x.side === 'home'), 'its moments played through again');
});

test('a gap the other story can\'t account for is left as it was', () => {
  assert.equal(mergeStories(story('H | 5-3 | A'), story('H A | 4-3 | H A')), null, 'the other has a gap there too');
  assert.equal(mergeStories(story('H | 5-3 | A'), story('H A H A H A H')), null, 'the other never passes through 5-3');
  assert.equal(mergeStories(story('H A H'), story('H A H')), null, 'no gap to fill');
  assert.equal(mergeStories(story('H | 3-1 | A'), story('H A H H', { gameId: 'g2' })), null, 'another game');
});

test('a game picked up part way through is filled from its start', () => {
  const m = mergeStories(story('| 3-2 / H A'), story('H A H A H / H A'))!;
  assert.equal(m.filledGaps, 1);
  assert.equal(m.stats.gapInHistory, false);
  assert.deepEqual(m.stats.quarters[0].home, 3);
});

// Two Studio Macs, as stories.test.mts does, with the board's merge.
const send: Send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
function store(studio: string, more = {}) {
  const s = create({ dir: tmp(), savefile, studio, studioId: studio, bonjour: false, ...more });
  s.useMerge(mergeStories);
  return s;
}
async function serve(s: ReturnType<typeof store>) {
  const server = http.createServer((req, res) => { if (!s.route(req, res, new URL(req.url || '/', 'http://x'), { send })) send(res, 404, {}); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test('a Mac with a gap asks the other Mac for its story of the game, even one with a gap of its own, and fills it', async () => {
  const court2 = store('Court-2');
  court2.keep(story('H A H / A H H H H A / H | 9-6 | A', { followed: true }), { final: true }); // a gap of its own, later on
  const { base, close } = await serve(court2);
  try {
    const court1 = store('Court-1', { peers: [base] });
    court1.keep(story('H A H / A H | 7-3 | A / H A A'), { final: true }); // streamed here, with a gap in Q2
    assert.equal(await court1.sync(), 1);
    const s = court1.read('g1')!;
    assert.equal(s.stats!.gapInHistory, false);
    assert.deepEqual(s.filled, ['Court-2']);
    assert.equal(s.from, undefined, 'this Mac\'s own story, so it is shared on');
    assert.equal(s.followed, undefined, 'still the streamed story');
    assert.deepEqual(court1.sources(['g1']), [{ studio: 'Court-2', via: 'filled', games: 1 }]);
    assert.equal(await court1.sync(), 0, 'not asked again until it is saved again');
    // The board keeping this Mac's story again (unfilled) doesn't undo the filling.
    court1.keep(story('H A H / A H | 7-3 | A / H A A'), { final: true });
    assert.equal(court1.read('g1')!.stats!.gapInHistory, false);
    // And the other Mac takes the filled story: it has fewer gaps than its own.
    const back = await serve(court1);
    try {
      const again = store('Court-2b', { peers: [back.base] });
      again.keep(story('H A H / A H H H H A / H | 9-6 | A', { followed: true }), { final: true });
      assert.equal(await again.sync(), 1);
      assert.equal(again.read('g1')!.stats!.gapInHistory, false);
    } finally { back.close(); }
  } finally { close(); }
});
