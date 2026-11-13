// FirstPass Studio - signing in to each club's FirstPass HQ, to read its stats.
//
// Every club has its own FirstPass HQ (a Supabase project of its own), listed in hqclubs.json with its club code, name,
// address and public key, the same list HQ's own app is built with. The person running Studio signs in to each club
// whose stats they show with their own Google account, and a club admin gives that person HQ's read-only Studio role
// (the architecture doc's "Studio access" tab; FirstPassHQ PR #209). Nothing is typed into Studio:
//
//   1. signIn(club) makes a PKCE pair and a one-time address on this Mac, http://127.0.0.1:<random port>/<random path>,
//      listening for that one answer for five minutes, and gives the club's Google sign-in page to open in the system
//      browser (server.ts opens it).
//   2. HQ sends the browser back there with a code, which only this Studio can turn into a session, since only it has
//      the PKCE verifier. The browser shows "Signed in" and can be closed.
//   3. Studio checks the person has the Studio role (HQ's has_role('studio')). Without it nothing is kept.
//   4. The refresh token goes in the Mac's Keychain (keychain.ts), one item per club, never in config.json, iCloud Drive
//      or a backup; the short-lived access token stays in memory. hq-signins.json (local folder) keeps only who signed
//      in and when, to show.
//
// Every REFRESH_EVERY, and as Studio starts, each club's session is refreshed and the role checked again. Signing out,
// or HQ refusing the refresh (the session ended) or the role being gone (removed, or the person stood down), deletes
// that club's token and every stat kept from it (firstpass.ts forget()), and the graphics go back to PlayHQ's data for
// that club. When HQ can't be reached the club shows as offline and is tried again later; nothing is deleted.
//
// Nothing from HQ is logged but club codes, counts and what happened (firstpass.ts privateLog()).
//
// create(deps) gives the sign-ins. deps:
//   log            the debug log
//   clubs          the clubs from hqclubs.json (readClubs())
//   tokens         keychain.ts store for the refresh tokens
//   store          firstpass.ts store, whose forget(club) deletes a club's stats
//   metaFile       hq-signins.json
//   fetch, now     for tests
//   timeoutMs      how long the one-time address waits (5 minutes)

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as savefile from './savefile';
import { errorMessage } from './errors';
import { arr, obj, str } from './check';
import { privateLog, validClub } from './firstpass';
import type { Keychain } from './keychain';
import type { Store } from './firstpass';
import type { Log } from './types';

interface Club { code: string; name: string; supabaseUrl: string; anonKey: string }
type State = 'signed-out' | 'signing-in' | 'signed-in' | 'offline';
interface Meta { email: string; since: string }
interface Session { access: string; expiresAt: number }

const REFRESH_EVERY = 30 * 60 * 1000;
const SIGN_IN_MS = 5 * 60 * 1000;
// An access token this close to running out is refreshed before it's used.
const EARLY_MS = 2 * 60 * 1000;

// The clubs in hqclubs.json: [{ code, name, supabaseUrl, anonKey }]. Anything that isn't one is left out: a code is
// capitals and digits, the address https (or http on this computer, for tests).
function readClubs(file: string, log: Log = () => {}): Club[] {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    log('warn', 'hq', `Couldn't read the FirstPass HQ clubs list: ${errorMessage(err)}`);
    return [];
  }
  const seen = new Set<string>();
  const clubs: Club[] = [];
  for (const c of arr(obj(raw).clubs)) {
    const o = obj(c);
    const code = str(o.code).replace(/\s+/g, '').toUpperCase();
    const url = str(o.supabaseUrl).replace(/\/+$/, '');
    if (!validClub(code) || seen.has(code) || !str(o.name) || !str(o.anonKey)) continue;
    if (!/^https:\/\/[^/]+$/.test(url) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) continue;
    seen.add(code);
    clubs.push({ code, name: str(o.name), supabaseUrl: url, anonKey: str(o.anonKey) });
  }
  return clubs;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

// The answer of a call to HQ: ok, the JSON, and whether HQ said no (so retrying won't help) or couldn't be reached.
interface Answer { ok: boolean; status: number; json: unknown; refused: boolean }

function create({ log: rawLog, clubs, tokens, store, metaFile, fetch = globalThis.fetch, now = () => Date.now(), timeoutMs = SIGN_IN_MS }: {
  log: Log; clubs: Club[]; tokens: Keychain; store: Pick<Store, 'forget'>; metaFile: string;
  fetch?: typeof globalThis.fetch; now?: () => number; timeoutMs?: number;
}) {
  const log = privateLog(rawLog);
  const byCode = new Map(clubs.map(c => [c.code, c]));
  const sessions = new Map<string, Session>();
  const states = new Map<string, State>();
  const problems = new Map<string, string>();
  const pending = new Map<string, { server: http.Server; timer: NodeJS.Timeout }>();
  let timer: NodeJS.Timeout | undefined;
  const signOutListeners: ((code: string) => void)[] = [];

  const readMeta = (): Record<string, Meta> => {
    const got = obj(savefile.readJson<unknown>(metaFile, {}));
    const out: Record<string, Meta> = {};
    for (const [k, v] of Object.entries(got)) { const m = obj(v); if (byCode.has(k)) out[k] = { email: str(m.email), since: str(m.since) }; }
    return out;
  };
  const writeMeta = (meta: Record<string, Meta>) => {
    try { savefile.writeJsonSync(metaFile, meta); } catch (err) { log('error', 'hq', `Couldn't save hq-signins.json: ${errorMessage(err)}`); }
  };

  async function call(club: Club, path: string, body: unknown, access?: string): Promise<Answer> {
    try {
      const res = await fetch(club.supabaseUrl + path, {
        method: 'POST',
        headers: { apikey: club.anonKey, 'content-type': 'application/json', ...(access ? { authorization: `Bearer ${access}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      let json: unknown = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { ok: res.ok, status: res.status, json, refused: res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 };
    } catch {
      return { ok: false, status: 0, json: null, refused: false };
    }
  }

  // Keeps a new session: the refresh token in the Keychain (HQ gives a new one each time and the old one stops working).
  async function keep(club: Club, got: unknown): Promise<boolean> {
    const o = obj(got);
    const access = str(o.access_token), refresh = str(o.refresh_token);
    if (!access || !refresh) return false;
    if (!await tokens.set(club.code, refresh)) {
      problems.set(club.code, 'The Mac\'s Keychain wouldn\'t keep the sign-in. Try again, and allow Studio if the Mac asks.');
      return false;
    }
    sessions.set(club.code, { access, expiresAt: now() + (Number(o.expires_in) || 3600) * 1000 });
    return true;
  }

  // Whether the signed-in person holds HQ's Studio role (and isn't stood down): true, false, or null when HQ couldn't say.
  async function hasRole(club: Club, access: string): Promise<boolean | null> {
    const r = await call(club, '/rest/v1/rpc/has_role', { p_role: 'studio' }, access);
    if (r.ok) return r.json === true;
    return r.refused ? false : null;
  }

  // Signs a club out: the token and every stat kept from it go. why is said in the log.
  async function signOut(code: string, why = 'signed out'): Promise<boolean> {
    const club = byCode.get(code);
    if (!club) return false;
    const s = sessions.get(code);
    if (s && why === 'signed out') call(club, '/auth/v1/logout', {}, s.access).catch(() => {}); // ends the session at HQ too, if it can
    sessions.delete(code);
    await tokens.remove(code);
    const meta = readMeta();
    if (meta[code]) { delete meta[code]; writeMeta(meta); }
    states.set(code, 'signed-out');
    if (why !== 'signed out') problems.set(code, why); else problems.delete(code);
    store.forget(code, why);
    for (const fn of signOutListeners) { try { fn(code); } catch { /* a listener's own problem */ } }
    log('info', 'hq', `${code}: ${why}; its sign-in and FirstPass stats are deleted`);
    return true;
  }

  // Refreshes a club's session and checks the role again. Signs it out when HQ says the session or role is gone. One at
  // a time per club: HQ gives a new refresh token each time, and the old one used twice would end the session.
  const refreshing = new Map<string, Promise<boolean>>();
  function refresh(code: string): Promise<boolean> {
    const going = refreshing.get(code);
    if (going) return going;
    const run = refreshNow(code).finally(() => refreshing.delete(code));
    refreshing.set(code, run);
    return run;
  }
  async function refreshNow(code: string): Promise<boolean> {
    const club = byCode.get(code);
    if (!club) return false;
    const token = await tokens.get(code);
    if (!token) { sessions.delete(code); states.set(code, 'signed-out'); return false; }
    const r = await call(club, '/auth/v1/token?grant_type=refresh_token', { refresh_token: token });
    if (!r.ok) {
      if (r.refused) { await signOut(code, 'HQ ended the sign-in'); return false; }
      states.set(code, 'offline');
      problems.set(code, 'FirstPass HQ can\'t be reached; trying again soon. Graphics use PlayHQ\'s data meanwhile.');
      log('warn', 'hq', `${code}: HQ couldn't be reached to refresh the sign-in (${r.status || 'no answer'})`);
      return false;
    }
    if (!await keep(club, r.json)) { states.set(code, 'offline'); return false; }
    const role = await hasRole(club, sessions.get(code)?.access || '');
    if (role === false) { await signOut(code, 'the Studio role was removed or paused in HQ'); return false; }
    states.set(code, role === null ? 'offline' : 'signed-in');
    if (role !== null) problems.delete(code);
    return role === true;
  }

  // An access token for the club, refreshed first when it's about to run out; '' when not signed in.
  async function accessToken(code: string): Promise<string> {
    const s = sessions.get(code);
    if (s && s.expiresAt - now() > EARLY_MS) return s.access;
    return (await refresh(code)) ? sessions.get(code)?.access || '' : '';
  }

  // Starts signing a club in: { url } to open in the system browser, or { error }.
  async function signIn(code: string): Promise<{ url: string } | { error: string }> {
    const club = byCode.get(code);
    if (!club) return { error: `There's no club ${code} in Studio's FirstPass HQ list.` };
    const old = pending.get(code);
    if (old) { clearTimeout(old.timer); old.server.close(); pending.delete(code); }
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const path = `/firstpass-${b64url(crypto.randomBytes(18))}`;
    const server = http.createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const redirect = `http://127.0.0.1:${port}${path}`;
    const done = () => { const p = pending.get(code); if (p && p.server === server) { clearTimeout(p.timer); pending.delete(code); } server.close(); };
    const t = setTimeout(() => {
      done();
      if (states.get(code) === 'signing-in') { states.set(code, sessions.has(code) ? 'signed-in' : 'signed-out'); problems.set(code, 'Sign-in wasn\'t finished in five minutes. Try again.'); }
    }, timeoutMs);
    t.unref();
    pending.set(code, { server, timer: t });
    states.set(code, 'signing-in');
    problems.delete(code);

    server.on('request', (req, res) => {
      const url = new URL(req.url || '/', redirect);
      if (url.pathname !== path) { res.writeHead(404).end(); return; }
      const page = (title: string, text: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] || ch);
        res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;margin:48px;max-width:520px"><h1 style="font-size:22px">${esc(title)}</h1><p>${esc(text)}</p></body>`);
      };
      done();
      const code0 = url.searchParams.get('code');
      if (!code0) {
        const why = url.searchParams.get('error_description') || url.searchParams.get('error') || 'HQ sent no sign-in code.';
        states.set(code, 'signed-out'); problems.set(code, `Sign-in didn't finish: ${why}`);
        page('Not signed in', `Sign-in to ${club.name} didn't finish: ${why} Go back to Studio and try again.`);
        return;
      }
      finish(club, code0, verifier).then(ok => page(ok ? 'Signed in' : 'Not signed in', ok
        ? `Studio is signed in to ${club.name}'s FirstPass HQ. You can close this tab and go back to Studio.`
        : `${problems.get(code) || 'Sign-in didn\'t finish.'} Go back to Studio and try again.`));
    });

    const auth = new URL(`${club.supabaseUrl}/auth/v1/authorize`);
    auth.searchParams.set('provider', 'google');
    auth.searchParams.set('redirect_to', redirect);
    auth.searchParams.set('code_challenge', challenge);
    auth.searchParams.set('code_challenge_method', 's256');
    log('info', 'hq', `${code}: signing in, waiting for the browser`);
    return { url: auth.toString() };
  }

  // Turns the code from the browser into a session, checks the role, keeps it.
  async function finish(club: Club, authCode: string, verifier: string): Promise<boolean> {
    const code = club.code;
    const r = await call(club, '/auth/v1/token?grant_type=pkce', { auth_code: authCode, code_verifier: verifier });
    if (!r.ok) {
      states.set(code, 'signed-out');
      problems.set(code, r.refused ? 'HQ didn\'t accept the sign-in.' : 'FirstPass HQ couldn\'t be reached.');
      log('warn', 'hq', `${code}: sign-in failed (${r.status || 'no answer'})`);
      return false;
    }
    const got = obj(r.json);
    const email = str(obj(got.user).email);
    const role = await hasRole(club, str(got.access_token));
    if (role !== true) {
      call(club, '/auth/v1/logout', {}, str(got.access_token)).catch(() => {});
      states.set(code, 'signed-out');
      problems.set(code, role === false
        ? `${email || 'This account'} doesn't have the Studio role in ${club.name}'s FirstPass HQ. Ask a club admin to add it, then sign in again.`
        : 'FirstPass HQ couldn\'t be reached to check the Studio role. Try again.');
      log('warn', 'hq', `${code}: signed in without the Studio role${role === null ? ' (or HQ couldn\'t say)' : ''}, nothing kept`);
      return false;
    }
    if (!await keep(club, got)) { states.set(code, 'signed-out'); return false; }
    writeMeta({ ...readMeta(), [code]: { email, since: new Date(now()).toISOString() } });
    states.set(code, 'signed-in');
    problems.delete(code);
    log('info', 'hq', `${code}: signed in`);
    return true;
  }

  // Every club, for the Devices tab: { code, name, state, email, since, problem }.
  function list() {
    const meta = readMeta();
    return clubs.map(c => ({
      code: c.code, name: c.name,
      state: states.get(c.code) || (meta[c.code] ? 'signed-in' : 'signed-out'),
      email: meta[c.code]?.email || '', since: meta[c.code]?.since || '',
      problem: problems.get(c.code) || '',
    }));
  }

  // Refreshes every signed-in club now and every REFRESH_EVERY.
  function start() {
    const all = async () => { for (const code of Object.keys(readMeta())) await refresh(code); };
    all().catch(err => log('error', 'hq', `Couldn't refresh the FirstPass HQ sign-ins: ${errorMessage(err)}`));
    if (!timer) { timer = setInterval(() => { all().catch(() => {}); }, REFRESH_EVERY); timer.unref(); }
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    for (const p of pending.values()) { clearTimeout(p.timer); p.server.close(); }
    pending.clear();
  }

  // Called with a club's code whenever it is signed out (hqstats.ts stops following its game).
  const onSignOut = (fn: (code: string) => void) => { signOutListeners.push(fn); };

  return { list, signIn, signOut, refresh, accessToken, start, stop, onSignOut, club: (code: string) => byCode.get(code) || null };
}

type HqAuth = ReturnType<typeof create>;
export type { Club, HqAuth, State };
export { create, readClubs, REFRESH_EVERY };
