// The Mac app's What's new window (desktop/whatsnew.js): once, the first time the app opens after
// an update, listing the changes from the release notes bundled at build time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const whatsnew = require('../desktop/whatsnew.js');

// Release notes as the Mac app workflow writes them ("Write the release notes").
const notes = (version, titles) => `FirstPass Studio ${version} for Apple silicon Macs.\n` +
  (titles.length ? `\n## What's new\n\n${titles.map(t => `- ${t}`).join('\n')}\n` : '\nNo changes merged since v0.0.1.\n');
const release = (version, titles, extra = {}) => ({ tag_name: `v${version}`, published_at: '2026-10-20T03:04:05Z', body: notes(version, titles), draft: false, ...extra });

test('reads the change titles from release notes', () => {
  assert.deepEqual(whatsnew.changesIn(notes('0.4.2', ['Add the score worm', 'Fix the ladder\'s long names'])), ['Add the score worm', 'Fix the ladder\'s long names']);
  assert.deepEqual(whatsnew.changesIn(notes('0.4.2', [])), []);
  assert.deepEqual(whatsnew.changesIn('## Other\n- not this\n## What’s new\n* this one\n'), ['this one']);
});

test('bundles every published release and this build, newest first, versions compared as numbers', () => {
  const data = whatsnew.build([
    release('0.4.9', ['Nine']), release('0.4.10', ['Ten']), release('0.5.0', ['Draft'], { draft: true }), { tag_name: 'v0.4.10-test.3', body: '' },
  ], notes('0.4.11', ['Eleven']), '0.4.11');
  assert.deepEqual(data.releases.map(r => r.version), ['0.4.11', '0.4.10', '0.4.9']);
  assert.deepEqual(data.releases[0].changes, ['Eleven']);
  assert.equal(data.releases[1].date, '2026-10-20');
});

const data = whatsnew.build([release('0.4.8', ['Eight']), release('0.4.9', []), release('0.4.10', ['Ten'])], notes('0.4.11', ['Eleven']), '0.4.11');

test('after an update it lists every version since the one last opened that changed something', () => {
  const r = whatsnew.onLaunch({ data, current: '0.4.11', lastSeen: '0.4.8', usedBefore: true });
  assert.deepEqual(r.show.map(x => x.version), ['0.4.11', '0.4.10']);
  assert.equal(r.seen, '0.4.11');
});

test('shows once: the same version again shows nothing', () => {
  assert.deepEqual(whatsnew.onLaunch({ data, current: '0.4.11', lastSeen: '0.4.11', usedBefore: true }), { show: null, seen: null });
});

test('a fresh install shows nothing and remembers the version', () => {
  assert.deepEqual(whatsnew.onLaunch({ data, current: '0.4.11', lastSeen: undefined, usedBefore: false }), { show: null, seen: '0.4.11' });
});

test('the first version with the window, on a Mac that used the app before, shows its own changes only', () => {
  const r = whatsnew.onLaunch({ data, current: '0.4.11', lastSeen: undefined, usedBefore: true });
  assert.deepEqual(r.show.map(x => x.version), ['0.4.11']);
});

test('nothing to show: an update with no changes, a downgrade, or no bundled notes (run from the repository)', () => {
  assert.equal(whatsnew.onLaunch({ data, current: '0.4.9', lastSeen: '0.4.8', usedBefore: true }).show, null);
  assert.deepEqual(whatsnew.onLaunch({ data, current: '0.4.10', lastSeen: '0.4.11', usedBefore: true }), { show: null, seen: '0.4.10' });
  assert.equal(whatsnew.onLaunch({ data: null, current: '0.4.11', lastSeen: '0.4.8', usedBefore: true }).show, null);
});

test('the workflow command writes whatsnew.json from the releases and this build\'s notes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsnew-'));
  fs.writeFileSync(path.join(dir, 'releases.ndjson'), [release('0.4.10', ['Ten']), release('0.4.9', ['Nine'])].map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), notes('0.4.11', ['Eleven']));
  const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'desktop', 'whatsnew.js'), path.join(dir, 'releases.ndjson'), path.join(dir, 'notes.md'), '0.4.11'], { encoding: 'utf8' }));
  assert.deepEqual(out.releases.map(r => [r.version, r.changes]), [['0.4.11', ['Eleven']], ['0.4.10', ['Ten']], ['0.4.9', ['Nine']]]);
  // Releases that can't be read (an empty file): only this build.
  fs.writeFileSync(path.join(dir, 'releases.ndjson'), '');
  const alone = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'desktop', 'whatsnew.js'), path.join(dir, 'releases.ndjson'), path.join(dir, 'notes.md'), '0.4.11'], { encoding: 'utf8' }));
  assert.deepEqual(alone.releases.map(r => r.version), ['0.4.11']);
  fs.rmSync(dir, { recursive: true, force: true });
});
