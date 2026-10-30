// FirstPass Studio - which pictures and videos look soft in 4K.
//
// In 4K (outputs.js quality) Studio draws its own text and shapes at 3840 x 2160, but a picture or a video is only
// as sharp as its file. soft() lists the ones that will look soft, for the Output page to name so a bigger file can
// go in: a logo (the competition's team logos and brand logos, and images in the media folder, which is where the
// sponsors' logos are) under 1024 pixels on its longer side, as the big animations draw a crest about 540 points
// across (1080 pixels in 4K); and a video less than 2160 pixels tall. SVG is drawn at any size, so it's never soft.
//
// size(file) reads just the start of a PNG, JPEG, WebP or GIF for its size, kept until the file changes.

'use strict';

const fs = require('fs');

const LOGO_PX = 1024;
const VIDEO_PX = 2160;

const known = new Map(); // file -> { mtimeMs, size }

// { width, height } from the file's header, or null (SVG, a file it can't read, or another kind).
function size(file) {
  let mtimeMs;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch { return null; }
  const k = known.get(file);
  if (k && k.mtimeMs === mtimeMs) return k.size;
  let s = null;
  try { s = parse(head(file)); } catch { s = null; }
  known.set(file, { mtimeMs, size: s });
  return s;
}

function head(file, bytes = 256 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

function parse(b) {
  // PNG: IHDR straight after the signature.
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // GIF: the logical screen size.
  if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    return null;
  }
  // JPEG: the first start-of-frame marker.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// The pictures and videos that look soft in 4K: [{ what, name, width, height }], what being 'logo' or 'video'.
// logos: [{ name, file }] (team, brand and media images); videos: [{ name, width, height }] (sizes ffmpeg read; a
// video not measured yet is left out until it has been).
function soft({ logos = [], videos = [] }) {
  const out = [];
  for (const l of logos) {
    if (/\.svg$/i.test(l.file)) continue;
    const s = size(l.file);
    if (s && Math.max(s.width, s.height) < LOGO_PX) out.push({ what: 'logo', name: l.name, width: s.width, height: s.height });
  }
  for (const v of videos) if (v.height && v.height < VIDEO_PX) out.push({ what: 'video', name: v.name, width: v.width, height: v.height });
  return out;
}

module.exports = { size, soft, parse, LOGO_PX, VIDEO_PX };
