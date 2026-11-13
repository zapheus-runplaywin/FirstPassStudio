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


import fs from 'node:fs';
import * as datadir from './datadir';
import * as savefile from './savefile';
import * as competitions from './competitions';
import { errorMessage } from './errors';
import { arr, obj, str } from './check';
import type { Stream } from './competitions';
import type { Body, Log, ReadBody, Send } from './types';
import type { IncomingMessage, ServerResponse } from 'node:http';

// What Studio last read of one stream.
interface Status { count?: number; live?: boolean; video?: string; title?: string; error?: string; at?: number; findAt?: number; channel?: string }
// The viewers now: the total, each stream and tonight's peak (state()).
type State = ReturnType<typeof state>;

const KEYS_FILE = datadir.local('stream-keys.json');
const YOUTUBE = process.env.FIRSTPASS_YOUTUBE_API || 'https://www.googleapis.com/youtube/v3';
const FACEBOOK = process.env.FIRSTPASS_FACEBOOK_API || 'https://graph.facebook.com/v21.0';
const EVERY = 30 * 1000;
const FIND_EVERY = 5 * 60 * 1000;

let log: Log = () => {};
let onAir = () => false;
let record: (s: State) => void = () => {};
let timer: NodeJS.Timeout | undefined;
// Per stream ("competition stream").
const status = new Map<string, Status>();
// The most watching at once tonight, per competition: "competition night" -> { n, at }. A night runs to 4 am.
const peaks = new Map<string, { n: number; at: number }>();
const nightOf = (ms: number) => { const d = new Date(ms - 4 * 3600 * 1000); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

// The keys and tokens: competition -> stream -> key.
function readKeys(): Record<string, Record<string, string>> { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')) || {}; } catch { return {}; } }
function keyFor(compId: string, streamId: string): string { return ((readKeys()[compId] || {})[streamId]) || ''; }
// Saves keys for a competition's streams: { streamId: key }; '' removes one. Keys of streams that have gone are dropped.
function saveKeys(compId: string, keys: unknown): void {
  const all = readKeys();
  const streams = new Set(streamsOf(compId).map(s => s.id));
  const mine = { ...(all[compId] || {}) };
  for (const [id, k] of Object.entries(obj(keys))) {
    const v = String(k ?? '').trim().slice(0, 500);
    if (v) mine[id] = v; else delete mine[id];
  }
  for (const id of Object.keys(mine)) if (!streams.has(id)) delete mine[id];
  all[compId] = mine;
  savefile.writeJsonSync(KEYS_FILE, all, { mode: 0o600 });
}

function streamsOf(compId: string | null): Stream[] {
  if (!compId) return [];
  try { return competitions.get(compId).streams || []; } catch { return []; }
}

// YouTube's or Facebook's answer, unchecked.
async function getJson(url: string): Promise<Body> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const body = obj(await res.json().catch(() => ({})));
  if (!res.ok) {
    const error = obj(body.error);
    const msg = error.message || error.error_user_msg || `answered ${res.status}`;
    throw new Error(String(msg).replace(/<[^>]+>/g, ''));
  }
  return body;
}

// A YouTube "where": { video } for a video link or ID, { channel } for a channel ID, { handle } for @name.
function youtubeWhere(where: unknown): { video?: string; channel?: string; handle?: string } {
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

async function youtube(st: Status, stream: Stream, key: string, now: number): Promise<void> {
  const where = youtubeWhere(stream.where);
  if (!where.video && !where.channel && !where.handle) throw new Error('Add the channel ID, @handle or the live video link');
  if (where.video) st.video = where.video;
  if (!st.video) {
    if (st.findAt && now < st.findAt) return; // looked a moment ago: not live then
    st.findAt = now + FIND_EVERY;
    if (!st.channel) {
      if (where.channel) st.channel = where.channel;
      else {
        const c = await getJson(`${YOUTUBE}/channels?part=id&forHandle=${encodeURIComponent(where.handle ?? '')}&key=${encodeURIComponent(key)}`);
        const items = arr(c.items);
        if (!items.length) throw new Error(`There is no YouTube channel ${where.handle}`);
        st.channel = str(obj(items[0]).id);
      }
    }
    const s = await getJson(`${YOUTUBE}/search?part=id&channelId=${st.channel}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(key)}`);
    st.video = str(obj(obj(arr(s.items)[0]).id).videoId);
    if (!st.video) { st.live = false; st.count = 0; return; }
  }
  const v = await getJson(`${YOUTUBE}/videos?part=liveStreamingDetails,snippet&id=${st.video}&key=${encodeURIComponent(key)}`);
  const item = obj(arr(v.items)[0]), details = obj(item.liveStreamingDetails);
  const live = !!item.liveStreamingDetails && !details.actualEndTime && details.concurrentViewers !== undefined;
  st.title = str(obj(item.snippet).title);
  st.live = live;
  st.count = live ? Number(details.concurrentViewers) || 0 : 0;
  // The video ended (or isn't live yet): look for the channel's next live video, unless the link named this one.
  if (!live && !where.video) { st.video = ''; st.findAt = now + FIND_EVERY; }
}

function facebookPage(where: unknown): string {
  const w = String(where || '').trim();
  const m = w.match(/facebook\.com\/(?:profile\.php\?id=(\d+)|([\w.-]+))/i);
  return m ? (m[1] || m[2]) : w.replace(/^@/, '');
}

async function facebook(st: Status, stream: Stream, token: string): Promise<void> {
  const page = facebookPage(stream.where);
  if (!page) throw new Error("Add the Page's ID or link");
  const r = await getJson(`${FACEBOOK}/${encodeURIComponent(page)}/live_videos?broadcast_status=${encodeURIComponent('["LIVE"]')}&fields=id,title,live_views&limit=1&access_token=${encodeURIComponent(token)}`);
  const first = arr(r.data)[0], v = obj(first);
  st.live = !!first;
  st.video = str(v.id);
  st.title = str(v.title);
  st.count = Number(v.live_views) || 0;
}

// Reads every stream of the competition in use once. Returns the state.
async function check(compId = competitions.activeId(), now = Date.now()): Promise<State> {
  const streams = streamsOf(compId);
  await Promise.all(streams.map(async s => {
    const k = `${compId} ${s.id}`;
    const st: Status = status.get(k) || {};
    status.set(k, st);
    const key = compId ? keyFor(compId, s.id) : '';
    try {
      if (!key) throw new Error(s.platform === 'facebook' ? 'Add a Page access token' : 'Add a YouTube API key');
      if (s.platform === 'facebook') await facebook(st, s, key); else await youtube(st, s, key, now);
      if (st.error) log('info', 'viewers', `${s.name || s.platform}: working again`);
      st.error = '';
    } catch (err) {
      if (st.error !== errorMessage(err)) log('warn', 'viewers', `${s.name || s.platform}: ${errorMessage(err)}`);
      st.error = errorMessage(err);
      st.live = false;
      st.count = 0;
    }
    st.at = now;
  }));
  const s = state(compId);
  const key = `${compId} ${nightOf(now)}`;
  const peak = peaks.get(key);
  if (s.live && (!peak || s.total > peak.n)) peaks.set(key, { n: s.total, at: now });
  return state(compId, now);
}

// What the Output page and setup page show: the total watching now and each stream.
function state(compId = competitions.activeId(), now = Date.now()) {
  const keys = (compId && readKeys()[compId]) || {};
  const streams = streamsOf(compId).map(s => {
    const st: Status = status.get(`${compId} ${s.id}`) || {};
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
async function route(req: IncomingMessage, res: ServerResponse, url: URL, { send, readBody }: { send: Send; readBody: ReadBody }): Promise<boolean> {
  const q = Object.fromEntries(url.searchParams);
  const compId = q.competition || competitions.activeId();
  if (url.pathname === '/api/viewers/keys' && req.method === 'POST') {
    const b = await readBody(req);
    const id = str(b.competition) || compId;
    if (!id) throw new Error('Make or import a competition first.');
    saveKeys(id, b.keys);
    log('info', 'viewers', `${id}: saved stream keys`, { streams: Object.keys(obj(b.keys)) });
    send(res, 200, state(id));
    return true;
  }
  if (url.pathname === '/api/viewers') {
    send(res, 200, q.check ? await check(compId) : state(compId));
    return true;
  }
  return false;
}

function init(logger: Log | null, hooks: { onAir?: () => boolean; record?: (s: State) => void; every?: number } = {}): void {
  log = logger || log;
  if (hooks.onAir) onAir = hooks.onAir;
  if (hooks.record) record = hooks.record;
  clearInterval(timer);
  if (hooks.every !== 0) {
    timer = setInterval(() => { tick().catch(err => log('warn', 'viewers', errorMessage(err))); }, hooks.every || EVERY);
    if (timer.unref) timer.unref();
  }
}

export { init, check, state, tick, route, saveKeys, youtubeWhere, facebookPage, KEYS_FILE };
