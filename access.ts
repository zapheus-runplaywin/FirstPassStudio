// FirstPass Studio - who on the network may change things.
//
// Studio listens on every network connection so a phone, another computer or a Stream Deck can
// open its pages and press its links by the Mac's .local name. Reading is always open. Changing
// things (scores, the scene, sequences, settings, media) is open too by default, and config.json
// "remoteChanges": false limits it to this computer and the devices allowed in Devices… (devices.ts), each within its
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

import os from 'node:os';
import type { IncomingHttpHeaders } from 'node:http';

// A device's level in Devices… (devices.ts), or null for a request from no allowed device.
type Level = 'full' | 'scoring' | null;

// Reads of private data rather than graphics: the settings and scene backups (every photo, logo and
// media file), the athlete register, the debug log, the sponsor exposure report, the Stream Deck key,
// the Socials pictures saved for a phone, the Facebook and Instagram posts (/api/posting), the Production Planner's commentators and nights (who is on the mic now and the fixture board, /api/planner/onair and
// /api/planner/fixtureboard, stay open for the graphics) and the competition setup. With remoteChanges off these too answer only this computer; every graphic, the scoreboard,
// the scene and the media files stay open so the Output page, OBS and the Stream Deck work from anywhere.
const PRIVATE = ['/api/settings/export', '/api/scene/export', '/api/athletes', '/api/log', '/api/sponsors/report', '/api/sponsors/nights', '/api/deck-key', '/api/planner'];
function privateRead(method: string, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  return PRIVATE.includes(pathname) || firstpass(pathname) || pathname.startsWith('/api/setup') || pathname.startsWith('/api/recordings') || pathname.startsWith('/api/socials/made/') || pathname === '/api/posting' || macOnly(pathname);
}

// FirstPass stats (/api/firstpass/...): figures a club's FirstPass HQ holds about its athletes, many of them under 18,
// that PlayHQ never publishes. Private whatever "Only this Mac can change things" says (firstpassRefusal()): they
// answer this Mac, and a browser allowed in Devices… only when it asks over the secure link (https) with a cookie it
// was given over the secure link (devices.ts Device secure), so nothing on the venue Wi-Fi can read them in passing or
// copy a cookie that lets it. They are private reads too (privateRead()), so a DNS rebinding page can't ask for them
// and a 4K replay never records them. They never go into the board, the scene, a game story or anything else that is
// read openly or shared (security review re-check, 13 November 2026, R1 and R2).
const FIRSTPASS = '/api/firstpass';
const firstpass = (pathname: string) => pathname === FIRSTPASS || pathname.startsWith(FIRSTPASS + '/');
// The device a request came from, as far as FirstPass stats care: a paired browser and whether its cookie only ever
// travelled over https.
type FirstPassDevice = { kind: string; secure?: boolean } | null;
// The 403 message for a FirstPass stats request from anywhere but this Mac or a secure paired browser over https, or
// null when it may go ahead (or isn't one).
function firstpassRefusal(method: string, pathname: string, remoteAddress: string | undefined, device: FirstPassDevice, encrypted: boolean,
  own?: Set<string>): string | null {
  if (!firstpass(pathname) || isLocal(remoteAddress, own)) return null;
  if (device && device.kind === 'browser' && device.secure === true && encrypted) return null;
  const how = !encrypted
    ? 'they only go to another device over Studio\'s secure link (https), set up on the Devices tab on the Mac'
    : 'this device was allowed over plain http, so open /pair.html by the secure link on it and press Allow on the Mac again';
  return `FirstPass stats are private to the Mac running Studio and the devices it allows, so ${method} ${pathname} from ${strip(remoteAddress)} was refused: ${how}.`;
}

// Who may change things from another device (the Devices… window, devices.ts), the secure phone link's settings and
// key (securelink.ts), signing in to each club's FirstPass HQ (hqauth.ts), and the AI captions' provider, keys and spend (captions.ts): read and changed only on this Mac, whether or not "Only this Mac can change things" is ticked, so another device can never let itself in.
const MAC_ONLY = ['/api/devices', '/api/securelink', '/api/phonemic/offers', '/api/firstpass/clubs', '/api/captions', '/api/posting/account'];
const macOnly = (pathname: string) => MAC_ONLY.some(p => pathname === p || pathname.startsWith(p + '/'));
// The 403 message for one of those asked for from another address, or null.
function notThisMac(method: string, pathname: string, remoteAddress: string | undefined, own?: Set<string>): string | null {
  if (!macOnly(pathname) || isLocal(remoteAddress, own)) return null;
  return `The devices allowed to change Studio can only be seen and changed on the Mac running Studio, so ${method} ${pathname} from ${strip(remoteAddress)} was refused. Choose Devices… in the menu bar icon on that Mac.`;
}

// Requests that change something: anything but GET and HEAD, plus the Stream Deck links, which
// act on a plain GET (/deck/...).
function changes(method: string, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return true;
  return pathname === '/deck' || pathname.startsWith('/deck/');
}

const strip = (addr: string | null | undefined) => String(addr || '').replace(/^::ffff:/i, '').replace(/%.*$/, '');

// Every address this computer answers on, read when asked (interfaces come and go).
function ownAddresses(): Set<string> {
  const set = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) set.add(strip(i.address));
  return set;
}

function isLocal(remoteAddress: string | null | undefined, own: Set<string> = ownAddresses()): boolean {
  const a = strip(remoteAddress);
  return !a || own.has(a);
}

// Asking to be added to the devices list (devices.ts ask()) works while the lock is on: that is how a device gets in
// without it, and nothing is added until someone at the Mac presses Allow.
const ASK = ['/api/pair'];
const asking = (pathname: string) => ASK.some(p => pathname === p || pathname.startsWith(p + '/'));

// What every allowed device may do, whatever its level: start a phone mic (the Commentator page, phonemic.ts).
const ANY_LEVEL = ['/api/phonemic/offer'];

// What a device allowed to score only may change (devices.ts level 'scoring'): the scoreboard control page (the score,
// clock, quarter, game and round pick) and the Stream Deck's score, clock, quarter and game links.
const SCORING_POSTS = ['/api/scoreboard', '/api/rounds'];
const SCORING_LINKS = ['home', 'away', 'scores', 'clock', 'quarter', 'source', 'auto', 'court'];
function scoring(method: string, pathname: string): boolean {
  if (method === 'POST' && SCORING_POSTS.includes(pathname)) return true;
  const m = /^\/deck\/([^/]+)/.exec(pathname);
  return !!m && method === 'GET' && SCORING_LINKS.includes(m[1]);
}

// The 403 message, or null when the request may go ahead. level is the allowed device the request comes from
// (devices.ts: a paired browser's cookie, a signed plugin press, a link set's key), or null: a 'full' device passes
// while the lock is on, and a 'scoring' one passes for scoring().
function refusal(setting: unknown, method: string, pathname: string, remoteAddress: string | undefined, own?: Set<string>, level: Level = null): string | null {
  if (setting !== false || asking(pathname)) return null;
  const change = changes(method, pathname);
  if (!change && !privateRead(method, pathname)) return null;
  if (isLocal(remoteAddress, own)) return null;
  if (level === 'full' || (level === 'scoring' && change && scoring(method, pathname)) || (level && method === 'POST' && ANY_LEVEL.includes(pathname))) return null;
  if (level === 'scoring') return `This device is allowed to score only, so ${method} ${pathname} was refused. To let it change everything, change it in Devices… in the menu bar icon on the Mac.`;
  const what = change ? 'take changes' : 'keep its private data (settings, backups, the athlete register, the Production Planner, the log and sponsor reports)';
  return `Studio is set to ${what} only ${change ? 'from' : 'on'} this computer, so ${method} ${pathname} from ${strip(remoteAddress)} was refused. To let this device in, open Studio's /pair.html on it and press Allow on the Mac; or, to let every device on this network change things and read them, untick "Only this Mac can change things" in the menu bar icon (it is ticked again each time Studio opens).`;
}

// The host part of a Host or Origin header value, lower case, without the port or IPv6 brackets.
function hostOf(value: unknown): string {
  const s = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '');
  const m = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (m) return m[1];
  return s.replace(/:\d+$/, '');
}
// The port part of a Host or Origin header value, or the default for the scheme.
function portOf(value: unknown): number {
  const s = String(value || '').trim().toLowerCase();
  const m = s.match(/:(\d+)$/);
  if (m) return Number(m[1]);
  return s.startsWith('https://') ? 443 : 80;
}

// The names Studio answers to in a browser: localhost, every address of this computer, its .local
// name and anything config.json linkHost says, plus extra names given by the caller.
function ownHosts(extra: (string | null | undefined)[] = [], own: Set<string> = ownAddresses()): Set<string> {
  const set = new Set(['localhost', ...own]);
  for (const h of extra) if (h) set.add(hostOf(h));
  return set;
}
// Whether a name is one of ours: in the set, or any .local name (Bonjour names only resolve on
// this network, so one can't be pointed at this Mac from elsewhere).
const isOwnHost = (host: string, hosts: Set<string>) => !!host && (hosts.has(host) || host.endsWith('.local'));

// The 403 message when the Host header names something Studio doesn't answer to (a DNS rebinding page), or null.
// Changes and private reads (PRIVATE) are checked; graphics answer to any name, so a browser source still works
// by whatever name it was given.
function foreignHost(method: string, pathname: string, headers: IncomingHttpHeaders | null | undefined, hosts: Set<string>): string | null {
  const h = headers || {};
  const host = hostOf(h.host);
  if (!h.host || isOwnHost(host, hosts)) return null;
  return `Studio refused ${method} ${pathname} because it was asked for as "${host}", a name this computer doesn't answer to. Open Studio by its own link (localhost or its .local name), or add "linkHost": "${host}" to config.json if that name really is this computer.`;
}

// The 403 message when a changing request came from another web page, or null when it may go
// ahead. headers are the request's; port is Studio's; hosts from ownHosts(); secure is the secure phone link
// (securelink.ts), { host, port }, when it's on: its https pages are Studio's own too. A request with no
// browser headers at all (the Stream Deck plugin, a Website key, curl) always passes.
function crossSite(method: string, pathname: string, headers: IncomingHttpHeaders | null | undefined, port: number | string, hosts: Set<string>,
  secure: { host: string; port: number | string } | null = null): string | null {
  const h = headers || {};
  const foreign = foreignHost(method, pathname, h, hosts);
  if (foreign) return foreign;
  const site = String(h['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site') {
    return `Studio refused ${method} ${pathname}: it came from a web page on another site${h.origin ? ` (${h.origin})` : ''}, not from Studio's own pages. Only Studio's pages, the Stream Deck and other programs may change things.`;
  }
  if (h.origin !== undefined) {
    const origin = String(h.origin).trim().toLowerCase();
    const ok = (/^http:\/\//.test(origin) && isOwnHost(hostOf(origin), hosts) && portOf(origin) === Number(port))
      || (!!secure && /^https:\/\//.test(origin) && hostOf(origin) === secure.host && portOf(origin) === Number(secure.port));
    if (!ok) return `Studio refused ${method} ${pathname}: it came from a web page on ${origin || 'an unknown site'}, not from Studio's own pages. Only Studio's pages, the Stream Deck and other programs may change things.`;
  }
  return null;
}

// Whether a Stream Deck link press is known to come from someone allowed to press it: null for anything that isn't a
// Stream Deck link, true or false for one. A web page on another site can make the browser fetch a /deck/ link (an
// image tag sends no Origin, and plain http sends no Sec-Fetch-Site), so crossSite() can't tell it from a Website key.
// What it can't do: know a device's key (/k/<key>/deck/..., proof.keyOk, see devices.ts), sign the press with a paired
// plugin's private key (proof.signed, devices.signed()), add a custom header (x-studio-deck, which the Studio plugin
// sent before it could pair; a browser asks Studio first, and Studio never says yes; counted only while proof.headerOk,
// until a plugin has paired), or send a Referer naming one of Studio's own pages (the Output page and the API page
// press links from there).
function deckPress(pathname: string, proof: { keyOk?: boolean; signed?: boolean; headerOk?: boolean } | null | undefined,
  headers: IncomingHttpHeaders | null | undefined, port: number | string, hosts: Set<string>): boolean | null {
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

export type { Level, FirstPassDevice };
export { changes, privateRead, PRIVATE, FIRSTPASS, firstpass, firstpassRefusal, MAC_ONLY, ASK, notThisMac, scoring, isLocal, ownAddresses, refusal, strip, hostOf, portOf, ownHosts, foreignHost, crossSite, deckPress };
