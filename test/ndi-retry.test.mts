// An NDI output whose sender failed to start (desktop/ndi.ts) tries again on the next change, as it did before
// there could be more than one: a failure isn't kept as if it were running. Electron, the scene window and the
// native module are stood in for.
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

const require = createRequire(import.meta.url);

let fail = true;
const started: string[] = [];
const addon = {
  available: () => ({ ok: true, version: '6', path: '/usr/local/lib/libndi.dylib' }),
  start: (opts: { sources: { name: string }[] }) => { started.push(opts.sources.map(s => s.name).join()); return fail ? { ok: false, error: 'the NDI runtime is not ready' } : { ok: true, id: started.length }; },
  stop() {}, status: () => ({ running: true, sources: [], late: 0 }), frame: () => true,
};
// Module._load is how require finds a module; Node doesn't type it.
const internals = Module as unknown as { _load: (request: string, parent: unknown, ...rest: unknown[]) => unknown };
const load = internals._load;
internals._load = function (this: unknown, request, parent, ...rest) {
  if (request.endsWith('ndi.node')) return addon;
  if (request === './scenewindow') return { create: () => ({ destroy() {}, contents: () => null }) };
  return load.call(this, request, parent, ...rest);
};
const ndi = (require('../out/desktop/ndi.js') as typeof import('../out/desktop/ndi.js')).create;
internals._load = load;

test('a sender that failed to start is tried again on the next change, and its error shows until then', t => {
  const statuses = [];
  const out = ndi({ port: 8080, log: () => {}, onStatus: (s, output) => statuses.push({ output, ...s }) });
  t.after(() => out.stop());
  const w = { output: 'two', signal: 'alpha', name: 'Commentary', format: { id: '1080p25', width: 1920, height: 1080, rateN: 25, rateD: 1 }, color: '#00ff00', safe: false };
  out.show([w]);
  assert.equal(started.length, 1);
  assert.equal(out.status('two').error, 'the NDI runtime is not ready');
  assert.equal(out.status('two').running, false);
  fail = false;
  out.show([w]); // the same settings: before, this did nothing and the output stayed dead
  assert.equal(started.length, 2);
  assert.equal(out.status('two').error, '');
  assert.equal(out.status('two').running, true);
  out.show([w]); // running now: the same settings leave it alone
  assert.equal(started.length, 2);
});
