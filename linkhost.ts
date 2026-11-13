// The host name the page links use: the Mac's Bonjour name (e.g. matts-macbook-pro.local),
// so the same link works on this Mac and from other computers, phones or a Stream
// Deck on the same network. config.json "linkHost" changes it: "bonjour" (the default),
// "localhost", or any name or IP address. Shared by the helper and the Mac app.

import os from 'node:os';
import { execFileSync } from 'node:child_process';

// The Mac's Bonjour name as set in System Settings > General > Sharing > Local hostname.
// os.hostname() can be a name the router handed out, so ask macOS for the real one.
function bonjourName() {
  if (process.platform === 'darwin') {
    try {
      const name = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 2000 }).trim();
      if (name) return `${name}.local`;
    } catch { /* fall back below */ }
    const host = os.hostname().replace(/\.local$/i, '').split('.')[0];
    return host ? `${host}.local` : 'localhost';
  }
  // Windows and Linux don't always answer to .local names: keep localhost there.
  return 'localhost';
}

function linkHost(setting?: string | null): string {
  const want = String(setting || 'bonjour').trim();
  if (!want || /^(bonjour|auto)$/i.test(want)) return bonjourName();
  return want;
}

export { linkHost, bonjourName };
