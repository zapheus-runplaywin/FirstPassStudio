// FirstPass Studio - playhqnet: what Studio's talk with PlayHQ costs, for the PlayHQ line above the score on the
// Output page's status board (public/output/board.js, through /api/health playhq.net): how long PlayHQ took to answer
// (the ping, timed on a real request), the download over the last minute, and everything downloaded since Studio
// went on air (server.js runs only while on air, so the count starts again each time).
//
// Every request to PlayHQ goes through note() (playhq.js: the guest session, every GraphQL query and the live feed;
// teams.js: the Game Summary), so a new kind of request is counted by calling it too. A practice game asks PlayHQ
// nothing, so it adds nothing.
const WINDOW_MS = 60 * 1000;

// The bytes an answer took on the wire: the Content-Length PlayHQ sends (the compressed size when it compresses),
// else the size of the text read.
function answerBytes(res, text) {
  const header = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
  const len = header == null || header === '' ? NaN : Number(header);
  if (Number.isFinite(len) && len >= 0) return len;
  return text == null ? 0 : Buffer.byteLength(String(text));
}

function create(now = Date.now) {
  const startedAt = now();
  let bytes = 0, requests = 0;
  // The last request answered (any kind), the last live score answer, and whether the latest request failed.
  let last = null, lastLive = null, failedAt = 0;
  const recent = []; // [at, bytes] in the last minute
  const trim = t => { while (recent.length && recent[0][0] <= t - WINDOW_MS) recent.shift(); };

  // A request PlayHQ answered (any HTTP status): how long it took and how big the answer was. live: the live score.
  function note({ ms, bytes: b = 0, live = false } = {}) {
    const t = now();
    b = Math.max(0, Math.round(Number(b) || 0));
    bytes += b; requests += 1;
    recent.push([t, b]); trim(t);
    if (Number.isFinite(ms)) {
      last = { ms: Math.max(0, Math.round(ms)), at: t };
      if (live) lastLive = last;
    }
    failedAt = 0;
  }
  // A request that never got an answer (no internet, the connection cut).
  function failed() { failedAt = now(); requests += 1; }

  function snapshot() {
    const t = now();
    trim(t);
    // The ping is the live score's answer while the live feed is being read (in the last two minutes), else the
    // latest answer of any kind.
    const p = lastLive && t - lastLive.at < 2 * WINDOW_MS ? lastLive : last;
    const span = Math.min(WINDOW_MS, Math.max(1000, t - startedAt));
    const inWindow = recent.reduce((s, r) => s + r[1], 0);
    return {
      pingMs: p ? p.ms : null, pingAgoMs: p ? t - p.at : null, failed: !!failedAt,
      bytesPerSec: Math.round(inWindow / (span / 1000)), bytes, requests, sinceMs: t - startedAt,
    };
  }
  return { note, failed, snapshot };
}

// The one Studio uses, shared by playhq.js and teams.js.
const shared = create();
module.exports = { create, answerBytes, note: shared.note, failed: shared.failed, snapshot: shared.snapshot };
