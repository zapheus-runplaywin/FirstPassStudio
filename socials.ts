// FirstPass Studio - the Socials tab (socials.html): pictures of a game night for social media, saved as PNGs.
//
// The pictures are drawn by social.html (one graphic per link, at Instagram's square, portrait or Stories size) from
// what Studio already has: the season's fixture and results, read through the same cache as every other page (so the
// tab adds nothing to what PlayHQ is asked), the ladders, the night's shooting from each finished game's line ups (read
// once and kept, as for Top shooters), the Production Planner's court and commentators, the competition's sponsors
// and logos. Two sets: Upcoming (before the night) and Results (after it). The Mac app takes the pictures (desktop/socials.ts): the helper asks it over the app's message port, it
// draws each link off screen at its full size and saves the PNGs in Pictures/FirstPass Studio/, then opens the folder
// or the Mac's Share menu. Saved from a phone (or another computer), the Mac makes them in a temporary folder and the
// phone fetches them to keep. Without the Mac app (npm start) the previews work and Export says it needs the app.
//
// Saved per competition in competitions/<id>/socials.json: { mark, pivt, sponsor: { <kind>: true|false }, colours,
// colourSets: [{ id, name, ground, highlight, accent }], template, favourites: [<template id>], favouritesOnly, movers,
// pictureSets: [{ id, name, kinds: [<kind>] }], pictureSet: <set id or '' for all>, hashtags }: the
// FirstPass Studio mark and the PIVT logo in the corners, which graphics carry the sponsor strip, the colour set in use
// and the ones made by hand, the template set, and the template sets starred (and whether the tab lists only those),
// and the picture sets (which kinds of picture the tab shows, picked on its Show row), and the hashtags and @handles
// on the end of every AI caption (captions.ts), kept week to week. Photos dropped on a polaroid stay
// on this Mac only (socials-photos/ in the local folder, never in a backup or iCloud); the oldest go after PHOTOS_KEPT.
//
// Routes (server.ts hands every /api/socials and /socials/ request here):
//   GET  /api/socials                    the game nights, the settings, the kinds of picture (KIND_NAMES) and whether
//                                        pictures can be saved (app: the Mac app) and here (the page is open on this Mac)
//   GET  /api/socials/night?date=        one night for social.html (?kind= with the rest of a picture's link: what that
//                                        kind of picture needs, NEEDS): its games and results, the streamed court, sponsors,
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
//                                        Results: &with=accuracy|supershots|teamsupers|onfire&division= (Sharpshooter, Super shot
//                                        leaders, Team super shots, On fire); &with=numbers (Night in numbers, with lead changes, goals in a row and runs of
//                                        5 goals only when every finished game has a complete story; goalOrder, always: { complete, of, missing }); &with=season&division=&team= (Team season card);
//                                        &with=wrap&division= (Season wrap). Always: clubs (Club round up), streaks (Still unbeaten)
//                                        and lastNights (divisions ending their season)
//                                        Hand picks: &with=lineups (&division=) each finished game's line ups, to pick from;
//                                        &with=potm&game=&athlete= (&medal=) Player of the match; &with=teamround&division=
//                                        &GS=..&GK= Team of the round; &with=spotlight&athlete= Athlete spotlight;
//                                        &with=sponsorspot&sponsor=<id> Sponsor spotlight (with their time on screen that
//                                        night); &with=sponsorlist every sponsor, to pick from. Always: nextNight (Thanks for watching)
//                                        &with=story&game= the game's story as the scoreboard kept it (Game story, Score worm);
//                                        &with=watch&link= a QR code for the replay's link (Watch it back). Always: stories (the
//                                        night's games with a kept story, this Mac's or copied from another Studio Mac; storiesFrom:
//                                        [{ studio, via: network|icloud|filled, games }] the copies, and the Macs whose stories filled gaps in this one's) and watchLinks (links suggested from Live viewers);
//                                        the story's moments are Moments of the game's
//                                        &with=gamestats&game= a finished game's team and shooter totals from its line ups (Game
//                                        stats, Shooting duel), with the story's quarters, runs and leads when Studio streamed or followed it;
//                                        &with=teamsheet&game= both teams' season squads with games played (Team sheet). Head to
//                                        head is the Form guide's meetings (&with=form&game=). Always: ofNight, the streamed
//                                        games' Runs of the night, Super shot time and Comeback of the night
//   GET  /api/socials/athletes           the athletes with a photo they approved the use of, to pick for a picture
//   POST /api/socials/settings           { mark, pivt, sponsor: { kind: bool }, colours: <set id>, colourSets: [...], template: <id>,
//                                        favourites: [<template id>], favouritesOnly: bool, movers: bool,
//                                        pictureSets: [{ id?, name, kinds }], pictureSet: <set id or ''> }
//   POST /api/socials/photo?name=x.jpg   the photo's bytes; answers { photo } for social.html's ?photo=
//   GET  /socials/photos/<file>          a dropped photo
//   POST /api/socials/export             { date, set: upcoming|results, share, zip, carousel, items: [{ name, link, size }],
//                                        captions: [{ name, text }] }: the app saves them (and a zip of them with zip: true),
//                                        with the captions in Captions.txt beside them. carousel: true saves them as one
//                                        Instagram carousel in their order: one size, up to 20, each marked 1/6, 2/6...
//                                        (?page=), in a folder of its own. A picture that can't be made is skipped and the
//                                        rest saved: answers { folder, files, skipped: [{ name, reason }], zip, shared }.
//                                        toDevice: true (a phone) makes them in a temporary folder on the Mac (folder: null),
//                                        opening nothing, and adds made: { pictures: [{ name, url }], zip: { name, url } | null }
//   GET  /api/socials/made/<id>/<n|zip>  a picture (or the zip) saved for a phone, for an hour; private like the
//                                        settings (access.ts), so with the lock on only a paired device gets it

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as uploads from './uploads';
import * as access from './access';
import { isFinished } from './playhq';
import { TEMPLATE_FONTS } from './fonts';
import { ROUND as FINALS_ROUND } from './finals';
import * as stats from './socialstats';
import { errorMessage } from './errors';
import { arr, isObj, num, obj, own, str } from './check';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type * as Competitions from './competitions';
import type * as SaveFile from './savefile';
import type * as Planner from './planner';
import type { GamesApi, LiveRow } from './games';
import type { AthletesApi } from './athletes';
import type { BoardApi } from './board';
import type { Story } from './stories';
import type { LadderRow } from './playhq';
import type { Body, Log, ParentPort, Query, ReadBody, ReadRaw, Send } from './types';
const { sameName } = stats;

// A game of a night as the Production Planner has the fixture (planner.ts byDate), and every night's games by date.
type Raw = LiveRow;
type Dates = Record<string, Raw[]>;
// A side of a game for the pictures, and a game as social.html draws it (brief). final: its finals name, on a finals night.
interface Team { name: string; logo: string | null; score: number | null }
interface Brief {
  id: string; date: string; time: string; court: string; venue: string; division: string; round: string; home: Team; away: Team;
  finished: boolean; winner: 'home' | 'away' | 'draw' | null; final?: string;
}
// A game's line ups (games.ts readLineups), a side of them, and the season's shooters (games.ts tallyShooters).
type Lineup = NonNullable<Awaited<ReturnType<GamesApi['readLineups']>>[number]>;
type LineupSide = Lineup['home'];
type Shooter = Awaited<ReturnType<GamesApi['tallyShooters']>>['players'][number];
// A division's finals as the Finals page has them (games.ts getFinals), or why there are none.
type Finals = Awaited<ReturnType<GamesApi['getFinals']>>;
type FinalsDraw = Finals | { division: string; error: string };
// A kept story's Game stats and Score worm (board.ts getStats and getWorm made them).
type Stats = ReturnType<BoardApi['getStats']>;
type Worm = ReturnType<BoardApi['getWorm']>;
interface Told { stats: Stats; worm: Worm; moments?: unknown[] }
// A game's story for the pictures (storyOf), or why there's none.
interface StoryOut { error?: undefined; game: Brief; stats: Stats; worm: Worm; moments: unknown[]; complete: boolean }
type StoryOrNot = StoryOut | { error: string };
// A colour set (made from the competition's colours, or by hand on the tab) and a picture set (the kinds the tab shows).
interface ColourSet { id: string; name: string; ground: string; highlight: string; accent: string }
interface PictureSet { id: string; name: string; kinds: string[] }
// socials.json, as read (settings).
interface Settings {
  mark: boolean; pivt: boolean; sponsor: Record<string, boolean>; colours: string; colourSets: ColourSet[]; template: string;
  favourites: string[]; favouritesOnly: boolean; movers: boolean; pictureSets: PictureSet[]; pictureSet: string; hashtags: string;
}
// The competition, as the pictures name it (server.ts about).
interface About { competition: string; venue: string; logo: string | null; runningShooters: string; finalsWinners: string }
// A sponsor to pick for Sponsor spotlight (server.ts sponsorList).
interface SponsorPick { id: string; name: string; tier: string; tagline: string; website: string; logo: string | null }
// A player the athlete register knows (athletes.ts photoFor).
type Who = Parameters<AthletesApi['photoFor']>[0];
// What the Mac app answers when it has saved the pictures (desktop/socials.ts).
interface Saved { error?: string; folder: string | null; files: string[]; zip?: string; zipFile?: string; shared: boolean; skipped: { name: string; reason: string }[] }
// A division's ladder in a night's pictures (ladders).
interface NightLadderOut {
  division: string; after: string; asAt: { date: string; round: string } | null;
  rows: (LadderRow & { logo: string | null; before?: number; moved?: number })[]; finalsPlaces?: number; movers?: boolean; error?: string;
}

interface Deps {
  log: Log; competitions: typeof Competitions; savefile: typeof SaveFile; photosDir: string;
  byDate(): Promise<Dates>; onStream: ReturnType<typeof Planner.create>['onStream']; about(): About;
  logoFor(name: string): string | null; sponsorsFor(): unknown[];
  ladderFor(division: string): Promise<{ rows: LadderRow[]; finalsPlaces: number }>;
  tallyShooters: GamesApi['tallyShooters']; superShots(division: string): boolean;
  milestonesFor?: AthletesApi['milestones']; clubOf?(team: string): string; lineupsOf?: GamesApi['readLineups'];
  spotlightFor?: AthletesApi['spotlight']; teamSheetFor?: AthletesApi['teamSheet']; sponsorList?(): SponsorPick[];
  onScreen?(date: string): Record<string, number>; storyFor?(id: string): Story | null;
  storySources?(ids: string[]): unknown[]; qrFor?(link: string): string; streamsFor?(): Competitions.Stream[];
  hasFinals?(division: string): boolean; finalsOf?(division: string): Promise<Finals | null>;
  theme(): { colours: Competitions.Colours; panelOpacity: number }; photoFor?(who: Who): string | null;
  athletesWithPhotos?(): unknown[]; appPort?: ParentPort | null;
}

// The sizes Instagram takes: a square post, a portrait post (the most room in the feed) and a Story.
const SIZES: Record<string, { width: number; height: number; label: string }> = {
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
// far, called Tournament or Season top shooters), accuracy (Sharpshooter), supershots (Super shot leaders), teamsupers (Team super
// shots), onfire,
// numbers (Night in numbers), club (Club round up), streaks (Still unbeaten), season (Team season card), wrap (Season
// wrap), the hand picks potm (Player of the match) and teamround (Team of the round), thanks (Thanks for watching) and a
// polaroid per game; either set: spotlight (Athlete spotlight) and sponsorspot (Sponsor spotlight).
const KINDS: Record<string, boolean> = { fixtures: true, matchup: true, form: true, preview: true, byes: true, milestones: true, race: true, countdown: true, draw: true, onstream: true, commentators: true, polaroid: false, results: true, review: true, fulltime: true, ladder: true, topshooters: true, tournament: true, finalsbound: true, finalsdraw: true, champions: true,
  accuracy: true, supershots: true, teamsupers: true, onfire: true, numbers: true, club: true, streaks: true, season: true, wrap: true,
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
  ['accuracy', 'Sharpshooter', 'results'], ['supershots', 'Super shot leaders', 'results'], ['teamsupers', 'Team super shots', 'results'],
  ['onfire', 'On fire', 'results'],
  ['numbers', 'Night in numbers', 'results'], ['club', 'Club round up', 'results'], ['streaks', 'On a roll', 'results'],
  ['season', 'Team season card', 'results'], ['wrap', 'Season wrap', 'results'],
  ['potm', 'Player of the match', 'results'], ['teamround', 'Team of the round', 'results'], ['thanks', 'Thanks for watching', 'results'],
  ['story', 'Game story', 'results'], ['worm', 'Score worm', 'results'], ['watch', 'Watch it back', 'results'],
  ['gamestats', 'Game stats', 'results'], ['shooting', 'Shooting duel', 'results'], ['moments', 'Moments of the game', 'results'],
  ['runs', 'Runs of the night', 'results'], ['supershottime', 'Super shot time', 'results'], ['comeback', 'Comeback of the night', 'results'],
  ['milestones', 'Milestones', 'both'], ['finalsdraw', 'Finals draw', 'both'], ['polaroid', 'Polaroid', 'both'],
  ['spotlight', 'Athlete spotlight', 'both'], ['sponsorspot', 'Sponsor spotlight', 'both'],
].map(([kind, name, when]) => ({ kind, name, when }));
const KIND_IDS = KIND_NAMES.map(k => k.kind);
// What each kind of picture asks night() for (&with=) and which of its link's settings go with that: social.html draws
// from it, and an AI caption (captions.ts) is written from the same. A kind not listed needs only what every picture has.
const NEEDS: Partial<Record<string, string[]>> = {
  ladder: ['ladders'], review: ['review'], topshooters: ['shooters', 'division'], tournament: ['tournament', 'division', 'after'],
  finalsbound: ['finals', 'division'], finalsdraw: ['finals', 'division'], champions: ['finals', 'division'],
  accuracy: ['accuracy', 'division'], supershots: ['supershots', 'division'], teamsupers: ['teamsupers', 'division'], onfire: ['onfire', 'division'],
  numbers: ['numbers'], season: ['season', 'division', 'team'], wrap: ['wrap', 'division'],
  potm: ['potm', 'game', 'athlete', 'medal'], story: ['story', 'game'], worm: ['story', 'game'], moments: ['story', 'game'], gamestats: ['gamestats', 'game'],
  shooting: ['gamestats', 'game'], h2h: ['form', 'game'], teamsheet: ['teamsheet', 'game'], watch: ['watch', 'link'],
  teamround: ['teamround', 'division', 'GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'], spotlight: ['spotlight', 'athlete'], sponsorspot: ['sponsorspot', 'sponsor'],
  form: ['form', 'game'], preview: ['preview', 'division'], race: ['race', 'division'], draw: ['draw', 'division', 'team'], milestones: ['milestones'],
};
// A picture's link (social.html's ?kind=&date=...) as night() takes it: the night, its look, the athletes picked, and
// what its kind needs.
function nightQuery(link: Query): Query {
  const q: Query = {};
  for (const k of ['date', 'colours', 'template', 'home', 'away', 'athlete']) if (link[k]) q[k] = link[k];
  const needs = NEEDS[String(link.kind || '')];
  if (needs) { q.with = needs[0]; for (const k of needs.slice(1)) if (link[k]) q[k] = link[k]; }
  return q;
}
const MAX_PICTURE_SETS = 12;
const SHOOTERS_SHOWN = 6;
const TOURNAMENT_SHOWN = 8; // the tournament top shooters, a division's best so far
const MAX_OWN_SETS = 12;
const MAX_HASHTAGS = 300;
// The template sets: the look of every picture (public/social-templates.css, a class t-<id> on social.html's body),
// each with its display face (fonts.ts TEMPLATE_FONTS) and, for the ones that keep their own ground whatever the
// colours, which FirstPass Studio mark goes on it: light (the dark-ink one, on a pale ground) or white.
// A template font's stylesheet; script is a second face some templates use for one word (--sfont).
function fontCss(font: keyof typeof TEMPLATE_FONTS) { return `vendor/fonts/${TEMPLATE_FONTS[font]}/${TEMPLATE_FONTS[font]}.css`; }
interface Template { id: string; name: string; blurb: string; font: keyof typeof TEMPLATE_FONTS | null; script?: keyof typeof TEMPLATE_FONTS; mark?: 'light' | 'white' }
const TEMPLATES = ([
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
] satisfies Template[] as Template[]).map(t => ({ ...t, fontCss: t.font ? fontCss(t.font) : null, scriptCss: t.script ? fontCss(t.script) : null }));
// Sets dropped from the list, each drawn as the closest one kept, so a saved choice or an old link still works.
const RETIRED: Record<string, string> = { fun: 'default', geometric: 'default', futuristic: 'neon', '3d': 'neon', striped: 'gameday', arena: 'highcontrast' };
const templateOf = (id: unknown) => { const k = str(id); return TEMPLATES.find(t => t.id === (Object.hasOwn(RETIRED, k) ? RETIRED[k] : k)) || null; };
const HEX = /^#[0-9a-f]{6}$/i;
const PHOTO_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const PHOTOS_KEPT = 40;
const MAX_PHOTO = 40 * 1024 * 1024;
const MAX_ITEMS = 120;
const MAX_CAPTION_TEXT = 2600; // characters of one picture's caption saved in Captions.txt (a post takes 2200)
const CAROUSEL_MAX = 20; // Instagram's most pictures in one post
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;
// Pictures saved for another device (a paired phone): it fetches them from /api/socials/made/<id>/<n> for this long,
// and only the newest few saves are kept.
const MADE_KEPT_MS = 60 * 60 * 1000;
const MADE_KEPT = 5;

const isDate = (v: unknown): v is string => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const slotOf = (g: { time?: string | null }) => String(g.time || '').slice(0, 5);
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function create({ log, competitions, savefile, photosDir, byDate, onStream, about, logoFor, sponsorsFor, ladderFor, tallyShooters, superShots,
  milestonesFor = async () => [], clubOf = () => '', lineupsOf = async games => games.map(() => null), spotlightFor = async () => null, teamSheetFor = async () => [],
  sponsorList = () => [], onScreen = () => ({}), storyFor = () => null, storySources = () => [], qrFor = () => '', streamsFor = () => [], hasFinals = () => false, finalsOf = async () => null, theme, photoFor = () => null, athletesWithPhotos = () => [], appPort = process.parentPort || null }: Deps) {
  const PHOTOS = photosDir;

  // ─── Settings ─────────────────────────────────────────────────────────────
  const fileOf = (id: string) => path.join(competitions.DIR, id, 'socials.json');
  function settings(): Settings {
    let d: Body = {};
    const id = competitions.activeId();
    if (id) try { d = obj(JSON.parse(fs.readFileSync(fileOf(id), 'utf8'))); } catch { /* not changed yet */ }
    const sponsor: Record<string, boolean> = {};
    const saved = obj(d.sponsor);
    for (const [k, on] of Object.entries(KINDS)) { const v = saved[k]; sponsor[k] = typeof v === 'boolean' ? v : on; }
    const colourSets = arr(d.colourSets).filter(ownSet);
    const picked = str(d.colours);
    const colours = picked && allSets(colourSets).some(x => x.id === picked) ? picked : 'competition';
    const template = templateOf(d.template)?.id || 'default';
    const pictureSets = pictureSetsOf(d.pictureSets);
    const pictureSet = str(d.pictureSet);
    return { mark: d.mark !== false, pivt: d.pivt !== false, sponsor, colours, colourSets, template, favourites: favouritesOf(d.favourites), favouritesOnly: d.favouritesOnly === true,
      movers: d.movers !== false, pictureSets, pictureSet: pictureSets.some(x => x.id === pictureSet) ? pictureSet : '', hashtags: hashtagsOf(d.hashtags) };
  }
  // The hashtags and @handles put on the end of every AI caption (captions.ts), as typed: one line, at most MAX_HASHTAGS characters.
  const hashtagsOf = (v: unknown) => str(v).replace(/\s+/g, ' ').trim().slice(0, MAX_HASHTAGS);
  // Starred template sets, in the list's order; a retired one counts as the set it is now drawn as.
  const favouritesOf = (list: unknown) => TEMPLATES.map(t => t.id).filter(id => arr(list).some(x => templateOf(x)?.id === id));
  // The picture sets made on the tab, each { id: pset-N, name, kinds: [<kind>] } with the kinds in KIND_NAMES' order; a
  // kind no longer made is dropped.
  const pictureSetsOf = (list: unknown): PictureSet[] => arr(list).map(obj).filter(x => /^pset-\d+$/.test(str(x.id)) && typeof x.name === 'string' && Array.isArray(x.kinds))
    .map(x => ({ id: str(x.id), name: str(x.name), kinds: KIND_IDS.filter(k => arr(x.kinds).includes(k)) }));
  const ownSet = (x: unknown): x is ColourSet => {
    const o = obj(x);
    return /^own-\d+$/.test(str(o.id)) && typeof o.name === 'string' && [o.ground, o.highlight, o.accent].every(c => typeof c === 'string' && HEX.test(c));
  };
  function saveSettings(body: Body) {
    const id = competitions.activeId();
    if (!id) throw new Error('Set up a competition first, on the Competitions setup page.');
    const now = settings();
    if (typeof body.mark === 'boolean') now.mark = body.mark;
    if (typeof body.pivt === 'boolean') now.pivt = body.pivt;
    const sponsor = obj(body.sponsor);
    for (const k of Object.keys(KINDS)) { const v = sponsor[k]; if (typeof v === 'boolean') now.sponsor[k] = v; }
    if (Array.isArray(body.colourSets)) {
      if (body.colourSets.length > MAX_OWN_SETS) throw new Error(`Keep it to ${MAX_OWN_SETS} colour sets of your own.`);
      const sets = body.colourSets.map(obj).map((x, i) => ({ id: /^own-\d+$/.test(str(x.id)) ? str(x.id) : `own-${Date.now()}${i}`,
        name: str(x.name).trim().slice(0, 30) || 'My colours', ground: str(x.ground), highlight: str(x.highlight), accent: str(x.accent) }));
      if (!sets.every(ownSet)) throw new Error('A colour set needs three colours, each like #7f4092.');
      now.colourSets = sets;
    }
    const colours = body.colours;
    if (typeof colours === 'string') {
      if (!allSets(now.colourSets).some(x => x.id === colours)) throw new Error('There is no such colour set.');
      now.colours = colours;
    }
    if (!allSets(now.colourSets).some(x => x.id === now.colours)) now.colours = 'competition';
    if (typeof body.template === 'string') {
      const t = templateOf(body.template);
      if (!t) throw new Error('There is no such template set.');
      now.template = t.id;
    }
    if (Array.isArray(body.favourites)) {
      if (!body.favourites.every(x => templateOf(x))) throw new Error('There is no such template set.');
      now.favourites = favouritesOf(body.favourites);
    }
    if (typeof body.favouritesOnly === 'boolean') now.favouritesOnly = body.favouritesOnly;
    if (typeof body.movers === 'boolean') now.movers = body.movers;
    if (typeof body.hashtags === 'string') now.hashtags = hashtagsOf(body.hashtags);
    if (Array.isArray(body.pictureSets)) {
      if (body.pictureSets.length > MAX_PICTURE_SETS) throw new Error(`Keep it to ${MAX_PICTURE_SETS} picture sets.`);
      const sets = body.pictureSets.map(obj);
      if (!sets.every(x => Array.isArray(x.kinds) && x.kinds.every(k => own(KINDS, k) !== undefined))) throw new Error('There is no such kind of picture.');
      now.pictureSets = pictureSetsOf(sets.map((x, i) => ({ id: /^pset-\d+$/.test(str(x.id)) ? str(x.id) : `pset-${Date.now()}${i}`,
        name: str(x.name).trim().slice(0, 30) || 'My pictures', kinds: x.kinds })));
    }
    const pictureSet = body.pictureSet;
    if (typeof pictureSet === 'string') {
      if (pictureSet && !now.pictureSets.some(x => x.id === pictureSet)) throw new Error('There is no such picture set.');
      now.pictureSet = pictureSet;
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
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10; };
  const isLight = (hex: string) => lum(hex) > 0.4;
  function madeSets(): ColourSet[] {
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
  function allSets(own: ColourSet[]): (ColourSet & { own?: boolean; contrast: number })[] {
    return [...madeSets(), ...own.map(x => ({ ...x, own: true }))].map(x => ({ ...x, contrast: contrast(x.highlight, x.ground) }));
  }
  // The look of a set for social.html: theme.css's colour variables worked out for it (null for the competition's own),
  // light: a pale ground, which takes dark text and the dark-ink Studio mark, and the template set drawn with it.
  function look(id: string, own: ColourSet[], templateId = 'default') {
    const t = templateOf(templateId) || TEMPLATES[0];
    const template = { id: t.id, name: t.name, font: t.font, fontCss: t.fontCss, script: t.script || null, scriptCss: t.scriptCss, mark: t.mark || null };
    return { ...colourLook(id, own), template };
  }
  function colourLook(id: string, own: ColourSet[]) {
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
  const team = (t: { name: string; score: number | null }): Team => ({ name: t.name, logo: logoFor(t.name), score: t.score ?? null });
  // finished: PlayHQ has its result (the score is final); winner: home, away or draw.
  function brief(g: Raw): Brief {
    const h = g.home.score, a = g.away.score;
    const done = isFinished(g) && h !== null && a !== null;
    return { id: g.id, date: g.date || '', time: slotOf(g), court: g.court || '', venue: g.venue || '', division: g.division || '', round: g.round || '',
      home: team(g.home), away: team(g.away), finished: done,
      winner: !done ? null : h > a ? 'home' : a > h ? 'away' : 'draw' };
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
    const next = (nights.find(n => n.date >= today) ?? nights.at(-1))?.date || '';
    const s = settings();
    return { nights, next, today, sizes: SIZES, settings: s, colourSets: allSets(s.colourSets), templates: TEMPLATES, kinds: KIND_NAMES, app: !!appPort };
  }

  // One night, for social.html: every game (all courts, in time order) with its result once finished, the court
  // Studio streams with who is on the mic (from the Production Planner, or null when the night isn't planned), the top
  // sponsors and the competition. with: 'ladders' and/or 'shooters', for the Results pictures that need them, 'finals' for a
  // division's Finals bound and Finals draw (&division=). finals: the divisions at their finals this night.
  async function night(q: Query = {}) {
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
    } catch (err) { log('warn', 'socials', `No Production Planner for ${date}: ${errorMessage(err)}`); }
    const a = about();
    const venues = [...new Set(games.map(g => g.venue).filter(Boolean))];
    const s = settings();
    const base = { date, today: date === today, competition: a.competition || '', competitionLogo: a.logo || null, running: running(all, a.runningShooters), winners: a.finalsWinners || 'Champions',
      venue: a.venue || venues[0] || '', games, stream, sponsors: sponsorsFor(), settings: s, look: look(q.colours || s.colours, s.colourSets, templateOf(q.template)?.id ?? s.template) };
    // What every picture needs, then what &with= asks for (each read by social.html).
    const out: typeof base & Body = base;
    // Athletes picked on the tab (&home= &away= on a match up or full time, &athlete= on a polaroid), with their photo when
    // they approved its use; a name without one draws as if none was picked.
    const picked: Record<string, { name: string; photo: string }> = {};
    for (const k of ['home', 'away', 'athlete']) { const who = q[k]; if (who) { const photo = photoFor(who); if (photo) picked[k] = { name: who.trim(), photo }; } }
    out.picked = picked;
    const finals = finalsOn(dates, date, games);
    out.finals = finals;
    // Who won the division's finals (for the Champions picture), and on a finals night each finals game's name from the
    // division's finals format (Major semi final, Grand final).
    for (const f of finals) {
      const draw = await finalsDraw(f.division);
      f.champion = championOf(draw)?.name || '';
      if (!f.finalsNight) continue;
      for (const g of games.filter(x => x.division === f.division)) {
        const same = (x: { playhqId?: string | null; home: { name: string | null }; away: { name: string | null } }) => x.playhqId === g.id
          || [[x.home.name, x.away.name], [x.away.name, x.home.name]].some(([h, a]) => sameName(h, g.home.name) && sameName(a, g.away.name));
        const it = draw && 'games' in draw ? draw.games.find(same) : undefined;
        if (it) g.final = it.name;
      }
    }
    if (want.has('finals')) out.finalsDraw = await finalsDraw(String(q.division || ''));
    let nightLadders: NightLadderOut[] | null = null;
    if (want.has('ladders') || want.has('review')) out.ladders = nightLadders = await ladders(dates, date, games);
    if (want.has('review') && nightLadders) out.review = stats.review(games, nightLadders);
    // The Upcoming pictures worked out from the season (socialstats.ts). What the tab needs to list them comes every time
    // (cheap, from the fixture): byes, the countdown, the divisions in their finals race, and those starting their season.
    const season = seasonOf(dates);
    const withFinals = [...new Set(season.map(g => g.division).filter(d => d && hasFinals(d)))];
    out.byes = stats.byes(season, games).map(b => ({ ...b, teams: b.teams.map(name => ({ name, logo: logoFor(name) })) }));
    out.countdown = stats.countdown(season, date, withFinals);
    // A race only where some teams miss out: more teams on the ladder than finals places.
    const raceOn: ReturnType<typeof stats.raceOn> = [];
    for (const r of stats.raceOn(season, date, [...new Set(games.map(g => g.division))].filter(d => withFinals.includes(d)))) {
      try { const l = await ladderFor(r.division); if (l.finalsPlaces && l.rows.length > l.finalsPlaces) raceOn.push(r); } catch { /* no ladder, no race */ }
    }
    out.raceOn = raceOn;
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
    const tonightIn = (div: string) => raw.filter((g, i) => games[i].finished && games[i].division === div);
    const seasonIn = (div: string) => Object.keys(dates).filter(d => d <= date).sort().flatMap(d => dates[d]).filter(g => g.division === div && brief(g).finished);
    if (want.has('accuracy')) out.accuracy = await accuracy(tonightIn(division), division);
    if (want.has('supershots')) out.superShots = await superLeaders(tonightIn(division), seasonIn(division), division);
    if (want.has('teamsupers')) out.teamSupers = await teamSupers(tonightIn(division), seasonIn(division), division);
    if (want.has('onfire')) out.onFire = await onFire(seasonIn(division), date, division);
    const nightOrder = goalOrderNumbers(games);
    out.goalOrder = nightOrder.goalOrder; // for the Socials tab's note on Night in numbers
    if (want.has('numbers')) {
      const upsets = stats.review(games, nightLadders || await ladders(dates, date, games)).upsets.length;
      out.numbers = { ...stats.numbers(games), ...(await nightShooting(raw.filter((g, i) => games[i].finished))), upsets, ...nightOrder };
    }
    if (want.has('season')) out.season = await seasonCard(season, date, division, String(q.team || ''), seasonIn(division));
    if (want.has('wrap')) out.wrap = await wrap(season, date, division, seasonIn(division));
    // The hand picks and spotlights (picked on the tab), and the next night for Thanks for watching.
    out.nextNight = all.find(d => d > date) || null;
    const finishedIn = (div: string) => raw.filter((g, i) => games[i].finished && (!div || games[i].division === div));
    if (want.has('lineups')) out.lineups = await lineups(finishedIn(division));
    if (want.has('potm')) out.potm = await playerOfMatch(raw.find((g, i) => games[i].id === q.game && games[i].finished), String(q.athlete || ''), String(q.medal || ''));
    if (want.has('teamround')) out.teamRound = await teamOfRound(finishedIn(division), division, q);
    if (want.has('spotlight')) out.spotlight = await athleteSpotlight(String(q.athlete || ''), date, Object.keys(dates).filter(d => d <= date).sort().flatMap(d => dates[d]));
    if (want.has('sponsorlist')) out.sponsorList = sponsorList();
    if (want.has('sponsorspot')) out.sponsorSpot = sponsorSpotlight(String(q.sponsor || ''), date, out.today || date < today);
    // Game story and Score worm (the games Studio streamed or followed and kept a story of) and Watch it back.
    const stories = games.filter(g => g.finished && storyFor(g.id)).map(g => g.id);
    out.stories = stories;
    out.storiesFrom = storySources(stories); // the stories copied from other Studio Macs, or whose gaps they filled (stories.ts): [{ studio, via, games }]
    if (want.has('story')) out.story = storyOf(games.find(g => g.id === q.game));
    out.ofNight = ofTheNight(games.filter(g => stories.includes(g.id)));
    if (want.has('gamestats')) out.gameStats = await gameStats(raw.find((g, i) => games[i].id === q.game && games[i].finished));
    if (want.has('teamsheet')) out.teamSheet = await teamSheet(games.find(g => g.id === q.game));
    out.watchLinks = watchLinks();
    if (want.has('watch')) out.watch = watchIt(String(q.link || ''));
    if (want.has('shooters')) {
      const division = q.division ? String(q.division) : '';
      out.shooters = await shooters(raw.filter((g, i) => games[i].finished && (!division || games[i].division === division)));
    }
    if (want.has('tournament')) out.tournament = await tournament(dates, date, String(q.division || ''), q.after && /^\d\d:\d\d$/.test(q.after) ? q.after : '');
    return out;
  }

  // Every game of the season in date and time order, as socialstats.ts takes them.
  function seasonOf(dates: Dates): stats.SeasonResult[] {
    return Object.keys(dates).sort().flatMap(d => dates[d].map(g => {
      const b = brief(g);
      return { id: b.id, date: d, time: b.time, court: b.court, division: b.division, round: b.round, finished: b.finished,
        home: { name: b.home.name, score: b.home.score }, away: { name: b.away.name, score: b.away.score } };
    }));
  }
  // A division's ladder as it stands (with each team's logo) handed to fn with its finals places, or { division, error }.
  async function withLadder<T extends object>(division: string, fn: (rows: LadderRow[], finalsPlaces: number) => T) {
    if (!division) return { division, error: 'Pick a division.' };
    try {
      const l = await ladderFor(division);
      const out = fn(l.rows, l.finalsPlaces || 0);
      if ('rows' in out) for (const r of arr(out.rows)) if (isObj(r)) r.logo = logoFor(str(r.team));
      return out;
    } catch (err) {
      log('warn', 'socials', `No ladder for ${division}: ${errorMessage(err)}`);
      return { division, error: `No ladder from PlayHQ: ${errorMessage(err)}` };
    }
  }
  // The night's milestones (athletes.ts: a first game, or a 50th, 100th...), each with their photo when approved and
  // their team's logo; on a finished game they played it, on one to come their next game would be it.
  async function milestones(games: Brief[]) {
    try {
      return (await milestonesFor(games)).map(m => ({ ...m, photo: photoFor(m.name), logo: logoFor(m.team) }));
    } catch (err) {
      log('warn', 'socials', `No milestones: ${errorMessage(err)}`);
      return [];
    }
  }

  // The divisions playing this night that have a finals format and are at the finals: their last home and away round
  // (lastRound: Finals bound and the Finals draw, once its results are in; left: its games still to finish) or a finals
  // round (finalsNight: PlayHQ has the finals as fixtures). night() adds champion: the grand final's winner, once there is one.
  function finalsOn(dates: Dates, date: string, games: Brief[]) {
    const out: { division: string; finalsNight: boolean; lastRound: boolean; left: number; champion?: string }[] = [];
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
  // A division's finals (games.ts getFinals: the format, the ladder's finals places and every game worked out so far).
  async function finalsDraw(division: string): Promise<FinalsDraw | null> {
    if (!division) return { division, error: 'Pick a division.' };
    try { return await finalsOf(division); } catch (err) {
      log('warn', 'socials', `No finals for ${division}: ${errorMessage(err)}`);
      return { division, error: errorMessage(err) };
    }
  }
  // A division's champion, once its finals have one.
  const championOf = (draw: FinalsDraw | null) => draw && 'champion' in draw ? draw.champion : null;

  // What the running top shooters are called: as the competition setup says, else Tournament when its fixture runs
  // under 15 days from first game to last (a carnival or nationals), Season when longer (a league).
  function running(dates: string[], set: string) {
    if (set === 'tournament' || set === 'season') return set === 'tournament' ? 'Tournament' : 'Season';
    const days = dates.length ? (Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 864e5 + 1 : 0;
    return days && days < 15 ? 'Tournament' : 'Season';
  }

  // A division's top shooters so far: every finished game of the division up to and including this night (after: only
  // this night's games starting by then), most points first (goals where there are no super shots). round: the latest
  // round counted, which they're "after". Each has their move since the round before it (moved: places up, or down when
  // below 0; fresh: new to the top), so a carnival day with several rounds compares round by round; games with no round
  // compare with the day before.
  async function tournament(dates: Dates, date: string, division: string, after: string) {
    const mine = (d: string) => (dates[d] || []).filter(g => g.division === division && isFinished(g)).sort((x, y) => slotOf(x).localeCompare(slotOf(y)));
    const before = Object.keys(dates).sort().filter(d => d < date);
    const tonight = mine(date).filter(g => !after || slotOf(g) <= after);
    const earlier = before.flatMap(mine);
    const counted = [...earlier, ...tonight];
    const last = counted[counted.length - 1];
    const round = (last && last.round) || '';
    const prior = round ? counted.filter(g => g.round !== round) : earlier;
    // players: the top shooters so far, each with moved (places up since the round before) or fresh (new to the top).
    type Ranked = Pick<Shooter, 'name' | 'team' | 'logo' | 'games' | 'goals' | 'superGoals' | 'points'> & { photo: string | null; moved?: number; fresh?: boolean };
    const out: { division: string; after: string; round: string; players: Ranked[]; gamesRead: number; gamesFinished: number; superShots: boolean; compared: boolean; error?: string } = {
      division, after, round, players: [], gamesRead: 0, gamesFinished: counted.length, superShots: !!superShots(division), compared: false };
    if (!division || !out.gamesFinished) return out;
    const order = (list: Shooter[]) => [...list].sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name));
    const key = (p: Shooter) => `${p.name.toLowerCase()}|${p.team.toLowerCase()}`;
    const now = await tallyShooters(counted);
    out.gamesRead = now.read;
    if (!now.read && now.failed) out.error = now.lastError;
    // Where each stood after the round before; none when this is the division's first.
    let was: Map<string, number> | null = null;
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
  async function ladders(dates: Dates, date: string, games: Brief[]) {
    const out: NightLadderOut[] = [];
    for (const division of [...new Set(games.map(g => g.division).filter(Boolean))]) {
      const latest = Object.keys(dates).sort().filter(d => dates[d].some(g => g.division === division && isFinished(g))).pop();
      const round = games.find(g => g.division === division)?.round || '';
      const asAt = latest ? { date: latest, round: dates[latest].filter(g => g.division === division && isFinished(g)).pop()?.round || '' } : null;
      try {
        const l = await ladderFor(division);
        const was = latest === date ? stats.placesBefore(l.rows, games.filter(g => g.division === division).flatMap(doneOf)) : null;
        const rows = l.rows.map(r => {
          const before = was?.get(r.team);
          return { ...r, logo: logoFor(r.team), ...(before !== undefined ? { before, moved: before - r.position } : {}) };
        });
        out.push({ division, after: latest === date ? round : '', asAt, rows, finalsPlaces: l.finalsPlaces || 0, movers: !!was });
      } catch (err) {
        log('warn', 'socials', `No ladder for ${division}: ${errorMessage(err)}`);
        out.push({ division, after: '', asAt, rows: [], error: errorMessage(err) });
      }
    }
    return out;
  }

  // ─── Shooting for the Results pictures (each finished game's line ups, read once and kept) ───────────────────
  // A finished game with both scores, as socialstats.ts takes one (none when it isn't).
  const doneOf = (g: Brief): stats.Done[] => g.finished && g.home.score !== null && g.away.score !== null
    ? [{ ...g, home: { name: g.home.name, score: g.home.score }, away: { name: g.away.name, score: g.away.score } }] : [];
  const shooterOf = (p: Shooter) => ({ name: p.name, team: p.team, logo: p.logo, photo: photoFor(p), games: p.games, goals: p.goals, superGoals: p.superGoals,
    shots: p.shots, points: p.points, accuracy: p.shots ? Math.round((p.goals + p.superGoals) / p.shots * 1000) / 10 : null });
  const ACCURACY_SHOTS = 10; // the attempts a shooter needs that night to count for Sharpshooter
  // Sharpshooter: a division's best shooting accuracy that night (goals and super goals over attempts), ACCURACY_SHOTS
  // attempts or more.
  async function accuracy(finished: Raw[], division: string) {
    const t = finished.length ? await tallyShooters(finished) : { players: [], read: 0 };
    const players = t.players.filter(p => p.shots >= ACCURACY_SHOTS).map(shooterOf).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0) || b.goals - a.goals).slice(0, SHOOTERS_SHOWN);
    return { division, minShots: ACCURACY_SHOTS, players, gamesFinished: finished.length, gamesRead: t.read };
  }
  // Super shot leaders: a super shot division's most super shots that night and over the season so far, top 3 each.
  const SUPER_SHOWN = 3;
  async function superLeaders(finished: Raw[], seasonGames: Raw[], division: string) {
    if (!superShots(division)) return { division, error: `${division} doesn't play super shots.` };
    const top = async (list: Raw[]) => list.length ? (await tallyShooters(list)).players.filter(p => p.superGoals).map(shooterOf)
      .sort((a, b) => b.superGoals - a.superGoals || b.points - a.points).slice(0, SUPER_SHOWN) : [];
    return { division, night: await top(finished), season: await top(seasonGames), gamesFinished: finished.length };
  }
  // Team super shots: every team in a super shot division that has played, with its super shots that night (null when it
  // didn't play) and over the season so far, most first. From each game's team counts (teamTotals), so a super shot
  // PlayHQ gave the team without naming the shooter counts too. notCounted: games whose line ups PlayHQ couldn't give.
  async function teamSupers(finished: Raw[], seasonGames: Raw[], division: string) {
    if (!superShots(division)) return { division, error: `${division} doesn't play super shots.` };
    const tonight = new Set(finished.map(g => g.id));
    const read = seasonGames.length ? await lineupsOf(seasonGames) : [];
    const by = new Map<string, { team: string; logo: string | null; tonight: number | null; season: number; games: number }>();
    for (const [i, g] of seasonGames.entries()) {
      const b = brief(g), l = read[i];
      for (const which of ['home', 'away'] as const) {
        const name = b[which].name, k = name.toLowerCase();
        const t = by.get(k) || { team: name, logo: logoFor(name), tonight: null, season: 0, games: 0 };
        const n = l ? teamTotals(l[which]).superGoals : 0;
        t.season += n; t.games++;
        if (tonight.has(g.id)) t.tonight = (t.tonight || 0) + n;
        by.set(k, t);
      }
    }
    const teams = [...by.values()].sort((a, b) => b.season - a.season || (b.tonight || 0) - (a.tonight || 0) || a.team.localeCompare(b.team));
    return { division, teams, gamesFinished: finished.length, notCounted: read.filter(l => !l).length };
  }
  // On fire: a division's shooters who played that night whose goals a game (super goals counted as goals) over their last
  // three games rose most on their games before; rise: by how much (at least one earlier game needed).
  const FIRE_RECENT = 3, FIRE_SHOWN = 5;
  async function onFire(seasonGames: Raw[], date: string, division: string) {
    const per = new Map<string, ReturnType<typeof shooterOf> & { list: number[]; tonight: boolean }>();
    for (const g of seasonGames) {
      for (const p of (await tallyShooters([g])).players) {
        const k = `${p.name.toLowerCase()}|${p.team.toLowerCase()}`;
        const x = per.get(k) || { ...shooterOf(p), list: [], tonight: false };
        x.list.push(p.goals + p.superGoals);
        x.tonight = x.tonight || g.date === date;
        per.set(k, x);
      }
    }
    const avg = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
    const players = [...per.values()].filter(x => x.tonight && x.list.length > 1).map(x => {
      const n = Math.min(FIRE_RECENT, x.list.length - 1), recent = x.list.slice(-n), earlier = x.list.slice(0, -n);
      return { name: x.name, team: x.team, logo: x.logo, photo: x.photo, recent: Math.round(avg(recent) * 10) / 10, earlier: Math.round(avg(earlier) * 10) / 10,
        last: recent, rise: Math.round((avg(recent) - avg(earlier)) * 10) / 10 };
    }).filter(x => x.rise > 0).sort((a, b) => b.rise - a.rise || a.name.localeCompare(b.name)).slice(0, FIRE_SHOWN);
    return { division, players };
  }
  // The night's shooting, for Night in numbers, from each finished game's team counts (teamTotals). accuracy: goals and
  // super goals over attempts, as a whole percent, over the games PlayHQ gave attempts for (null when none). superShots:
  // only where a division that played has them (else null); notCounted: the games among those whose line ups PlayHQ
  // couldn't give.
  async function nightShooting(finished: Raw[]) {
    const read = await lineupsOf(finished);
    const sides = read.flatMap(l => l ? [teamTotals(l.home), teamTotals(l.away)] : []);
    const shots = sides.reduce((n, t) => n + (t.shots || 0), 0);
    const scored = sides.filter(t => t.shots).reduce((n, t) => n + t.goals + t.superGoals, 0);
    const supers = read.filter((l, i) => superShots(brief(finished[i]).division));
    return { accuracy: shots ? Math.round(scored / shots * 100) : null,
      superShots: supers.length ? supers.reduce((n, l) => n + (l ? teamTotals(l.home).superGoals + teamTotals(l.away).superGoals : 0), 0) : null,
      notCounted: supers.filter(l => !l).length };
  }
  // Team season card (&division= &team=): socialstats.teamCard with its ladder place, logos, and its top shooter so far.
  async function seasonCard(season: stats.SeasonResult[], date: string, division: string, team: string, seasonGames: Raw[]) {
    if (!division || !team) return { division, team, error: 'Pick a team.' };
    let rows: LadderRow[] = [];
    try { rows = (await ladderFor(division)).rows; } catch (err) { log('warn', 'socials', `No ladder for ${division}: ${errorMessage(err)}`); }
    const card = stats.teamCard(season, date, division, team, rows);
    const mine = seasonGames.filter(g => sameName(g.home.name, team) || sameName(g.away.name, team));
    const top = mine.length ? (await tallyShooters(mine)).players.filter(p => sameName(p.team, team)).sort((a, b) => b.points - a.points)[0] : null;
    return { ...card, logo: logoFor(team), topShooter: top ? shooterOf(top) : null, results: card.results.map(r => ({ ...r, logo: logoFor(r.opponent) })) };
  }
  // Season wrap (&division=): its champions once known, the season's top shooter, best accuracy (ACCURACY_SHOTS
  // attempts a game on average), most super shots (where it has them) and biggest win.
  async function wrap(season: stats.SeasonResult[], date: string, division: string, seasonGames: Raw[]) {
    if (!division) return { division, error: 'Pick a division.' };
    const all = seasonGames.length ? (await tallyShooters(seasonGames)).players.map(shooterOf) : [];
    type Ranked = (typeof all)[number];
    const best = (list: Ranked[], f: (p: Ranked) => number) => [...list].sort((a, b) => f(b) - f(a))[0] || null;
    const champion = championOf(hasFinals(division) ? await finalsDraw(division) : null);
    const big = stats.biggestWin(season, date, division);
    return { division, champion: champion ? { name: champion.name, logo: logoFor(champion.name) } : null,
      topShooter: best(all, p => p.points), accuracy: best(all.filter(p => p.shots >= ACCURACY_SHOTS * p.games), p => p.accuracy ?? 0),
      superShots: superShots(division) ? best(all.filter(p => p.superGoals), p => p.superGoals) : null,
      biggestWin: big && { ...big, home: { ...big.home, logo: logoFor(big.home.name) }, away: { ...big.away, logo: logoFor(big.away.name) } } };
  }

  // ─── Game story, Score worm and Watch it back ────────────────────────────────────────────────────────────
  // A streamed or followed game's story (board.ts keeps its Game stats and Score worm as the game left them), with the result from
  // the fixture and the logos; whether it's sure: the goals were all seen, and the score at the end is the result.
  // A kept story, as board.ts gameStory made it from getStats and getWorm (stories.ts keeps it as it came).
  const toldOf = (id: string) => storyFor(id) as Told | null;
  const isTold = (x: StoryOrNot): x is StoryOut => !x.error;
  function storyOf(g: Brief | undefined): StoryOrNot {
    if (!g) return { error: 'Pick a game.' };
    const s = toldOf(g.id);
    if (!s) return { error: `Studio didn't stream or follow ${g.home.name} v ${g.away.name}, so it has no story of it.` };
    const side = (k: 'home' | 'away') => ({ ...g[k], logo: logoFor(g[k].name), colour: (s.stats && s.stats[k] && s.stats[k].colour) || (s.worm && s.worm[k] && s.worm[k].colour) || null });
    const kept = { home: Number(s.stats.home.score) || 0, away: Number(s.stats.away.score) || 0 };
    return { game: { ...g, home: side('home'), away: side('away') }, stats: s.stats, worm: s.worm, moments: s.moments || [],
      complete: !s.stats.gapInHistory && g.finished && kept.home === g.home.score && kept.away === g.away.score };
  }
  // Night in numbers' goal order tiles: lead changes, the longest run and the runs of 5 goals across the night, only when
  // every finished game has a complete story (streamed or followed, no gap, and its kept score PlayHQ's final), so a
  // night-wide number never leaves a game out. goalOrder: { complete, of, missing: [the games short of it] } either way.
  function goalOrderNumbers(games: Brief[]) {
    const done = games.filter(g => g.finished);
    const told = done.map(g => ({ g, x: storyOf(g) }));
    const missing = told.filter(t => !isTold(t.x) || !t.x.complete).map(t => `${t.g.home.name} v ${t.g.away.name}`);
    const goalOrder = { complete: done.length - missing.length, of: done.length, missing };
    if (!done.length || missing.length) return { goalOrder };
    let leadChanges = 0, runs5 = 0, longestRun: { n: number; team: string } | null = null;
    for (const x of told.map(t => t.x).filter(isTold)) {
      const st = (x.stats && x.stats.stats) || {}, lr = st.longestRun || {}, r5 = st.runs5 || {};
      leadChanges += Number(x.worm && x.worm.leadChanges) || 0;
      runs5 += (Number(r5.home) || 0) + (Number(r5.away) || 0);
      for (const side of ['home', 'away'] as const) if ((lr[side] || 0) > (longestRun ? longestRun.n : 1)) longestRun = { n: lr[side], team: x.game[side].name };
    }
    return { goalOrder, leadChanges, runs5, longestRun };
  }
  // Runs of the night, Super shot time and Comeback of the night, from the stories of the night's games Studio streamed or followed (read from
  // the local folder, so cheap): each game's longest run and its runs of 3 and 5, the longest first; each super shot
  // game's points in each quarter's super shot period (timed goals only); and the winner who came back from furthest
  // behind (the most the losing team led by), with that game's worm.
  function ofTheNight(streamed: Brief[]) {
    const told = streamed.map(storyOf).filter(isTold);
    const runs = told.map(x => {
      const st = (x.stats && x.stats.stats) || {}, lr = st.longestRun || {};
      const side = (lr.home || 0) >= (lr.away || 0) ? 'home' : 'away';
      return { game: x.game, longest: { side, n: lr[side] || 0 }, runs3: st.runs3 || { home: 0, away: 0 }, runs5: st.runs5 || { home: 0, away: 0 }, complete: x.complete };
    }).filter(r => r.longest.n > 1).sort((a, b) => b.longest.n - a.longest.n);
    const supers = told.flatMap(x => {
      const ss = x.worm && x.worm.superShot;
      return superShots(x.game.division) && ss && ss.timed ? [{ game: x.game, points: ss.points, byPeriod: ss.byPeriod || [], periodLabel: x.worm.periodLabel || 'Q' }] : [];
    });
    let comeback: { game: Brief; side: 'home' | 'away'; down: number; worm: Worm; complete: boolean } | null = null;
    for (const x of told) {
      const g = x.game, hs = g.home.score ?? 0, as = g.away.score ?? 0, win = hs > as ? 'home' : as > hs ? 'away' : '';
      const lose = win === 'home' ? 'away' : 'home';
      const down = win && x.worm && x.worm.biggestLead && x.worm.biggestLead[lose] ? x.worm.biggestLead[lose].margin : 0;
      if (win && down > 0 && (!comeback || down > comeback.down)) comeback = { game: g, side: win, down, worm: x.worm, complete: x.complete };
    }
    return { runs, supers, comeback };
  }
  // Links to suggest for Watch it back: each stream on Live viewers (Competitions setup), as a page where its videos stay.
  function watchLinks() {
    const out: { name: string; link: string }[] = [];
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
  function watchIt(link: string) {
    if (!link) return { error: 'Paste the link to watch it back on the Socials tab.' };
    if (!/^https?:\/\/[^\s]+$/i.test(link)) return { error: 'That isn\'t a web link: it starts with https://.' };
    try { return { link, shown: link.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), qr: qrFor(link) }; }
    catch (err) { return { error: `No QR code for that link: ${errorMessage(err)}` }; }
  }

  // ─── Game stats, Shooting duel and Team sheet ──────────────────────────────────────────────────────────────
  // A team's goals, super goals and shots in a game, from its line up (readLineups): PlayHQ's team counts, which include
  // goals given to the team without a player; the players added up only when PlayHQ has no team counts.
  function teamTotals(side: LineupSide | null | undefined) {
    const players = side ? side.players : [];
    const sum = (k: 'goals' | 'superGoals' | 'shots') => players.reduce((n, p) => n + (p.shooting[k] || 0), 0);
    const t = side && side.totals;
    return { goals: t ? t.goals : sum('goals'), superGoals: t ? t.superGoals : sum('superGoals'), shots: t && t.shots != null ? t.shots : sum('shots') };
  }
  // A finished game's numbers from its line ups (every finished game, streamed or not): each team's goals, super goals,
  // attempts, accuracy and points, and its shooters best first; with the story's quarters won, longest run, 3 and 5 goal
  // runs and biggest lead when Studio streamed or followed it (story, else null).
  async function gameStats(g: Raw | undefined) {
    if (!g) return { error: 'No result for that game yet.' };
    const b = brief(g);
    const [l] = await lineupsOf([g]);
    const side = (which: 'home' | 'away') => {
      const players = l ? l[which].players.map(p => {
        const sh = p.shooting, scored = (sh.goals || 0) + (sh.superGoals || 0), shots = sh.shots || 0;
        return { name: p.name, position: p.position, goals: sh.goals || 0, superGoals: sh.superGoals || 0, shots, points: sh.points || 0,
          accuracy: shots ? Math.round(scored / shots * 1000) / 10 : null };
      }).filter(p => p.shots || p.goals || p.superGoals).sort((x, y) => y.points - x.points || y.shots - x.shots || x.name.localeCompare(y.name)) : [];
      const { goals, superGoals, shots } = teamTotals(l && l[which]);
      return { ...b[which], logo: logoFor(b[which].name), goals, superGoals, shots, points: goals + 2 * superGoals,
        accuracy: shots ? Math.round((goals + superGoals) / shots * 1000) / 10 : null, shooters: players.map(p => ({ ...p, photo: photoFor({ name: p.name, team: b[which].name }) || null })) };
    };
    const story = toldOf(b.id);
    const ss = story && story.stats && story.stats.stats;
    const w = story && story.worm;
    return { game: { ...b, home: side('home'), away: side('away') }, read: !!l, superShots: !!superShots(b.division),
      error: l ? undefined : 'PlayHQ\'s line ups for this game couldn\'t be read.',
      story: ss ? { quartersWon: ss.quartersWon, longestRun: ss.longestRun, runs3: ss.runs3, runs5: ss.runs5, biggestLead: w && w.biggestLead } : null };
  }
  // Team sheet (&game=): both teams' squads this season (everyone in their line ups), each with the position they play
  // most and their games played in the division.
  async function teamSheet(b: Brief | undefined) {
    if (!b) return { error: 'Pick a game.' };
    const side = async (which: 'home' | 'away') => {
      let players: Awaited<ReturnType<typeof teamSheetFor>> = [];
      try { players = await teamSheetFor(b[which].name, b.division); } catch (err) { log('warn', 'socials', `No squad for ${b[which].name}: ${errorMessage(err)}`); }
      return { ...b[which], logo: logoFor(b[which].name), players };
    };
    return { game: { ...b, home: await side('home'), away: await side('away') } };
  }

  // ─── Hand picks (Player of the match, Team of the round) and spotlights ───────────────────────────────────
  // The finished games' line ups to pick from: each game with both sides' players (name, position).
  async function lineups(finished: Raw[]) {
    const read = finished.length ? await lineupsOf(finished) : [];
    return finished.map((g, i) => {
      const b = brief(g), l = read[i];
      const side = (which: 'home' | 'away') => ({ name: b[which].name, logo: logoFor(b[which].name), players: l ? l[which].players.map(p => ({ name: p.name, position: p.position })) : [] });
      return { id: b.id, division: b.division, read: !!l, home: side('home'), away: side('away') };
    });
  }
  // A player in a game's line ups (by name, either side), with their team, position, shooting that game and photo.
  function inLineup(l: Lineup | null | undefined, b: { home: { name: string }; away: { name: string } }, name: string) {
    for (const which of ['home', 'away'] as const) {
      const p = l && l[which].players.find(x => sameName(x.name, name));
      if (!p) continue;
      const sh = p.shooting;
      const shots = sh.shots || 0, scored = (sh.goals || 0) + (sh.superGoals || 0);
      return { name: p.name, team: b[which].name, logo: logoFor(b[which].name), photo: photoFor({ name: p.name, team: b[which].name, playhqIds: p.playhqId ? [String(p.playhqId)] : [] }) || photoFor(p.name),
        position: p.position, shooting: scored || shots ? { goals: sh.goals || 0, superGoals: sh.superGoals || 0, shots, points: sh.points || 0,
          accuracy: shots ? Math.round(scored / shots * 1000) / 10 : null } : null };
    }
    return null;
  }
  // Player of the match (&game=&athlete=, &medal= a medal's name for a special round): the athlete picked from either
  // team's line up, with that game's score.
  async function playerOfMatch(g: Raw | undefined, name: string, medal: string) {
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
  async function teamOfRound(finished: Raw[], division: string, q: Query) {
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
  async function athleteSpotlight(name: string, date: string, seasonGames: Raw[]) {
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
  function sponsorSpotlight(id: string, date: string, past: boolean) {
    const list = sponsorList();
    const x = list.find(s => s.id === id) || list[0];
    if (!x) return { error: 'No sponsors yet: add them on the Sponsors tab.' };
    let seconds = 0;
    if (past) try { seconds = onScreen(date)[x.id] || 0; } catch (err) { log('warn', 'socials', `No time on screen for ${date}: ${errorMessage(err)}`); }
    return { ...x, seconds };
  }

  // The top shooters of the finished games given (one division's, or the whole night's), most points first (goals where
  // there are no super shots). superShots: whether any of those divisions has them, to show the super goals and points.
  async function shooters(finished: Raw[]) {
    if (!finished.length) return { players: [], gamesRead: 0, gamesFinished: 0, superShots: false };
    const t = await tallyShooters(finished);
    const players = [...t.players].sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, SHOOTERS_SHOWN)
      .map(p => ({ name: p.name, team: p.team, logo: p.logo, photo: photoFor(p), goals: p.goals, superGoals: p.superGoals, points: p.points }));
    return { players, gamesRead: t.read, gamesFinished: finished.length, superShots: finished.some(g => superShots(g.division)),
      error: !t.read && t.failed ? t.lastError : undefined };
  }

  // ─── Photos ───────────────────────────────────────────────────────────────
  function savePhoto(name: unknown, buf: Buffer) {
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
  const photoFile = (f: string) => (/^[a-f0-9]{20}\.(jpe?g|png|webp)$/.test(f) ? path.join(PHOTOS, f) : null);

  // ─── Saving the pictures (the Mac app) ────────────────────────────────────
  const waiting = new Map<string, (m: Saved) => void>();
  // The Mac app's answer, checked: it comes over the message port.
  const savedOf = (m: Body): Saved => ({ error: m.error ? str(m.error) : undefined, folder: str(m.folder) || null, files: arr(m.files).map(str),
    zip: str(m.zip) || undefined, zipFile: str(m.zipFile) || undefined, shared: m.shared === true,
    skipped: arr(m.skipped).map(obj).map(x => ({ name: str(x.name), reason: str(x.reason) })) });
  if (appPort) appPort.on('message', e => {
    const m = obj(e.data), id = str(m.id);
    const done = waiting.get(id);
    if (m.type !== 'socialsSaved' || !done) return;
    waiting.delete(id);
    done(savedOf(m));
  });
  const SETS: Record<string, string> = { upcoming: 'Upcoming', results: 'Results' };
  // The pictures to save. As a carousel they're one post: one size, at most 20, in the order given; the app tells each
  // its place (?page=2/6) so it draws the 2/6 mark and, on all but the last, the arrow to swipe on.
  function carouselOf(body: Body) {
    const items = arr(body.items).slice(0, MAX_ITEMS).map(obj);
    if (body.carousel !== true) return items;
    if (new Set(items.map(it => it.size)).size > 1) throw Object.assign(new Error('A carousel is all one size: tick just one of Square, Portrait or Story.'), { status: 400 });
    if (items.length > CAROUSEL_MAX) throw Object.assign(new Error(`Instagram takes ${CAROUSEL_MAX} pictures at most in a carousel: untick ${items.length - CAROUSEL_MAX}.`), { status: 400 });
    return items;
  }
  // A file name from a picture's name: letters, digits, spaces and a few marks, never a path.
  const fileName = (s: unknown) => String(s || '').replace(/[^\p{L}\p{N} '&()+,.-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Picture';
  // Saves made for another device: id -> { files, zip, at } (paths in the Mac app's temporary folder).
  const made = new Map<string, { files: string[]; zip: string | null; at: number }>();
  function keepMade(files: string[], zip: string | null) {
    const id = crypto.randomUUID();
    const now = Date.now();
    for (const [k, v] of made) if (now - v.at > MADE_KEPT_MS) made.delete(k);
    made.set(id, { files, zip, at: now });
    for (const k of [...made.keys()].slice(0, Math.max(0, made.size - MADE_KEPT))) made.delete(k);
    return id;
  }
  // body.toDevice: the pictures are for the device that asked (a phone), not this Mac: the app makes them in a temporary
  // folder (cleared after an hour) without opening Finder or the Share menu, and the answer lists links the device
  // fetches them from.
  // jpeg: for posting (posting.ts): the app makes them as JPEGs on white (Instagram takes nothing else), quietly in its
  // temporary folder, and the answer is their paths on this Mac.
  async function save(body: Body, port: number, jpeg = false) {
    const items = carouselOf(body);
    if (!appPort) throw Object.assign(new Error('Saving the pictures needs the FirstPass Studio app on the Mac. The previews here are what they will look like.'), { status: 501 });
    if (!items.length) throw Object.assign(new Error('Tick at least one picture to save.'), { status: 400 });
    const date = isDate(body.date) ? body.date : localDate();
    const set = own(SETS, body.set) || SETS.upcoming;
    const pictures = items.map((it, i) => {
      const size = own(SIZES, it.size);
      const link = String(it.link || '');
      // Only Studio's own social graphic is drawn, never another page or address.
      if (!size || !/^\/social\.html\?[^\s#]*$/.test(link)) throw Object.assign(new Error(`Picture ${i + 1} isn't one of the Socials tab's.`), { status: 400 });
      // The app numbers the files (01, 02...) in this order.
      return { label: `${fileName(it.name)} (${size.label.toLowerCase()})`, url: `http://localhost:${port}${link}`, width: size.width, height: size.height };
    });
    const competition = fileName(about().competition || 'Studio');
    const folder = `${competition} ${date} ${set}${body.carousel === true ? ' carousel' : ''}`;
    const id = crypto.randomUUID();
    const answer = new Promise<Saved>(resolve => {
      waiting.set(id, resolve);
      setTimeout(() => { if (waiting.delete(id)) resolve(savedOf({ error: 'The Mac app took too long to save the pictures.' })); }, EXPORT_TIMEOUT_MS).unref();
    });
    log('info', 'socials', `Saving ${pictures.length} pictures for ${date} (${set})${body.share ? ' to share' : ''}`);
    const toDevice = jpeg || body.toDevice === true;
    // The pictures' captions (written by AI or typed on the tab), each under its picture's name: Captions.txt.
    const captions = arr(body.captions).slice(0, MAX_ITEMS).map(obj).map(c => ({ name: fileName(c.name), text: str(c.text).trim().slice(0, MAX_CAPTION_TEXT) }))
      .filter(c => c.text).map(c => `${c.name}\n\n${c.text}`).join('\n\n────────\n\n');
    appPort.postMessage({ type: 'socialsSave', id, folder, carousel: body.carousel === true, pictures, captions: jpeg ? '' : captions, share: !toDevice && body.share === true, zip: !jpeg && body.zip === true, quiet: toDevice, format: jpeg ? 'jpeg' : 'png' });
    const m = await answer;
    if (m.error) { log('warn', 'socials', `Saving the pictures for ${date}: ${m.error}`); throw Object.assign(new Error(m.error), { status: 500 }); }
    const skipped = m.skipped;
    log('info', 'socials', toDevice ? `Made ${m.files.length} pictures for another device` : `Saved ${m.files.length} pictures in ${m.folder}${m.zip ? `, and ${m.zip}` : ''}`);
    for (const x of skipped) log('warn', 'socials', `Skipped ${x.name}: ${x.reason}`);
    if (jpeg) return { folder: null, files: m.files, skipped, zip: null, shared: false };
    const saved = { folder: m.folder, files: m.files.map(f => path.basename(f)), skipped, zip: m.zip || null, shared: !!m.shared };
    if (!toDevice) return saved;
    const got = keepMade(m.files, m.zipFile || null);
    return { ...saved, made: { pictures: m.files.map((f, i) => ({ name: path.basename(f), url: `/api/socials/made/${got}/${i + 1}` })),
      zip: m.zipFile ? { name: path.basename(m.zipFile), url: `/api/socials/made/${got}/zip` } : null } };
  }
  // A picture (or the zip) saved for another device, as a download named like the file on the Mac.
  function madeFile(id: string, which: string) {
    const m = made.get(id);
    if (!m || Date.now() - m.at > MADE_KEPT_MS) return null;
    const file = which === 'zip' ? m.zip : /^\d+$/.test(which) ? m.files[Number(which) - 1] : null;
    return file && fs.existsSync(file) ? file : null;
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL, { send, readBody, readRaw, port }: { send: Send; readBody: ReadBody; readRaw: ReadRaw; port: number }) {
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    try {
      // here: the page is open on this Mac (Save puts the pictures in its Pictures folder) rather than on a phone or
      // another computer (Save hands them to that device).
      if (p === '/api/socials' && req.method === 'GET') return send(res, 200, { ...await list(), here: access.isLocal(req.socket.remoteAddress) }), true;
      // ?kind= and the rest of a picture's link (social.html): what that picture needs; else &with= and the rest as asked.
      if (p === '/api/socials/night' && req.method === 'GET') return send(res, 200, await night(q.kind ? nightQuery(q) : q)), true;
      // The athletes to pick for a picture: those with a photo they approved, with their teams and divisions.
      if (p === '/api/socials/athletes' && req.method === 'GET') return send(res, 200, { athletes: athletesWithPhotos() }), true;
      if (p === '/api/socials/settings' && req.method === 'POST') {
        const now = saveSettings(await readBody(req));
        return send(res, 200, { settings: now, colourSets: allSets(now.colourSets) }), true;
      }
      if (p === '/api/socials/photo' && req.method === 'POST') return send(res, 200, { photo: savePhoto(q.name, await readRaw(req, MAX_PHOTO)) }), true;
      if (p === '/api/socials/export' && req.method === 'POST') return send(res, 200, await save(await readBody(req), port)), true;
      const got = /^\/api\/socials\/made\/([0-9a-f-]{36})\/(\d+|zip)$/.exec(p);
      if (got && req.method === 'GET') {
        const file = madeFile(got[1], got[2]);
        if (!file) return send(res, 404, { error: 'Those pictures are gone: save them again.' }), true;
        const zip = got[2] === 'zip';
        // ASCII file name plus the full one (RFC 6266), so Safari keeps the name the Mac gave it.
        const name = path.basename(file);
        const disposition = `${zip ? 'attachment' : 'inline'}; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
        return send(res, 200, fs.readFileSync(file), zip ? 'application/zip' : 'image/png', { ...uploads.SERVE_HEADERS, 'content-disposition': disposition, 'cache-control': 'no-store' }), true;
      }
      const photo = /^\/socials\/photos\/([^/]+)$/.exec(p);
      if (photo && req.method === 'GET') {
        const file = photoFile(photo[1]);
        if (!file || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain'), true;
        return send(res, 200, fs.readFileSync(file), own(PHOTO_TYPES, path.extname(file)), { ...uploads.SERVE_HEADERS, 'cache-control': 'max-age=86400' }), true;
      }
    } catch (err) {
      return send(res, num(obj(err).status, 400) || 400, { error: errorMessage(err) }), true;

    }
    return false;
  }

  return { route, list, night, picturesForPost: (body: Body, port: number) => save(body, port, true), pictureNight: (link: Query) => night(nightQuery(link)), settings, saveSettings, savePhoto, colourSets: () => allSets(settings().colourSets), SIZES, KINDS, KIND_NAMES, TEMPLATES };
}

export { create, SIZES, KINDS, KIND_NAMES };
