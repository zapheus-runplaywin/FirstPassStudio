// FirstPass Studio - files the Mac app keeps outside its archive.
//
// The app's code is packed into one archive (app.asar; package.json build.asar) whose contents
// macOS checks against the app's signature at every start. A few files can't live in it: a program
// Studio runs (vendor/ffmpeg), a native module it loads (native/*.node) and a file it hands to
// another app (the Stream Deck plugin). electron-builder leaves those beside the archive, in
// app.asar.unpacked (build.asarUnpack), and this turns a path inside the archive into that one.
// From a checkout nothing is packed and the path comes back unchanged.

'use strict';

function unpacked(p) {
  return String(p).replace(/\.asar(?=[\\/]|$)/, '.asar.unpacked');
}

module.exports = { unpacked };
