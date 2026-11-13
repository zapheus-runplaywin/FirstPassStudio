// FirstPass Studio - a certificate from Let's Encrypt, for the secure phone link (securelink.ts).
//
// ACME (RFC 8555) with the DNS-01 challenge: Studio proves it owns <name>.studio.firstpass.pivt.au by putting a TXT
// record in the zone (route53.ts), so nothing on the internet has to reach the Mac, which sits on a venue network with
// a private address. It needs nothing but Node's crypto: P-256 keys, ES256-signed requests, and a certificate signing
// request built here (csr()), since Node can read certificates but not write a request for one.
//
//   const { cert, key } = await issue({ name, account, setTxt, clearTxt, log });
//
// account is { key (PEM), url } from an earlier run, or null to make a new account (no email: Let's Encrypt allows
// that). The answer has the new account too, to save for next time. SECURELINK_ACME_DIRECTORY points it at a stand-in
// for the tests (Let's Encrypt's own staging server works too).

import crypto from 'node:crypto';
import { errorMessage, fetchFailure } from './errors';
import type { Log } from './types';

// What Let's Encrypt answers: a directory, an order, an authorization or a problem. Every field is checked before use.
interface AcmeChallenge { type?: string; url?: string; token?: string; error?: AcmeProblem }
interface AcmeProblem { type?: string; detail?: string }
interface AcmeBody extends AcmeProblem {
  status?: string; authorizations?: string[]; challenges?: AcmeChallenge[]; finalize?: string; certificate?: string; error?: AcmeProblem;
  newNonce?: string; newAccount?: string; newOrder?: string;
}
// The Let's Encrypt account from an earlier run: its key (PEM) and URL.
interface Account { key: string; url: string }

const DIRECTORY = process.env.SECURELINK_ACME_DIRECTORY || 'https://acme-v02.api.letsencrypt.org/directory';
const POLL_MS = () => Number(process.env.SECURELINK_POLL_MS || 2000);
const b64u = (data: string | Buffer) => Buffer.from(data).toString('base64url');

// ─── DER, for the certificate signing request ──────────────────────────────
function der(tagByte: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tagByte]), len, body]);
}
function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [a * 40 + b];
  for (const v of rest) {
    const out = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) out.unshift((x & 0x7f) | 0x80);
    bytes.push(...out);
  }
  return der(0x06, Buffer.from(bytes));
}
const seq = (...p: Buffer[]) => der(0x30, ...p);
const set = (...p: Buffer[]) => der(0x31, ...p);

// A PKCS#10 certificate signing request for one DNS name, signed with key (a P-256 private KeyObject), as DER.
function csr(name: string, key: crypto.KeyObject): Buffer {
  const spki = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const subject = seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from(name)))));
  const san = seq(oid('2.5.29.17'), der(0x04, seq(der(0x82, Buffer.from(name)))));
  const extensionRequest = seq(oid('1.2.840.113549.1.9.14'), set(seq(san)));
  const info = seq(der(0x02, Buffer.from([0])), subject, spki, der(0xa0, extensionRequest));
  const signature = crypto.sign('sha256', info, key); // DER-encoded ECDSA, as X.509 wants
  return seq(info, seq(oid('1.2.840.10045.4.3.2')), der(0x03, Buffer.from([0]), signature));
}

// ─── ACME ──────────────────────────────────────────────────────────────────
const newKey = () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
const publicJwk = (key: crypto.KeyObject) => { const j = crypto.createPublicKey(key).export({ format: 'jwk' }); return { crv: j.crv, kty: j.kty, x: j.x, y: j.y }; };
const thumbprint = (key: crypto.KeyObject) => b64u(crypto.createHash('sha256').update(JSON.stringify(publicJwk(key))).digest());

// What Let's Encrypt's error means, in words.
function explain(problem: AcmeProblem | string | null | undefined, status?: number): string {
  if (typeof problem === 'string') problem = { detail: problem };
  const type = String(problem && problem.type || '').replace(/^urn:ietf:params:acme:error:/, '');
  const detail = String(problem && problem.detail || '');
  if (type === 'rateLimited') return `Let's Encrypt says too many certificates were asked for lately (${detail}). Studio tries again later.`;
  if (type === 'dns' || /NXDOMAIN|SERVFAIL|No TXT record|DNS problem/i.test(detail)) return `Let's Encrypt couldn't find Studio's check record (${detail}). Check the 4 NS records for studio.firstpass in GoDaddy match the Route 53 zone's; a new NS record can take up to an hour to work.`;
  return `Let's Encrypt said no${type ? ` (${type})` : ''}${detail ? `: ${detail}` : ''}${status ? ` [${status}]` : ''}.`;
}

const need = (url: string | null | undefined, what: string): string => {
  if (!url) throw new Error(`Let's Encrypt's answer had no ${what}.`);
  return url;
};

function client(accountKey: crypto.KeyObject, log: Log) {
  let dir: AcmeBody | null = null;
  let nonce: string | null = null;
  let kid: string | null = null;
  const get = async (url: string) => {
    try { return await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch (err) { throw new Error(`Studio couldn't reach Let's Encrypt (${fetchFailure(err)}). Is this Mac on the internet?`); }
  };
  async function directory(): Promise<AcmeBody> {
    if (!dir) {
      const res = await get(DIRECTORY);
      if (!res.ok) throw new Error(`Let's Encrypt answered ${res.status}.`);
      dir = await res.json() as AcmeBody;
    }
    return dir;
  }
  async function freshNonce(): Promise<string | null> {
    const res = await fetch(need((await directory()).newNonce, 'newNonce'), { method: 'HEAD', signal: AbortSignal.timeout(20000) });
    return res.headers.get('replay-nonce');
  }
  // A signed POST (payload null: POST-as-GET). Tries once more with a new nonce when the server says it was stale.
  async function post(url: string, payload: unknown, retry = true): Promise<{ body: AcmeBody; text: string; location: string | null; status: number }> {
    const header = { alg: 'ES256', nonce: nonce || await freshNonce(), url, ...(kid ? { kid } : { jwk: publicJwk(accountKey) }) };
    nonce = null;
    const protectedB64 = b64u(JSON.stringify(header));
    const payloadB64 = payload === null ? '' : b64u(JSON.stringify(payload));
    const signature = crypto.sign('sha256', Buffer.from(`${protectedB64}.${payloadB64}`), { key: accountKey, dsaEncoding: 'ieee-p1363' });
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/jose+json' }, body: JSON.stringify({ protected: protectedB64, payload: payloadB64, signature: b64u(signature) }), signal: AbortSignal.timeout(30000) });
    } catch (err) { throw new Error(`Studio couldn't reach Let's Encrypt (${fetchFailure(err)}). Is this Mac on the internet?`); }
    nonce = res.headers.get('replay-nonce') || null;
    const type = res.headers.get('content-type') || '';
    // JSON (an order, an authorization, a problem) or text (the certificate).
    const text = await res.text();
    let body: AcmeBody = {};
    if (/json/.test(type)) { try { const v: unknown = JSON.parse(text); if (v && typeof v === 'object') body = v; } catch { /* not JSON after all */ } }
    if (!res.ok) {
      if (retry && body.type === 'urn:ietf:params:acme:error:badNonce') return post(url, payload, false);
      throw new Error(explain(/json/.test(type) ? body : text, res.status));
    }
    return { body, text, location: res.headers.get('location'), status: res.status };
  }
  async function account(url: string | null | undefined): Promise<string> {
    if (url) { kid = url; return url; }
    const made = await post(need((await directory()).newAccount, 'newAccount'), { termsOfServiceAgreed: true });
    kid = need(made.location, 'account URL');
    log('info', 'securelink', 'Made a Let\'s Encrypt account for this Mac');
    return kid;
  }
  // Asks again for url (an authorization or an order) until its status isn't one of waiting, up to ms.
  async function until(url: string, waiting: string[], ms: number): Promise<AcmeBody> {
    const end = Date.now() + ms;
    for (;;) {
      const { body } = await post(url, null);
      if (!waiting.includes(String(body.status))) return body;
      if (Date.now() > end) throw new Error('Let\'s Encrypt is taking too long to answer. Studio tries again in a few minutes.');
      await new Promise(r => setTimeout(r, POLL_MS()));
    }
  }
  return { directory, post, account, until };
}

// A certificate for name. setTxt(value) puts the TXT record up (and resolves once it is everywhere), clearTxt(value)
// takes it down again. Gives { cert (the PEM chain), key (PEM), account: { key, url } }.
async function issue({ name, account = null, setTxt, clearTxt = async () => {}, log = () => {} }: {
  name: string; account?: Account | null; setTxt: (value: string) => Promise<void>; clearTxt?: (value: string) => Promise<void>; log?: Log;
}): Promise<{ cert: string; key: string; account: Account }> {
  const accountKey = account && account.key ? crypto.createPrivateKey(account.key) : newKey();
  const acme = client(accountKey, log);
  const accountUrl = await acme.account(account && account.url);
  const { body: order, location: orderUrl } = await acme.post(need((await acme.directory()).newOrder, 'newOrder'), { identifiers: [{ type: 'dns', value: name }] });
  for (const authzUrl of order.authorizations || []) {
    const { body: authz } = await acme.post(authzUrl, null);
    if (authz.status === 'valid') continue;
    const challenge = (authz.challenges || []).find(c => c.type === 'dns-01');
    if (!challenge || !challenge.url) throw new Error('Let\'s Encrypt didn\'t offer the DNS check Studio uses.');
    const value = b64u(crypto.createHash('sha256').update(`${challenge.token}.${thumbprint(accountKey)}`).digest());
    await setTxt(value);
    try {
      await acme.post(challenge.url, {});
      const done = await acme.until(authzUrl, ['pending', 'processing'], 120000);
      if (done.status !== 'valid') {
        const failed = (done.challenges || []).find(c => c.type === 'dns-01');
        throw new Error(explain(failed && failed.error));
      }
    } finally {
      await clearTxt(value).catch(err => log('warn', 'securelink', `Couldn't take the check record down: ${errorMessage(err)}`));
    }
  }
  const certKey = newKey();
  await acme.post(need(order.finalize, 'finalize URL'), { csr: b64u(csr(name, certKey)) });
  const ready = await acme.until(need(orderUrl, 'order URL'), ['pending', 'ready', 'processing'], 120000);
  if (ready.status !== 'valid' || !ready.certificate) throw new Error(explain(ready.error));
  const { text: cert } = await acme.post(ready.certificate, null);
  return {
    cert,
    key: String(certKey.export({ type: 'pkcs8', format: 'pem' })),
    account: { key: String(accountKey.export({ type: 'pkcs8', format: 'pem' })), url: accountUrl },
  };
}

export { issue, csr, thumbprint, publicJwk };
export type { Account };
