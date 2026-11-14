// FirstPass Studio - the shooting stats' script (shooting.html loads it as a module, so its names stay its own).

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
sponsorSpot.footer('stats');

const params = new URLSearchParams(location.search);
const BREAKS: Record<number, string> = { 1: 'Quarter time', 2: 'Half time', 3: 'Three quarter time', 4: 'Full time', 5: 'Extra time' };
const HALF_BREAKS: Record<number, string> = { 1: 'Half time', 2: 'Full time', 5: 'Extra time' };
let supers = true; // the Super column, when the competition plays super shots
const pct = (g: number, a: number | null | undefined) => (a ? `${Math.round((g / a) * 100)}%` : '–');

// A side's shooting from FirstPass instead of PlayHQ: the named shooters (only athletes HQ allows) and the team's
// totals, which count everyone. FirstPass doesn't tell super shots apart, so that column shows a dash.
type ShootingSide = SheetSide & { firstPass?: boolean };
function fromFirstPass(team: SheetSide, fp: FirstPassOnAir): ShootingSide {
  return {
    ...team, firstPass: true,
    players: fp.shooting.players.map(p => ({ name: p.name, number: null, position: p.positions.join('/'), shooting: { goals: p.goals, superGoals: 0, shots: p.shots, points: p.goals } })),
    totals: { goals: fp.shooting.team.goals, superGoals: 0, shots: fp.shooting.team.shots },
  };
}

function teamBlock(section: HTMLElement, team: ShootingSide) {
  section.replaceChildren();
  const head = el('div', 'shooting__team-head');
  head.appendChild(logoEl(team, 'shooting__logo'));
  head.appendChild(el('h2', '', team.name));
  section.appendChild(head);

  // Shooters: anyone with a shot or a goal, otherwise whoever is listed at GS and GA.
  const sh = (p: SheetPlayer): Partial<NonNullable<SheetPlayer['shooting']>> => p.shooting || {};
  let shooters = team.players.filter(p => sh(p).shots || sh(p).goals || sh(p).superGoals);
  if (!shooters.length) shooters = team.players.filter(p => p.position === 'GS' || p.position === 'GA');
  shooters.sort((a, b) => (sh(b).points || 0) - (sh(a).points || 0));

  const t = el('table');
  const hr = t.createTHead().insertRow();
  ['Shooter', 'Goals', ...supers ? ['Super'] : [], 'Shots', '%'].forEach((h, i) => hr.appendChild(el('th', i ? 'n' : '', h)));
  const body = t.createTBody();
  const sum = { goals: 0, superGoals: 0, shots: 0 };
  shooters.forEach((p, i) => {
    const s = sh(p);
    sum.goals += s.goals || 0; sum.superGoals += s.superGoals || 0; sum.shots += s.shots || 0;
    const r = body.insertRow();
    r.style.animationDelay = `${i * 80}ms`;
    const nameCell = el('td', 'who');
    if (p.position) nameCell.appendChild(el('span', 'pos', p.position));
    nameCell.appendChild(document.createTextNode(p.name));
    r.appendChild(nameCell);
    r.appendChild(el('td', 'n', s.goals || 0));
    if (supers) r.appendChild(el('td', 'n', team.firstPass ? '–' : s.superGoals || 0));
    r.appendChild(el('td', 'n', s.shots ?? '–'));
    r.appendChild(el('td', 'n', pct((s.goals || 0) + (s.superGoals || 0), s.shots)));
  });
  // Team row: PlayHQ's team totals when there are some (not every goal is credited to a player).
  const tot: { goals: number; superGoals: number; shots: number | null } = team.totals && team.totals.shots != null ? team.totals : sum;
  const f = t.createTFoot().insertRow();
  f.appendChild(el('td', 'who', 'Team'));
  f.appendChild(el('td', 'n', tot.goals ?? 0));
  if (supers) f.appendChild(el('td', 'n', team.firstPass ? '–' : tot.superGoals ?? 0));
  f.appendChild(el('td', 'n', tot.shots ?? 0));
  f.appendChild(el('td', 'n', pct((tot.goals || 0) + (tot.superGoals || 0), tot.shots)));
  section.appendChild(t);
  if (!team.players.length && !team.firstPass) section.appendChild(el('p', 'teamlist__empty', 'Stats not available from PlayHQ yet.'));
}

loadTeams<TeamSheets>(async data => {
  // The FirstPass team's shooting comes from FirstPass when Studio has it (on this Mac only); the other side stays PlayHQ's.
  const fp = await firstPassOnAir();
  const sides: Record<'home' | 'away', ShootingSide> = { home: data.home, away: data.away };
  if (fp) sides[fp.side] = fromFirstPass(data[fp.side], fp);
  const rules = data.rules || {};
  supers = rules.superShots !== false || !!(data.home.totals && data.home.totals.superGoals) || !!(data.away.totals && data.away.totals.superGoals);
  const breaks = rules.periodType === 'halves' ? HALF_BREAKS : BREAKS;
  $('title').textContent = params.get('title') || `Shooting stats  ·  ${breaks[data.period ?? 0] || ''}`.replace(/\s·\s$/, '');
  $('homeName').textContent = data.home.name;
  $('awayName').textContent = data.away.name;
  // The big score is the scoreboard's score; the tables are PlayHQ's shooting stats, or FirstPass's for its team.
  teamBlock($('home'), sides.home);
  teamBlock($('away'), sides.away);
  $('homeGoals').textContent = data.score ? String(data.score.home) : '';
  $('awayGoals').textContent = data.score ? String(data.score.away) : '';
  $('footer').textContent = [data.competition, data.division, data.court].filter(Boolean).join('  ·  ');
  $('card').hidden = false;
});

// What makes this file a module (its names its own), as the first line says.
export {};
