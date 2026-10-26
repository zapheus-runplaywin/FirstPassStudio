// More than one output (outputs.js): up to four, each with its own graphics. Output 1 is the primary
// (scenes, sequences, sound, the old links); the others show the sources turned on for them (scene.js
// out), silently. An older outputs.json becomes Output 1, and two outputs can't share a way out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outputs-multi-'));
process.env.FIRSTPASS_DATA_DIR = DIR;
// An outputs.json from before there could be more than one: one output's settings.
fs.writeFileSync(path.join(DIR, 'outputs.json'), JSON.stringify({ mode: 'ndi', on: true, ndiSignal: 'alpha', ndiName: 'Studio', ndiFormat: '1080p25', chromaColor: '#0047bb' }));

const outputs = require('../outputs');
const scene = require('../scene');
let removed = [];
outputs.init(() => {}, { removed: id => { removed.push(id); scene.dropOutput(id); } });
scene.init(() => {}, { outputs: { find: outputs.find, summary: outputs.summary } });
outputs.message({ type: 'displays', displays: [{ id: 1, label: 'Built-in', primary: true }, { id: 2, label: 'HDMI A' }, { id: 3, label: 'HDMI B' }] });
outputs.message({ type: 'ndi', ok: true, version: '6' });
outputs.message({ type: 'decklink', ok: true, devices: [{ id: 'dl', name: 'UltraStudio', externalKeying: true, modes: [{ mode: 7, name: '1080p50', height: 1080, supported: true, keying: true }] }] });

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const src = name => scene.state().sources.find(s => s.name === name);
const st = () => outputs.state();
const byName = n => st().outputs.find(o => o.name === n);

test('an older outputs.json becomes Output 1, the primary, with its settings', () => {
  assert.equal(st().outputs.length, 1);
  const o = st().outputs[0];
  assert.equal(o.id, 'main');
  assert.equal(o.primary, true);
  assert.equal(o.name, 'Output 1');
  assert.equal(o.slot, 1);
  assert.equal(o.colour, '#ea9a38');
  assert.equal(o.mode, 'ndi');
  assert.equal(o.ndiSignal, 'alpha');
  assert.equal(o.ndiName, 'Studio');
  // The primary's settings are still at the top, as before.
  assert.equal(st().mode, 'ndi');
  assert.equal(outputs.windows()[0].output, 'main');
  assert.equal(outputs.windows()[0].muted, undefined, 'the primary plays the sound');
  const saved = JSON.parse(fs.readFileSync(path.join(DIR, 'outputs.json'), 'utf8'));
  assert.ok(!saved.outputs || saved.outputs.length === 1);
});

test('outputs are added up to four, each off, with its own number, colour and NDI name; Output 1 stays', () => {
  for (let i = 0; i < 3; i++) assert.equal(outputs.apply({ add: true }), null);
  assert.deepEqual(st().outputs.map(o => o.name), ['Output 1', 'Output 2', 'Output 3', 'Output 4']);
  assert.deepEqual(st().outputs.map(o => o.colour), ['#ea9a38', '#f24f91', '#4ec1e6', '#95ba45']);
  assert.ok(st().outputs.slice(1).every(o => !o.on && o.mode === 'off'), 'added outputs start off');
  assert.ok(st().outputs.slice(1).every(o => o.ndiName !== 'Studio'), 'and with their own NDI name');
  assert.match(outputs.apply({ add: true }), /4 outputs at most/);
  assert.match(outputs.apply({ remove: 'main' }), /primary/);
  const saved = JSON.parse(fs.readFileSync(path.join(DIR, 'outputs.json'), 'utf8'));
  assert.equal(saved.outputs.length, 4);
  assert.equal(saved.outputs[0].id, 'main');
});

test('names are kept apart and usable in links; outputs are found by name or number', () => {
  const two = byName('Output 2');
  outputs.apply({ output: two.id, name: 'Big screen' });
  outputs.apply({ output: byName('Output 3').id, name: 'Big Screen' });
  assert.equal(byName('Big screen').link, 'big-screen');
  assert.equal(byName('Big Screen 2').slot, 3, 'a name already used gets a number');
  outputs.apply({ output: byName('Output 4').id, name: 'toggle' });
  assert.equal(byName('Output 4').slot, 4, 'a Stream Deck word can\'t be a name');
  assert.equal(outputs.find('big-screen').id, two.id);
  assert.equal(outputs.find('2').id, two.id);
  assert.equal(outputs.find(two.id).id, two.id);
});

test('each output sends its own way out, and only the primary has sound', () => {
  const big = byName('Big screen'), three = byName('Big Screen 2');
  outputs.apply({ output: 'main', mode: 'decklink', decklinkDevice: 'dl', on: true });
  outputs.apply({ output: big.id, mode: 'ndi', ndiSignal: 'fillkey', on: true });
  outputs.apply({ output: three.id, mode: 'chroma', chromaDisplay: '2', on: true });
  const w = outputs.windows();
  assert.deepEqual(w.map(x => [x.output, x.kind]), [['main', 'decklink'], [big.id, 'ndi'], [three.id, 'chroma']]);
  assert.deepEqual(w.map(x => !!x.muted), [false, true, true]);
  assert.equal(st().previewSound, false, 'the primary is on, so the Scene View is silent');
  outputs.apply({ output: 'main', on: false });
  assert.equal(st().previewSound, true, 'the other outputs never play sound, so the Scene View may');
  outputs.apply({ output: 'main', on: true });
});

test('two chroma outputs over HDMI on two displays, each with its own colour', () => {
  const big = byName('Big screen'), three = byName('Big Screen 2');
  outputs.apply({ output: big.id, mode: 'chroma', chromaDisplay: '3', chromaColor: '#0047bb' });
  const w = outputs.windows().filter(x => x.kind === 'chroma');
  assert.deepEqual(w.map(x => [x.display, x.color]), [['3', '#0047bb'], ['2', '#00b140']]);
  assert.ok(w.every(x => x.safe), 'chroma outputs are chroma key safe');
  outputs.apply({ output: big.id, mode: 'ndi' });
  void three;
});

test('two outputs can\'t use the same display, Blackmagic device or NDI name: the earlier one keeps it', () => {
  const big = byName('Big screen'), three = byName('Big Screen 2');
  outputs.apply({ output: three.id, mode: 'decklink', decklinkDevice: 'dl' });
  assert.equal(byName('Big Screen 2').clash, 'Output 1');
  assert.equal(outputs.windows().filter(x => x.kind === 'decklink').length, 1);
  assert.equal(outputs.windows().find(x => x.kind === 'decklink').output, 'main');
  outputs.apply({ output: three.id, mode: 'ndi', ndiName: byName('Big screen').ndiName });
  assert.equal(byName('Big Screen 2').clash, 'Big screen');
  outputs.apply({ output: three.id, ndiName: 'Close up' });
  assert.equal(byName('Big Screen 2').clash, '');
  assert.equal(outputs.windows().filter(x => x.kind === 'ndi').length, 2, 'two NDI outputs at once');
  void big;
});

test('Stream Deck: each output on and off by name or number, all at once, and the old link is Output 1', () => {
  const big = byName('Big screen');
  assert.equal(outputs.deck(['output', 'big-screen', 'off']).status, 200);
  assert.equal(byName('Big screen').on, false);
  assert.equal(outputs.deck(['output', '2', 'toggle']).body.on, true);
  assert.equal(outputs.deck(['output', 'off']).body.output, 'Output 1');
  assert.equal(st().outputs[0].on, false);
  assert.equal(byName('Big screen').on, true, 'the old link leaves the others alone');
  outputs.deck(['output', 'all', 'off']);
  assert.ok(st().outputs.every(o => !o.on));
  outputs.deck(['output', 'all', 'toggle']);
  assert.ok(st().outputs.every(o => o.on));
  assert.equal(outputs.deck(['output', 'nowhere', 'on']).status, 404);
  assert.equal(outputs.deck(['output', 'big-screen', 'layer', 'x', 'on']), null, 'a layer link is the scene\'s');
  void big;
});

test('sources have an on and off per output; the primary\'s is visible, and old links stay the primary\'s', () => {
  const big = byName('Big screen');
  ok({ type: 'add', sources: [{ type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' }, { type: 'browser', name: 'Ladder', url: 'ladder.html' }, { type: 'video', name: 'Clip', file: 'clip.webm', hideWhenDone: true }] });
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'show', name: 'Ladder', output: big.id });
  ok({ type: 'show', name: 'Scoreboard', output: big.id });
  assert.equal(src('Scoreboard').visible, true);
  assert.equal(src('Ladder').visible, false, 'on for Big screen only');
  assert.deepEqual(src('Ladder').out, { [big.id]: true });
  assert.ok(src('Ladder').outSeq[big.id] > 0, 'a showing on that output counts');
  ok({ type: 'toggle', name: 'Scoreboard', output: big.id });
  assert.deepEqual(src('Scoreboard').out, {});
  assert.equal(src('Scoreboard').visible, true, 'the primary\'s is untouched');
  assert.match(scene.apply({ type: 'show', name: 'Ladder', output: 'nowhere' }), /No output/);
  // Links: /deck/output/<output>/layer/<name>/on|off|toggle and /deck/output/<output>/layers/off.
  assert.equal(scene.deck(['output', 'big-screen', 'layer', 'scoreboard', 'on']).body.visible, true);
  assert.equal(scene.deck(['output', '2', 'layer', 'ladder', 'toggle']).body.visible, false);
  assert.equal(scene.deck(['output', 'big-screen', 'layer', 'nothing', 'on']).status, 404);
  assert.equal(scene.deck(['output', '1', 'layer', 'ladder', 'on']).body.visible, true, 'Output 1 by number is the primary');
  assert.equal(src('Ladder').visible, true);
  ok({ type: 'hide', name: 'Ladder' });
  scene.deck(['output', 'big-screen', 'layers', 'off']);
  assert.ok(scene.state().sources.every(s => !Object.keys(s.out).length));
  assert.equal(src('Scoreboard').visible, true, 'hiding Big screen\'s leaves the primary\'s');
});

test('a video ending on another output turns it off there only; a scene saved from the primary can be played on another', () => {
  const big = byName('Big screen');
  ok({ type: 'show', name: 'Clip', output: big.id });
  const c = src('Clip');
  ok({ type: 'ended', id: c.id, loadSeq: c.loadSeq, showSeq: c.outSeq[big.id] - 1, output: big.id });
  assert.equal(src('Clip').out[big.id], true, 'a word from an earlier showing is ignored');
  ok({ type: 'ended', id: c.id, loadSeq: c.loadSeq, showSeq: c.outSeq[big.id], output: big.id });
  assert.deepEqual(src('Clip').out, {});
  ok({ type: 'show', name: 'Ladder', output: big.id });
  ok({ type: 'sceneSave', name: 'Live' });
  assert.equal(scene.state().scenes.find(s => s.name === 'Live').states[src('Ladder').id], 'off', 'a scene saves the primary\'s');
  ok({ type: 'sceneGo', scene: 'Live', output: big.id });
  assert.ok(!src('Ladder').out[big.id], 'played on Big screen, it sets Big screen\'s sources');
  assert.equal(scene.state().currentOut[big.id], scene.state().scenes.find(s => s.name === 'Live').id);
  ok({ type: 'sceneRemove', scene: 'Live' });
});

test('what\'s on for an output isn\'t saved run by run, and goes when the output is removed', () => {
  const big = byName('Big screen');
  scene.deck(['output', 'big-screen', 'layer', 'ladder', 'on']); // a link saves the scene
  const saved = JSON.parse(fs.readFileSync(scene.FILE, 'utf8'));
  const ladder = saved.sources.find(s => s.name === 'Ladder');
  assert.deepEqual(ladder.out, { [big.id]: true });
  assert.equal('outSeq' in ladder, false);
  assert.equal(outputs.apply({ remove: big.id }), null);
  assert.deepEqual(removed, [big.id]);
  assert.deepEqual(src('Ladder').out, {});
  assert.equal(outputs.find('big-screen'), null);
  assert.equal(st().outputs.length, 3);
  // A new output takes the free number (and its colour).
  outputs.apply({ add: true });
  assert.deepEqual(st().outputs.map(o => o.slot), [1, 3, 4, 2]);
  assert.equal(st().outputs[3].colour, '#f24f91');
});

test('scene.html draws another output\'s sources, silently; the pop-out and Output page know outputs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'scene.html'), 'utf8');
  assert.match(html, /params\.get\('output'\)/);
  assert.match(html, /alwaysSilent/);
  assert.match(html, /renderMusic\(outputId \? null/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'output.html'), 'utf8');
  for (const id of ['outAdd', 'outList', 'outName', 'outRemove', 'outTabs', 'outFilter']) assert.match(page, new RegExp(`id="${id}"`));
  const win = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'scenewindow.js'), 'utf8');
  assert.match(win, /&output=\$\{encodeURIComponent\(output\)\}&mute=1/);
});
