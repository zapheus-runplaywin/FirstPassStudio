// FirstPass Studio - the fonts a competition's graphics can use.
//
// Three kinds, all picked from the Font box on the Competitions setup page:
//   Bundled: open licence fonts that ship with Studio in public/vendor/fonts/<id>/, so they work
//     with no internet and on any computer. `npm run fonts` fetches them from Fontsource (the
//     same files as Google Fonts) and writes each one's <id>.css; add a font to BUNDLED first.
//   On this Mac: any font installed on the Mac Studio runs on (macFonts). Nothing is copied:
//     a page opened on another computer falls back to Montserrat.
//   Added: font files added to a competition on the setup page (competitions/<id>/fonts/).
//     They travel with the competition's template file.
// Whatever is picked, Montserrat comes next in the font list, for any letter the font lacks.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Font name -> Fontsource id (its folder in public/vendor/fonts/).
const BUNDLED = {
  'Montserrat': 'montserrat',
  'Raleway': 'raleway',
};
const FALLBACK = 'Montserrat';
const VENDOR = path.join(__dirname, 'public', 'vendor', 'fonts');
const FILE = /\.(woff2|woff|ttf|otf)$/i;

const bundledCss = name => BUNDLED[name] ? `/vendor/fonts/${BUNDLED[name]}/${BUNDLED[name]}.css` : null;

// A font name safe to put in CSS (quotes, semicolons and braces would break theme.css).
function cleanName(name) {
  const s = String(name || '').replace(/[^\p{L}\p{N} .,'&+()-]/gu, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 80);
}

// ─── Added font files ────────────────────────────────────────────────────────
// A font file's family, weight and style from its name, the way font files are usually named:
// "Gotham-BoldItalic.otf", "Bebas Neue Regular.ttf", "Inter-VariableFont_opsz,wght.ttf".
const WEIGHTS = [[/(extra|ultra)[ -]?light/, 200], [/(semi|demi)[ -]?bold/, 600], [/(extra|ultra)[ -]?bold/, 800],
  [/thin|hairline/, 100], [/light/, 300], [/medium/, 500], [/bold/, 700], [/black|heavy/, 900], [/regular|normal|book|roman/, 400]];
const STYLE_WORD = /^(thin|hairline|extra|ultra|semi|demi|light|regular|normal|book|roman|medium|bold|black|heavy|italic|oblique|variable|var|variablefont|vf|extralight|ultralight|semibold|demibold|extrabold|ultrabold|bolditalic|lightitalic|mediumitalic|blackitalic|wght|ital|opsz|wdth)$/i;
function fontFile(file) {
  const base = path.basename(file).replace(FILE, '');
  let family, style;
  const cut = base.search(/[-_]/);
  if (cut > 0) { family = base.slice(0, cut); style = base.slice(cut + 1); }
  else {
    const words = base.split(/\s+/);
    let i = words.length;
    while (i > 1 && STYLE_WORD.test(words[i - 1])) i--;
    family = words.slice(0, i).join(' '); style = words.slice(i).join(' ');
  }
  family = cleanName(family.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')) || 'Added font';
  const s = style.toLowerCase();
  const variable = /variable|\[|wght|(^|[^a-z])vf([^a-z]|$)/.test(s);
  const weight = variable ? '100 900' : (WEIGHTS.find(([re]) => re.test(s)) || [null, 400])[1];
  return { file: path.basename(file), family, weight, italic: /italic|oblique/.test(s) };
}
// The families among a competition's font files.
const families = files => [...new Set(files.filter(f => FILE.test(f)).map(f => fontFile(f).family))].sort((a, b) => a.localeCompare(b));

const FORMAT = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
// @font-face rules for the files of one family; url(file) gives each file's link.
function faces(family, files, url) {
  return files.filter(f => FILE.test(f)).map(fontFile).filter(f => f.family === family).map(f =>
    `@font-face { font-family: "${f.family}"; font-style: ${f.italic ? 'italic' : 'normal'}; font-weight: ${f.weight}; font-display: block; ` +
    `src: url("${url(f.file)}") format("${FORMAT[f.file.split('.').pop().toLowerCase()]}"); }`).join('\n');
}

// The CSS that loads a font: Montserrat (the fallback) and the font itself, from Studio's own
// files. Imports come first, as CSS needs them.
function css(font, files = [], url = f => '/fonts/' + encodeURIComponent(f)) {
  font = cleanName(font) || FALLBACK;
  const imports = [...new Set([bundledCss(FALLBACK), bundledCss(font)].filter(Boolean))].map(u => `@import url("${u}");`);
  const own = BUNDLED[font] ? '' : faces(font, files, url);
  return [...imports, own].filter(Boolean).join('\n');
}
const stack = font => `"${cleanName(font) || FALLBACK}", "${FALLBACK}", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;

// ─── Fonts on this Mac ───────────────────────────────────────────────────────
// The font families installed on the Mac, from AppKit (through JavaScript for Automation, which
// every Mac has). Asked once, then kept; empty on anything but a Mac.
let mac = null;
function macFonts() {
  if (process.platform !== 'darwin') return Promise.resolve([]);
  if (mac) return mac;
  mac = new Promise(resolve => execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
    "ObjC.import('AppKit'); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))"],
  { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    let list = [];
    try { if (!err) list = JSON.parse(out); } catch { /* not JSON */ }
    list = [...new Set((Array.isArray(list) ? list : []).filter(f => typeof f === 'string' && f && !f.startsWith('.')).map(cleanName))]
      .filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (!list.length) mac = null;   // ask again next time
    resolve(list);
  }));
  return mac;
}

module.exports = { BUNDLED, FALLBACK, VENDOR, FILE, bundled: () => Object.keys(BUNDLED), cleanName, fontFile, families, faces, css, stack, macFonts };
