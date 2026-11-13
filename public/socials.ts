// FirstPass Studio - the Socials page's script (socials.html loads it as a module, so its names stay its own).

// What /api/socials answers: the tab's settings, the colour sets, the picture kinds and templates, and the season's nights.
interface SocialsInfo {
  error?: string; settings: SocialsSettings; colourSets: ColourSet[]; kinds: { kind: string; name: string; when: string }[];
  templates: { id: string; name: string; blurb: string }[]; app: boolean; here?: boolean;
  nights: { date: string; rounds: string; games: number }[]; today: string; next: string;
}
// A picture on the list (pictures()): its key, kind and name, why it can't be made yet (missing), and what it's of.
interface Picture { key: string; kind: string; name: string; help: string; missing?: string; game?: string; division?: string; team?: string; when?: string; club?: string }
// A polaroid's photo and framing; an athlete on the Athletes tab with an approved photo (GET /api/socials/athletes).
interface Photo { file: string; px: number; py: number; zoom: number }
interface Athlete { name: string; teams: { team: string; division: string }[] }
// What the Mac made for this device (POST /api/socials/export with toDevice), and a picture it skipped.
interface Made { pictures: { url: string; name: string }[]; zip?: { name: string; url: string } | null }
interface Skipped { name: string; reason: string }
type Size = 'square' | 'portrait' | 'story';
// AI captions (captions.ts): what GET /api/captions answers on this Mac, a model a key can use, and a caption written.
interface CaptionPrice { in: number; out: number }
interface CaptionProvider { id: string; name: string; maker: string; key: string; model: string; price: CaptionPrice | null; billing: string; keys: string;
  month: { usd: number; captions: number; unpriced: number } }
interface CaptionsStatus { error?: string; provider: string; providers: CaptionProvider[]; styles: string[]; pricesFrom: string; warning: string }
interface CaptionModel { id: string; name: string; price: CaptionPrice | null }
interface Written { error?: string; text: string; provider: string; model: string; cost: { usd: number | null; tokensIn: number; tokensOut: number }; warning: string }
// A picture's caption, by its key: the text (written or typed), the style ('' for the one last picked) and length asked
// for, and the line under it.
interface Caption { text: string; undo: string | null; style: string; short: boolean; open: boolean; busy: boolean; note: string; noteKind: '' | 'warn' | 'error' }
// The dialog for the bigger view remembers the preview it came from.
type BigView = HTMLDialogElement & { from?: Element };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e;
}
const SIZE_LABELS: Record<Size, string> = { square: 'Square', portrait: 'Portrait', story: 'Story' };
const FRAME: Record<Size, [number, number]> = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920] };
const PREVIEW_W = 220;
let info: SocialsInfo | null = null, night: SocialsNight | null = null;
// The tab's settings and the night, once loaded: every list, picker and button is drawn after that.
const theInfo = () => { if (!info) throw new Error('The Socials tab hasn\'t loaded yet'); return info; };
const theNight = () => { if (!night) throw new Error('No game night loaded yet'); return night; };
// What's unticked, kept while the night or sizes change. Each polaroid's photo and framing, by its key.
const off = new Set<string>();
// As a carousel: the order the ticked pictures post in, by key (ones ticked later join the end).
const CAROUSEL_MAX = 20;
let carouselOrder: string[] = [];
const photos: Record<string, Photo> = {};
const photoOf = (key: string) => (photos[key] = photos[key] || { file: '', px: 50, py: 50, zoom: 1 });
// Athletes picked for a picture, by its key: { home, away } on a match up or full time, { athlete } on a polaroid.
// Only athletes with a photo they approved the use of can be picked (GET /api/socials/athletes).
const picks: Record<string, Record<string, string>> = {};
let athletesList: Athlete[] = [];
let lineups: SocialLineup[] | null = null; // the night's finished games' line ups (loadLineups), null until read
const set = () => document.querySelector<HTMLInputElement>('[name=set]:checked')?.value;

const dayName = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function showError(msg: string) { $('err').textContent = msg || ''; $('err').hidden = !msg; }
const sizes = () => [...document.querySelectorAll<HTMLInputElement>('[data-size]')].filter(c => c.checked).map(c => c.dataset.size as Size);

// The pictures for this night, each { key, kind, name, help, game?, division?, missing? }.
// Only the kinds in the picture set picked on the Show row (all of them with All).
function pictures(): Picture[] {
  const list = listed();
  const ps = pictureSet();
  return ps ? list.filter(p => ps.kinds.includes(p.kind)) : list;
}
// This list's pictures in the division picked on the Show row; a picture for the whole night (Fixture, Results, Byes and
// the like) is always listed. The pick lasts while the tab is open, as divisions differ from night to night.
let division = '';
const divisionOf = (p: Picture) => p.division || theNight().games.find(g => g.id === p.game)?.division || '';
function listed(): Picture[] {
  const list = set() === 'results' ? resultsPictures() : upcomingPictures();
  return division ? list.filter(p => !divisionOf(p) || divisionOf(p) === division) : list;
}
const pictureSet = () => info?.settings.pictureSets.find(x => x.id === info?.settings.pictureSet);
function resultsPictures(): Picture[] {
  const night = theNight();
  const done = night.games.filter(g => g.finished);
  const none = done.length ? '' : 'No results for this night yet: they show once PlayHQ has each final score.';
  const later = night.games.length - done.length;
  const list: Picture[] = [{ key: 'results', kind: 'results', name: 'Results', missing: none,
    help: `Every finished game's final score, division by division.${later && done.length ? ` ${later} game${later === 1 ? '' : 's'} still to finish.` : ''}` }];
  list.push({ key: 'review', kind: 'review', name: 'Round in review', missing: done.length > 1 ? '' : none || 'Only one result this night: Round in review needs two or more.',
    help: 'The biggest win, the closest game and every upset: a winner at least half the ladder lower before the night, or 4 places, whichever is fewer.' });
  list.push({ key: 'milestones:played', kind: 'milestones', when: 'played', name: 'Milestones', missing: none,
    help: 'Athletes in the finished games\' line ups who played a first game (their team had played before without them), or their 50th, 100th or another 50, counting games typed in on the Athletes tab (Games).' });
  const score = (g: SocialGame) => `${g.home.name} ${g.home.score}-${g.away.score} ${g.away.name}`;
  for (const g of done) list.push({ key: `fulltime:${g.id}`, kind: 'fulltime', game: g.id, name: `Full time ${score(g)}`, help: [g.time, g.court, g.division].filter(Boolean).join(' · ') });
  // Game stats and Shooting duel: a picture each per finished game, from its line ups (and its story when streamed or followed).
  for (const g of done) {
    list.push({ key: `gamestats:${g.id}`, kind: 'gamestats', game: g.id, name: `Game stats ${g.home.name} v ${g.away.name}`,
      help: 'Team against team from PlayHQ\'s line ups: goals (and super shots), attempts and accuracy. When Studio streamed or followed it, also quarters won, the longest run, the 3 and 5 goal runs and the biggest lead.' });
    list.push({ key: `shooting:${g.id}`, kind: 'shooting', game: g.id, name: `Shooting duel ${g.home.name} v ${g.away.name}`,
      help: 'Each team\'s shooters that game, most points first, with goals from attempts and accuracy, under the team\'s total.' });
  }
  // A picture made from finished games with none yet shows once, saying so (pending), so the night's Results list is the same before and after.
  const pending = (kind: string, name: string) => { if (!done.length) list.push({ key: kind, kind, name, missing: none, help: '' }); };
  pending('fulltime', 'Full time');
  pending('gamestats', 'Game stats');
  pending('shooting', 'Shooting duel');
  for (const div of [...new Set(night.games.map(g => g.division).filter(Boolean))]) {
    list.push({ key: `ladder:${div}`, kind: 'ladder', division: div, name: `Ladder ${div}`, help: 'The ladder as PlayHQ has it now: "after" the round when this is the division\'s latest night with results, when each team\'s move since before the night can show too.' });
  }
  // Finals: after a division's last home and away round, who made the finals and the draw; on a finals night, the draw.
  for (const f of night.finals || []) {
    const left = f.left ? ` ${f.left} of its game${f.left === 1 ? '' : 's'} this night still to finish, so it's as it stands until then.` : '';
    if (f.lastRound) list.push({ key: `finalsbound:${f.division}`, kind: 'finalsbound', division: f.division, name: `Finals bound ${f.division}`,
      help: `The teams in ${f.division}'s finals, each with what their ladder place earned (a double chance, a week off).${left}` });
    list.push({ key: `finalsdraw:${f.division}`, kind: 'finalsdraw', division: f.division, name: `Finals draw ${f.division}`,
      help: `${f.division}'s finals week by week, with the winners filled in as the games finish.${f.lastRound ? left : ''}` });
    // Once the grand final (or a best of three) has a winner: the champions.
    if (f.champion) list.push({ key: `champions:${f.division}`, kind: 'champions', division: f.division, name: `${night.winners} ${f.division}`,
      help: `${f.champion}, ${f.division} ${night.winners.toLowerCase()}, with the grand final's score. Call them Champions or Premiers under Finals on Competitions setup.` });
  }
  // Top shooters: a picture per division that has a finished game, each division's best from its games' line ups.
  const shot = [...new Set(done.map(g => g.division))];
  for (const div of shot) list.push({ key: `topshooters:${div}`, kind: 'topshooters', division: div, name: div ? `Top shooters ${div}` : 'Top shooters',
    help: `${div || 'The night'}'s top shooters, from each finished game's line ups (read once and kept).` });
  pending('topshooters', 'Top shooters');
  // Tournament (or Season) top shooters: a picture per division that played, its running totals over every finished game so far.
  for (const div of shot.filter(Boolean)) list.push({ key: `tournament:${div}`, kind: 'tournament', division: div, name: `${night.running} top shooters ${div}`,
    help: `${div}'s top shooters over every finished game so far, after this night's last round (or an earlier round that night).` });
  pending('tournament', `${night.running} top shooters`);
  // The night's stats, a picture per division that has finished games (Super shot leaders only where it plays them).
  for (const div of shot.filter(Boolean)) {
    list.push({ key: `accuracy:${div}`, kind: 'accuracy', division: div, name: `Sharpshooter ${div}`,
      help: `${div}'s best shooting accuracy that night (goals over attempts), for shooters with 10 attempts or more.` });
    if ((night.superShotDivisions || []).includes(div)) list.push({ key: `supershots:${div}`, kind: 'supershots', division: div, name: `Super shot leaders ${div}`,
      help: `${div}'s most super shots that night and over the season so far, top three each.` });
    if ((night.superShotDivisions || []).includes(div)) list.push({ key: `teamsupers:${div}`, kind: 'teamsupers', division: div, name: `Team super shots ${div}`,
      help: `Every ${div} team's super shots that night and over the season so far, from PlayHQ's team counts (a super shot without a named shooter counts too).` });
    list.push({ key: `onfire:${div}`, kind: 'onfire', division: div, name: `On fire ${div}`,
      help: `${div}'s shooters who played that night with the biggest rise in goals a game over their last three games, on their games before.` });
  }
  pending('accuracy', 'Sharpshooter');
  if (night.games.some(g => (night.superShotDivisions || []).includes(g.division))) { pending('supershots', 'Super shot leaders'); pending('teamsupers', 'Team super shots'); }
  pending('onfire', 'On fire');
  list.push({ key: 'numbers', kind: 'numbers', name: 'Night in numbers', missing: none,
    help: `The night added up: games, goals (points where there are super shots), super shots, games within 3 goals, the biggest win and the highest score. ${orderNote()}` });
  for (const c of night.clubs || []) list.push({ key: `club:${c.club}`, kind: 'club', club: c.club, name: `Club round up ${c.club}`,
    help: `Every ${c.club} result that night, division by division. A club's teams are set under Clubs on Competitions setup.` });
  pending('club', 'Club round up');
  const runs = night.streaks || [];
  list.push({ key: 'streaks', kind: 'streaks', name: 'On a roll', missing: none || (runs.length ? '' : 'No team is unbeaten (three games or more) or on a run of three wins or more.'),
    help: runs.map(t => `${t.team} (${t.division})`).join(', ') });
  if (done.length) list.push({ key: 'season', kind: 'season', name: 'Team season card',
    help: 'One team\'s season so far: played, won, lost, its ladder place and percentage, its current run, biggest win and top shooter. Pick the team.' });
  pending('season', 'Team season card');
  for (const div of night.lastNights || []) list.push({ key: `wrap:${div}`, kind: 'wrap', division: div, name: `Season wrap ${div}`, missing: none,
    help: `${div}'s season on its last night: the ${night.winners.toLowerCase()} once known, top shooter, sharpest shooter, most super shots and biggest win.` });
  // Game story and Score worm: a picture each per game Studio streamed or followed (it keeps each one's goals and quarter scores).
  const stories = done.filter(g => (night.stories || []).includes(g.id));
  for (const g of stories) {
    list.push({ key: `story:${g.id}`, kind: 'story', game: g.id, name: `Game story ${g.home.name} v ${g.away.name}`,
      help: 'The game quarter by quarter as Studio\'s scoreboard kept it, with quarters won, the best quarter, the longest run, the biggest lead and the lead changes.' });
    list.push({ key: `worm:${g.id}`, kind: 'worm', game: g.id, name: `Score worm ${g.home.name} v ${g.away.name}`,
      help: 'The margin over the game from its goals, as on the stream\'s Score worm.' });
    list.push({ key: `moments:${g.id}`, kind: 'moments', game: g.id, name: `Moments of the game ${g.home.name} v ${g.away.name}`,
      help: 'The lead changes, comebacks, runs and super shots Studio\'s scoreboard saw, in order, with the quarter, the time left and the score (the 8 that matter most when there are more).' });
  }
  // Of the night, from the games Studio streamed or followed: their runs, their super shot periods and the comeback of the night.
  const o: Partial<OfTheNight> = night.ofNight || {};
  const why = none || (stories.length ? '' : 'Studio keeps the story of each game it streams or follows: none of this night\'s games were streamed or followed by this Mac, or by another Studio Mac on the same network or iCloud Drive.');
  list.push({ key: 'runs', kind: 'runs', name: 'Runs of the night', missing: why || ((o.runs || []).length ? '' : 'No team scored two goals in a row in a game Studio streamed or followed.'),
    help: 'Every streamed or followed game\'s longest run of goals, longest first, with each team\'s runs of 3.' });
  if (night.games.some(g => (night.superShotDivisions || []).includes(g.division))) list.push({ key: 'supershottime', kind: 'supershottime', name: 'Super shot time',
    missing: why || ((o.supers || []).length ? '' : 'No streamed or followed super shot game had its clock run, so the super shot periods weren\'t timed.'),
    help: 'The points each team scored in each quarter\'s super shot period, for the streamed or followed super shot games.' });
  list.push({ key: 'comeback', kind: 'comeback', name: 'Comeback of the night', missing: why || (o.comeback ? '' : 'No team came from behind to win a game Studio streamed or followed.'),
    help: o.comeback ? `${o.comeback.game[o.comeback.side].name} came back from ${o.comeback.down} down, with the game's worm.` : 'The winner who came back from furthest behind, with the game\'s worm.' });
  if (!stories.length) {
    const why = none || 'Studio keeps the story of each game it streams or follows: none of this night\'s games were streamed or followed by this Mac, or by another Studio Mac on the same network or iCloud Drive.';
    list.push({ key: 'story', kind: 'story', name: 'Game story', missing: why, help: '' }, { key: 'worm', kind: 'worm', name: 'Score worm', missing: why, help: '' },
      { key: 'moments', kind: 'moments', name: 'Moments of the game', missing: why, help: '' });
  }
  list.push({ key: 'watch', kind: 'watch', name: 'Watch it back', missing: none,
    help: 'A QR code for the replay: paste the video\'s link (or your channel\'s), with the night\'s streamed games beside it.' });
  // Hand picks: a Player of the match per game and a Team of the round per division, picked from the line ups.
  for (const g of done) list.push({ key: `potm:${g.id}`, kind: 'potm', game: g.id, name: `Player of the match ${g.home.name} v ${g.away.name}`,
    help: 'Pick the player from either team\'s line up, with their photo when they approved its use. Give a medal\'s name for a special round.' });
  pending('potm', 'Player of the match');
  for (const div of shot.filter(Boolean)) list.push({ key: `teamround:${div}`, kind: 'teamround', division: div, name: `Team of the round ${div}`,
    help: `Pick an athlete for each position from that night's ${div} line ups.` });
  pending('teamround', 'Team of the round');
  spotlights(list);
  list.push({ key: 'thanks', kind: 'thanks', name: 'Thanks for watching', help: 'A thank you for watching, with the sponsors and the next game night.' });
  for (const g of done) list.push({ key: `polaroid:${g.id}`, kind: 'polaroid', game: g.id, name: `Polaroid ${g.home.name} v ${g.away.name}`,
    help: 'The score goes under the photo. Drop a match photo on it, then drag the preview to frame it; with no photo the window is see-through.' });
  pending('polaroid', 'Polaroid');
  return list;
}
// On both lists: an Athlete spotlight and a Sponsor spotlight, each picked on its card.
function spotlights(list: Picture[]) {
  list.push({ key: 'spotlight', kind: 'spotlight', name: 'Athlete spotlight', missing: athletesList.length ? '' : 'No athletes with an approved photo yet: add photos and tick Approved for photo use on the Athletes tab.',
    help: 'One athlete: their photo, teams, positions, games played and goals this season. Pick the athlete.' });
  list.push({ key: 'sponsorspot', kind: 'sponsorspot', name: 'Sponsor spotlight', missing: (theNight().sponsorList || []).length ? '' : 'No sponsors yet: add them on the Sponsors tab.',
    help: 'One sponsor big, with a thank you, and after the night how long they were on screen. Pick the sponsor.' });
}
function upcomingPictures(): Picture[] {
  const night = theNight();
  const list: Picture[] = [{ key: 'fixtures', kind: 'fixtures', name: 'Game night fixture', help: 'Every game of the night, on every court, by time.' }];
  for (const g of night.games) list.push({ key: `matchup:${g.id}`, kind: 'matchup', game: g.id, name: `Match up ${g.home.name} v ${g.away.name}`,
    help: [g.time, g.court, g.division].filter(Boolean).join(' · ') });
  // Form guide: a picture per game, each team's last five results and their meetings this season.
  for (const g of night.games) list.push({ key: `form:${g.id}`, kind: 'form', game: g.id, name: `Form guide ${g.home.name} v ${g.away.name}`,
    help: 'Each team\'s last five results this season, oldest first, and how their meetings this season went.' });
  // Head to head: a picture per game whose teams have met this season, each meeting's score and the wins each way.
  const met = (id: string) => (night.met || []).find(x => x.id === id)?.n || 0;
  for (const g of night.games.filter(x => met(x.id))) list.push({ key: `h2h:${g.id}`, kind: 'h2h', game: g.id, name: `Head to head ${g.home.name} v ${g.away.name}`,
    help: `Their ${met(g.id) === 1 ? 'meeting' : `${met(g.id)} meetings`} this season before this night, with each score.` });
  // Team sheet: a picture per game, both squads this season with each player's position and games played.
  for (const g of night.games) list.push({ key: `teamsheet:${g.id}`, kind: 'teamsheet', game: g.id, name: `Team sheet ${g.home.name} v ${g.away.name}`,
    help: 'Both teams\' squads this season (everyone in their line ups), each player\'s usual position and their games played in the division, counting games typed in on the Athletes tab.' });
  const divisions = [...new Set(night.games.map(g => g.division).filter(Boolean))];
  for (const div of divisions) list.push({ key: `preview:${div}`, kind: 'preview', division: div, name: `Round preview ${div}`,
    help: `${div}'s games with each team's ladder place and points, the game of the round (the two best placed teams) outlined, and who a win could lift into the finals places.` });
  const byes = night.byes || [];
  list.push({ key: 'byes', kind: 'byes', name: 'Byes', missing: byes.length ? '' : 'Every team plays this night.',
    help: byes.length ? byes.map(b => `${b.division}: ${b.teams.map(t => t.name).join(', ')}`).join('. ') : '' });
  list.push({ key: 'milestones:next', kind: 'milestones', when: 'next', name: 'Milestones coming up',
    help: 'Athletes whose next game would be their 50th, 100th or another 50, from their games played this season plus any typed in on the Athletes tab (Games). Line ups aren\'t known before the night, so it\'s anyone in the team this season.' });
  for (const r of night.raceOn || []) list.push({ key: `race:${r.division}`, kind: 'race', division: r.division, name: `Finals race ${r.division}`,
    help: `${r.left === 1 ? 'The last round' : `${r.left} rounds to go`}: each team in the finals, out, or still a chance, from the ladder as it stands and the games left.` });
  if (night.countdown) list.push({ key: 'countdown', kind: 'countdown', name: 'Countdown',
    help: night.countdown.rounds ? 'The rounds left before the finals, tonight\'s included.' : 'The days to the grand final.' });
  // A division's first night: a season draw for each of its teams.
  for (const div of night.firstNights || []) {
    const teams = [...new Set([...night.games.filter(g => g.division === div).flatMap(g => [g.home.name, g.away.name]),
      ...byes.filter(b => b.division === div).flatMap(b => b.teams.map(t => t.name))])].sort((a, b) => a.localeCompare(b));
    for (const t of teams) list.push({ key: `draw:${div}:${t}`, kind: 'draw', division: div, team: t, name: `Season draw ${t} (${div})`,
      help: `Every ${t} game this season in ${div}, shown on the division's first night.` });
  }
  // A finals night: each division's finals draw, to post before the games.
  for (const f of (night.finals || []).filter(x => x.finalsNight)) list.push({ key: `finalsdraw:${f.division}`, kind: 'finalsdraw', division: f.division,
    name: `Finals draw ${f.division}`, help: `${f.division}'s finals week by week: who plays who this night, and the winners so far.` });
  list.push({ key: 'onstream', kind: 'onstream', name: 'On the stream', help: night.stream ? `${night.stream.court}'s games and who is calling them.` : '',
    missing: night.stream ? '' : 'This night isn\'t planned yet: plan its court and commentators on the Production Planner tab first.' });
  // Commentary team: a picture for each game someone calls, with that game's commentators, so the social team can group them.
  const called = night.stream ? night.stream.slots.filter(s => s.people.length) : [];
  const missing = !night.stream ? 'This night isn\'t planned yet: plan its court and commentators on the Production Planner tab first.'
    : !called.length ? 'Nobody is on the mic this night yet: add the commentators on the Production Planner tab.' : '';
  if (!called.length) list.push({ key: 'commentators', kind: 'commentators', name: 'Commentary team', missing, help: '' });
  for (const s of called) {
    const noShot = s.people.filter(p => !p.headshot).map(p => p.name);
    list.push({ key: `commentators:${s.id}`, kind: 'commentators', game: s.id, name: `Commentary team ${s.home.name} v ${s.away.name}`,
      help: `${s.people.map(p => p.name).join(', ').replace(/, ([^,]*)$/, ' and $1')}, with ${s.people.length > 1 ? 'their headshots' : 'their headshot'}, calling the ${s.time} game.${noShot.length ? ` No headshot yet for ${noShot.join(', ')}: add one on the Production Planner (their initials show until then).` : ''}` });
  }
  spotlights(list);
  list.push({ key: 'polaroid', kind: 'polaroid', name: 'Polaroid', help: 'Drop a match photo on it, then drag the preview to frame it. With no photo the window is see-through, for your social team to put a photo under in Canva or on a phone.' });
  return list;
}
function link(p: Picture, size: Size) {
  const night = theNight(), info = theInfo();
  const q = new URLSearchParams({ kind: p.kind, size, date: night.date, sponsor: info.settings.sponsor[p.kind] ? '1' : '0', mark: info.settings.mark ? '1' : '0', pivt: info.settings.pivt ? '1' : '0', colours: info.settings.colours, template: info.settings.template });
  if (p.game) q.set('game', p.game);
  if (p.division) q.set('division', p.division);
  for (const k of ['team', 'when', 'club'] as const) { const v = p[k]; if (v) q.set(k, v); }
  if (p.kind === 'tournament' || p.kind === 'ladder') q.set('movers', info.settings.movers ? '1' : '0');
  const photo = photos[p.key];
  for (const [k, v] of Object.entries(picks[p.key] || {})) if (v) q.set(k, v);
  if (p.kind === 'polaroid' && photo && photo.file) { q.set('photo', photo.file); q.set('px', String(Math.round(photo.px))); q.set('py', String(Math.round(photo.py))); q.set('zoom', String(photo.zoom)); }
  return `/social.html?${q}`;
}

function preview(p: Picture, size: Size) {
  const [w, h] = FRAME[size];
  const scale = PREVIEW_W / w;
  const fig = el('figure', 'preview');
  fig.style.margin = '0'; fig.style.width = `${PREVIEW_W}px`; fig.style.height = `${Math.round(h * scale)}px`;
  const frame = el('iframe');
  frame.width = String(w); frame.height = String(h); frame.style.transform = `scale(${scale})`;
  frame.loading = 'lazy'; frame.src = link(p, size); frame.title = `${p.name}, ${SIZE_LABELS[size]}`;
  fig.append(frame, el('figcaption', '', SIZE_LABELS[size]));
  if (p.kind === 'polaroid' && photos[p.key] && photos[p.key].file) fig.append(dragger(p.key));
  fig.title = 'Click to see it bigger';
  fig.onclick = () => enlarge(p, size);
  return fig;
}
// The bigger view: the picture at the largest size that fits the window, up to its own 1080 wide.
// ← and → step through every preview on the page, Esc or a click closes it.
function enlarge(p: Picture, size: Size) {
  const [w, h] = FRAME[size];
  const scale = Math.min(1, (innerWidth - 64) / w, (innerHeight - 90) / h);
  const fig = el('figure', 'preview');
  fig.style.margin = '0'; fig.style.width = `${Math.round(w * scale)}px`; fig.style.height = `${Math.round(h * scale)}px`;
  const frame = el('iframe');
  frame.width = String(w); frame.height = String(h); frame.style.transform = `scale(${scale})`;
  frame.src = link(p, size); frame.title = `${p.name}, ${SIZE_LABELS[size]}`;
  frame.tabIndex = -1; // keys stay with the page (the picture would take ← → and Esc otherwise)
  fig.append(frame, el('figcaption', '', SIZE_LABELS[size]));
  let d = $<BigView>('big');
  if (!d) {
    const big: BigView = d = document.body.appendChild(el('dialog', 'big'));
    big.id = 'big';
    big.tabIndex = -1;
    big.onclick = () => big.close();
    document.addEventListener('keydown', e => {
      if (!big.open || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      const all = [...document.querySelectorAll<HTMLElement>('#pics .preview')];
      const next = all[(all.indexOf(big.from as HTMLElement) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      if (next) next.click();
    });
  }
  d.from = [...document.querySelectorAll('#pics .preview')].find(f => f.querySelector('iframe')?.src === frame.src);
  d.replaceChildren(fig, el('p', '', `${p.name} · ${SIZE_LABELS[size]} · ← → for the others, Esc to close`));
  if (!d.open) d.showModal();
  d.focus();
}
// Dragging a polaroid preview moves the photo in its window; the previews redraw on letting go.
function dragger(key: string) {
  const photo = photoOf(key);
  const d: HTMLDivElement & { moved?: boolean } = el('div', 'drag');
  d.title = 'Drag to move the photo';
  d.onpointerdown = e => {
    d.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, px: photo.px, py: photo.py };
    d.onpointermove = m => {
      // Dragging right shows more of the left of the photo; about a third of the preview moves it all the way.
      photo.px = Math.max(0, Math.min(100, start.px - (m.clientX - start.x) / (PREVIEW_W / 3) * 100 / photo.zoom));
      photo.py = Math.max(0, Math.min(100, start.py - (m.clientY - start.y) / (PREVIEW_W / 3) * 100 / photo.zoom));
    };
    d.onpointerup = m => {
      d.onpointermove = null;
      // A click without a drag opens the bigger view (the figure's own click) instead of redrawing.
      if (Math.abs(m.clientX - start.x) + Math.abs(m.clientY - start.y) < 4) return;
      d.moved = true;
      redraw(key);
    };
    d.onclick = e => { if (d.moved) { d.moved = false; e.stopPropagation(); } };
  };
  return d;
}

function sponsorTick(kind: string) {
  const l = el('label');
  const c = el('input'); c.type = 'checkbox'; c.checked = !!theInfo().settings.sponsor[kind];
  c.onchange = () => saveSettings({ sponsor: { [kind]: c.checked } });
  l.append(c, ' Sponsor strip');
  return l;
}
// Tournament top shooters: after the night's last round, or after an earlier round that night (by its games' start,
// so "After Round 5 · 11:30am"); games with no round are picked by their start time.
function afterPicker(p: Picture) {
  const night = theNight();
  const l = el('label', 'picker');
  const pick = el('select');
  const done = night.games.filter(g => g.division === p.division && g.finished);
  const times = [...new Set(done.map(g => g.time))].sort();
  // A round's choice counts up to its last game's start; a time with no round of its own is offered as a time.
  const rounds = [...new Set(done.map(g => g.round).filter(Boolean))];
  const choices = rounds.length
    ? rounds.map(r => { const t = done.filter(g => g.round === r).map(g => g.time).sort().pop() || ''; return [t, `After ${r} · ${twelve(t)}`]; }).sort((x, y) => x[0].localeCompare(y[0]))
    : times.map(t => [t, `After the ${twelve(t)} games`]);
  pick.append(new Option('End of night', ''), ...choices.slice(0, -1).map(([t, label]) => new Option(label, t)));
  pick.value = (picks[p.key] || {}).after || '';
  pick.onchange = () => { picks[p.key] = { ...(picks[p.key] || {}), after: pick.value }; redraw(p.key); };
  l.append(el('b', '', 'As at'), pick);
  return l;
}
const twelve = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
// Movers: each shooter's places up or down since the night before, kept for the competition.
// The team for a Team season card: any team in that night's finished games, first one to start with.
function teamPicker(p: Picture) {
  const night = theNight();
  const l = el('label', 'picker');
  l.append(el('b', '', 'Team'));
  const pick = l.appendChild(el('select'));
  const teams = [...new Map(night.games.filter(g => g.finished).flatMap(g => [g.home.name, g.away.name].map(t => [`${g.division}|${t}`, [g.division, t]] as const))).values()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }) || a[1].localeCompare(b[1]));
  pick.append(...teams.map(([div, t]) => new Option(`${t} (${div})`, `${div}|${t}`)));
  const now = picks[p.key] || {};
  pick.value = now.team ? `${now.division}|${now.team}` : pick.value;
  const apply = () => { const [division, team] = pick.value.split('|'); picks[p.key] = { division, team }; };
  if (!now.team) apply();
  pick.onchange = () => { apply(); redraw(p.key); };
  return l;
}
// A select of a game's (or a division's) line ups, grouped by team; a picked name no longer listed stays on.
function lineupSelect(games: SocialLineup[], now: string | undefined, position?: string) {
  const pick = el('select');
  pick.append(new Option(position ? '–' : 'Pick the player', ''));
  for (const g of games) for (const side of [g.home, g.away]) {
    const players = side.players.filter(x => !position || !x.position || x.position === position);
    if (!players.length) continue;
    const group = el('optgroup'); group.label = games.length > 1 ? `${side.name} (v ${(side === g.home ? g.away : g.home).name})` : side.name;
    group.append(...players.map(x => new Option(x.position && !position ? `${x.name} (${x.position})` : x.name, x.name)));
    pick.append(group);
  }
  if (now && ![...pick.options].some(o => o.value === now)) pick.append(new Option(now, now));
  pick.value = now || '';
  return pick;
}
const lineupNote = () => el('p', 'help', lineups ? 'PlayHQ has no line ups for these games.' : 'Reading the line ups from PlayHQ…');
// Player of the match: a name from either team's line up, and a medal's name (optional).
function potmPicker(p: Picture) {
  const box = el('div', 'picker');
  box.append(el('b', '', 'Player'));
  const g = (lineups || []).find(x => x.id === p.game);
  const now = picks[p.key] || {};
  if (!g || !g.read) box.append(lineupNote());
  else {
    const pick = box.appendChild(lineupSelect([g], now.athlete));
    pick.setAttribute('aria-label', 'Player of the match');
    pick.onchange = () => { picks[p.key] = { ...(picks[p.key] || {}), athlete: pick.value }; redraw(p.key); };
  }
  const medal = el('input'); medal.type = 'text'; medal.placeholder = 'Medal name (optional)'; medal.maxLength = 60; medal.value = now.medal || '';
  medal.setAttribute('aria-label', 'Medal name');
  medal.onchange = () => { picks[p.key] = { ...(picks[p.key] || {}), medal: medal.value.trim() }; redraw(p.key); };
  box.append(medal);
  return box;
}
// Team of the round: an athlete for each position, from the division's line ups that night (those who played it there
// first, then anyone without a position).
const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
function teamRoundPicker(p: Picture) {
  const box = el('div', 'picker picker--positions');
  const games = (lineups || []).filter(x => x.division === p.division && x.read);
  if (!games.length) { box.append(el('b', '', 'Team'), lineupNote()); return box; }
  for (const pos of POSITIONS) {
    const l = box.appendChild(el('label'));
    const pick = lineupSelect(games, (picks[p.key] || {})[pos], pos);
    pick.setAttribute('aria-label', pos);
    pick.onchange = () => { picks[p.key] = { ...(picks[p.key] || {}), [pos]: pick.value }; redraw(p.key); };
    l.append(el('b', '', pos), pick);
  }
  return box;
}
// Watch it back: the replay's link, typed or pasted; the first stream on Live viewers to start with.
function watchPicker(p: Picture) {
  const night = theNight();
  const l = el('label', 'picker');
  l.append(el('b', '', 'Link to watch it back'));
  const input = l.appendChild(el('input'));
  input.type = 'text'; input.placeholder = 'https://youtube.com/…'; input.setAttribute('aria-label', 'Link to watch it back');
  const first = (night.watchLinks || [])[0];
  if (!(picks[p.key] || {}).link && first) picks[p.key] = { link: first.link };
  input.value = (picks[p.key] || {}).link || '';
  input.onchange = () => { picks[p.key] = { link: input.value.trim() }; redraw(p.key); };
  return l;
}
// Sponsor spotlight: any sponsor of the competition, the first to start with.
function sponsorPicker(p: Picture) {
  const night = theNight();
  const l = el('label', 'picker');
  l.append(el('b', '', 'Sponsor'));
  const pick = l.appendChild(el('select'));
  pick.append(...(night.sponsorList || []).map(x => new Option(`${x.name} (${x.tier})`, x.id)));
  const now = (picks[p.key] || {}).sponsor;
  if (now) pick.value = now;
  pick.onchange = () => { picks[p.key] = { sponsor: pick.value }; redraw(p.key); };
  return l;
}
function moversTick() {
  const l = el('label', 'picker movers');
  const c = el('input'); c.type = 'checkbox'; c.checked = theInfo().settings.movers;
  c.onchange = () => saveSettings({ movers: c.checked });
  l.append(c, ' Highlight movers');
  return l;
}
// Pick an athlete by name, narrowed by division and team (to the side's own team to start with).
function athletePicker(key: string, slot: string, label: string, start: { division?: string; team?: string }) {
  const box = el('div', 'picker');
  box.append(el('b', '', label));
  if (!athletesList.length) { box.append(el('p', 'fp-empty', 'No athletes with an approved photo yet: add photos and tick Approved for photo use on the Athletes tab.')); return box; }
  const same = (a: string | undefined, b: string | undefined) => String(a || '').toLowerCase().trim() === String(b || '').toLowerCase().trim();
  const divs = [...new Set(athletesList.flatMap(a => a.teams.map(t => t.division)))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const div = el('select'), team = el('select'), who = el('select');
  div.setAttribute('aria-label', 'Division'); team.setAttribute('aria-label', 'Team'); who.setAttribute('aria-label', 'Athlete');
  const opt = (v: string, t: string) => { const o = el('option', '', t); o.value = v; return o; };
  div.replaceChildren(opt('', 'Every division'), ...divs.map(d => opt(d, d)));
  div.value = divs.find(d => same(d, start.division)) || '';
  const fillTeams = () => {
    const teams = [...new Set(athletesList.flatMap(a => a.teams.filter(t => !div.value || t.division === div.value).map(t => t.team)))].sort();
    team.replaceChildren(opt('', 'Every team'), ...teams.map(t => opt(t, t)));
  };
  const fillNames = () => {
    const list = athletesList.filter(a => a.teams.some(t => (!div.value || t.division === div.value) && (!team.value || t.team === team.value)));
    const now = (picks[key] || {})[slot] || '';
    who.replaceChildren(opt('', 'No athlete'), ...list.map(a => opt(a.name, a.name)));
    if (now && !list.some(a => a.name === now)) who.append(opt(now, now));
    who.value = now;
  };
  fillTeams();
  team.value = [...team.options].map(o => o.value).find(v => v && same(v, start.team)) || '';
  fillNames();
  div.onchange = () => { fillTeams(); fillNames(); };
  team.onchange = fillNames;
  who.onchange = () => { picks[key] = { ...(picks[key] || {}), [slot]: who.value }; redraw(key); };
  box.append(div, team, who);
  return box;
}
function photoControls(key: string) {
  const photo = photoOf(key);
  const box = el('div', 'pic__ticks');
  const drop = box.appendChild(el('label', 'drop', photo.file ? 'Drop another photo, or click to choose' : 'Drop a match photo here, or click to choose'));
  const input = el('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.hidden = true;
  drop.append(input);
  input.onchange = () => { const f = input.files?.[0]; if (f) addPhoto(key, f); };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer?.files[0]; if (f) addPhoto(key, f); };
  if (photo.file) {
    const z = el('label', '', 'Zoom ');
    const r = el('input'); r.type = 'range'; r.min = '1'; r.max = '3'; r.step = '0.05'; r.value = String(photo.zoom);
    r.onchange = () => { photo.zoom = Number(r.value); redraw(key); };
    z.append(r);
    const rm = el('button', 'alt small', 'Remove the photo');
    rm.onclick = () => { delete photos[key]; redraw(key); };
    box.append(z, rm);
  }
  return box;
}
async function addPhoto(key: string, file: File) {
  setStatus('Adding the photo…');
  try {
    const res = await fetch(`/api/socials/photo?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const d = await res.json() as { error?: string; photo: string };
    if (d.error) throw new Error(d.error);
    photos[key] = { file: d.photo, px: 50, py: 50, zoom: 1 };
    setStatus('');
    redraw(key);
  } catch (err) { setStatus(`Couldn't add the photo: ${(err instanceof Error ? err.message : err)}`, true); }
}

function card(p: Picture) {
  const s = el('section', `pic${off.has(p.key) || p.missing ? ' off' : ''}`);
  s.dataset.key = p.key;
  const left = s.appendChild(el('div'));
  left.append(el('h3', '', p.name));
  const ticks = left.appendChild(el('div', 'pic__ticks'));
  const l = el('label');
  const c = el('input'); c.type = 'checkbox'; c.checked = !off.has(p.key) && !p.missing; c.disabled = !!p.missing;
  c.onchange = () => { if (c.checked) off.delete(p.key); else off.add(p.key); s.classList.toggle('off', !c.checked); drawCarousel(); };
  l.append(c, ' Save this one');
  ticks.append(l, sponsorTick(p.kind));
  if (p.help) left.append(el('p', 'help', p.help));
  if (p.missing) left.append(el('p', 'fp-callout warn', p.missing));
  if (p.kind === 'polaroid') left.append(photoControls(p.key), athletePicker(p.key, 'athlete', 'Or an athlete\'s photo', {}));
  if (p.kind === 'tournament') left.append(afterPicker(p), moversTick());
  if (p.kind === 'ladder') left.append(moversTick());
  if (p.kind === 'season') left.append(teamPicker(p));
  if (p.kind === 'potm' && p.game) left.append(potmPicker(p));
  if (p.kind === 'teamround' && p.division) left.append(teamRoundPicker(p));
  if (p.kind === 'spotlight') left.append(athletePicker(p.key, 'athlete', 'Athlete', {}));
  if (p.kind === 'sponsorspot') left.append(sponsorPicker(p));
  if (p.kind === 'watch' && !p.missing) left.append(watchPicker(p));
  if (p.kind === 'matchup' || p.kind === 'fulltime') {
    const g = theNight().games.find(x => x.id === p.game);
    if (g) left.append(athletePicker(p.key, 'home', g.home.name, { division: g.division, team: g.home.name }),
      athletePicker(p.key, 'away', g.away.name, { division: g.division, team: g.away.name }));
  }
  if (!p.missing) left.append(captionBox(p));
  const previews = s.appendChild(el('div', 'previews'));
  for (const size of sizes()) previews.append(preview(p, size));
  if (!sizes().length) previews.append(el('p', 'help', 'Tick a size above.'));
  return s;
}
// Whether Night in numbers has its goal order tiles: only when Studio has every finished game's whole story.
function orderNote() {
  const o = theNight().goalOrder;
  if (!o || !o.of) return '';
  if (!o.missing.length) return 'Every game\'s whole story is here, so it also has the lead changes, the most goals in a row and the runs of 5 goals.';
  return `Lead changes, goals in a row and runs of 5 goals join it once Studio has every game's whole story: ${o.complete} of ${o.of} now (not yet: ${o.missing.join(', ')}).`;
}
// Where the night's game stories came from when another Studio Mac streamed some of the games (stories.ts).
function storiesNote() {
  const from = theNight().storiesFrom || [];
  if (set() !== 'results' || !from.length) return null;
  const way: Record<string, string> = { network: 'over the network', icloud: 'from iCloud Drive', filled: 'filling gaps in this Mac\'s own' };
  return el('p', 'help', `Game stories from other Studio Macs: ${from.map(f => `${f.games} game${f.games === 1 ? '' : 's'} from ${f.studio} (${way[f.via] || f.via})`).join(', ')}.`);
}
function draw() {
  if (!night) return;
  drawShow();
  const list = pictures(), ps = pictureSet();
  if (!list.length && ps) return $('pics').replaceChildren(el('p', 'fp-empty', `${ps.name} has no ${set() === 'results' ? 'Results' : 'Upcoming'} pictures: pick All, or ✎ to add some.`));
  $('pics').replaceChildren(...[storiesNote()].filter(x => x !== null), ...list.map(card));
  drawCarousel();
}
// The ticked pictures in carousel order: the order kept, then any ticked since, as listed.
function carouselList() {
  const ticked = pictures().filter(p => !off.has(p.key) && !p.missing);
  const byKey = new Map(ticked.map(p => [p.key, p]));
  carouselOrder = [...carouselOrder.filter(k => byKey.has(k)), ...ticked.map(p => p.key).filter(k => !carouselOrder.includes(k))];
  return carouselOrder.map(k => byKey.get(k)).filter(p => p !== undefined);
}
// The carousel's order above Save, while As a carousel is ticked: drag a picture (or ‹ ›) to move it.
function drawCarousel() {
  const box = $('carouselOrder');
  box.hidden = !$<HTMLInputElement>('carousel').checked;
  if (box.hidden || !night) return;
  const list = carouselList();
  const move = (from: number, to: number) => { if (to < 0 || to >= carouselOrder.length) return; const [k] = carouselOrder.splice(from, 1); carouselOrder.splice(to, 0, k); drawCarousel(); };
  let dragged = -1;
  box.replaceChildren(el('b', '', 'Carousel order'), ...list.map((p, i) => {
    const chip = el('span', `chip${i >= CAROUSEL_MAX ? ' past' : ''}`);
    chip.draggable = true;
    chip.title = i >= CAROUSEL_MAX ? `Instagram takes ${CAROUSEL_MAX} at most: untick this one or one before it` : 'Drag to move it';
    const back = el('button', 'alt small', '‹'), on = el('button', 'alt small', '›');
    back.type = on.type = 'button';
    back.title = 'Earlier'; on.title = 'Later';
    back.disabled = i === 0; on.disabled = i === list.length - 1;
    back.onclick = () => move(i, i - 1); on.onclick = () => move(i, i + 1);
    chip.append(el('i', '', String(i + 1)), ` ${p.name}`, back, on);
    chip.ondragstart = e => { dragged = i; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; };
    chip.ondragover = e => { e.preventDefault(); chip.classList.add('over'); };
    chip.ondragleave = () => chip.classList.remove('over');
    chip.ondrop = e => { e.preventDefault(); if (dragged >= 0) move(dragged, i); };
    return chip;
  }));
  if (!list.length) box.append(el('span', 'help', 'Tick the pictures to post together.'));
}
// The Show row: All, then each picture set (with how many of this list's pictures it shows), ✎ to change one.
function drawShow() {
  const night = theNight(), info = theInfo();
  const divisions = [...new Set(night.games.map(g => g.division).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!divisions.includes(division)) division = '';
  const all = listed();
  const button = (name: string, id: string, n: number) => {
    const b = el('button', 'set small', name);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(info.settings.pictureSet === id));
    b.append(el('span', 'count', String(n)));
    b.onclick = () => saveSettings({ pictureSet: id });
    return b;
  };
  $('show').replaceChildren(el('b', '', 'Show'), button('All', '', all.length), ...info.settings.pictureSets.map(ps => {
    const b = button(ps.name, ps.id, all.filter(p => ps.kinds.includes(p.kind)).length);
    const edit = el('span', 'rm', '✎');
    edit.title = `Change ${ps.name}`;
    edit.onclick = e => { e.stopPropagation(); editPictureSet(ps); };
    b.append(edit);
    return b;
  }));
  const add = el('button', 'alt small', 'New picture set');
  add.type = 'button';
  add.onclick = () => editPictureSet(null);
  $('show').append(add);
  // With more than one division playing, pick one to list only its pictures.
  if (divisions.length > 1) {
    const l = el('label', 'favonly', 'Division ');
    const pick = el('select');
    pick.id = 'division';
    pick.append(el('option', '', 'All divisions'), ...divisions.map(d => { const o = el('option', '', d); o.value = d; return o; }));
    pick.options[0].value = '';
    pick.value = division;
    pick.onchange = () => { division = pick.value; draw(); };
    l.append(pick);
    $('show').append(l);
  }
}
// Opens the editor on a picture set (null: a new one, starting with the kinds in this list).
let editing: (PictureSet & { id: string }) | null = null;
function editPictureSet(ps: (PictureSet & { id: string }) | null) {
  editing = ps;
  const on = ps ? ps.kinds : [...new Set((set() === 'results' ? resultsPictures() : upcomingPictures()).map(p => p.kind))];
  $<HTMLInputElement>('picSetName').value = ps ? ps.name : '';
  const groups = { upcoming: 'Upcoming', results: 'Results', both: 'On both' };
  $('picSetKinds').replaceChildren(...Object.entries(groups).flatMap(([when, label]) => [el('span', 'grp', label),
    ...theInfo().kinds.filter(k => k.when === when).map(k => {
      const l = el('label'), c = el('input');
      c.type = 'checkbox'; c.value = k.kind; c.checked = on.includes(k.kind);
      l.append(c, ` ${k.name}`);
      return l;
    })]));
  $('picSetDelete').hidden = !ps;
  $('picSet').hidden = false;
  $('picSetName').focus();
}
$('picSet').onsubmit = e => {
  e.preventDefault();
  const info = theInfo(), was = editing;
  const made: PictureSet = { id: was ? was.id : undefined, name: $<HTMLInputElement>('picSetName').value.trim() || 'My pictures',
    kinds: [...$('picSetKinds').querySelectorAll<HTMLInputElement>('input:checked')].map(c => c.value) };
  const sets = was ? info.settings.pictureSets.map(x => x.id === was.id ? made : x) : [...info.settings.pictureSets, made];
  $('picSet').hidden = true;
  saveSettings({ pictureSets: sets }).then(() => {
    const ps = was ? was : info.settings.pictureSets[info.settings.pictureSets.length - 1];
    if (ps) saveSettings({ pictureSet: ps.id });
  });
};
$('picSetCancel').onclick = () => { $('picSet').hidden = true; };
$('picSetDelete').onclick = () => {
  $('picSet').hidden = true;
  const was = editing;
  if (was) saveSettings({ pictureSets: theInfo().settings.pictureSets.filter(x => x.id !== was.id) });
};
// Redraws one picture's card (a polaroid's, after its photo changes).
function redraw(key: string) {
  const old = [...document.querySelectorAll<HTMLElement>('[data-key]')].find(x => x.dataset.key === key);
  const p = pictures().find(x => x.key === key);
  if (old && p) old.replaceWith(card(p));
}

async function saveSettings(change: Partial<Omit<SocialsSettings, 'pictureSets' | 'colourSets'>> & { pictureSets?: PictureSet[]; colourSets?: Partial<ColourSet>[] }) {
  try {
    const res = await fetch('/api/socials/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
    const d = await res.json() as { error?: string; settings: SocialsSettings; colourSets: ColourSet[] };
    if (d.error) throw new Error(d.error);
    const info = theInfo();
    info.settings = d.settings; info.colourSets = d.colourSets; showError(''); drawTemplates(); drawColours(); draw();
  } catch (err) { showError(`Couldn't save that: ${(err instanceof Error ? err.message : err)}`); }
}

async function loadNight(date: string) {
  try {
    const d = await (await fetch(`/api/socials/night?date=${encodeURIComponent(date)}&with=sponsorlist`, { cache: 'no-store' })).json() as SocialsNight;
    if (d.error) throw new Error(d.error);
    if (night && night.date !== d.date) for (const k of Object.keys(captions)) delete captions[k];
    night = d;
    lineups = null;
    // A night with results opens on Results, one still to come on Upcoming; either can be picked.
    const tab = document.querySelector<HTMLInputElement>(`[name=set][value=${d.games.some(g => g.finished) ? 'results' : 'upcoming'}]`);
    if (tab) tab.checked = true;
    showError(''); draw();
    loadLineups(d);
  } catch (err) { showError(`Couldn't load that night: ${(err instanceof Error ? err.message : err)}`); }
}
// The finished games' line ups, for Player of the match and Team of the round to pick from (read after the night, so
// the tab doesn't wait on PlayHQ).
async function loadLineups(d: SocialsNight) {
  if (!d.games.some(g => g.finished)) return;
  try {
    const x = await (await fetch(`/api/socials/night?date=${encodeURIComponent(d.date)}&with=lineups`, { cache: 'no-store' })).json() as SocialsNight;
    if (night !== d || x.error) return;
    lineups = x.lineups || [];
    for (const p of pictures().filter(p => p.kind === 'potm' || p.kind === 'teamround')) redraw(p.key);
  } catch { /* the pickers say the line ups aren't in */ }
}
async function load() {
  try {
    const d = await (await fetch('/api/socials', { cache: 'no-store' })).json() as SocialsInfo;
    if (d.error) throw new Error(d.error);
    info = d;
    try { athletesList = ((await (await fetch('/api/socials/athletes', { cache: 'no-store' })).json()) as { athletes?: Athlete[] }).athletes || []; } catch { athletesList = []; }
    $('noApp').hidden = d.app;
    $<HTMLButtonElement>('save').disabled = $<HTMLButtonElement>('share').disabled = !d.app;
    // On a phone (or another computer) Save hands the pictures to it, and Share is the phone's own share sheet, which
    // the browser offers only on a secure (https) link.
    $('phone').hidden = d.here === false;
    if (d.here === false) {
      $('save').textContent = 'Save to this device';
      $('save').title = 'Then press and hold a picture to add it to Photos';
      $('share').hidden = !canShareFiles();
    }
    $('captionsCard').hidden = $('postingCard').hidden = d.here === false;
    if (d.here !== false) { loadCaptions(); loadPosting(); }
    $<HTMLInputElement>('mark').checked = d.settings.mark;
    $<HTMLInputElement>('pivt').checked = d.settings.pivt;
    drawTemplates();
    drawColours();
    $('night').replaceChildren(...d.nights.map(n => {
      const o = el('option', '', `${dayName(n.date)} · ${n.rounds} · ${n.games} games${n.date === d.today ? ' (tonight)' : ''}`);
      o.value = n.date;
      return o;
    }));
    if (!d.nights.length) { $('pics').replaceChildren(el('p', 'fp-empty', 'No game nights in this season yet.')); return; }
    $<HTMLSelectElement>('night').value = d.next;
    await loadNight(d.next);
  } catch (err) { showError(`Couldn't load the game nights: ${(err instanceof Error ? err.message : err)}`); }
}

// bad: true for an error, 'warn' for a save that skipped a picture or two.
function setStatus(text: string, bad?: boolean | 'warn') {
  $('status').textContent = text;
  $('status').classList.toggle('error', bad === true);
  $('status').classList.toggle('warn', bad === 'warn');
}
// Open on your phone: a QR code for this tab by the Mac's network link. The phone's camera opens the pair page, which
// asks the Mac first if the phone isn't paired yet, then goes on to this tab.
async function showPhone(page = '/socials.html') {
  let d = $<HTMLDialogElement>('phoneBox');
  if (!d) {
    const box = d = document.body.appendChild(el('dialog', 'made qr'));
    box.id = 'phoneBox';
    box.onclick = e => { if (e.target === box) box.close(); };
  }
  const box = d;
  try {
    const got = await (await fetch(`/api/phone-link?page=${encodeURIComponent(page)}`, { cache: 'no-store' })).json() as { error?: string; svg: string; link: string };
    if (got.error) throw new Error(got.error);
    // The phone pages: Socials, the Remote (the Output page's status, run order and sequences, for a phone) or the
    // Commentator mic (a phone as a backup commentator headset).
    const pick = el('span', 'fp-seg');
    pick.setAttribute('role', 'radiogroup');
    for (const [p, name] of [['/socials.html', 'Socials'], ['/remote.html', 'Remote'], ['/commentator.html', 'Commentator']]) {
      const l = el('label'), r = el('input');
      r.type = 'radio'; r.name = 'phonePage'; r.checked = p === page;
      r.onchange = () => showPhone(p);
      l.append(r, ` ${name}`);
      pick.append(l);
    }
    const code = el('div', 'code');
    code.innerHTML = got.svg;
    const close = el('button', '', 'Done'); close.type = 'button'; close.onclick = () => box.close();
    const row = el('div', 'row'); row.append(close);
    d.replaceChildren(el('h2', '', 'Open on your phone'), pick,
      el('p', 'help', `${({ '/remote.html': 'The Remote: what\'s on air, the run order and a key for every sequence. ', '/commentator.html': 'The Commentator mic: a phone as a backup commentator headset, heard on Output 1. ' } as Record<string, string>)[page] || ''}Scan this with the phone\'s camera, on the same Wi-Fi as this Mac. The first time, the phone asks this Mac: press Allow everything.`),
      code, el('code', '', got.link), row);
    if (!d.open) d.showModal();
  } catch (err) { showError(`Couldn't make the QR code: ${(err instanceof Error ? err.message : err)}`); }
}
$('phone').onclick = () => showPhone();
// The browser's share sheet with files: only on a secure link (https or this Mac), and not on every browser.
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })); } catch { return false; }
}
// The pictures the Mac made for this device: each as itself, to press and hold and Add to Photos, with a Download
// link each (and the zip's).
function showMade(made: Made, skipped: Skipped[], texts: { name: string; text: string }[] = []) {
  let d = $<HTMLDialogElement>('madeBox');
  if (!d) {
    const box = d = document.body.appendChild(el('dialog', 'made'));
    box.id = 'madeBox';
    box.onclick = e => { if (e.target === box) box.close(); };
  }
  const box = d;
  const list = el('div', 'list');
  for (const p of made.pictures) {
    const f = el('figure'), img = el('img'), cap = el('figcaption'), a = el('a', '', 'Download');
    img.src = p.url; img.alt = p.name;
    a.href = p.url; a.download = p.name;
    cap.append(el('span', '', p.name), a);
    f.append(img, cap);
    list.append(f);
  }
  const row = el('div', 'row');
  if (made.zip) { const z = el('a', 'btn alt', `Download ${made.zip.name}`); z.href = made.zip.url; z.download = made.zip.name; row.append(z); }
  const close = el('button', '', 'Done'); close.type = 'button'; close.onclick = () => box.close();
  row.append(close);
  const n = made.pictures.length;
  // The captions to paste in with them, each with Copy.
  const caps = texts.map(t => {
    const f = el('figure'), cap = el('figcaption'), copy = el('button', 'alt small', 'Copy');
    copy.type = 'button';
    copy.onclick = () => copyText(t.text, copy);
    cap.append(el('span', '', `Caption: ${t.name}`), copy);
    f.append(cap, el('p', 'cap', t.text));
    return f;
  });
  const capList = el('div', 'list');
  capList.append(...caps);
  d.replaceChildren(el('h2', '', `${n} picture${n === 1 ? '' : 's'} ready`),
    el('p', 'help', 'Press and hold a picture, then Add to Photos.'),
    ...(skipped.length ? [el('p', 'help', `Skipped ${skipped.length}: ${skipped.map(x => `${x.name}: ${x.reason}`).join(' · ')}`)] : []),
    ...(caps.length ? [capList] : []), list, row);
  if (!d.open) d.showModal();
}
// Shares the made pictures through the phone's share sheet; false when it couldn't (the list shows them instead).
async function shareMade(made: Made) {
  try {
    const files = await Promise.all(made.pictures.map(async p => new File([await (await fetch(p.url)).blob()], p.name, { type: 'image/png' })));
    await navigator.share({ files });
    return true;
  } catch { return false; }
}
async function save(share: boolean) {
  const night = theNight(), info = theInfo();
  const items: { name: string; link: string; size: Size }[] = [];
  // Each saved picture's caption, written or typed: Captions.txt beside the pictures (and on a phone, with them).
  const texts: { name: string; text: string }[] = [];
  const carousel = $<HTMLInputElement>('carousel').checked;
  if (carousel && sizes().length !== 1) return setStatus('A carousel is all one size: tick just one of Square, Portrait or Story.', true);
  for (const p of carousel ? carouselList() : pictures()) {
    if (off.has(p.key) || p.missing) continue;
    for (const size of sizes()) items.push({ name: p.name, link: link(p, size), size });
    const text = (captions[p.key]?.text || '').trim();
    if (text && sizes().length) texts.push({ name: p.name, text });
  }
  if (!items.length) return setStatus('Tick a picture and a size first.', true);
  if (carousel && items.length > CAROUSEL_MAX) return setStatus(`Instagram takes ${CAROUSEL_MAX} pictures at most in a carousel: untick ${items.length - CAROUSEL_MAX}.`, true);
  $<HTMLButtonElement>('save').disabled = $<HTMLButtonElement>('share').disabled = true;
  setStatus(`Saving ${items.length} picture${items.length === 1 ? '' : 's'}…`);
  try {
    const toDevice = info.here === false;
    const res = await fetch('/api/socials/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: night.date, set: set(), share, zip: $<HTMLInputElement>('zip').checked, carousel, toDevice, items, captions: texts }) });
    const d = await res.json() as { error?: string; skipped?: Skipped[]; made?: Made; files: string[]; folder: string; zip?: string };
    if (d.error) throw new Error(d.error);
    // A picture that couldn't be made (Milestones on a night with none, say) is skipped, not a failed save.
    const skipped = d.skipped || [];
    const why = skipped.length ? ` Skipped ${skipped.length}: ${skipped.map(x => `${x.name}: ${x.reason}`).join(' · ')}` : '';
    if (d.made) {
      setStatus(`Made ${d.files.length} picture${d.files.length === 1 ? '' : 's'}.${why}`, skipped.length ? 'warn' : false);
      if (!(share && await shareMade(d.made))) showMade(d.made, skipped, texts);
      else if (texts.length) showMade(d.made, skipped, texts);
      $<HTMLButtonElement>('save').disabled = $<HTMLButtonElement>('share').disabled = false;
      return;
    }
    setStatus(`Saved ${d.files.length} picture${d.files.length === 1 ? '' : 's'}${texts.length ? ` and Captions.txt` : ''} in ${d.folder}${d.zip ? `, and ${d.zip}` : ''}${share ? `. Pick where to share ${d.zip ? 'the zip' : 'them'} in the menu.` : '.'}${why}`, skipped.length ? 'warn' : false);
  } catch (err) { setStatus(`Couldn't save the pictures: ${(err instanceof Error ? err.message : err)}`, true); }
  $<HTMLButtonElement>('save').disabled = $<HTMLButtonElement>('share').disabled = !info.app;
}

// ─── Captions ───────────────────────────────────────────────────────────────
// Each picture's post text: written by AI (captions.ts, on this Mac with the club's own key) from the same facts the
// picture shows, in a style picked, or typed by hand. Kept while the night is open; Save puts them in Captions.txt.
const STYLES: [string, string][] = [['hype', 'Hype'], ['professional', 'Professional'], ['emotional', 'Emotional'], ['neutral', 'Neutral'], ['fun', 'Fun']];
const STYLE_KEY = 'socials.captionStyle';
const captions: Record<string, Caption> = {};
// The style last picked is where every picture not given one of its own starts (style '').
let lastStyle = (() => { try { return localStorage.getItem(STYLE_KEY) || 'neutral'; } catch { return 'neutral'; } })();
const captionOf = (key: string) => (captions[key] = captions[key] || { text: '', undo: null, style: '', short: false, open: false, busy: false, note: '', noteKind: '' });
const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini' };
const usd = (n: number) => `US$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
async function copyText(text: string, button: HTMLButtonElement) {
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; } catch { button.textContent = 'Select and copy it'; }
  setTimeout(() => { button.textContent = 'Copy'; }, 2000);
}
function captionBox(p: Picture) {
  const c = captionOf(p.key);
  const d = el('details', 'caption');
  d.open = c.open;
  d.ontoggle = () => { c.open = d.open; };
  const done = el('span', 'done', c.text ? ' ✓' : '');
  const sum = el('summary', '', 'Caption');
  sum.append(done);
  const styles = el('div', 'styles');
  styles.setAttribute('role', 'radiogroup'); styles.setAttribute('aria-label', 'Caption style');
  for (const [id, name] of STYLES) {
    const l = el('label'), r = el('input');
    r.type = 'radio'; r.name = `style-${p.key}`; r.value = id; r.checked = (c.style || lastStyle) === id;
    r.onchange = () => {
      c.style = lastStyle = id;
      try { localStorage.setItem(STYLE_KEY, id); } catch { /* not kept */ }
      for (const other of document.querySelectorAll<HTMLInputElement>(`.pic[data-key] .caption input[value="${id}"]`)) {
        const k = other.closest<HTMLElement>('.pic')?.dataset.key;
        if (k && !captions[k]?.style) other.checked = true;
      }
    };
    l.append(r, name);
    styles.append(l);
  }
  const row = el('div', 'row');
  const shortL = el('label'), short = el('input');
  short.type = 'checkbox'; short.checked = c.short;
  short.onchange = () => { c.short = short.checked; };
  shortL.append(short, ' Short');
  shortL.title = 'One or two sentences';
  const write = el('button', 'small', c.busy ? 'Writing…' : c.text ? 'Again' : 'Write caption');
  write.type = 'button'; write.disabled = c.busy;
  write.title = 'Write this picture\'s post text with AI, in the style picked';
  write.onclick = () => writeCaption(p);
  const copy = el('button', 'alt small', 'Copy');
  copy.type = 'button'; copy.disabled = !c.text;
  const box = el('textarea');
  box.value = c.text; box.maxLength = 2600; box.readOnly = c.busy;
  box.placeholder = 'Write caption, or type your own.';
  box.setAttribute('aria-label', `${p.name} caption`);
  box.oninput = () => { c.text = box.value; c.undo = null; copy.disabled = !c.text; done.textContent = c.text ? ' ✓' : ''; undo.hidden = true; };
  copy.onclick = () => copyText(box.value, copy);
  const undo = el('button', 'alt small', 'Undo');
  undo.type = 'button'; undo.hidden = c.undo === null || c.busy;
  undo.title = 'Back to the text before this caption was written';
  undo.onclick = () => { c.text = c.undo || ''; c.undo = null; c.note = ''; redrawCaption(p.key); };
  row.append(shortL, write, copy, undo);
  const note = el('p', `note ${c.noteKind}`, c.note);
  note.hidden = !c.note;
  d.append(sum, styles, row, box, note);
  return d;
}
// Just the caption of a picture drawn again (its previews stay as they are).
function redrawCaption(key: string) {
  const card = [...document.querySelectorAll<HTMLElement>('.pic[data-key]')].find(x => x.dataset.key === key);
  const p = pictures().find(x => x.key === key);
  const old = card?.querySelector('.caption');
  if (old && p) old.replaceWith(captionBox(p));
}
async function writeCaption(p: Picture) {
  const c = captionOf(p.key);
  if (c.busy) return;
  c.busy = true; c.note = 'Writing the caption…'; c.noteKind = '';
  redrawCaption(p.key);
  try {
    // The picture's own link, so the caption is written from what it shows.
    const query = Object.fromEntries(new URL(link(p, sizes()[0] || 'square'), location.href).searchParams);
    const res = await fetch('/api/socials/caption', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: p.kind, query, style: c.style || lastStyle, short: c.short }) });
    const d = await res.json() as Written;
    if (d.error) throw new Error(d.error);
    c.undo = c.text || null;
    c.text = d.text;
    const tokens = `${d.cost.tokensIn} tokens in, ${d.cost.tokensOut} out`;
    c.note = `${PROVIDER_NAMES[d.provider] || d.provider} ${d.model}: ${d.cost.usd === null ? `cost unknown (${tokens})` : `about ${usd(d.cost.usd)} (${tokens})`}.${d.warning ? ` ${d.warning}` : ''}`;
    c.noteKind = d.warning ? 'warn' : '';
  } catch (err) {
    c.note = `Couldn't write the caption: ${err instanceof Error ? err.message : err}`;
    c.noteKind = 'error';
  }
  c.busy = false;
  redrawCaption(p.key);
  if (info?.here !== false) loadCaptions();
}

// The Captions card, on this Mac only: who writes the captions, their API key (kept in the Mac's Keychain), the model,
// what it costs and this month's spend, and the hashtags that go on the end of every caption.
let capStatus: CaptionsStatus | null = null;
const capModels: Record<string, CaptionModel[] | string> = {};
let capError = '';
async function captionsPost(body: object) {
  try {
    const d = await (await fetch('/api/captions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as CaptionsStatus;
    if (d.error) throw new Error(d.error);
    capStatus = d; capError = '';
    return true;
  } catch (err) { capError = err instanceof Error ? err.message : String(err); return false; } finally { drawCaptions(); }
}
async function loadCaptions() {
  try {
    const d = await (await fetch('/api/captions', { cache: 'no-store' })).json() as CaptionsStatus;
    if (d.error) throw new Error(d.error);
    capStatus = d;
  } catch (err) { capError = `Couldn't read the captions settings: ${err instanceof Error ? err.message : err}`; }
  drawCaptions();
}
async function loadModels(p: CaptionProvider) {
  if (!p.key || capModels[p.id]) return;
  capModels[p.id] = 'Reading the models…';
  try {
    const d = await (await fetch(`/api/captions/models?provider=${encodeURIComponent(p.id)}`, { cache: 'no-store' })).json() as { error?: string; models: CaptionModel[] };
    if (d.error) throw new Error(d.error);
    capModels[p.id] = d.models;
  } catch (err) { capModels[p.id] = `Couldn't read the models: ${err instanceof Error ? err.message : err}`; }
  drawCaptions();
}
const priceText = (price: CaptionPrice | null) => (price ? `US$${price.in} in, US$${price.out} out per million tokens` : 'cost unknown');
function drawCaptions() {
  const s = capStatus, i = info;
  if (!s || !i) { $('capBody').replaceChildren(...(capError ? [el('p', 'error', capError)] : [])); return; }
  const p = s.providers.find(x => x.id === s.provider) || s.providers[0];
  $('capSummary').textContent = p.key ? `${p.name}, ${p.model}` : 'not set up yet';
  const grid = el('div', 'grid');
  const field = (label: string, ...parts: (Node | string)[]) => { const v = el('div', 'row'); v.append(...parts); grid.append(el('b', '', label), v); };
  // Who writes them.
  const pick = el('select');
  pick.setAttribute('aria-label', 'AI that writes the captions');
  for (const x of s.providers) { const o = el('option', '', `${x.name} (${x.maker})${x.key ? '' : ', no key yet'}`); o.value = x.id; pick.append(o); }
  pick.value = p.id;
  pick.onchange = () => captionsPost({ provider: pick.value });
  field('Written by', pick);
  // The key: only its last 4 characters ever come back.
  const key = el('input');
  key.type = 'password'; key.autocomplete = 'off'; key.placeholder = p.key ? 'Paste a new key to change it' : `Paste your ${p.name} API key`;
  key.setAttribute('aria-label', `${p.name} API key`);
  const saveKey = el('button', 'small', 'Save key');
  saveKey.type = 'button';
  saveKey.onclick = async () => {
    if (!key.value.trim()) return;
    saveKey.disabled = true; saveKey.textContent = 'Checking…';
    if (await captionsPost({ provider: p.id, key: key.value })) delete capModels[p.id];
  };
  const get = el('a', '', `Get a key from ${p.maker}`);
  get.href = p.keys; get.target = '_blank'; get.rel = 'noopener';
  const parts: (Node | string)[] = [];
  if (p.key) {
    const rm = el('button', 'alt small', 'Remove key');
    rm.type = 'button';
    rm.onclick = () => { delete capModels[p.id]; captionsPost({ removeKey: p.id }); };
    parts.push(el('code', '', p.key), rm);
  }
  field('API key', ...parts, key, saveKey, get);
  // The model, from the key's own list, each with its price.
  const models = capModels[p.id];
  if (p.key && Array.isArray(models)) {
    const m = el('select');
    m.setAttribute('aria-label', 'Model');
    const list = models.some(x => x.id === p.model) ? models : [{ id: p.model, name: p.model, price: p.price }, ...models];
    for (const x of list) { const o = el('option', '', `${x.name}${x.name === x.id ? '' : ` (${x.id})`}: ${priceText(x.price)}`); o.value = x.id; m.append(o); }
    m.value = p.model;
    m.onchange = () => captionsPost({ provider: p.id, model: m.value });
    field('Model', m);
  } else {
    field('Model', el('span', '', p.model), ...(typeof models === 'string' ? [el('span', 'help', models)] : p.key ? [] : [el('span', 'help', 'Save a key to pick from its models.')]));
    loadModels(p);
  }
  field('Price', el('span', '', p.price ? priceText(p.price) : 'Not in Studio\'s price list'), ...(s.warning ? [el('span', 'warn', s.warning)] : []));
  const bill = el('a', '', `${p.maker}'s billing`);
  bill.href = p.billing; bill.target = '_blank'; bill.rel = 'noopener';
  const mo = p.month;
  field('This month', el('span', '', `${usd(mo.usd)} for ${mo.captions} caption${mo.captions === 1 ? '' : 's'}${mo.unpriced ? `, and ${mo.unpriced} with the cost unknown` : ''}`), bill);
  // The hashtags and @handles: on the end of every caption, as typed.
  const tags = el('input');
  tags.type = 'text'; tags.maxLength = 300; tags.value = i.settings.hashtags || '';
  tags.placeholder = '#ThunderLeague #netball @yourclub';
  tags.setAttribute('aria-label', 'Hashtags and handles');
  tags.onchange = () => saveSettings({ hashtags: tags.value });
  field('Hashtags', tags);
  $('capBody').replaceChildren(...(capError ? [el('p', 'error', capError)] : []), grid,
    el('p', 'help', `Each caption is written by ${p.name} from the facts its picture shows, never negative stats, and paid for with your own key. Prices are US dollars from LiteLLM's public price list, checked weekly; your provider's bill is the real figure.`));
}

// The Facebook and Instagram card, on this Mac only: the competition's Page and the Instagram account linked to it,
// from a Page access token kept in the Mac's Keychain (posting.ts). Pictures are posted from Post… (or held for later).
interface PostingAccount { page: { id: string; name: string }; instagram: { id: string; username: string } | null; token: string; warning: string }
interface PostingStatus { error?: string; competition: string | null; account: PostingAccount | null; pages?: { id: string; name: string }[] }
let postStatus: PostingStatus | null = null;
let postPages: { id: string; name: string }[] = [];
let postError = '';
async function loadPosting() {
  try {
    const d = await (await fetch('/api/posting', { cache: 'no-store' })).json() as PostingStatus;
    if (d.error) throw new Error(d.error);
    postStatus = d;
  } catch (err) { postError = `Couldn't read the Facebook and Instagram settings: ${err instanceof Error ? err.message : err}`; }
  drawPosting();
}
async function postingAccount(body: object) {
  try {
    const d = await (await fetch('/api/posting/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as PostingStatus;
    if (d.error) throw new Error(d.error);
    // A token that reaches several Pages: pick one, then connect again.
    if (d.pages) { postPages = d.pages; postError = ''; } else { postStatus = d; postPages = []; postError = ''; }
  } catch (err) { postError = err instanceof Error ? err.message : String(err); }
  drawPosting();
}
function drawPosting() {
  const s = postStatus;
  const a = s?.account || null;
  $('postSummary').textContent = a ? `${a.page.name}${a.instagram ? `, @${a.instagram.username}` : ''}` : 'not connected';
  const grid = el('div', 'grid');
  const field = (label: string, ...parts: (Node | string)[]) => { const v = el('div', 'row'); v.append(...parts); grid.append(el('b', '', label), v); };
  const link = (text: string, href: string) => { const x = el('a', '', text); x.href = href; x.target = '_blank'; x.rel = 'noopener'; return x; };
  if (a) {
    field('Facebook Page', link(a.page.name, `https://www.facebook.com/${encodeURIComponent(a.page.id)}`));
    field('Instagram', a.instagram ? link(`@${a.instagram.username}`, `https://www.instagram.com/${encodeURIComponent(a.instagram.username)}/`) : el('span', 'help', 'Not linked'));
  }
  const token = el('input');
  token.type = 'password'; token.autocomplete = 'off';
  token.placeholder = a ? 'Paste a new token to change it' : 'Paste a Page access token';
  token.setAttribute('aria-label', 'Facebook access token');
  const connect = el('button', 'small', 'Connect');
  connect.type = 'button';
  connect.onclick = () => { if (!token.value.trim()) return; connect.disabled = true; connect.textContent = 'Checking…'; postingAccount({ token: token.value, page: pick.value }); };
  const pick = el('select');
  pick.setAttribute('aria-label', 'Facebook Page');
  pick.hidden = !postPages.length;
  for (const p of postPages) { const o = el('option', '', p.name); o.value = p.id; pick.append(o); }
  const parts: (Node | string)[] = [];
  if (a) {
    const rm = el('button', 'alt small', 'Disconnect');
    rm.type = 'button';
    rm.onclick = () => postingAccount({ remove: true });
    parts.push(el('code', '', a.token), rm);
  }
  field('Token', ...parts, token, pick, connect, link('Make one in Meta\'s Graph API Explorer', 'https://developers.facebook.com/tools/explorer/'));
  $('postBody').replaceChildren(...(postError ? [el('p', 'error', postError)] : []), ...(postPages.length ? [el('p', 'help', 'That token reaches more than one Page: pick the competition\'s, then Connect again.')] : []),
    grid, ...(a?.warning ? [el('p', 'warn', a.warning)] : []),
    el('p', 'help', `Posts to ${s?.competition || 'this competition'}'s own Facebook Page and the Instagram account linked to it. The token comes from your club's Meta app with pages_manage_posts and instagram_content_publish; it's kept in this Mac's Keychain and only its last four characters show.`));
}

$('night').onchange = () => loadNight($<HTMLSelectElement>('night').value);
for (const c of document.querySelectorAll<HTMLInputElement>('[data-size], [name=set]')) c.onchange = draw;
// The template sets: the look of every picture, picked once for them all. The star marks a favourite; Favourites
// only lists just those (and the one in use), once there is one.
function drawTemplates() {
  const info = theInfo();
  const favs = info.settings.favourites, only = info.settings.favouritesOnly && favs.length > 0;
  const shown = info.templates.filter(t => !only || favs.includes(t.id) || t.id === info.settings.template);
  const tick = el('label', 'favonly');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = info.settings.favouritesOnly;
  box.onchange = () => saveSettings({ favouritesOnly: box.checked });
  tick.append(box, ' Favourites only');
  tick.title = favs.length ? 'List only the starred templates' : 'Star a template (☆) to make it a favourite';
  $('templates').replaceChildren(el('b', '', 'Template'), ...shown.map(t => {
    const b = el('button', 'set small', t.name);
    b.type = 'button';
    b.title = t.blurb;
    b.setAttribute('aria-pressed', String(t.id === info.settings.template));
    b.onclick = () => saveSettings({ template: t.id });
    const fav = favs.includes(t.id), star = el('span', fav ? 'star on' : 'star', fav ? '★' : '☆');
    star.title = fav ? `Remove ${t.name} from favourites` : `Make ${t.name} a favourite`;
    star.onclick = e => { e.stopPropagation(); saveSettings({ favourites: fav ? favs.filter(x => x !== t.id) : [...favs, t.id] }); };
    b.append(star);
    return b;
  }), tick);
}
// The colour sets: pick one for every picture, add your own, or remove one you made.
function drawColours() {
  const info = theInfo();
  const row = $('colours');
  row.replaceChildren(el('b', '', 'Colours'), ...info.colourSets.map(c => {
    const b = el('button', 'set small');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c.id === info.settings.colours));
    b.title = `${c.name}: ground ${c.ground}, highlight ${c.highlight}, accent ${c.accent}. The highlight is ${c.contrast}:1 against the ground.`;
    const dots = el('span', 'dots');
    for (const x of [c.ground, c.highlight, c.accent]) { const i = el('i'); i.style.background = x; dots.append(i); }
    b.append(dots, c.name);
    // Big titles need 3:1 to read easily.
    if (c.contrast !== undefined && c.contrast < 3) b.append(el('span', 'low', 'low contrast'));
    b.onclick = () => saveSettings({ colours: c.id });
    if (c.own) {
      const rm = el('span', 'rm', '×');
      rm.title = `Remove ${c.name}`;
      rm.onclick = e => { e.stopPropagation(); saveSettings({ colourSets: info.settings.colourSets.filter(x => x.id !== c.id) }); };
      b.append(rm);
    }
    return b;
  }));
  const add = el('button', 'alt small', 'New colour set');
  add.type = 'button';
  add.onclick = () => { $('newSet').hidden = false; $('newName').focus(); };
  row.append(add);
}
$('newSet').onsubmit = e => {
  e.preventDefault();
  const info = theInfo(), value = (id: string) => $<HTMLInputElement>(id).value;
  const set = { name: value('newName').trim() || 'My colours', ground: value('newGround'), highlight: value('newHighlight'), accent: value('newAccent') };
  $('newSet').hidden = true; $<HTMLInputElement>('newName').value = '';
  saveSettings({ colourSets: [...info.settings.colourSets, set] }).then(() => {
    const made = info.settings.colourSets[info.settings.colourSets.length - 1];
    if (made) saveSettings({ colours: made.id });
  });
};
$('newCancel').onclick = () => { $('newSet').hidden = true; };
$('mark').onchange = () => saveSettings({ mark: $<HTMLInputElement>('mark').checked });
$('pivt').onchange = () => saveSettings({ pivt: $<HTMLInputElement>('pivt').checked });
// Select all / none: every picture shown (one that can't be made yet stays unticked), without reloading the previews.
function tickAll(on: boolean) {
  for (const p of pictures()) if (on) off.delete(p.key); else off.add(p.key);
  for (const s of document.querySelectorAll('.pic[data-key]')) {
    const c = s.querySelector<HTMLInputElement>('.pic__ticks input');
    if (!c || c.disabled) continue;
    c.checked = on; s.classList.toggle('off', !on);
  }
  drawCarousel();
}
$('carousel').onchange = drawCarousel;
$('all').onclick = () => tickAll(true);
$('none').onclick = () => tickAll(false);
$('save').onclick = () => save(false);
$('share').onclick = () => save(true);
load();

// What makes this file a module (its names its own), as the first line says.
export {};
