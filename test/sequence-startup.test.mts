// A sequence set to start N minutes before the game starts only when Studio was running at that
// moment (sequences.ts gameTick). Opened inside the window, it's left to the operator, who can
// start it by hand. Its own file, so Studio "starts" at a known time.
import test from 'node:test';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-startup-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const scene: typeof import('../out/scene.js') = require('../out/scene.js');
const logged: string[] = [];
scene.init((level, area, text) => logged.push(text));

const ok = (a: unknown) => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = (name: string) => st().sources.find(s => s.name === name)!.id;
const seq = (name: string) => st().sequences.find(s => s.name === name);
const playingName = () => st().playing && st().sequences.find(s => s.id === st().playing!.id)!.name;
const make = (name: string, min: number) => { ok({ type: 'seqAdd', changes: { name, start: { type: 'before', min }, steps: [{ sources: [id('Countdown')], length: { type: 'next' } }] } }); return seq(name); };

let g: NonNullable<Parameters<typeof scene.game>[0]> | null = null;
const newGame = (id: string, startAt: number | null) => { g = { id, label: 'Stormz v Titans on Court 1', startAt, period: 1, last: 4, left: 600, running: false, onBreak: false, finished: false, superShot: false }; scene.game(g); };
const tick = (sec: number) => { for (let i = 0; i < sec; i++) { mock.timers.tick(1000); scene.game(g); } };

test('opened inside the window: the moment already passed is skipped, a later one still starts', () => {
  ok({ type: 'add', sources: [{ type: 'browser', name: 'Countdown', url: 'countdown.html' }] });
  make('Run-up', 10);
  make('Walk out', 2);
  // Studio started 5 minutes before the game: 10 minutes before was while it wasn't running.
  newGame('g1', Date.now() + 5 * 60000);
  tick(5);
  assert.equal(st().playing, null, 'Run-up does not start late');
  assert.ok(logged.some(t => /"Run-up" won't start by itself: Studio wasn't running 10 min before/.test(t)));
  assert.equal(st().nextAuto!.id, seq('Walk out')!.id);
  tick(3 * 60);
  assert.equal(playingName(), 'Walk out', '2 minutes before came while Studio was running');
  ok({ type: 'seqStop' });
  // Run-up can still be started by hand.
  ok({ type: 'seqPlay', sequence: seq('Run-up')!.id });
  assert.equal(playingName(), 'Run-up');
  ok({ type: 'seqStop' });
});

test('a game whose moment comes while Studio is running starts its sequence then', () => {
  newGame('g2', Date.now() + 30 * 60000);
  tick(20 * 60);
  assert.equal(playingName(), 'Run-up');
  ok({ type: 'seqStop' });
});
