// Smoke test for the built module: it loads, and without the NDI runtime (as on the build machine)
// it says why instead of crashing.
const assert = require('assert');
const ndi = require('./build/Release/ndi.node');

const a = ndi.available();
assert.strictEqual(typeof a.ok, 'boolean');
if (!a.ok) assert.match(a.error, /NDI/);
assert.deepStrictEqual(ndi.status(), { running: false });
assert.strictEqual(ndi.frame(Buffer.alloc(16), 2, 2), false);
if (!a.ok) assert.strictEqual(ndi.start({ sources: [{ kind: 'fill', name: 'Test' }], width: 1920, height: 1080, rateN: 50, rateD: 1 }).ok, false);
ndi.stop();
console.log(`ndi module OK: ${a.ok ? `NDI ${a.version}` : a.error}`);
