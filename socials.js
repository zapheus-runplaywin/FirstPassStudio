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
// colourSets: [{ id, name, ground, highlight, accent }], template, favourites: [<template id>], favouritesOnly, movers,
// pictureSets: [{ id, name, kinds: [<kind>] }], pictureSet: <set id or '' for all> }: the
// FirstPass Studio mark and the PIVT logo in the corners, which graphics carry the sponsor strip, the colour set in use
// and the ones made by hand, the template set, and the template sets starred (and whether the tab lists only those),
// and the picture sets (which kinds of picture the tab shows, picked on its Show row), kept week to week. Photos dropped on a polaroid stay
// on this Mac only (socials-photos/ in the local folder, never in a backup or iCloud); the oldest go after PHOTOS_KEPT.
//
// Routes (server.js hands every /api/socials and /socials/ request here):
//   GET  /api/socials                    the game nights, the settings, the kinds of picture (KIND_NAMES) and whether
//                                        pictures can be saved (the app)
//   GET  /api/socials/night?date=        one night for social.html: its games and results, the streamed court, sponsors,
//                                        look (&colours= a colour set and &template= a template set, else the ones picked); &with=ladders adds the ladder of each division that played
//                                        (with each team's move since before the night, when the ladder is after it), &with=shooters
//                                        the night's top shooters (each with their photo when approved; &division= one
//                                        division's, as on the Socials tab's Top shooters picture per division); &with=tournament&division=
//                                        that division's running totals over every finished game up to this night (&after=HH:MM: only
//                                        its games starting by then), with each one's move since the round before; &home= &away= &athlete= the
//                                        athletes picked for a picture (picked, with their approved photo); running: what the running
//                                        top shooters are called (Tournament or Season); finals: the divisions at their finals that
//                                        night (their last home and away round, or a finals round), and on a finals night each finals
//                                        game's name (final) and each division's champion once known; winners: Champions or Premiers (Competitions setup);
//                                        &with=finals&division= that division's finals (finalsDraw, as GET /api/finals);
//                                        &with=review the night's biggest win, closest game and upsets (Round in review);
//                                        &with=form (&game=) each game's Form guide; &with=preview&division= its Round preview;
//                                        &with=race&division= its finals race; &with=draw&division=&team= that team's season;
//                                        &with=milestones the night's first games and 50ths. Always: byes, countdown, raceOn
//                                        (divisions in their finals race) and firstNights (divisions starting their season)
//                                        Results: &with=accuracy|supershots|onfire&division= (Sharpshooter, Super shot leaders, On
//                                        fire); &with=numbers (Night in numbers); &with=season&division=&team= (Team season card);
//                                        &with=wrap&division= (Season wrap). Always: clubs (Club round up), streaks (Still unbeaten)
//                                        and lastNights (divisions ending their season)
//                                        Hand picks: &with=lineups (&division=) each finished game's line ups, to pick from;
//                                        &with=potm&game=&athlete= (&medal=) Player of the match; &with=teamround&division=
//                                        &GS=..&GK= Team of the round; &with=spotlight&athlete= Athlete spotlight;
//                                        &with=sponsorspot&sponsor=<id> Sponsor spotlight (with their time on screen that
//                                        night); &with=sponsorlist every sponsor, to pick from. Always: nextNight (Thanks for watching)
//                                        &with=story&game= the game's story as the scoreboard kept it (Game story, Score worm);
//                                        &with=watch&link= a QR code for the replay's link (Watch it back). Always: stories (the
//                                        night's games with a kept story) and watchLinks (links suggested from Live viewers);
//                                        the story's moments are Moments of the game's
//                                        &with=gamestats&game= a finished game's team and shooter totals from its line ups (Game
//                                        stats, Shooting duel), with the story's quarters, runs and leads when Studio streamed it;
//                                        &with=teamsheet&game= both teams' season squads with games played (Team sheet). Head to
//                                        head is the Form guide's meetings (&with=form&game=). Always: ofNight, the streamed
//                                        games' Runs of the night, Super shot time and Comeback of the night
//   GET  /api/socials/athletes           the athletes with a photo they approved the use of, to pick for a picture
//   POST /api/socials/settings           { mark, pivt, sponsor: { kind: bool }, colours: <set id>, colourSets: [...], template: <id>,
//                                        favourites: [<template id>], favouritesOnly: bool, movers: bool,
//                                        pictureSets: [{ id?, name, kinds }], pictureSet: <set id or ''> }
//   POST /api/socials/photo?name=x.jpg   the photo's bytes; answers { photo } for social.html's ?photo=
//   GET  /socials/photos/<file>          a dropped photo
//   POST /api/socials/export             { date, set: upcoming|results, share, zip, carousel, items: [{ name, link, size }] }: the
//                                        app saves them (and a zip of them with zip: true). carousel: true saves them as one
//                                        Instagram carousel in their order: one size, up to 20, each marked 1/6, 2/6...
//                                        (?page=), in a folder of its own. A picture that can't be made is skipped and the
//                                        rest saved: answers { folder, files, skipped: [{ name, reason }], zip, shared }

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uploads = require('./uploads');
const { isFinished } = require('./playhq');
const { TEMPLATE_FONTS } = require('./fonts');
const { ROUND: FINALS_ROUND } = require('./finals');
const stats = require('./socialstats');
const { sameName } = stats;

// The sizes Instagram takes: a square post, a portrait post (the most room in the feed) and a Story.
const SIZES = {
  square: { width: 1080, height: 1080, label: 'Square' },
  portrait: { width: 1080, height: 1350, label: 'Portrait' },
  story: { width: 1080, height: 1920, label: 'Story' },
};
// Each graphic and whether it carries the sponsor strip until that's changed on the tab. Upcoming: fixtures, matchup,
// form (Form guide: both teams' last results and meetings), preview (Round preview: a division's games with the ladder
// places), byes, milestones (also on Results), race (Finals race), countdown (to the finals or the grand final), draw (a
// team's season draw, on its division's first night), onstream, commentators (the commentary team's headshots) and a
// polaroid; Results: results, review (Round in review: the
// biggest win, the closest game and the upsets), fulltime, ladder, topshooters, tournament (each division's top shooters so
// far, called Tournament or Season top shooters), accuracy (Sharpshooter), supershots (Super shot leaders), onfire,
// numbers (Night in numbers), club (Club round up), streaks (Still unbeaten), season (Team season card), wrap (Season
// wrap), the hand picks potm (Player of the match) and teamround (Team of the round), thanks (Thanks for watching) and a
// polaroid per game; either set: spotlight (Athlete spotlight) and sponsorspot (Sponsor spotlight).
const KINDS = { fixtures: true, matchup: true, form: true, preview: true, byes: true, milestones: true, race: true, countdown: true, draw: true, onstream: true, commentators: true, polaroid: false, results: true, review: true, fulltime: true, ladder: true, topshooters: true, tournament: true, finalsbound: true, finalsdraw: true, champions: true,
  accuracy: true, supershots: true, onfire: true, numbers: true, club: true, streaks: true, season: true, wrap: true,
  potm: true, teamround: true, spotlight: true, sponsorspot: false, thanks: false, story: true, worm: true, watch: true,
  gamestats: true, shooting: true, moments: true, h2h: true, teamsheet: true,
  runs: true, supershottime: true, comeback: true };
// The positions of Team of the round, in order.
const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
// Each kind of picture as a picture set's editor lists it (the Socials tab's Show row): its name and which list it's on
// (upcoming, results or both). Every kind in KINDS needs one.
const KIND_NAMES = [
  ['fixtures', 'Game night fixture', 'upcoming'], ['matchup', 'Match up', 'upcoming'], ['form', 'Form guide', 'upcoming'],
  ['preview', 'Round preview', 'upcoming'], ['byes', 'Byes', 'upcoming'], ['race', 'Finals race', 'upcoming'],
  ['countdown', 'Countdown', 'upcoming'], ['draw', 'Season draw', 'upcoming'], ['onstream', 'On the stream', 'upcoming'],
  ['commentators', 'Commentary team', 'upcoming'], ['h2h', 'Head to head', 'upcoming'], ['teamsheet', 'Team sheet', 'upcoming'],
  ['results', 'Results', 'results'], ['review', 'Round in review', 'results'], ['fulltime', 'Full time', 'results'],
  ['ladder', 'Ladder', 'results'], ['topshooters', 'Top shooters', 'results'], ['tournament', 'Tournament top shooters', 'results'],
  ['finalsbound', 'Finals bound', 'results'], ['champions', 'Champions', 'results'],
  ['accuracy', 'Sharpshooter', 'results'], ['supershots', 'Super shot leaders', 'results'], ['onfire', 'On fire', 'results'],
  ['numbers', 'Night in numbers', 'results'], ['club', 'Club round up', 'results'], ['streaks', 'On a roll', 'results'],
  ['season', 'Team season card', 'results'], ['wrap', 'Season wrap', 'results'],
  ['potm', 'Player of the match', 'results'], ['teamround', 'Team of the round', 'results'], ['thanks', 'Thanks for watching', 'results'],
  ['story', 'Game story', 'results'], ['worm', 'Score worm', 'results'], ['watch', 'Watch it back', 'results'],
  ['gamestats', 'Game stats', 'results'], ['shooting', 'Shooting duel', 'results'], ['moments', 'Moments of the game', 'results'],
  ['runs', 'Runs of the night', 'results'], ['supershottime', 'Super shot time', 'results'], ['comeback', 'Comeback of the night', 'results'],
  ['milestones', 'Milestones', 'both'], ['finalsdraw', 'Finals draw', 'both'], ['polaroid', 'Polaroid', 'both'],
  ['spotlight', 'Athlete spotlight', 'both'], ['sponsorspot', 'Sponsor spotlight', 'both'],
].map(([kind, name, when]) => ({ kind, name, when }));
const MAX_PICTURE_SETS = 12;
const SHOOTERS_SHOWN = 6;
const TOURNAMENT_SHOWN = 8; // the tournament top shooters, a division's best so far
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
const CAROUSEL_MAX = 20; // Instagram's most pictures in one post
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const slotOf = g => String(g.time || '').slice(0, 5);
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function create({ log, competitions, savefile, photosDir, byDate, onStream, about, logoFor, sponsorsFor, ladderFor, tallyShooters, superShots,
  milestonesFor = async () => [], clubOf = () => '', lineupsOf = async games => games.map(() => null), spotlightFor = async () => null, teamSheetFor = async () => [],
  sponsorList = () => [], onScreen = () => ({}), storyFor = () => null, qrFor = () => '', streamsFor = () => [], hasFinals = () => false, finalsOf = async () => null, theme, photoFor = () => null, athletesWithPhotos = () => [], appPort = process.parentPort || null }) {
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
    const pictureSets = pictureSetsOf(d.pictureSets);
    return { mark: d.mark !== false, pivt: d.pivt !== false, sponsor, colours, colourSets, template, favourites: favouritesOf(d.favourites), favouritesOnly: d.favouritesOnly === true,
      movers: d.movers !== false, pictureSets, pictureSet: pictureSets.some(x => x.id === d.pictureSet) ? d.pictureSet : '' };
  }
  // Starred template sets, in the list's order; a retired one counts as the set it is now drawn as.
  const favouritesOf = list => Array.isArray(list) ? TEMPLATES.map(t => t.id).filter(id => list.some(x => templateOf(x)?.id === id)) : [];
  // The picture sets made on the tab, each { id: pset-N, name, kinds: [<kind>] } with the kinds in KIND_NAMES' order; a
  // kind no longer made is dropped.
  const pictureSetsOf = list => Array.isArray(list) ? list.filter(x => x && /^pset-\d+$/.test(x.id) && typeof x.name === 'string' && Array.isArray(x.kinds))
    .map(x => ({ id: x.id, name: x.name, kinds: KIND_NAMES.map(k => k.kind).filter(k => x.kinds.includes(k)) })) : [];
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
    if (typeof body.movers === 'boolean') now.movers = body.movers;
    if (Array.isArray(body.pictureSets)) {
      if (body.pictureSets.length > MAX_PICTURE_SETS) throw new Error(`Keep it to ${MAX_PICTURE_SETS} picture sets.`);
      if (!body.pictureSets.every(x => x && Array.isArray(x.kinds) && x.kinds.every(k => Object.hasOwn(KINDS, k)))) throw new Error('There is no such kind of picture.');
      now.pictureSets = pictureSetsOf(body.pictureSets.map((x, i) => ({ id: /^pset-\d+$/.test(x.id) ? x.id : `pset-${Date.now()}${i}`,
        name: String(x.name || '').trim().slice(0, 30) || 'My pictures', kinds: x.kinds })));
    }
    if (typeof body.pictureSet === 'string') {
      if (body.pictureSet && !now.pictureSets.some(x => x.id === body.pictureSet)) throw new Error('There is no such picture set.');
      now.pictureSet = body.pictureSet;
    }
    if (!now.pictureSets.some(x => x.id === now.pictureSet)) now.pictureSet = '';
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
    return { nights, next, today, sizes: SIZES, settings: s, colourSets: allSets(s.colourSets), templates: TEMPLATES, kinds: KIND_NAMES, app: !!appPort };
  }

  // One night, for social.html: every game (all courts, in time order) with its result once finished, the court
  // Studio streams with who is on the mic (from the Production Planner, or null when the night isn't planned), the top
  // sponsors and the competition. with: 'ladders' and/or 'shooters', for the Results pictures that need them, 'finals' for a
  // division's Finals bound and Finals draw (&division=). finals: the divisions at their finals this night.
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
    const out = { date, today: date === today, competition: a.competition || '', competitionLogo: a.logo || null, running: running(all, a.runningShooters), winners: a.finalsWinners || 'Champions',
      venue: a.venue || venues[0] || '', games, stream, sponsors: sponsorsFor(), settings: s, look: look(q.colours || s.colours, s.colourSets, templateOf(q.template) ? q.template : s.template) };
    // Athletes picked on the tab (&home= &away= on a match up or full time, &athlete= on a polaroid), with their photo when
    // they approved its use; a name without one draws as if none was picked.
    const picked = {};
    for (const k of ['home', 'away', 'athlete']) if (q[k]) { const photo = photoFor(String(q[k])); if (photo) picked[k] = { name: String(q[k]).trim(), photo }; }
    out.picked = picked;
    out.finals = finalsOn(dates, date, games);
    // Who won the division's finals (for the Champions picture), and on a finals night each finals game's name from the
    // division's finals format (Major semi final, Grand final).
    for (const f of out.finals) {
      const draw = await finalsDraw(f.division);
      f.champion = (draw && draw.champion && draw.champion.name) || '';
      if (!f.finalsNight) continue;
      for (const g of games.filter(x => x.division === f.division)) {
        const same = x => x.playhqId === g.id || [[x.home.name, x.away.name], [x.away.name, x.home.name]].some(([h, a]) => sameName(h, g.home.name) && sameName(a, g.away.name));
        const it = draw && !draw.error && draw.games.find(same);
        if (it) g.final = it.name;
      }
    }
    if (want.has('finals')) out.finalsDraw = await finalsDraw(String(q.division || ''));
    if (want.has('ladders') || want.has('review')) out.ladders = await ladders(dates, date, games);
    if (want.has('review')) out.review = stats.review(games, out.ladders);
    // The Upcoming pictures worked out from the season (socialstats.js). What the tab needs to list them comes every time
    // (cheap, from the fixture): byes, the countdown, the divisions in their finals race, and those starting their season.
    const season = seasonOf(dates);
    const withFinals = [...new Set(season.map(g => g.division).filter(d => d && hasFinals(d)))];
    out.byes = stats.byes(season, games).map(b => ({ ...b, teams: b.teams.map(name => ({ name, logo: logoFor(name) })) }));
    out.countdown = stats.countdown(season, date, withFinals);
    // A race only where some teams miss out: more teams on the ladder than finals places.
    out.raceOn = [];
    for (const r of stats.raceOn(season, date, [...new Set(games.map(g => g.division))].filter(d => withFinals.includes(d)))) {
      try { const l = await ladderFor(r.division); if (l.finalsPlaces && l.rows.length > l.finalsPlaces) out.raceOn.push(r); } catch { /* no ladder, no race */ }
    }
    out.firstNights = stats.firstNights(season, date);
    const division = String(q.division || '');
    // How often each game's teams have met before this night this season (Head to head lists a game once they have).
    out.met = games.map(g => ({ id: g.id, n: stats.formOf(season, date, g).meetings.length }));
    if (want.has('form')) out.form = games.filter(g => !q.game || g.id === q.game).map(g => stats.formOf(season, date, g));
    if (want.has('preview')) out.preview = await withLadder(division, (rows, fp) => stats.preview(games, division, rows, fp));
    if (want.has('race')) out.race = await withLadder(division, (rows, fp) => stats.race(season, date, division, rows, fp));
    if (want.has('draw')) out.draw = { division, team: String(q.team || ''), logo: logoFor(String(q.team || '')), games: stats.draw(season, division, String(q.team || '')).map(g => ({ ...g, opponentLogo: logoFor(g.opponent) })) };
    if (want.has('milestones')) out.milestones = await milestones(games);
    // The Results pictures worked out from the season and the line ups. Always: the clubs with more than one game, the
    // teams on a run, and the divisions ending their season.
    out.clubs = stats.clubs(games, clubOf);
    out.streaks = stats.streaks(season, date, games).map(x => ({ ...x, logo: logoFor(x.team) }));
    out.lastNights = stats.lastNights(season, date);
    out.superShotDivisions = [...new Set(games.map(g => g.division))].filter(d => d && superShots(d));
    const tonightIn = div => raw.filter((g, i) => games[i].finished && games[i].division === div);
    const seasonIn = div => Object.keys(dates).filter(d => d <= date).sort().flatMap(d => dates[d]).filter(g => g.division === div && brief(g).finished);
    if (want.has('accuracy')) out.accuracy = await accuracy(tonightIn(division), division);
    if (want.has('supershots')) out.superShots = await superLeaders(tonightIn(division), seasonIn(division), division);
    if (want.has('onfire')) out.onFire = await onFire(seasonIn(division), date, division);
    if (want.has('numbers')) out.numbers = { ...stats.numbers(games), ...(await nightSupers(raw.filter((g, i) => games[i].finished))) };
    if (want.has('season')) out.season = await seasonCard(season, date, division, String(q.team || ''), seasonIn(division));
    if (want.has('wrap')) out.wrap = await wrap(season, date, division, seasonIn(division));
    // The hand picks and spotlights (picked on the tab), and the next night for Thanks for watching.
    out.nextNight = all.find(d => d > date) || null;
    const finishedIn = div => raw.filter((g, i) => games[i].finished && (!div || games[i].division === div));
    if (want.has('lineups')) out.lineups = await lineups(finishedIn(division));
    if (want.has('potm')) out.potm = await playerOfMatch(raw.find((g, i) => games[i].id === q.game && games[i].finished), String(q.athlete || ''), String(q.medal || ''));
    if (want.has('teamround')) out.teamRound = await teamOfRound(finishedIn(division), division, q);
    if (want.has('spotlight')) out.spotlight = await athleteSpotlight(String(q.athlete || ''), date, Object.keys(dates).filter(d => d <= date).sort().flatMap(d => dates[d]));
    if (want.has('sponsorlist')) out.sponsorList = sponsorList();
    if (want.has('sponsorspot')) out.sponsorSpot = sponsorSpotlight(String(q.sponsor || ''), date, out.today || date < today);
    // Game story and Score worm (the streamed games Studio kept a story of) and Watch it back.
    out.stories = games.filter(g => g.finished && storyFor(g.id)).map(g => g.id);
    if (want.has('story')) out.story = storyOf(games.find(g => g.id === q.game));
    out.ofNight = ofTheNight(games.filter(g => out.stories.includes(g.id)));
    if (want.has('gamestats')) out.gameStats = await gameStats(raw.find((g, i) => games[i].id === q.game && games[i].finished));
    if (want.has('teamsheet')) out.teamSheet = await teamSheet(games.find(g => g.id === q.game));
    out.watchLinks = watchLinks();
    if (want.has('watch')) out.watch = watchIt(String(q.link || ''));
    if (want.has('shooters')) {
      const division = q.division ? String(q.division) : '';
      out.shooters = await shooters(raw.filter((g, i) => games[i].finished && (!division || games[i].division === division)));
    }
    if (want.has('tournament')) out.tournament = await tournament(dates, date, String(q.division || ''), /^\d\d:\d\d$/.test(q.after) ? q.after : '');
    return out;
  }

  // Every game of the season in date and time order, as socialstats.js takes them.
  function seasonOf(dates) {
    return Object.keys(dates).sort().flatMap(d => dates[d].map(g => {
      const b = brief(g);
      return { id: b.id, date: d, time: b.time, court: b.court, division: b.division, round: b.round, finished: b.finished,
        home: { name: b.home.name, score: b.home.score }, away: { name: b.away.name, score: b.away.score } };
    }));
  }
  // A division's ladder as it stands (with each team's logo) handed to fn with its finals places, or { division, error }.
  async function withLadder(division, fn) {
    if (!division) return { division, error: 'Pick a division.' };
    try {
      const l = await ladderFor(division);
      const out = fn(l.rows, l.finalsPlaces || 0);
      for (const r of out.rows || []) r.logo = logoFor(r.team);
      return out;
    } catch (err) {
      log('warn', 'socials', `No ladder for ${division}: ${err.message}`);
      return { division, error: `No ladder from PlayHQ: ${err.message}` };
    }
  }
  // The night's milestones (athletes.js: a first game, or a 50th, 100th...), each with their photo when approved and
  // their team's logo; on a finished game they played it, on one to come their next game would be it.
  async function milestones(games) {
    try {
      return (await milestonesFor(games)).map(m => ({ ...m, photo: photoFor(m.name), logo: logoFor(m.team) }));
    } catch (err) {
      log('warn', 'socials', `No milestones: ${err.message}`);
      return [];
    }
  }

  // The divisions playing this night that have a finals format and are at the finals: their last home and away round
  // (lastRound: Finals bound and the Finals draw, once its results are in; left: its games still to finish) or a finals
  // round (finalsNight: PlayHQ has the finals as fixtures). night() adds champion: the grand final's winner, once there is one.
  function finalsOn(dates, date, games) {
    const out = [];
    for (const division of [...new Set(games.map(g => g.division).filter(Boolean))]) {
      if (!hasFinals(division)) continue;
      const mine = games.filter(g => g.division === division);
      const finalsNight = mine.some(g => FINALS_ROUND.test(g.round));
      const regular = Object.keys(dates).sort().filter(d => dates[d].some(g => g.division === division && !FINALS_ROUND.test(g.round || '')));
      const lastRound = !finalsNight && regular[regular.length - 1] === date;
      if (finalsNight || lastRound) out.push({ division, finalsNight, lastRound, left: mine.filter(g => !g.finished).length });
    }
    return out;
  }
  // A division's finals (games.js getFinals: the format, the ladder's finals places and every game worked out so far).
  async function finalsDraw(division) {
    if (!division) return { division, error: 'Pick a division.' };
    try { return await finalsOf(division); } catch (err) {
      log('warn', 'socials', `No finals for ${division}: ${err.message}`);
      return { division, error: err.message };
    }
  }

  // What the running top shooters are called: as the competition setup says, else Tournament when its fixture runs
  // under 15 days from first game to last (a carnival or nationals), Season when longer (a league).
  function running(dates, set) {
    if (set === 'tournament' || set === 'season') return set === 'tournament' ? 'Tournament' : 'Season';
    const days = dates.length ? (Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 864e5 + 1 : 0;
    return days && days < 15 ? 'Tournament' : 'Season';
  }

  // A division's top shooters so far: every finished game of the division up to and including this night (after: only
  // this night's games starting by then), most points first (goals where there are no super shots). round: the latest
  // round counted, which they're "after". Each has their move since the round before it (moved: places up, or down when
  // below 0; fresh: new to the top), so a carnival day with several rounds compares round by round; games with no round
  // compare with the day before.
  async function tournament(dates, date, division, after) {
    const mine = d => (dates[d] || []).filter(g => g.division === division && isFinished(g)).sort((x, y) => slotOf(x).localeCompare(slotOf(y)));
    const before = Object.keys(dates).sort().filter(d => d < date);
    const tonight = mine(date).filter(g => !after || slotOf(g) <= after);
    const earlier = before.flatMap(mine);
    const counted = [...earlier, ...tonight];
    const last = counted[counted.length - 1];
    const round = (last && last.round) || '';
    const prior = round ? counted.filter(g => g.round !== round) : earlier;
    const out = { division, after, round, players: [], gamesRead: 0, gamesFinished: counted.length,
      superShots: !!superShots(division), compared: false };
    if (!division || !out.gamesFinished) return out;
    const order = list => [...list].sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name));
    const key = p => `${p.name.toLowerCase()}|${p.team.toLowerCase()}`;
    const now = await tallyShooters(counted);
    out.gamesRead = now.read;
    if (!now.read && now.failed) out.error = now.lastError;
    // Where each stood after the round before; none when this is the division's first.
    let was = null;
    if (prior.length && prior.length < counted.length) {
      const then = await tallyShooters(prior);
      if (then.read) { was = new Map(order(then.players).map((p, i) => [key(p), i + 1])); out.compared = true; }
    }
    out.players = order(now.players).slice(0, TOURNAMENT_SHOWN).map((p, i) => {
      const prev = was && was.get(key(p));
      return { name: p.name, team: p.team, logo: p.logo, photo: photoFor(p), games: p.games, goals: p.goals, superGoals: p.superGoals, points: p.points,
        ...(was ? (prev && prev <= TOURNAMENT_SHOWN ? { moved: prev - (i + 1) } : { fresh: true }) : {}) };
    });
    return out;
  }

  // The ladder of each division that played that night, as PlayHQ has it now. after: the round, when this night is
  // that division's latest with results (so "after Round 5" is true); else the ladder is simply today's. asAt: what the
  // ladder is after either way, the division's latest night with results (its date and round; null before any). On the
  // division's latest night each row also has before (its place before this night's games) and moved (places up, or
  // down when below 0), and the ladder has movers: true, unless nobody had played before this night.
  async function ladders(dates, date, games) {
    const out = [];
    for (const division of [...new Set(games.map(g => g.division).filter(Boolean))]) {
      const latest = Object.keys(dates).sort().filter(d => dates[d].some(g => g.division === division && isFinished(g))).pop();
      const round = (games.find(g => g.division === division) || {}).round || '';
      const asAt = latest ? { date: latest, round: (dates[latest].filter(g => g.division === division && isFinished(g)).pop() || {}).round || '' } : null;
      try {
        const l = await ladderFor(division);
        const was = latest === date ? stats.placesBefore(l.rows, games.filter(g => g.division === division && g.finished)) : null;
        const rows = l.rows.map(r => ({ ...r, logo: logoFor(r.team), ...(was ? { before: was.get(r.team), moved: was.get(r.team) - r.position } : {}) }));
        out.push({ division, after: latest === date ? round : '', asAt, rows, finalsPlaces: l.finalsPlaces || 0, movers: !!was });
      } catch (err) {
        log('warn', 'socials', `No ladder for ${division}: ${err.message}`);
        out.push({ division, after: '', asAt, rows: [], error: err.message });
      }
    }
    return out;
  }

  // ─── Shooting for the Results pictures (each finished game's line ups, read once and kept) ───────────────────
  const shooterOf = p => ({ name: p.name, team: p.team, logo: p.logo, photo: photoFor(p), games: p.games, goals: p.goals, superGoals: p.superGoals,
    shots: p.shots, points: p.points, accuracy: p.shots ? Math.round((p.goals + p.superGoals) / p.shots * 1000) / 10 : null });
  const ACCURACY_SHOTS = 10; // the attempts a shooter needs that night to count for Sharpshooter
  // Sharpshooter: a division's best shooting accuracy that night (goals and super goals over attempts), ACCURACY_SHOTS
  // attempts or more.
  async function accuracy(finished, division) {
    const t = finished.length ? await tallyShooters(finished) : { players: [], read: 0 };
    const players = t.players.filter(p => p.shots >= ACCURACY_SHOTS).map(shooterOf).sort((a, b) => b.accuracy - a.accuracy || b.goals - a.goals).slice(0, SHOOTERS_SHOWN);
    return { division, minShots: ACCURACY_SHOTS, players, gamesFinished: finished.length, gamesRead: t.read };
  }
  // Super shot leaders: a super shot division's most super shots that night and over the season so far, top 3 each.
  const SUPER_SHOWN = 3;
  async function superLeaders(finished, seasonGames, division) {
    if (!superShots(division)) return { division, error: `${division} doesn't play super shots.` };
    const top = async list => list.length ? (await tallyShooters(list)).players.filter(p => p.superGoals).map(shooterOf)
      .sort((a, b) => b.superGoals - a.superGoals || b.points - a.points).slice(0, SUPER_SHOWN) : [];
    return { division, night: await top(finished), season: await top(seasonGames), gamesFinished: finished.length };
  }
  // On fire: a division's shooters who played that night whose goals a game (super goals counted as goals) over their last
  // three games rose most on their games before; rise: by how much (at least one earlier game needed).
  const FIRE_RECENT = 3, FIRE_SHOWN = 5;
  async function onFire(seasonGames, date, division) {
    const per = new Map();
    for (const g of seasonGames) {
      for (const p of (await tallyShooters([g])).players) {
        const k = `${p.name.toLowerCase()}|${p.team.toLowerCase()}`;
        const x = per.get(k) || { ...shooterOf(p), list: [], tonight: false };
        x.list.push(p.goals + p.superGoals);
        x.tonight = x.tonight || g.date === date;
        per.set(k, x);
      }
    }
    const avg = l => l.reduce((a, b) => a + b, 0) / l.length;
    const players = [...per.values()].filter(x => x.tonight && x.list.length > 1).map(x => {
      const n = Math.min(FIRE_RECENT, x.list.length - 1), recent = x.list.slice(-n), earlier = x.list.slice(0, -n);
      return { name: x.name, team: x.team, logo: x.logo, photo: x.photo, recent: Math.round(avg(recent) * 10) / 10, earlier: Math.round(avg(earlier) * 10) / 10,
        last: recent, rise: Math.round((avg(recent) - avg(earlier)) * 10) / 10 };
    }).filter(x => x.rise > 0).sort((a, b) => b.rise - a.rise || a.name.localeCompare(b.name)).slice(0, FIRE_SHOWN);
    return { division, players };
  }
  // The night's super shots, for Night in numbers (only where a division that played has them).
  async function nightSupers(finished) {
    if (!finished.some(g => superShots(g.division))) return { superShots: null };
    const t = await tallyShooters(finished);
    return { superShots: t.players.reduce((n, p) => n + p.superGoals, 0) };
  }
  // Team season card (&division= &team=): socialstats.teamCard with its ladder place, logos, and its top shooter so far.
  async function seasonCard(season, date, division, team, seasonGames) {
    if (!division || !team) return { division, team, error: 'Pick a team.' };
    let rows = [];
    try { rows = (await ladderFor(division)).rows; } catch (err) { log('warn', 'socials', `No ladder for ${division}: ${err.message}`); }
    const card = stats.teamCard(season, date, division, team, rows);
    const mine = seasonGames.filter(g => sameName(g.home.name, team) || sameName(g.away.name, team));
    const top = mine.length ? (await tallyShooters(mine)).players.filter(p => sameName(p.team, team)).sort((a, b) => b.points - a.points)[0] : null;
    return { ...card, logo: logoFor(team), topShooter: top ? shooterOf(top) : null, results: card.results.map(r => ({ ...r, logo: logoFor(r.opponent) })) };
  }
  // Season wrap (&division=): its champions once known, the season's top shooter, best accuracy (ACCURACY_SHOTS
  // attempts a game on average), most super shots (where it has them) and biggest win.
  async function wrap(season, date, division, seasonGames) {
    if (!division) return { division, error: 'Pick a division.' };
    const all = seasonGames.length ? (await tallyShooters(seasonGames)).players.map(shooterOf) : [];
    const best = (list, f) => [...list].sort((a, b) => f(b) - f(a))[0] || null;
    const draw = hasFinals(division) ? await finalsDraw(division) : null;
    const big = stats.biggestWin(season, date, division);
    return { division, champion: (draw && draw.champion) ? { name: draw.champion.name, logo: logoFor(draw.champion.name) } : null,
      topShooter: best(all, p => p.points), accuracy: best(all.filter(p => p.shots >= ACCURACY_SHOTS * p.games), p => p.accuracy),
      superShots: superShots(division) ? best(all.filter(p => p.superGoals), p => p.superGoals) : null,
      biggestWin: big && { ...big, home: { ...big.home, logo: logoFor(big.home.name) }, away: { ...big.away, logo: logoFor(big.away.name) } } };
  }

  // ─── Game story, Score worm and Watch it back ────────────────────────────────────────────────────────────
  // A streamed game's story (board.js keeps its Game stats and Score worm as the game left them), with the result from
  // the fixture and the logos; whether it's sure: the goals were all seen, and the score at the end is the result.
  function storyOf(g) {
    if (!g) return { error: 'Pick a game.' };
    const s = storyFor(g.id);
    if (!s) return { error: `Studio didn't stream ${g.home.name} v ${g.away.name}, so it has no story of it.` };
    const side = k => ({ ...g[k], logo: logoFor(g[k].name), colour: (s.stats && s.stats[k] && s.stats[k].colour) || (s.worm && s.worm[k] && s.worm[k].colour) || null });
    const kept = { home: Number(s.stats.home.score) || 0, away: Number(s.stats.away.score) || 0 };
    return { game: { ...g, home: side('home'), away: side('away') }, stats: s.stats, worm: s.worm, moments: s.moments || [],
      complete: !s.stats.gapInHistory && g.finished && kept.home === g.home.score && kept.away === g.away.score };
  }
  // Runs of the night, Super shot time and Comeback of the night, from the night's streamed games' stories (read from
  // the local folder, so cheap): each game's longest run and its runs of 3 and 5, the longest first; each super shot
  // game's points in each quarter's super shot period (timed goals only); and the winner who came back from furthest
  // behind (the most the losing team led by), with that game's worm.
  function ofTheNight(streamed) {
    const told = streamed.map(storyOf).filter(x => !x.error);
    const runs = told.map(x => {
      const st = (x.stats && x.stats.stats) || {}, lr = st.longestRun || {};
      const side = (lr.home || 0) >= (lr.away || 0) ? 'home' : 'away';
      return { game: x.game, longest: { side, n: lr[side] || 0 }, runs3: st.runs3 || { home: 0, away: 0 }, runs5: st.runs5 || { home: 0, away: 0 }, complete: x.complete };
    }).filter(r => r.longest.n > 1).sort((a, b) => b.longest.n - a.longest.n);
    const supers = told.filter(x => superShots(x.game.division) && x.worm && x.worm.superShot && x.worm.superShot.timed)
      .map(x => ({ game: x.game, points: x.worm.superShot.points, byPeriod: x.worm.superShot.byPeriod || [], periodLabel: x.worm.periodLabel || 'Q' }));
    let comeback = null;
    for (const x of told) {
      const g = x.game, win = g.home.score > g.away.score ? 'home' : g.away.score > g.home.score ? 'away' : '';
      const lose = win === 'home' ? 'away' : 'home';
      const down = win && x.worm && x.worm.biggestLead && x.worm.biggestLead[lose] ? x.worm.biggestLead[lose].margin : 0;
      if (down > 0 && (!comeback || down > comeback.down)) comeback = { game: g, side: win, down, worm: x.worm, complete: x.complete };
    }
    return { runs, supers, comeback };
  }
  // Links to suggest for Watch it back: each stream on Live viewers (Competitions setup), as a page where its videos stay.
  function watchLinks() {
    const out = [];
    for (const st of streamsFor()) {
      const w = String(st.where || '').trim();
      if (!w) continue;
      let link = '';
      if (/^https?:\/\//i.test(w)) link = w;
      else if (st.platform === 'youtube') link = /^@/.test(w) ? `https://www.youtube.com/${w}/streams` : /^UC[\w-]{20,}$/.test(w) ? `https://www.youtube.com/channel/${w}/streams` : '';
      else if (st.platform === 'facebook') link = `https://www.facebook.com/${encodeURIComponent(w)}/live_videos`;
      if (link) out.push({ name: st.name || st.platform, link });
    }
    return out;
  }
  // Watch it back (&link=): the replay's link as a QR code (an http or https link only), and the link shortened to show.
  function watchIt(link) {
    if (!link) return { error: 'Paste the link to watch it back on the Socials tab.' };
    if (!/^https?:\/\/[^\s]+$/i.test(link)) return { error: 'That isn\'t a web link: it starts with https://.' };
    try { return { link, shown: link.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), qr: qrFor(link) }; }
    catch (err) { return { error: `No QR code for that link: ${err.message}` }; }
  }

  // ─── Game stats, Shooting duel and Team sheet ──────────────────────────────────────────────────────────────
  // A finished game's numbers from its line ups (every finished game, streamed or not): each team's goals, super goals,
  // attempts, misses, accuracy and points, and its shooters best first; with the story's quarters won, longest run,
  // biggest lead and lead changes when Studio streamed it (story, else null).
  async function gameStats(g) {
    if (!g) return { error: 'No result for that game yet.' };
    const b = brief(g);
    const [l] = await lineupsOf([g]);
    const side = which => {
      const players = l ? l[which].players.map(p => {
        const sh = p.shooting || {}, scored = (sh.goals || 0) + (sh.superGoals || 0), shots = sh.shots || 0;
        return { name: p.name, position: p.position, goals: sh.goals || 0, superGoals: sh.superGoals || 0, shots, points: sh.points || 0,
          accuracy: shots ? Math.round(scored / shots * 1000) / 10 : null };
      }).filter(p => p.shots || p.goals || p.superGoals).sort((x, y) => y.points - x.points || y.shots - x.shots || x.name.localeCompare(y.name)) : [];
      const sum = k => players.reduce((n, p) => n + p[k], 0);
      const goals = sum('goals'), superGoals = sum('superGoals'), shots = sum('shots');
      return { ...b[which], logo: logoFor(b[which].name), goals, superGoals, shots, misses: Math.max(0, shots - goals - superGoals), points: sum('points'),
        accuracy: shots ? Math.round((goals + superGoals) / shots * 1000) / 10 : null, shooters: players.map(p => ({ ...p, photo: photoFor({ name: p.name, team: b[which].name }) || null })) };
    };
    const story = storyFor(b.id);
    const ss = story && story.stats && story.stats.stats;
    const w = story && story.worm;
    return { game: { ...b, home: side('home'), away: side('away') }, read: !!l, superShots: !!superShots(b.division),
      error: l ? undefined : 'PlayHQ\'s line ups for this game couldn\'t be read.',
      story: ss ? { quartersWon: ss.quartersWon, longestRun: ss.longestRun, biggestLead: w && w.biggestLead, leadChanges: w ? w.leadChanges : null } : null };
  }
  // Team sheet (&game=): both teams' squads this season (everyone in their line ups), each with the position they play
  // most and their games played in the division.
  async function teamSheet(b) {
    if (!b) return { error: 'Pick a game.' };
    const side = async which => {
      let players = [];
      try { players = await teamSheetFor(b[which].name, b.division); } catch (err) { log('warn', 'socials', `No squad for ${b[which].name}: ${err.message}`); }
      return { ...b[which], logo: logoFor(b[which].name), players };
    };
    return { game: { ...b, home: await side('home'), away: await side('away') } };
  }

  // ─── Hand picks (Player of the match, Team of the round) and spotlights ───────────────────────────────────
  // The finished games' line ups to pick from: each game with both sides' players (name, position).
  async function lineups(finished) {
    const read = finished.length ? await lineupsOf(finished) : [];
    return finished.map((g, i) => {
      const b = brief(g), l = read[i];
      const side = which => ({ name: b[which].name, logo: logoFor(b[which].name), players: l ? l[which].players.map(p => ({ name: p.name, position: p.position })) : [] });
      return { id: b.id, division: b.division, read: !!l, home: side('home'), away: side('away') };
    });
  }
  // A player in a game's line ups (by name, either side), with their team, position, shooting that game and photo.
  function inLineup(l, b, name) {
    for (const which of ['home', 'away']) {
      const p = l && l[which].players.find(x => sameName(x.name, name));
      if (!p) continue;
      const sh = p.shooting || {};
      const shots = sh.shots || 0, scored = (sh.goals || 0) + (sh.superGoals || 0);
      return { name: p.name, team: b[which].name, logo: logoFor(b[which].name), photo: photoFor({ name: p.name, team: b[which].name, playhqIds: p.playhqId ? [String(p.playhqId)] : [] }) || photoFor(p.name),
        position: p.position, shooting: scored || shots ? { goals: sh.goals || 0, superGoals: sh.superGoals || 0, shots, points: sh.points || 0,
          accuracy: shots ? Math.round(scored / shots * 1000) / 10 : null } : null };
    }
    return null;
  }
  // Player of the match (&game=&athlete=, &medal= a medal's name for a special round): the athlete picked from either
  // team's line up, with that game's score.
  async function playerOfMatch(g, name, medal) {
    if (!g) return { error: 'No result for that game yet.' };
    const b = { ...brief(g) };
    b.home = { ...b.home, logo: logoFor(b.home.name) }; b.away = { ...b.away, logo: logoFor(b.away.name) };
    const medalName = medal.trim().slice(0, 60);
    if (!name) return { game: b, medal: medalName, error: 'Pick the player of the match.' };
    const [l] = await lineupsOf([g]);
    const who = inLineup(l, b, name);
    return { game: b, medal: medalName, player: who || { name: name.trim(), team: '', logo: null, photo: photoFor(name), position: '', shooting: null } };
  }
  // Team of the round (&division=, &GS= .. &GK=): an athlete a position, each from that night's line ups in the division.
  async function teamOfRound(finished, division, q) {
    if (!division) return { error: 'Pick a division.' };
    const read = finished.length ? await lineupsOf(finished) : [];
    const players = POSITIONS.map(position => {
      const name = String(q[position] || '');
      if (!name) return { position, name: '' };
      for (const [i, g] of finished.entries()) { const who = inLineup(read[i], brief(g), name); if (who) return { ...who, position }; }
      return { position, name: name.trim(), team: '', logo: null, photo: photoFor(name) };
    });
    return { division, players, positions: POSITIONS };
  }
  // Athlete spotlight (&athlete=): one athlete from the register, with their photo when approved, teams, positions, games
  // played per division and this season's shooting.
  async function athleteSpotlight(name, date, seasonGames) {
    if (!name) return { error: 'Pick an athlete.' };
    const a = await spotlightFor(name, date);
    if (!a) return { error: `${name} isn't on the Athletes tab.` };
    const teams = a.teams.map(t => ({ ...t, logo: logoFor(t.team) }));
    const mine = seasonGames.filter(g => isFinished(g) && teams.some(t => t.division === brief(g).division && [brief(g).home.name, brief(g).away.name].some(n => sameName(n, t.team))));
    const shot = mine.length ? (await tallyShooters(mine)).players.find(p => sameName(p.name, a.name)) : null;
    return { name: a.name, photo: photoFor(a.name), teams, positions: a.positions, career: a.career,
      shooting: shot ? { games: shot.games, goals: shot.goals, superGoals: shot.superGoals, points: shot.points } : null };
  }
  // Sponsor spotlight (&sponsor=<id>): one sponsor big, with how long they were on screen that night once it has happened.
  function sponsorSpotlight(id, date, past) {
    const list = sponsorList();
    const x = list.find(s => s.id === id) || list[0];
    if (!x) return { error: 'No sponsors yet: add them on the Sponsors tab.' };
    let seconds = 0;
    if (past) try { seconds = onScreen(date)[x.id] || 0; } catch (err) { log('warn', 'socials', `No time on screen for ${date}: ${err.message}`); }
    return { ...x, seconds };
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
  // The pictures to save. As a carousel they're one post: one size, at most 20, in the order given; the app tells each
  // its place (?page=2/6) so it draws the 2/6 mark and, on all but the last, the arrow to swipe on.
  function carouselOf(body) {
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    if (body.carousel !== true) return items;
    if (new Set(items.map(it => it.size)).size > 1) throw Object.assign(new Error('A carousel is all one size: tick just one of Square, Portrait or Story.'), { status: 400 });
    if (items.length > CAROUSEL_MAX) throw Object.assign(new Error(`Instagram takes ${CAROUSEL_MAX} pictures at most in a carousel: untick ${items.length - CAROUSEL_MAX}.`), { status: 400 });
    return items;
  }
  // A file name from a picture's name: letters, digits, spaces and a few marks, never a path.
  const fileName = s => String(s || '').replace(/[^\p{L}\p{N} '&()+,.-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Picture';
  async function save(body, port) {
    const items = carouselOf(body);
    if (!appPort) throw Object.assign(new Error('Saving the pictures needs the FirstPass Studio app on the Mac. The previews here are what they will look like.'), { status: 501 });
    if (!items.length) throw Object.assign(new Error('Tick at least one picture to save.'), { status: 400 });
    const date = isDate(body.date) ? body.date : localDate();
    const set = SETS[body.set] || SETS.upcoming;
    const pictures = items.map((it, i) => {
      const size = SIZES[it.size];
      const link = String(it.link || '');
      // Only Studio's own social graphic is drawn, never another page or address.
      if (!size || !/^\/social\.html\?[^\s#]*$/.test(link)) throw Object.assign(new Error(`Picture ${i + 1} isn't one of the Socials tab's.`), { status: 400 });
      // The app numbers the files (01, 02...) in this order.
      return { label: `${fileName(it.name)} (${size.label.toLowerCase()})`, url: `http://localhost:${port}${link}`, width: size.width, height: size.height };
    });
    const competition = fileName(about().competition || 'Studio');
    const folder = `${competition} ${date} ${set}${body.carousel === true ? ' carousel' : ''}`;
    const id = crypto.randomUUID();
    const answer = new Promise(resolve => {
      waiting.set(id, resolve);
      setTimeout(() => { if (waiting.delete(id)) resolve({ error: 'The Mac app took too long to save the pictures.' }); }, EXPORT_TIMEOUT_MS).unref();
    });
    log('info', 'socials', `Saving ${pictures.length} pictures for ${date} (${set})${body.share ? ' to share' : ''}`);
    appPort.postMessage({ type: 'socialsSave', id, folder, carousel: body.carousel === true, pictures, share: body.share === true, zip: body.zip === true });
    const m = await answer;
    if (m.error) { log('warn', 'socials', `Saving the pictures for ${date}: ${m.error}`); throw Object.assign(new Error(m.error), { status: 500 }); }
    const skipped = m.skipped || [];
    log('info', 'socials', `Saved ${m.files.length} pictures in ${m.folder}${m.zip ? `, and ${m.zip}` : ''}`);
    for (const x of skipped) log('warn', 'socials', `Skipped ${x.name}: ${x.reason}`);
    return { folder: m.folder, files: m.files.map(f => path.basename(f)), skipped, zip: m.zip || null, shared: !!m.shared };
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

  return { route, list, night, settings, saveSettings, savePhoto, colourSets: () => allSets(settings().colourSets), SIZES, KINDS, KIND_NAMES, TEMPLATES };
}

module.exports = { create, SIZES, KINDS, KIND_NAMES };
