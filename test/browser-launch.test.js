// Every test that opens a browser does it so that it is skipped where there is no browser, as on the Mac app
// build: through support/browser.js's openBrowser/openPage, or a launch of its own inside a try. A bare
// chromium.launch() throws there instead and fails the build (commentatorstats.test.js did, 2026-11-01).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? testFiles(p) : /\.(c|m)?js$/.test(e.name) ? [p] : [];
  });
}

test('no test opens a browser that throws where there is none', () => {
  const bare = [];
  for (const file of testFiles(__dirname)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line) || !/chromium\.launch\(/.test(line)) return;
      // The try is on the same line, or the line before: try { browser = await chromium.launch(...) }
      if (!/\btry\s*\{/.test(line) && !/\btry\s*\{\s*$/.test(lines[i - 1] || '')) bare.push(`${path.relative(__dirname, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, [], 'open the browser with openBrowser or openPage from support/browser.js');
});
