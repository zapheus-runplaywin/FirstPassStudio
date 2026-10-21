// The Mac app packs only the files listed in package.json's build.files, so every local module Studio
// or the app loads must be listed: a missing one stops Studio starting before it can write to the log.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const files = require('../package.json').build.files;
const packed = rel => files.some(f => f === rel || (f.endsWith('/**/*') && rel.startsWith(f.slice(0, -4))));

test('every local module that Studio and the Mac app load is packed into the app', () => {
  const seen = new Set();
  const visit = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    assert.ok(packed(rel), `${rel} is loaded but not listed in package.json build.files, so the Mac app would fail to start`);
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const [, dep] of src.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
      let next = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, rel)), dep));
      if (!next.endsWith('.js') && !next.endsWith('.json') && !next.endsWith('.node')) next += '.js';
      if (next.endsWith('.js') && fs.existsSync(path.join(ROOT, next))) visit(next.split(path.sep).join('/'));
    }
  };
  visit('server.js');
  visit(require('../package.json').main);
  assert.ok(seen.has('sequences.js'));
});
