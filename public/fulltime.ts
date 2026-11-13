// FirstPass Studio - the full time card's script (fulltime.html loads it as a module, so its names stay its own).

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const title = params.get('title');
if (title) $('title').textContent = title;
type Shot = SheetPlayer & { shooting: NonNullable<SheetPlayer['shooting']> };
function teamStats(t: SheetSide) {
  const box = el('div', 'fulltime__panel');
  const shooters = t.players.filter((p): p is Shot => !!p.shooting && !!(p.shooting.shots || p.shooting.goals || p.shooting.superGoals));
  if (!shooters.length && !t.totals) return box;
  const pts = (p: Shot) => p.shooting.points ?? (p.shooting.goals + 2 * p.shooting.superGoals);
  const top = [...shooters].sort((a, b) => pts(b) - pts(a))[0];
  const sum = shooters.reduce((n, p) => ({ made: n.made + p.shooting.goals + p.shooting.superGoals, shots: n.shots + (p.shooting.shots || 0) }), { made: 0, shots: 0 });
  const team = t.totals && t.totals.shots ? { made: (t.totals.goals || 0) + (t.totals.superGoals || 0), shots: t.totals.shots } : sum;
  if (top) {
    const s = top.shooting;
    box.append(el('div', 'fulltime__label', 'Top shooter'), el('div', 'fulltime__player', top.name),
      el('div', 'fulltime__line', `${s.goals} goals${s.superGoals ? `  ·  ${s.superGoals} super` : ''}${s.shots ? `  ·  ${s.goals + s.superGoals}/${s.shots}` : ''}`));
  }
  box.append(el('div', 'fulltime__label', 'Team accuracy'), el('div', 'fulltime__pct', team.shots ? `${Math.round(team.made / team.shots * 100)}%` : '–'));
  return box;
}
loadTeams<TeamSheets>(d => {
  if (d.error) console.warn('Full time stats:', d.error);
  $('division').textContent = [d.division, d.court].filter(Boolean).join('  ·  ');
  const score = d.score || { home: 0, away: 0 };
  for (const side of ['home', 'away'] as const) {
    const t = d[side];
    $(side + 'Team').replaceChildren(logoEl(t, 'fulltime__logo'), el('div', 'fulltime__name', t.name));
    const won = score[side] > score[side === 'home' ? 'away' : 'home'];
    const num = $(side + 'Score');
    num.textContent = String(score[side]);
    num.className = won ? 'is-win' : '';
  }
  const stats = $('stats');
  stats.replaceChildren(teamStats(d.home), teamStats(d.away));
  stats.hidden = !stats.textContent;
  $('card').hidden = false;
});

// What makes this file a module (its names its own), as the first line says.
export {};
