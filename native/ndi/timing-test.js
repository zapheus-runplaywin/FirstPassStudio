// The send loop keeps the format's frame rate when NDI is slow to compress each frame: with fill and
// key at 1080p50 and 15 ms to compress each (two sources, 30 ms, more than a frame's 20 ms), frames go
// to NDI without waiting (send_send_video_async_v2), so the fill and key compress at the same time, and
// no picture is changed while NDI is still reading it. Waiting for each frame in turn, as Studio did,
// sent about 30 a second. Runs against a stand-in NDI runtime (test/mock-libndi.cpp) built here with
// the system's C++ compiler. It checks how frames are sent rather than how many went out a second:
// the stand-in's compressing is a sleep, and the Mac build machine stretches short sleeps (it measured
// 13 a second there; Matt's Mac sends 50).
'use strict';
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.NDI_RUNTIME_DIR_V6) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-ndi-'));
  const lib = path.join(dir, process.platform === 'darwin' ? 'libndi.dylib' : 'libndi.so.6');
  execFileSync('c++', ['-std=c++17', '-O2', '-shared', '-fPIC', '-I', path.join(__dirname, 'sdk'),
    path.join(__dirname, 'test', 'mock-libndi.cpp'), '-o', lib, '-lpthread'], { stdio: 'inherit' });
  const report = path.join(dir, 'report.json');
  execFileSync(process.execPath, [__filename], { stdio: 'inherit', env: { ...process.env, NDI_RUNTIME_DIR_V6: dir, ENCODE_MS: '15', MOCK_NDI_REPORT: report } });
  const sends = JSON.parse(fs.readFileSync(report, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`ndi sends: ${sends.async} without waiting, ${sends.waiting} waiting, up to ${sends.mostAtOnce} compressing at once`);
  assert.ok(sends.async > 0, 'frames go to NDI without waiting');
  assert.strictEqual(sends.waiting, 0, 'no frame waits for NDI to compress it');
  assert.ok(sends.mostAtOnce >= 2, 'the fill and key compress at the same time');
  return;
}

const ndi = require('./build/Release/ndi.node');
const a = ndi.available();
assert.ok(a.ok, a.error);
assert.strictEqual(a.version, 'mock');
const [width, height, rate, seconds] = [1920, 1080, 50, 4];
const r = ndi.start({ sources: [{ kind: 'fill', name: 'Test Fill' }, { kind: 'key', name: 'Test Key' }], width, height, rateN: rate, rateD: 1 });
assert.ok(r.ok, r.error);

// A new picture every frame, one colour all over (as a moving ticker changes every frame).
const picture = Buffer.alloc(width * height * 4);
let n = 0;
const feed = setInterval(() => {
  picture.fill(Buffer.from([n & 255, n & 255, n & 255, 255 - (n & 127)]));
  n++;
  assert.strictEqual(ndi.frame(r.id, picture, width, height), true);
}, 1000 / rate);

setTimeout(() => {
  clearInterval(feed);
  const s = ndi.status(r.id);
  ndi.stop(); // the stand-in stops the test if a frame changed under it
  const sent = s.sent / seconds;
  console.log(`ndi timing: ${sent.toFixed(1)} frames a second sent of ${rate}, ${s.pictures} pictures, fell behind ${s.late} times`);
  assert.ok(s.sent > 0 && s.pictures > 0);
}, seconds * 1000);
