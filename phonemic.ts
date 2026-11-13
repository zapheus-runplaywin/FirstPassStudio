// FirstPass Studio - a phone as a backup commentator headset: the hand-over between the phone and Output 1's window.
//
// The Commentator page (public/commentator.html) on a paired phone sends the phone's mic (a USB-C interface, a wired
// headset or Bluetooth) straight to the Mac over the venue Wi-Fi with WebRTC: no internet, no relay. Studio only
// passes the two ends' descriptions between them:
//   1. the phone posts its offer (offer()); the first time, Studio adds a mic for that phone (mics.ts, on: 'phone'),
//      named after it, so it gets a card in Mics with its level, mute, low cut, ducking and Silent warning,
//   2. Output 1's window (scene.html, the one mixing the Mac's mics) asks for offers waiting (waiting()), makes the
//      connection and posts its answer (answer()),
//   3. the phone collects the answer (collect()) and the sound flows phone -> Mac directly.
// A phone that starts again (a reconnect, the page reloaded) makes a new offer, which replaces its last one.
// Each description has every address in it (no trickling), which on one network is there at once.
//
// Only a paired phone (devices.ts) or this Mac itself may offer, and only this Mac may see offers and answer them
// (server.ts). Nothing here is saved: a restart of Studio has the phones start again by themselves.

import crypto from 'node:crypto';
import type * as Mics from './mics';
import type { Log } from './types';

// A phone connecting as a mic: its offer, and Output 1's answer once it has picked up.
interface Session { id: string; mic: string; phone: string; name: string; offer: string; answer: string | null; at: number }
type Result = { error: string; gone?: boolean } | Record<string, unknown>;

const OFFER_MS = 30 * 1000;    // an offer nobody answered in this long is dropped (Output 1 is off)
const MAX_SDP = 20000;

let mics: typeof Mics | null = null;
// scene.act({ type: 'micAdd' }): adds, saves and tells the windows; an error's words, or ''.
let addMic: (changes: { name: string; on: 'phone'; phone: string }) => string | null = () => 'Studio isn\'t ready.';
let log: Log = () => {};
const sessions = new Map<string, Session>();

const sdpOk = (s: unknown): s is string => typeof s === 'string' && s.length < MAX_SDP && /^v=0\r?\n/.test(s);
function prune() { for (const [id, s] of sessions) if (Date.now() - s.at > OFFER_MS && !s.answer) sessions.delete(id); }

// phone: { id, name } of the paired device (or this Mac). Gives { session, mic } or { error }.
function offer(phone: { id: string; name?: string }, sdp: unknown): Result {
  if (!sdpOk(sdp)) return { error: 'That isn\'t a WebRTC offer.' };
  if (!mics) return { error: 'Studio isn\'t ready.' };
  prune();
  let m = mics.phoneMic(phone.id);
  if (!m) {
    const err = addMic({ name: phone.name || 'Phone', on: 'phone', phone: phone.id });
    if (err) return { error: `${err} Remove one in Mics on the Output page to add this phone.` };
    m = mics.phoneMic(phone.id);
    if (!m) return { error: 'Studio couldn\'t add the phone as a mic.' };
    log('info', 'phonemic', `${phone.name} is a new phone mic, "${m.name}"`);
  }
  for (const [id, s] of sessions) if (s.mic === m.id) sessions.delete(id);
  const id = crypto.randomBytes(9).toString('base64url');
  sessions.set(id, { id, mic: m.id, phone: phone.id, name: m.name, offer: sdp, answer: null, at: Date.now() });
  log('info', 'phonemic', `${m.name} is connecting`);
  return { session: id, mic: m.name };
}

// The offers Output 1's window hasn't answered yet: [{ session, mic (its id), sdp }].
function waiting() {
  prune();
  return [...sessions.values()].filter(s => !s.answer).map(s => ({ session: s.id, mic: s.mic, sdp: s.offer }));
}

function answer(id: string, sdp: unknown): Result {
  const s = sessions.get(id);
  if (!s) return { error: 'That phone has started again since, or gave up.' };
  if (!sdpOk(sdp)) return { error: 'That isn\'t a WebRTC answer.' };
  s.answer = sdp;
  s.at = Date.now();
  return { ok: true };
}

// The phone asks for its answer: { answer } once there is one, { waiting: true } until then, or { error }.
// mixing: whether Output 1's window is mixing the mics now (mics.live()), to say why nothing answers.
function collect(id: string, phoneId: string, mixing: boolean): Result {
  const s = sessions.get(id);
  if (!s || s.phone !== phoneId) return { error: 'Studio has no such connection: start again.', gone: true };
  if (s.answer) return { answer: s.answer, mic: s.name };
  return { waiting: true, why: mixing ? 'Output 1 is picking up…' : 'Waiting for Output 1: it has to be on for Studio to hear the phone.' };
}

// micsModule: mics.ts; add(changes): adds a mic the way the Output page does (scene.act), giving its error or null.
function init(logger: Log | null, micsModule: typeof Mics, add: typeof addMic): void {
  log = logger || log;
  mics = micsModule;
  addMic = add;
  sessions.clear();
}

export { init, offer, waiting, answer, collect };
