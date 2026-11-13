// FirstPass Studio - the team list's script (teamlist.html loads it as a module, so its names stay its own).

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const side = new URLSearchParams(location.search).get('side') === 'away' ? 'away' : 'home';
const COURT = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
loadTeams<TeamSheets>(data => {
  const team = data[side];
  $('name').textContent = team.name;
  $('logo').replaceWith(Object.assign(logoEl(team, 'teamlist__logo'), { id: 'logo' }));
  const list = $('players');
  list.replaceChildren();
  let benchShown = false;
  team.players.forEach((p, i) => {
    const onCourt = COURT.includes(p.position);
    // Players added from the season squad (the line up was incomplete) aren't the bench,
    // and with no line up at all the whole list is the squad, so it needs no heading.
    if (!onCourt && !benchShown && i > 0 && !(p.fromSquad && team.players.every(x => x.fromSquad))) {
      list.appendChild(el('li', 'teamlist__bench', p.fromSquad ? 'Squad' : 'Bench')); benchShown = true;
    }
    const li = el('li', 'teamlist__player');
    li.style.animationDelay = `${i * 70}ms`;
    li.appendChild(el('span', 'pos', onCourt ? p.position : ''));
    li.appendChild(el('span', 'num', p.number !== '' && p.number !== null ? p.number : ''));
    const n = el('span', 'pname', p.name);
    if (p.captain) n.appendChild(el('span', 'badge', 'Captain'));
    if (p.viceCaptain) n.appendChild(el('span', 'badge', 'Vice captain'));
    li.appendChild(n);
    list.appendChild(li);
  });
  $('empty').hidden = team.players.length > 0;
  $('footer').textContent = [data.competition, data.division, data.court].filter(Boolean).join('  ·  ');
  $('card').hidden = false;
});

// What makes this file a module (its names its own), as the first line says.
export {};
