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
//
// Whatever that setting says, a change must come from Studio's own pages or from a program (the
// Stream Deck plugin, a Stream Deck "Website" key, curl), never from a web page on another site.
// Studio sends no CORS header, so another site can't read its answers, but a browser still sends
// the request: a hidden image tag fires a /deck/ link, and a form or fetch posts to /api/... from
// the Mac's own address, which the setting above would let through. crossSite() refuses those:
// a request whose Origin or Sec-Fetch-Site header says it came from another site, and a request
// whose Host header names something Studio doesn't answer to (a DNS rebinding page, which makes
// the browser think another site's name is this Mac).

'use strict';

const os = require('os');

// Reads of private data rather than graphics: the settings and scene backups (every photo, logo and
// media file), the athlete register, the debug log, the sponsor exposure report and the competition
// setup. With remoteChanges off these too answer only this computer; every graphic, the scoreboard,
// the scene and the media files stay open so the Output page, OBS and the Stream Deck work from anywhere.
const PRIVATE = ['/api/settings/export', '/api/scene/export', '/api/athletes', '/api/log', '/api/sponsors/report', '/api/sponsors/nights'];
function privateRead(method, pathname) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  return PRIVATE.includes(pathname) || pathname.startsWith('/api/setup');
}

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
  const change = changes(method, pathname);
  if (!change && !privateRead(method, pathname)) return null;
  if (isLocal(remoteAddress, own)) return null;
  const what = change ? 'take changes' : 'keep its private data (settings, backups, the athlete register, the log and sponsor reports)';
  return `Studio is set to ${what} only ${change ? 'from' : 'on'} this computer, so ${method} ${pathname} from ${strip(remoteAddress)} was refused. To let other devices on this network change things and read them, tick "Let other devices change things" in the menu bar icon (or set "remoteChanges": true in config.json).`;
}

// The host part of a Host or Origin header value, lower case, without the port or IPv6 brackets.
function hostOf(value) {
  const s = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '');
  const m = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (m) return m[1];
  return s.replace(/:\d+$/, '');
}
// The port part of a Host or Origin header value, or the default for the scheme.
function portOf(value) {
  const s = String(value || '').trim().toLowerCase();
  const m = s.match(/:(\d+)$/);
  if (m) return Number(m[1]);
  return s.startsWith('https://') ? 443 : 80;
}

// The names Studio answers to in a browser: localhost, every address of this computer, its .local
// name and anything config.json linkHost says, plus extra names given by the caller.
function ownHosts(extra = [], own = ownAddresses()) {
  const set = new Set(['localhost', ...own]);
  for (const h of extra) if (h) set.add(hostOf(h));
  return set;
}
// Whether a name is one of ours: in the set, or any .local name (Bonjour names only resolve on
// this network, so one can't be pointed at this Mac from elsewhere).
const isOwnHost = (host, hosts) => !!host && (hosts.has(host) || host.endsWith('.local'));

// The 403 message when a changing request came from another web page, or null when it may go
// ahead. headers are the request's; port is Studio's; hosts from ownHosts(). A request with no
// browser headers at all (the Stream Deck plugin, a Website key, curl) always passes.
function crossSite(method, pathname, headers, port, hosts) {
  const h = headers || {};
  const host = hostOf(h.host);
  if (h.host && !isOwnHost(host, hosts)) {
    return `Studio refused ${method} ${pathname} because it was asked for as "${hostOf(h.host)}", a name this computer doesn't answer to. Open Studio by its own link (localhost or its .local name), or add "linkHost": "${host}" to config.json if that name really is this computer.`;
  }
  const site = String(h['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site') {
    return `Studio refused ${method} ${pathname}: it came from a web page on another site${h.origin ? ` (${h.origin})` : ''}, not from Studio's own pages. Only Studio's pages, the Stream Deck and other programs may change things.`;
  }
  if (h.origin !== undefined) {
    const origin = String(h.origin).trim().toLowerCase();
    const ok = /^http:\/\//.test(origin) && isOwnHost(hostOf(origin), hosts) && portOf(origin) === Number(port);
    if (!ok) return `Studio refused ${method} ${pathname}: it came from a web page on ${origin || 'an unknown site'}, not from Studio's own pages. Only Studio's pages, the Stream Deck and other programs may change things.`;
  }
  return null;
}

module.exports = { changes, privateRead, PRIVATE, isLocal, ownAddresses, refusal, strip, hostOf, portOf, ownHosts, crossSite };
