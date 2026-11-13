// FirstPass Studio - the secure phone link: Studio on https, for what a phone's browser allows only on a secure page.
//
// Studio's links are plain http (http://<mac>.local:8080), and a phone's browser keeps some things for https pages:
// the microphone (a phone as a backup commentator headset), the share sheet with files, and installing a page as an
// app. So each Mac can have a name of its own on the internet, <name>.studio.firstpass.pivt.au, pointing at its
// address on the venue network, with a real certificate for it from Let's Encrypt; Studio answers on https on that
// name as well (port 8443, config.json "securePort"), with the same pages and the same rules as on http.
//
// It's off until it's set up on the Devices tab: the Route 53 hosted zone ID and an access key that may change only
// that zone (made once for PIVT, shared by every Studio Mac; route53.ts). Studio then
//   0. reads the zone's name from Route 53 (studio.firstpass.pivt.au), so the name is never built in here,
//   1. picks a random name for this Mac, once (k3f9x2), so two Macs at a two-court night each have their own,
//   2. points <name>.<zone> at this Mac's address on the network (an A record), and again whenever the address changes,
//   3. gets a certificate for the name from Let's Encrypt (acme.ts, by a TXT record in the zone), and a new one when it
//      has under 30 days left (they last 90),
//   4. answers on https with it. At the next launch a certificate still good is served at once, before any of the above.
// Each step that fails says why in the Devices tab's Secure phone link card and tries again later. The graphics,
// the Stream Deck and everything else carry on over http whatever happens here.
//
// The phones need the internet to look the name up, and a few routers refuse a name on the internet that points at an
// address on their own network ("DNS rebinding protection"); then the https link doesn't open on that network and
// the http one still does.
//
// Saved as securelink.json in the local data folder (never in iCloud or a backup): the settings, the zone's name, the Mac's name, the Let's
// Encrypt account and the certificate. The access key's secret goes in the Mac's Keychain when Studio runs in the app
// (in the file otherwise: npm start, the tests).

import fs from 'node:fs';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import * as datadir from './datadir';
import * as savefile from './savefile';
import * as route53 from './route53';
import * as acme from './acme';
import { errorMessage } from './errors';
import { obj } from './check';
import type { IncomingMessage, RequestListener } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Log } from './types';

// securelink.json. secret is kept here only when the Keychain isn't used (npm start, the tests).
interface Saved {
  v: number; on: boolean; zoneId: string; domain: string; keyId: string; secret: string; name: string; address: string;
  account: acme.Account | null; cert: string; key: string;
}
type Upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

const FILE = datadir.local('securelink.json');
const KEYCHAIN = process.env.SECURELINK_KEYCHAIN ? process.env.SECURELINK_KEYCHAIN === '1' : (process.platform === 'darwin' && !!process.parentPort);
const KEYCHAIN_SERVICE = 'FirstPass Studio secure link';
const RENEW_DAYS = 30;
const ADDRESS_EVERY = 60 * 1000;           // how often the Mac's address is looked at
const CHECK_EVERY = 12 * 3600 * 1000;      // and the certificate's age
const RETRY = [5, 15, 60].map(m => m * 60 * 1000); // after a problem, tries again after these (then every hour)

let log: Log = () => {};
let port = 8443;
let handler: RequestListener | null = null;
let upgrade: Upgrade | null = null;
let saved = defaults();
let state: 'off' | 'starting' | 'ready' | 'problem' = 'off';
let step = '';          // what it's doing now, while starting
let problem = '';
let server: https.Server | null = null; // the https server, once there's a certificate
let serving = '';       // the certificate it serves
let running: Promise<void> | null = null; // the run going now
let again = false;      // a run was asked for while one was going
let failures = 0;
let retryTimer: NodeJS.Timeout | undefined;
let recordSet = '';     // the address the A record was set to by this run of Studio
let secretCache: string | null = null;

function defaults(): Saved { return { v: 1, on: false, zoneId: '', domain: '', keyId: '', secret: '', name: '', address: '', account: null, cert: '', key: '' }; }

const host = () => (saved.name && saved.domain ? `${saved.name}.${saved.domain}` : '');
const link = () => (state === 'ready' ? `https://${host()}:${port}` : null);
const save = () => { try { savefile.writeJsonSync(FILE, saved); } catch (err) { log('error', 'securelink', `Couldn't save securelink.json: ${errorMessage(err)}`); } };

// ─── The secret ────────────────────────────────────────────────────────────
const security = (args: string[]) => new Promise<string | null>(resolve => execFile('/usr/bin/security', args, { timeout: 10000 }, (err, out) => resolve(err ? null : String(out).trim())));
async function readSecret(): Promise<string> {
  if (!KEYCHAIN) return saved.secret || '';
  if (secretCache === null) secretCache = (await security(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'route53', '-w'])) || '';
  return secretCache;
}
async function writeSecret(secret: string): Promise<boolean> {
  if (!KEYCHAIN) { saved.secret = secret; return true; }
  const ok = (await security(['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', 'route53', '-w', secret])) !== null;
  if (ok) secretCache = secret;
  return ok;
}

// ─── This Mac's address ────────────────────────────────────────────────────
// Its IPv4 address on the network the phones are on: Wi-Fi or Ethernet (en0 first), not a link-local one.
function address(): string {
  if (process.env.SECURELINK_ADDRESS) return process.env.SECURELINK_ADDRESS;
  const all = os.networkInterfaces();
  const names = Object.keys(all).sort((a, b) => (a === 'en0' ? -1 : b === 'en0' ? 1 : a.localeCompare(b)));
  for (const n of names) {
    if (/^(lo|utun|awdl|llw|bridge|vmnet|docker)/.test(n)) continue;
    const a = (all[n] || []).find(i => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'));
    if (a) return a.address;
  }
  return '';
}

// ─── The certificate ───────────────────────────────────────────────────────
function certInfo(pem: string): { expires: Date; names: string[] } | null {
  try {
    const c = new crypto.X509Certificate(pem);
    return { expires: new Date(c.validTo), names: String(c.subjectAltName || '').split(/,\s*/).map(s => s.replace(/^DNS:/, '')) };
  } catch { return null; }
}
function needsCert() {
  const info = saved.cert && saved.key ? certInfo(saved.cert) : null;
  return !info || !info.names.includes(host()) || info.expires.getTime() - Date.now() < RENEW_DAYS * 24 * 3600 * 1000;
}

function serve(): Promise<void> {
  if (server && serving === saved.cert) return Promise.resolve();
  if (server) {
    server.setSecureContext({ cert: saved.cert, key: saved.key });
    serving = saved.cert;
    log('info', 'securelink', 'Serving the new certificate');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const s = handler ? https.createServer({ cert: saved.cert, key: saved.key }, handler) : https.createServer({ cert: saved.cert, key: saved.key });
    if (upgrade) s.on('upgrade', upgrade);
    s.on('tlsClientError', () => {}); // a phone giving up mid-handshake, a scanner: nothing to report
    s.once('error', (err: NodeJS.ErrnoException) => reject(new Error(err.code === 'EADDRINUSE' ? `Port ${port} is in use by another program, so Studio can't answer on https. Set another "securePort" in config.json.` : `Studio couldn't answer on https: ${err.message}`)));
    s.listen(port, () => {
      server = s;
      serving = saved.cert;
      s.on('error', err => log('error', 'securelink', `The https server stopped: ${err.message}`));
      resolve();
    });
  });
}
function stopServing() {
  if (!server) return;
  server.close();
  server.closeAllConnections?.();
  server = null;
  serving = '';
}

// ─── Running it ────────────────────────────────────────────────────────────
function complete() { return !!(saved.zoneId && saved.keyId); }

async function runOnce() {
  clearTimeout(retryTimer);
  if (!saved.on) { stopServing(); state = 'off'; problem = ''; step = ''; return; }
  const secret = await readSecret();
  if (!complete() || !secret) { stopServing(); state = 'problem'; problem = 'Fill in the hosted zone ID, the access key ID and the secret, then turn it on.'; return; }
  if (!saved.name) { saved.name = crypto.randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0').slice(-6); save(); }
  const key = { keyId: saved.keyId, secret };
  if (state !== 'ready') state = 'starting';
  try {
    if (!saved.domain) {
      step = 'Reading the hosted zone\'s name';
      saved.domain = await route53.zoneName(key, saved.zoneId);
      log('info', 'securelink', `The hosted zone is ${saved.domain}`);
      save();
    }
    step = 'Finding this Mac\'s address';
    const addr = address();
    if (!addr) throw new Error('This Mac isn\'t on a network. Join the venue\'s Wi-Fi (or plug in Ethernet) and Studio tries again.');
    // Unchanged since Studio last pointed it (a restart on the same network): nothing to send. A change isn't waited
    // for: Route 53 has it at once, and phones see it within the minute the record lasts.
    if (addr !== recordSet && addr === saved.address && saved.cert && certInfo(saved.cert)?.names.includes(host())) recordSet = addr;
    if (addr !== recordSet) {
      step = `Pointing ${host()} at ${addr}`;
      await route53.change(key, saved.zoneId, { action: 'UPSERT', name: host(), type: 'A', ttl: 60, values: [addr] }, 0);
      recordSet = addr;
      if (saved.address !== addr) { log('info', 'securelink', `${host()} now points at ${addr}`); saved.address = addr; save(); }
    }
    if (needsCert()) {
      step = 'Getting a certificate from Let\'s Encrypt (about a minute)';
      log('info', 'securelink', `Asking Let's Encrypt for a certificate for ${host()}`);
      const txt = { name: `_acme-challenge.${host()}`, type: 'TXT', ttl: 60 } as const;
      const got = await acme.issue({
        name: host(), account: saved.account, log,
        setTxt: value => route53.change(key, saved.zoneId, { ...txt, action: 'UPSERT', values: [value] }),
        clearTxt: value => route53.change(key, saved.zoneId, { ...txt, action: 'DELETE', values: [value] }, 0),
      });
      Object.assign(saved, { cert: got.cert, key: got.key, account: got.account });
      save();
      log('info', 'securelink', `Got a certificate for ${host()}, good until ${certInfo(got.cert)?.expires.toISOString().slice(0, 10)}`);
    }
    step = 'Starting https';
    await serve();
    if (state !== 'ready') log('info', 'securelink', `Ready: ${`https://${host()}:${port}`}`);
    state = 'ready'; problem = ''; step = ''; failures = 0;
  } catch (err) {
    const was = problem;
    problem = errorMessage(err); step = '';
    // A link that was working keeps working (its certificate is still good) through a failed renewal or address change.
    state = server && !needsCertExpired() ? 'ready' : 'problem';
    if (problem !== was) log('warn', 'securelink', problem);
    retryTimer = setTimeout(run, RETRY[Math.min(failures++, RETRY.length - 1)]);
  }
}
function needsCertExpired() { const info = certInfo(saved.cert); return !info || info.expires.getTime() <= Date.now(); }

// At launch: a certificate still good for the name is served at once, before anything is asked of Route 53 (on
// another network, or none yet, the name is pointed at the Mac as soon as it has an address); then the steps run.
async function launch() {
  if (saved.domain && saved.cert && saved.key && !needsCertExpired() && certInfo(saved.cert)?.names.includes(host())) {
    try {
      await serve();
      state = 'ready';
      log('info', 'securelink', `Ready: https://${host()}:${port} (the saved certificate)`);
    } catch (err) { problem = errorMessage(err); }
  }
  run();
}

// Runs the steps, one run at a time (a run asked for during one goes once it ends).
function run(): Promise<void> {
  if (running) { again = true; return running; }
  running = runOnce().finally(() => { running = null; if (again) { again = false; run(); } });
  return running;
}

// Reads securelink.json and starts, if it's on. opts: { log, port, handler, upgrade } (server.ts's request handlers).
function start(opts: { log?: Log; port?: number | string; handler?: RequestListener; upgrade?: Upgrade } = {}): void {
  if (opts.log) log = opts.log;
  if (opts.port) port = Number(opts.port);
  handler = opts.handler || handler;
  upgrade = opts.upgrade || upgrade;
  const read = savefile.readJson<Partial<Saved> | null>(FILE, null, (err, movedTo) => log('error', 'securelink', `securelink.json couldn't be read (${errorMessage(err)})${movedTo ? `; moved aside as ${movedTo}` : ''}`));
  saved = { ...defaults(), ...obj(read) };
  if (saved.on) launch();
  setInterval(() => { if (saved.on && !running && address() !== recordSet) run(); }, ADDRESS_EVERY).unref();
  setInterval(() => { if (saved.on && !running) run(); }, CHECK_EVERY).unref();
}

// What the Devices tab shows (never the secret).
async function status() {
  const info = saved.cert ? certInfo(saved.cert) : null;
  return {
    on: saved.on, zoneId: saved.zoneId, keyId: saved.keyId, hasSecret: !!(await readSecret()),
    domain: saved.domain || null, host: host() || null, port, link: link(), state, step: state === 'starting' ? step : '', problem,
    address: saved.address || null, expires: info ? info.expires.toISOString() : null,
  };
}

// Changes the settings from the Devices tab: { zoneId, keyId, secret ('' or left out keeps it), on }. Any change, or
// none ({}), tries the steps again now. Gives { error } for something that can't be right.
async function set(body: { zoneId?: unknown; keyId?: unknown; secret?: unknown; on?: unknown } = {}): Promise<{ error: string } | Awaited<ReturnType<typeof status>>> {
  const next: Partial<Saved> = {};
  if (body.zoneId !== undefined) {
    const z = route53.zoneIdOf(body.zoneId);
    if (z && !/^Z[A-Z0-9]{4,40}$/.test(z)) return { error: 'A hosted zone ID starts with Z, then capital letters and numbers (Route 53 › Hosted zones).' };
    next.zoneId = z;
  }
  if (body.keyId !== undefined) {
    const k = String(body.keyId || '').trim();
    if (k && !/^[A-Z0-9]{16,128}$/.test(k)) return { error: 'An access key ID is capital letters and numbers, starting AKIA (IAM › Users › Security credentials).' };
    next.keyId = k;
  }
  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  if (secret && !/^\S{20,128}$/.test(secret)) return { error: 'That doesn\'t look like a secret access key: it is about 40 letters, numbers and symbols.' };
  if (body.on !== undefined) next.on = body.on === true;
  if (secret && !(await writeSecret(secret))) return { error: 'Studio couldn\'t keep the secret in the Mac\'s Keychain.' };
  const keyChanged = (next.zoneId !== undefined && next.zoneId !== saved.zoneId) || (next.keyId !== undefined && next.keyId !== saved.keyId) || !!secret;
  Object.assign(saved, next);
  if (keyChanged) { recordSet = ''; saved.domain = ''; } // read the zone's name again: it may be another zone
  save();
  if (next.on !== undefined) log('info', 'securelink', `Secure phone link turned ${saved.on ? 'on' : 'off'}`);
  failures = 0;
  run();
  // Let a quick answer (off, a missing field) land before saying where it is.
  await Promise.race([running, new Promise(r => setTimeout(r, 300))]);
  return status();
}

const linkHost = () => (saved.on ? host() : '');
export { start, status, set, linkHost as host, link };
