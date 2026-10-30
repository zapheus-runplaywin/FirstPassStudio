// FirstPass Studio - the person lower third (lowerthird.html): an athlete found in the athlete register by
// name, with their team, its club logo and their photo, and the athletes the Output page suggests for it.
//
// create(deps). deps:
//   log(level, source, message)   the debug log
//   board()                       the scoreboard in use (the game's two teams)
//   playhq                        the PlayHQ client (structureNow, for the season's divisions)
//   competitionName(), rules()    from games.js (the competition's logos)
//   athletes(), photoKey(name), athleteTeams(name), genderInfo(name), photoFor(name), silhouette(gender), logoFor(team)   from athletes.js
//   norm(s), sameTeam(a, b)       name matching, as server.js does it

function create({ log, board, playhq, competitionName, rules, athletes, photoKey, athleteTeams, genderInfo, photoFor, silhouette, logoFor, norm, sameTeam }) {
  // The person lower third (lowerthird.html). An athlete is found in the athlete register by name (case,
  // punctuation and word order don't matter, like the photos): their team, its club logo and their photo.
  // ?team= picks the team for an athlete in more than one; otherwise one of the game's two teams if they
  // play for it, else the first the register has. A guest or commentator needs nothing from here but the
  // competition's logos, which every answer carries (commentators.html's box reads them with ?type=guest).
  function getLowerThird(q) {
    const r = rules();
    const out = { competition: competitionName(), competitionLogoLight: r.competitionLogoLight, competitionLogoDark: r.competitionLogoDark };
    if (q.type === 'guest' || !String(q.name || '').trim()) return out;
    const e = athletes()[photoKey(q.name)];
    const name = (e && e.name) || String(q.name).trim();
    const teams = athleteTeams(name);
    const b = board();
    const playing = [b.home.name, b.away.name];
    const pick = (q.team && (teams.find(t => sameTeam(t.team, q.team)) || { team: String(q.team).trim(), division: '' })) ||
      teams.find(t => playing.some(n => sameTeam(n, t.team)) && (!b.division || t.division === b.division)) ||
      teams.find(t => playing.some(n => sameTeam(n, t.team))) || teams[0] || null;
    if (!e) log('info', 'lowerthird', `${name} is not in the athlete register yet (it fills as line ups are read)`);
    const g = genderInfo(name);
    out.athlete = { name, known: !!e, team: pick ? pick.team : '', division: pick ? pick.division : '', logo: pick ? logoFor(pick.team) : null,
      photo: photoFor(name), silhouette: silhouette(g.gender) };
    return out;
  }

  // The athletes the Output page suggests for the person lower third: only the active competition's, and
  // of those only athletes seen in a division of its current PlayHQ season (an athlete left in the register
  // from an earlier season isn't offered). Each has their teams, so the page can narrow them to one team or
  // to the two teams in the game picked on the control page. Nothing here asks PlayHQ.
  function getLowerThirdAthletes() {
    const divisions = new Set(((playhq.structureNow() || {}).grades || []).map(g => norm(g.name)));
    let list = Object.values(athletes()).map(e => ({ name: e.name, teams: athleteTeams(e.name) })).filter(a => a.teams.length);
    const current = list.filter(a => a.teams.some(t => divisions.has(norm(t.division))));
    if (current.length) list = current.map(a => ({ ...a, teams: a.teams.filter(t => divisions.has(norm(t.division))) }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    const teams = [];
    for (const a of list) for (const t of a.teams) if (!teams.some(x => x.team === t.team && x.division === t.division)) teams.push(t);
    teams.sort((a, b) => a.team.localeCompare(b.team) || a.division.localeCompare(b.division, 'en', { numeric: true }));
    const b = board();
    const game = [b.home.name, b.away.name].filter(n => n && n !== 'TBC' && !/^home$|^away$/i.test(n));
    return { competition: competitionName(), game: { teams: game, division: b.division || '' }, teams, athletes: list };
  }

  return { getLowerThird, getLowerThirdAthletes };
}

module.exports = { create };
