// Every script the pages load parses: a slip like a stray quote in one of them stops a whole page (the Output
// page's parts share one scope, so one bad part breaks the rest), and nothing else here loads them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const scripts = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? scripts(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);

test('every page script parses', () => {
  const files = scripts(PUBLIC);
  assert.ok(files.length > 10);
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    // Modules can't be parsed as plain scripts; they're checked as functions' bodies would reject import/export.
    if (/^\s*(import|export)\s/m.test(code)) continue;
    assert.doesNotThrow(() => new vm.Script(code, { filename: f }), path.relative(PUBLIC, f));
  }
});
