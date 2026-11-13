// FirstPass Studio - the ladder bar's script (ladderbar.html loads it as a module, so its names stay its own).

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What /api/ladderbar answers: the two teams of the game on the board, each with its ladder row when it has one.
interface BarTeam { name: string; logo?: string | null; ladder: { position: number; won?: number; lost?: number; drawn?: number; points?: number; percentage?: number | null } | null }
interface LadderBar { division: string; home: BarTeam; away: BarTeam }

function side(id: string, t: BarTeam) {
  const box = $(id);
  const l = t.ladder;
  const info = el('div', 'ladderbar__info');
  info.append(el('div', 'ladderbar__name', t.name));
  info.append(el('div', 'ladderbar__record', l ? `${record(l)}  ·  ${l.points ?? 0} pts${l.percentage != null ? '  ·  ' + Number(l.percentage).toFixed(1) + '%' : ''}` : 'Not on the ladder yet'));
  box.replaceChildren(logoEl(t, 'ladderbar__logo'), info, el('div', 'ladderbar__pos', l ? ordinal(l.position) : '–'));
}
loadJson<LadderBar>('/api/ladderbar', d => {
  $('division').textContent = d.division;
  side('home', d.home); side('away', d.away);
  $('bar').hidden = false;
});

// What makes this file a module (its names its own), as the first line says.
export {};
