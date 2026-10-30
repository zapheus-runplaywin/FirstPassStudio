// FirstPass Studio - the Production Planner (planner.html): the court Studio streams each game night and who
// commentates each game on it.
//
// A competition keeps its own plan in competitions/<id>/planner.json:
//   pool    the commentators to choose from: { id, name, guest, headshot } (guest: a special guest commentator; headshot:
//           their photo's file in competitions/<id>/headshots, served at /headshots/, for the Socials tab's Commentary team)
//   nights  by date (YYYY-MM-DD): { court, slots: { "HH:MM": { people: [id, ...], game: { id, home, away } } } }
// The fixture board (fixtureboard.html, fixtureBoard()) shows a night's whole fixture in the competition room or
// backstage: the streamed court marked, who is on the mic for its games, and each game's state and score.
// Studio streams one court a night (another court is another Mac running its own Studio), so a night's
// timeslots are its games on that court, read from the PlayHQ fixture every time. The commentators belong to
// the timeslot, not the game: the desk and cameras are set up at the court, so when PlayHQ moves a game to
// another court or date, the people stay in the slot, and the slot is flagged "fixture changed" (the game
// saved with it is no longer the one there) until the night is saved again.
//
// A night that hasn't been planned takes the plan of the last planned night before it: the same court, and the
// same people in each slot, first game to first game. So a season that has the same team each week is planned
// once, and only the nights that differ need changing.
//
// When a night with a plan arrives (today, or the game night picked by hand on Scoreboard control), Studio sets
// Scoreboard control's court to the plan's (games.js autoPick asks courtFor()), once a night and again if the
// plan's court changes. Changing the court there, or picking a game by hand, is never undone by the plan:
// the Planner flags it instead, so the commentary team can be moved to match.
//
// create(deps). deps:
//   log(level, source, message)      the debug log
//   competitions, savefile           competitions.js and savefile.js
//   getStructure(), getSeasonGames(grade)   the season's divisions and each one's games (playhq.js, games.js)
//   board()                          the scoreboard in use
//   sameCourt(court, wanted)         court name matching, as automatic game selection does it (games.js)
//   night()                          the game night picked by hand on Scoreboard control, or ''
//   about()                          { competition, venue } for the fixture board, and logoFor(teamName)
//   withLiveScores(games, maxAgeMs), isLive(game)   live scores the ticker's way (games.js)

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { localDate, isFinished } = require('./playhq');

const MAX_PEOPLE = 3; // commentators in one timeslot
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const slotOf = g => String(g.time || '').slice(0, 5);
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

function create({ log, competitions, savefile, getStructure, getSeasonGames, board, sameCourt, night: pickedNight, about = () => ({}), logoFor = () => null,
  withLiveScores = async g => g, isLive = () => false }) {
  const fileOf = id => path.join(competitions.DIR, id, 'planner.json');
  function read(id) {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { /* no plan yet */ }
    return { pool: Array.isArray(d.pool) ? d.pool : [], nights: d.nights && typeof d.nights === 'object' ? d.nights : {} };
  }
  const active = () => competitions.activeId();
  const plan = () => (active() ? read(active()) : { pool: [], nights: {} });
  function write(p) {
    const id = active();
    if (!id) throw new Error('Set up a competition first, on the Competitions setup page.');
    const nights = Object.fromEntries(Object.keys(p.nights).sort().map(k => [k, p.nights[k]]));
    savefile.writeJsonSync(fileOf(id), { pool: p.pool, nights });
  }

  // Every game of the season by date: { date: [game, ...] } in time order.
  async function byDate() {
    const out = {};
    for (const grade of (await getStructure()).grades) {
      for (const g of await getSeasonGames(grade)) if (isDate(g.date)) (out[g.date] = out[g.date] || []).push(g);
    }
    for (const list of Object.values(out)) list.sort((a, b) => slotOf(a).localeCompare(slotOf(b)) || String(a.court || '').localeCompare(String(b.court || ''), 'en', { numeric: true }));
    return out;
  }
  const brief = g => ({ id: g.id, home: g.home.name, away: g.away.name, division: g.division || '', round: g.round || '', court: g.court || '', time: slotOf(g) });

  // A night's plan: its own, or the last planned night's before it (from: that night's date), or null.
  // An inherited plan keeps the court, and the people slot by slot in time order.
  function planFor(p, date, games) {
    if (p.nights[date]) return { ...p.nights[date], from: '' };
    const before = Object.keys(p.nights).filter(d => d < date).sort().pop();
    if (!before) return null;
    const prev = p.nights[before];
    const theirs = Object.keys(prev.slots || {}).sort().map(k => prev.slots[k].people || []);
    const mine = [...new Set((games || []).filter(g => sameCourt(g.court, prev.court)).map(slotOf))].sort();
    return { court: prev.court, slots: Object.fromEntries(mine.map((t, i) => [t, { people: theirs[i] || [] }])), from: before };
  }

  // One night for the Planner: its courts, its plan and each timeslot on the planned court, with what to check.
  function nightView(p, date, games) {
    const courts = [...new Set(games.map(g => g.court).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const pl = planFor(p, date, games);
    const court = pl ? pl.court : '';
    const onCourt = court ? games.filter(g => sameCourt(g.court, court)) : [];
    const saved = (pl && pl.slots) || {};
    const slots = [];
    for (const g of onCourt) {
      const time = slotOf(g);
      if (slots.some(s => s.time === time)) continue; // two divisions can't share a court and a time; keep the first
      const s = saved[time] || {};
      const changed = !pl.from && s.game && s.game.id !== g.id ? { was: `${s.game.home} v ${s.game.away}` } : null;
      slots.push({ time, game: brief(g), people: s.people || [], ...(changed ? { changed } : {}) });
    }
    // People planned in a slot that has no game on the court any more (moved to another time, court or night).
    for (const [time, s] of Object.entries(saved)) {
      if (!slots.some(x => x.time === time) && (s.people || []).length) slots.push({ time, game: null, people: s.people, changed: { was: s.game ? `${s.game.home} v ${s.game.away}` : 'a game' } });
    }
    slots.sort((a, b) => a.time.localeCompare(b.time));
    return { date, courts, court, planned: !!pl && !pl.from, from: pl ? pl.from : '', slots,
      games: games.map(brief) };
  }

  // The plan's court for a night, for automatic game selection (games.js): { court, key } or null.
  // key changes when the plan does, so the court is set again then and only then.
  async function courtFor(date) {
    if (!active() || !isDate(date)) return null;
    const p = plan();
    if (!Object.keys(p.nights).length) return null;
    const games = (await byDate())[date] || [];
    if (!games.length) return null;
    const pl = planFor(p, date, games);
    return pl && pl.court ? { court: pl.court, key: `${active()}|${date}|${pl.court}` } : null;
  }

  // Who is on the mic for the game on the scoreboard: its timeslot on its night's plan (or, when PlayHQ moved
  // the game, the slot it was planned in). names in the slot's order; guest when every one is a special guest.
  async function onAir() {
    const b = board();
    const p = plan();
    const none = { names: [], people: [], gameId: b.gameId || '', game: b.gameId ? `${b.home.name} v ${b.away.name}` : '' };
    if (!b.gameId || !isDate(b.date) || !Object.keys(p.nights).length) return none;
    const games = (await byDate().catch(() => ({})))[b.date] || [];
    const pl = planFor(p, b.date, games);
    if (!pl) return none;
    const slots = pl.slots || {};
    let slot = Object.values(slots).find(s => s.game && s.game.id === b.gameId);
    if (!slot && sameCourt(b.court, pl.court)) slot = slots[slotOf(b)];
    const people = ((slot && slot.people) || []).map(id => p.pool.find(x => x.id === id)).filter(Boolean);
    return { ...none, names: people.map(x => x.name), people: people.map(x => ({ name: x.name, guest: !!x.guest })),
      guest: people.length > 0 && people.every(x => x.guest), court: pl.court, time: slotOf(b) };
  }

  // What the Planner flags about tonight: Scoreboard control following another court, or a game picked by hand
  // that isn't in the plan, so the commentary team can be moved to match. Tonight is the game night picked by hand,
  // else today.
  async function tonight(nights) {
    const b = board();
    const date = pickedNight() || localDate();
    const n = nights.find(x => x.date === date);
    const flags = [];
    if (!n || !n.court) return { date, flags };
    if (b.autoCourt && !sameCourt(b.autoCourt, n.court)) flags.push({ kind: 'court', text: `Scoreboard control is following ${b.autoCourt}, but the plan for tonight is ${n.court}.` });
    else if (!b.autoCourt) flags.push({ kind: 'court', text: `Scoreboard control has no court set, but the plan for tonight is ${n.court}.` });
    if (b.gameId && b.date === date && !n.slots.some(s => s.game && s.game.id === b.gameId)) {
      flags.push({ kind: 'game', text: `${b.home.name} v ${b.away.name} (${b.court || 'no court'}, ${slotOf(b) || 'no time'}) is on the scoreboard${b.autoSelect ? '' : ', picked by hand'}, and it isn't in tonight's plan.` });
    } else if (b.gameId && !b.autoSelect) flags.push({ kind: 'manual', text: `${b.home.name} v ${b.away.name} was picked by hand on Scoreboard control, so the scoreboard won't move on to the next game by itself.` });
    return { date, flags };
  }

  // The night's whole fixture for the fixture board (fixtureboard.html, a screen in the competition room or backstage):
  // every game of the night by time and court, the planned court marked streamed with who is on the mic for its
  // games, and each game's state and score. The night is ?date=, else the game night picked by hand on Scoreboard
  // control, else today when it is a game night, else the next one.
  //   state  'done'  PlayHQ has its result, or (streamed court) the scoreboard has moved on past it
  //          'live'  being played: the game on the scoreboard once it has started, or PlayHQ says in progress
  //          'next'  the rest
  //   score  { home, away }: the scoreboard's for the game on it; live scores for the other games through the same
  //          reader and cache as the ticker (games.js withLiveScores), so the board adds no PlayHQ requests while the
  //          ticker is reading and at most one a minute per live game when it isn't; PlayHQ's result when done, else
  //          the score the scoreboard had when it moved on (board.js lastGame)
  //   winner 'home', 'away' or 'draw' for a done game with a score
  const BOARD_LIVE_MS = 60 * 1000;
  async function fixtureBoard(q = {}) {
    const p = plan();
    const dates = await byDate();
    const all = Object.keys(dates).sort();
    const today = localDate();
    const date = isDate(q.date) ? q.date : pickedNight() || (dates[today] ? today : all.find(d => d >= today) || all[all.length - 1] || today);
    const games = (dates[date] || []).map(g => ({ ...g, home: { ...g.home }, away: { ...g.away } }));
    const n = nightView(p, date, games);
    const b = board();
    const name = id => p.pool.find(x => x.id === id);
    const streamed = g => !!n.court && sameCourt(g.court, n.court);
    const onBoard = g => !!b.gameId && g.id === b.gameId;
    const boardAt = b.gameId && games.find(onBoard) ? slotOf(games.find(onBoard)) : '';
    await withLiveScores(games.filter(g => !onBoard(g) && !isFinished(g)), BOARD_LIVE_MS);
    const out = games.map(g => {
      const final = isFinished(g) && g.home.score != null && g.away.score != null;
      let state = final ? 'done' : isLive(g) ? 'live' : 'next';
      let score = final || state === 'live' ? (g.home.score != null ? { home: g.home.score, away: g.away.score } : null) : null;
      let period = state === 'live' ? g.period || '' : '';
      if (onBoard(g)) {
        const started = b.home.score > 0 || b.away.score > 0 || b.period > 1 || (b.clock && (b.clock.running || b.clock.elapsedMs > 0)) || isLive(g);
        if (!final && started) { state = 'live'; score = { home: b.home.score, away: b.away.score }; period = `${b.periodLabel || 'Q'}${b.period || 1}`; }
      } else if (streamed(g) && boardAt && slotOf(g) < boardAt && state !== 'done') {
        state = 'done';
        if (b.lastGame && b.lastGame.id === g.id) score = { home: b.lastGame.home.score, away: b.lastGame.away.score };
      }
      const slot = streamed(g) ? n.slots.find(x => x.game && x.game.id === g.id) : null;
      const winner = state === 'done' && score ? (score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'draw') : '';
      return { id: g.id, time: slotOf(g), court: g.court || '', division: g.division || '', round: g.round || '',
        home: { name: g.home.name, logo: logoFor(g.home.name) }, away: { name: g.away.name, logo: logoFor(g.away.name) },
        streamed: streamed(g), onAir: onBoard(g), people: slot ? slot.people.map(name).filter(Boolean).map(x => ({ name: x.name, guest: !!x.guest })) : [],
        state, score, winner, ...(period ? { period } : {}) };
    });
    const times = [...new Set(out.map(g => g.time))].sort();
    const a = about();
    return { competition: a.competition || '', venue: a.venue || '', date, today: date === today, court: n.court, courts: n.courts,
      slots: times.map(time => ({ time, games: out.filter(g => g.time === time) })),
      ...(!games.length ? { error: `No games on ${date}` } : {}) };
  }

  // The court Studio streams on a night and who calls each game there, for the Socials tab's On the stream picture:
  // { court, slots: [{ id, time, division, home, away, people }] }, or null when the night isn't planned. The fixture
  // only, no live scores, so it asks PlayHQ for nothing.
  async function onStream(date) {
    const n = nightView(plan(), date, (await byDate())[date] || []);
    if (!n.court) return null;
    const p = plan();
    const name = id => p.pool.find(x => x.id === id);
    return { court: n.court, slots: n.slots.filter(s => s.game).map(s => ({ id: s.game.id, time: s.time, division: s.game.division,
      home: { name: s.game.home, logo: logoFor(s.game.home) }, away: { name: s.game.away, logo: logoFor(s.game.away) },
      people: s.people.map(name).filter(Boolean).map(x => ({ name: x.name, guest: !!x.guest, headshot: headshotUrl(x.headshot) })) })) };
  }

  // Everything the Planner page shows.
  async function view() {
    const p = plan();
    const dates = await byDate();
    const nights = Object.keys(dates).sort().map(d => nightView(p, d, dates[d]));
    const today = localDate();
    const next = (nights.find(n => n.date >= today) || nights[nights.length - 1] || {}).date || '';
    const others = [];
    for (const c of competitions.list()) {
      if (c.id === active()) continue;
      for (const x of read(c.id).pool) if (!others.some(o => o.name.toLowerCase() === x.name.toLowerCase())) others.push({ name: x.name, guest: !!x.guest, from: c.name });
    }
    return { pool: p.pool.map(x => ({ ...x, headshotUrl: headshotUrl(x.headshot) })), others, nights, today, next, maxPeople: MAX_PEOPLE, tonight: await tonight(nights), onAir: await onAir() };
  }

  // The pool, as the page sends it: [{ id?, name, guest }]. A new person gets an id; someone taken out of the
  // pool comes out of every night's slots too.
  function setPool(list) {
    const p = plan();
    const pool = [];
    for (const x of Array.isArray(list) ? list : []) {
      const name = cleanName(x && x.name);
      if (!name || pool.some(o => o.name.toLowerCase() === name.toLowerCase())) continue;
      const id = x.id && p.pool.some(o => o.id === x.id) ? x.id : crypto.randomBytes(5).toString('hex');
      const had = p.pool.find(o => o.id === id);
      pool.push({ id, name, guest: !!x.guest, ...(had && had.headshot ? { headshot: had.headshot } : {}) });
    }
    const ids = new Set(pool.map(x => x.id));
    for (const n of Object.values(p.nights)) for (const s of Object.values(n.slots || {})) s.people = (s.people || []).filter(id => ids.has(id));
    const gone = p.pool.filter(x => !ids.has(x.id)).map(x => x.name);
    for (const x of p.pool) if (!ids.has(x.id) && x.headshot) dropHeadshot(x.headshot);
    p.pool = pool;
    write(p);
    log('info', 'planner', `Commentator pool saved: ${pool.length} ${pool.length === 1 ? 'person' : 'people'}${gone.length ? `, took out ${gone.join(', ')}` : ''}`);
    return p.pool;
  }

  // A commentator's headshot: saved as <their id>.<ext> in the competition's headshots folder (replacing any before).
  const headshotUrl = f => (f ? '/headshots/' + encodeURIComponent(f) : null);
  function dropHeadshot(file) { try { competitions.deleteImage(active(), 'headshots', file); } catch (err) { log('warn', 'planner', `Couldn't remove headshot ${file}: ${err.message}`); } }
  function setHeadshot(id, ext, buf) {
    const p = plan();
    const x = p.pool.find(o => o.id === id);
    if (!x) throw new Error('Add the commentator first.');
    const type = String(ext || '').toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');
    if (!['jpg', 'png', 'webp'].includes(type)) throw new Error('A headshot needs to be a JPEG, PNG or WebP photo.');
    const file = competitions.saveImage(active(), 'headshots', `${id}.${type}`, buf);
    if (x.headshot && x.headshot !== file) dropHeadshot(x.headshot);
    x.headshot = file;
    write(p);
    log('info', 'planner', `Headshot saved for ${x.name}`);
  }
  function removeHeadshot(id) {
    const p = plan();
    const x = p.pool.find(o => o.id === id);
    if (!x || !x.headshot) return;
    dropHeadshot(x.headshot);
    delete x.headshot;
    write(p);
    log('info', 'planner', `Headshot removed for ${x.name}`);
  }

  // A night, as the page sends it: { date, court, slots: { "HH:MM": [id, ...] } }, or { date, clear: true } to go back
  // to the plan of the night before. Each slot keeps the game on it now, to notice when PlayHQ changes it.
  async function setNight(body) {
    const date = String(body && body.date || '');
    if (!isDate(date)) throw new Error('Which night? Send its date as YYYY-MM-DD.');
    const p = plan();
    if (body.clear) {
      delete p.nights[date];
      write(p);
      log('info', 'planner', `Plan for ${date} cleared: it takes the plan of the night before`);
      return;
    }
    const court = cleanName(body.court);
    if (!court) throw new Error('Pick the court Studio streams that night.');
    const games = ((await byDate())[date] || []).filter(g => sameCourt(g.court, court));
    const ids = new Set(p.pool.map(x => x.id));
    const slots = {};
    for (const [time, list] of Object.entries(body.slots || {})) {
      if (!/^\d{2}:\d{2}$/.test(time)) continue;
      const people = [...new Set((Array.isArray(list) ? list : []).filter(id => ids.has(id)))].slice(0, MAX_PEOPLE);
      const g = games.find(x => slotOf(x) === time);
      slots[time] = { people, ...(g ? { game: { id: g.id, home: g.home.name, away: g.away.name } } : {}) };
    }
    p.nights[date] = { court, slots };
    write(p);
    const names = id => (p.pool.find(x => x.id === id) || {}).name;
    log('info', 'planner', `Plan for ${date} saved: ${court}; ${Object.entries(slots).map(([t, s]) => `${t} ${s.people.map(names).join(', ') || 'nobody'}`).join('; ') || 'no games'}`);
  }

  async function route(req, res, url, { send, readBody, readRaw, changed }) {
    if (url.pathname === '/api/planner/onair') return send(res, 200, await onAir()), true;
    if (url.pathname === '/api/planner/fixtureboard') return send(res, 200, await fixtureBoard(Object.fromEntries(url.searchParams))), true;
    if (url.pathname === '/api/planner' && req.method === 'GET') return send(res, 200, await view()), true;
    if (url.pathname === '/api/planner/headshot' && req.method === 'DELETE') {
      removeHeadshot(url.searchParams.get('id'));
      return send(res, 200, await view()), true;
    }
    if (req.method !== 'POST') return false;
    try {
      if (url.pathname === '/api/planner/headshot') {
        setHeadshot(url.searchParams.get('id'), url.searchParams.get('ext'), await readRaw(req, 15 * 1024 * 1024));
        return send(res, 200, await view()), true;
      }
      if (url.pathname === '/api/planner/pool') setPool((await readBody(req)).pool);
      else if (url.pathname === '/api/planner/night') await setNight(await readBody(req));
      else return false;
    } catch (err) { return send(res, 400, { error: err.message }), true; }
    await changed();
    return send(res, 200, await view()), true;
  }

  return { route, view, onAir, fixtureBoard, onStream, courtFor, setPool, setNight, byDate, MAX_PEOPLE };
}

module.exports = { create };
