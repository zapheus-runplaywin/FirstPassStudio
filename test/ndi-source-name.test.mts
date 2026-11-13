// NDI source names (outputs.ts ndiSource): an output's NDI sources take its name and follow it when it's
// renamed, unless "Use my own name" is ticked (ndiOwnName) with a name typed. An outputs.json saved before
// then drops its source names, so every output follows its name; one saved since keeps its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ndi-name-'));
process.env.FIRSTPASS_DATA_DIR = DIR;
fs.writeFileSync(path.join(DIR, 'outputs.json'), JSON.stringify({ outputs: [
  { id: 'main', slot: 1, name: 'Output 1', mode: 'ndi', on: false, ndiName: 'FirstPass Studio' },
  { id: 'two', slot: 2, name: 'Wide', mode: 'ndi', on: false, ndiName: 'Typed (before)' },
] }));

const outputs: typeof import('../out/outputs.js') = require('../out/outputs.js');
outputs.init(() => {});
outputs.message({ type: 'ndi', ok: true, version: '6' });

const st = (id: string) => outputs.state().outputs.find(o => o.id === id);
const sent = (id: string) => { const w = outputs.windows().find(x => x.output === id); return w?.kind === 'ndi' ? w.name : undefined; };

test('a saved source name from before is dropped: every output follows its name', () => {
  assert.equal(st('main')!.ndiOwnName, false);
  assert.equal(st('main')!.ndiSource, 'Output 1');
  assert.equal(st('two')!.ndiOwnName, false);
  assert.equal(st('two')!.ndiName, '');
  assert.equal(st('two')!.ndiSource, 'Wide');
});

test('the sources follow the output when it is renamed', () => {
  assert.equal(outputs.apply({ output: 'two', name: 'Close (up)', on: true }), null);
  assert.equal(st('two')!.ndiSource, 'Close up', 'brackets are left out, as NDI puts the name in brackets');
  assert.equal(sent('two'), 'Close up');
  assert.equal(outputs.apply({ output: 'two', on: false, name: 'Wide' }), null);
  assert.equal(st('two')!.ndiSource, 'Wide');
});

test('Use my own name keeps a typed name through renames; unticked, the output name is back', () => {
  assert.equal(outputs.apply({ output: 'two', ndiOwnName: true, ndiName: 'Camera 3' }), null);
  assert.equal(st('two')!.ndiSource, 'Camera 3');
  assert.equal(outputs.apply({ output: 'two', name: 'Tight' }), null);
  assert.equal(st('two')!.ndiSource, 'Camera 3', 'renaming the output leaves it');
  assert.equal(outputs.apply({ output: 'two', ndiOwnName: false }), null);
  assert.equal(st('two')!.ndiSource, 'Tight');
  assert.equal(st('two')!.ndiName, 'Camera 3', 'the typed name is kept for ticking again');
  // A name sent on its own is the output's own; an empty one, or ticked with none typed, is the output's name.
  assert.equal(outputs.apply({ output: 'two', ndiName: 'Wide cam' }), null);
  assert.equal(st('two')!.ndiOwnName, true);
  assert.equal(st('two')!.ndiSource, 'Wide cam');
  assert.equal(outputs.apply({ output: 'two', ndiOwnName: true, ndiName: '  ' }), null);
  assert.equal(st('two')!.ndiSource, 'Tight');
});

test('an own name the same as another output\'s name clashes: the earlier output keeps it', () => {
  assert.equal(outputs.apply({ output: 'two', ndiOwnName: true, ndiName: 'output 1' }), null);
  assert.equal(st('two')!.clash, 'Output 1');
  assert.equal(outputs.apply({ output: 'two', ndiOwnName: false }), null);
  assert.equal(st('two')!.clash, '');
});

test('an added output\'s sources take its name; the setting is saved and kept', () => {
  assert.equal(outputs.apply({ add: true }), null);
  const three = outputs.state().outputs.at(-1)!;
  assert.equal(three.ndiSource, three.name);
  assert.equal(outputs.apply({ output: 'two', ndiOwnName: true, ndiName: 'Camera 3' }), null);
  const saved = JSON.parse(fs.readFileSync(path.join(DIR, 'outputs.json'), 'utf8')).outputs.find((o: { id: string }) => o.id === 'two');
  assert.equal(saved.ndiOwnName, true);
  assert.equal(saved.ndiName, 'Camera 3');
});

test('the Output page has the tick box and shows the name the sources go by', () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'output.html'), 'utf8');
  assert.match(page, /id="outNdiOwn"/);
  const js = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'output', 'settings.ts'), 'utf8');
  assert.match(js, /\$<HTMLInputElement>\('outNdiName'\)\.value = so\.ndiSource/);
  assert.match(js, /\$<HTMLInputElement>\('outNdiName'\)\.disabled = !so\.ndiOwnName/);
});
