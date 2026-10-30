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
//
// The graphics were drawn with Montserrat, so every other font is made to measure like it
// (normalise): its capitals are scaled to Montserrat's cap height (size-adjust) and its line
// box to Montserrat's (ascent, descent and line gap overrides). Text then fills its box and
// sits centred in it the way Montserrat does, whichever font is picked. Bundled fonts and added
// font files are measured from their files; a Mac font is measured by the Mac (macFaces).

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

// Font name -> Fontsource id (its folder in public/vendor/fonts/).
const BUNDLED = {
  'Montserrat': 'montserrat',
  'Raleway': 'raleway',
};
// The faces the Socials tab's template sets draw their titles, names and numbers in (social.html), bundled the same way
// (npm run fonts) so they work with no internet, but not offered in the Font box: everything else stays in the
// competition's font.
const TEMPLATE_FONTS = {
  'Fredoka': 'fredoka', 'Anton': 'anton', 'Bungee': 'bungee', 'IBM Plex Sans': 'ibm-plex-sans',
  'Teko': 'teko', 'Archivo Black': 'archivo-black', 'Sora': 'sora', 'Oswald': 'oswald', 'Yellowtail': 'yellowtail',
};
const FALLBACK = 'Montserrat';
const VENDOR = path.join(__dirname, 'public', 'vendor', 'fonts');
const FILE = /\.(woff2|woff|ttf|otf)$/i;

const bundledCss = name => BUNDLED[name] ? `/vendor/fonts/${BUNDLED[name]}/${BUNDLED[name]}.css` : null;

// ─── Measuring a font ────────────────────────────────────────────────────────
// The tables of a TTF, OTF, WOFF or WOFF2 file (the first font of a collection), each read when asked for.
const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG',
  'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar',
  'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
// Fonts are added from anyone allowed to change things and measured on the helper's one thread, so a table that
// unpacks to more than this (far past any real font) is refused rather than unpacked: a small file could otherwise
// unpack to gigabytes and stall every graphic while it did.
const MAX_UNPACKED = 64 * 1024 * 1024;
function fontTables(buf) {
  const sig = buf.toString('latin1', 0, 4), out = {};
  if (sig === 'wOFF') {
    for (let i = 0, n = buf.readUInt16BE(12); i < n; i++) {
      const at = 44 + i * 20, off = buf.readUInt32BE(at + 4), comp = buf.readUInt32BE(at + 8), orig = buf.readUInt32BE(at + 12);
      const data = buf.subarray(off, off + comp);
      out[buf.toString('latin1', at, at + 4)] = () => {
        if (comp >= orig) return data;
        if (orig > MAX_UNPACKED) throw new Error('Font table too big');
        return zlib.inflateSync(data, { maxOutputLength: MAX_UNPACKED });
      };
    }
  } else if (sig === 'wOF2') {
    if (buf.toString('latin1', 4, 8) === 'ttcf') return out;
    let at = 48, all = null, off = 0;
    const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[at++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } throw new Error('Bad WOFF2'); };
    const dir = [];
    for (let i = 0, n = buf.readUInt16BE(12); i < n; i++) {
      const flags = buf[at++];
      let tag = WOFF2_TAGS[flags & 0x3f];
      if ((flags & 0x3f) === 0x3f) { tag = buf.toString('latin1', at, at + 4); at += 4; }
      const length = base128(), version = flags >> 6, transformed = (tag === 'glyf' || tag === 'loca') ? version === 0 : version !== 0;
      dir.push({ tag, transformed, length: transformed ? base128() : length });
    }
    const data = buf.subarray(at, at + buf.readUInt32BE(20));
    if (buf.readUInt32BE(16) > MAX_UNPACKED) throw new Error('Font too big');   // totalSfntSize: what it says it unpacks to
    for (const { tag, length, transformed } of dir) {
      const from = off; off += length;
      out[tag] = () => (all = all || zlib.brotliDecompressSync(data, { maxOutputLength: MAX_UNPACKED })).subarray(from, from + length);
      if (transformed) out[tag].transformed = true;
    }
  } else {
    const base = sig === 'ttcf' ? buf.readUInt32BE(12) : 0;
    for (let i = 0, n = buf.readUInt16BE(base + 4); i < n; i++) {
      const at = base + 12 + i * 16, off = buf.readUInt32BE(at + 8);
      out[buf.toString('latin1', at, at + 4)] = () => buf.subarray(off, off + buf.readUInt32BE(at + 12));
    }
  }
  return out;
}
// The glyph of a character, from the font's Unicode cmap (format 4 or 12), or 0.
function glyphOf(cmap, code) {
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const at = 4 + i * 8, platform = cmap.readUInt16BE(at), encoding = cmap.readUInt16BE(at + 2), sub = cmap.readUInt32BE(at + 4);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = cmap.readUInt16BE(sub);
    if (format === 4) {
      const segs = cmap.readUInt16BE(sub + 6) / 2, ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
      for (let k = 0; k < segs; k++) {
        if (cmap.readUInt16BE(ends + k * 2) < code) continue;
        const start = cmap.readUInt16BE(starts + k * 2), delta = cmap.readUInt16BE(deltas + k * 2), range = cmap.readUInt16BE(ranges + k * 2);
        if (start > code) break;
        if (!range) return (code + delta) & 0xffff;
        const g = cmap.readUInt16BE(ranges + k * 2 + range + (code - start) * 2);
        return g ? (g + delta) & 0xffff : 0;
      }
    } else if (format === 12) {
      for (let k = 0, groups = cmap.readUInt32BE(sub + 12); k < groups; k++) {
        const g = sub + 16 + k * 12;
        if (code >= cmap.readUInt32BE(g) && code <= cmap.readUInt32BE(g + 4)) return cmap.readUInt32BE(g + 8) + code - cmap.readUInt32BE(g);
      }
    }
  }
  return 0;
}
// How wide a font's capitals are: the average width of A to Z, as a fraction of its size.
const CAPS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function capsWidth(t, em, hhea) {
  if (!t.cmap || !t.hmtx) return null;
  const cmap = t.cmap(), hmtx = t.hmtx(), metrics = hhea.readUInt16BE(34);
  const widths = t.hmtx.transformed ? 1 : 0, step = widths ? 2 : 4;   // a WOFF2 hmtx can be just the advances, after a flags byte
  const advance = g => hmtx.readUInt16BE(widths + Math.min(g, metrics - 1) * step);
  const found = [...CAPS].map(c => glyphOf(cmap, c.charCodeAt(0))).filter(Boolean);
  return found.length === CAPS.length ? found.reduce((sum, g) => sum + advance(g), 0) / found.length / em : null;
}
// A font's cap height, line box (ascent, descent, line gap, the hhea ones, which the Mac uses; the
// overrides make every computer agree) and capitals' width, as fractions of its size, or null.
function fileMetrics(buf) {
  try {
    const t = fontTables(buf);
    if (!t.head || !t.hhea || !t['OS/2']) return null;
    const head = t.head(), hhea = t.hhea(), os2 = t['OS/2']();
    const em = head.readUInt16BE(18);
    if (!em || os2.readUInt16BE(0) < 2 || os2.length < 90) return null;   // older fonts don't say their cap height
    let width = null;
    try { width = capsWidth(t, em, hhea); } catch { /* sized by cap height alone */ }
    return { capHeight: os2.readInt16BE(88) / em, ascent: hhea.readInt16BE(4) / em, descent: -hhea.readInt16BE(6) / em, lineGap: hhea.readInt16BE(8) / em, capsWidth: width };
  } catch { return null; }
}
// Measured once per file (and again when it changes).
const measured = new Map();
function metricsOf(file) {
  try {
    const st = fs.statSync(file), key = `${file}|${st.size}|${st.mtimeMs}`;
    if (!measured.has(key)) measured.set(key, fileMetrics(fs.readFileSync(file)));
    return measured.get(key);
  } catch { return null; }
}
// Montserrat's measurements, which every other font is made to match.
const reference = () => metricsOf(path.join(VENDOR, 'montserrat', 'montserrat-latin-wght-normal.woff2')) ||
  { capHeight: 0.7, ascent: 0.968, descent: 0.251, lineGap: 0, capsWidth: 0.705 };
// A narrow font looks small with capitals only as tall as Montserrat's (a wide font), so a family
// whose capitals are narrower stands taller, by the cube root of how much narrower, up to a fifth.
// Measured on the family's face nearest Regular; faces: [{ weight, metrics }].
function narrowBoost(faces) {
  const shape = m => m && m.capsWidth > 0 && m.capHeight > 0 ? m.capsWidth / m.capHeight : null;
  const fromRegular = f => Math.abs((typeof f.weight === 'number' ? f.weight : 400) - 400);
  const face = faces.filter(f => shape(f.metrics)).sort((a, b) => fromRegular(a) - fromRegular(b))[0];
  const ref = shape(reference());
  return face && ref ? Math.min(1.2, Math.max(1, Math.cbrt(ref / shape(face.metrics)))) : 1;
}
// The @font-face descriptors that make a font with these measurements measure like Montserrat:
// capitals as tall as Montserrat's (times size: the narrow font boost and the setup's Text size),
// centred in a line box as tall as Montserrat's, as Montserrat's are. size-adjust scales the
// overrides too, so they're divided by it.
function normalise(m, size = 1) {
  if (!m || !(m.capHeight > 0.3 && m.capHeight < 1.2)) return '';
  const ref = reference(), scale = Math.min(2, Math.max(0.5, ref.capHeight * size / m.capHeight));
  const extra = (m.capHeight * scale - ref.capHeight) / 2;   // taller capitals grow the same both ways
  const pc = v => `${+(v / scale * 100).toFixed(2)}%`;
  return `size-adjust: ${+(scale * 100).toFixed(2)}%; ascent-override: ${pc(ref.ascent + extra)}; descent-override: ${pc(Math.max(0, ref.descent - extra))}; ` +
    `line-gap-override: ${pc(ref.lineGap)}; `;
}

// A bundled font's own @font-face rules (vendor/fonts/fetch.js writes them), normalised.
function bundledFaces(name, size) {
  const id = BUNDLED[name], dir = path.join(VENDOR, id);
  let text;
  try { text = fs.readFileSync(path.join(dir, `${id}.css`), 'utf8'); } catch { return `@import url("${bundledCss(name)}");`; }
  const blocks = (text.match(/@font-face\s*{[^}]*}/g) || []).map(block => {
    const file = (block.match(/url\(['"]?([^)'"]+)['"]?\)/) || [])[1];
    return { block, file, weight: Number((block.match(/font-weight:\s*(\d+);/) || [])[1]) || null, metrics: file ? metricsOf(path.join(dir, path.basename(file))) : null };
  });
  size *= narrowBoost(blocks);
  return blocks.map(({ block, file, metrics }) => !file ? block : block.replace(/url\(['"]?[^)'"]+['"]?\)/, `url("/vendor/fonts/${id}/${file}")`)
    .replace(/\s*}$/, `\n  ${normalise(metrics, size).trim()}\n}`).replace(/\n  \n}$/, '\n}')).join('\n');
}

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
// @font-face rules for the files of one family, normalised; url(file) gives each file's link.
// files may be full paths (then each is measured) or just file names.
function faces(family, files, url, size = 1) {
  const list = files.filter(f => FILE.test(f)).map(f => ({ ...fontFile(f), metrics: path.isAbsolute(f) ? metricsOf(f) : null })).filter(f => f.family === family);
  size *= narrowBoost(list);
  return list.map(f =>
    `@font-face { font-family: "${f.family}"; font-style: ${f.italic ? 'italic' : 'normal'}; font-weight: ${f.weight}; font-display: block; ` +
    `src: url("${url(f.file)}") format("${FORMAT[f.file.split('.').pop().toLowerCase()]}"); ${normalise(f.metrics, size)}}`).join('\n');
}

// A Mac font's faces under its own name (alias), each found by its PostScript name and
// normalised. The real family comes next in the font list, in case one isn't found.
const alias = font => `Studio ${font}`;
function macFontFaces(font, mac, size) {
  size *= narrowBoost(mac.map(f => ({ weight: f.weight, metrics: f })));
  return mac.map(f => `@font-face { font-family: "${alias(font)}"; font-style: ${f.italic ? 'italic' : 'normal'}; font-weight: ${f.weight}; ` +
    `font-display: block; src: local("${f.name}"); ${normalise(f, size)}}`).join('\n');
}

// The CSS that loads a font: Montserrat (the fallback) and the font itself, from Studio's own
// files, normalised. mac is the font's faces from macFaces, when it's a Mac font; size the setup's
// Text size (1 = capitals as tall as Montserrat's). Imports come first, as CSS needs them.
function css(font, files = [], url = f => '/fonts/' + encodeURIComponent(path.basename(f)), { mac = null, size = 1 } = {}) {
  font = cleanName(font) || FALLBACK;
  const own = font === FALLBACK ? '' : BUNDLED[font] ? bundledFaces(font, size) : mac && mac.length ? macFontFaces(font, mac, size) : faces(font, files, url, size);
  return [`@import url("${bundledCss(FALLBACK)}");`, own].filter(Boolean).join('\n');
}
const stack = (font, mac = null) => {
  font = cleanName(font) || FALLBACK;
  return `${mac && mac.length ? `"${alias(font)}", ` : ''}"${font}", "${FALLBACK}", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
};

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

// A Mac font's faces, measured by the Mac: [{ name (PostScript), weight, italic, capHeight,
// ascent, descent, lineGap, capsWidth }]. Asked once per font, then kept; empty when it's not a Mac font
// (or not on a Mac). AppKit's weights run 0 to 15, 5 regular and 9 bold. Condensed and wide faces
// only fill a weight the family has no normal width face for.
const macFamilies = new Map();
const MAC_WEIGHT = w => w <= 2 ? 100 : w <= 3 ? 200 : w <= 4 ? 300 : w <= 5 ? 400 : w <= 7 ? 500 : w <= 8 ? 600 : w <= 9 ? 700 : w <= 10 ? 800 : 900;
const WIDTH_TRAITS = 16 | 32 | 64 | 512;   // narrow, expanded, condensed, compressed
function macFaces(font) {
  font = cleanName(font);
  if (process.platform !== 'darwin' || !font || font === FALLBACK || BUNDLED[font]) return Promise.resolve([]);
  if (macFamilies.has(font)) return macFamilies.get(font);
  const asked = new Promise(resolve => execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
    "function run(argv) { ObjC.import('AppKit'); const members = ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableMembersOfFontFamily(argv[0])) || [];" +
    " return JSON.stringify(members.map(m => { const f = $.NSFont.fontWithNameSize(m[0], 1000);" +
    " if (f.isNil()) return null; let w = null;" +
    " try { w = 0; for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') w += f.advancementForGlyph(f.glyphWithName(c)).width; w = w / 26000 || null; } catch (e) { w = null; }" +
    " return { name: m[0], weight: m[2], traits: m[3], capHeight: f.capHeight / 1000, ascent: f.ascender / 1000, descent: -f.descender / 1000, lineGap: f.leading / 1000, capsWidth: w }; }).filter(Boolean)); }",
    font], { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, out) => {
    let list = [];
    try { if (!err) list = JSON.parse(out); } catch { /* not JSON */ }
    const seen = new Set(), faces = [];
    for (const m of (Array.isArray(list) ? list : []).sort((a, b) => ((a.traits & WIDTH_TRAITS) ? 1 : 0) - ((b.traits & WIDTH_TRAITS) ? 1 : 0))) {
      const face = { name: String(m.name).replace(/["\\]/g, ''), weight: MAC_WEIGHT(m.weight), italic: !!(m.traits & 1),
        capHeight: m.capHeight, ascent: m.ascent, descent: m.descent, lineGap: Math.max(0, m.lineGap || 0), capsWidth: m.capsWidth };
      const key = `${face.weight}${face.italic}`;
      if (face.name && !seen.has(key)) { seen.add(key); faces.push(face); }
    }
    resolve(faces);
  }));
  macFamilies.set(font, asked);
  return asked;
}

module.exports = { BUNDLED, TEMPLATE_FONTS, FALLBACK, VENDOR, FILE, bundled: () => Object.keys(BUNDLED), cleanName, fontFile, families, faces, css, stack, macFonts, macFaces, fileMetrics, normalise, narrowBoost };
