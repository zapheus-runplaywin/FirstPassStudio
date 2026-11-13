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
//   node out/desktop/whatsnew.js <releases.ndjson> <this build's notes.md> <version> > desktop/whatsnew.json
// where releases.ndjson has one { tag_name, published_at, body, draft } per line (gh api).

import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../appdir';

const FILE = path.join(APP_DIR, 'desktop', 'whatsnew.json');

interface Release { version: string, date: string, changes: string[] }
interface Data { releases: Release[] }
// One published release as GitHub's API gives it (gh api), read from the workflow's file.
interface Published { tag_name?: string, published_at?: string, body?: string, draft?: boolean }

const parse = (v: unknown): number[] | null => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim()); return m ? m.slice(1).map(Number) : null; };
// Above zero when a is the higher version; a version that doesn't parse counts as 0.0.0.
function compare(a: unknown, b: unknown): number {
  const x = parse(a) || [0, 0, 0], y = parse(b) || [0, 0, 0];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

// The "- title" lines under "## What's new" in a release's notes.
function changesIn(notes: unknown): string[] {
  const out: string[] = [];
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
function build(releases: (Published | null)[], notes: string, version: string): Data {
  const byVersion = new Map<string, Release>();
  for (const r of releases) {
    const tag = r && !r.draft ? parse(r.tag_name) : null;
    if (!r || !tag) continue;
    const v = tag.join('.');
    byVersion.set(v, { version: v, date: (r.published_at || '').slice(0, 10), changes: changesIn(r.body) });
  }
  const own = parse(version);
  if (own) {
    const v = own.join('.');
    byVersion.set(v, { version: v, date: new Date().toISOString().slice(0, 10), changes: changesIn(notes) });
  }
  return { releases: [...byVersion.values()].sort((a, b) => compare(b.version, a.version)) };
}

// The releases after `last` up to and including `current` that changed something, newest first.
function since(data: Data | null, last: string | null | undefined, current: string): Release[] {
  if (!data || !Array.isArray(data.releases) || !parse(current)) return [];
  return data.releases.filter(r => parse(r.version) && r.changes && r.changes.length &&
    compare(r.version, current) <= 0 && (!parse(last) || compare(r.version, last) > 0));
}

// The bundled file, checked: releases with a version and a list of changes, or null when there's none.
function load(file = FILE): Data | null {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const list: unknown = raw && typeof raw === 'object' && 'releases' in raw ? raw.releases : null;
  if (!Array.isArray(list)) return null;
  const releases = list.flatMap((r: unknown): Release[] => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    return typeof o.version === 'string' ? [{ version: o.version, date: String(o.date || ''), changes: Array.isArray(o.changes) ? o.changes.map(String) : [] }] : [];
  });
  return { releases };
}

// The version in the last "Starting <version>, …" line of the app's log.
function lastStarted(log: unknown): string | null {
  const all = [...String(log || '').matchAll(/ Starting (\d+\.\d+\.\d+),/g)];
  return all.length ? all[all.length - 1][1] : null;
}

// What to do as the app opens. lastSeen: the version the app last opened as (app-settings.json
// whatsNewSeen, or the log's last start); usedBefore: whether this Mac had run the app before (a fresh install has nothing
// new to tell). Returns { show: releases to list, or null; seen: the version to save, or null }.
function onLaunch({ data, current, lastSeen, usedBefore }: { data: Data | null, current: string, lastSeen: string | null, usedBefore: boolean }): { show: Release[] | null, seen: string | null } {
  if (!parse(current) || lastSeen === current) return { show: null, seen: null };
  // A fresh install: just remember this version.
  if (!usedBefore && !lastSeen) return { show: null, seen: current };
  // An older version than the one last seen (an older copy of the app, one run from the
  // repository, or one opened before an update finished installing): nothing to show, and the
  // newer version stays the one remembered. Saving the older one here made What's new show
  // again for the newer version the next time it opened.
  if (parse(lastSeen) && compare(current, lastSeen) < 0) return { show: null, seen: null };
  const list = since(data, lastSeen, current);
  // No record of the last version at all: show only this one's changes.
  return { show: list.length ? (parse(lastSeen) ? list : list.slice(0, 1)) : null, seen: current };
}

export type { Release };
export { changesIn, build, since, load, onLaunch, lastStarted, compare, FILE };

if (require.main === module) {
  const [releasesFile, notesFile, version] = process.argv.slice(2);
  const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const releases = read(releasesFile).split('\n').filter(l => l.trim()).map((l): Published | null => { try { return JSON.parse(l); } catch { return null; } });
  process.stdout.write(JSON.stringify(build(releases, read(notesFile), version), null, 1) + '\n');
}
