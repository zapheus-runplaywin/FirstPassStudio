// Every test that opens a browser does it so that it is skipped where there is no browser, as on the Mac app
// build: through support/browser.mts's openBrowser/openPage, or a launch of its own inside a try. A bare
// chromium.launch() throws there instead and fails the build (commentatorstats.test.mts did, 2026-11-01).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function testFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? testFiles(p) : /\.(c|m)?(js|ts)$/.test(e.name) ? [p] : [];
  });
}

test('no test opens a browser that throws where there is none', () => {
  const bare: string[] = [];
  for (const file of testFiles(import.meta.dirname)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line) || !/chromium\.launch\(/.test(line)) return;
      // The try is on the same line, or the line before: try { browser = await chromium.launch(...) }
      if (!/\btry\s*\{/.test(line) && !/\btry\s*\{\s*$/.test(lines[i - 1] || '')) bare.push(`${path.relative(import.meta.dirname, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, [], 'open the browser with openBrowser or openPage from support/browser.mts');
});
