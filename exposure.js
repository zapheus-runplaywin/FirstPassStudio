// FirstPass Studio - proof of play: when each sponsor was on screen, for the exposure report (Sponsors page,
// sponsorreport.html).
//
// The graphics ask the helper for their sponsor when they load (/api/sponsors/next, /pick and /wall), so
// the helper knows which sponsor each page link was given (gave(), from the request's Referer). Once a
// second it looks at the scene: a source that's on with that link shows those sponsors, and the Sponsor ad
// sources show the sponsor whose ad they're playing; a moment's tag counts for its few seconds (flash()).
// Each stretch on screen is a segment, saved when it ends (and at least once a minute) as one line of
// sponsors/exposure/<night>.jsonl:
//   { t: 'seen', s: sponsor, c: competition, p: place, src: source name, from, to, air, qr }
//   { t: 'play', s: sponsor, c: competition, file, kind, at, air }        one sponsor ad starting
//   { t: 'viewers', c: competition, at, n, by: [{ id, n }] }             live viewers (viewers.js), on air
// air is whether a video output was on: by default the report only counts time on air, so rehearsals
// don't count. A night runs from 4 am to 4 am, so a stream that runs past midnight stays one night.
// Only what plays through the scene is counted (a page used on its own elsewhere can't be seen).

'use strict';

const fs = require('fs');
const path = require('path');
const sponsors = require('./sponsors');
const competitions = require('./competitions');

const DIR = path.join(sponsors.DIR, 'exposure');
const NIGHT_STARTS = 4 * 3600 * 1000;
const JOIN_GAP = 3000; // stretches this close together are one showing in the list
const SAVE_EVERY = 60 * 1000;

let log = () => {};
let showing = () => [];   // the scene's sources that are on: [{ id, name, url, sponsor }]
let onAir = () => false;  // a video output is on
const given = new Map();  // page link -> { ids, place, qr, comp }
const open = new Map();   // sponsor|place|source -> segment
let timer = null;

const pad = n => String(n).padStart(2, '0');
function nightOf(ms) {
  const d = new Date(ms - NIGHT_STARTS);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const linkOf = address => String(address || '').replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');

// A page was given these sponsors. req is the page's request (its Referer is the page's own link).
function gave(req, list, place, opts = {}) {
  const ref = req && req.headers && req.headers.referer;
  if (!ref) return;
  const link = linkOf(ref);
  const ids = (list || []).filter(Boolean).map(s => s.id || s);
  if (!ids.length) { given.delete(link); return; }
  const q = new URL(ref, 'http://studio').searchParams;
  given.set(link, { ids, place: place || 'graphic', qr: !!opts.qr && q.get('qr') !== '0', comp: opts.competition || competitions.activeId() });
}

function append(rec) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, `${nightOf(rec.from || rec.at)}.jsonl`), JSON.stringify(rec) + '\n');
  } catch (err) { log('warn', 'sponsors', `Couldn't save sponsor exposure: ${err.message}`); }
}

function close(key, seg, now) {
  open.delete(key);
  if (now - seg.from < 500) return;
  append({ t: 'seen', ...seg, to: now });
}

// Once a second: start and end the segments for what's on screen now.
function tick(now = Date.now()) {
  const air = !!onAir();
  const want = new Map();
  const add = (s, place, src, qr, comp) => want.set(`${s}|${place}|${src}`, { s, c: comp, p: place, src, air, qr: !!qr });
  for (const src of showing()) {
    if (src.sponsor) { add(src.sponsor, 'ad', src.name, false, competitions.activeId()); continue; }
    const g = src.url && given.get(linkOf(src.url));
    if (g) for (const id of g.ids) add(id, g.place, src.name, g.qr && id === g.ids[0], g.comp);
  }
  for (const [key, seg] of open) {
    const w = want.get(key);
    if (!w || w.air !== seg.air || w.c !== seg.c) close(key, seg, now);
    // Saved at least once a minute, so a stretch isn't lost when Studio stops.
    else if (now - seg.from >= SAVE_EVERY) { close(key, seg, now); open.set(key, { ...w, from: now }); }
  }
  for (const [key, w] of want) if (!open.has(key)) open.set(key, { ...w, from: now });
}

// A sponsor shown for a few seconds by a page that stays on (a moment's "brought to you by" tag): counted
// when that page is on in the scene now.
function flash(req, sponsor, place, seconds, opts = {}) {
  const ref = req && req.headers && req.headers.referer;
  if (!ref || !sponsor) return;
  const link = linkOf(ref);
  const src = showing().find(x => x.url && linkOf(x.url) === link);
  if (!src) return;
  const now = Date.now();
  append({ t: 'seen', s: sponsor.id || sponsor, c: opts.competition || competitions.activeId(), p: place, src: src.name, air: !!onAir(), qr: false, from: now, to: now + Math.round(seconds * 1000) });
}

// A live viewer reading (viewers.js), taken while on air: { total, streams }.
function viewers(st, now = Date.now()) {
  if (!st || !st.streams || !st.streams.length) return;
  append({ t: 'viewers', c: st.competition || competitions.activeId(), at: now, air: true, n: st.total,
    by: st.streams.filter(x => x.live).map(x => ({ id: x.id, n: x.count })) });
}

// One sponsor ad starting to play.
function play(ad) {
  if (!ad || !ad.sponsor) return;
  append({ t: 'play', s: ad.sponsor.id, c: competitions.activeId(), file: ad.file, kind: ad.kind, at: Date.now(), air: !!onAir() });
}

// Saves what's on screen now.
function flush(now = Date.now()) { for (const [key, seg] of [...open]) close(key, seg, now); }

function nights() {
  let names = [];
  try { names = fs.readdirSync(DIR).filter(n => /^\d{4}-\d\d-\d\d\.jsonl$/.test(n)); } catch { /* none yet */ }
  return names.map(n => n.slice(0, 10)).sort().reverse();
}

function read(night) {
  let text = '';
  try { text = fs.readFileSync(path.join(DIR, `${night}.jsonl`), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// A list of [from, to] stretches with the overlaps joined, in order.
function merge(list) {
  const out = [];
  for (const [from, to] of [...list].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}
// Seconds covered by a list of [from, to] stretches, counting overlaps once.
const covered = list => Math.round(merge(list).reduce((n, [from, to]) => n + to - from, 0) / 1000);

// Viewer-minutes over some stretches: the viewers each reading found, held until the next reading (for up to
// two readings' worth of time; with none for longer, nobody is counted). samples: [{ at, n }] in order.
const STALE = 75 * 1000;
function viewerMinutes(list, samples) {
  if (!samples.length) return 0;
  let total = 0;
  for (const [a, b] of merge(list)) {
    let i = -1;
    while (i + 1 < samples.length && samples[i + 1].at <= a) i++;
    for (let t = a; t < b; i++) {
      const end = Math.min(b, i + 1 < samples.length ? samples[i + 1].at : Infinity);
      const cur = samples[i];
      if (cur) { const until = Math.min(end, cur.at + STALE); if (until > t) total += cur.n * (until - t); }
      t = end;
    }
  }
  return Math.round(total / 60000);
}

// The report for these nights (default tonight's) and competition (default the one in use):
// { competition, nights, offAir, sponsors: [{ id, name, tier, seconds, places, plays, qrSeconds, target, showings }] }.
// offAir counts time when no video output was on too (for a stream sent some other way).
function report({ nights: want, competition, offAir = false, now = Date.now() } = {}) {
  const compId = competition || competitions.activeId();
  const list = (want && want.length ? want : [nightOf(now)]).filter(n => /^\d{4}-\d\d-\d\d$/.test(n));
  const recs = list.flatMap(read).filter(r => (!compId || r.c === compId) && (offAir || r.air));
  // Tonight's stretches still on screen count up to now.
  if (list.includes(nightOf(now))) for (const seg of open.values()) if ((!compId || seg.c === compId) && (offAir || seg.air)) recs.push({ t: 'seen', ...seg, to: now });
  const samples = recs.filter(r => r.t === 'viewers').map(r => ({ at: r.at, n: Number(r.n) || 0 })).sort((a, b) => a.at - b.at);
  const rows = new Map();
  const row = id => {
    if (!rows.has(id)) {
      const s = sponsors.byId(id);
      rows.set(id, { id, name: s ? s.name : id, tier: s && compId && s.competitions[compId] ? s.competitions[compId].tier : '',
        gone: !s, stretches: [], qr: [], places: {}, plays: 0, adFiles: {}, showings: [],
        target: { seconds: s ? s.targetSeconds * list.length : 0, plays: s ? s.targetPlays * list.length : 0 } });
    }
    return rows.get(id);
  };
  for (const r of recs.sort((a, b) => (a.from || a.at) - (b.from || b.at))) {
    if (r.t === 'viewers') continue;
    const x = row(r.s);
    if (r.t === 'play') { x.plays++; x.adFiles[r.file] = (x.adFiles[r.file] || 0) + 1; continue; }
    if (r.t !== 'seen') continue;
    x.stretches.push([r.from, r.to]);
    (x.places[r.p] = x.places[r.p] || []).push([r.from, r.to]);
    if (r.qr) x.qr.push([r.from, r.to]);
    const last = x.showings.find(s => s.place === r.p && s.source === r.src && r.from - s.to <= JOIN_GAP && r.to >= s.from);
    if (last) last.to = Math.max(last.to, r.to);
    else x.showings.push({ place: r.p, source: r.src, from: r.from, to: r.to });
  }
  const tierOrder = competitions.SPONSOR_TIERS;
  const out = [...rows.values()].map(x => ({
    id: x.id, name: x.name, tier: x.tier, gone: x.gone,
    seconds: covered(x.stretches), qrSeconds: covered(x.qr), plays: x.plays, adFiles: x.adFiles,
    viewerMinutes: viewerMinutes(x.stretches, samples),
    places: Object.fromEntries(Object.entries(x.places).map(([p, l]) => [p, covered(l)])),
    target: x.target,
    showings: x.showings.sort((a, b) => a.from - b.from).map(s => ({ ...s, seconds: Math.round((s.to - s.from) / 1000) })),
  })).sort((a, b) => (tierOrder.indexOf(a.tier) + 1 || 99) - (tierOrder.indexOf(b.tier) + 1 || 99) || b.seconds - a.seconds);
  const settings = compId ? competitions.get(compId) : null;
  return { competition: compId ? { id: compId, name: settings.displayName || settings.competitionName || settings.name, tiers: competitions.sponsorTiers(settings) } : null,
    nights: list, offAir, sponsors: out,
    // The live viewer readings (viewers.js): the most at once and the average while they were read.
    viewers: samples.length ? { peak: Math.max(...samples.map(x => x.n)), average: Math.round(samples.reduce((n, x) => n + x.n, 0) / samples.length), readings: samples.length } : null };
}

// /api/sponsors/report?nights=2026-10-22,2026-10-15&competition=&offair=1 and /api/sponsors/nights.
async function route(req, res, url, { send }) {
  const q = Object.fromEntries(url.searchParams);
  if (url.pathname === '/api/sponsors/nights') {
    send(res, 200, { tonight: nightOf(Date.now()), nights: nights() });
    return true;
  }
  if (url.pathname === '/api/sponsors/report') {
    send(res, 200, report({ nights: q.nights ? q.nights.split(',') : null, competition: q.competition, offAir: q.offair === '1' }));
    return true;
  }
  return false;
}

function init(logger, hooks = {}) {
  log = logger || log;
  if (hooks.showing) showing = hooks.showing;
  if (hooks.onAir) onAir = hooks.onAir;
  clearInterval(timer);
  if (hooks.every !== 0) {
    timer = setInterval(() => { try { tick(); } catch (err) { log('warn', 'sponsors', `Exposure tick: ${err.message}`); } }, hooks.every || 1000);
    if (timer.unref) timer.unref();
  }
}

module.exports = { init, gave, flash, viewers, tick, play, flush, report, nights, nightOf, route, DIR };
