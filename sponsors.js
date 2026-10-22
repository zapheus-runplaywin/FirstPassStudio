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
const qrcode = require('qrcode-generator');
const datadir = require('./datadir');
const competitions = require('./competitions');

const DIR = datadir.file('sponsors');
const FILE = path.join(DIR, 'sponsors.json');
const IMAGE = /\.(png|jpe?g|webp|svg|gif)$/i;
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
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
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
    competitions: comps,
  };
}

function all() { return (readJson(FILE, {}).sponsors || []).map(s => clean(s, s)); }
function write(list) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ sponsors: list }, null, 2) + '\n');
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
  const dir = path.join(DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  // The logo it replaces goes, unless the other logo uses the same file.
  const old = s[which];
  fs.writeFileSync(path.join(dir, name), buf);
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
// what the competition's empty-tier rule says. Pushing up or down keeps going past empty tiers
// and gives up (skip) at the end. place is the kind of spot: a vacancy card only goes where a card
// fits (CARD_PLACES), elsewhere advertising a vacancy is a skip.
// Returns { tier, sponsors, from? } (from: the empty tier pushed from), { vacancy } or { skip: true }.
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
  const qr = qrcode(0, 'M');
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
// ctx: { send, readBody, readRaw, saveSettings(id, changes) }. Answers true when it handled the request.
async function route(req, res, url, ctx) {
  const { send, readBody, readRaw } = ctx;
  const q = Object.fromEntries(url.searchParams);
  const compId = q.competition || competitions.activeId();
  const p = url.pathname;
  if (p.startsWith('/sponsors/')) {
    const [, , id, file] = p.split('/');
    const f = logoFile(id, file);
    fs.readFile(f || '', (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(f).toLowerCase()]));
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
    for (const k of ['sponsorTierNames', 'sponsorOwnNames', 'sponsorEmpty', 'sponsorVacancy']) if (b[k] !== undefined) changes[k] = b[k];
    ctx.saveSettings(compId, changes);
    log('info', 'sponsors', `${compId}: saved sponsor tiers and vacancy card`, changes);
    send(res, 200, view(compId));
    return true;
  }
  if (p === '/api/sponsors/logo') {
    if (req.method === 'POST') {
      const s = saveLogo(q.id, q.which, q.name, await readRaw(req, 15 * 1024 * 1024));
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
  if (p === '/api/sponsors/pick') {
    if (!compId) { send(res, 200, { skip: true }); return true; }
    const r = pick(compId, q.tier, { place: q.place });
    const settings = competitions.get(compId);
    const out = r.sponsors ? { ...r, sponsors: r.sponsors.map(s => ({ ...s, logoUrl: logoUrl(s, 'logo'), logoWhiteUrl: logoUrl(s, 'logoWhite'),
      qrLink: trackedLink(s, { competition: settings.name, place: q.place }) })) } : r;
    send(res, 200, out);
    return true;
  }
  return false;
}

module.exports = { init, all, byId, save, remove, saveLogo, removeLogo, logoFile, pick, vacancy, trackedLink, qrSvg, cleanLink, view, route, SHARES, DIR, FILE };
