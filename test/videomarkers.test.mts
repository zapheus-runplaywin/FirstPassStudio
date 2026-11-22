// Video markers (videomarkers.ts): a recorded game as a file that marks its moments in a video editor. What went to
// air (quarters, goals, the producer's marks) for anyone who may read recordings; the game's FirstPass stats only
// under /api/firstpass/, naming only the athletes HQ says may be named. The video is lined up by its first timecode
// (with the 4K replay's sync for that recording) or by how far into it the first quarter starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { startStudio, type Json } from './support/studio.mts';
import { localZone } from './support/playhq.mts';
import { openPage } from './support/browser.mts';

const require = createRequire(import.meta.url);
const markers: typeof import('../out/videomarkers.js') = require('../out/videomarkers.js');
const access: typeof import('../out/access.js') = require('../out/access.js');

// Studio runs in the stand-in PlayHQ's time zone: the test reads timecode as a time of day in the same one.
process.env.TZ = localZone().tz;

// Two days ago at 19:00:00 where Studio runs.
const day = new Date(Date.now() - 2 * 86400000);
const T0 = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 19, 0, 0).getTime();
const GAME = '0b6c8f8e-3f7a-4d1e-9a51-2a7c1d9e4b10';

const board = (t: number, home: number, away: number, period: number, running = true) => ({ t, k: 'board', board: { gameId: 'g1', period, home: { name: 'Red', score: home }, away: { name: 'Blue', score: away },
  clock: { running, startedAt: t, elapsedMs: 0, lengthSec: 600 }, serverNow: t } });
const lines = () => [
  { t: T0, k: 'start' },
  { t: T0 + 1000, k: 'game', id: 'g1', home: 'Red', away: 'Blue' },
  board(T0 + 2000, 0, 0, 1, false),
  board(T0 + 60_000, 0, 0, 1),            // Q1's clock runs at 19:01:00
  board(T0 + 90_000, 1, 0, 1),            // Red score at 19:01:30
  { t: T0 + 100_000, k: 'mark', id: 'm1', flag: { period: 1, clockMs: 560_000 } },
  board(T0 + 120_000, 1, 2, 1),           // Blue catch up two at once
  board(T0 + 130_000, 1, 1, 1),           // a goal taken back: no marker
  board(T0 + 700_000, 1, 1, 2, false),
  board(T0 + 800_000, 1, 1, 2),           // Q2's clock runs
  { t: T0 + 900_000, k: 'end' },
];
const NAME = `${new Date(T0).toISOString().slice(0, 10)} 1900 Red v Blue.jsonl.gz`;
const write = (dataDir: string) => fs.writeFileSync(path.join(dataDir, 'Recordings', NAME), zlib.gzipSync(lines().map(l => JSON.stringify(l)).join('\n') + '\n'));
const at = `/api/recordings/${encodeURIComponent(NAME)}/markers`;

// The game's FirstPass stats as Studio keeps them: Ava may be named, Junior may not.
function stats() {
  let seq = 0;
  const ev = (type: string, payload: Json, ms: number) => ({ id: `e${++seq}`, gameId: GAME, stream: 'primary', seq, type, payload, recordedAt: new Date(T0 + ms).toISOString() });
  const act = (player: string, action: string, ms: number) => ev('action', { period: 1, clockMs: 600_000 - (ms - 60_000), team: 'us', player, action }, ms);
  return {
    game: { id: GAME, playhqGameId: 'g1', status: 'final', teamName: 'Red 17U', config: { us: 'Red', them: 'Blue', quarterMs: 600_000, q1AttackEnd: 'left', firstCentrePass: 'us' }, finishedAt: new Date(T0 + 900_000).toISOString() },
    snapshot: null,
    events: [
      ev('lineup_change', { period: 1, clockMs: 600_000, team: 'us', lineup: { GS: 'Ava Smith', GA: 'Junior Jones' }, bench: [], detail: 'Ava Smith and Junior Jones start' }, 10_000),
      ev('period_start', { period: 1, clockMs: 600_000, attackEnd: 'left', centrePass: 'us', mode: 'core' }, 50_000),
      ev('clock_start', { period: 1, clockMs: 600_000 }, 61_000),
      act('GS', 'Goal', 91_000), act('GA', 'Miss', 110_000),
    ],
    helper: [],
    lineup: [{ profileId: 'a1', name: 'Ava Smith', selection: 'final', mayPublish: true }, { profileId: 'a2', name: 'Junior Jones', selection: 'final', mayPublish: false }],
  };
}

test('what went to air becomes quarter, goal and mark markers', () => {
  const air = markers.onAir(lines() as never);
  assert.deepEqual(air.game, { id: 'g1', home: 'Red', away: 'Blue' });
  assert.equal(air.firstQuarter, T0 + 60_000);
  assert.deepEqual(air.markers.map(m => [m.atMs - T0, m.name]), [
    [60_000, 'Q1 starts'], [90_000, 'Goal Red · 1–0'], [120_000, 'Goal Blue · 1–2'], [800_000, 'Q2 starts'],
  ]);
  assert.deepEqual(air.marks, [{ atMs: T0 + 100_000, period: 1, clockMs: 560_000 }]);
  assert.equal(markers.onAir(lines() as never, 'nope').game, null);
});

test('a timecode is read as a time of day on the night of the game, with the sync added', () => {
  const tc = (h: number, m: number, s: number) => ((h * 60 + m) * 60 + s) * 1000;
  assert.equal(markers.nightAt(T0, tc(19, 0, 30), 0), T0 + 30_000);
  assert.equal(markers.nightAt(T0, tc(19, 0, 30), -2000), T0 + 28_000);
  // A night that runs past midnight: 00:10 is the next day, not the morning before.
  assert.equal(markers.nightAt(T0 + 4.9 * 3600_000, tc(0, 10, 0), 0), T0 + 5 * 3600_000 + 600_000);
});

test('FirstPass stats name only the athletes HQ allows, and leave out a substitution detail', () => {
  const made = markers.fromStats(stats() as never, [{ atMs: T0 + 100_000, period: 1, clockMs: 560_000 }]);
  const text = JSON.stringify(made.markers);
  assert.match(text, /Goal GS Ava Smith/);
  assert.match(text, /Miss GA · Q1/);
  assert.doesNotMatch(text, /Junior/);
  assert.doesNotMatch(text, /start"/);
  assert.match(text, /Marked moment · Q1 9:20/);
  assert.equal(made.firstQuarter, T0 + 61_000);
});

test('the FirstPass markers route is a FirstPass route: refused from the venue network like the rest', () => {
  assert.equal(access.firstpass('/api/firstpass/markers'), true);
  assert.match(String(access.firstpassRefusal('GET', '/api/firstpass/markers', '192.168.1.50', null, false)), /private to the Mac/);
  assert.equal(access.firstpassRefusal('GET', '/api/firstpass/markers', '192.168.1.50', { kind: 'browser', secure: true }, true), null);
  assert.equal(access.privateRead('GET', '/api/recordings/x/markers'), true);
});

test('Studio answers the on-air file lined up by timecode, by the replay sync and by the first quarter', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  write(studio.dataDir);

  const info = await studio.get(`${at}?info=1`);
  assert.deepEqual(info.game, { home: 'Red', away: 'Blue' });
  assert.deepEqual(info.onAir, { quarters: 2, goals: 2, marks: 1, firstQuarter: true });
  assert.equal(info.firstpass, null);
  assert.equal(info.synced, false);

  // The video's first timecode is 18:59:00:00: Q1 (19:01:00) is two minutes in, on a timeline that starts at one hour.
  const edl = await fetch(`${studio.base}${at}?format=edl&start=18:59:00:00&lead=5`);
  assert.equal(edl.status, 200);
  assert.match(String(edl.headers.get('content-disposition')), /attachment; filename="red-v-blue-markers.edl"/);
  assert.equal(edl.headers.get('x-markers'), '5');
  const text = await edl.text();
  assert.match(text, /^TITLE: Red v Blue markers\nFCM: NON-DROP FRAME\n/);
  assert.match(text, /01:02:00:00 01:02:00:01 01:02:00:00 01:02:00:01 {2}\n \|C:ResolveColorCream \|M:Q1 starts \|D:1/);
  assert.match(text, /01:02:25:00 .*\n \|C:ResolveColorGreen \|M:Goal Red · 1–0 \|D:1/, 'a goal sits the lead before the score went up');
  assert.match(text, /01:02:35:00 .*\n \|C:ResolveColorFuchsia \|M:Marked moment · Q1 9:20 \|D:1/);
  assert.doesNotMatch(text, /1–1/, 'a goal taken back is not a goal');

  // How far into the video the first quarter starts gives the same file.
  const into = await studio.request('GET', `${at}?format=edl&into=2:00&lead=5`);
  assert.equal(String(into.text), text);

  // The list and the XML.
  const list = String((await studio.request('GET', `${at}?format=list&into=2:00&lead=0`)).text);
  assert.match(list, /0:02:00 Q1 starts\n0:02:30 Goal Red · 1–0 \(Q1\)\n0:02:40 Marked moment · Q1 9:20\n0:03:00 Goal Blue · 1–2 \(Q1\)/);
  const xml = String((await studio.request('GET', `${at}?format=xml&into=2:00&lead=0&fps=50`)).text);
  assert.match(xml, /<timebase>50<\/timebase>/);
  assert.match(xml, /<marker><name>Goal Red · 1–0<\/name><comment>Q1<\/comment><in>7500<\/in>/);

  // A video that starts after the first goal leaves it out and says so.
  const late = await fetch(`${studio.base}${at}?format=list&start=19:01:45:00&lead=0`);
  assert.equal(late.headers.get('x-markers-outside'), '3');
  assert.match(await late.text(), /^Red v Blue markers\n.*\n\n0:00:15 Goal Blue/);

  // What it refuses, in words.
  for (const [q, why] of [['format=mov&into=1:00', /format=edl/], ['format=edl', /first timecode \(start\) or how far/], ['format=edl&start=7pm', /such as 18:55:10:00/],
    ['format=edl&into=soon', /such as 3:12/], ['format=edl&into=1:00&fps=12', /Frames a second/], ['format=edl&into=1:00&lead=90', /0 to 60 seconds/],
    ['format=edl&start=23:30:00:00', /falls before that video starts/], ['format=edl&into=1:00&game=other', /isn't in this recording/]] as const) {
    const r = await studio.request('GET', `${at}?${q}`);
    assert.equal(r.status === 400 || r.status === 404, true, q);
    assert.match(JSON.parse(String(r.text)).error, why, q);
  }
  assert.equal((await studio.request('GET', '/api/recordings/none.jsonl.gz/markers?info=1')).status, 404);
});

test('the replay sync moves the markers, and FirstPass stats come only from the FirstPass route', async t => {
  const first = await startStudio(t, { competition: 'Thunder League', keepDataDir: true });
  const dataDir = first.dataDir;
  await first.stop();
  write(dataDir);
  fs.writeFileSync(path.join(dataDir, 'replay.json'), JSON.stringify({ follow: 'none', hyperdeck: '', offsets: { [NAME]: -2000 } }));
  fs.mkdirSync(path.join(dataDir, 'firstpass', 'THUNDER'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'firstpass', 'THUNDER', `${GAME}.json`),
    JSON.stringify({ club: 'THUNDER', gameId: GAME, savedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), data: stats() }));
  const studio = await startStudio(t, { competition: 'Thunder League', dataDir, removeDataDir: true });

  const info = await studio.get(`${at}?info=1`);
  assert.equal(info.synced, true);
  assert.equal(info.offset, -2000);
  assert.equal(info.firstpass, null, 'the recordings route never says anything of FirstPass stats');
  // Timecode 18:59:00:00 is 18:58:58 on this Mac, so Q1 (19:01:00) is 2:02 in.
  const list = String((await studio.request('GET', `${at}?format=list&start=18:59:00:00&lead=0`)).text);
  assert.match(list, /0:02:02 Q1 starts/);
  assert.doesNotMatch(list, /Ava|GS/);

  const fp = `/api/firstpass/markers?recording=${encodeURIComponent(NAME)}`;
  const withStats = await studio.get(`${fp}&info=1`);
  assert.deepEqual(withStats.firstpass, { markers: 4, partial: false, firstQuarter: true });
  const full = String((await studio.request('GET', `${fp}&format=list&start=18:59:00:00&lead=0`)).text);
  assert.match(full, /0:02:33 Goal GS Ava Smith · Q1 9:29/);
  assert.match(full, /0:02:52 Miss GA · Q1 9:10/);
  assert.match(full, /0:02:42 Marked moment · Q1 9:20/);
  assert.doesNotMatch(full, /Junior/);
  assert.doesNotMatch(full, /Goal Red · 1–0/, "the statistician's goals stand in for the scoreboard's");
  assert.match(full, /keep it within the team and do not post it publicly/);
  // By the first quarter: the moment the statistician started the clock (19:01:01).
  const byQuarter = String((await studio.request('GET', `${fp}&format=list&into=1:00&lead=0`)).text);
  assert.match(byQuarter, /0:01:30 Goal GS Ava Smith/);
});

test('the Recordings tab makes the file: Markers beside a game, how the video lines up, and a download', async t => {
  const first = await startStudio(t, { competition: 'Thunder League', keepDataDir: true });
  const dataDir = first.dataDir;
  await first.stop();
  write(dataDir);
  fs.mkdirSync(path.join(dataDir, 'firstpass', 'THUNDER'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'firstpass', 'THUNDER', `${GAME}.json`),
    JSON.stringify({ club: 'THUNDER', gameId: GAME, savedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), data: stats() }));
  const studio = await startStudio(t, { competition: 'Thunder League', dataDir, removeDataDir: true });
  const page = await openPage(t, studio, '/recordings.html');
  if (!page) return;
  await page.click('[data-markers]');
  await page.waitForSelector('#markers:not([hidden])');
  // On this Mac the FirstPass stats are used, and the page says the file is for the coaching team.
  assert.match(String(await page.textContent('#markersWhat')), /Red v Blue: 4 events from FirstPass stats and 1 marked moment/);
  assert.match(String(await page.textContent('#markersNote')), /keep it within the team/);
  assert.deepEqual(await page.$$eval('#markersSave button', bs => bs.map(b => b.textContent)), ['For DaVinci Resolve', 'For Premiere Pro', 'Plain list']);

  // Nothing typed: Studio says what it needs, and nothing downloads.
  await page.click('#markersSave [data-format="edl"]');
  await page.waitForSelector('.fp-status.error');
  assert.match(String(await page.textContent('.fp-status')), /first timecode \(start\) or how far/);

  await page.fill('#markersInto', '1:00');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#markersSave [data-format="list"]')]);
  assert.equal(download.suggestedFilename(), 'red-v-blue-markers.txt');
  const saved = fs.readFileSync(await download.path(), 'utf8');
  assert.match(saved, /0:01:25 Goal GS Ava Smith/);
  assert.doesNotMatch(saved, /Junior/);
  await page.waitForFunction(() => /5 markers saved/.test(document.querySelector('.fp-status')?.textContent || ''));
  if (process.env.MARKERS_SHOT) { await page.locator('#markers').scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.MARKERS_SHOT }); }
  await page.click('#markersClose');
  assert.equal(await page.isHidden('#markers'), true);
  assert.deepEqual(page.errors, []);
});
