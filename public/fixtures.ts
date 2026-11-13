// FirstPass Studio - the fixture and round results' script (fixtures.html loads it as a module, so its names stay its own).

// What /api/fixtures answers (the fields this page reads): the round's games, and rounds still waiting for their teams.
interface FixtureTeam { name: string; logo?: string | null; score: number | null; placeholder?: boolean }
interface Fixture { date?: string; time?: string; court?: string; division: string; round?: string; name?: string; toBeDecided?: boolean; status?: string; home: FixtureTeam; away: FixtureTeam }
interface Fixtures { competition?: string; division?: string; round?: string; venueName?: string; games: Fixture[]; waiting?: { division: string; round: string }[]; error?: string }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const DONE = /COMPLETE|FINAL|RESULT|FORFEIT/i;
const RESULTS = /results/.test(location.pathname) || params.has('results');
if (RESULTS) document.title = 'Round Results';

function clock(time?: string) {
  if (!time) return 'TBC';
  const [h, m] = String(time).split(':').map(Number);
  return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : (time || 'TBC');
}
function team(t: FixtureTeam, side: string) {
  const box = el('div', `fixture__team fixture__team--${side}`);
  // A finals team not decided yet ("Winner Qualifying final") has a question mark for a logo.
  box.append(logoEl(t.placeholder ? { name: '?' } : t, 'fixture__logo'), el('span', 'fixture__name' + (t.placeholder ? ' fixture__name--tbd' : ''), t.name));
  return box;
}

async function load() {
  const msg = $('message');
  try {
    const query = new URLSearchParams(location.search);
    if (RESULTS) query.set('results', '1');
    const res = await fetch(`/api/fixtures?${query}`, { cache: 'no-store' });
    const data: Fixtures = await res.json();
    if (data.error) throw new Error(data.error);
    $('comp').textContent = data.competition || '';
    // Divisions on different rounds the same night have no one round for the heading: each game says its own.
    const mixed = !data.round && data.games.some(g => g.round);
    $('round').textContent = [data.division, data.round || (mixed ? 'Fixture' : '')].filter(Boolean).join('  ·  ') + (RESULTS ? ' results' : '') || 'Fixture';
    const day = data.games[0] && data.games[0].date ? new Date(`${data.games[0].date}T00:00:00`) : null;
    $('venue').textContent = [day && !isNaN(day.getTime()) ? day.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) : '', data.venueName].filter(Boolean).join('  ·  ');
    const list = $('list');
    list.replaceChildren();
    const oneDivision = !!data.division;
    let lastTime: string | null = null;
    for (const g of data.games) {
      const row = el('div', 'fixture');
      const t = clock(g.time);
      row.append(el('div', 'fixture__time' + (t === lastTime ? ' fixture__time--same' : ''), t));
      lastTime = t;
      const where = el('div', 'fixture__where');
      where.append(el('span', 'fixture__court', g.court || ''));
      if (!oneDivision) where.append(el('span', 'fixture__division', g.division));
      // The game's round (when divisions differ) and a finals game's name from the finals format
      // (Preliminary final, for a game PlayHQ has no fixture for yet) go on a line of their own above it.
      const about = [mixed ? g.round : '', g.toBeDecided && g.name !== g.round ? g.name : ''].filter(Boolean);
      if (about.length) row.prepend(el('div', 'fixture__round', about.join('  ·  ')));
      row.append(where, team(g.home, 'home'));
      const played = (RESULTS || DONE.test(g.status || '')) && g.home.score !== null && g.away.score !== null;
      row.append(el('div', 'fixture__vs' + (played ? ' fixture__vs--score' : ''), played ? `${g.home.score} – ${g.away.score}` : 'VS'));
      row.append(team(g.away, 'away'));
      list.append(row);
    }
    // A round PlayHQ has added but has no games in yet (the teams come from tonight's results).
    const waiting = (data.waiting || []).filter(w => !data.games.some(g => g.division === w.division));
    if (waiting.length) {
      const names = waiting.map(w => (oneDivision ? w.round : `${w.division} ${w.round}`)).join(', ');
      list.append(el('div', 'fixture fixture--empty', `${names}: teams to be decided`));
    } else if (!data.games.length) list.append(el('div', 'fixture fixture--empty', RESULTS ? 'No results yet this round' : 'No games found for this round'));
    msg.hidden = true;
    $('card').hidden = false;
    // Shrink to fit 1080 high when there are a lot of games.
    const card = $('card');
    const scale = Math.min(1, 1020 / card.offsetHeight);
    card.style.transform = scale < 1 ? `scale(${scale})` : '';
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn("Fixture unavailable:", why);
    msg.textContent = `Fixture unavailable: ${why}`;
    msg.hidden = false;
  }
}
load();

// What makes this file a module (its names its own), as the first line says.
export {};
