// FirstPass Studio - a phone as a backup commentator headset: the hand-over between the phone and Output 1's window.
//
// The Commentator page (public/commentator.html) on a paired phone sends the phone's mic (a USB-C interface, a wired
// headset or Bluetooth) straight to the Mac over the venue Wi-Fi with WebRTC: no internet, no relay. Studio only
// passes the two ends' descriptions between them:
//   1. the phone posts its offer (offer()); the first time, Studio adds a mic for that phone (mics.js, on: 'phone'),
//      named after it, so it gets a card in Mics with its level, mute, low cut, ducking and Silent warning,
//   2. Output 1's window (scene.html, the one mixing the Mac's mics) asks for offers waiting (waiting()), makes the
//      connection and posts its answer (answer()),
//   3. the phone collects the answer (collect()) and the sound flows phone -> Mac directly.
// A phone that starts again (a reconnect, the page reloaded) makes a new offer, which replaces its last one.
// Each description has every address in it (no trickling), which on one network is there at once.
//
// Only a paired phone (devices.js) or this Mac itself may offer, and only this Mac may see offers and answer them
// (server.js). Nothing here is saved: a restart of Studio has the phones start again by themselves.

'use strict';

const crypto = require('crypto');

const OFFER_MS = 30 * 1000;    // an offer nobody answered in this long is dropped (Output 1 is off)
const MAX_SDP = 20000;

let mics = null;
let addMic = () => 'Studio isn\'t ready.'; // scene.act({ type: 'micAdd' }): adds, saves and tells the windows
let log = () => {};
const sessions = new Map(); // session id -> { id, mic, phone, name, offer, answer, at }

const sdpOk = s => typeof s === 'string' && s.length < MAX_SDP && /^v=0\r?\n/.test(s);
function prune() { for (const [id, s] of sessions) if (Date.now() - s.at > OFFER_MS && !s.answer) sessions.delete(id); }

// phone: { id, name } of the paired device (or this Mac). Gives { session, mic } or { error }.
function offer(phone, sdp) {
  if (!sdpOk(sdp)) return { error: 'That isn\'t a WebRTC offer.' };
  prune();
  let m = mics.phoneMic(phone.id);
  if (!m) {
    const err = addMic({ name: phone.name || 'Phone', on: 'phone', phone: phone.id });
    if (err) return { error: `${err} Remove one in Mics on the Output page to add this phone.` };
    m = mics.phoneMic(phone.id);
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

function answer(id, sdp) {
  const s = sessions.get(id);
  if (!s) return { error: 'That phone has started again since, or gave up.' };
  if (!sdpOk(sdp)) return { error: 'That isn\'t a WebRTC answer.' };
  s.answer = sdp;
  s.at = Date.now();
  return { ok: true };
}

// The phone asks for its answer: { answer } once there is one, { waiting: true } until then, or { error }.
// mixing: whether Output 1's window is mixing the mics now (mics.live()), to say why nothing answers.
function collect(id, phoneId, mixing) {
  const s = sessions.get(id);
  if (!s || s.phone !== phoneId) return { error: 'Studio has no such connection: start again.', gone: true };
  if (s.answer) return { answer: s.answer, mic: s.name };
  return { waiting: true, why: mixing ? 'Output 1 is picking up…' : 'Waiting for Output 1: it has to be on for Studio to hear the phone.' };
}

// micsModule: mics.js; add(changes): adds a mic the way the Output page does (scene.act), giving its error or null.
function init(logger, micsModule, add) {
  log = logger || log;
  mics = micsModule;
  addMic = add;
  sessions.clear();
}

module.exports = { init, offer, waiting, answer, collect };
