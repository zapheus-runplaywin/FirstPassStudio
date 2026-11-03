// The Blackmagic output's sound in the SDI (desktop/soundtap.js, soundtap.html): the output window's sound is captured
// with none of the browser's call processing. Automatic level, noise suppression and echo cancelling are made for
// voices; on music they pump the level and dull the sound (Matt heard it on the SDI, 2026-11-03). The page says what
// the capture is when it starts, and the app logs it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'desktop/soundtap.html'), 'utf8');
const tap = fs.readFileSync(path.join(ROOT, 'desktop/soundtap.js'), 'utf8');

test('the SDI sound is captured with the browser processing off, on the ask and on the track', () => {
  const plain = page.match(/const plain = \{([^}]*)\}/);
  assert.ok(plain, 'soundtap.html names the processing to turn off');
  for (const k of ['autoGainControl', 'noiseSuppression', 'echoCancellation']) assert.match(plain[1], new RegExp(`${k}: false`));
  assert.match(page, /getDisplayMedia\(\{ video: true, audio: \{ \.\.\.plain/);
  assert.match(page, /track\.applyConstraints\(plain\)/);
  assert.doesNotMatch(page, /getDisplayMedia\(\{ video: true, audio: true \}\);/, 'the plain ask is only the fallback');
});

test('the log says what the capture is, and anything still on', () => {
  assert.match(page, /studioTap\.said\(`started: /);
  assert.match(page, /still on: /);
  assert.match(tap, /text\.startsWith\('started'\)/);
  assert.match(tap, /sound captured\$\{how/);
});
