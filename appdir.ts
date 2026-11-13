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

// One of the scripts in public/ that the pages and the app share (pages.js, studiobar.js): a page loads it with a script
// tag, and the app reads the same file for its lists. It sits in public/ beside the pages rather than in out/.
export function sharedScript<T>(name: string): T {
  return require(path.join(APP_DIR, 'public', name)) as T;
}
