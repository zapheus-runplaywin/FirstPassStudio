// FirstPass Studio - just enough .zip for the scene's export and import (scene.js).
//
// write() streams a zip of files and buffers, stored as they are (images and videos are already
// compressed), with ZIP64 for anything past 4 GB. entries() reads a zip's list of files, and
// open() streams one of them out, stored or deflated, so an archive made by Finder works too.

'use strict';

const fs = require('fs');
const zlib = require('zlib');

const MAX32 = 0xffffffff;
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

// MS-DOS date and time, as zip headers keep them.
function dosTime(d = new Date()) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

async function crcOf(file) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file)) crc = zlib.crc32(chunk, crc);
  return crc >>> 0;
}

// Writes a zip to out (a response): entries are { name, data } (a Buffer) or { name, file } (a path).
// Each file is read once for its checksum and again to send it, so the headers can say so up front.
async function write(out, list) {
  const { time, date } = dosTime();
  const central = [];
  let offset = 0;
  // Waits when the response is full, and stops if whoever was downloading went away.
  const put = async buf => {
    if (out.destroyed) throw new Error('The download was cancelled.');
    offset += buf.length;
    if (!out.write(buf)) await new Promise(resolve => { out.once('drain', resolve); out.once('close', resolve); });
  };
  for (const e of list) {
    const name = Buffer.from(e.name, 'utf8');
    const size = e.data ? e.data.length : fs.statSync(e.file).size;
    const crc = e.data ? zlib.crc32(e.data) >>> 0 : await crcOf(e.file);
    const big = size >= MAX32, at = offset;
    const extra = big ? Buffer.concat([u16(1), u16(16), u64(size), u64(size)]) : Buffer.alloc(0);
    await put(Buffer.concat([u32(0x04034b50), u16(big ? 45 : 20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc),
      u32(big ? MAX32 : size), u32(big ? MAX32 : size), u16(name.length), u16(extra.length), name, extra]));
    if (e.data) await put(e.data);
    else for await (const chunk of fs.createReadStream(e.file)) await put(chunk);
    central.push({ name, crc, size, at });
  }
  const start = offset;
  for (const c of central) {
    const big = c.size >= MAX32 || c.at >= MAX32;
    const extra = big ? Buffer.concat([u16(1), u16(24), u64(c.size), u64(c.size), u64(c.at)]) : Buffer.alloc(0);
    await put(Buffer.concat([u32(0x02014b50), u16(0x031e), u16(big ? 45 : 20), u16(0x0800), u16(0), u16(time), u16(date), u32(c.crc),
      u32(big ? MAX32 : c.size), u32(big ? MAX32 : c.size), u16(c.name.length), u16(extra.length), u16(0), u16(0), u16(0),
      u32(0o100644 << 16), u32(big ? MAX32 : c.at), c.name, extra]));
  }
  const size = offset - start;
  if (start >= MAX32 || central.length >= 0xffff) {
    const end64 = offset;
    await put(Buffer.concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(central.length), u64(central.length), u64(size), u64(start)]));
    await put(Buffer.concat([u32(0x07064b50), u32(0), u64(end64), u32(1)]));
  }
  const n = Math.min(central.length, 0xffff);
  await put(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(n), u16(n), u32(Math.min(size, MAX32)), u32(Math.min(start, MAX32)), u16(0)]));
  out.end();
}

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return b.subarray(0, n);
}

// The files in a zip on disk: [{ name, method, size, packed, at }], at being its local header.
function entries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const total = fs.fstatSync(fd).size;
    const tail = readAt(fd, Math.max(0, total - 65557), Math.min(total, 65557));
    const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (e < 0) throw new Error("It isn't a zip file.");
    let count = tail.readUInt16LE(e + 10), start = tail.readUInt32LE(e + 16);
    if (start === MAX32 || count === 0xffff) {
      // ZIP64: the locator just before the end record says where the real counts are.
      const loc = tail.subarray(e - 20, e);
      if (loc.readUInt32LE(0) !== 0x07064b50) throw new Error('The zip file is damaged.');
      const rec = readAt(fd, Number(loc.readBigUInt64LE(8)), 56);
      count = Number(rec.readBigUInt64LE(32)); start = Number(rec.readBigUInt64LE(48));
    }
    const list = [];
    let pos = start;
    for (let i = 0; i < count; i++) {
      const h = readAt(fd, pos, 46);
      if (h.length < 46 || h.readUInt32LE(0) !== 0x02014b50) throw new Error('The zip file is damaged.');
      const nameLen = h.readUInt16LE(28), extraLen = h.readUInt16LE(30), commentLen = h.readUInt16LE(32);
      const rest = readAt(fd, pos + 46, nameLen + extraLen);
      const ent = { name: rest.subarray(0, nameLen).toString('utf8'), method: h.readUInt16LE(10),
        packed: h.readUInt32LE(20), size: h.readUInt32LE(24), at: h.readUInt32LE(42) };
      // ZIP64 extra field: the 64-bit values, in order, for each one the header marked as too big.
      const extra = rest.subarray(nameLen);
      for (let x = 0; x + 4 <= extra.length; x += 4 + extra.readUInt16LE(x + 2)) {
        if (extra.readUInt16LE(x) !== 1) continue;
        let p = x + 4;
        for (const k of ['size', 'packed', 'at']) if (ent[k] === MAX32) { ent[k] = Number(extra.readBigUInt64LE(p)); p += 8; }
      }
      list.push(ent);
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return list;
  } finally { fs.closeSync(fd); }
}

// A readable stream of one entry's contents.
function open(file, ent) {
  const fd = fs.openSync(file, 'r');
  const h = readAt(fd, ent.at, 30);
  fs.closeSync(fd);
  if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('The zip file is damaged.');
  const start = ent.at + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  if (ent.method !== 0 && ent.method !== 8) throw new Error(`${ent.name} is compressed in a way Studio can't read.`);
  if (!ent.packed) return require('stream').Readable.from([]);
  const raw = fs.createReadStream(file, { start, end: start + ent.packed - 1 });
  // pipeline, not pipe, so a file that can't be read fails the stream handed back (which has a listener) and
  // isn't left as an error on raw that nothing listens to, which would end the helper.
  return ent.method === 8 ? require('stream').pipeline(raw, zlib.createInflateRaw(), () => {}) : raw;
}

module.exports = { write, entries, open };
