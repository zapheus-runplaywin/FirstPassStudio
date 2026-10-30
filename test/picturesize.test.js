// What looks soft in 4K (picturesize.js): the size of a PNG, JPEG, WebP or GIF from its header, logos under 1024
// pixels and videos under 2160 pixels tall listed, SVG never; and the Output page gets the list only in 4K.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const picturesize = require('../picturesize');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-picturesize-'));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const png = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const gif = (w, h) => { const b = Buffer.alloc(13); b.write('GIF89a', 0, 'ascii'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };
// A JPEG with an APP0 segment before its baseline frame header.
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webpX = (w, h) => { const b = Buffer.alloc(30); b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii'); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };
const webpL = (w, h) => { const b = Buffer.alloc(30); b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8L', 12, 'ascii'); b[20] = 0x2f; b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21); return b; };
const write = (name, buf) => { const f = path.join(DIR, name); fs.writeFileSync(f, buf); return f; };

test('reads the size of each kind of picture from its header', () => {
  assert.deepEqual(picturesize.size(write('a.png', png(512, 400))), { width: 512, height: 400 });
  assert.deepEqual(picturesize.size(write('a.gif', gif(300, 200))), { width: 300, height: 200 });
  assert.deepEqual(picturesize.size(write('a.jpg', jpeg(1600, 900))), { width: 1600, height: 900 });
  assert.deepEqual(picturesize.size(write('a.webp', webpX(2048, 1024))), { width: 2048, height: 1024 });
  assert.deepEqual(picturesize.size(write('b.webp', webpL(700, 350))), { width: 700, height: 350 });
  assert.equal(picturesize.size(write('a.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))), null);
  assert.equal(picturesize.size(path.join(DIR, 'missing.png')), null);
});

test('a changed file is read again', () => {
  const f = write('c.png', png(100, 100));
  assert.equal(picturesize.size(f).width, 100);
  fs.writeFileSync(f, png(2000, 2000));
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.equal(picturesize.size(f).width, 2000);
});

test('logos under 1024 pixels and videos under 2160 pixels tall are soft, SVG never', () => {
  const logos = [
    { name: 'Blizzardz.png', file: write('Blizzardz.png', png(512, 512)) },
    { name: 'Big.png', file: write('Big.png', png(1200, 800)) },
    { name: 'Wide.jpg', file: write('Wide.jpg', jpeg(1024, 300)) },
    { name: 'Crest.svg', file: write('Crest.svg', Buffer.from('<svg/>')) },
  ];
  const videos = [{ name: 'Intro.webm', width: 1920, height: 1080 }, { name: 'Walkout.webm', width: 3840, height: 2160 }];
  assert.deepEqual(picturesize.soft({ logos, videos }), [
    { what: 'logo', name: 'Blizzardz.png', width: 512, height: 512 },
    { what: 'video', name: 'Intro.webm', width: 1920, height: 1080 },
  ]);
});

test('the Output page gets the list only in 4K', () => {
  process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-picturesize-out-'));
  const outputs = require('../outputs');
  outputs.init(() => {}, { soft: () => [{ what: 'logo', name: 'Blizzardz.png', width: 512, height: 512 }] });
  assert.deepEqual(outputs.state().soft, []);
  outputs.apply({ quality: 'uhd' });
  assert.deepEqual(outputs.state().soft, [{ what: 'logo', name: 'Blizzardz.png', width: 512, height: 512 }]);
  outputs.apply({ quality: 'hd' });
});
