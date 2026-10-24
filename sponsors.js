// FirstPass Studio - sponsors, kept on the Sponsors page (sponsors.html).
//
// Every sponsor is in one list, sponsors/sponsors.json in the data folder, with its logos in
// sponsors/<id>/. A sponsor belongs to the competitions it's shown on, at a tier in each
// (competitions: { "thunder-league": { tier: "major" } }), so a sponsor of more than one competition
// is kept once. The tiers, their names and what an empty tier does are the competition's own
// settings (competitions.js sponsorTiers), as is its vacancy card, an "advertise with us" card
// that can take an empty tier's spots.
//
// pick() says which sponsors fill a tier's spots in a competition, following its empty-tier rules,
// for the graphics that show sponsors. qrSvg() makes the QR code for a sponsor's website (with
// tracking tags, so a sponsor sees visits from the stream in their own website analytics) or for
// the vacancy card, here on this computer.

'use strict';

const fs = require('fs');
const path = require('path');
const datadir = require('./datadir');
const savefile = require('./savefile');
const uploads = require('./uploads');
const competitions = require('./competitions');

const DIR = datadir.file('sponsors');
const FILE = path.join(DIR, 'sponsors.json');
const IMAGE = /\.(png|jpe?g|webp|svg|gif)$/i;
// Ads are files in the scene's media folder: a video, or a still (an image shown for its seconds).
const AD_FILE = /\.(png|jpe?g|webp|svg|gif|mp4|m4v|webm|mov)$/i;
const AD_VIDEO = /\.(mp4|m4v|webm|mov)$/i;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const HEX = /^#[0-9a-f]{6}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIERS = competitions.SPONSOR_TIERS;
// The share of screen time each tier gets when its sponsors have no targets of their own.
const SHARES = { naming: 5, elite: 3, major: 2, partner: 1, supporter: 0.5 };
// Spots a vacancy card can fill: the cards and the sponsor wall. A scoreboard tab or a "brought to
// you by" tag can't hold a card, so there an empty tier set to advertise is skipped.
const CARD_PLACES = new Set(['card', 'wall']);
const VACANCY_DEFAULTS = { heading: 'Your business here', message: 'Put your business in front of everyone watching. Scan to find out how.' };

let log = () => {};
const readJson = (file, fallback) => savefile.readJson(file, fallback, (err, movedTo) => console.warn(`Could not read ${file}: ${err.message}${movedTo ? `; moved it to ${path.basename(movedTo)}` : ''}`));
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const validId = id => /^[a-z0-9-]{1,40}$/.test(String(id || ''));
const text = (v, max) => String(v ?? '').trim().slice(0, max);

function init(logger) { if (logger) log = logger; }
function writable() {
  if (competitions.isReadOnly()) throw new Error('These settings were saved by a newer version of FirstPass Studio. Update Studio to change them.');
}

// A link as typed: "goldsbakery.com.au" becomes https://goldsbakery.com.au, an email address a mailto: link.
function cleanLink(v) {
  const s = text(v, 300);
  if (!s) return '';
  if (/^mailto:/i.test(s)) return s;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return `mailto:${s}`;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(s)) return `https://${s}`;
  return '';
}

// Keep only known fields, with the right types, so a bad save can't break the graphics.
function clean(input, old = {}) {
  const v = { ...old, ...input };
  const comps = {};
  for (const [id, c] of Object.entries(v.competitions && typeof v.competitions === 'object' ? v.competitions : {})) {
    if (/^[a-z0-9-]{1,40}$/.test(id) && c && TIERS.includes(c.tier)) comps[id] = { tier: c.tier };
  }
  const num = (n, max) => { n = Math.round(Number(n)); return Number.isFinite(n) && n > 0 ? Math.min(max, n) : 0; };
  return {
    id: old.id || v.id,
    name: text(v.name, 60) || 'New sponsor',
    tagline: text(v.tagline, 120),
    website: cleanLink(v.website),
    tracking: v.tracking !== false && v.tracking !== 'false',
    offer: text(v.offer, 80),
    colour: HEX.test(v.colour) ? v.colour.toLowerCase() : '',
    category: text(v.category, 40),
    logo: v.logo && IMAGE.test(v.logo) ? path.basename(v.logo) : '',
    logoWhite: v.logoWhite && IMAGE.test(v.logoWhite) ? path.basename(v.logoWhite) : '',
    start: DATE.test(v.start) ? v.start : '',
    end: DATE.test(v.end) ? v.end : '',
    targetSeconds: num(v.targetSeconds, 4 * 3600),   // seconds on screen per stream
    targetPlays: num(v.targetPlays, 100),            // ad plays per stream
    ads: (Array.isArray(v.ads) ? v.ads : []).map(a => ({ file: path.basename(String((a && a.file) || '')), seconds: Math.round(Math.min(60, Math.max(3, Number(a && a.seconds) || 8))) }))
      .filter(a => AD_FILE.test(a.file)).slice(0, 10),
    competitions: comps,
  };
}

function all() { return (readJson(FILE, {}).sponsors || []).map(s => clean(s, s)); }
function write(list) {
  savefile.writeJsonSync(FILE, { sponsors: list });
}
function byId(id) { return all().find(s => s.id === id) || null; }

function save(input) {
  writable();
  const list = all();
  const i = list.findIndex(s => s.id === input.id);
  let s;
  if (i >= 0) s = list[i] = clean(input, list[i]);
  else {
    const taken = new Set(list.map(x => x.id));
    let id = slug(input.name) || 'sponsor', n = 2;
    while (taken.has(id)) id = `${slug(input.name).slice(0, 36) || 'sponsor'}-${n++}`;
    s = clean({ ...input, id });
    list.push(s);
  }
  write(list);
  return s;
}

// The sponsors with an ad in this media file, and taking it out of their ads (the Output page's Media list
// removing it from the media folder).
function adUses(file) { return all().filter(s => s.ads.some(a => a.file === file)).map(s => ({ type: 'sponsor', name: s.name })); }
function dropAd(file) {
  const list = all();
  if (!list.some(s => s.ads.some(a => a.file === file))) return;
  writable();
  for (const s of list) s.ads = s.ads.filter(a => a.file !== file);
  write(list);
}

function remove(id) {
  writable();
  const list = all();
  if (!list.some(s => s.id === id)) throw new Error(`There is no sponsor "${id}".`);
  write(list.filter(s => s.id !== id));
  if (validId(id)) fs.rmSync(path.join(DIR, id), { recursive: true, force: true });
}

// ─── Logos ──────────────────────────────────────────────────────────────────
// Two per sponsor: the full colour logo, and a white one for dark panels (graphics without one
// make the colour logo white).
const LOGO_FIELDS = ['logo', 'logoWhite'];
function saveLogo(id, which, fileName, buf) {
  writable();
  if (!LOGO_FIELDS.includes(which)) throw new Error('Pick the colour logo or the white logo.');
  const s = byId(id);
  if (!s) throw new Error(`There is no sponsor "${id}".`);
  const name = path.basename(String(fileName || '')).replace(/[^\w .'()&+-]/g, '').trim();
  if (!IMAGE.test(name)) throw new Error('Logos must be PNG, JPG, WebP, SVG or GIF files.');
  if (!buf.length) throw new Error('That file is empty.');
  uploads.checkImage(name, buf);
  const dir = path.join(DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  // The logo it replaces goes, unless the other logo uses the same file.
  const old = s[which];
  savefile.writeFileSync(path.join(dir, name), buf);
  if (old && old !== name && old !== s[LOGO_FIELDS.find(f => f !== which)]) fs.rmSync(path.join(dir, old), { force: true });
  return save({ ...s, [which]: name });
}
function removeLogo(id, which) {
  writable();
  const s = byId(id);
  if (!s || !LOGO_FIELDS.includes(which) || !s[which]) return s;
  if (s[which] !== s[LOGO_FIELDS.find(f => f !== which)]) fs.rmSync(path.join(DIR, id, s[which]), { force: true });
  return save({ ...s, [which]: '' });
}
// The file behind a /sponsors/<id>/<file> link.
function logoFile(id, fileName) {
  const name = path.basename(decodeURIComponent(String(fileName || '')));
  return validId(id) && IMAGE.test(name) ? path.join(DIR, id, name) : null;
}
const logoUrl = (s, which) => s[which] ? `/sponsors/${s.id}/${encodeURIComponent(s[which])}` : null;

// ─── In a competition's template file ───────────────────────────────────────
// Export as template (Competitions setup) carries the competition's sponsors with their logos, at
// their tier in that competition, so the sponsors go wherever the competition goes. Importing merges
// them into the sponsors already here: one with the same name is the same sponsor, shown on the new
// competition too (keeping its own details, and taking a logo only where it has none).
function exportFor(compId) {
  return all().filter(s => s.competitions[compId]).map(({ id, competitions: comps, ...s }) => {
    const logos = {};
    for (const f of new Set(LOGO_FIELDS.map(w => s[w]).filter(Boolean))) {
      try { logos[f] = fs.readFileSync(path.join(DIR, id, f)).toString('base64'); } catch { /* a logo file gone missing is left out */ }
    }
    return { ...s, tier: comps[compId].tier, logos };
  });
}
function importFor(compId, list) {
  if (!Array.isArray(list) || !list.length) return 0;
  writable();
  let n = 0;
  for (const t of list) {
    if (!t || !TIERS.includes(t.tier) || !text(t.name, 60)) continue;
    const { tier, logos = {}, ...fields } = t;
    const same = all().find(s => s.name.toLowerCase() === text(t.name, 60).toLowerCase());
    let s = same
      ? save({ ...same, competitions: { ...same.competitions, [compId]: { tier } } })
      : save({ ...fields, logo: '', logoWhite: '', competitions: { [compId]: { tier } } });
    for (const which of LOGO_FIELDS) {
      const file = fields[which], b64 = file && logos[file];
      if (!b64 || s[which]) continue;
      try { s = saveLogo(s.id, which, file, Buffer.from(String(b64), 'base64')); } catch { /* skip a file that isn't an image */ }
    }
    n++;
  }
  log('info', 'sponsors', `Imported ${n} sponsor${n === 1 ? '' : 's'} with the competition template`);
  return n;
}

// ─── Which sponsors fill a tier ─────────────────────────────────────────────
// A sponsor is shown from its deal's start date to its end date (either can be blank).
function current(s, date) {
  const day = date || new Date().toISOString().slice(0, 10);
  return (!s.start || s.start <= day) && (!s.end || s.end >= day);
}
function onCompetition(compId, opts = {}) {
  return all().filter(s => s.competitions[compId] && (opts.all || current(s, opts.date)));
}

// The sponsors that fill a tier's spots in a competition: the tier's own, or, when it has none,
// what the competition's empty-tier rule says. Its values name where to look for a sponsor: 'up' searches
// the tiers above (shown as Pull down, a sponsor pulled down into the empty tier) and 'down' the tiers
// below (Pull up). Either keeps going past empty tiers
// and gives up (skip) at the end. place is the kind of spot: a vacancy card only goes where a card
// fits (CARD_PLACES), elsewhere advertising a vacancy is a skip.
// Returns { tier, sponsors, from? } (from: the empty tier it was pulled into), { vacancy } or { skip: true }.
function pick(compId, tier, opts = {}) {
  if (!TIERS.includes(tier)) throw new Error(`There is no sponsor tier "${tier}". The tiers are ${TIERS.join(', ')}.`);
  const settings = opts.settings || competitions.get(compId);
  const tiers = competitions.sponsorTiers(settings);
  const list = onCompetition(compId, opts);
  const inTier = t => list.filter(s => s.competitions[compId].tier === t);
  const own = inTier(tier);
  if (own.length) return { tier, sponsors: own };
  const i = TIERS.indexOf(tier);
  const rule = tiers[i].empty;
  if (rule === 'up' || rule === 'down') {
    const step = rule === 'up' ? -1 : 1;
    for (let j = i + step; j >= 0 && j < TIERS.length; j += step) {
      const found = inTier(TIERS[j]);
      if (found.length) return { tier: TIERS[j], from: tier, sponsors: found };
    }
    return { skip: true };
  }
  if (rule === 'vacancy' && CARD_PLACES.has(opts.place)) {
    const v = vacancy(settings);
    if (v.link) return { vacancy: v };
  }
  return { skip: true };
}

// The competition's vacancy card, with its defaults. With no link it is never shown.
function vacancy(settings) {
  const v = (settings && settings.sponsorVacancy) || {};
  return { heading: v.heading || VACANCY_DEFAULTS.heading, message: v.message || VACANCY_DEFAULTS.message, contact: v.contact || '', link: cleanLink(v.link) };
}

// ─── Rotation ───────────────────────────────────────────────────────────────
// Graphics that rotate (the sponsor card) ask for the next sponsor each time they come on. Every
// sponsor filling the tiers' spots is a candidate with its tier's share (a pulled sponsor gets the
// share of the empty tier it fills too); the vacancy card is one when a tier advertises it. The one
// shown least for its share goes next, never the one just shown, and not one in the same category as
// it while there's another. Showings are counted while Studio runs, per competition and place.
const shown = new Map();   // "competition place" -> { counts: Map(id -> n), last: { id, category } }
const CARD_TIERS = ['naming', 'elite', 'major'];
function candidates(compId, tiers, place, opts = {}) {
  const out = new Map();
  for (const t of tiers) {
    const r = pick(compId, t, { ...opts, place });
    if (r.sponsors) for (const s of r.sponsors) {
      if (opts.filter && !opts.filter(s)) continue;
      const c = out.get(s.id) || { id: s.id, sponsor: s, tier: s.competitions[compId].tier, weight: 0 };
      c.weight += SHARES[t];
      out.set(s.id, c);
    } else if (r.vacancy && !opts.filter) {
      const c = out.get('vacancy') || { id: 'vacancy', vacancy: r.vacancy, tier: t, weight: 0 };
      c.weight += SHARES[t];
      out.set('vacancy', c);
    }
  }
  return [...out.values()];
}
function next(compId, opts = {}) {
  const place = opts.place || 'card';
  const tiers = (opts.tiers && opts.tiers.length ? opts.tiers : CARD_TIERS).filter(t => TIERS.includes(t));
  const key = `${compId} ${place}`;
  const st = shown.get(key) || { counts: new Map(), last: null };
  shown.set(key, st);
  let list = candidates(compId, tiers, place, opts);
  if (!list.length) return null;
  const count = id => st.counts.get(id) || 0;
  const category = c => (c.sponsor && c.sponsor.category || '').toLowerCase();
  if (list.length > 1 && st.last) {
    const notLast = list.filter(c => c.id !== st.last.id);
    const apart = st.last.category ? notLast.filter(c => category(c) !== st.last.category) : notLast;
    list = apart.length ? apart : notLast;
  }
  const chosen = list.slice().sort((a, b) => count(a.id) / a.weight - count(b.id) / b.weight || b.weight - a.weight
    || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || String(a.id).localeCompare(String(b.id)))[0];
  if (opts.count !== false) {
    st.counts.set(chosen.id, count(chosen.id) + 1);
    st.last = { id: chosen.id, category: category(chosen) };
  }
  return chosen;
}
// ─── Ads ────────────────────────────────────────────────────────────────────
// A Sponsor ads step in a sequence (and /deck/sponsor/ad) plays the next ad: the sponsor from the same
// rotation (every tier, by tier share, never twice running, competitors apart, counted on its own as
// place "ad"), then that sponsor's ads in turn. exists says whether an ad's file is in the media folder;
// an ad whose file has gone is passed over. Null when no sponsor of the competition has an ad to play.
const adTurns = new Map();   // "competition sponsor" -> how many of its ads have played
function nextAd(compId, opts = {}) {
  const exists = opts.exists || (() => true);
  const playable = s => s.ads.filter(a => exists(a.file));
  const c = compId && next(compId, { place: 'ad', tiers: TIERS, filter: s => playable(s).length > 0, count: opts.count });
  if (!c) return null;
  const ads = playable(c.sponsor), key = `${compId} ${c.sponsor.id}`;
  const n = adTurns.get(key) || 0;
  if (opts.count !== false) adTurns.set(key, n + 1);
  const ad = ads[n % ads.length];
  return { sponsor: { id: c.sponsor.id, name: c.sponsor.name }, file: ad.file, kind: AD_VIDEO.test(ad.file) ? 'video' : 'image', seconds: ad.seconds };
}

// ─── Sponsored moments ──────────────────────────────────────────────────────
// The super shot, hot streak and game moment animations say who they're "brought to you by": the sponsor
// that owns the moment on this competition (sponsorMoments), or else the Elite tier's sponsors taking turns
// (with Elite's empty-tier rule; advertising a vacancy skips). 'off' tags no one. Null when no one.
function moment(compId, key, opts = {}) {
  if (!competitions.SPONSOR_MOMENTS[key]) throw new Error(`There is no sponsored moment "${key}". They are ${Object.keys(competitions.SPONSOR_MOMENTS).join(', ')}.`);
  if (!compId) return null;
  const owner = (competitions.get(compId).sponsorMoments || {})[key] || '';
  if (owner === 'off') return null;
  const own = owner && onCompetition(compId).find(s => s.id === owner);
  if (own) return own;
  const c = next(compId, { place: 'moment', tiers: ['elite'], count: opts.count });
  return c && c.sponsor ? c.sponsor : null;
}

// A sponsor named in a link: its id, or its name as on the Sponsors page.
function find(nameOrId) {
  const want = String(nameOrId || '').trim();
  return all().find(s => s.id === want) || all().find(s => s.name.toLowerCase() === want.toLowerCase()) || all().find(s => s.id === slug(want)) || null;
}

// What a graphic needs to draw a sponsor: logos as links, the tier's name and the tracked QR link.
function forGraphic(s, compId, place, settings) {
  settings = settings || competitions.get(compId);
  const tier = s.competitions[compId] && s.competitions[compId].tier;
  return { id: s.id, name: s.name, tagline: s.tagline, offer: s.offer, colour: s.colour, category: s.category,
    website: s.website.replace(/^https?:\/\/(www\.)?|^mailto:/g, '').replace(/\/$/, ''),
    logoUrl: logoUrl(s, 'logo'), logoWhiteUrl: logoUrl(s, 'logoWhite'),
    tier: tier || null, tierName: tier ? competitions.sponsorTiers(settings).find(t => t.key === tier).name : null,
    qrLink: trackedLink(s, { competition: settings.name, place }) };
}

// The sponsor wall: every tier with a sponsor, top first, and a vacancy tile in an empty tier that
// advertises it. Pushing up or down doesn't apply: each sponsor is on the wall once, in its own tier.
function wall(compId, opts = {}) {
  const settings = competitions.get(compId);
  const list = onCompetition(compId, opts);
  const tiers = (opts.tiers && opts.tiers.length ? opts.tiers : TIERS).filter(t => TIERS.includes(t));
  const v = vacancy(settings);
  return competitions.sponsorTiers(settings).filter(t => tiers.includes(t.key)).map(t => {
    const sponsors = list.filter(s => s.competitions[compId].tier === t.key).map(s => forGraphic(s, compId, 'wall', settings));
    return { key: t.key, name: t.name, sponsors, ...(!sponsors.length && t.empty === 'vacancy' && v.link ? { vacancy: v } : {}) };
  }).filter(t => t.sponsors.length || t.vacancy);
}

// ─── QR codes ───────────────────────────────────────────────────────────────
// A sponsor's website with tracking tags (utm_source/medium/campaign/content) for their website
// analytics, unless the sponsor has them turned off or the link already has its own.
function trackedLink(s, opts = {}) {
  const link = s.website;
  if (!link || !/^https?:/i.test(link) || s.tracking === false || /[?&]utm_/i.test(link)) return link;
  try {
    const u = new URL(link);
    u.searchParams.set('utm_source', 'livestream');
    u.searchParams.set('utm_medium', 'qr');
    if (opts.competition) u.searchParams.set('utm_campaign', slug(opts.competition));
    if (opts.place) u.searchParams.set('utm_content', slug(opts.place));
    return u.toString();
  } catch { return link; }
}

// The QR code for a link as an SVG: black on white with the standard four-module quiet border,
// scalable to any size. Error correction M copes with a phone filming a screen.
function qrSvg(link) {
  if (!link) throw new Error('There is no link to make a QR code for.');
  // Loaded only when a QR code is made, so the helper still starts where npm install hasn't run (the Stream Deck tests).
  const qr = require('qrcode-generator')(0, 'M');
  qr.addData(link, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), q = 4, size = n + q * 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.isDark(y, x)) continue;
      let w = 1;
      while (x + w < n && qr.isDark(y, x + w)) w++;
      d += `M${x + q} ${y + q}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`, modules: n };
}

// ─── What the Sponsors page shows ───────────────────────────────────────────
function view(compId) {
  const settings = compId ? competitions.get(compId) : competitions.get();
  const comps = competitions.list();
  const here = comps.find(c => c.id === compId);
  const today = new Date().toISOString().slice(0, 10);
  const known = new Set(comps.map(c => c.id));
  return {
    competition: here ? { id: here.id, name: here.name, organisationUrl: here.organisationUrl } : null,
    // Other competitions, the same PlayHQ organisation's first.
    competitions: comps.map(c => ({ id: c.id, name: c.name, sameOrganisation: !!(here && c.organisationUrl && c.organisationUrl === here.organisationUrl) }))
      .sort((a, b) => (b.id === compId) - (a.id === compId) || b.sameOrganisation - a.sameOrganisation || a.name.localeCompare(b.name)),
    tiers: competitions.sponsorTiers(settings).map(t => ({ ...t, share: SHARES[t.key] })),
    nameSets: competitions.SPONSOR_NAME_SETS,
    tierNames: settings.sponsorTierNames,
    ownNames: settings.sponsorOwnNames,
    emptyDefaults: competitions.SPONSOR_EMPTY_DEFAULTS,
    vacancy: { ...settings.sponsorVacancy },
    moments: Object.entries(competitions.SPONSOR_MOMENTS).map(([key, name]) => ({ key, name, owner: (settings.sponsorMoments || {})[key] || '' })),
    vacancyDefaults: VACANCY_DEFAULTS,
    vacancyLink: vacancy(settings).link,
    sponsors: all().map(s => ({
      ...s,
      competitions: Object.fromEntries(Object.entries(s.competitions).filter(([id]) => known.has(id))),
      logoUrl: logoUrl(s, 'logo'), logoWhiteUrl: logoUrl(s, 'logoWhite'),
      state: s.start && s.start > today ? 'starts' : s.end && s.end < today ? 'ended' : 'current',
      qrLink: trackedLink(s, { competition: here && here.name, place: 'card' }),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    readOnly: competitions.isReadOnly(),
  };
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
// /api/sponsors (GET the page's view, POST a sponsor, DELETE ?id=), /api/sponsors/settings (POST the
// competition's tier names, empty-tier rules and vacancy card), /api/sponsors/logo (POST or DELETE
// ?id=&which=logo|logoWhite&name=), /api/sponsors/qr.svg (?id=&place= or ?vacancy=1),
// /api/sponsors/pick (?tier=&place=) and /sponsors/<id>/<file> for logos.
// ctx: { send, readBody, readRaw, saveSettings(id, changes), gave(req, sponsors, place, opts) (exposure.js) }. Answers true when it handled the request.
async function route(req, res, url, ctx) {
  const { send, readBody, readRaw } = ctx;
  const q = Object.fromEntries(url.searchParams);
  const compId = q.competition || competitions.activeId();
  const p = url.pathname;
  if (p.startsWith('/sponsors/')) {
    const [, , id, file] = p.split('/');
    const f = logoFile(id, file);
    fs.readFile(f || '', (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(f).toLowerCase()], uploads.SERVE_HEADERS));
    return true;
  }
  if (p === '/api/sponsors') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const s = save(body);
      log('info', 'sponsors', `${body.id ? 'Saved' : 'Added'} sponsor "${s.name}"`, { competitions: s.competitions });
    } else if (req.method === 'DELETE') {
      const s = byId(q.id);
      remove(q.id);
      log('info', 'sponsors', `Deleted sponsor "${s ? s.name : q.id}"`);
    }
    send(res, 200, view(compId));
    return true;
  }
  if (p === '/api/sponsors/settings' && req.method === 'POST') {
    if (!compId) throw new Error('Make or import a competition first.');
    const b = await readBody(req);
    const changes = {};
    for (const k of ['sponsorTierNames', 'sponsorOwnNames', 'sponsorEmpty', 'sponsorVacancy', 'sponsorMoments']) if (b[k] !== undefined) changes[k] = b[k];
    ctx.saveSettings(compId, changes);
    log('info', 'sponsors', `${compId}: saved sponsor tiers and vacancy card`, changes);
    send(res, 200, view(compId));
    return true;
  }
  if (p === '/api/sponsors/logo') {
    if (req.method === 'POST') {
      let s;
      // A file that isn't a logo (wrong extension, or not the image its name says) is the person's to fix: 400, not 502.
      try { s = saveLogo(q.id, q.which, q.name, await readRaw(req, 15 * 1024 * 1024)); }
      catch (err) { send(res, 400, { error: err.message }); return true; }
      log('info', 'sponsors', `"${s.name}": added ${q.which === 'logoWhite' ? 'white' : 'colour'} logo ${s[q.which]}`);
    } else if (req.method === 'DELETE') {
      const s = removeLogo(q.id, q.which);
      if (s) log('info', 'sponsors', `"${s.name}": removed ${q.which === 'logoWhite' ? 'white' : 'colour'} logo`);
    }
    send(res, 200, view(compId));
    return true;
  }
  if (p === '/api/sponsors/qr.svg') {
    const settings = compId ? competitions.get(compId) : competitions.get();
    let link;
    if (q.vacancy) link = q.link !== undefined ? cleanLink(q.link) : vacancy(settings).link;
    else {
      const s = byId(q.id);
      if (!s) { send(res, 404, { error: `There is no sponsor "${q.id}".` }); return true; }
      link = trackedLink({ ...s, ...(q.tracking !== undefined ? { tracking: q.tracking !== '0' } : {}), ...(q.link !== undefined ? { website: cleanLink(q.link) } : {}) },
        { competition: settings.name, place: q.place || 'card' });
    }
    if (!link) { send(res, 404, { error: 'There is no link for this QR code yet.' }); return true; }
    send(res, 200, qrSvg(link).svg, 'image/svg+xml');
    return true;
  }
  if (p === '/api/sponsors/next') {
    if (!compId) { send(res, 200, { none: true }); return true; }
    const place = q.place || 'card';
    const tiers = q.tiers ? q.tiers.split(',') : null;
    let c;
    if (q.sponsor) {
      const s = find(q.sponsor);
      c = s ? { id: s.id, sponsor: s } : null;
      if (!c) log('warn', 'sponsors', `No sponsor "${q.sponsor}" for the ${place}`);
    } else c = next(compId, { place, tiers, count: q.count !== '0' });
    const settings = competitions.get(compId);
    if (ctx.gave) ctx.gave(req, c && c.sponsor ? [c.sponsor] : [], place, { qr: place === 'card' && !!(c && c.sponsor && c.sponsor.website), competition: compId });
    if (!c) send(res, 200, { none: true });
    else if (c.vacancy) send(res, 200, { vacancy: c.vacancy, tier: c.tier, competition: settings.displayName || settings.competitionName || settings.name });
    else send(res, 200, { sponsor: forGraphic(c.sponsor, compId, place, settings) });
    if (c && !q.sponsor && q.count !== '0') log('info', 'sponsors', `${place}: ${c.vacancy ? 'the vacancy card' : `"${c.sponsor.name}"`} is next`);
    return true;
  }
  if (p === '/api/sponsors/moment') {
    const key = q.moment;
    if (!competitions.SPONSOR_MOMENTS[key]) { send(res, 400, { error: `There is no sponsored moment "${key}".` }); return true; }
    let s = null;
    if (q.sponsor) s = find(q.sponsor);
    else s = moment(compId, key, { count: q.count !== '0' });
    if (!s) { send(res, 200, { none: true }); return true; }
    // On screen for the tag's seconds, if the page is on in the scene (exposure.js).
    if (ctx.flash) ctx.flash(req, s, 'moment', Math.min(10, Number(q.seconds) || 2.5), { competition: compId });
    send(res, 200, { sponsor: forGraphic(s, compId, 'moment', competitions.get(compId)) });
    if (q.count !== '0' && !q.sponsor) log('info', 'sponsors', `${competitions.SPONSOR_MOMENTS[key]}: brought to you by "${s.name}"`);
    return true;
  }
  if (p === '/api/sponsors/wall') {
    const settings = compId ? competitions.get(compId) : competitions.get();
    const tiers = compId ? wall(compId, { tiers: q.tiers ? q.tiers.split(',') : null }) : [];
    // ?max= when the page shows only the first few.
    if (ctx.gave) ctx.gave(req, tiers.flatMap(t => t.sponsors || []).slice(0, Number(q.max) || Infinity), q.place || 'wall', { competition: compId });
    send(res, 200, { competition: settings.displayName || settings.competitionName || settings.name, tiers });
    return true;
  }
  if (p === '/api/sponsors/pick') {
    if (!compId) { send(res, 200, { skip: true }); return true; }
    const r = pick(compId, q.tier, { place: q.place });
    const settings = competitions.get(compId);
    // The graphics show the first one (naming rights is one sponsor).
    if (ctx.gave) ctx.gave(req, (r.sponsors || []).slice(0, 1), q.place, { competition: compId });
    const out = r.sponsors ? { ...r, sponsors: r.sponsors.map(s => ({ ...s, logoUrl: logoUrl(s, 'logo'), logoWhiteUrl: logoUrl(s, 'logoWhite'),
      qrLink: trackedLink(s, { competition: settings.name, place: q.place }) })) } : r;
    send(res, 200, out);
    return true;
  }
  return false;
}

module.exports = { init, all, byId, find, moment, save, remove, adUses, dropAd, saveLogo, removeLogo, logoFile, exportFor, importFor, nextAd, pick, next, wall, forGraphic, vacancy, trackedLink, qrSvg, cleanLink, view, route, SHARES, DIR, FILE };
