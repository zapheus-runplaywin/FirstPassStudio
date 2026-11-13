// The Mac app packs only the files listed in package.json's build.files, so every local module Studio
// or the app loads must be listed: a missing one stops Studio starting before it can write to the log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const ROOT = path.join(import.meta.dirname, '..');
const files = pkg.build.files;
const packed = (rel: string) => files.some(f => f === rel || (f.endsWith('/**/*') && rel.startsWith(f.slice(0, -4))) || (f.includes('*') && path.matchesGlob(rel, f)));

test('every local module that Studio and the Mac app load is packed into the app', () => {
  const seen = new Set<string>();
  const visit = (rel: string) => {
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
  visit('out/server.js'); // compiled from server.ts (npm run build)
  visit(pkg.main);
  assert.ok(seen.has('out/sequences.js'));
});

// Files the Mac app workflow builds before packing (they aren't in the repository), with the
// workflow step that makes each one.
const BUILT: Record<string, string> = {
  'vendor/ffmpeg/ffmpeg': 'vendor/ffmpeg/build.sh',
  'native/decklink/build/Release/decklink.node': 'working-directory: native/decklink',
  'native/ndi/build/Release/ndi.node': 'working-directory: native/ndi',
  'plugins/studio-deck/dist/com.runplaywin.firstpass-studio.streamDeckPlugin': 'working-directory: plugins/studio-deck',
};

test('every file listed in build.files is in the repository or built by the Mac app workflow', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'mac-app.yml'), 'utf8');
  for (const f of files) {
    if (f.startsWith('!')) continue; // files left out
    // The code, compiled from TypeScript (npm run build): built by the workflow before packing.
    if (f.startsWith('out/')) { assert.ok(workflow.includes('run: npm run build'), `build.files lists ${f}, but the Mac app workflow no longer runs npm run build`); continue; }
    if (f.endsWith('/**/*')) {
      const dir = path.join(ROOT, f.slice(0, -5));
      assert.ok(fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory(), `build.files lists ${f}, but ${f.slice(0, -5)} is not a folder`);
      continue;
    }
    if (f.includes('*')) { // a pattern such as docs/user-guide/img/*.{webp,svg}: it must still pick out files
      const dir = f.slice(0, f.lastIndexOf('/'));
      const names = fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)) : [];
      assert.ok(names.some(n => path.matchesGlob(`${dir}/${n}`, f)), `build.files lists ${f}, which matches no file in the repository`);
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
  for (const rel of ['config.json', 'captionprices.json', 'package.json', 'public/output.html', 'public/studio.css', 'desktop/splash.html', 'desktop/offair.html',
    'desktop/trayTemplate.png', 'desktop/trayTemplate@2x.png', ...Object.keys(BUILT)]) {
    assert.ok(packed(rel), `${rel} is used by Studio but not listed in package.json build.files`);
  }
  // Any other file the desktop code opens from its own folder, or that the Mac app workflow makes there.
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'mac-app.yml'), 'utf8');
  const builtHere: Record<string, string> = { 'whatsnew.json': '> desktop/whatsnew.json' };
  for (const name of fs.readdirSync(path.join(ROOT, 'desktop')).filter(n => n.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(ROOT, 'desktop', name), 'utf8');
    for (const [, file] of src.matchAll(/path\.join\(APP_DIR, 'desktop', '([^']+)'\)/g)) {
      if (builtHere[file]) assert.ok(workflow.includes(builtHere[file]), `desktop/${name} opens desktop/${file}, but the Mac app workflow no longer makes it`);
      else assert.ok(fs.existsSync(path.join(ROOT, 'desktop', file)), `desktop/${name} opens desktop/${file}, which is missing`);
    }
    // Beside itself (import.meta.dirname, out/desktop/ once compiled) there is only the rest of the compiled desktop code.
    for (const [, file] of src.matchAll(/path\.join\(import.meta.dirname, '([^']+)'\)/g)) {
      assert.ok(/\.js$/.test(file) && fs.existsSync(path.join(ROOT, 'desktop', file.replace(/\.js$/, '.ts'))), `desktop/${name} opens ${file} beside its compiled self, which isn't compiled from desktop/`);
    }
  }
});

// Each page's scripts, styles and images, so a renamed or deleted file can't leave a page broken.
// /theme.css, /api/... and the competition's own images are made by server.ts, not files.
test('every script, stylesheet and image a page links to exists', () => {
  const made = /^(\/?theme\.css$|\/api\/|\/deck\/|\/(logos|brand|photos|media|guide)\/)/;
  const missing = [];
  for (const dir of ['public', 'desktop']) {
    for (const page of fs.readdirSync(path.join(ROOT, dir)).filter(n => n.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(ROOT, dir, page), 'utf8');
      for (const [, ref] of src.matchAll(/\b(?:src|href)=["']([^"'#?]+)/g)) {
        if (/^[a-z]+:/i.test(ref) || ref.includes('${') || made.test(ref)) continue;
        const file = ref.startsWith('/') ? path.join(ROOT, 'public', ref) : path.join(ROOT, dir, ref);
        // A page script written in TypeScript is public/<name>.ts, served compiled as <name>.js.
        if (!fs.existsSync(file) && !(dir === 'public' && fs.existsSync(file.replace(/\.js$/, '.ts')))) missing.push(`${dir}/${page} links to ${ref}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
