// FirstPass Studio - files people add (logos, photos, sponsor logos, fonts, media), served back safely.
//
// Every added file is served from Studio's own address, so a file that a browser would run as a
// page (an SVG with a script in it, an HTML file renamed .png) would run as Studio, with every
// link Studio's own pages have. Two guards: SERVE_HEADERS go on every response that serves an
// added file, so the browser treats it as a plain file and never as a page of Studio's; and
// checkImage() refuses an image whose first bytes don't match its name, when it is added. Only
// Matt adds files today; a competition template shared between associations carries logos too.

'use strict';

// sandbox: the file gets an origin of its own, so a script inside it can't reach Studio.
// default-src 'none': nothing in it may load anything else. nosniff: the type Studio says is final.
const SERVE_HEADERS = Object.freeze({
  'content-security-policy': "sandbox; default-src 'none'",
  'x-content-type-options': 'nosniff',
});

const starts = (buf, bytes, at = 0) => buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b);
const SIGNATURES = {
  png: buf => starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: buf => starts(buf, [0xff, 0xd8, 0xff]),
  jpeg: buf => starts(buf, [0xff, 0xd8, 0xff]),
  gif: buf => starts(buf, [0x47, 0x49, 0x46, 0x38]) && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61,
  webp: buf => starts(buf, [0x52, 0x49, 0x46, 0x46]) && starts(buf, [0x57, 0x45, 0x42, 0x50], 8),
  // An XML document whose root is <svg>, allowing a BOM, an XML declaration, comments and a doctype first.
  svg: buf => /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buf.subarray(0, 4096).toString('utf8')),
};

// Whether buf starts like the image its file name says it is. Names with other extensions pass
// (fonts, videos and songs are checked by what reads them).
function looksLikeImage(name, buf) {
  const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  const check = ext && SIGNATURES[ext[1]];
  return check ? check(buf) : true;
}

// Throws a plain message when the bytes aren't the image the name says.
function checkImage(name, buf) {
  if (!looksLikeImage(name, buf)) {
    const ext = String(name).split('.').pop().toUpperCase();
    throw new Error(`${name} isn't a ${ext} file inside (its first bytes don't match). Export it again from the image program, or rename it to what it really is.`);
  }
}

module.exports = { SERVE_HEADERS, looksLikeImage, checkImage };
