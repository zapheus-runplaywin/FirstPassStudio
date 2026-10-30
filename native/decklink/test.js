// Smoke test for the built module: it loads, and without a device (or without Desktop Video, as on
// the build machine) it says why instead of crashing.
const assert = require('assert');
const decklink = require('./build/Release/decklink.node');

const list = decklink.devices();
assert.strictEqual(typeof list.ok, 'boolean');
if (list.ok) assert.ok(Array.isArray(list.devices));
else assert.match(list.error, /Desktop Video/);
assert.deepStrictEqual(decklink.status(), { running: false });
const r = decklink.start({ device: 'none', mode: 0, keying: 'external' });
assert.strictEqual(r.ok, false);
assert.ok(r.error);
assert.strictEqual(decklink.frame(Buffer.alloc(16), 2, 2), false);
assert.strictEqual(decklink.audio(Buffer.alloc(3840)), false);
decklink.stop();
assert.deepStrictEqual(decklink.inputStatus(), { running: false });
const i = decklink.inputStart({ device: 'none' });
assert.strictEqual(i.ok, false);
assert.ok(i.error);
decklink.inputStop();
console.log(`decklink module OK: ${list.ok ? `${list.devices.length} device(s), Desktop Video ${list.version}` : list.error}`);
