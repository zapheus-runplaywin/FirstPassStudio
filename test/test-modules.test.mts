// A .mts test is an ES module, where Node has no require(); tsc can't tell, because Node's types declare one for
// CommonJS. So a test that calls require() makes its own with createRequire, or the call throws: a browser test
// that tried require('playwright') would then skip as if Playwright weren't installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const TEST = import.meta.dirname;

test('every .mts test that calls require() makes it with createRequire', () => {
  const files = [...fs.readdirSync(TEST).filter(f => f.endsWith('.mts')), ...fs.readdirSync(path.join(TEST, 'support')).filter(f => f.endsWith('.mts')).map(f => `support/${f}`)];
  const missing = files.filter(f => {
    // The code alone: no comments, and no strings (a child process's script may require() in its own CommonJS).
    const src = fs.readFileSync(path.join(TEST, f), 'utf8').replace(/`[^`]*`|'(?:\\.|[^'\\\n])*'/g, "''").replace(/\/\/[^\n]*/g, '');
    return /(?<![\w.])require\(/.test(src) && !/const require = createRequire\(/.test(src);
  });
  assert.deepEqual(missing, []);
});
