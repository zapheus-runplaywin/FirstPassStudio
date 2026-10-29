// Fetches the fonts Studio bundles (fonts.js BUNDLED, and TEMPLATE_FONTS for the Socials template sets) from
// Fontsource into public/vendor/fonts/<id>/: the Latin woff2 files, the licence and <id>.css, which the graphics load
// through theme.css (social.html loads a template font's own <id>.css).
//
// Run:  npm run fonts                 (every bundled font)
//       npm run fonts -- raleway      (one, by its Fontsource id)
// Takes the newest version of each. A font with a variable version gets it (one file per style
// covers every weight); one without gets its weights 400 to 900, upright and italic. Template fonts are upright only.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { BUNDLED, TEMPLATE_FONTS, VENDOR } = require('../../fonts');

const SUBSETS = ['latin', 'latin-ext'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function pack(name, dir) {
  try {
    const file = execFileSync(npm, ['pack', `${name}@latest`, '--silent'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop();
    const out = path.join(dir, name.replace(/[@/]/g, '_'));
    fs.mkdirSync(out);
    execFileSync('tar', ['xzf', path.join(dir, file), '-C', out]);
    return path.join(out, 'package');
  } catch { return null; }
}

// The @font-face rules of the Latin subsets in a Fontsource CSS file, named as Studio names the
// font (Fontsource calls variable ones "<name> Variable"), with woff2 files only.
function latinFaces(cssText, name, id) {
  return (cssText.match(/\/\*[^*]*\*\/\s*@font-face\s*{[^}]*}/g) || [])
    .filter(block => SUBSETS.some(s => new RegExp(`^/\\* ${id}-${s}-(\\d+|wght)-`).test(block)))
    .map(block => block.replace(/font-family:\s*'[^']*';/, `font-family: '${name}';`)
      .replace(/font-display:\s*\w+;/, 'font-display: block;')
      .replace(/src:\s*url\(\.\/files\/([^)]+\.woff2)\)\s*format\('([\w-]+)'\)[^;]*;/, "src: url($1) format('$2');"));
}

function fetchFont(name, id, tmp, italic = true) {
  let pkg = pack(`@fontsource-variable/${id}`, tmp), sheets;
  if (pkg) sheets = italic ? ['index.css', 'wght-italic.css'] : ['index.css'];
  else {
    pkg = pack(`@fontsource/${id}`, tmp);
    if (!pkg) throw new Error(`Fontsource has no ${id}`);
    sheets = [400, 500, 600, 700, 800, 900].flatMap(w => (italic ? [`${w}.css`, `${w}-italic.css`] : [`${w}.css`]));
  }
  const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
  const blocks = sheets.filter(s => fs.existsSync(path.join(pkg, s))).flatMap(s => latinFaces(fs.readFileSync(path.join(pkg, s), 'utf8'), name, id));
  if (!blocks.length) throw new Error(`No Latin files for ${id}`);
  const to = path.join(VENDOR, id);
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const b of blocks) {
    const file = b.match(/url\(([^)]+\.woff2)\)/)[1];
    fs.copyFileSync(path.join(pkg, 'files', file), path.join(to, file));
  }
  fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(to, 'LICENSE'));
  fs.writeFileSync(path.join(to, `${id}.css`), `/* ${name}, ${path.basename(path.dirname(pkg)).startsWith('_fontsource-variable') ? 'variable' : 'static'} ` +
    `Fontsource ${version} (Latin). Fetched by vendor/fonts/fetch.js; licence in LICENSE. */\n` +
    blocks.join('\n\n') + '\n');
  console.log(`${name}: ${blocks.length} files from ${path.basename(path.dirname(pkg))} ${version}`);
}

const only = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fonts-'));
try {
  for (const [name, id] of Object.entries(BUNDLED)) if (!only.length || only.includes(id)) fetchFont(name, id, tmp);
  for (const [name, id] of Object.entries(TEMPLATE_FONTS)) if (!only.length || only.includes(id)) fetchFont(name, id, tmp, false);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
