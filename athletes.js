// FirstPass Studio - athletes: team logos, athlete photos, the athlete register and what the
// athletes page shows and edits, plus a team's season squad for short line ups.
//
// A logo belongs to a club (competitions/<id>/logos); a photo to an athlete by name
// (competitions/<id>/photos); the register (competitions/<id>/athletes.json) remembers each athlete's
// teams, divisions, PlayHQ ids and gender, and what was typed in on the athletes page (games played
// "as of" a date, positions). Line ups read from PlayHQ fill the register as they go.
//
// create(deps) gives the register for the competition in use. deps:
//   log(level, source, message)      the debug log
//   config()                         the competition setup in use (CONFIG in server.js)
//   competitions                     competitions.js (images, clubs, the active id)
//   savefile                         savefile.js (atomic writes)
//   playhq                           the PlayHQ client (structureNow, getStructure, readGame, eachLimited,
//                                    PLAYHQ_AT_ONCE, POSITION_RANK)
//   board()                          the scoreboard in use
//   getSeasonGames(grade), getTeamSheets(), setupTeams(opts)   from server.js
//   norm(s), sameTeam(a, b)          name matching, as server.js does it
//   send(res, status, body), readBody(req), readRaw(req, max)   HTTP helpers from server.js
const fs = require('fs');
const path = require('path');
const { isFinished } = require('./playhq');

function create({ log, config, competitions, savefile, playhq, board, getSeasonGames, getTeamSheets, setupTeams, norm, sameTeam, send, readBody, readRaw }) {
  const { getStructure, readGame, eachLimited, PLAYHQ_AT_ONCE, POSITION_RANK } = playhq;

  // ─── Team logos (competitions/<id>/logos) ───────────────────────────────────
  // A logo belongs to the team's club, so every division's team of that club shows it.
  // Matched to the club's (then the team's) name loosely ("Perth Coastal" finds "Perth Coastals.png").
  // A club whose name doesn't match can be given a logo on the competition setup page.
  function logoFor(teamName) {
    const files = competitions.images(competitions.activeId(), 'logos');
    if (!files.length) return null;
    const club = competitions.clubFor(config(), teamName);
    const picked = competitions.clubEntry(config(), club).logo;
    if (picked && files.includes(picked)) return '/logos/' + encodeURIComponent(picked);
    const norm = s => String(s || '').toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]/g, '').replace(/s$/, '');
    for (const want of [norm(club), norm(teamName)]) {
      if (!want) continue;
      const hit = files.find(f => norm(f) === want) || files.find(f => want.includes(norm(f)) || norm(f).includes(want));
      if (hit) return '/logos/' + encodeURIComponent(hit);
    }
    return null;
  }

  // ─── Athlete photos (competitions/<id>/photos) ──────────────────────────────
  // Each photo is named after the athlete ("Jane Smith.jpg"), so the name is the match.
  // Matching ignores case, punctuation and word order ("smith_jane.png" finds Jane Smith,
  // "Noah OBrien.jpg" finds Noah O'Brien).
  // The athletes page (athletes.html) saves photos under the athlete's PlayHQ name.
  const photoKey = s => String(s || '').toLowerCase().replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
  const fileKey = f => photoKey(path.basename(f, path.extname(f)));
  function photoFiles() { return competitions.images(competitions.activeId(), 'photos'); }
  function photoFileFor(name, files = photoFiles()) {
    const want = photoKey(name);
    const hit = want && files.find(f => fileKey(f) === want);
    return hit ? '/photos/' + encodeURIComponent(hit) : null;
  }
  // An athlete's photo goes on a graphic (the stream's and the Socials tab's) only once they have approved its use,
  // ticked on the athletes page (photoOk in the register). Until then graphics show the silhouette.
  const photoApproved = name => !!(athletes()[photoKey(name)] || {}).photoOk;
  function photoFor(name, files = photoFiles()) {
    return photoApproved(name) ? photoFileFor(name, files) : null;
  }
  // A photo file's athlete (its name is theirs) has approved its use.
  const fileApproved = file => !!(athletes()[fileKey(file)] || {}).photoOk;
  // ─── Athlete register (competitions/<id>/athletes.json) ─────────────────────
  // One entry per athlete in the competition, keyed by their name like the photos, so an
  // athlete who plays in more than one division (or team) is one athlete with one photo.
  // It remembers the teams and divisions they've played for, their PlayHQ ids and gender,
  // and a gender set by hand on the athletes page. Filled in as line ups are read.
  let register = { id: null, data: {}, dirty: false };
  function registerFile(id) { return path.join(competitions.DIR, id, 'athletes.json'); }
  function athletes() {
    const id = competitions.activeId();
    if (register.id !== id) {
      let data = {};
      try { data = JSON.parse(fs.readFileSync(registerFile(id), 'utf8')).athletes || {}; } catch { /* none yet */ }
      register = { id, data, dirty: false };
    }
    return register.data;
  }
  function saveRegister() {
    if (!register.dirty || !register.id) return;
    const sorted = Object.fromEntries(Object.keys(register.data).sort().map(k => [k, register.data[k]]));
    try {
      savefile.writeJsonSync(registerFile(register.id), { athletes: sorted });
      register.dirty = false;
    } catch (err) { log('warn', 'athletes', `Could not save athletes.json: ${err.message}`); }
  }
  // Adds a team's line up to the register: a new athlete, a new team or division, a PlayHQ id or gender.
  function recordPlayers(team, division, players) {
    const data = athletes();
    for (const p of players || []) {
      const k = photoKey(p.name);
      if (!k || p.private) continue;
      const before = JSON.stringify(data[k] || null);
      const e = data[k] || (data[k] = { name: p.name });
      if (p.playhqId) e.playhqIds = [...new Set([...(e.playhqIds || []), String(p.playhqId)])].sort();
      if (p.gender) e.playhqGender = p.gender;
      if (team && division) {
        e.teams = e.teams || {};
        e.teams[division] = [...new Set([...(e.teams[division] || []), team])].sort();
      }
      if (JSON.stringify(e) !== before) register.dirty = true;
    }
    saveRegister();
  }
  // The gender of a division, from PlayHQ ('' for mixed or open), once the divisions have been read.
  function divisionGender(division) {
    const st = playhq.structureNow();
    const g = st && st.grades.find(x => norm(x.name) === norm(division));
    return g ? g.gender || '' : '';
  }
  // Where an athlete's silhouette comes from: picked by hand, PlayHQ's player gender, or else the
  // PlayHQ gender of the divisions they play in (a men's or women's division; mixed says nothing).
  function genderInfo(name, fromPlayhq, division) {
    const e = athletes()[photoKey(name)] || {};
    if (e.gender) return { gender: e.gender, genderFrom: 'hand' };
    if (e.playhqGender || fromPlayhq) return { gender: e.playhqGender || fromPlayhq, genderFrom: 'playhq' };
    const found = new Set([...Object.keys(e.teams || {}), division].filter(Boolean).map(divisionGender).filter(Boolean));
    if (found.size === 1) return { gender: [...found][0], genderFrom: 'division' };
    return { gender: '', genderFrom: '' };
  }
  function genderFor(name, fromPlayhq, division) { return genderInfo(name, fromPlayhq, division).gender; }
  // The generic picture for an athlete with no photo.
  function silhouette(gender) { return `/silhouettes/${gender === 'female' || gender === 'male' ? gender : 'neutral'}.svg`; }
  // Every team and division the register has seen the athlete in.
  function athleteTeams(name) {
    const e = athletes()[photoKey(name)] || {};
    return Object.entries(e.teams || {}).flatMap(([division, teams]) => teams.map(team => ({ division, team })))
      .sort((a, b) => a.division.localeCompare(b.division, 'en', { numeric: true }) || a.team.localeCompare(b.team));
  }

  // Adds each player's photo (or silhouette) to a team sheet answer.
  function withPhotos(data) {
    const files = photoFiles();
    for (const side of ['home', 'away']) {
      if (!data[side] || !data[side].players) continue;
      if (!data.stale) recordPlayers(data[side].name, data.division, data[side].players);
      // A new side, not the old one changed: the line-ups are PlayHQ's readings, kept and shared (a finished game's
      // for good), and a gender or photo put on them here would read back as PlayHQ's next time.
      data[side] = { ...data[side] };
      data[side].players = data[side].players.map(p => {
        const gender = genderFor(p.name, p.gender, data.division);
        return { ...p, gender, photo: photoFor(p.name, files), silhouette: silhouette(gender) };
      });
    }
    return data;
  }
  // Saves a photo as "<name>.<ext>", replacing any other photo of the same athlete.
  function savePhoto(name, ext, buf) {
    const id = competitions.activeId();
    const clean = String(name || '').replace(/[^\w .'()&+-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!photoKey(clean)) throw new Error('A photo needs an athlete name.');
    const type = String(ext || '').toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');
    for (const f of photoFiles()) if (fileKey(f) === photoKey(clean)) competitions.deleteImage(id, 'photos', f);
    return competitions.saveImage(id, 'photos', `${clean}.${type}`, buf);
  }

  // Every athlete PlayHQ has listed for one team this season, from the line ups of its
  // finished games and its next game (line ups are often entered before the game).
  // With a division, only that division's team of that name (a club can have one in several).
  async function seasonLineups(teamName, inDivision) {
    const st = await getStructure();
    const want = norm(teamName);
    const games = [];
    let division = '';
    for (const grade of st.grades) {
      if (inDivision && norm(grade.name) !== norm(inDivision)) continue;
      const mine = (await getSeasonGames(grade)).filter(g => norm(g.home.name) === want || norm(g.away.name) === want);
      if (mine.length) division = grade.name;
      const done = mine.filter(isFinished);
      const next = mine.find(g => !isFinished(g));
      games.push(...done, ...(next ? [next] : []));
    }
    const athletes = new Map();
    let read = 0, failed = 0, lastError = '';
    const lineups = await eachLimited(games, PLAYHQ_AT_ONCE, g => readGame(g, 60 * 1000));
    for (const [i, g] of games.entries()) {
      if (lineups[i].error) { failed++; lastError = lineups[i].error.message; continue; }
      const parsed = lineups[i].value;
      read++;
      for (const s of [parsed.home, parsed.away]) recordPlayers(s.name, g.division, s.players);
      const side = norm(parsed.home.name) === want ? parsed.home : norm(parsed.away.name) === want ? parsed.away : null;
      if (!side) continue;
      for (const p of side.players) {
        if (p.private) continue; // "Private player" can't be told apart
        const k = photoKey(p.name);
        const a = athletes.get(k) || { name: p.name, number: '', positions: {}, games: 0, captain: false, lastDate: '', gender: '' };
        a.gender = a.gender || p.gender;
        a.games++;
        if (p.position) a.positions[p.position] = (a.positions[p.position] || 0) + 1;
        if ((g.date || '') >= a.lastDate) { a.lastDate = g.date || ''; if (p.number !== '' && p.number != null) a.number = p.number; }
        a.captain = a.captain || p.captain;
        athletes.set(k, a);
      }
    }
    if (failed) log('warn', 'athletes', `${teamName}: ${failed} of ${games.length} games could not be read: ${lastError}`);
    return { st, athletes, division, games, read, failed, lastError };
  }
  async function getAthletes(teamName, inDivision) {
    const { st, athletes, division, games, read, failed, lastError } = await seasonLineups(teamName, inDivision);
    const files = photoFiles();
    let all = {};
    try { all = await allAppearances(); } catch (err) { log('warn', 'athletes', `Appearances unavailable: ${err.message}`); }
    const rank = a => { const i = POSITION_RANK.indexOf(a.position); return i === -1 ? 99 : i; };
    const list = [...athletes.values()].map(a => {
      const position = Object.entries(a.positions).sort((x, y) => y[1] - x[1])[0];
      const g = genderInfo(a.name, a.gender, division);
      return { name: a.name, number: a.number, position: position ? position[0] : '', positions: Object.keys(a.positions), games: a.games, captain: a.captain,
        photo: photoFileFor(a.name, files), photoOk: photoApproved(a.name), ...g, genderSetByHand: g.genderFrom === 'hand', silhouette: silhouette(g.gender), teams: athleteTeams(a.name),
        ...athleteStats(a.name, all[photoKey(a.name)]) };
    }).sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
    return { team: teamName, logo: logoFor(teamName), division, divisions: st.grades.map(g => g.name), athletes: list, gamesRead: read, gamesFound: games.length,
      error: !read && failed ? lastError : !games.length ? `PlayHQ has no games for ${teamName}${inDivision ? ` in ${inDivision}` : ''} this season.` : undefined };
  }

  // ─── Games and positions played ─────────────────────────────────────────────
  // The athletes page can give an athlete a games played figure per division, and optionally
  // per club, "as of" a date: the games PlayHQ shows in that division (and club) after that
  // date are added on, so the number keeps up through the season. With no date the number is
  // used as it is. Positions played typed in are added to the ones seen in PlayHQ line ups.
  // Both are kept in the athlete register (athletes.json) as `records` and `positions`.
  // A game counts when the athlete is named in that team's line up for a finished game.
  const appearanceCache = new Map();
  async function seasonAppearances(grade) {
    const hit = appearanceCache.get(grade.id);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.map;
    const map = new Map();
    const games = (await getSeasonGames(grade)).filter(isFinished);
    const lineups = await eachLimited(games, PLAYHQ_AT_ONCE, g => readGame(g, 60 * 60 * 1000));
    for (const [i, g] of games.entries()) {
      if (lineups[i].error) { log('warn', 'athletes', `${grade.name}: game ${g.id} could not be read: ${lineups[i].error.message}`); continue; }
      const parsed = lineups[i].value;
      for (const side of [parsed.home, parsed.away]) {
        recordPlayers(side.name, grade.name, side.players);
        for (const p of side.players) {
          if (p.private || !photoKey(p.name)) continue;
          const list = map.get(photoKey(p.name)) || [];
          if (!list.some(a => a.gameId === g.id)) list.push({ gameId: g.id, date: g.date || '', team: side.name, position: p.position });
          map.set(photoKey(p.name), list);
        }
      }
    }
    appearanceCache.set(grade.id, { at: Date.now(), map });
    return map;
  }
  // Every division's appearances, keyed by athlete: { key: { division: [appearance] } }.
  async function allAppearances() {
    const st = await getStructure();
    const out = {};
    for (const grade of st.grades) {
      try {
        for (const [k, list] of await seasonAppearances(grade)) (out[k] = out[k] || {})[grade.name] = list;
      } catch (err) { log('warn', 'athletes', `${grade.name}: appearances unavailable: ${err.message}`); }
    }
    return out;
  }
  // Games played per division for one athlete, from their records and this season's line ups.
  function career(name, apps) {
    const e = athletes()[photoKey(name)] || {};
    const records = e.records || [];
    const divisions = [...new Set([...records.map(r => r.division), ...Object.keys(apps || {})])]
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    return divisions.map(division => {
      const season = (apps && apps[division]) || [];
      const since = r => r.asOf ? season.filter(a => (!r.club || sameTeam(a.team, r.club)) && a.date > r.asOf).length : 0;
      const lines = records.filter(r => r.division === division).map(r => ({ ...r, since: since(r), total: r.games + since(r) }));
      const whole = lines.filter(l => !l.club).sort((a, b) => (b.asOf || '').localeCompare(a.asOf || ''))[0];
      // No record for the whole division: add up the club records, plus this season's games for other clubs.
      const total = whole ? whole.total : lines.reduce((n, l) => n + l.total, 0) + season.filter(a => !lines.some(l => sameTeam(l.club, a.team))).length;
      return { division, total, season: season.length, lines };
    });
  }
  // The games played to show for an athlete in a division, for a club when they have a record for it.
  function gamesIn(name, apps, division, club) {
    const d = career(name, apps).find(c => c.division === division);
    if (!d) return 0;
    const line = club && d.lines.find(l => l.club && sameTeam(l.club, club));
    return line ? line.total : d.total;
  }
  function positionsPlayed(name, apps) {
    const e = athletes()[photoKey(name)] || {};
    const seen = Object.values(apps || {}).flat().map(a => a.position);
    return POSITION_RANK.filter(p => (e.positions || []).includes(p) || seen.includes(p));
  }
  // What the athletes page shows and edits for one athlete.
  function athleteStats(name, apps) {
    const e = athletes()[photoKey(name)] || {};
    return { career: career(name, apps), positionsPlayed: positionsPlayed(name, apps), positionsTyped: e.positions || [], records: e.records || [] };
  }
  function cleanRecords(list) {
    return (Array.isArray(list) ? list : []).map(r => {
      const division = String(r.division || '').trim();
      const games = Math.round(Number(r.games));
      const asOf = String(r.asOf || '').trim();
      if (!division) throw new Error('Each games played line needs a division.');
      if (!Number.isFinite(games) || games < 0) throw new Error(`Games played for ${division} must be 0 or more.`);
      if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`"${asOf}" isn't a date (YYYY-MM-DD).`);
      const out = { division, games };
      if (String(r.club || '').trim()) out.club = String(r.club).trim();
      if (asOf) out.asOf = asOf;
      return out;
    });
  }

  async function athletesRoute(req, res, url, q) {
    const id = competitions.activeId();
    if (url.pathname === '/api/athletes/photo') {
      if (req.method === 'POST') {
        const buf = await readRaw(req, 15 * 1024 * 1024);
        if (!buf.length) throw new Error('That file is empty.');
        // ?athlete= saves it under that athlete's name; ?file= keeps the file's own name (several dropped at once).
        const ext = path.extname(q.file || '') || ('.' + (q.ext || 'jpg'));
        const name = savePhoto(q.athlete || path.basename(q.file || '', path.extname(q.file || '')), ext, buf);
        log('info', 'athletes', `${id}: photo ${name} saved`);
        return send(res, 200, { name, url: '/photos/' + encodeURIComponent(name) });
      }
      if (req.method === 'DELETE') {
        competitions.deleteImage(id, 'photos', q.file);
        log('info', 'athletes', `${id}: photo ${q.file} removed`);
        return send(res, 200, { ok: true });
      }
    }
    if (url.pathname === '/api/athletes/rename' && req.method === 'POST') {
      const body = await readBody(req);
      const clean = String(body.athlete || '').replace(/[^\w .'()&+-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!photoKey(clean)) throw new Error('Pick an athlete for this photo.');
      for (const f of photoFiles()) if (f !== body.file && fileKey(f) === photoKey(clean)) competitions.deleteImage(id, 'photos', f);
      const name = competitions.renameImage(id, 'photos', body.file, clean + path.extname(String(body.file || '')).toLowerCase());
      log('info', 'athletes', `${id}: photo ${body.file} is now ${name}`);
      return send(res, 200, { name, url: '/photos/' + encodeURIComponent(name) });
    }
    // A gender set by hand, for the silhouette ('' goes back to PlayHQ's).
    if (url.pathname === '/api/athletes/gender' && req.method === 'POST') {
      const body = await readBody(req);
      const k = photoKey(body.athlete);
      if (!k) throw new Error('Which athlete?');
      const data = athletes();
      const e = data[k] || (data[k] = { name: String(body.athlete).trim() });
      if (body.gender === 'female' || body.gender === 'male') e.gender = body.gender; else delete e.gender;
      register.dirty = true;
      saveRegister();
      log('info', 'athletes', `${id}: ${e.name} gender ${e.gender || 'from PlayHQ'}`);
      const g = genderInfo(e.name);
      return send(res, 200, { name: e.name, ...g, genderSetByHand: g.genderFrom === 'hand', silhouette: silhouette(g.gender) });
    }
    // Whether each athlete has approved the use of their photo: { athletes: [names], approved: bool }.
    if (url.pathname === '/api/athletes/approval' && req.method === 'POST') {
      const body = await readBody(req);
      const names = (Array.isArray(body.athletes) ? body.athletes : [body.athlete]).map(n => String(n || '').trim()).filter(n => photoKey(n));
      if (!names.length) return send(res, 400, { error: 'Which athlete?' });
      if (typeof body.approved !== 'boolean') return send(res, 400, { error: 'Approved or not?' });
      const data = athletes();
      for (const name of names) {
        const e = data[photoKey(name)] || (data[photoKey(name)] = { name });
        if (body.approved) e.photoOk = true; else delete e.photoOk;
      }
      register.dirty = true;
      saveRegister();
      log('info', 'athletes', `${id}: photo use ${body.approved ? 'approved' : 'not approved'} for ${names.join(', ')}`);
      return send(res, 200, { athletes: names.map(name => ({ name, photoOk: body.approved })) });
    }
    // Games played and positions played, typed in on the athletes page.
    if (url.pathname === '/api/athletes/stats' && req.method === 'POST') {
      const body = await readBody(req);
      const k = photoKey(body.athlete);
      if (!k) throw new Error('Which athlete?');
      const records = cleanRecords(body.records);
      const positions = POSITION_RANK.filter(p => (body.positions || []).includes(p));
      const data = athletes();
      const e = data[k] || (data[k] = { name: String(body.athlete).trim() });
      if (records.length) e.records = records; else delete e.records;
      if (positions.length) e.positions = positions; else delete e.positions;
      register.dirty = true;
      saveRegister();
      log('info', 'athletes', `${id}: ${e.name} games/positions saved`, { records, positions });
      let apps = {};
      try { apps = (await allAppearances())[k] || {}; } catch (err) { log('warn', 'athletes', `Appearances unavailable: ${err.message}`); }
      return send(res, 200, { name: e.name, ...athleteStats(e.name, apps) });
    }
    // Games played by both line ups of the game on a board, for the graphics.
    if (url.pathname === '/api/athletes/games') {
      const b = board();
      const all = await allAppearances();
      const out = { division: b.division };
      let sheets = { home: { players: [] }, away: { players: [] } };
      try { sheets = await getTeamSheets(); } catch { /* none */ }
      for (const side of ['home', 'away']) {
        out[side] = Object.fromEntries((sheets[side].players || []).map(p =>
          [p.name, { games: gamesIn(p.name, all[photoKey(p.name)], b.division, b[side].name), positions: positionsPlayed(p.name, all[photoKey(p.name)]) }]));
      }
      return send(res, 200, out);
    }
    if (url.pathname !== '/api/athletes') return send(res, 404, { error: 'Unknown athletes link' });
    // Every athlete seen so far in the competition, across all its divisions.
    if (q.all) {
      let all = {};
      try { all = await allAppearances(); } catch (err) { log('warn', 'athletes', `Appearances unavailable: ${err.message}`); }
      const files = photoFiles();
      const list = Object.values(athletes()).map(e => {
        const g = genderInfo(e.name);
        return { name: e.name, ...g, genderSetByHand: g.genderFrom === 'hand', photo: photoFileFor(e.name, files), photoOk: !!e.photoOk, silhouette: silhouette(g.gender), teams: athleteTeams(e.name),
          ...athleteStats(e.name, all[photoKey(e.name)]) };
      }).sort((a, b) => a.name.localeCompare(b.name));
      return send(res, 200, { athletes: list });
    }
    if (q.team) return send(res, 200, await getAthletes(q.team, q.division));
    const list = { folder: `competitions/${id}/photos`, photos: photoFiles().map(f => ({ file: f, url: '/photos/' + encodeURIComponent(f) })) };
    if (q.photos === 'only') return send(res, 200, list);
    // The teams to pick from, the two in the game on the control page, and every photo saved.
    const b = board();
    let teams = [], error;
    try { teams = (await setupTeams({ byDivision: true })).teams.map(t => ({ name: t.name, division: t.division, logo: t.logo })); } catch (err) { error = err.message; }
    return send(res, 200, { competition: config().name, teams, currentDivision: b.division || '', current: [b.home.name, b.away.name].filter(n => n && n !== 'TBC' && !/^home$|^away$/i.test(n)),
      ...list, error });
  }

  // A team's club colour from the competition setup page, or null to use the competition's colours.
  function colourFor(teamName) {
    return competitions.clubEntry(config(), competitions.clubFor(config(), teamName)).colour || null;
  }

  // A line up with fewer than seven players isn't complete (benches often clear it and only
  // add players as they score): the rest of the team's season squad (everyone in its line ups
  // this season) is added after them, without positions, and marked fromSquad.
  const FULL_LINEUP = 7;
  const squadCache = new Map();
  const squadInFlight = new Map();
  async function squadFor(teamName, division) {
    const k = `${norm(division)}|${norm(teamName)}`;
    const hit = squadCache.get(k);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.list;
    if (!squadInFlight.has(k)) {
      squadInFlight.set(k, seasonLineups(teamName, division).then(({ athletes }) => {
        const list = [...athletes.values()].map(a => ({ name: a.name, number: a.number, gender: a.gender }));
        squadCache.set(k, { at: Date.now(), list });
        return list;
      }).finally(() => squadInFlight.delete(k)));
    }
    return squadInFlight.get(k);
  }
  async function withSquad(side, division) {
    if (!side.name || side.players.length >= FULL_LINEUP) return side;
    let squad = [];
    try { squad = await squadFor(side.name, division); } catch (err) { log('warn', 'teams', `${side.name}: squad unavailable: ${err.message}`); }
    const listed = new Set(side.players.map(p => photoKey(p.name)));
    const rest = squad.filter(a => !listed.has(photoKey(a.name))).map(a => ({ name: a.name, number: a.number || '', playhqId: '', gender: a.gender || '',
      position: '', private: false, captain: false, viceCaptain: false, shooting: { goals: 0, superGoals: 0, shots: null, points: 0 }, fromSquad: true }))
      .sort((x, y) => x.name.localeCompare(y.name));
    if (!rest.length) return side;
    const key = `${side.name}|${side.players.length}|${rest.length}`;
    if (!squadLogged.has(key)) { squadLogged.add(key); log('info', 'teams', `${side.name}: line up has ${side.players.length} players, adding ${rest.length} more from the season squad`); }
    return { ...side, players: [...side.players, ...rest], squad: true };
  }
  const squadLogged = new Set();

  // A competition switch: the season's line ups are read again.
  function resetCaches() { appearanceCache.clear(); }

  return { logoFor, colourFor, photoFor, photoFileFor, photoApproved, fileApproved, photoKey, genderInfo, silhouette, athleteTeams, athletes, withPhotos, withSquad, squadFor, athletesRoute, resetCaches };
}

module.exports = { create };
