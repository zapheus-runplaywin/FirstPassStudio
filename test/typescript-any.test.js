// Every `any` in Studio's TypeScript says why: a comment starting "any:" on the same line or the line above it.
// Data from outside (a request, a saved file, PlayHQ) comes in as unknown and is checked (check.ts); an `any` is only
// for the rare value that can't be typed, and the comment is the reason a reviewer reads.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'out', 'dist', 'vendor', '.git']);

function tsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// The code of a line without its comments and strings, so "any" in a sentence or a message doesn't count.
// inBlock: whether the line starts inside a /* */ comment; the answer says whether the next one does.
function codeOf(line, inBlock) {
  let code = '', i = 0;
  while (i < line.length) {
    if (inBlock) {
      const end = line.indexOf('*/', i);
      if (end < 0) return { code, inBlock: true };
      i = end + 2; inBlock = false; continue;
    }
    const c = line[i];
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '/' && line[i + 1] === '*') { inBlock = true; i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      code += c + c; i = j + 1; continue;
    }
    code += c; i++;
  }
  return { code, inBlock };
}

// any as a type: x: any, as any, Promise<any>, any[], A | any, (a: any) =>.
const ANY = /(?::\s*any\b|\bas\s+any\b|<\s*any\b|\bany\s*\[\]|\|\s*any\b|\bany\s*[>,)|;])/;
const WHY = /\/\/\s*any:\s*\S|\/\*\s*any:\s*\S/;

test('every any in the TypeScript has a comment saying why', () => {
  const bare = [];
  for (const file of tsFiles(ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let inBlock = false;
    lines.forEach((line, n) => {
      const got = codeOf(line, inBlock);
      inBlock = got.inBlock;
      if (ANY.test(got.code) && !WHY.test(line) && !(n > 0 && WHY.test(lines[n - 1]))) bare.push(`${path.relative(ROOT, file)}:${n + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(bare, [], `Say why on each (a comment starting "any:" on the line or the one above), or type it:\n${bare.join('\n')}`);
});

test('the any check finds a bare any and passes an explained one', () => {
  const check = line => ANY.test(codeOf(line, false).code) && !WHY.test(line);
  assert.ok(check('const x: any = 1;'));
  assert.ok(check('f(y as any);'));
  assert.ok(check('new Map<string, any>()'));
  assert.ok(!check('const x: any = 1; // any: the protocol is untyped'));
  assert.ok(!check('// any game on the night'));
  assert.ok(!check('log(\'Is any game on: no\');'));
  assert.ok(!check('const many: number = 1;'));
});
