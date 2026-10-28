// FirstPass Studio - who on the network may change things.
//
// Studio listens on every network connection so a phone, another computer or a Stream Deck can
// open its pages and press its links by the Mac's .local name. Reading is always open. Changing
// things (scores, the scene, sequences, settings, media) is open too by default, and config.json
// "remoteChanges": false limits it to this computer and the devices allowed in Devices… (devices.js), each within its
// level: a request from anywhere else that would change something gets a 403 with the reason. The Mac app's tray has a
// tick box for it.
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
// the browser think another site's name is this Mac). That Host check covers reads of private data
// too (foreignHost()), since a rebinding page counts as Studio's own and could otherwise read them.

'use strict';

const os = require('os');

// Reads of private data rather than graphics: the settings and scene backups (every photo, logo and
// media file), the athlete register, the debug log, the sponsor exposure report, the Stream Deck key,
// the Production Planner's commentators and nights (who is on the mic now, /api/planner/onair, stays open for the
// graphics) and the competition setup. With remoteChanges off these too answer only this computer; every graphic, the scoreboard,
// the scene and the media files stay open so the Output page, OBS and the Stream Deck work from anywhere.
const PRIVATE = ['/api/settings/export', '/api/scene/export', '/api/athletes', '/api/log', '/api/sponsors/report', '/api/sponsors/nights', '/api/deck-key', '/api/planner'];
function privateRead(method, pathname) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  return PRIVATE.includes(pathname) || pathname.startsWith('/api/setup') || macOnly(pathname);
}

// Who may change things from another device (the Devices… window, devices.js): read and changed only on this Mac,
// whether or not "Only this Mac can change things" is ticked, so another device can never let itself in.
const MAC_ONLY = ['/api/devices'];
const macOnly = pathname => MAC_ONLY.some(p => pathname === p || pathname.startsWith(p + '/'));
// The 403 message for one of those asked for from another address, or null.
function notThisMac(method, pathname, remoteAddress, own) {
  if (!macOnly(pathname) || isLocal(remoteAddress, own)) return null;
  return `The devices allowed to change Studio can only be seen and changed on the Mac running Studio, so ${method} ${pathname} from ${strip(remoteAddress)} was refused. Choose Devices… in the menu bar icon on that Mac.`;
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

// Asking to be added to the devices list (devices.js ask()) works while the lock is on: that is how a device gets in
// without it, and nothing is added until someone at the Mac presses Allow.
const ASK = ['/api/pair'];
const asking = pathname => ASK.some(p => pathname === p || pathname.startsWith(p + '/'));

// What a device allowed to score only may change (devices.js level 'scoring'): the scoreboard control page (the score,
// clock, quarter, game and round pick) and the Stream Deck's score, clock, quarter and game links.
const SCORING_POSTS = ['/api/scoreboard', '/api/rounds'];
const SCORING_LINKS = ['home', 'away', 'scores', 'clock', 'quarter', 'source', 'auto', 'court'];
function scoring(method, pathname) {
  if (method === 'POST' && SCORING_POSTS.includes(pathname)) return true;
  const m = /^\/deck\/([^/]+)/.exec(pathname);
  return !!m && method === 'GET' && SCORING_LINKS.includes(m[1]);
}

// The 403 message, or null when the request may go ahead. level is the allowed device the request comes from
// (devices.js: a paired browser's cookie, a signed plugin press, a link set's key), or null: a 'full' device passes
// while the lock is on, and a 'scoring' one passes for scoring().
function refusal(setting, method, pathname, remoteAddress, own, level = null) {
  if (setting !== false || asking(pathname)) return null;
  const change = changes(method, pathname);
  if (!change && !privateRead(method, pathname)) return null;
  if (isLocal(remoteAddress, own)) return null;
  if (level === 'full' || (level === 'scoring' && change && scoring(method, pathname))) return null;
  if (level === 'scoring') return `This device is allowed to score only, so ${method} ${pathname} was refused. To let it change everything, change it in Devices… in the menu bar icon on the Mac.`;
  const what = change ? 'take changes' : 'keep its private data (settings, backups, the athlete register, the Production Planner, the log and sponsor reports)';
  return `Studio is set to ${what} only ${change ? 'from' : 'on'} this computer, so ${method} ${pathname} from ${strip(remoteAddress)} was refused. To let this device in, open Studio's /pair.html on it and press Allow on the Mac; or, to let every device on this network change things and read them, untick "Only this Mac can change things" in the menu bar icon (it is ticked again each time Studio opens).`;
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

// The 403 message when the Host header names something Studio doesn't answer to (a DNS rebinding page), or null.
// Changes and private reads (PRIVATE) are checked; graphics answer to any name, so a browser source still works
// by whatever name it was given.
function foreignHost(method, pathname, headers, hosts) {
  const h = headers || {};
  const host = hostOf(h.host);
  if (!h.host || isOwnHost(host, hosts)) return null;
  return `Studio refused ${method} ${pathname} because it was asked for as "${host}", a name this computer doesn't answer to. Open Studio by its own link (localhost or its .local name), or add "linkHost": "${host}" to config.json if that name really is this computer.`;
}

// The 403 message when a changing request came from another web page, or null when it may go
// ahead. headers are the request's; port is Studio's; hosts from ownHosts(). A request with no
// browser headers at all (the Stream Deck plugin, a Website key, curl) always passes.
function crossSite(method, pathname, headers, port, hosts) {
  const h = headers || {};
  const foreign = foreignHost(method, pathname, h, hosts);
  if (foreign) return foreign;
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

// Whether a Stream Deck link press is known to come from someone allowed to press it: null for anything that isn't a
// Stream Deck link, true or false for one. A web page on another site can make the browser fetch a /deck/ link (an
// image tag sends no Origin, and plain http sends no Sec-Fetch-Site), so crossSite() can't tell it from a Website key.
// What it can't do: know a device's key (/k/<key>/deck/..., proof.keyOk, see devices.js), sign the press with a paired
// plugin's private key (proof.signed, devices.signed()), add a custom header (x-studio-deck, which the Studio plugin
// sent before it could pair; a browser asks Studio first, and Studio never says yes; counted only while proof.headerOk,
// until a plugin has paired), or send a Referer naming one of Studio's own pages (the Output page and the API page
// press links from there).
function deckPress(pathname, proof, headers, port, hosts) {
  if (pathname !== '/deck' && !pathname.startsWith('/deck/')) return null;
  const p = proof || {};
  const h = headers || {};
  if (p.keyOk || p.signed) return true;
  if (h['x-studio-deck'] && p.headerOk) return true;
  try {
    const ref = new URL(String(h.referer || ''));
    if (ref.protocol === 'http:' && isOwnHost(hostOf(ref.host), hosts) && Number(ref.port || 80) === Number(port)) return true;
  } catch { /* no Referer, or not a URL */ }
  return false;
}

module.exports = { changes, privateRead, PRIVATE, MAC_ONLY, ASK, notThisMac, scoring, isLocal, ownAddresses, refusal, strip, hostOf, portOf, ownHosts, foreignHost, crossSite, deckPress };
