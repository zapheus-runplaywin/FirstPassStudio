// Sequences: the scene's sources played one after another (sequences.js, through scene.js), with
// Next, Pause, Delay and Stop, the /deck/sequence links, and saving.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sequences-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const scene = require('../scene');
scene.init(() => {});

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = name => st().sources.find(s => s.name === name).id;
const on = () => st().sources.filter(s => s.visible).map(s => s.name).sort();
const seq = name => st().sequences.find(s => s.name === name);
const step = (names, length = { type: 'time', sec: 20 }) => ({ sources: names.map(id), length });
const link = p => scene.deck(p.split('/'));
const wait = sec => mock.timers.tick(sec * 1000);

function reset() {
  scene.apply({ type: 'seqStop' });
  for (const s of [...st().sequences]) ok({ type: 'seqRemove', sequence: s.id });
  for (const s of [...st().scenes]) ok({ type: 'sceneRemove', scene: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  ok({ type: 'add', sources: [
    { type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' },
    { type: 'browser', name: 'Ladder', url: 'ladder.html' },
    { type: 'browser', name: 'Fixtures', url: 'fixtures.html' },
    { type: 'browser', name: 'Countdown', url: 'countdown.html' },
    { type: 'video', name: 'Ad', file: 'ad.webm' },
  ] });
}
function make(name, changes) { ok({ type: 'seqAdd', changes: { name, ...changes } }); return seq(name); }
function play(name) { ok({ type: 'seqPlay', sequence: name }); }

test('steps play in order for their time, each step\'s sources going off as the next come on, then it turns off what it turned on', () => {
  reset();
  make('Run-up', { steps: [step(['Ladder']), step(['Fixtures'], { type: 'time', sec: 10 })] });
  play('Run-up');
  assert.deepEqual(on(), ['Ladder']);
  assert.equal(st().playing.step, 0);
  wait(19);
  assert.deepEqual(on(), ['Ladder']);
  wait(1);
  assert.deepEqual(on(), ['Fixtures']);
  assert.equal(st().playing.step, 1);
  wait(10);
  assert.deepEqual(on(), []);
  assert.equal(st().playing, null);
});

test('sources kept on stay on for the whole sequence, and a source already on by hand is never turned off', () => {
  reset();
  ok({ type: 'show', name: 'Scoreboard' });
  make('Run-up', { keepOn: [id('Countdown'), id('Scoreboard')], steps: [step(['Ladder']), step(['Fixtures'])] });
  play('Run-up');
  assert.deepEqual(on(), ['Countdown', 'Ladder', 'Scoreboard']);
  wait(20);
  assert.deepEqual(on(), ['Countdown', 'Fixtures', 'Scoreboard']);
  wait(20);
  assert.deepEqual(on(), ['Scoreboard']);
});

test('a repeating sequence plays again until Stop, and Stop does its Then: going to a scene', () => {
  reset();
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'sceneSave', name: 'Game' });
  ok({ type: 'hide', name: 'Scoreboard' });
  make('Break', { repeat: 'loop', then: { type: 'scene', scene: st().scenes[0].id }, steps: [step(['Ladder']), step(['Fixtures'])] });
  play('Break');
  wait(20);
  wait(20);
  assert.equal(st().playing.step, 0);
  assert.equal(st().playing.loop, 1);
  assert.deepEqual(on(), ['Ladder']);
  ok({ type: 'seqStop' });
  assert.equal(st().playing, null);
  assert.deepEqual(on(), ['Scoreboard']);
  assert.equal(st().current, st().scenes[0].id);
});

test('Until it finishes waits for the video to end, and Delay holds it 10 s more', () => {
  reset();
  make('Ad break', { steps: [step(['Ad'], { type: 'done' }), step(['Ladder'])] });
  play('Ad break');
  assert.deepEqual(on(), ['Ad']);
  wait(60);
  assert.deepEqual(on(), ['Ad'], 'still waiting: the video has not ended');
  ok({ type: 'seqDelay' });
  const ad = st().sources.find(s => s.name === 'Ad');
  ok({ type: 'ended', id: ad.id, loadSeq: ad.loadSeq });
  assert.equal(st().playing.step, 0, 'held by the delay');
  wait(9);
  assert.equal(st().playing.step, 0);
  wait(1);
  assert.equal(st().playing.step, 1);
  assert.deepEqual(on(), ['Ladder']);
});

test('Until it finishes gives up after the limit for a page that never says it is done', () => {
  reset();
  make('Clash', { steps: [step(['Countdown'], { type: 'done' }), step(['Ladder'])] });
  play('Clash');
  wait(59);
  assert.equal(st().playing.step, 0);
  wait(1);
  assert.equal(st().playing.step, 1);
});

test('Until I press Next holds until Next, from the Output page or the Stream Deck', () => {
  reset();
  make('Sponsor read', { steps: [step(['Ladder'], { type: 'next' }), step(['Fixtures'], { type: 'next' })] });
  play('Sponsor read');
  wait(600);
  assert.deepEqual(on(), ['Ladder']);
  ok({ type: 'seqNext' });
  assert.deepEqual(on(), ['Fixtures']);
  assert.equal(link('sequence/next').status, 200);
  assert.equal(st().playing, null);
});

test('Pause freezes the time left and carrying on uses what was left', () => {
  reset();
  make('Run-up', { steps: [step(['Ladder']), step(['Fixtures'])] });
  play('Run-up');
  wait(15);
  ok({ type: 'seqPauseToggle' });
  assert.equal(st().playing.paused, true);
  assert.equal(st().playing.leftMs, 5000);
  wait(100);
  assert.deepEqual(on(), ['Ladder']);
  ok({ type: 'seqPauseToggle' });
  wait(4);
  assert.deepEqual(on(), ['Ladder']);
  wait(1);
  assert.deepEqual(on(), ['Fixtures']);
});

test('Delay adds 10 s to a timed step each press', () => {
  reset();
  make('Full time', { steps: [step(['Ladder']), step(['Fixtures'])] });
  play('Full time');
  link('sequence/delay');
  link('sequence/delay');
  assert.equal(st().playing.delayMs, 20000);
  wait(39);
  assert.deepEqual(on(), ['Ladder']);
  wait(1);
  assert.deepEqual(on(), ['Fixtures']);
});

test('turning the step\'s source off by hand moves to the next step', () => {
  reset();
  make('Run-up', { steps: [step(['Ladder']), step(['Fixtures'])] });
  play('Run-up');
  ok({ type: 'hide', name: 'Ladder' });
  assert.equal(st().playing.step, 1);
  assert.deepEqual(on(), ['Fixtures']);
});

test('going to a scene stops the sequence without its Then, and its own sources the scene does not keep go off', () => {
  reset();
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'sceneSave', name: 'Game' });
  ok({ type: 'sceneUpdate', scene: 'Game', changes: { states: { [id('Ladder')]: 'leave', [id('Countdown')]: 'leave', [id('Fixtures')]: 'leave', [id('Ad')]: 'leave' } } });
  ok({ type: 'hide', name: 'Scoreboard' });
  make('Run-up', { keepOn: [id('Countdown')], then: { type: 'leave' }, steps: [step(['Ladder'])] });
  play('Run-up');
  assert.deepEqual(on(), ['Countdown', 'Ladder']);
  ok({ type: 'sceneGo', scene: 'Game' });
  assert.equal(st().playing, null);
  assert.deepEqual(on(), ['Scoreboard']);
});

test('starting another sequence stops the one playing', () => {
  reset();
  make('A', { steps: [step(['Ladder'])] });
  make('B', { steps: [step(['Fixtures'])] });
  play('A');
  play('B');
  assert.equal(st().playing.id, seq('B').id);
  assert.deepEqual(on(), ['Fixtures']);
});

test('the Stream Deck links play, toggle and stop sequences by name, and say when there is none', () => {
  reset();
  make('Quarter break', { repeat: 'loop', steps: [step(['Ladder'])] });
  assert.equal(link('sequence/quarter-break').status, 200);
  assert.equal(st().playing.id, seq('Quarter break').id);
  assert.equal(link('sequence/quarter-break/toggle').status, 200);
  assert.equal(st().playing, null);
  assert.equal(link('sequence/quarter-break/toggle').status, 200);
  assert.equal(link('sequence/stop').status, 200);
  assert.equal(st().playing, null);
  assert.equal(link('sequence/nope').status, 404);
  assert.equal(link('sequence/next').status, 409);
  // A sequence can't take a name the playing-sequence links use.
  ok({ type: 'seqAdd', changes: { name: 'Next' } });
  assert.equal(st().sequences.at(-1).name, 'Next 2');
});

test('sequences are saved to their file, and removing a source takes it out of them', () => {
  reset();
  make('Run-up', { keepOn: [id('Countdown')], steps: [step(['Ladder', 'Fixtures'])] });
  ok({ type: 'remove', id: id('Fixtures') });
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'sequences.json'), 'utf8'));
  assert.equal(saved.sequences.length, 1);
  assert.deepEqual(saved.sequences[0].steps[0].sources, [id('Ladder')]);
  assert.deepEqual(saved.sequences[0].keepOn, [id('Countdown')]);
});

test('every source off stops the sequence', () => {
  reset();
  make('Run-up', { steps: [step(['Ladder'])] });
  play('Run-up');
  ok({ type: 'hideAll' });
  assert.equal(st().playing, null);
  wait(60);
  assert.deepEqual(on(), []);
});
