// FirstPass Studio - the app folder: the pages (public/), the bundled tools (vendor/, native/), the guide and
// the default config.json. The code is compiled from TypeScript into out/ (npm run build), so the app folder
// is the one above this file's own.

import fs from 'node:fs';
import path from 'node:path';

export const APP_DIR = path.join(__dirname, '..');

// The app's version, from its package.json (the Mac app's build sets it for each release).
export const VERSION: string = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version; } catch { return ''; }
})();

// The pages' scripts, compiled from public/*.ts (npm run build); Studio serves them from here first.
export const BUILT_PUBLIC_DIR = path.join(APP_DIR, 'out', 'public');

// One of the pages' scripts that the app shares (pages.js, studiobar.js): a page loads it with a script tag, and the
// app reads the same compiled file for its lists.
export function sharedScript<T>(name: string): T {
  return require(path.join(BUILT_PUBLIC_DIR, name)) as T;
}
