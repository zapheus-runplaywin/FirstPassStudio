// FirstPass Studio - the Socials tab (socials.html): pictures of a game night for social media, saved as PNGs.
//
// The pictures are drawn by social.html (one graphic per link, at Instagram's square, portrait or Stories size) from
// what Studio already has: the season's fixture, read through the same cache as every other page (so the tab adds
// nothing to what PlayHQ is asked), the Production Planner's court and commentators, the competition's sponsors and
// logos. The Mac app takes the pictures (desktop/socials.js): the helper asks it over the app's message port, it
// draws each link off screen at its full size and saves the PNGs in Pictures/FirstPass Studio/, then opens the folder
// or the Mac's Share menu. Without the Mac app (npm start) the previews work and Export says it needs the app.
//
// Saved per competition in competitions/<id>/socials.json: { mark, sponsor: { <kind>: true|false } }, the Studio
// mark in the corner and which graphics carry the sponsor strip, kept week to week. Photos dropped on a polaroid stay
// on this Mac only (socials-photos/ in the local folder, never in a backup or iCloud); the oldest go after PHOTOS_KEPT.
//
// Routes (server.js hands every /api/socials and /socials/ request here):
//   GET  /api/socials                    the game nights, the settings and whether pictures can be saved (the app)
//   GET  /api/socials/night?date=        one night for social.html: its games, the streamed court, sponsors, look
//   POST /api/socials/settings           { mark, sponsor: { kind: bool } }
//   POST /api/socials/photo?name=x.jpg   the photo's bytes; answers { photo } for social.html's ?photo=
//   GET  /socials/photos/<file>          a dropped photo
//   POST /api/socials/export             { date, set, share, items: [{ name, link, size }] }: the app saves them

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uploads = require('./uploads');

// The sizes Instagram takes: a square post, a portrait post (the most room in the feed) and a Story.
const SIZES = {
  square: { width: 1080, height: 1080, label: 'Square' },
  portrait: { width: 1080, height: 1350, label: 'Portrait' },
  story: { width: 1080, height: 1920, label: 'Story' },
};
// Each graphic and whether it carries the sponsor strip until that's changed on the tab.
const KINDS = { fixtures: true, matchup: true, onstream: true, polaroid: false };
const PHOTO_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const PHOTOS_KEPT = 40;
const MAX_PHOTO = 40 * 1024 * 1024;
const MAX_ITEMS = 120;
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const slotOf = g => String(g.time || '').slice(0, 5);
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function create({ log, competitions, savefile, photosDir, byDate, onStream, about, logoFor, sponsorsFor, appPort = process.parentPort || null }) {
  const PHOTOS = photosDir;

  // ─── Settings ─────────────────────────────────────────────────────────────
  const fileOf = id => path.join(competitions.DIR, id, 'socials.json');
  function settings() {
    let d = {};
    const id = competitions.activeId();
    if (id) try { d = JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { /* not changed yet */ }
    const sponsor = {};
    for (const [k, on] of Object.entries(KINDS)) sponsor[k] = d.sponsor && typeof d.sponsor[k] === 'boolean' ? d.sponsor[k] : on;
    return { mark: d.mark !== false, sponsor };
  }
  function saveSettings(body) {
    const id = competitions.activeId();
    if (!id) throw new Error('Set up a competition first, on the Competitions setup page.');
    const now = settings();
    if (typeof body.mark === 'boolean') now.mark = body.mark;
    for (const k of Object.keys(KINDS)) if (body.sponsor && typeof body.sponsor[k] === 'boolean') now.sponsor[k] = body.sponsor[k];
    savefile.writeJsonSync(fileOf(id), now);
    return now;
  }

  // ─── The nights ───────────────────────────────────────────────────────────
  const team = t => ({ name: t.name, logo: logoFor(t.name), score: t.score ?? null });
  const brief = g => ({ id: g.id, time: slotOf(g), court: g.court || '', venue: g.venue || '', division: g.division || '', round: g.round || '',
    home: team(g.home), away: team(g.away) });

  async function list() {
    const dates = await byDate();
    const today = localDate();
    const nights = Object.keys(dates).sort().map(date => {
      const games = dates[date];
      const rounds = [...new Set(games.map(g => g.round).filter(Boolean))];
      return { date, games: games.length, rounds: rounds.length === 1 ? rounds[0] : [...new Set(games.map(g => `${g.division} ${g.round}`))].join(', '), past: date < today };
    });
    const next = (nights.find(n => n.date >= today) || nights[nights.length - 1] || {}).date || '';
    return { nights, next, today, sizes: SIZES, settings: settings(), app: !!appPort };
  }

  // One night, for social.html: every game (all courts, in time order), the court Studio streams with who is on the
  // mic (from the Production Planner, or null when the night isn't planned), the top sponsors and the competition.
  async function night(q = {}) {
    const dates = await byDate();
    const all = Object.keys(dates).sort();
    const today = localDate();
    const date = isDate(q.date) ? q.date : (all.find(d => d >= today) || all[all.length - 1] || today);
    const games = (dates[date] || []).map(brief);
    let stream = null;
    try {
      stream = await onStream(date);
    } catch (err) { log('warn', 'socials', `No Production Planner for ${date}: ${err.message}`); }
    const a = about();
    const venues = [...new Set(games.map(g => g.venue).filter(Boolean))];
    return { date, today: date === today, competition: a.competition || '', competitionLogo: a.logo || null,
      venue: a.venue || venues[0] || '', games, stream, sponsors: sponsorsFor(), settings: settings() };
  }

  // ─── Photos ───────────────────────────────────────────────────────────────
  function savePhoto(name, buf) {
    const ext = (path.extname(String(name || '')).toLowerCase() || '.jpg');
    if (!PHOTO_TYPES[ext]) throw new Error('Drop a JPEG, PNG or WebP photo.');
    if (!buf.length) throw new Error('That photo is empty.');
    uploads.checkImage(`photo${ext}`, buf);
    fs.mkdirSync(PHOTOS, { recursive: true });
    const file = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20) + ext;
    fs.writeFileSync(path.join(PHOTOS, file), buf);
    // Keep the newest few: a polaroid is made once, so old match photos needn't pile up on the Mac.
    const old = fs.readdirSync(PHOTOS).map(f => ({ f, t: fs.statSync(path.join(PHOTOS, f)).mtimeMs })).sort((x, y) => y.t - x.t).slice(PHOTOS_KEPT);
    for (const { f } of old) fs.rmSync(path.join(PHOTOS, f), { force: true });
    log('info', 'socials', `Photo added for a polaroid: ${file} (${Math.round(buf.length / 1024)} KB)`);
    return file;
  }
  const photoFile = f => (/^[a-f0-9]{20}\.(jpe?g|png|webp)$/.test(f) ? path.join(PHOTOS, f) : null);

  // ─── Saving the pictures (the Mac app) ────────────────────────────────────
  const waiting = new Map();
  if (appPort) appPort.on('message', e => {
    const m = e.data || {};
    if (m.type !== 'socialsSaved' || !waiting.has(m.id)) return;
    const done = waiting.get(m.id);
    waiting.delete(m.id);
    done(m);
  });
  const SETS = { upcoming: 'Upcoming', results: 'Results' };
  // A file name from a picture's name: letters, digits, spaces and a few marks, never a path.
  const fileName = s => String(s || '').replace(/[^\p{L}\p{N} '&()+,.-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Picture';
  async function save(body, port) {
    if (!appPort) throw Object.assign(new Error('Saving the pictures needs the FirstPass Studio app on the Mac. The previews here are what they will look like.'), { status: 501 });
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    if (!items.length) throw Object.assign(new Error('Tick at least one picture to save.'), { status: 400 });
    const date = isDate(body.date) ? body.date : localDate();
    const set = SETS[body.set] || SETS.upcoming;
    const used = new Set();
    const pictures = items.map((it, i) => {
      const size = SIZES[it.size];
      const link = String(it.link || '');
      // Only Studio's own social graphic is drawn, never another page or address.
      if (!size || !/^\/social\.html\?[^\s#]*$/.test(link)) throw Object.assign(new Error(`Picture ${i + 1} isn't one of the Socials tab's.`), { status: 400 });
      let name = `${String(i + 1).padStart(2, '0')} ${fileName(it.name)} (${size.label.toLowerCase()})`;
      while (used.has(name)) name += ' 2';
      used.add(name);
      return { file: `${name}.png`, url: `http://localhost:${port}${link}`, width: size.width, height: size.height };
    });
    const competition = fileName(about().competition || 'Studio');
    const folder = `${competition} ${date} ${set}`;
    const id = crypto.randomUUID();
    const answer = new Promise(resolve => {
      waiting.set(id, resolve);
      setTimeout(() => { if (waiting.delete(id)) resolve({ error: 'The Mac app took too long to save the pictures.' }); }, EXPORT_TIMEOUT_MS).unref();
    });
    log('info', 'socials', `Saving ${pictures.length} pictures for ${date} (${set})${body.share ? ' to share' : ''}`);
    appPort.postMessage({ type: 'socialsSave', id, folder, pictures, share: body.share === true });
    const m = await answer;
    if (m.error) { log('warn', 'socials', `Saving the pictures for ${date}: ${m.error}`); throw Object.assign(new Error(m.error), { status: 500 }); }
    log('info', 'socials', `Saved ${m.files.length} pictures in ${m.folder}`);
    return { folder: m.folder, files: m.files.map(f => path.basename(f)), shared: !!m.shared };
  }

  async function route(req, res, url, { send, readBody, readRaw, port }) {
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    try {
      if (p === '/api/socials' && req.method === 'GET') return send(res, 200, await list()), true;
      if (p === '/api/socials/night' && req.method === 'GET') return send(res, 200, await night(q)), true;
      if (p === '/api/socials/settings' && req.method === 'POST') return send(res, 200, { settings: saveSettings(await readBody(req)) }), true;
      if (p === '/api/socials/photo' && req.method === 'POST') return send(res, 200, { photo: savePhoto(q.name, await readRaw(req, MAX_PHOTO)) }), true;
      if (p === '/api/socials/export' && req.method === 'POST') return send(res, 200, await save(await readBody(req), port)), true;
      const photo = /^\/socials\/photos\/([^/]+)$/.exec(p);
      if (photo && req.method === 'GET') {
        const file = photoFile(photo[1]);
        if (!file || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain'), true;
        return send(res, 200, fs.readFileSync(file), PHOTO_TYPES[path.extname(file)], { ...uploads.SERVE_HEADERS, 'cache-control': 'max-age=86400' }), true;
      }
    } catch (err) {
      return send(res, err.status || 400, { error: err.message }), true;
    }
    return false;
  }

  return { route, list, night, settings, saveSettings, savePhoto, SIZES, KINDS };
}

module.exports = { create, SIZES, KINDS };
