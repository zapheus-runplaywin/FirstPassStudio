// FirstPass Studio - Amazon Route 53, for the secure phone link (securelink.ts).
//
// The secure link's names live in a Route 53 hosted zone (PIVT's is studio.firstpass.pivt.au, handed over from GoDaddy
// by its NS records). Studio reads the zone's name from the zone itself (zoneName()), and changes two kinds of record
// in it, with a key that may change only that zone:
//   - an A record, <name>.<zone> -> this Mac's address on the venue network, kept up to date as the address changes,
//   - a TXT record, _acme-challenge.<name>.<zone>, for a minute while Let's Encrypt checks Studio owns the name.
// Each change waits until Route 53 says every one of its name servers has it (INSYNC).
//
// Requests are signed with AWS Signature Version 4 (sign()), using Node's own crypto: no AWS SDK.
// SECURELINK_ROUTE53_URL points it at a stand-in for the tests.

import crypto from 'node:crypto';
import { fetchFailure } from './errors';

const ENDPOINT = process.env.SECURELINK_ROUTE53_URL || 'https://route53.amazonaws.com';
const REGION = 'us-east-1'; // Route 53 is global; it signs as us-east-1
const SERVICE = 'route53';
const API = '/2013-04-01';
const NS = 'https://route53.amazonaws.com/doc/2013-04-01/';

// An AWS access key: its ID and secret.
interface Key { keyId: string; secret: string }
// A record set change: UPSERT or DELETE a record's values.
interface Change { action: 'UPSERT' | 'DELETE' | 'CREATE'; name: string; type: string; ttl: number; values: string[] }

const sha256 = (data: string) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();
const escapeXml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (xml: string, name: string) => { const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml); return m ? m[1] : ''; };

// The headers that sign a request, AWS Signature Version 4: { 'x-amz-date', authorization }.
// req: { method, path (with any query after ?), host, body }; key: { keyId, secret }; at: a Date.
function sign(req: { method: string; path: string; host: string; body?: string }, key: Key, at = new Date(), region = REGION, service = SERVICE) {
  const amzDate = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const [pathname, query = ''] = String(req.path).split('?');
  const canonicalQuery = query.split('&').filter(Boolean).map(p => p.split('=')).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v = '']) => `${k}=${v}`).join('&');
  const canonical = [req.method, pathname, canonicalQuery, `host:${req.host}`, `x-amz-date:${amzDate}`, '', 'host;x-amz-date', sha256(req.body || '')].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${key.secret}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex');
  return { 'x-amz-date': amzDate, authorization: `AWS4-HMAC-SHA256 Credential=${key.keyId}/${scope}, SignedHeaders=host;x-amz-date, Signature=${signature}` };
}

// What a Route 53 error means for the person setting the link up, in words.
function explain(status: number, code: string, message: string): string {
  if (code === 'InvalidClientTokenId' || code === 'UnrecognizedClientException') return 'AWS doesn\'t know that access key ID. Check it, or make a new access key for the firstpass-studio-dns user.';
  if (code === 'SignatureDoesNotMatch') return 'AWS turned the secret down. Paste the secret access key again (AWS shows it only once; make a new access key if it is lost).';
  if (code === 'AccessDenied' || status === 403) return 'The key isn\'t allowed to change that zone. Check the FirstPassStudioDNS policy names this hosted zone ID, and that it is attached to the user.';
  if (code === 'NoSuchHostedZone') return 'AWS has no hosted zone with that ID. Copy the Hosted zone ID (it starts with Z) from Route 53 › Hosted zones.';
  if (code === 'InvalidChangeBatch') return `Route 53 refused the change: ${message}`;
  if (code === 'RequestExpired') return 'AWS says this Mac\'s clock is out. Set the date and time automatically in System Settings › General › Date & Time.';
  return `Route 53 answered ${status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`;
}

async function call(key: Key, method: string, path: string, body = ''): Promise<string> {
  const url = new URL(API + path, ENDPOINT);
  const headers: Record<string, string> = { ...sign({ method, path: url.pathname + url.search, host: url.host, body }, key) };
  if (body) headers['content-type'] = 'text/xml';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body || undefined, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new Error(`Studio couldn't reach Route 53 (${fetchFailure(err)}). Is this Mac on the internet?`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(explain(res.status, tag(text, 'Code'), tag(text, 'Message')));
  return text;
}

// A hosted zone ID as pasted: Z..., or /hostedzone/Z... as some AWS pages show it.
const zoneIdOf = (s: unknown) => String(s || '').trim().replace(/^\/?hostedzone\//i, '');

// The zone's name (studio.firstpass.pivt.au), from its first record: Route 53 lists a zone's records by name, so the
// first is always one of the zone's own (its NS or SOA). Needs only route53:ListResourceRecordSets on the zone.
async function zoneName(key: Key, zoneId: string): Promise<string> {
  const answer = await call(key, 'GET', `/hostedzone/${encodeURIComponent(zoneIdOf(zoneId))}/rrset?maxitems=1`);
  const name = tag(answer, 'Name').replace(/\.$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) throw new Error('Studio couldn\'t read the hosted zone\'s name from Route 53.');
  return name;
}

// Changes one record set and waits until every Route 53 name server has it (up to waitMs).
// change: { action: 'UPSERT' | 'DELETE', name, type: 'A' | 'TXT', ttl, values: [...] }.
async function change(key: Key, zoneId: string, c: Change, waitMs = 120000): Promise<void> {
  const records = c.values.map(v => `<ResourceRecord><Value>${escapeXml(c.type === 'TXT' ? `"${v}"` : v)}</Value></ResourceRecord>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ChangeResourceRecordSetsRequest xmlns="${NS}"><ChangeBatch><Comment>FirstPass Studio secure link</Comment><Changes><Change>`
    + `<Action>${c.action}</Action><ResourceRecordSet><Name>${escapeXml(c.name)}</Name><Type>${c.type}</Type><TTL>${c.ttl}</TTL><ResourceRecords>${records}</ResourceRecords></ResourceRecordSet>`
    + '</Change></Changes></ChangeBatch></ChangeResourceRecordSetsRequest>';
  const answer = await call(key, 'POST', `/hostedzone/${encodeURIComponent(zoneIdOf(zoneId))}/rrset`, xml);
  let id = tag(answer, 'Id').replace(/^\/change\//, '');
  let status = tag(answer, 'Status');
  const until = Date.now() + waitMs;
  while (waitMs > 0 && status !== 'INSYNC' && id) {
    if (Date.now() > until) throw new Error('Route 53 took the change but its name servers haven\'t all got it yet. Studio tries again in a few minutes.');
    await new Promise(r => setTimeout(r, Number(process.env.SECURELINK_POLL_MS || 3000)));
    status = tag(await call(key, 'GET', `/change/${encodeURIComponent(id)}`), 'Status');
  }
}

export { sign, change, zoneName, zoneIdOf, explain };
export type { Key, Change };
