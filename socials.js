// FirstPass Studio - the Socials tab (socials.html): pictures of a game night for social media, saved as PNGs.
//
// The pictures are drawn by social.html (one graphic per link, at Instagram's square, portrait or Stories size) from
// what Studio already has: the season's fixture and results, read through the same cache as every other page (so the
// tab adds nothing to what PlayHQ is asked), the ladders, the night's shooting from each finished game's line ups (read
// once and kept, as for Top shooters), the Production Planner's court and commentators, the competition's sponsors
// and logos. Two sets: Upcoming (before the night) and Results (after it). The Mac app takes the pictures (desktop/socials.js): the helper asks it over the app's message port, it
// draws each link off screen at its full size and saves the PNGs in Pictures/FirstPass Studio/, then opens the folder
// or the Mac's Share menu. Without the Mac app (npm start) the previews work and Export says it needs the app.
//
// Saved per competition in competitions/<id>/socials.json: { mark, pivt, sponsor: { <kind>: true|false }, colours,
// colourSets: [{ id, name, ground, highlight, accent }], template, favourites: [<template id>], favouritesOnly }: the
// FirstPass Studio mark and the PIVT logo in the corners, which graphics carry the sponsor strip, the colour set in use
// and the ones made by hand, the template set, and the template sets starred (and whether the tab lists only those),
// kept week to week. Photos dropped on a polaroid stay
// on this Mac only (socials-photos/ in the local folder, never in a backup or iCloud); the oldest go after PHOTOS_KEPT.
//
// Routes (server.js hands every /api/socials and /socials/ request here):
//   GET  /api/socials                    the game nights, the settings and whether pictures can be saved (the app)
//   GET  /api/socials/night?date=        one night for social.html: its games and results, the streamed court, sponsors,
//                                        look (&colours= a colour set and &template= a template set, else the ones picked); &with=ladders adds the ladder of each division that played, &with=shooters
//                                        the night's top shooters (each with their photo when approved; &division= one
//                                        division's, as on the Socials tab's Top shooters picture per division); &home= &away= &athlete= the
//                                        athletes picked for a picture (picked, with their approved photo)
//   GET  /api/socials/athletes           the athletes with a photo they approved the use of, to pick for a picture
//   POST /api/socials/settings           { mark, pivt, sponsor: { kind: bool }, colours: <set id>, colourSets: [...], template: <id>,
//                                        favourites: [<template id>], favouritesOnly: bool }
//   POST /api/socials/photo?name=x.jpg   the photo's bytes; answers { photo } for social.html's ?photo=
//   GET  /socials/photos/<file>          a dropped photo
//   POST /api/socials/export             { date, set: upcoming|results, share, zip, items: [{ name, link, size }] }: the
//                                        app saves them (and a zip of them with zip: true)

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uploads = require('./uploads');
const { isFinished } = require('./playhq');
const { TEMPLATE_FONTS } = require('./fonts');

// The sizes Instagram takes: a square post, a portrait post (the most room in the feed) and a Story.
const SIZES = {
  square: { width: 1080, height: 1080, label: 'Square' },
  portrait: { width: 1080, height: 1350, label: 'Portrait' },
  story: { width: 1080, height: 1920, label: 'Story' },
};
// Each graphic and whether it carries the sponsor strip until that's changed on the tab. Upcoming: fixtures, matchup,
// onstream, commentators (the commentary team's headshots) and a polaroid; Results: results, fulltime, ladder, topshooters and a polaroid per game.
const KINDS = { fixtures: true, matchup: true, onstream: true, commentators: true, polaroid: false, results: true, fulltime: true, ladder: true, topshooters: true };
const SHOOTERS_SHOWN = 6;
const MAX_OWN_SETS = 12;
// The template sets: the look of every picture (public/social-templates.css, a class t-<id> on social.html's body),
// each with its display face (fonts.js TEMPLATE_FONTS) and, for the ones that keep their own ground whatever the
// colours, which FirstPass Studio mark goes on it: light (the dark-ink one, on a pale ground) or white.
// A template font's stylesheet; script is a second face some templates use for one word (--sfont).
function fontCss(font) { return `vendor/fonts/${TEMPLATE_FONTS[font]}/${TEMPLATE_FONTS[font]}.css`; }
const TEMPLATES = [
  { id: 'default', name: 'Default', blurb: 'The stream\'s own look', font: null },
  { id: 'dynamic', name: 'Dynamic', blurb: 'Speed lines and slanted panels', font: 'Anton' },
  { id: 'junior', name: 'Junior', blurb: 'Bright paper and chunky cards', font: 'Fredoka', mark: 'light' },
  { id: 'retro', name: 'Retro', blurb: 'Cream paper and sunset stripes', font: 'Bungee', mark: 'light' },
  { id: 'professional', name: 'Professional', blurb: 'Broadcast clean and calm', font: 'IBM Plex Sans' },
  { id: 'thunder', name: 'Thunder', blurb: 'A storm and a lightning bolt', font: 'Teko', mark: 'white' },
  { id: 'gradient', name: 'Gradient', blurb: 'A colour mesh under frosted glass', font: 'Sora', mark: 'white' },
  { id: 'highcontrast', name: 'High contrast', blurb: 'Black, white and the highlight', font: 'Archivo Black', mark: 'white' },
  { id: 'neon', name: 'Neon', blurb: 'Glowing shards on dark navy', font: 'Archivo Black', mark: 'white' },
  { id: 'poster', name: 'Poster', blurb: 'Huge stacked words and colour bars', font: 'Anton', mark: 'light' },
  { id: 'splash', name: 'Splash', blurb: 'Paint shapes on white', font: 'Oswald', mark: 'light' },
  { id: 'gameday', name: 'Game Day', blurb: 'Charcoal slabs, the highlight and a tall bold face', font: 'Anton', mark: 'white' },
  { id: 'hero', name: 'Hero', blurb: 'A huge slanted title, athletes standing in front of it', font: 'Anton', mark: 'light' },
  { id: 'final', name: 'Final', blurb: 'A bold colour, a tall title and a script word', font: 'Anton', script: 'Yellowtail', mark: 'white' },
  { id: 'court', name: 'Court', blurb: 'A netball court: its lines, thirds and circles', font: 'Oswald', mark: 'white' },
  { id: 'bib', name: 'Bib', blurb: 'A netball bib with its position letters', font: 'Archivo Black', mark: 'white' },
  { id: 'goal', name: 'Goal', blurb: 'The goal ring, net and post, and a netball', font: 'Teko', mark: 'white' },
  { id: 'bottle', name: 'Bottle', blurb: 'A squeeze bottle and cool water', font: 'Sora', mark: 'white' },
  { id: 'cones', name: 'Cones', blurb: 'Training cones and a drill line across the field', font: 'Fredoka', mark: 'white' },
  { id: 'sneakers', name: 'Sneakers', blurb: 'A court shoe, its tread and a thick sole', font: 'Archivo Black', mark: 'white' },
  { id: 'stadium', name: 'Stadium', blurb: 'Floodlights over the stands at night', font: 'Teko', mark: 'white' },
  { id: 'locker', name: 'Locker room', blurb: 'Locker doors with name labels', font: 'Oswald', mark: 'white' },
].map(t => ({ ...t, fontCss: t.font ? fontCss(t.font) : null, scriptCss: t.script ? fontCss(t.script) : null }));
// Sets dropped from the list, each drawn as the closest one kept, so a saved choice or an old link still works.
const RETIRED = { fun: 'default', geometric: 'default', futuristic: 'neon', '3d': 'neon', striped: 'gameday', arena: 'highcontrast' };
const templateOf = id => TEMPLATES.find(t => t.id === (RETIRED[id] || id)) || null;
const HEX = /^#[0-9a-f]{6}$/i;
const PHOTO_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const PHOTOS_KEPT = 40;
const MAX_PHOTO = 40 * 1024 * 1024;
const MAX_ITEMS = 120;
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const slotOf = g => String(g.time || '').slice(0, 5);
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function create({ log, competitions, savefile, photosDir, byDate, onStream, about, logoFor, sponsorsFor, ladderFor, tallyShooters, superShots,
  theme, photoFor = () => null, athletesWithPhotos = () => [], appPort = process.parentPort || null }) {
  const PHOTOS = photosDir;

  // ─── Settings ─────────────────────────────────────────────────────────────
  const fileOf = id => path.join(competitions.DIR, id, 'socials.json');
  function settings() {
    let d = {};
    const id = competitions.activeId();
    if (id) try { d = JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { /* not changed yet */ }
    const sponsor = {};
    for (const [k, on] of Object.entries(KINDS)) sponsor[k] = d.sponsor && typeof d.sponsor[k] === 'boolean' ? d.sponsor[k] : on;
    const colourSets = Array.isArray(d.colourSets) ? d.colourSets.filter(ownSet) : [];
    const colours = typeof d.colours === 'string' && allSets(colourSets).some(x => x.id === d.colours) ? d.colours : 'competition';
    const template = templateOf(d.template)?.id || 'default';
    return { mark: d.mark !== false, pivt: d.pivt !== false, sponsor, colours, colourSets, template, favourites: favouritesOf(d.favourites), favouritesOnly: d.favouritesOnly === true };
  }
  // Starred template sets, in the list's order; a retired one counts as the set it is now drawn as.
  const favouritesOf = list => Array.isArray(list) ? TEMPLATES.map(t => t.id).filter(id => list.some(x => templateOf(x)?.id === id)) : [];
  const ownSet = x => x && /^own-\d+$/.test(x.id) && typeof x.name === 'string' && [x.ground, x.highlight, x.accent].every(c => HEX.test(c));
  function saveSettings(body) {
    const id = competitions.activeId();
    if (!id) throw new Error('Set up a competition first, on the Competitions setup page.');
    const now = settings();
    if (typeof body.mark === 'boolean') now.mark = body.mark;
    if (typeof body.pivt === 'boolean') now.pivt = body.pivt;
    for (const k of Object.keys(KINDS)) if (body.sponsor && typeof body.sponsor[k] === 'boolean') now.sponsor[k] = body.sponsor[k];
    if (Array.isArray(body.colourSets)) {
      if (body.colourSets.length > MAX_OWN_SETS) throw new Error(`Keep it to ${MAX_OWN_SETS} colour sets of your own.`);
      now.colourSets = body.colourSets.map((x, i) => ({ id: /^own-\d+$/.test(x && x.id) ? x.id : `own-${Date.now()}${i}`,
        name: String((x && x.name) || '').trim().slice(0, 30) || 'My colours', ground: x && x.ground, highlight: x && x.highlight, accent: x && x.accent }));
      if (!now.colourSets.every(ownSet)) throw new Error('A colour set needs three colours, each like #7f4092.');
    }
    if (typeof body.colours === 'string') {
      if (!allSets(now.colourSets).some(x => x.id === body.colours)) throw new Error('There is no such colour set.');
      now.colours = body.colours;
    }
    if (!allSets(now.colourSets).some(x => x.id === now.colours)) now.colours = 'competition';
    if (typeof body.template === 'string') {
      if (!templateOf(body.template)) throw new Error('There is no such template set.');
      now.template = templateOf(body.template).id;
    }
    if (Array.isArray(body.favourites)) {
      if (!body.favourites.every(x => templateOf(x))) throw new Error('There is no such template set.');
      now.favourites = favouritesOf(body.favourites);
    }
    if (typeof body.favouritesOnly === 'boolean') now.favouritesOnly = body.favouritesOnly;
    savefile.writeJsonSync(fileOf(id), now);
    return now;
  }

  // ─── Colour sets ──────────────────────────────────────────────────────────
  // Made from the competition's main, highlight and accent colours (Competitions setup), so they follow it when its
  // colours change: each swaps which colour is the ground (behind everything), the highlight (titles, times, points)
  // and the accent (stripes, the v, pills). Then a Night and a Day version, and one with only two colours. Plus the
  // ones made by hand on the tab. Competition colours is the competition's own look, exactly as on the stream.
  const { mix } = competitions;
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10; };
  const isLight = hex => lum(hex) > 0.4;
  function madeSets() {
    const c = theme().colours;
    const { main: m, highlight: h, accent: a } = c;
    return [
      { id: 'competition', name: 'Competition colours', ground: m, highlight: h, accent: a },
      { id: 'accent-first', name: 'Accent first', ground: m, highlight: a, accent: h },
      { id: 'highlight-ground', name: 'Highlight ground', ground: h, highlight: m, accent: a },
      { id: 'accent-ground', name: 'Accent ground', ground: a, highlight: h, accent: m },
      { id: 'night', name: 'Night', ground: mix(m, '#05060c', 0.7), highlight: h, accent: a },
      { id: 'day', name: 'Day', ground: mix(h, '#ffffff', 0.85), highlight: m, accent: a },
      { id: 'two-colours', name: 'Two colours', ground: m, highlight: h, accent: h },
    ];
  }
  // Every set, each with contrast: its highlight against its ground (3 is the least for big titles).
  function allSets(own) {
    return [...madeSets(), ...own.map(x => ({ ...x, own: true }))].map(x => ({ ...x, contrast: contrast(x.highlight, x.ground) }));
  }
  // The look of a set for social.html: theme.css's colour variables worked out for it (null for the competition's own),
  // light: a pale ground, which takes dark text and the dark-ink Studio mark, and the template set drawn with it.
  function look(id, own, templateId = 'default') {
    const t = templateOf(templateId) || TEMPLATES[0];
    const template = { id: t.id, name: t.name, font: t.font, fontCss: t.fontCss, script: t.script || null, scriptCss: t.scriptCss, mark: t.mark || null };
    return { ...colourLook(id, own), template };
  }
  function colourLook(id, own) {
    const set = allSets(own).find(x => x.id === id) || allSets(own)[0];
    const { colours: c, panelOpacity } = theme();
    if (set.id === 'competition') return { colours: set.id, name: set.name, light: !isLight(c.text), vars: null };
    const g = set.ground, light = isLight(g);
    const text = light ? mix(c.panel, '#000000', 0.35) : '#ffffff';
    const vars = competitions.colourVars({
      main: g, dark: light ? mix(g, '#000000', 0.1) : mix(g, '#000000', 0.42),
      panel: light ? mix(g, '#ffffff', 0.6) : mix(g, '#000000', 0.68), panelAlt: light ? mix(g, '#ffffff', 0.45) : mix(g, '#000000', 0.55),
      highlight: set.highlight, accent: set.accent, text, textOnHighlight: isLight(set.highlight) ? mix(c.panel, '#000000', 0.35) : '#ffffff',
      muted: mix(text, g, 0.3),
    }, panelOpacity);
    vars['--ink-dark'] = light ? text : vars['--purple-dark'];
    return { colours: set.id, name: set.name, light, vars };
  }

  // ─── The nights ───────────────────────────────────────────────────────────
  const team = t => ({ name: t.name, logo: logoFor(t.name), score: t.score ?? null });
  // finished: PlayHQ has its result (the score is final); winner: home, away or draw.
  function brief(g) {
    const done = isFinished(g) && g.home.score !== null && g.home.score !== undefined && g.away.score !== null && g.away.score !== undefined;
    return { id: g.id, time: slotOf(g), court: g.court || '', venue: g.venue || '', division: g.division || '', round: g.round || '',
      home: team(g.home), away: team(g.away), finished: done,
      winner: !done ? null : g.home.score > g.away.score ? 'home' : g.away.score > g.home.score ? 'away' : 'draw' };
  }

  async function list() {
    const dates = await byDate();
    const today = localDate();
    const nights = Object.keys(dates).sort().map(date => {
      const games = dates[date];
      const rounds = [...new Set(games.map(g => g.round).filter(Boolean))];
      return { date, games: games.length, rounds: rounds.length === 1 ? rounds[0] : [...new Set(games.map(g => `${g.division} ${g.round}`))].join(', '), past: date < today,
        results: games.filter(isFinished).length };
    });
    const next = (nights.find(n => n.date >= today) || nights[nights.length - 1] || {}).date || '';
    const s = settings();
    return { nights, next, today, sizes: SIZES, settings: s, colourSets: allSets(s.colourSets), templates: TEMPLATES, app: !!appPort };
  }

  // One night, for social.html: every game (all courts, in time order) with its result once finished, the court
  // Studio streams with who is on the mic (from the Production Planner, or null when the night isn't planned), the top
  // sponsors and the competition. with: 'ladders' and/or 'shooters', for the Results pictures that need them.
  async function night(q = {}) {
    const dates = await byDate();
    const all = Object.keys(dates).sort();
    const today = localDate();
    const date = isDate(q.date) ? q.date : (all.find(d => d >= today) || all[all.length - 1] || today);
    const raw = dates[date] || [];
    const games = raw.map(brief);
    const want = new Set(String(q.with || '').split(','));
    let stream = null;
    try {
      stream = await onStream(date);
    } catch (err) { log('warn', 'socials', `No Production Planner for ${date}: ${err.message}`); }
    const a = about();
    const venues = [...new Set(games.map(g => g.venue).filter(Boolean))];
    const s = settings();
    const out = { date, today: date === today, competition: a.competition || '', competitionLogo: a.logo || null,
      venue: a.venue || venues[0] || '', games, stream, sponsors: sponsorsFor(), settings: s, look: look(q.colours || s.colours, s.colourSets, templateOf(q.template) ? q.template : s.template) };
    // Athletes picked on the tab (&home= &away= on a match up or full time, &athlete= on a polaroid), with their photo when
    // they approved its use; a name without one draws as if none was picked.
    const picked = {};
    for (const k of ['home', 'away', 'athlete']) if (q[k]) { const photo = photoFor(String(q[k])); if (photo) picked[k] = { name: String(q[k]).trim(), photo }; }
    out.picked = picked;
    if (want.has('ladders')) out.ladders = await ladders(dates, date, games);
    if (want.has('shooters')) {
      const division = q.division ? String(q.division) : '';
      out.shooters = await shooters(raw.filter((g, i) => games[i].finished && (!division || games[i].division === division)));
    }
    return out;
  }

  // The ladder of each division that played that night, as PlayHQ has it now. after: the round, when this night is
  // that division's latest with results (so "after Round 5" is true); else the ladder is simply today's.
  async function ladders(dates, date, games) {
    const out = [];
    for (const division of [...new Set(games.map(g => g.division).filter(Boolean))]) {
      const latest = Object.keys(dates).sort().filter(d => dates[d].some(g => g.division === division && isFinished(g))).pop();
      const round = (games.find(g => g.division === division) || {}).round || '';
      try {
        const l = await ladderFor(division);
        out.push({ division, after: latest === date ? round : '', rows: l.rows.map(r => ({ ...r, logo: logoFor(r.team) })), finalsPlaces: l.finalsPlaces || 0 });
      } catch (err) {
        log('warn', 'socials', `No ladder for ${division}: ${err.message}`);
        out.push({ division, after: '', rows: [], error: err.message });
      }
    }
    return out;
  }

  // The top shooters of the finished games given (one division's, or the whole night's), most points first (goals where
  // there are no super shots). superShots: whether any of those divisions has them, to show the super goals and points.
  async function shooters(finished) {
    if (!finished.length) return { players: [], gamesRead: 0, gamesFinished: 0, superShots: false };
    const t = await tallyShooters(finished);
    const players = [...t.players].sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, SHOOTERS_SHOWN)
      .map(p => ({ name: p.name, team: p.team, logo: p.logo, photo: photoFor(p), goals: p.goals, superGoals: p.superGoals, points: p.points }));
    return { players, gamesRead: t.read, gamesFinished: finished.length, superShots: finished.some(g => superShots(g.division)),
      error: !t.read && t.failed ? t.lastError : undefined };
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
    appPort.postMessage({ type: 'socialsSave', id, folder, pictures, share: body.share === true, zip: body.zip === true });
    const m = await answer;
    if (m.error) { log('warn', 'socials', `Saving the pictures for ${date}: ${m.error}`); throw Object.assign(new Error(m.error), { status: 500 }); }
    log('info', 'socials', `Saved ${m.files.length} pictures in ${m.folder}${m.zip ? `, and ${m.zip}` : ''}`);
    return { folder: m.folder, files: m.files.map(f => path.basename(f)), zip: m.zip || null, shared: !!m.shared };
  }

  async function route(req, res, url, { send, readBody, readRaw, port }) {
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    try {
      if (p === '/api/socials' && req.method === 'GET') return send(res, 200, await list()), true;
      if (p === '/api/socials/night' && req.method === 'GET') return send(res, 200, await night(q)), true;
      // The athletes to pick for a picture: those with a photo they approved, with their teams and divisions.
      if (p === '/api/socials/athletes' && req.method === 'GET') return send(res, 200, { athletes: athletesWithPhotos() }), true;
      if (p === '/api/socials/settings' && req.method === 'POST') {
        const now = saveSettings(await readBody(req));
        return send(res, 200, { settings: now, colourSets: allSets(now.colourSets) }), true;
      }
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

  return { route, list, night, settings, saveSettings, savePhoto, colourSets: () => allSets(settings().colourSets), SIZES, KINDS, TEMPLATES };
}

module.exports = { create, SIZES, KINDS };
