// The Mac app's hardening (package.json build, build/entitlements.mac.plist, unpacked.js): the code is one
// signed archive (asar) with the fuses that stop the app being run as a plain Node, the entitlements are the
// least it needs, and everything that must run or load from disk points at the copy unpacked beside the archive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { build } = require('../package.json');
const { unpacked } = require('../unpacked');

// Does an asarUnpack pattern cover this file? "**" is any run of folders (or none), "*" is within one name.
function globToRegExp(glob) {
  const parts = glob.split('/');
  const out = parts.map((part, i) => {
    const last = i === parts.length - 1;
    if (part === '**') return last ? '.+' : '(?:.+/)?';
    return part.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + (last ? '' : '/');
  });
  return new RegExp('^' + out.join('') + '$');
}
const covered = rel => build.asarUnpack.some(g => globToRegExp(g).test(rel));

test('globToRegExp reads the patterns the way electron-builder does', () => {
  assert.equal(globToRegExp('vendor/ffmpeg/**').test('vendor/ffmpeg/ffmpeg'), true);
  assert.equal(globToRegExp('vendor/ffmpeg/**').test('vendor/ffmpeg/deep/er/file'), true);
  assert.equal(globToRegExp('vendor/ffmpeg/**').test('vendor/fonts/x'), false);
  assert.equal(globToRegExp('native/**/*.node').test('native/ndi/build/Release/ndi.node'), true);
  assert.equal(globToRegExp('native/**/*.node').test('native/ndi/ndi.cpp'), false);
  assert.equal(globToRegExp('plugins/studio-deck/dist/**').test('plugins/studio-deck/src/plugin.ts'), false);
});

test('the app is one asar with the files it runs from disk unpacked beside it', () => {
  assert.equal(build.asar, true);
  for (const rel of ['vendor/ffmpeg/ffmpeg', 'native/decklink/build/Release/decklink.node', 'native/ndi/build/Release/ndi.node',
    'plugins/studio-deck/dist/com.runplaywin.firstpass-studio.streamDeckPlugin']) {
    assert.ok(covered(rel), `${rel} is run, loaded or handed to another program, so build.asarUnpack must cover it`);
  }
  assert.equal(covered('server.js'), false, 'the code itself stays in the archive');
  assert.equal(covered('native/ndi/ndi.cpp'), false);
});

test('the fuses stop the app running as a plain Node or taking code by environment variable', () => {
  assert.deepEqual(build.electronFuses, {
    runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, loadBrowserProcessSpecificV8Snapshot: false, grantFileProtocolExtraPrivileges: false,
  });
});

test('the entitlements are the four the app needs, with no dyld environment variables', () => {
  assert.equal(build.mac.entitlements, 'build/entitlements.mac.plist');
  assert.equal(build.mac.entitlementsInherit, 'build/entitlements.mac.plist');
  const plist = fs.readFileSync(path.join(ROOT, build.mac.entitlements), 'utf8');
  const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map(m => m[1]).sort();
  assert.deepEqual(keys, ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-library-validation', 'com.apple.security.device.audio-input']);
  // macOS asks before the mics are heard, and says why with this.
  assert.match(build.mac.extendInfo.NSMicrophoneUsageDescription, /mics/);
  assert.ok(build.files.includes('unpacked.js'));
});

test('unpacked() turns an archive path into the copy beside it, and leaves everything else alone', () => {
  assert.equal(unpacked('/Applications/FirstPass Studio.app/Contents/Resources/app.asar/vendor/ffmpeg/ffmpeg'),
    '/Applications/FirstPass Studio.app/Contents/Resources/app.asar.unpacked/vendor/ffmpeg/ffmpeg');
  assert.equal(unpacked('/Users/m/firstpassstudio/vendor/ffmpeg/ffmpeg'), '/Users/m/firstpassstudio/vendor/ffmpeg/ffmpeg', 'a checkout');
  assert.equal(unpacked('/x/app.asar.unpacked/y'), '/x/app.asar.unpacked/y', 'not applied twice');
  assert.equal(unpacked('C:\\Studio\\resources\\app.asar\\vendor\\ffmpeg\\ffmpeg.exe'), 'C:\\Studio\\resources\\app.asar.unpacked\\vendor\\ffmpeg\\ffmpeg.exe');
  // Everything run or loaded from disk goes through it.
  for (const [file, name] of [['scene.js', 'BUNDLED_FFMPEG'], ['scene.js', 'STREAMDECK_PLUGIN'], ['desktop/main.js', 'STREAMDECK_PLUGIN'], ['desktop/ndi.js', 'MODULE'], ['desktop/decklink.js', 'MODULE']]) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const line = src.split('\n').find(l => l.startsWith(`const ${name} = `));
    assert.ok(line && /unpacked\(/.test(line), `${file}: ${name} must go through unpacked()`);
  }
  // The helper can't have the archive as its working directory.
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8'), /cwd: APP_DIR/);
});

// With grantFileProtocolExtraPrivileges off, file:// can't read inside app.asar: the app's own pages
// failed to load in the shipped app (the splash had no logo, What's new never opened). They're served
// as studio://app/... (desktop/windows.js) instead, and every file they use must be in desktop/ or public/.
test("the app's own pages come from the archive by studio://, not file://", () => {
  const src = fs.readFileSync(path.join(ROOT, 'desktop/windows.js'), 'utf8');
  assert.doesNotMatch(src, /loadFile\(/, 'loadFile is file://, which the fuses keep out of the archive');
  const pages = [...src.matchAll(/loadPage\(\w+, '([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(pages)].sort(), ['export.html', 'offair.html', 'splash.html', 'whatsnew.html']);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, 'desktop', page), 'utf8');
    assert.doesNotMatch(html, /file:/, `${page} mustn't ask for file://`);
    for (const [, ref] of html.matchAll(/(?:src="|url\()(\.\.\/[^")]+)/g)) {
      const rel = path.posix.normalize(path.posix.join('desktop', ref));
      assert.match(rel, /^(desktop|public)\//, `${page}: ${ref} is outside what studio:// serves`);
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${page}: ${ref} is missing`);
      assert.ok(build.files.includes('public/**/*') || build.files.includes(rel), `${rel} is packed`);
    }
  }
  assert.equal(build.electronFuses.grantFileProtocolExtraPrivileges, false);
  // studio:// answers from the first page loaded, not from a whenReady that main.js's start() beats.
  assert.doesNotMatch(src, /whenReady\(\)\.then\(\(\) => protocol\.handle/);
  assert.match(src, /const loadPage = [^\n]*serve\(\)/);
});
