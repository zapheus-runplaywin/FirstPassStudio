// A sequence set to start N minutes before the game starts only when Studio was running at that
// moment (sequences.js gameTick). Opened inside the window, it's left to the operator, who can
// start it by hand. Its own file, so Studio "starts" at a known time.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-startup-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const scene = require('../scene');
const logged = [];
scene.init((level, area, text) => logged.push(text));

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = name => st().sources.find(s => s.name === name).id;
const seq = name => st().sequences.find(s => s.name === name);
const playingName = () => st().playing && st().sequences.find(s => s.id === st().playing.id).name;
const make = (name, min) => { ok({ type: 'seqAdd', changes: { name, start: { type: 'before', min }, steps: [{ sources: [id('Countdown')], length: { type: 'next' } }] } }); return seq(name); };

let g;
const newGame = (id, startAt) => { g = { id, label: 'Stormz v Titans on Court 1', startAt, period: 1, last: 4, left: 600, running: false, onBreak: false, finished: false }; scene.game(g); };
const tick = sec => { for (let i = 0; i < sec; i++) { mock.timers.tick(1000); scene.game(g); } };

test('opened inside the window: the moment already passed is skipped, a later one still starts', () => {
  ok({ type: 'add', sources: [{ type: 'browser', name: 'Countdown', url: 'countdown.html' }] });
  make('Run-up', 10);
  make('Walk out', 2);
  // Studio started 5 minutes before the game: 10 minutes before was while it wasn't running.
  newGame('g1', Date.now() + 5 * 60000);
  tick(5);
  assert.equal(st().playing, null, 'Run-up does not start late');
  assert.ok(logged.some(t => /"Run-up" won't start by itself: Studio wasn't running 10 min before/.test(t)));
  assert.equal(st().nextAuto.id, seq('Walk out').id);
  tick(3 * 60);
  assert.equal(playingName(), 'Walk out', '2 minutes before came while Studio was running');
  ok({ type: 'seqStop' });
  // Run-up can still be started by hand.
  ok({ type: 'seqPlay', sequence: seq('Run-up').id });
  assert.equal(playingName(), 'Run-up');
  ok({ type: 'seqStop' });
});

test('a game whose moment comes while Studio is running starts its sequence then', () => {
  newGame('g2', Date.now() + 30 * 60000);
  tick(20 * 60);
  assert.equal(playingName(), 'Run-up');
  ok({ type: 'seqStop' });
});
