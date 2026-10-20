// Scenes: saved on/off looks for the one shared list of sources (scene.js), the /deck/scene links,
// and export and import keeping them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-scenes-'));
const scene = require('../scene');
scene.init(() => {});

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const src = name => st().sources.find(s => s.name === name);
const sc = name => st().scenes.find(s => s.name === name);
const on = () => st().sources.filter(s => s.visible).map(s => s.name).sort();
const changedNames = () => st().changed.map(id => st().sources.find(s => s.id === id).name).sort();
const link = p => scene.deck(p.split('/'));

// Starts each test from four sources, all off, and no scenes.
function reset() {
  for (const s of [...st().scenes]) ok({ type: 'sceneRemove', scene: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  ok({ type: 'add', sources: [
    { type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' },
    { type: 'browser', name: 'Ticker', url: 'ladderbar.html' },
    { type: 'browser', name: 'Up next', url: 'fixtures.html' },
    { type: 'video', name: 'Sponsor', file: 'sponsor.webm' },
  ] });
}
function show(...names) { for (const n of names) ok({ type: 'show', name: n }); }
function hide(...names) { for (const n of names) ok({ type: 'hide', name: n }); }

test('an existing setup with no scenes keeps working: no scenes, no current scene, nothing changed', () => {
  reset();
  show('Scoreboard');
  assert.deepEqual(st().scenes, []);
  assert.equal(st().current, null);
  assert.deepEqual(st().changed, []);
  assert.deepEqual(on(), ['Scoreboard']);
});

test('saving what is on now makes a scene with every source on or off, and it becomes the current scene', () => {
  reset();
  show('Scoreboard', 'Ticker');
  ok({ type: 'sceneSave', name: 'Live', colour: 'blue' });
  const live = sc('Live');
  assert.equal(st().current, live.id);
  assert.deepEqual(live.states, { [src('Scoreboard').id]: 'on', [src('Ticker').id]: 'on', [src('Up next').id]: 'off', [src('Sponsor').id]: 'off' });
  assert.equal(live.colour, 'blue');
  assert.deepEqual(st().changed, []);
});

test('going to a scene turns sources on and off to match, and leaves a source that is already on running', () => {
  reset();
  show('Up next', 'Ticker');
  ok({ type: 'sceneSave', name: 'Pre-game' });
  hide('Up next');
  show('Scoreboard');
  ok({ type: 'sceneSave', name: 'Live' });
  ok({ type: 'sceneGo', scene: 'Pre-game' });
  const ticker = src('Ticker');
  const seq = ticker.loadSeq;
  assert.deepEqual(on(), ['Ticker', 'Up next']);
  ok({ type: 'sceneGo', scene: 'Live' });
  assert.deepEqual(on(), ['Scoreboard', 'Ticker']);
  // The ticker stayed on the whole time and wasn't reloaded.
  assert.equal(src('Ticker').visible, true);
  assert.equal(src('Ticker').loadSeq, seq);
  assert.equal(st().current, sc('Live').id);
});

test('a source changed by hand shows as changed, and going to the scene again puts it back', () => {
  reset();
  show('Scoreboard', 'Ticker');
  ok({ type: 'sceneSave', name: 'Live' });
  show('Up next');
  hide('Ticker');
  assert.deepEqual(changedNames(), ['Ticker', 'Up next']);
  assert.equal(st().current, sc('Live').id, 'the current scene stays');
  ok({ type: 'sceneAgain' });
  assert.deepEqual(on(), ['Scoreboard', 'Ticker']);
  assert.deepEqual(st().changed, []);
});

test('Hide all keeps the current scene, shown as changed', () => {
  reset();
  show('Scoreboard');
  ok({ type: 'sceneSave', name: 'Live' });
  ok({ type: 'hideAll' });
  assert.deepEqual(changedNames(), ['Scoreboard']);
  ok({ type: 'sceneAgain' });
  assert.deepEqual(on(), ['Scoreboard']);
});

test('a scene can leave sources as they are: going to it does not touch them, and they never count as changed', () => {
  reset();
  show('Scoreboard', 'Ticker');
  ok({ type: 'sceneSave', name: 'Live' });
  ok({ type: 'sceneSave', name: 'Ad break', states: { [src('Sponsor').id]: 'on', [src('Ticker').id]: 'off' } });
  assert.equal(st().current, sc('Live').id, 'a scene made from given states does not become current');
  ok({ type: 'sceneGo', scene: 'Ad break' });
  assert.deepEqual(on(), ['Scoreboard', 'Sponsor']);
  hide('Scoreboard');
  show('Up next');
  assert.deepEqual(st().changed, [], 'Scoreboard and Up next are left alone by Ad break');
  // Leave can also be set on an existing scene.
  ok({ type: 'sceneUpdate', scene: 'Live', changes: { states: { [src('Ticker').id]: 'leave' } } });
  assert.equal(sc('Live').states[src('Ticker').id], undefined);
});

test('saving over a scene keeps what is on now, and keeps its left-alone sources left alone', () => {
  reset();
  ok({ type: 'sceneSave', name: 'Quarter time', states: { [src('Scoreboard').id]: 'on', [src('Sponsor').id]: 'off' } });
  ok({ type: 'sceneGo', scene: 'Quarter time' });
  show('Sponsor', 'Ticker');
  assert.deepEqual(changedNames(), ['Sponsor']);
  ok({ type: 'sceneCapture', scene: 'Quarter time' });
  assert.deepEqual(sc('Quarter time').states, { [src('Scoreboard').id]: 'on', [src('Sponsor').id]: 'on' });
  assert.deepEqual(st().changed, []);
});

test('a new source is off in every existing scene', () => {
  reset();
  show('Scoreboard');
  ok({ type: 'sceneSave', name: 'Live' });
  ok({ type: 'sceneSave', name: 'Ad break', states: { [src('Sponsor').id]: 'on' } });
  ok({ type: 'add', source: { type: 'browser', name: 'Lower third', url: 'goals.html' } });
  const id = src('Lower third').id;
  assert.equal(sc('Live').states[id], 'off');
  assert.equal(sc('Ad break').states[id], 'off');
  show('Lower third');
  assert.deepEqual(changedNames(), ['Lower third']);
  ok({ type: 'sceneAgain' });
  assert.equal(src('Lower third').visible, false);
});

test('a removed source drops out of every scene', () => {
  reset();
  ok({ type: 'sceneSave', name: 'Live' });
  const id = src('Ticker').id;
  ok({ type: 'remove', name: 'Ticker' });
  assert.equal(sc('Live').states[id], undefined);
});

test('a video that hides itself when it finishes is not a change from the scene', () => {
  reset();
  ok({ type: 'sceneSave', name: 'Ad break', states: { [src('Sponsor').id]: 'on' } });
  ok({ type: 'update', name: 'Sponsor', changes: { hideWhenDone: true, loop: false } });
  ok({ type: 'sceneGo', scene: 'Ad break' });
  ok({ type: 'ended', name: 'Sponsor', loadSeq: src('Sponsor').loadSeq });
  assert.equal(src('Sponsor').visible, false);
  assert.deepEqual(st().changed, []);
  // Turned off by hand it is a change.
  ok({ type: 'sceneAgain' });
  hide('Sponsor');
  assert.deepEqual(changedNames(), ['Sponsor']);
});

test('a page that animates away is switched off, but not by word from an earlier showing', () => {
  reset();
  show('Up next');
  const first = { ...src('Up next') };
  ok({ type: 'ended', name: 'Up next', loadSeq: first.loadSeq, showSeq: first.showSeq });
  assert.equal(src('Up next').visible, false);
  // On again: a late word from the last showing (another scene window) leaves it on; this showing's turns it off.
  show('Up next');
  assert.equal(src('Up next').showSeq, first.showSeq + 1);
  ok({ type: 'ended', name: 'Up next', loadSeq: first.loadSeq, showSeq: first.showSeq });
  assert.equal(src('Up next').visible, true);
  ok({ type: 'ended', name: 'Up next', loadSeq: first.loadSeq, showSeq: first.showSeq + 1 });
  assert.equal(src('Up next').visible, false);
  // Staying on and changing other settings doesn't count as a new showing.
  show('Up next');
  const seq = src('Up next').showSeq;
  ok({ type: 'update', name: 'Up next', changes: { fadeMs: 200 } });
  assert.equal(src('Up next').showSeq, seq);
});

test('a video that loops or is set to stay on is not switched off when it ends', () => {
  reset();
  show('Sponsor');
  ok({ type: 'update', name: 'Sponsor', changes: { hideWhenDone: false } });
  ok({ type: 'ended', name: 'Sponsor', loadSeq: src('Sponsor').loadSeq, showSeq: src('Sponsor').showSeq });
  assert.equal(src('Sponsor').visible, true);
  ok({ type: 'update', name: 'Sponsor', changes: { hideWhenDone: true, loop: true } });
  ok({ type: 'ended', name: 'Sponsor', loadSeq: src('Sponsor').loadSeq, showSeq: src('Sponsor').showSeq });
  assert.equal(src('Sponsor').visible, true);
});

test('Next and Previous step through the scenes in order and stop at the ends', () => {
  reset();
  for (const n of ['Pre-game', 'Live', 'Full time']) ok({ type: 'sceneSave', name: n, states: {} });
  ok({ type: 'sceneRemove', scene: 'Full time' });
  ok({ type: 'sceneSave', name: 'Full time', states: {} });
  // No current scene: Next goes to the first, Previous to the last.
  assert.equal(st().current, null);
  ok({ type: 'sceneNext' });
  assert.equal(st().current, sc('Pre-game').id);
  ok({ type: 'scenePrev' });
  assert.equal(st().current, sc('Pre-game').id, 'stops at the start');
  ok({ type: 'sceneNext' });
  ok({ type: 'sceneNext' });
  assert.equal(st().current, sc('Full time').id);
  ok({ type: 'sceneNext' });
  assert.equal(st().current, sc('Full time').id, 'stops at the end');
  ok({ type: 'sceneRemove', scene: 'Full time' });
  assert.equal(st().current, null);
  ok({ type: 'scenePrev' });
  assert.equal(st().current, sc('Live').id);
  // Moving a scene changes the order Next and Previous use.
  ok({ type: 'sceneMove', scene: 'Live', direction: 'up' });
  assert.deepEqual(st().scenes.map(s => s.name), ['Live', 'Pre-game']);
});

test('scene names are unique and never next, prev or again; rename, colour and copy', () => {
  reset();
  ok({ type: 'sceneSave', name: 'Live', states: {} });
  ok({ type: 'sceneSave', name: 'live', states: {} });
  ok({ type: 'sceneSave', name: 'Next', states: {} });
  assert.deepEqual(st().scenes.map(s => s.name), ['Live', 'live 2', 'Next 2']);
  ok({ type: 'sceneUpdate', scene: 'live-2', changes: { name: 'Quarter time', colour: 'purple' } });
  assert.equal(sc('Quarter time').colour, 'purple');
  ok({ type: 'sceneUpdate', scene: 'Quarter time', changes: { colour: 'pink' } });
  assert.equal(sc('Quarter time').colour, 'blue', 'an unknown colour falls back to blue');
  ok({ type: 'sceneCopy', scene: 'Live' });
  assert.deepEqual(st().scenes.map(s => s.name), ['Live', 'Live copy', 'Quarter time', 'Next 2']);
  assert.notEqual(sc('Live copy').id, sc('Live').id);
});

test('errors: an unknown scene, and Back to saved with no current scene', () => {
  reset();
  assert.match(scene.apply({ type: 'sceneGo', scene: 'Nope' }), /No scene "Nope"/);
  assert.match(scene.apply({ type: 'sceneAgain' }), /no current scene/);
  assert.match(scene.apply({ type: 'sceneNext' }), /no scenes/);
});

test('the /deck/scene links', () => {
  reset();
  show('Scoreboard');
  ok({ type: 'sceneSave', name: 'Live' });
  hide('Scoreboard');
  show('Up next');
  ok({ type: 'sceneSave', name: 'Pre-game' });
  let r = link('scene/live');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, scene: 'Live', changed: 0 });
  assert.deepEqual(on(), ['Scoreboard']);
  r = link('scene/next');
  assert.deepEqual(r.body, { ok: true, scene: 'Pre-game', changed: 0 });
  assert.deepEqual(link('scene/prev').body.scene, 'Live');
  show('Ticker');
  assert.equal(link('scene/live').body.changed, 0);
  show('Ticker');
  assert.equal(scene.deck(['layer', 'ticker', 'on']).status, 200);
  assert.equal(link('scene/again').body.changed, 0);
  assert.deepEqual(on(), ['Scoreboard']);
  assert.equal(link('scene/nope').status, 404);
  // Found by id too, as the Stream Deck plugin presses it.
  assert.equal(link(`scene/${sc('Pre-game').id}`).body.scene, 'Pre-game');
});

test('scenes are saved to scene.json and come back after a restart', () => {
  reset();
  show('Scoreboard');
  ok({ type: 'sceneSave', name: 'Live' });
  show('Ticker');
  link('layer/ticker/on'); // any saved change writes the file
  const saved = JSON.parse(fs.readFileSync(scene.FILE, 'utf8'));
  assert.equal(saved.scenes.length, 1);
  assert.equal(saved.current, saved.scenes[0].id);
  scene.init(() => {});
  assert.equal(st().scenes[0].name, 'Live');
  assert.equal(st().current, st().scenes[0].id);
  assert.deepEqual(changedNames(), ['Ticker']);
});

test('export includes the scenes, and importing it brings them back with nothing on', async () => {
  reset();
  show('Scoreboard');
  ok({ type: 'sceneSave', name: 'Live', colour: 'green' });
  const { files } = scene.exportFiles(false);
  const file = path.join(os.tmpdir(), `scenes-export-${process.pid}.json`);
  fs.writeFileSync(file, files[0].data);
  reset();
  const result = await scene.importFile(file);
  assert.equal(result.scenes, 1);
  assert.equal(sc('Live').colour, 'green');
  assert.equal(sc('Live').states[src('Scoreboard').id], 'on');
  assert.equal(st().current, null);
  assert.deepEqual(on(), []);
  ok({ type: 'sceneGo', scene: 'Live' });
  assert.deepEqual(on(), ['Scoreboard']);
  fs.unlinkSync(file);
});

test('importing an export from before scenes keeps the scenes there are; a source new to them is off', async () => {
  reset();
  show('Scoreboard');
  ok({ type: 'sceneSave', name: 'Live' });
  const keep = st().sources.filter(s => s.name !== 'Ticker').map(({ loadSeq, ...s }) => s);
  const file = path.join(os.tmpdir(), `scenes-old-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({ sources: [...keep, { type: 'browser', name: 'Lower third', url: 'goals.html' }] }));
  const tickerId = src('Ticker').id;
  const result = await scene.importFile(file);
  assert.equal(result.scenes, null);
  const live = sc('Live');
  assert.equal(live.states[src('Scoreboard').id], 'on', 'a source kept from before keeps its setting');
  assert.equal(live.states[src('Lower third').id], 'off', 'a new source is off');
  assert.equal(live.states[tickerId], undefined, 'a source that has gone drops out');
  fs.unlinkSync(file);
});
