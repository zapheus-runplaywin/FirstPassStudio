// FirstPass Studio - following a Blackmagic HyperDeck's timecode over the network, for the 4K replay (replay.js).
//
// A HyperDeck reports where it is through its Ethernet control protocol (text over TCP port 9993). Studio asks it to
// say when its transport changes (notify: transport: true) and asks for its transport info a few times a second as
// well. Each answer gives its status (play, stopped, shuttle, jog, record, preview), its speed (100 is normal play)
// and its timecode (HH:MM:SS:FF), so between answers Studio carries the timecode on by the time passed and the
// speed. The replay follows that: playing, pausing and scrubbing the HyperDeck move the graphics with the video.
//
// Studio only reads: it sends nothing that changes the HyperDeck (no play, stop or record), so its own buttons and
// anything else controlling it carry on as before. It connects only while a replay follows it, and keeps trying
// again while the HyperDeck isn't answering.

'use strict';

const net = require('net');

const PORT = 9993;
const ASK_MS = 250;      // how often the transport info is asked for, beside the HyperDeck's own notices
const RETRY_MS = 3000;   // after the connection drops or can't be made, connect again this often
const QUIET_MS = 3000;   // a connection that hasn't answered this long is taken as lost

// A typed address: an IP address or name, with :port if it isn't the usual 9993.
function parseAddress(text) {
  const s = String(text || '').trim();
  const m = s.match(/^\[?([^\]\s]+?)\]?(?::(\d{1,5}))?$/);
  if (!m || !/^[a-z0-9.-]+$/i.test(m[1])) return null;
  return { address: m[1], port: m[2] ? Number(m[2]) : PORT };
}

// The timecode's frames per second for a video format ("1080p25", "1080i50", "4Kp2997", "720p50", "PAL", "NTSC").
// Above 30 fps the timecode counts frame pairs (SMPTE timecode goes to 30), as does an interlaced format's field rate.
function fpsOf(format) {
  const f = String(format || '');
  if (/^PAL/i.test(f)) return 25;
  if (/^NTSC/i.test(f)) return 30;
  const m = f.match(/[pi](\d{2,4})$/i);
  if (!m) return 25;
  let rate = Number(m[1]);
  if (rate >= 1000) rate /= 100; // 2398, 2997, 5994
  return Math.round(rate > 30 ? rate / 2 : rate);
}

// "19:42:10:12" (or with ; for drop frame) as ms since midnight, at fps frames a second.
function tcMs(tc, fps = 25) {
  const m = String(tc || '').match(/^(\d{2}):(\d{2}):(\d{2})[:;.](\d{2})$/);
  if (!m) return null;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Math.round(Number(m[4]) * 1000 / fps);
}

// The protocol's answers: "200 ok" on a line, or "208 transport info:" followed by "key: value" lines and a blank line.
function parseBlocks(buffer) {
  const out = [];
  let rest = buffer;
  for (;;) {
    const nl = rest.indexOf('\n');
    if (nl < 0) break;
    const first = rest.slice(0, nl).replace(/\r$/, '');
    if (!first) { rest = rest.slice(nl + 1); continue; }
    const head = first.match(/^(\d{3})\s+(.*?)(:?)$/);
    if (!head) { rest = rest.slice(nl + 1); continue; }
    if (!head[3]) { out.push({ code: Number(head[1]), title: head[2], fields: {} }); rest = rest.slice(nl + 1); continue; }
    const end = rest.search(/\r?\n\r?\n/);
    if (end < 0) break; // the rest of the block hasn't come yet
    const fields = {};
    for (const line of rest.slice(nl + 1, end).split(/\r?\n/)) {
      const kv = line.match(/^([^:]+):\s*(.*)$/);
      if (kv) fields[kv[1].trim().toLowerCase()] = kv[2].trim();
    }
    out.push({ code: Number(head[1]), title: head[2], fields });
    rest = rest.slice(end).replace(/^\r?\n\r?\n/, '');
  }
  return { blocks: out, rest };
}

let log = () => {};
let target = null;       // { address, port } while following
let socket = null;
let buffer = '';
let askTimer = null, retryTimer = null;
let conn = 'off';        // off | connecting | connected | lost
let model = '';
let heard = 0;           // when it last answered
let transport = null;    // { status, speed, fps, ms (timecode as ms of the day), at (when it said so), tc }
let error = '';

function init(logger) { log = logger || log; }

function setConn(c, why = '') {
  if (c === conn && why === error) return;
  if (c === 'connected' && conn !== 'connected') log('info', 'hyperdeck', `Following the HyperDeck at ${target.address}${model ? ` (${model})` : ''}`);
  if (c === 'lost' && conn === 'connected') log('warn', 'hyperdeck', `The HyperDeck at ${target.address} stopped answering${why ? `: ${why}` : ''}`);
  conn = c;
  error = why;
}

function onBlock(b) {
  heard = Date.now();
  if (b.code === 500) { model = b.fields.model || ''; setConn('connected'); return; }
  if ((b.code === 208 || b.code === 508) && b.fields) {
    const f = b.fields;
    const prev = transport || {};
    const fps = f['video format'] ? fpsOf(f['video format']) : prev.fps || 25;
    const tc = f['display timecode'] || f.timecode || prev.tc;
    const status = f.status || prev.status || 'stopped';
    const speed = f.speed !== undefined ? Number(f.speed) || 0 : prev.speed ?? 0;
    transport = { status, speed, fps, tc, ms: tcMs(tc, fps), at: Date.now() };
    if (conn !== 'connected') setConn('connected');
  }
}

function connect() {
  clearTimeout(retryTimer);
  if (!target) return;
  setConn(conn === 'connected' ? 'lost' : 'connecting', error);
  buffer = '';
  const s = net.connect({ host: target.address, port: target.port });
  socket = s;
  s.setEncoding('utf8');
  s.setNoDelay(true);
  s.on('connect', () => {
    heard = Date.now();
    s.write('notify: transport: true\r\ntransport info\r\n');
    askTimer = setInterval(() => {
      if (Date.now() - heard > QUIET_MS) { s.destroy(new Error('no answer')); return; }
      s.write('transport info\r\n');
    }, ASK_MS);
  });
  s.on('data', chunk => {
    const { blocks, rest } = parseBlocks(buffer + chunk);
    buffer = rest.length > 65536 ? '' : rest;
    for (const b of blocks) onBlock(b);
  });
  s.on('error', err => { error = err.code === 'ECONNREFUSED' ? 'it refused the connection' : err.message; });
  s.on('close', () => {
    clearInterval(askTimer);
    if (socket !== s) return;
    socket = null;
    transport = null;
    if (!target) return;
    setConn(conn === 'connected' ? 'lost' : conn === 'lost' ? 'lost' : 'connecting', error || 'the connection closed');
    retryTimer = setTimeout(connect, RETRY_MS);
    if (retryTimer.unref) retryTimer.unref();
  });
}

// Follows the HyperDeck at { address, port }, or stops (null).
function follow(to) {
  const same = to && target && to.address === target.address && to.port === target.port;
  if (same) return;
  target = null;
  clearTimeout(retryTimer);
  if (socket) { const s = socket; socket = null; clearInterval(askTimer); s.destroy(); }
  transport = null;
  model = '';
  error = '';
  conn = 'off';
  if (to) { target = { address: to.address, port: to.port || PORT }; connect(); }
}

// Where the video is now: { ms (timecode as ms of the day), playing, speed, tc }, or null when it isn't known.
function now() {
  if (conn !== 'connected' || !transport || transport.ms === null) return null;
  const moving = transport.status === 'play' || transport.status === 'shuttle' || transport.status === 'record';
  const speed = transport.status === 'record' ? 100 : transport.speed;
  const ms = transport.ms + (moving ? (Date.now() - transport.at) * speed / 100 : 0);
  return { ms, playing: moving && speed === 100, speed: moving ? speed : 0, tc: transport.tc, fps: transport.fps };
}

function state() {
  const n = now();
  return { conn, address: target ? (target.port === PORT ? target.address : `${target.address}:${target.port}`) : '', model, error: conn === 'connected' ? '' : error,
    status: transport ? transport.status : '', tc: n ? n.tc : '', playing: !!(n && n.playing) };
}

module.exports = { init, follow, now, state, parseAddress, parseBlocks, fpsOf, tcMs, PORT };
