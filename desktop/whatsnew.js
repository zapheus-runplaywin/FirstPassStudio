// What's new in the Mac app: the window that shows once, the first time the app opens after it
// has updated, listing what changed since the version last opened.
//
// The changes are the release notes (the titles of the pull requests merged for each release,
// "Write the release notes" in .github/workflows/mac-app.yml). The Mac app workflow bundles every
// published release's list, and this build's own, into desktop/whatsnew.json, so the window works
// offline and covers every version skipped since the last one opened. Run from the repository
// there is no whatsnew.json and no window.
//
// Made by the workflow:
//   node desktop/whatsnew.js <releases.ndjson> <this build's notes.md> <version> > desktop/whatsnew.json
// where releases.ndjson has one { tag_name, published_at, body, draft } per line (gh api).

'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'whatsnew.json');

const parse = v => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim()); return m ? m.slice(1).map(Number) : null; };
// Above zero when a is the higher version.
function compare(a, b) {
  const x = parse(a), y = parse(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

// The "- title" lines under "## What's new" in a release's notes.
function changesIn(notes) {
  const out = [];
  let inList = false;
  for (const line of String(notes || '').split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inList = /^##\s+what.s new/i.test(line); continue; }
    const m = inList && /^\s*[-*]\s+(.+)$/.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

// Every published release, newest first, with this build's on top (it isn't published yet when
// the app is built): [{ version, date, changes }].
function build(releases, notes, version) {
  const byVersion = new Map();
  for (const r of releases) {
    if (!r || r.draft || !parse(r.tag_name)) continue;
    const v = parse(r.tag_name).join('.');
    byVersion.set(v, { version: v, date: (r.published_at || '').slice(0, 10), changes: changesIn(r.body) });
  }
  if (parse(version)) {
    const v = parse(version).join('.');
    byVersion.set(v, { version: v, date: new Date().toISOString().slice(0, 10), changes: changesIn(notes) });
  }
  return { releases: [...byVersion.values()].sort((a, b) => compare(b.version, a.version)) };
}

// The releases after `last` up to and including `current` that changed something, newest first.
function since(data, last, current) {
  if (!data || !Array.isArray(data.releases) || !parse(current)) return [];
  return data.releases.filter(r => parse(r.version) && r.changes && r.changes.length &&
    compare(r.version, current) <= 0 && (!parse(last) || compare(r.version, last) > 0));
}

function load(file = FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// What to do as the app opens. lastSeen: the version the app last opened as (app-settings.json
// whatsNewSeen); usedBefore: whether this Mac had run the app before (a fresh install has nothing
// new to tell). Returns { show: releases to list, or null; seen: the version to save, or null }.
function onLaunch({ data, current, lastSeen, usedBefore }) {
  if (!parse(current) || lastSeen === current) return { show: null, seen: null };
  // A fresh install, or a downgrade: just remember this version.
  if (!usedBefore && !lastSeen) return { show: null, seen: current };
  if (parse(lastSeen) && compare(current, lastSeen) < 0) return { show: null, seen: current };
  const list = since(data, lastSeen, current);
  // The first version with this window has no record of the last one: show only its own changes.
  return { show: list.length ? (lastSeen ? list : list.slice(0, 1)) : null, seen: current };
}

module.exports = { changesIn, build, since, load, onLaunch, compare, FILE };

if (require.main === module) {
  const [releasesFile, notesFile, version] = process.argv.slice(2);
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const releases = read(releasesFile).split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } });
  process.stdout.write(JSON.stringify(build(releases, read(notesFile), version), null, 1) + '\n');
}
