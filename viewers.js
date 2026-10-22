// FirstPass Studio - live viewer numbers from where the competition streams: any number of YouTube channels
// and Facebook Pages (Competitions setup, Live viewers), added up for the Output page and the sponsor report.
//
// Each competition lists its streams (competition setting streams: [{ id, platform, name, where }]):
//   youtube   where = a channel ID (UC…), a handle (@name), a channel link, or the live video's own link.
//             Needs a YouTube Data API key (Google Cloud, free). Studio finds the channel's live video with a
//             search (100 of the key's 10,000 daily units, so at most every 5 minutes, only while nothing is
//             found), then reads its viewers with videos.list (1 unit) every 30 seconds.
//   facebook  where = the Page's ID, name or link. Needs a Page access token (from a Meta app the Page's admin
//             makes; no review needed for their own Page). Reads the Page's live video's live_views.
// The keys and tokens are kept on this Mac only (stream-keys.json in the local folder: never in iCloud,
// templates or exports), by competition and stream.
// Studio only asks while a video output is on (on air), or when Check now is pressed on the setup page.
// Each reading while on air is saved with the sponsor exposure log (exposure.viewers), for viewer-minutes.

'use strict';

const fs = require('fs');
const datadir = require('./datadir');
const competitions = require('./competitions');

const KEYS_FILE = datadir.local('stream-keys.json');
const YOUTUBE = process.env.FIRSTPASS_YOUTUBE_API || 'https://www.googleapis.com/youtube/v3';
const FACEBOOK = process.env.FIRSTPASS_FACEBOOK_API || 'https://graph.facebook.com/v21.0';
const EVERY = 30 * 1000;
const FIND_EVERY = 5 * 60 * 1000;

let log = () => {};
let onAir = () => false;
let record = () => {};
let timer = null;
// Per stream ("competition stream"): { count, live, video, title, error, at, findAt, channel }
const status = new Map();
// The most watching at once tonight, per competition: "competition night" -> { n, at }. A night runs to 4 am.
const peaks = new Map();
const nightOf = ms => { const d = new Date(ms - 4 * 3600 * 1000); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

function readKeys() { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')) || {}; } catch { return {}; } }
function keyFor(compId, streamId) { return ((readKeys()[compId] || {})[streamId]) || ''; }
// Saves keys for a competition's streams: { streamId: key }; '' removes one. Keys of streams that have gone are dropped.
function saveKeys(compId, keys) {
  const all = readKeys();
  const streams = new Set(streamsOf(compId).map(s => s.id));
  const mine = { ...(all[compId] || {}) };
  for (const [id, k] of Object.entries(keys || {})) {
    const v = String(k ?? '').trim().slice(0, 500);
    if (v) mine[id] = v; else delete mine[id];
  }
  for (const id of Object.keys(mine)) if (!streams.has(id)) delete mine[id];
  all[compId] = mine;
  fs.writeFileSync(KEYS_FILE, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
}

function streamsOf(compId) {
  if (!compId) return [];
  try { return competitions.get(compId).streams || []; } catch { return []; }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body && body.error && (body.error.message || body.error.error_user_msg) || `answered ${res.status}`;
    throw new Error(String(msg).replace(/<[^>]+>/g, ''));
  }
  return body;
}

// A YouTube "where": { video } for a video link or ID, { channel } for a channel ID, { handle } for @name.
function youtubeWhere(where) {
  const w = String(where || '').trim();
  let m = w.match(/(?:youtu\.be\/|[?&]v=|\/live\/|\/shorts\/)([\w-]{11})/);
  if (m) return { video: m[1] };
  m = w.match(/(UC[\w-]{22})/);
  if (m) return { channel: m[1] };
  m = w.match(/@([\w.-]{3,100})/);
  if (m) return { handle: '@' + m[1] };
  if (/^[\w-]{11}$/.test(w)) return { video: w };
  return {};
}

async function youtube(st, stream, key, now) {
  const where = youtubeWhere(stream.where);
  if (!where.video && !where.channel && !where.handle) throw new Error('Add the channel ID, @handle or the live video link');
  if (where.video) st.video = where.video;
  if (!st.video) {
    if (st.findAt && now < st.findAt) return; // looked a moment ago: not live then
    st.findAt = now + FIND_EVERY;
    if (!st.channel) {
      if (where.channel) st.channel = where.channel;
      else {
        const c = await getJson(`${YOUTUBE}/channels?part=id&forHandle=${encodeURIComponent(where.handle)}&key=${encodeURIComponent(key)}`);
        if (!c.items || !c.items.length) throw new Error(`There is no YouTube channel ${where.handle}`);
        st.channel = c.items[0].id;
      }
    }
    const s = await getJson(`${YOUTUBE}/search?part=id&channelId=${st.channel}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(key)}`);
    st.video = s.items && s.items[0] && s.items[0].id && s.items[0].id.videoId || '';
    if (!st.video) { st.live = false; st.count = 0; return; }
  }
  const v = await getJson(`${YOUTUBE}/videos?part=liveStreamingDetails,snippet&id=${st.video}&key=${encodeURIComponent(key)}`);
  const item = v.items && v.items[0];
  const live = item && item.liveStreamingDetails && !item.liveStreamingDetails.actualEndTime && item.liveStreamingDetails.concurrentViewers !== undefined;
  st.title = item && item.snippet ? item.snippet.title : '';
  st.live = !!live;
  st.count = live ? Number(item.liveStreamingDetails.concurrentViewers) || 0 : 0;
  // The video ended (or isn't live yet): look for the channel's next live video, unless the link named this one.
  if (!live && !where.video) { st.video = ''; st.findAt = now + FIND_EVERY; }
}

function facebookPage(where) {
  const w = String(where || '').trim();
  const m = w.match(/facebook\.com\/(?:profile\.php\?id=(\d+)|([\w.-]+))/i);
  return m ? (m[1] || m[2]) : w.replace(/^@/, '');
}

async function facebook(st, stream, token) {
  const page = facebookPage(stream.where);
  if (!page) throw new Error("Add the Page's ID or link");
  const r = await getJson(`${FACEBOOK}/${encodeURIComponent(page)}/live_videos?broadcast_status=${encodeURIComponent('["LIVE"]')}&fields=id,title,live_views&limit=1&access_token=${encodeURIComponent(token)}`);
  const v = r.data && r.data[0];
  st.live = !!v;
  st.video = v ? v.id : '';
  st.title = v ? v.title || '' : '';
  st.count = v ? Number(v.live_views) || 0 : 0;
}

// Reads every stream of the competition in use once. Returns the state.
async function check(compId = competitions.activeId(), now = Date.now()) {
  const streams = streamsOf(compId);
  await Promise.all(streams.map(async s => {
    const k = `${compId} ${s.id}`;
    const st = status.get(k) || {};
    status.set(k, st);
    const key = keyFor(compId, s.id);
    try {
      if (!key) throw new Error(s.platform === 'facebook' ? 'Add a Page access token' : 'Add a YouTube API key');
      if (s.platform === 'facebook') await facebook(st, s, key); else await youtube(st, s, key, now);
      if (st.error) log('info', 'viewers', `${s.name || s.platform}: working again`);
      st.error = '';
    } catch (err) {
      if (st.error !== err.message) log('warn', 'viewers', `${s.name || s.platform}: ${err.message}`);
      st.error = err.message;
      st.live = false;
      st.count = 0;
    }
    st.at = now;
  }));
  const s = state(compId);
  const key = `${compId} ${nightOf(now)}`;
  if (s.live && (!peaks.has(key) || s.total > peaks.get(key).n)) peaks.set(key, { n: s.total, at: now });
  return state(compId, now);
}

// What the Output page and setup page show: the total watching now and each stream.
function state(compId = competitions.activeId(), now = Date.now()) {
  const keys = readKeys()[compId] || {};
  const streams = streamsOf(compId).map(s => {
    const st = status.get(`${compId} ${s.id}`) || {};
    return { id: s.id, platform: s.platform, name: s.name, where: s.where, hasKey: !!keys[s.id],
      live: !!st.live, count: st.count || 0, title: st.title || '', error: st.error || '', at: st.at || 0 };
  });
  const live = streams.filter(s => s.live);
  let minimum = 0;
  try { minimum = compId ? Number(competitions.get(compId).viewersMinimum) || 0 : 0; } catch { /* no competition */ }
  return { competition: compId, total: live.reduce((n, s) => n + s.count, 0), live: live.length, streams, every: EVERY / 1000,
    peak: peaks.get(`${compId} ${nightOf(now)}`) || null, minimum };
}

async function tick() {
  if (!onAir()) return;
  const compId = competitions.activeId();
  if (!streamsOf(compId).length) return;
  const s = await check(compId);
  record(s);
}

// /api/viewers (GET the state; ?check=1 reads them now) and /api/viewers/keys (POST { competition, keys }).
async function route(req, res, url, { send, readBody }) {
  const q = Object.fromEntries(url.searchParams);
  const compId = q.competition || competitions.activeId();
  if (url.pathname === '/api/viewers/keys' && req.method === 'POST') {
    const b = await readBody(req);
    const id = b.competition || compId;
    if (!id) throw new Error('Make or import a competition first.');
    saveKeys(id, b.keys);
    log('info', 'viewers', `${id}: saved stream keys`, { streams: Object.keys(b.keys || {}) });
    send(res, 200, state(id));
    return true;
  }
  if (url.pathname === '/api/viewers') {
    send(res, 200, q.check ? await check(compId) : state(compId));
    return true;
  }
  return false;
}

function init(logger, hooks = {}) {
  log = logger || log;
  if (hooks.onAir) onAir = hooks.onAir;
  if (hooks.record) record = hooks.record;
  clearInterval(timer);
  if (hooks.every !== 0) {
    timer = setInterval(() => { tick().catch(err => log('warn', 'viewers', err.message)); }, hooks.every || EVERY);
    if (timer.unref) timer.unref();
  }
}

module.exports = { init, check, state, tick, route, saveKeys, youtubeWhere, facebookPage, KEYS_FILE };
