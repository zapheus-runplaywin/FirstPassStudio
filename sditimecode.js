// FirstPass Studio - following the timecode coming into a Blackmagic UltraStudio's SDI input, for the 4K replay
// (replay.js), as hyperdeck.js does over the network.
//
// SDI carries timecode (RP188) with every frame, so any player sending SDI into the UltraStudio gives a running
// timecode: a HyperDeck's monitor or SDI output, a deck, a switcher's output. The Mac app reads it (native/decklink,
// desktop/decklink.js readInput) while a replay follows it and sends it here each time it changes, and every half
// second besides. A timecode moving on a frame at a time is playing; one that stays the same is stopped, and one
// jumping is scrubbing. Between changes it runs on by the time passed. HDMI carries no timecode, so the HDMI input
// can't be used for this. Only in the Mac app: the helper on its own has no Blackmagic device to read.

'use strict';

const { tcMs } = require('./hyperdeck');

const QUIET_MS = 1500; // nothing from the Mac app this long: it isn't reading
const RETRY_MS = 3000; // while it isn't, ask again this often (the UltraStudio plugged in, another app letting go of it)

let log = () => {};
let port = null;
let want = null;       // { device } while following
let sample = null;     // { ms, fps, timecode, at, name, signal, error }: the latest from the Mac app
let changedAt = 0;     // when the timecode last changed
let step = 0;          // by how much it last changed, in ms
let base = 0;          // the timecode's ms when it last changed
let retry = null;

function init(logger, { port: p = process.parentPort || null } = {}) {
  log = logger || log;
  port = p;
  if (port) port.on('message', e => { const m = (e && e.data) || e || {}; if (m.type === 'sdiTimecode') heard(m); });
}

// A reading from the Mac app: { name, signal, timecode, fps, at, error }.
function heard(m) {
  if (!want) return;
  const fps = Math.round(Number(m.fps) > 30 ? Number(m.fps) / 2 : Number(m.fps)) || 25;
  const ms = m.signal ? tcMs(m.timecode, fps) : null;
  const at = Date.now();
  if (ms !== null && (!sample || sample.ms !== ms)) {
    step = sample && sample.ms !== null ? ms - sample.ms : 0;
    changedAt = at;
    base = ms;
  }
  const was = sample;
  sample = { ms, fps, timecode: String(m.timecode || ''), at, name: String(m.name || ''), signal: !!m.signal, error: String(m.error || '') };
  if (sample.error && (!was || was.error !== sample.error)) log('warn', 'sditimecode', `Timecode from the SDI input: ${sample.error}`);
}

// Follows the SDI input of { device } (an id, or '' for the first with an input), or stops (null).
function follow(to) {
  const same = to && want && to.device === want.device;
  if (same) return;
  want = to ? { device: String(to.device || '') } : null;
  sample = null;
  changedAt = 0;
  clearInterval(retry);
  retry = null;
  if (!port) return;
  port.postMessage({ type: 'readTimecode', device: want ? want.device : null });
  if (!want) return;
  log('info', 'sditimecode', 'Following the timecode coming into the SDI input');
  retry = setInterval(() => { if (want && !fresh()) port.postMessage({ type: 'readTimecode', device: want.device }); }, RETRY_MS);
  if (retry.unref) retry.unref();
}

const frameMs = () => 1000 / ((sample && sample.fps) || 25);
const fresh = () => sample && Date.now() - sample.at < QUIET_MS;

// Where the video is now: { ms, playing, speed, tc }, or null when it isn't known.
function now() {
  if (!want || !fresh() || sample.ms === null || !changedAt) return null;
  const since = Date.now() - changedAt;
  // Playing: it moved on by about a frame, and not long ago (a stopped player keeps sending the same timecode).
  const playing = step > 0 && step <= 2.5 * frameMs() && since < 3 * frameMs();
  return { ms: base + (playing ? since : 0), playing, speed: playing ? 100 : 0, tc: sample.timecode, fps: sample.fps };
}

function state() {
  const n = now();
  const conn = !want ? 'off' : !port ? 'error' : fresh() ? (sample.error ? 'error' : 'connected') : sample ? 'lost' : 'connecting';
  return { conn, model: sample ? sample.name : '', error: !port ? 'Only in the Mac app.' : sample ? sample.error || (sample.signal ? (sample.timecode ? '' : 'no timecode in the signal') : 'no signal') : '',
    status: n ? (n.playing ? 'play' : 'stopped') : '', tc: sample ? sample.timecode : '', playing: !!(n && n.playing), signal: !!(sample && sample.signal) };
}

module.exports = { init, follow, now, state, heard };
