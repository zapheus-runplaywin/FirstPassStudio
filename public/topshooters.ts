// FirstPass Studio - the top shooters' script (topshooters.html loads it as a module, so its names stay its own).

// What /api/topshooters answers (games.ts getTopShooters): the division's best shooters by points, goals and super shots.
interface Shooter { name: string; team: string; logo?: string | null; goals: number; superGoals: number; shots: number; points: number }
interface TopShooters { division: string; rules?: { superShots?: boolean }; gamesRead: number; gamesFinished: number; error?: string; points: Shooter[]; goals: Shooter[]; superGoals: Shooter[] }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
sponsorSpot.footer('stats');

const sort = new URLSearchParams(location.search).get('sort') || 'points';
loadJson<TopShooters>('/api/topshooters', d => {
  const supers = !d.rules || d.rules.superShots !== false; // the Super column, when the competition plays super shots
  if (!supers) document.querySelector('th.super')?.remove();
  const list = sort === 'goals' ? d.goals : /super/.test(sort) ? d.superGoals : d.points;
  if (!list.length) throw new Error(d.error || 'No shooting stats found in the finished games yet');
  $('division').textContent = `${d.division}  ·  ${sort === 'goals' ? 'Most goals' : /super/.test(sort) ? 'Most super shots' : 'Most points'}`;
  const body = $('rows');
  list.forEach((p, i) => {
    const tr = el('tr');
    const who = el('td', 'left');
    who.append(el('div', 'shooters__name', p.name), el('div', 'shooters__team', p.team));
    const made = p.goals + p.superGoals, tried = p.shots;
    const logo = el('td'); logo.append(logoEl({ name: p.team, logo: p.logo }, 'shooters__logo'));
    tr.append(el('td', 'shooters__rank', i + 1), logo, who, el('td', '', p.goals), ...supers ? [el('td', '', p.superGoals)] : [],
      el('td', 'shooters__points', p.points), el('td', '', tried ? `${Math.round(made / tried * 100)}%` : '–'));
    body.append(tr);
  });
  $('footer').textContent = `From ${d.gamesRead} of ${d.gamesFinished} finished games`;
  $('card').hidden = false;
});

// What makes this file a module (its names its own), as the first line says.
export {};
