// FirstPass Studio - local helper for the overlay pages.
//
// Why this exists: PlayHQ's public data (the same data www.playhq.com shows) is
// served from https://api.playhq.com/graphql. It needs no API key, but it only
// answers requests that look like they come from playhq.com and carry a guest
// session cookie. A web page loaded as an overlay can't set those, so this tiny server
// fetches the data and hands it to the pages in public/.
//
// Run:  node server.js        (Node 18 or newer, nothing to install)
// Then: http://localhost:8080/ lists the pages.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const datadir = require('./datadir');
const savefile = require('./savefile');
const datalocation = require('./datalocation');
const migrations = require('./migrations');
const competitions = require('./competitions');
const finals = require('./finals');
const fonts = require('./fonts');
const scene = require('./scene');
const picturesize = require('./picturesize');
const recorder = require('./recorder');
const practice = require('./practice');
const replay = require('./replay');
const hyperdeck = require('./hyperdeck');
const sditimecode = require('./sditimecode');
const sponsors = require('./sponsors');
const exposure = require('./exposure');
const viewers = require('./viewers');
const devices = require('./devices');
const outputs = require('./outputs');
const switcher = require('./switcher');
const mics = require('./mics');
const { linkHost, bonjourName } = require('./linkhost');
const access = require('./access');
const uploads = require('./uploads');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// Everything the helper saves goes in the data folder (datadir.js), outside the app.
const DATA = datadir.file;
// config.json holds this computer's settings (port, cache, log size): the app's config.json
// has the defaults, and a config.json in the data folder changes any of them (only the
// settings it names, so an update can add new ones). Everything about the competition lives
// in competitions/<id>/settings.json in the data folder, edited on setup.html.
// CONFIG is the two together, for the competition in use.
const readConfig = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const MACHINE = { ...readConfig(path.join(ROOT, 'config.json')), ...readConfig(DATA('config.json')) };
delete MACHINE._note;
let CONFIG = { ...MACHINE };
const PORT = Number(process.env.PORT || MACHINE.port || 8080);
// The start of every page link shown to people (Graphics page, control page, Mac app): the Mac's
// Bonjour name unless config.json linkHost says otherwise. See linkhost.js.
const LINK_BASE = `http://${linkHost(MACHINE.linkHost)}:${PORT}`;
// The names a browser may call Studio by when changing something (access.crossSite): read when asked,
// since the Mac's addresses come and go.
const ownHosts = () => access.ownHosts([linkHost(MACHINE.linkHost), bonjourName()]);
// This Mac's Stream Deck key (access.js deckPress()): kept with the devices list on this Mac only (devices.js), never in
// a backup or iCloud. Links copied from Studio carry it as /k/<key>/deck/...; a link without it is refused. Read when
// asked, since the Devices… window can give it a new one.
const deckBase = () => `${LINK_BASE}/k/${devices.linkKey()}`;
const API_URL = process.env.PLAYHQ_API_URL || 'https://api.playhq.com/graphql';
const CACHE_MS = Math.max(15, Number(MACHINE.cacheSeconds || 60)) * 1000;
// The exit code when the port is already taken, so the Mac app says so instead of restarting the helper.
const EXIT_PORT_IN_USE = 3;

// ─── Debug log ──────────────────────────────────────────────────────────────
// logs/playhq-graphics.log in the local data folder (it stays on this computer when the settings are in iCloud Drive): helper requests, PlayHQ calls, scoreboard changes and
// errors from every page. Capped at logMaxMB (default 15): when full, the oldest
// half is dropped so the newest lines are always kept.
const LOG_DIR = datadir.local('logs');
const LOG_FILE = path.join(LOG_DIR, 'playhq-graphics.log');
const LOG_MAX = Math.max(1, Number(MACHINE.logMaxMB) || 15) * 1024 * 1024;
let logSize = 0;
try { fs.mkdirSync(LOG_DIR, { recursive: true }); logSize = fs.statSync(LOG_FILE).size; } catch { /* new log */ }
function log(level, source, message, extra) {
  const time = new Date().toISOString();
  let line = `${time} ${String(level).toUpperCase().padEnd(5)} [${source}] ${String(message).replace(/\s+/g, ' ').slice(0, 4000)}`;
  if (extra !== undefined) line += ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 4000);
  line += '\n';
  try {
    if (logSize + Buffer.byteLength(line) > LOG_MAX) {
      const buf = fs.readFileSync(LOG_FILE);
      let start = buf.length - Math.floor(LOG_MAX / 2);
      start = Math.max(0, buf.indexOf(10, start) + 1);
      const kept = Buffer.concat([Buffer.from(`${time} INFO  [log] Log reached ${LOG_MAX / 1048576} MB; older lines removed\n`), buf.subarray(start)]);
      fs.writeFileSync(LOG_FILE, kept);
      logSize = kept.length;
    }
    fs.appendFileSync(LOG_FILE, line);
    logSize += Buffer.byteLength(line);
  } catch (err) { console.error('Could not write the log:', err.message); }
  if (level === 'error') console.error(line.trim());
}
process.on('uncaughtException', err => { log('error', 'helper', `Crash: ${err.stack || err.message}`); process.exit(1); });
process.on('unhandledRejection', err => log('error', 'helper', `Unhandled: ${(err && err.stack) || err}`));

// Bring saved settings up to date (migrations.js) before anything reads them.
const DATA_STATE = migrations.run(log);
// The game recordings (recorder.js): each PlayHQ game on the scoreboard while on air, from when it's due (the
// automatic game selection's minutes before its start) to a while after full time.
const RECORDING_START = () => ({ version: require('./package.json').version, competition: competitions.activeId() || '' });
recorder.init(log, { dir: datadir.local('Recordings'), settings: datadir.local('recordings.json'), start: RECORDING_START,
  lead: () => theGames.leadMs() }); // theGames is made below; this is only asked once a board has been sent
process.on('exit', () => { savefile.flushSync(); recorder.close(); }); // saves still in the background (the scoreboard) are written first
process.on('SIGTERM', () => process.exit(0)); // the Mac app taking Studio off air: the exit above ends the recording
// Sequences belong to the competition in use, in its folder.
scene.init(log, { ffmpeg: MACHINE.ffmpegPath, outputs: { find: outputs.find, summary: outputs.summary }, record: recorder,
  sequencesFile: () => { const id = competitions.activeId(); return id ? path.join(competitions.DIR, id, 'sequences.json') : null; } });
// The colours the Output page checks against the chroma key colour.
const COLOUR_NAMES = { main: 'Main colour', dark: 'Dark colour', panel: 'Panels', panelAlt: 'Every second row', highlight: 'Highlight', accent: 'Accent', text: 'Text', textOnHighlight: 'Text on highlight', muted: 'Small print' };
outputs.init(log, {
  colours: () => [
    ...Object.entries(CONFIG.colours || {}).map(([k, hex]) => ({ name: COLOUR_NAMES[k] || k, hex })),
    ...Object.entries(CONFIG.clubs || {}).filter(([, c]) => c && c.colour).map(([club, c]) => ({ name: `${club}'s colour`, hex: c.colour })),
  ],
  removed: id => scene.dropOutput(id),
  changed: () => switcher.refresh(),
  // In 4K: the competition's team and brand logos and the media folder's images and videos that look soft.
  soft: () => {
    const id = competitions.activeId();
    const comp = kind => (id ? competitions.images(id, kind) : []).map(f => ({ name: f, file: competitions.imageFile(id, kind, f) }));
    return picturesize.soft({ logos: [...comp('logos'), ...comp('brand'), ...scene.imageFiles()], videos: scene.videoSizes() });
  },
});
sponsors.init(log);
// Proof of play for the sponsors: what's on screen, and whether an output that counts for them is on (Output 1, or
// one with Counts for sponsors ticked: outputs.sponsorsOnAir).
exposure.init(log, { showing: scene.showing, onAir: outputs.sponsorsOnAir, held: () => practice.active() || replay.active() });
// Live viewer numbers from the competition's streams, read only while on air.
devices.load(log);
viewers.init(log, { onAir: () => outputs.windows().length > 0, record: exposure.viewers });
// The ATEM switcher, if one is set up: its state goes to the Output page over the scene's socket.
scene.setSwitcherSource(switcher.status);
// Mics plugged into the switcher (mics.js): Studio moves their faders, and follows a fader moved on the switcher.
switcher.init(log, { changed: () => { scene.publishSwitcher(); mics.switcherChanged(); }, stinger: { find: scene.stingerSource, play: scene.playStinger }, outputs: outputs.switcherPlan,
  unstraight: id => outputs.apply({ output: id, decklinkStraight: false }), mics: () => mics.switcherChanged() });
mics.useSwitcher({ inputs: switcher.micInputs, set: switcher.setMicFader });
// ─── PlayHQ ─────────────────────────────────────────────────────────────────
// Everything that talks to PlayHQ is in playhq.js; this is the client for the competition in use.
const playhq = require('./playhq').create({
  log, apiUrl: API_URL, cacheMs: CACHE_MS, linkBase: LINK_BASE, record: recorder, practice,
  config: () => CONFIG, leadMs: () => theGames.leadMs(), logoFor: name => logoFor(name), positionOf: p => positionOf(p),
});
const { gql, getStructure, getLadder, findGrade, pickSeason, Q_COMPETITIONS, getGame, lineup, getLive, scoringNotYet, lastLive } = playhq;
const { parsePlayhqUrl, startOf, isFinished } = require('./playhq');

// ─── control.json ───────────────────────────────────────────────────────────
// control.json holds the control page's lasting settings on this computer (git ignores it):
// the game night picked by hand (night), and the scoreboard's automatic game selection, its court, following
// the PlayHQ clock, how often to check PlayHQ, showing the clock and the ticker's speed, and finals
// winners entered by hand (for finals PlayHQ has no fixtures for). Without it the scoreboard
// starts from the competition setup's defaults. The game itself, scores and the clock stay
// in scoreboard-state.json.
const CONTROL_FILE = DATA('control.json');
const LASTING = ['autoSelect', 'autoCourt', 'followPlayhqClock', 'playhqRefreshSec', 'showClock', 'tickerSpeed'];
let control = savefile.readJson(CONTROL_FILE, {}, (err, movedTo) => log('warn', 'helper', `Could not read control.json, starting from the defaults: ${err.message}${movedTo ? ` (moved to ${path.basename(movedTo)})` : ''}`));
if (control.round === undefined) { // the round used to be kept in round-choice.json
  try { control.round = String(JSON.parse(fs.readFileSync(DATA('round-choice.json'), 'utf8')).round || ''); } catch { control.round = ''; }
}
let controlSaved = JSON.stringify(control);
control.boards = control.boards && control.boards['1'] ? { 1: control.boards['1'] } : {}; // one scoreboard: an old second board goes at the next save
// Write control.json only when a lasting setting changed.
function saveControl() {
  const next = JSON.stringify(control);
  if (next === controlSaved) return;
  controlSaved = next;
  savefile.writeJsonSync(CONTROL_FILE, control);
}
// ─── The board (board.js): scores, clock, goals, streaks, stats and the worm ──
const theBoard = require('./board').create({
  log, datadir, savefile, machine: MACHINE, config: () => CONFIG, competitions, scene, playhq,
  control: { get: () => control, save: () => saveControl(), LASTING, exists: () => fs.existsSync(CONTROL_FILE), markUnsaved: () => { controlSaved = ''; } },
  logoFor: n => logoFor(n), colourFor: n => colourFor(n), rules: d => rules(d), competitionName: () => competitionName(), warmTeamLists: why => warmTeamLists(why),
  record: recorder,
});
const { board, newBoard, saveBoards, scoreboardJson, pushBoard, applyAction, clockElapsed, clockLeft, refreshFromPlayhq, followClock, parseClock,
  getGoals, getStats, getWorm, streak, superShot, tickerSpeed, DEFAULT_REFRESH_SEC, TICKER_SPEED } = theBoard;

// ─── The games (games.js): this round, fixtures, up next, auto-select, season graphics, finals ──
const theGames = require('./games').create({
  log, config: () => CONFIG, competitions, finals, playhq, board: theBoard,
  control: { get: () => control, save: () => saveControl() },
  logoFor: n => logoFor(n), colourFor: n => colourFor(n), norm: s => norm(s), sameTeam: (a, b) => sameTeam(a, b),
  courtPlan: date => planner.courtFor(date),
});
const { setNightChoice, getRoundInfo, getCurrentGames, getFixtures, getUpNext, getIntroOutro, getCountdown, autoPick,
  getSeasonGames, competitionName, rules, finalsFor, getFinals, setFinalsResult, getLadderBar, getHeadToHead, getForm, getTicker, getTopShooters } = theGames;

// ─── The Production Planner (planner.js): each night's court and commentators ──
const planner = require('./planner').create({
  log, competitions, savefile, getStructure, getSeasonGames, board, sameCourt: theGames.sameCourt, night: theGames.nightChoice,
  about: () => ({ competition: competitionName(), venue: CONFIG.venueName || '' }), logoFor: n => logoFor(n),
  withLiveScores: theGames.withLiveScores, isLive: theGames.isLive,
});

// The Socials tab: a game night's pictures for social media, saved by the Mac app (socials.js).
const socials = require('./socials').create({
  log, competitions, savefile, photosDir: datadir.local('socials-photos'), byDate: () => planner.byDate(), onStream: date => planner.onStream(date),
  about: () => ({ competition: competitionName(), venue: CONFIG.venueName || '', logo: rules().competitionLogoDark, runningShooters: CONFIG.runningShooters || '',
    finalsWinners: CONFIG.finalsWinners === 'premiers' ? 'Premiers' : 'Champions' }),
  logoFor: n => logoFor(n),
  // Athletes' photos: only those who approved their use (athletes.js photoFor), and the list to pick from.
  photoFor: who => photoFor(who), // a name, or a shooter with their PlayHQ ids
  athletesWithPhotos: () => Object.values(athletes()).filter(e => e.photoOk).map(e => ({ name: e.name, photo: photoFor(e.name), teams: athleteTeams(e.name) }))
    .filter(a => a.photo).sort((a, b) => a.name.localeCompare(b.name)),
  // The top sponsors (naming, elite and major), for the sponsor strip.
  sponsorsFor: () => {
    const id = competitions.activeId();
    return id ? sponsors.wall(id, { tiers: ['naming', 'elite', 'major'] }).flatMap(t => t.sponsors).map(x => ({ name: x.name, logo: x.logoWhiteUrl || x.logoUrl })) : [];
  },
  // A division's ladder (its first pool) with its finals places, through the same cache as the Ladder page.
  ladderFor: async division => {
    const grade = (await getStructure()).grades.find(g => g.name === division);
    if (!grade) throw new Error(`No division "${division}"`);
    const rows = (await getLadder(grade.id)).pools[0] || [];
    return { rows, finalsPlaces: finals.ladderMarks(finals.sized(finalsFor(grade.name), rows.length)).places };
  },
  tallyShooters: games => theGames.tallyShooters(games), superShots: division => !!rules(division).superShots,
  // A division's finals: whether it has a format (Competitions setup), and its finals as the Finals page has them.
  hasFinals: division => !!finalsFor(division), finalsOf: division => getFinals({ division }),
  // The competition's colours, for the colour sets.
  theme: () => ({ colours: CONFIG.colours, panelOpacity: CONFIG.panelOpacity }),
});

// Studio reads the live score itself, every second through the cache (so PlayHQ is asked once
// per playhqRefreshSec), whatever windows are open. Before this the reading only happened inside
// a page's request for the scoreboard, goals, stats or worm, so with the scoreboard source hidden
// (unloaded) and the control page closed the score froze, and the game triggers ("It's full time",
// quarter breaks), the super shot song, streaks and the goal order all waited on a page that
// wasn't there. The pages' requests still read through the same cache, so nothing is asked twice.
let refreshBusy = false;
async function refreshTick() {
  if (refreshBusy) return;
  refreshBusy = true;
  try { await refreshFromPlayhq(board()); }
  catch (err) { log('error', 'scoreboard', `Reading PlayHQ failed: ${err.message}`); }
  finally { refreshBusy = false; }
}
setInterval(refreshTick, 1000);


// The game, each second, for sequences that start by themselves (scene.js, sequences.js): the picked
// game's scheduled start, the quarter, the clock (PlayHQ's scorer's or the manual one) and PlayHQ's
// break flag and finished status, all from the board, so it costs no PlayHQ calls.
function gameSnapshot() {
  const b = board();
  const left = clockLeft(b);
  const following = b.source === 'playhq' && b.followPlayhqClock;
  // The super shot period: the last superShotMinutes of the quarter in a division with super shots, as the
  // scoreboard's Super shot tab shows it (public/scoreboard.js superShotTime).
  const window = (CONFIG.superShotMinutes ?? 3) * 60;
  const superShot = competitions.superShotsFor(CONFIG, b.division) && window > 0 && left > 0 && left <= window && left < b.clock.lengthSec;
  return {
    id: b.gameId || 'manual', label: `${b.home.name} v ${b.away.name}${b.court ? ` on ${b.court}` : ''}`,
    startAt: b.gameId ? startOf({ date: b.date, time: b.time }) : null,
    period: b.period, last: CONFIG.periodType === 'halves' ? 2 : 4, left, running: !!b.clock.running && left > 0, superShot,
    onBreak: following && !!b.playhqBreak, finished: b.source === 'playhq' && /COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(b.playhqStatus || ''),
    breaks: { qt: CONFIG.quarterBreakMinutes, ht: CONFIG.halfTimeMinutes, '3qt': CONFIG.threeQuarterBreakMinutes },
  };
}
setInterval(() => { try { scene.game(gameSnapshot()); } catch (err) { log('error', 'sequence', `Game triggers failed: ${err.message}`); } }, 1000);
// The board to the pages following it over the scene socket: on every save (a press, a PlayHQ reading) and
// each second while the clock runs, since what the pages show of it (elapsed time) moves on its own.
scene.setBoardSource(() => scoreboardJson(board()));
setInterval(pushBoard, 1000);

// ─── Stream Deck links ──────────────────────────────────────────────────────
// Plain GET links, so a Stream Deck "Website" button (with "GET request in
// background" ticked) can press them. Full list in STREAMDECK.md.
//   /deck/home/add1  add2  minus1  minus2     (same for /deck/away/...)
//   /deck/home/supershot                      (plays supershot.html for that team, score unchanged)
//   /deck/streak/heating/home  fire  goalforgoal  lead  level  comeback  siren  backtoback   (plays streak.html, score unchanged)
//   /deck/clock/start  stop  toggle  reset
//   /deck/clock/set/12:34   /deck/clock/length/10 (minutes per quarter)
//   /deck/clock/playhq/on  off  toggle   (clock follows the PlayHQ scorer)
//   /deck/clock/adjust/10  adjust/-10  adjust/1m  adjust/-1m   (seconds, or m for minutes)
//   /deck/quarter/1 .. 4   /deck/quarter/5 (extra time)   /deck/quarter/next  prev
//   /deck/source/playhq  manual  toggle
//   /deck/scores/reset
//   /deck/auto/on  off  toggle   (pick the game from the court and the time)
//   /deck/court/Indoor%2001  or  /deck/court/1   (the court for automatic selection)
//   /deck/ticker/faster  slower  normal   /deck/ticker/speed/150   (pixels per second)
// (The 4K replay's and practice game's links, /deck/replay/... and /deck/practice/..., are replay.js's and practice.js's deck().)
function deckAction(parts, q) {
  const [what, verb, arg] = parts;
  if (what === 'home' || what === 'away') {
    const m = String(verb || '').match(/^(add|plus|minus|sub)(\d)$/);
    if (m) return { type: 'score', side: what, delta: (m[1] === 'add' || m[1] === 'plus' ? 1 : -1) * Number(m[2]) };
    if (verb === 'supershot') return { type: 'superShot', side: what };
  }
  // /deck/streak/heating/home, /deck/streak/fire/away, /deck/streak/goalforgoal, lead, level, comeback, siren, backtoback (streak.html, score unchanged)
  if (what === 'streak') {
    const kind = { heating: 'heating', heatingup: 'heating', fire: 'fire', onfire: 'fire', goalforgoal: 'goalForGoal', lead: 'lead', front: 'lead',
      level: 'level', square: 'level', comeback: 'comeback', siren: 'siren', backtoback: 'backToBack' }[String(verb || '').toLowerCase()];
    if (kind) return { type: 'streak', kind, side: arg === 'away' ? 'away' : 'home' };
  }
  if (what === 'clock') {
    if (['start', 'stop', 'toggle', 'reset'].includes(verb)) return { type: 'clock' + verb[0].toUpperCase() + verb.slice(1) };
    if (verb === 'set') { const secs = parseClock(arg || q.time); if (secs !== null) return { type: 'clockSet', secondsLeft: secs }; }
    if (verb === 'adjust') {
      // adjust/10, adjust/-10, adjust/30s, adjust/1m, adjust/-1m, or ?minutes=1&seconds=-30
      let secs = null;
      const m = String(arg ?? '').match(/^([+-]?\d+(?:\.\d+)?)([ms]?)$/i);
      if (m) secs = Number(m[1]) * (m[2].toLowerCase() === 'm' ? 60 : 1);
      else if (q.minutes !== undefined || q.seconds !== undefined) secs = Number(q.minutes || 0) * 60 + Number(q.seconds || 0);
      if (Number.isFinite(secs)) return { type: 'clockAdjust', deltaSec: secs };
    }
    if (verb === 'playhq' && ['on', 'off', 'toggle'].includes(arg)) return { type: 'followPlayhqClock', value: arg === 'toggle' ? 'toggle' : arg === 'on' };
    if (verb === 'length') { const mins = Number(arg ?? q.minutes); if (mins > 0) return { type: 'clockLength', value: mins * 60 }; }
  }
  if (what === 'auto' && ['on', 'off', 'toggle'].includes(verb)) return { type: 'autoSelect', value: verb === 'toggle' ? 'toggle' : verb === 'on' };
  if (what === 'ticker') {
    if (['faster', 'slower', 'normal'].includes(verb)) return { type: 'tickerSpeed', value: verb };
    if (verb === 'speed' && Number(arg ?? q.speed) > 0) return { type: 'tickerSpeed', value: Number(arg ?? q.speed) };
  }
  if (what === 'court' && verb) return { type: 'autoCourt', value: verb };
  if (what === 'source' && ['playhq', 'manual', 'toggle'].includes(verb)) return { type: 'source', value: verb };
  if (what === 'scores' && verb === 'reset') return { type: 'resetScores' };
  if ((what === 'period' || what === 'quarter') && /^([1-5]|next|prev)$/.test(verb || '')) {
    return { type: 'period', value: /^\d$/.test(verb) ? Number(verb) : verb };
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

// Pages reload themselves when this changes: after a restart, or when a file in
// public/ or config.json is edited (so updated pages show on their own).
const STARTED_AT = Date.now();
// What's going on, in one answer, for the Output page's status line (and anything else that wants to
// show a light): the competition and game, whether the score and clock follow PlayHQ, how long since
// PlayHQ last answered and the last error, the video output and how many sources are on.
function health() {
  const b = board();
  const now = Date.now();
  const following = b.source === 'playhq' && !!b.gameId;
  const waiting = following ? scoringNotYet(b) : '';
  const refreshMs = (b.playhqRefreshSec || DEFAULT_REFRESH_SEC) * 1000;
  const finished = following && /COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(b.playhqStatus || '');
  // The game itself (by PlayHQ or by hand): upcoming, live, ended (within the hour) or over. Studio keeps asking PlayHQ after
  // full time, so the state below (the link) is judged the same way whether or not the game is finished.
  const phase = theBoard.gamePhase(b);
  const readAgoMs = lastLive.at ? now - lastLive.at : null;
  // ok: fine or nothing to read; warn: a reading is overdue; bad: PlayHQ has been failing for a minute.
  // Overdue is measured from the later of the last answer and the switch to following PlayHQ (clockMatchedAt),
  // so the first seconds after a switch back from manual scores aren't a false alarm.
  const since = Math.max(lastLive.at, b.clockMatchedAt || 0);
  let playhqState = 'ok';
  if (following && !waiting) {
    if (lastLive.error && lastLive.errorAt > lastLive.at && now - since > 60000) playhqState = 'bad';
    else if (now - since > 2 * refreshMs + 2000) playhqState = 'warn';
  }
  const out = outputs.state();
  const sc = scene.state();
  // The sequence playing on the primary output and the triggered one counting down to start, with their names, for
  // the tab bar's chips on every page (studiobar.js); the recorder's state the same way.
  const nameOf = id => (sc.sequences || []).find(sq => sq.id === id)?.name || '';
  const playing = sc.playing ? { name: nameOf(sc.playing.id), step: sc.playing.step + 1, steps: sc.playing.steps, paused: !!sc.playing.paused,
    leftMs: sc.playing.leftMs, totalLeftMs: sc.playing.totalLeftMs, totalOpen: !!sc.playing.totalOpen } : null;
  const armed = sc.pending ? { name: nameOf(sc.pending.id), reason: sc.pending.reason || '', leftMs: sc.pending.leftMs } : null;
  // The head of the primary output's run order (what Next plays), and the one after it.
  const ro = (sc.runOrder || []).filter(it => !it.gone);
  const next = ro.length ? { name: ro[0].name, then: ro[1] ? ro[1].name : '', queued: ro.length } : null;
  const rec = recorder.state();
  return {
    version: pageVersion(), serverNow: now, competition: competitionName(), competitionSetup: CONFIG.name,
    game: b.gameId ? { id: b.gameId, label: `${b.home.name} v ${b.away.name}`, court: b.court || '', division: b.division || '', time: b.time || '', phase, ended: phase === 'ended' || phase === 'over' } : null,
    source: b.source, autoSelect: !!b.autoSelect,
    playhq: { state: playhqState, following, waiting, finished, status: b.playhqStatus || '', readAgoMs, refreshSec: refreshMs / 1000,
      error: lastLive.error && lastLive.errorAt > lastLive.at ? lastLive.error : (b.playhqError || '') },
    clock: { following: following && !!b.followPlayhqClock, running: !!b.clock.running, period: b.period, periodLabel: rules(b.division).periodLabel, left: clockLeft(b) },
    output: { on: !!out.on && out.mode !== 'off', mode: out.on && out.mode !== 'off' ? out.mode : '', showing: (out.showing || []).length,
      // Every output that's sending (on, not off), by name and colour, for the on-air chip.
      onAir: (out.outputs || []).filter(o => o.on && o.mode !== 'off').map(o => ({ name: o.name, colour: o.colour })),
      // And every output, sending or not, for the chip's dot per output (solid while it sends, hollow while it doesn't).
      outputs: (out.outputs || []).map(o => ({ name: o.name, colour: o.colour, on: !!o.on && o.mode !== 'off' })) },
    // The switcher, for the bar's ATEM chip: set up or not, and whether it's answering.
    switcher: (() => { const s = switcher.status(); return { setUp: !!s.setUp, connected: s.state === 'connected', model: s.model || '' }; })(),
    sourcesOn: (sc.sources || []).filter(s => s.visible).length, sources: (sc.sources || []).length,
    scene: sc.current || null, sequence: sc.playing ? (playing.name || true) : null,
    playing, armed, next,
    score: b.gameId ? { home: Number(b.home.score) || 0, away: Number(b.away.score) || 0, homeName: b.home.name, awayName: b.away.name } : null,
    autoNote: b.autoSelect ? (b.autoNote || '') : '',
    recording: { on: !!rec.recording, name: rec.recording || '', record: !!rec.record },
  };
}

function pageVersion() {
  let latest = STARTED_AT;
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else latest = Math.max(latest, fs.statSync(p).mtimeMs);
    }
  };
  try { walk(PUBLIC_DIR); latest = Math.max(latest, fs.statSync(path.join(ROOT, 'config.json')).mtimeMs); } catch {}
  // The competition setup too: switching competition, or saving its settings, logos, photos or fonts, reloads every
  // page. Not the other files Studio keeps beside them (its sequences, the athlete register, which grows as PlayHQ's
  // line-ups are read mid-game): saving those mustn't reload the graphics on air.
  try {
    latest = Math.max(latest, fs.statSync(competitions.ACTIVE_FILE).mtimeMs);
    const dir = path.join(competitions.DIR, competitions.activeId());
    latest = Math.max(latest, fs.statSync(path.join(dir, 'settings.json')).mtimeMs);
    for (const kind of competitions.KINDS) if (fs.existsSync(path.join(dir, kind))) walk(path.join(dir, kind));
  } catch {}
  return String(Math.round(latest));
}

// ─── Competition setup (setup.html) ─────────────────────────────────────────
// Puts the competition picked on the setup page to use. A different competition (or a
// different PlayHQ link) clears everything cached from PlayHQ; switching competition also
// sets the game night back to automatic and puts that competition's first game on every board.
const MACHINE_KEYS = ['port', 'cacheSeconds', 'playhqRefreshSeconds', 'logMaxMB', 'apiBaseUrl', 'gameSummaryPath', 'remoteChanges'];
function applyCompetition(why) {
  const id = competitions.activeId();
  const prev = CONFIG;
  CONFIG = { ...Object.fromEntries(MACHINE_KEYS.filter(k => MACHINE[k] !== undefined).map(k => [k, MACHINE[k]])), ...competitions.get(id), id };
  playhq.setOrganisation(CONFIG.organisationUrl);
  theGames.configure(CONFIG);
  theBoard.setQuarterSec(Math.round((Number(CONFIG.quarterMinutes) || 10) * 60));
  const switched = prev.id && prev.id !== id;
  const sourceChanged = switched || ['organisationUrl', 'competitionName', 'seasonName'].some(k => prev[k] !== CONFIG[k]);
  if (prev.id && sourceChanged) {
    playhq.resetCaches();
    theGames.resetCaches(); teams.resetCaches();
    athleteRegister.resetCaches();
  }
  { const b = board(); // a new quarter length applies to a clock that hasn't started
    if (!b.clock.running && !b.clock.elapsedMs) b.clock.lengthSec = b.clock.baseSec = theBoard.quarterSec();
  }
  scene.competitionChanged();
  log('info', 'setup', !id ? `${why}: none yet` : `${why}: ${CONFIG.name} (${CONFIG.competitionName || 'no PlayHQ competition set'}, organisation ${playhq.organisation().orgId || 'not set'} on ${playhq.organisation().tenant})`);
  if (prev.id && sourceChanged) {
    if (theGames.nightChoice()) setNightChoice(''); // blank needs no PlayHQ, so it is set at once
    Object.assign(board(), newBoard()); autoPick();
    saveBoards();
  }
}

// What the setup page shows for one competition.
// A competition's added font files, as paths, so theme.css can measure them (fonts.js normalise).
const fontPaths = id => competitions.images(id, 'fonts').map(f => competitions.imageFile(id, 'fonts', f)).filter(Boolean);

function setupInfo(id) {
  return { id, active: id === competitions.activeId(), settings: competitions.get(id),
    logos: competitions.images(id, 'logos'), brand: competitions.images(id, 'brand'),
    fonts: competitions.images(id, 'fonts'), fontFamilies: fonts.families(competitions.images(id, 'fonts')) };
}

// The organisation's competitions and seasons on PlayHQ, to pick from on the setup page.
async function findCompetitions(organisationUrl) {
  const u = parsePlayhqUrl(organisationUrl);
  if (!u) throw new Error('That doesn\'t look like a PlayHQ organisation link. Open the organisation on playhq.com and copy the address, e.g. https://www.playhq.com/netball-australia/org/<name>/<8 characters>.');
  const data = await gql('discoverCompetitions', Q_COMPETITIONS, { organisationID: u.orgId }, false, u.tenant);
  const list = data.discoverCompetitions || [];
  return { tenant: u.tenant, organisationId: u.orgId, organisation: (list.find(c => c.organisation) || {}).organisation?.name || '',
    competitions: list.map(c => ({ name: c.name, seasons: (c.seasons || []).map(x => x.name), currentSeason: (pickSeason(c.seasons || []) || {}).name || '' })) };
}

// Every team in the competition in use, with the logo each one gets, for the setup page.
// byDivision lists a team once in every division it plays in (the athletes page); otherwise once.
async function setupTeams({ byDivision = false } = {}) {
  const st = await getStructure();
  const teams = new Map();
  const add = (name, division) => {
    const k = byDivision ? `${norm(division)}|${norm(name)}` : norm(name);
    if (name && name !== 'TBC' && !teams.has(k)) teams.set(k, { name, division });
  };
  for (const grade of st.grades) {
    try { for (const row of (await getLadder(grade.id)).pools.flat()) add(row.team, grade.name); } catch (err) { log('warn', 'setup', `Ladder for ${grade.name}: ${err.message}`); }
  }
  try { for (const g of await getCurrentGames()) { add(g.home.name, g.division); add(g.away.name, g.division); } } catch { /* the ladders are enough */ }
  return { competition: st.competition, season: st.season.name,
    teams: [...teams.values()].sort((a, b) => a.division.localeCompare(b.division, 'en', { numeric: true }) || a.name.localeCompare(b.name))
      .map(t => ({ ...t, logo: logoFor(t.name), club: competitions.clubFor(CONFIG, t.name), autoClub: competitions.clubOf(t.name), colour: colourFor(t.name) })) };
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on('data', d => { size += d.length; if (size > max) { reject(new Error(`That file is over ${Math.round(max / 1048576)} MB.`)); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

async function setupRoute(req, res, url, q) {
  const m = url.pathname.match(/^\/api\/setup(?:\/([a-z0-9-]+)(?:\/(activate|image|export|template|fontcss))?)?$/);
  // The fonts installed on this Mac, for the setup page's Font box (none on another computer).
  if (url.pathname === '/api/setup-fonts') return send(res, 200, { mac: await fonts.macFonts() });
  if (url.pathname === '/api/setup-find') return send(res, 200, await findCompetitions(q.url || (await readBody(req)).organisationUrl));
  if (url.pathname === '/api/setup-teams') return send(res, 200, await setupTeams());
  if (url.pathname === '/api/setup-new' && req.method === 'POST') {
    const body = await readBody(req);
    const id = competitions.create(String(body.name || 'New competition').trim() || 'New competition', body.from || null);
    log('info', 'setup', `New competition setup "${body.name}" (${id})${body.from ? ` copied from ${body.from}` : ''}`);
    return send(res, 200, setupInfo(id));
  }
  if (url.pathname === '/api/setup-template' && req.method === 'POST') {
    let tpl;
    try { tpl = JSON.parse((await readRaw(req, 100 * 1024 * 1024)).toString('utf8')); } catch { return send(res, 400, { error: "That isn't a FirstPass Studio competition template." }); }
    const hadActive = competitions.activeId();
    const id = competitions.importTemplate(tpl, q.name);
    sponsors.importFor(id, tpl.sponsors);
    log('info', 'setup', `Imported a template file as ${id}`);
    if (!hadActive) applyCompetition('First competition imported');
    return send(res, 200, setupInfo(id));
  }
  if (url.pathname === '/api/setup-import' && req.method === 'POST') {
    const body = await readBody(req);
    const hadActive = competitions.activeId();
    const id = competitions.importConfig(String(body.from || ''), body.name);
    log('info', 'setup', `Imported the ${body.from} import config as ${id}`);
    if (!hadActive) applyCompetition('First competition imported');
    return send(res, 200, setupInfo(id));
  }
  if (!m) return send(res, 404, { error: 'Unknown setup link' });
  const [, id, what] = m;
  if (!id) return send(res, 200, { active: competitions.activeId(), competitions: competitions.list(), imports: competitions.imports(),
    canSaveImports: datadir.canSaveImports(), dataDir: datadir.DATA_DIR, dataLocation: datadir.location.local ? null : { name: datadir.location.name, computer: datadir.location.computer }, readOnly: competitions.isReadOnly(),
    fonts: fonts.bundled(), defaults: competitions.DEFAULTS, finalsFormats: finals.list(), finalsMarks: finals.MARKS });
  if (what === 'export' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const importId = competitions.saveAsImport(id, body.importId, !!body.replace);
      log('info', 'setup', `Saved ${id} as the import config imports/${importId}`);
      return send(res, 200, { importId, imports: competitions.imports() });
    } catch (err) {
      if (err.exists) return send(res, 409, { error: err.message, exists: err.exists });
      throw err;
    }
  }
  if (what === 'activate' && req.method === 'POST') {
    competitions.setActive(id);
    applyCompetition('Switched competition');
    return send(res, 200, setupInfo(id));
  }
  // The CSS that loads a font for the setup page's preview, with this competition's added fonts.
  if (what === 'fontcss') {
    return send(res, 200, fonts.css(q.font, fontPaths(id), f => `/api/setup/${id}/image?kind=fonts&name=${encodeURIComponent(path.basename(f))}`,
      { mac: await fonts.macFaces(q.font), size: (Number(q.size) || 100) / 100 }), 'text/css; charset=utf-8');
  }
  if (what === 'image') {
    const kind = ['brand', 'fonts'].includes(q.kind) ? q.kind : 'logos';
    if (req.method === 'POST') {
      let name;
      // A file that isn't what it should be (wrong extension, or not the image its name says) is the person's to fix: 400, not 502.
      try { name = competitions.saveImage(id, kind, q.name, await readRaw(req, 15 * 1024 * 1024)); }
      catch (err) { return send(res, 400, { error: err.message }); }
      log('info', 'setup', `${id}: added ${{ brand: 'competition logo', fonts: 'font file' }[kind] || 'team logo'} ${name}`);
      return send(res, 200, { name, ...(kind === 'fonts' ? { family: fonts.fontFile(name).family } : {}), ...setupInfo(id) });
    }
    if (req.method === 'DELETE') {
      competitions.deleteImage(id, kind, q.name);
      log('info', 'setup', `${id}: removed ${kind} ${q.name}`);
      return send(res, 200, setupInfo(id));
    }
    // Added files are served as plain files, never as pages of Studio's (uploads.js), as /logos/ and the rest are.
    const file = competitions.imageFile(id, kind, q.name || '');
    return fs.readFile(file || '', (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', uploads.SERVE_HEADERS));
  }
  if (req.method === 'POST') {
    competitions.save(id, await readBody(req));
    log('info', 'setup', `Saved the ${id} competition setup`);
    if (id === competitions.activeId()) applyCompetition('Competition setup saved');
    return send(res, 200, setupInfo(id));
  }
  if (what === 'template') return send(res, 200, { ...competitions.exportTemplate(id), sponsors: sponsors.exportFor(id) });
  if (req.method === 'DELETE') {
    const wasActive = id === competitions.activeId();
    const active = competitions.remove(id);
    log('info', 'setup', `Deleted the ${id} competition setup${wasActive ? `; now using ${active || 'no competition'}` : ''}`);
    if (wasActive) applyCompetition('Competition in use deleted');
    return send(res, 200, { ok: true, active });
  }
  return send(res, 200, setupInfo(id));
}

// ─── Team sheets and shooting stats (teams.js) ──────────────────────────────
// Name matching, as the athlete register, the team sheets and the lower third do it.
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sameTeam = (a, b) => norm(a) && norm(a) === norm(b);
const teams = require('./teams').create({
  log, config: () => CONFIG, playhq, datadir, board: () => board(), getUpNext: () => getUpNext(),
  squadFor: (n, d) => squadFor(n, d), withSquad: (s, d) => withSquad(s, d), logoFor: n => logoFor(n),
  competitionName: () => competitionName(), rules: d => rules(d), defaultRefreshSec: () => DEFAULT_REFRESH_SEC, sameTeam,
});
const { positionOf, warmTeamLists, getTeamSheets } = teams;

// ─── Team logos, athlete photos and the athlete register ────────────────────
// All in athletes.js; this is the register for the competition in use.
const athleteRegister = require('./athletes').create({
  log, config: () => CONFIG, competitions, savefile, playhq, board: () => board(),
  getSeasonGames: g => getSeasonGames(g), getTeamSheets: () => getTeamSheets(), setupTeams: o => setupTeams(o),
  norm: s => norm(s), sameTeam: (a, b) => sameTeam(a, b), send, readBody, readRaw,
});
const { logoFor, colourFor, photoFor, fileApproved, photoKey, genderInfo, silhouette, athleteTeams, athletes, withPhotos, withSquad, squadFor, athletesRoute } = athleteRegister;
// 4K replays (replay.js): a recording's on-air layer on the pages again, its times moved to now.
// A replay can follow a HyperDeck's timecode (hyperdeck.js) or the SDI input's (sditimecode.js, from the Mac app); what it
// follows is this Mac's (replay.json, local).
hyperdeck.init(log);
sditimecode.init(log);
replay.init(log, { read: name => recorder.read(name), shift: (v, ms) => practice.shift(v, ms), scene: st => scene.replay(st),
  board: json => scene.replayBoard(json), paused: on => recorder.pause(on), timecodes: { hyperdeck, sdi: sditimecode }, settings: datadir.local('replay.json') });
// Practice games (practice.js): a recording plays back as if live. It forgets what was read from PlayHQ when it
// starts, moves and stops, so the recording's answers (and then PlayHQ's again) are read afresh.
practice.init(log, {
  read: name => recorder.read(name),
  reset: () => { playhq.resetCaches(); theGames.resetCaches(); teams.resetCaches(); },
  snapshot: () => theBoard.snapshot(),
  restore: s => theBoard.restore(s),
  select: game => {
    const b = board();
    applyAction(b, { type: 'selectGame', game });
    applyAction(b, { type: 'resetScores' });
    applyAction(b, { type: 'source', value: 'playhq' });
    saveBoards();
  },
  paused: on => recorder.pause(on),
  positionOf: p => positionOf(p),
  demos: datadir.local('demos.json'),
  competition: () => competitions.activeId() || '',
  readJson: f => savefile.readJson(f, {}),
  writeJson: (f, v) => savefile.writeJsonSync(f, v),
  // A demo game's choices: the competition's divisions, and a division's finished games this season.
  choices: async gradeId => {
    const st = await playhq.getStructure();
    const divisions = (st.grades || []).map(g => ({ id: g.id, name: g.name }));
    const grade = (st.grades || []).find(g => g.id === gradeId);
    const games = grade ? (await theGames.getSeasonGames(grade)).filter(g => isFinished(g)).reverse()
      .map(g => ({ id: g.id, date: g.date, round: g.round, home: g.home.name, away: g.away.name, score: [g.home.score, g.away.score] })) : [];
    return { competition: competitionName(), divisions, games };
  },
  // The client's historic game: its teams' line ups (with the season's squad after them, by the position each played
  // most, for a line up that's missing or short), and its division's teams.
  demo: async (gameId, gradeId) => {
    const st = await playhq.getStructure();
    const grade = (st.grades || []).find(g => g.id === gradeId);
    if (!grade) throw new Error('Pick the division of the game to show.');
    const game = await playhq.getGame(gameId, 10 * 60 * 1000);
    const teams = [];
    for (const g of await theGames.getSeasonGames(grade)) for (const n of [g.home.name, g.away.name]) if (n && n !== 'TBC' && !teams.includes(n)) teams.push(n);
    const side = async s => {
      const players = s.players.filter(p => !p.private).map(p => ({ name: p.name, playhqId: p.playhqId, position: p.position, gender: p.gender, private: false }));
      if (players.length < 7) {
        let squad = [];
        try { squad = await squadFor(s.name, grade.name); } catch (err) { log('warn', 'practice', `${s.name}: no season squad for the demo: ${err.message}`); }
        for (const a of squad) if (!players.some(p => p.name === a.name)) players.push({ name: a.name, playhqId: '', position: a.position || '', gender: a.gender || '', private: false });
      }
      return { name: s.name, players };
    };
    return { division: grade.name, gradeId, teams, home: await side(game.home), away: await side(game.away) };
  },
});
// ─── Person lower third (lowerthird.js) ─────────────────────────────────────
const lowerThird = require('./lowerthird').create({
  log, board: () => board(), playhq, competitionName: () => competitionName(), rules: d => rules(d),
  athletes, photoKey, athleteTeams, genderInfo, photoFor, silhouette, logoFor, norm, sameTeam,
});
const { getLowerThird, getLowerThirdAthletes } = lowerThird;

competitions.init(log, { readOnly: DATA_STATE.readOnly });
applyCompetition('Using competition');

// ─── HTTP ───────────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.yaml': 'application/yaml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon' };

function send(res, status, body, type, headers) {
  // No access-control-allow-origin: Studio's pages are served by Studio, so they are the same origin, and the
  // Stream Deck plugin isn't a browser. A web page from anywhere else can't read Studio's answers; access.crossSite
  // stops it changing anything.
  res.writeHead(status, { 'content-type': type || 'application/json', 'cache-control': 'no-store', ...headers });
  const text = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.end(text);
  recorder.answer(res.req, status, text, type, graphicRead);
}
// The user guide's page and pictures (/guide/). The page asks Google for Montserrat, which suits the web copy; in
// Studio it gets the Montserrat Studio's own pages use (studio.css), so it reads with no internet at the venue.
const GUIDE_DIR = path.join(ROOT, 'docs', 'user-guide');
function sendGuide(res, rel) {
  if (!rel || rel === 'index.html') {
    fs.readFile(path.join(GUIDE_DIR, 'index.html'), 'utf8', (err, html) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      let fonts = '';
      try { fonts = (fs.readFileSync(path.join(PUBLIC_DIR, 'studio.css'), 'utf8').match(/@font-face[^}]*}/g) || []).join('\n').replace(/url\("vendor\//g, 'url("/vendor/'); } catch {}
      send(res, 200, html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, `<style>${fonts}</style>`), TYPES['.html']);
    });
    return;
  }
  // Only the pictures straight in img/ (the print PDF's light ones in img/light aren't shipped).
  if (!/^img\/[\w.-]+\.(webp|svg|png|jpg)$/.test(rel)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(path.join(GUIDE_DIR, rel), (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(rel)]));
}

// public/openapi.yaml as JSON, read again only when the file changes.
let openapiCache = { mtime: 0, json: null };
function openapiJson() {
  const file = path.join(PUBLIC_DIR, 'openapi.yaml');
  const mtime = fs.statSync(file).mtimeMs;
  if (openapiCache.mtime !== mtime) openapiCache = { mtime, json: require('yaml').parse(fs.readFileSync(file, 'utf8')) };
  return openapiCache.json;
}

// What the game recording keeps of the answers: a graphic's reads (asked for by a page that isn't one of Studio's
// own, which have the tab bar), never a private one or the recordings themselves.
const OWN_PAGES = new Set(fs.readdirSync(path.join(__dirname, 'public')).filter(n => n.endsWith('.html')
  && fs.readFileSync(path.join(__dirname, 'public', n), 'utf8').includes('class="fp-bar"')).map(n => `/${n}`).concat('/'));
function graphicRead(pathname, headers) {
  if (access.privateRead('GET', pathname) || pathname.startsWith('/api/recordings')) return false;
  let from;
  try { from = new URL(headers.referer).pathname; } catch { return false; }
  return !OWN_PAGES.has(from);
}

// Addresses already logged as refused a change (one line each, not one per press).
const refusedFrom = new Set();
// Requests that pages repeat every second or two are only logged when they fail.
const QUIET = new Set(['/api/version', '/api/log', '/api/scene/events', '/api/switcher/events', '/api/scene/mics/report', '/api/scene/mics/live']);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // A Stream Deck link with this Mac's key in front (/k/<key>/deck/...) is the plain /deck/... link from here on.
  const keyed = /^\/k\/([^/]+)(\/deck(?:\/.*)?)$/.exec(url.pathname);
  if (keyed) url.pathname = keyed[2];
  const q = Object.fromEntries(url.searchParams);
  const started = Date.now();
  res.on('finish', () => {
    const polled = QUIET.has(url.pathname) || (req.method === 'GET' && (url.pathname === '/api/scoreboard' || url.pathname === '/api/teams' || url.pathname === '/api/goals' || url.pathname === '/api/countdown' || url.pathname === '/api/ticker/speed'));
    const asset = req.method === 'GET' && !/\.html$|^\/$|^\/api\/|^\/deck\//.test(url.pathname);
    if (res.statusCode >= 400 || !(polled || asset)) {
      log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http',
        `${req.method} ${url.pathname}${url.search} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
  try {
    // A change (anything but reading, and the Stream Deck links) must come from Studio's own pages or a program, never
    // from a web page on another site; a read of private data (access.PRIVATE: backups, the athlete register, the log,
    // sponsor reports, the setup) must be asked for by one of Studio's own names, not a DNS rebinding page's; and
    // config.json "remoteChanges": false keeps changes, and those reads, to this computer and the devices allowed in
    // Devices… (devices.js: a link set's key, a signed plugin press, a paired browser's cookie), within their level.
    const signed = devices.signed(req.method, req.url, req.headers);
    const keyDevice = keyed ? devices.match(keyed[1]) : null;
    const device = keyDevice || (signed === 'ok' && devices.byId(req.headers['x-studio-device'])) || devices.fromCookie(req.headers.cookie);
    const refused = (access.changes(req.method, url.pathname) && access.crossSite(req.method, url.pathname, req.headers, PORT, ownHosts()))
      || (access.privateRead(req.method, url.pathname) && access.foreignHost(req.method, url.pathname, req.headers, ownHosts()))
      || access.notThisMac(req.method, url.pathname, req.socket.remoteAddress)
      || access.refusal(MACHINE.remoteChanges, req.method, url.pathname, req.socket.remoteAddress, undefined, device ? device.level : null);
    if (refused) {
      const from = `${access.strip(req.socket.remoteAddress)} ${req.headers.origin || req.headers.host || ''}`;
      if (!refusedFrom.has(from)) { refusedFrom.add(from); log('warn', 'access', refused); }
      return send(res, 403, { error: refused });
    }
    // A 4K replay (replay.js) is on the pages: a graphic's read gets what it was answered on the night, and the scene
    // and scoreboard can't be changed (nor a practice game started) until it's stopped, so the live setup is left as it
    // was. The outputs can still be changed (4K on, an output on).
    if (replay.active()) {
      if (req.method === 'GET' && url.pathname.startsWith('/api/') && graphicRead(url.pathname, req.headers)) {
        const night = replay.answer(url.pathname + url.search);
        if (night !== undefined) return send(res, 200, night);
      }
      const changing = (req.method !== 'GET' && /^\/api\/(scene|scoreboard|practice|sequences|music|mics)(\/|$)/.test(url.pathname))
        || (/^\/deck\//.test(url.pathname) && !/^\/deck\/(output|replay)\//.test(url.pathname));
      if (changing) return send(res, 409, { error: 'A 4K replay is running. Stop it on the Recordings tab first.' });
    }
    // Stream Deck links: only with the key, from the Studio plugin, or from Studio's own pages (access.deckPress()), so
    // a web page can't press one. A refused link is logged once per address, with how to fix it.
    const deck = access.deckPress(url.pathname, { keyOk: !!keyDevice, signed: signed === 'ok', headerOk: !devices.pluginPaired() }, req.headers, PORT, ownHosts());
    if (deck === false) {
      const from = access.strip(req.socket.remoteAddress);
      // pair: the Studio plugin should ask to be allowed (again).
      const pair = signed === 'unknown' || (signed === null && !!req.headers['x-studio-deck']);
      const why = signed === 'unknown' ? `Studio refused ${url.pathname}: this Stream Deck was removed in Devices… or went unused for 90 days. Its next press asks to pair again; Allow it on the Mac.`
        : signed === 'bad' ? `Studio refused ${url.pathname}: the Stream Deck's signature didn't check out (its computer's clock may be more than a minute out from this Mac's, or the press was sent twice).`
          : pair ? `Studio refused ${url.pathname}: this Stream Deck plugin hasn't been allowed yet. It asks on its first press; Allow it on the Mac. If no dialog comes, install the plugin again from the Output page.`
            : `Studio refused ${url.pathname} because the link has no Stream Deck key, or one this Mac has given up (Devices…, Make a new key). Copy the link again from the Output page (it starts ${LINK_BASE}/k/…), or install the Stream Deck plugin again from the Output page.`;
      if (!refusedFrom.has(`deck ${from} ${signed}`)) { refusedFrom.add(`deck ${from} ${signed}`); log('warn', 'access', why); }
      return send(res, 403, { error: why, ...(pair ? { pair: true } : {}) });
    }
    if (url.pathname === '/api/deck-key') return send(res, 200, { key: devices.linkKey(), base: deckBase() });
    // Another device asks to control Studio (devices.js ask()); it learns the answer from GET /api/pair/<id> with its token.
    if (url.pathname === '/api/pair' && req.method === 'POST') {
      const body = await readBody(req);
      const asked = devices.ask(body.name, access.strip(req.socket.remoteAddress), body.publicKey, body.browser === true);
      return send(res, asked.error ? 409 : 202, asked);
    }
    // The pair page asks whether this browser is paired already (its cookie), and as what.
    if (url.pathname === '/api/pair/me') {
      const me = devices.fromCookie(req.headers.cookie);
      return send(res, 200, me ? { paired: true, name: me.name, level: me.level } : { paired: false });
    }
    const pair = /^\/api\/pair\/([^/]+)$/.exec(url.pathname);
    if (pair && req.method === 'GET') {
      const { cookie, ...got } = devices.collect(decodeURIComponent(pair[1]), req.headers['x-studio-pair']);
      // A browser's key goes only in its cookie: HttpOnly, so no page script can read it, and SameSite=Strict, so no
      // other site's page can send it. 400 days is as long as browsers keep one; unused for 90 days it stops counting.
      const headers = cookie ? { 'set-cookie': `${devices.COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000` } : {};
      return send(res, got.status === 'gone' ? 404 : 200, got.key ? { ...got, base: `${LINK_BASE}/k/${got.key}` } : got, undefined, headers);
    }
    // The Devices list at the top of the Devices tab (api.html), on this Mac only (access.notThisMac()).
    if (url.pathname === '/api/devices' && req.method === 'GET') return send(res, 200, { devices: devices.list(), asking: devices.pending() });
    // Named link sets (Output page and Stream Deck page, on this Mac): make one, read its key for copying links, give it a new key.
    if (url.pathname === '/api/devices/links' && req.method === 'POST') {
      const made = devices.addLinks((await readBody(req)).name);
      if (!made) return send(res, 400, { error: 'Give the link set a name, such as "Office Stream Deck".' });
      return send(res, 200, { ...made, base: `${LINK_BASE}/k/${devices.linkKey(made.id)}` });
    }
    // A paired browser's level: scoring only, or everything.
    const level = /^\/api\/devices\/([^/]+)\/level$/.exec(url.pathname);
    if (level && req.method === 'POST') {
      if (!devices.setLevel(decodeURIComponent(level[1]), (await readBody(req)).level)) return send(res, 404, { error: 'Only a paired browser has a level, scoring or everything.' });
      return send(res, 200, { devices: devices.list() });
    }
    const setKey = /^\/api\/devices\/([^/]+)\/(key|renew)$/.exec(url.pathname);
    if (setKey && (setKey[2] === 'key' ? req.method === 'GET' : req.method === 'POST')) {
      const id = decodeURIComponent(setKey[1]);
      if (setKey[2] === 'renew' && !devices.renew(id)) return send(res, 404, { error: 'That link set isn\'t in the list.' });
      const key = devices.linkKey(id);
      if (!key) return send(res, 404, { error: 'That link set isn\'t in the list.' });
      return send(res, 200, { key, base: `${LINK_BASE}/k/${key}`, devices: devices.list() });
    }
    const answer = /^\/api\/devices\/requests\/([^/]+)\/(allow|deny)$/.exec(url.pathname);
    if (answer && req.method === 'POST') {
      if (!devices.answer(decodeURIComponent(answer[1]), answer[2] === 'allow', (await readBody(req)).level)) return send(res, 404, { error: 'That request was already answered or has run out.' });
      return send(res, 200, { devices: devices.list(), asking: devices.pending() });
    }
    const revoke = /^\/api\/devices\/([^/]+)\/revoke$/.exec(url.pathname);
    if (revoke && req.method === 'POST') {
      if (!devices.revoke(decodeURIComponent(revoke[1]))) return send(res, 404, { error: 'That device isn\'t in the list.' });
      return send(res, 200, { devices: devices.list() });
    }
    if (url.pathname === '/api/log') {
      if (req.method === 'POST') {
        const e = await readBody(req);
        log(['error', 'warn'].includes(e.level) ? e.level : 'info', `page ${String(e.page || '?').slice(0, 80)}`, e.message || '', e.detail);
        return send(res, 204, '');
      }
      // Open http://localhost:8080/api/log to read the log in a browser.
      return fs.readFile(LOG_FILE, (err, buf) => send(res, 200, err ? 'The log is empty.' : buf, 'text/plain; charset=utf-8'));
    }
    if (url.pathname === '/api/structure') return send(res, 200, { ...await getStructure(), setup: CONFIG.name, rules: rules() });
    if (url.pathname.startsWith('/api/setup')) return await setupRoute(req, res, url, q);
    // The competition in use: its colours and font, team logos, competition logo, athlete photos and added fonts.
    if (url.pathname === '/theme.css') return send(res, 200, competitions.themeCss(CONFIG, fontPaths(competitions.activeId()), await fonts.macFaces(CONFIG.font)), 'text/css; charset=utf-8');
    if (/^\/(logos|brand|photos|headshots|fonts)\//.test(url.pathname)) {
      const [, kind, name = ''] = url.pathname.split('/');
      // A photo the athlete hasn't approved goes only to someone who may change the athletes (the athletes page), never
      // to a graphic or a device that only watches.
      if (kind === 'photos' && !fileApproved(decodeURIComponent(name))
        && access.refusal(MACHINE.remoteChanges, 'POST', '/api/athletes/approval', req.socket.remoteAddress, undefined, device ? device.level : null)) {
        return send(res, 404, 'Not found', 'text/plain');
      }
      const file = competitions.imageFile(competitions.activeId(), kind, name);
      // Added files are served as plain files, never as pages of Studio's (uploads.js).
      return fs.readFile(file || '', (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', uploads.SERVE_HEADERS));
    }
    if (url.pathname === '/api/ladder') {
      const st = await getStructure();
      // No ?division: the division of the game picked on the control page.
      const grade = findGrade(st, q.division ? q : { division: board().division || '1' });
      if (!grade) return send(res, 404, { error: `No division "${q.division}". This season has: ${st.grades.map(g => g.name).join(', ')}` });
      const ladder = await getLadder(grade.id);
      const marks = finals.ladderMarks(finals.sized(finalsFor(grade.name), Math.max(0, ...ladder.pools.map(p => p.length))));
      return send(res, 200, { organisation: st.organisation, competition: st.competition, season: st.season.name, division: grade.name,
        rules: { ...rules(grade.name), finalsPlaces: marks.places }, finals: marks, ...ladder });
    }
    if (url.pathname === '/api/version') return send(res, 200, { version: pageVersion(), base: LINK_BASE });
    if (url.pathname === '/api/health') return send(res, 200, health());
    if (url.pathname === '/api/settings/export' && req.method === 'GET') {
      // Every setting in one zip with its summary (datalocation.exportEntries); ?media=0 leaves out the media folder, ?notes= heads the summary.
      const name = datalocation.exportName();
      const { list, skipped } = datalocation.exportEntries(datadir.DATA_DIR, { media: q.media !== '0', folder: name, about: { studio: pageVersion() }, notes: String(q.notes || '').slice(0, 5000) });
      if (skipped.length) log('warn', 'settings', `Exporting the settings without ${skipped.join(', ')}: not downloaded from iCloud yet`);
      res.writeHead(200, { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${name}.zip"` });
      try {
        await require('./zip').write(res, list);
        log('info', 'settings', `Exported the settings as ${name}.zip: ${list.length - 2} files`);
      } catch (err) { log('warn', 'settings', `Settings export stopped: ${err.message}`); res.destroy(); }
      return;
    }
    if (url.pathname === '/api/teams') return send(res, 200, withPhotos(await getTeamSheets()));
    if (url.pathname.startsWith('/api/athletes')) return await athletesRoute(req, res, url, q);
    if (url.pathname === '/api/games') return send(res, 200, await getCurrentGames());
    // A saved plan can change tonight's court, so automatic game selection looks again straight away.
    if (url.pathname.startsWith('/api/planner') && await planner.route(req, res, url, { send, readBody, readRaw, changed: () => autoPick() })) return;
    if (url.pathname.startsWith('/api/socials') || url.pathname.startsWith('/socials/')) {
      if (await socials.route(req, res, url, { send, readBody, readRaw, port: PORT })) return;
    }
    if (url.pathname === '/api/rounds') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        try { await setNightChoice(body.night !== undefined ? body.night : body.round); } catch (err) { return send(res, 400, { error: err.message }); }
        await autoPick();
      }
      return send(res, 200, await getRoundInfo());
    }
    if (url.pathname === '/api/countdown') return send(res, 200, getCountdown());
    if (url.pathname === '/api/introoutro') return send(res, 200, await getIntroOutro(q));
    if (url.pathname === '/api/upnext') return send(res, 200, await getUpNext({ wrap: q.wrap === '0' ? false : q.wrap === '1' ? 'force' : true }));
    if (url.pathname === '/api/ladderbar') return send(res, 200, await getLadderBar());
    if (url.pathname === '/api/lowerthird/athletes') return send(res, 200, getLowerThirdAthletes());
    if (url.pathname === '/api/lowerthird') return send(res, 200, getLowerThird(q));
    if (url.pathname === '/api/headtohead') return send(res, 200, await getHeadToHead());
    if (url.pathname === '/api/form') return send(res, 200, await getForm(q.count));
    // Asked by ticker.html every few seconds so a speed change shows straight away (no PlayHQ call).
    if (url.pathname === '/api/ticker/speed') return send(res, 200, { speed: board().tickerSpeed || TICKER_SPEED });
    if (url.pathname === '/api/ticker') return send(res, 200, await getTicker());
    if (url.pathname === '/api/topshooters') return send(res, 200, await getTopShooters(q));
    if (url.pathname === '/api/fixtures') return send(res, 200, await getFixtures(q));
    if (url.pathname === '/api/finals') return send(res, 200, await getFinals(q));
    if (url.pathname === '/api/finals/result' && req.method === 'POST') return send(res, 200, await setFinalsResult(await readBody(req)));
    // What's playing back, for the strip under every Studio page's tab bar and the Stream Deck plugin's Replay keys: one read.
    if (url.pathname === '/api/playback') return send(res, 200, { replay: replay.state(), practice: practice.state() });
    if (url.pathname === '/api/replay') {
      if (req.method === 'POST' && practice.active()) return send(res, 409, { error: 'A practice game is running. Stop it first.', ...replay.state() });
      if (await replay.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname === '/api/practice' || url.pathname === '/api/practice/games') {
      if (await practice.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname === '/api/recordings' || url.pathname.startsWith('/api/recordings/')) {
      if (await recorder.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname === '/api/outputs' || url.pathname.startsWith('/api/outputs/')) {
      if (await outputs.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname === '/api/switcher' || url.pathname.startsWith('/api/switcher/')) {
      if (await switcher.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname.startsWith('/api/scene') || url.pathname.startsWith('/media/')) {
      if (await scene.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname.startsWith('/api/viewers')) {
      if (await viewers.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname.startsWith('/api/sponsors') || url.pathname.startsWith('/sponsors/')) {
      const saveSettings = (id, changes) => { competitions.save(id, changes); if (id === competitions.activeId()) applyCompetition('Sponsor settings saved'); };
      if (await exposure.route(req, res, url, { send })) return;
      if (await sponsors.route(req, res, url, { send, readBody, readRaw, saveSettings, gave: exposure.gave, flash: exposure.flash })) return;
    }
    if (url.pathname.startsWith('/deck/')) {
      const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);
      // The scene's links: /deck/layer/<name>/on|off|toggle|restart and /deck/layers/off.
      const layer = scene.deck(parts, q);
      if (layer) return send(res, layer.status, layer.body);
      // The video outputs: /deck/output/on|off|toggle, /deck/output/<output>/on|off|toggle, /deck/output/all/....
      const output = outputs.deck(parts);
      if (output) return send(res, output.status, output.body);
      // The ATEM switcher: /deck/switcher/cut, auto, preview/<input>, usk/<n>/on ... (switcher.js).
      const sw = await switcher.deck(parts);
      if (sw) return send(res, sw.status, sw.body);
      // A 4K replay or a practice game: /deck/replay/play, pause, toggle, stop, next, prev, nudge/<ms>; /deck/practice/... (replay.js, practice.js).
      const playback = replay.deck(parts) || practice.deck(parts);
      if (playback) return send(res, playback.status, playback.body);
      const action = deckAction(parts, q);
      if (!action) return send(res, 404, { error: `Unknown Stream Deck link ${url.pathname}. See Links on the Devices tab, /api.html#links.` });
      const b = board();
      applyAction(b, action);
      if (['autoSelect', 'autoCourt', 'reset'].includes(action.type)) await autoPick();
      saveBoards();
      log('info', 'deck', `${action.type}: now ${b.home.score}-${b.away.score}, clock ${b.clock.running ? 'running' : 'stopped'}`, action);
      return send(res, 200, { ok: true, home: b.home.score, away: b.away.score, source: b.source, clockRunning: b.clock.running });
    }
    if (url.pathname === '/api/worm') {
      await refreshFromPlayhq(board()); // shares the scoreboard's cached PlayHQ reading
      return send(res, 200, getWorm());
    }
    if (url.pathname === '/api/stats') {
      await refreshFromPlayhq(board()); // shares the scoreboard's cached PlayHQ reading
      return send(res, 200, getStats());
    }
    if (url.pathname === '/api/goals') {
      await refreshFromPlayhq(board()); // shares the scoreboard's cached PlayHQ reading
      return send(res, 200, getGoals(q.count));
    }
    if (url.pathname === '/api/scoreboard') {
      const b = board();
      if (req.method === 'POST') {
        const action = await readBody(req);
        log('info', 'scoreboard', `${action.type || '?'}`, action);
        applyAction(b, action);
        if (['autoSelect', 'autoCourt', 'reset'].includes(action.type)) await autoPick();
        saveBoards();
      }
      else await refreshFromPlayhq(b);
      return send(res, 200, scoreboardJson(b));
    }
    // The user guide (docs/user-guide) at /guide/, from the Help menu and the Docs page: its page and the pictures
    // it shows, nothing else of that folder.
    if (url.pathname === '/guide') { res.writeHead(302, { location: '/guide/' }); return res.end(); }
    if (url.pathname.startsWith('/guide/')) return sendGuide(res, decodeURIComponent(url.pathname.slice('/guide/'.length)));
    // openapi.yaml read for the Devices tab's Links list (devices.js), which has no YAML reader of its own.
    if (url.pathname === '/openapi.json') return send(res, 200, openapiJson());
    // / is the Output page; results.html is the fixture page showing finished games.
    const ALIASES = { '/': 'output.html', '/results.html': 'fixtures.html' };
    // The Graphics page was the home page at /index.html: old links still find it.
    if (url.pathname === '/index.html') { res.writeHead(302, { location: '/graphics.html' + url.search }); return res.end(); }
    let file = path.normalize(path.join(PUBLIC_DIR, ALIASES[url.pathname] || decodeURIComponent(url.pathname)));
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream'));
  } catch (err) {
    log('error', 'http', `${req.method} ${url.pathname}${url.search} failed: ${err.message}`, err.stack ? err.stack.split('\n').slice(1, 4).join(' | ') : undefined);
    send(res, 502, { error: err.message });
  }
}).on('upgrade', (req, socket) => {
  // WebSockets: the scene's live updates for Studio's pages (scene.js). A page on another site gets
  // no socket (it could read the scene and the board through one; there is no CORS check on sockets).
  const url = new URL(req.url, 'http://localhost');
  const refused = access.crossSite('WEBSOCKET', url.pathname, req.headers, PORT, ownHosts());
  if (refused) {
    const from = `${access.strip(req.socket.remoteAddress)} ${req.headers.origin || req.headers.host || ''}`;
    if (!refusedFrom.has(from)) { refusedFrom.add(from); log('warn', 'access', refused); }
    // Node leaves an upgraded socket with no error handler, so one that has already hung up would otherwise throw
    // here and end the helper, taking every graphic off air.
    socket.on('error', () => socket.destroy());
    socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n${refused}`);
    return;
  }
  if (!scene.upgrade(req, socket)) socket.destroy();
}).on('error', err => {
  // Without this Node throws, the helper dies with a stack trace and the Mac app restarts it
  // five times before giving up with a generic message. Say what is wrong instead.
  if (err.code === 'EADDRINUSE') {
    const why = `Port ${PORT} is already in use, so Studio can't start. Another copy of Studio (the app, or npm start) is probably running: quit it, or set another port in config.json.`;
    log('error', 'helper', why);
    console.error(why);
    process.exit(EXIT_PORT_IN_USE);
  }
  log('error', 'helper', `Could not listen on port ${PORT}: ${err.message}`);
  console.error(`Studio can't listen on port ${PORT}: ${err.message}`);
  process.exit(1);
}).listen(PORT, () => {
  log('info', 'helper', `Started on port ${PORT} (links ${LINK_BASE}), Node ${process.version}, competition ${CONFIG.name}, organisation ${playhq.organisation().orgId || '(not set)'} on ${playhq.organisation().tenant}`);
  console.log(`Debug log: ${LOG_FILE}`);
  setTimeout(() => warmTeamLists('start up'), 2000);
  console.log(`FirstPass Studio is running. Open ${LINK_BASE}/ for the Output page.`);
  console.log(`Competition: ${CONFIG.name} (change it at ${LINK_BASE}/setup.html). Leave this window open while streaming.`);
});
