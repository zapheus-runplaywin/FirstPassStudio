// FirstPass Studio - who on the network may change things.
//
// Studio listens on every network connection so a phone, another computer or a Stream Deck can
// open its pages and press its links by the Mac's .local name. Reading is always open. Changing
// things (scores, the scene, sequences, settings, media) is open too by default, and config.json
// "remoteChanges": false limits it to this computer: a request from another address that would
// change something gets a 403 with the reason. The Mac app's tray has a tick box for it.
//
// "This computer" is any address the computer itself has: loopback, and every address of its
// own network interfaces, because the Stream Deck plugin and the pages may reach Studio by the
// .local name, which resolves to the Mac's LAN address rather than 127.0.0.1.

'use strict';

const os = require('os');

// Requests that change something: anything but GET and HEAD, plus the Stream Deck links, which
// act on a plain GET (/deck/...).
function changes(method, pathname) {
  if (method !== 'GET' && method !== 'HEAD') return true;
  return pathname === '/deck' || pathname.startsWith('/deck/');
}

const strip = addr => String(addr || '').replace(/^::ffff:/i, '').replace(/%.*$/, '');

// Every address this computer answers on, read when asked (interfaces come and go).
function ownAddresses() {
  const set = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) set.add(strip(i.address));
  return set;
}

function isLocal(remoteAddress, own = ownAddresses()) {
  const a = strip(remoteAddress);
  return !a || own.has(a);
}

// The 403 message, or null when the request may go ahead.
function refusal(setting, method, pathname, remoteAddress, own) {
  if (setting !== false) return null;
  if (!changes(method, pathname)) return null;
  if (isLocal(remoteAddress, own)) return null;
  return `Studio is set to take changes only from this computer, so ${method} ${pathname} from ${strip(remoteAddress)} was refused. To let other devices on this network change things, tick "Let other devices change things" in the menu bar icon (or set "remoteChanges": true in config.json).`;
}

module.exports = { changes, isLocal, ownAddresses, refusal, strip };
