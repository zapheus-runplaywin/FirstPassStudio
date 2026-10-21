// The Mac app packs only the files listed in package.json's build.files, so every local module Studio
// or the app loads must be listed: a missing one stops Studio starting before it can write to the log.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const files = require('../package.json').build.files;
const packed = rel => files.some(f => f === rel || (f.endsWith('/**/*') && rel.startsWith(f.slice(0, -4))));

test('every local module that Studio and the Mac app load is packed into the app', () => {
  const seen = new Set();
  const visit = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    assert.ok(packed(rel), `${rel} is loaded but not listed in package.json build.files, so the Mac app would fail to start`);
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const [, dep] of src.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
      let next = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, rel)), dep));
      if (!next.endsWith('.js') && !next.endsWith('.json') && !next.endsWith('.node')) next += '.js';
      if (next.endsWith('.js') && fs.existsSync(path.join(ROOT, next))) visit(next.split(path.sep).join('/'));
    }
  };
  visit('server.js');
  visit(require('../package.json').main);
  assert.ok(seen.has('sequences.js'));
});

// Files the Mac app workflow builds before packing (they aren't in the repository), with the
// workflow step that makes each one.
const BUILT = {
  'vendor/ffmpeg/ffmpeg': 'vendor/ffmpeg/build.sh',
  'native/decklink/build/Release/decklink.node': 'working-directory: native/decklink',
  'native/ndi/build/Release/ndi.node': 'working-directory: native/ndi',
  'plugins/studio-deck/dist/com.runplaywin.firstpass-studio.streamDeckPlugin': 'working-directory: plugins/studio-deck',
};

test('every file listed in build.files is in the repository or built by the Mac app workflow', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'mac-app.yml'), 'utf8');
  for (const f of files) {
    if (f.endsWith('/**/*')) {
      const dir = path.join(ROOT, f.slice(0, -5));
      assert.ok(fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory(), `build.files lists ${f}, but ${f.slice(0, -5)} is not a folder`);
      continue;
    }
    if (BUILT[f]) {
      assert.ok(workflow.includes(BUILT[f]), `build.files lists ${f}, built by "${BUILT[f]}", but the Mac app workflow no longer has that step`);
      continue;
    }
    assert.ok(fs.existsSync(path.join(ROOT, f)), `build.files lists ${f}, which is not in the repository`);
  }
});

test('the files Studio reads next to itself at run time are packed', () => {
  for (const rel of ['config.json', 'package.json', 'public/graphics.html', 'public/output.html', 'public/studio.css', 'desktop/splash.html', 'desktop/offair.html',
    'desktop/trayTemplate.png', 'desktop/trayTemplate@2x.png', ...Object.keys(BUILT)]) {
    assert.ok(packed(rel), `${rel} is used by Studio but not listed in package.json build.files`);
  }
  // Any other file the desktop code opens from its own folder.
  for (const name of fs.readdirSync(path.join(ROOT, 'desktop')).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, 'desktop', name), 'utf8');
    for (const [, file] of src.matchAll(/path\.join\(__dirname, '([^']+)'\)/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'desktop', file)), `desktop/${name} opens desktop/${file}, which is missing`);
    }
  }
});

// Each page's scripts, styles and images, so a renamed or deleted file can't leave a page broken.
// /theme.css, /api/... and the competition's own images are made by server.js, not files.
test('every script, stylesheet and image a page links to exists', () => {
  const made = /^(\/?theme\.css$|\/api\/|\/deck\/|\/(logos|brand|photos|media)\/)/;
  const missing = [];
  for (const dir of ['public', 'desktop']) {
    for (const page of fs.readdirSync(path.join(ROOT, dir)).filter(n => n.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(ROOT, dir, page), 'utf8');
      for (const [, ref] of src.matchAll(/\b(?:src|href)=["']([^"'#?]+)/g)) {
        if (/^[a-z]+:/i.test(ref) || ref.includes('${') || made.test(ref)) continue;
        const file = ref.startsWith('/') ? path.join(ROOT, 'public', ref) : path.join(ROOT, dir, ref);
        if (!fs.existsSync(file)) missing.push(`${dir}/${page} links to ${ref}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
