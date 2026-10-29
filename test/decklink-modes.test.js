// The Blackmagic video format (outputs.js): every 1080p format the device names can be picked, even one it
// says it can't send (an older UltraStudio stops at 1080p30), but one it can send is the one started with.
// Its sound goes in the SDI by default.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-decklink-modes-'));
const outputs = require('../outputs');
outputs.init(() => {}, {});

const mode = (code, name, supported, keying = supported) => ({ mode: code, name, height: 1080, interlaced: false, supported, keying });
outputs.message({ type: 'decklink', ok: true, devices: [{ id: 'dl', name: 'UltraStudio', externalKeying: true, modes: [
  { mode: 1, name: '1080i50', height: 1080, interlaced: true, supported: true, keying: true },
  mode(2, '1080p25', true), mode(3, '1080p30', true), mode(4, '1080p50', false), mode(5, '1080p60', false),
] }] });
const sent = () => outputs.windows().find(w => w.kind === 'decklink')?.mode;

test('with nothing picked, a format the device can send is started with, not 1080p50 it says it can\'t', () => {
  assert.equal(outputs.apply({ mode: 'decklink', decklinkDevice: 'dl', on: true }), null);
  assert.equal(sent(), 2);
});

test('a 1080p format the device says it can\'t send can still be picked', () => {
  assert.equal(outputs.apply({ decklinkMode: 4 }), null);
  assert.equal(sent(), 4);
});

test('an interlaced format saved earlier is still replaced by a 1080p one', () => {
  assert.equal(outputs.apply({ decklinkMode: 1 }), null);
  assert.equal(sent(), 2);
});

test('the sound goes in the SDI unless picked otherwise, and anything else saved goes back to that', () => {
  const sound = () => outputs.windows().find(w => w.kind === 'decklink')?.sound;
  assert.equal(sound(), 'sdi');
  for (const v of ['mac', 'both']) {
    assert.equal(outputs.apply({ decklinkSound: v }), null);
    assert.equal(sound(), v);
  }
  assert.equal(outputs.apply({ decklinkSound: 'speakers' }), null);
  assert.equal(sound(), 'sdi');
});
