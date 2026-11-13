// FirstPass Studio - the countdown's script (countdown.html loads it as a module, so its names stay its own).

// What /api/countdown answers: the next game on this court and when it starts (start, in ms), or why there isn't one.
interface CountdownTeam { name: string; logo?: string | null }
interface Countdown {
  gameId?: string; start: number; serverNow?: number; error?: string; home: CountdownTeam; away: CountdownTeam;
  date?: string; time?: string; competition?: string; division?: string; round?: string; court?: string; venueName?: string;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const mini = params.get('size') === 'mini';
sponsorSpot.naming('countdown').then(s => {
  if (!s || mini) return;
  $('sponsor').replaceChildren(sponsorSpot.badge(s));
  $('sponsor').hidden = false;
});
const endText = params.get('end') || 'Starting soon';
// ?fade=1 (or ?fade=8 for 8 seconds) fades the whole card out over the last 5 seconds and leaves it gone at zero.
const fadeParam = params.get('fade');
const wantsFade = !(fadeParam === null || fadeParam === '0');
// Chroma key safe (chroma.js): nothing half see-through, so the card goes at zero instead of fading.
const fadeMs = !wantsFade || window.studioChroma ? 0 : 1000 * (Number(fadeParam) > 1 ? Math.min(60, Number(fadeParam)) : 5);
const endHides = wantsFade || endText.toLowerCase() === 'hide';
const showTeams = params.get('teams') !== '0';
// ?position=top-left … bottom-right: the row and the column, each left out for the middle.
const POSITIONS = ['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const position = params.get('position') || '';
if (POSITIONS.includes(position)) document.body.classList.add(...position.split('-'));
const label = params.get('label') || 'Starting in';
$('label').textContent = label;
$('miniLabel').textContent = label;
if (!showTeams) $('teams').hidden = true;
$('miniTeams').hidden = !showTeams;

// What shows and fades: the card, or with ?size=mini the small timer.
const card = $(mini ? 'mini' : 'card');
const msg = $('message');
let start: number | null = null, offset = 0, gameKey = '', shown = '';

// Mini: drawn at 80% like the title, and no wider than 600px (long team names scale it down further), so at the
// top it fits between the branding logos as the title does (title.html fitBetweenLogos).
const MINI_SCALE = 0.8, MINI_MAX_WIDTH = 600;
function fitMini() {
  const box = $('mini');
  const was = box.hidden;
  box.hidden = false; // measured shown
  box.style.scale = String(Math.floor(Math.min(MINI_SCALE, MINI_MAX_WIDTH / box.offsetWidth) * 1000) / 1000);
  box.hidden = was;
}
// Fitted again whenever its size changes (a team name, or its face loading late: on 13 Nov a name drawn before its
// font loaded left it too wide). Its scale doesn't change the size it's laid out at, so this never loops.
if (mini) new ResizeObserver(() => fitMini()).observe($('mini'));

function clock(time?: string) {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : (time || '');
}
function setLogo(id: string, team: CountdownTeam) {
  const node = logoEl(team, 'countdown__logo');
  node.id = id;
  $(id).replaceWith(node);
}
function setNum(id: string, value: string) {
  const node = $(id);
  if (node.textContent === value) return;
  node.textContent = value;
  node.classList.remove('tick');
  void node.offsetWidth; // restart the animation
  node.classList.add('tick');
}

// Redrawn from the clock each time, so it keeps time at any frame rate and after a stall.
function render() {
  if (start === null) return;
  const leftMs = start - (Date.now() + offset);
  const left = Math.max(0, Math.ceil(leftMs / 1000));
  // Opacity worked out from the time left, so the fade is smooth at any frame rate.
  card.classList.toggle('is-fading', !!fadeMs && leftMs < fadeMs);
  card.style.opacity = fadeMs && leftMs < fadeMs ? Math.max(0, leftMs / fadeMs).toFixed(3) : '';
  const state = left > 0 ? 'counting' : 'ended';
  if (state === 'ended') {
    if (shown !== 'ended') {
      shown = 'ended';
      window.pageLog?.('info', `Countdown reached zero for game ${gameKey}`);
      $('clock').hidden = true;
      $('label').hidden = true;
      card.classList.remove('is-final');
      if (endHides) card.classList.add('is-gone');
      else { $('end').textContent = endText; $('end').hidden = false; $('miniTime').textContent = endText; $('miniTime').classList.add('is-end'); }
    }
    return;
  }
  if (shown !== 'counting') { shown = 'counting'; $('clock').hidden = false; $('label').hidden = false; $('end').hidden = true; $('miniTime').classList.remove('is-end'); card.classList.remove('is-gone'); }
  const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
  // Mini: one line, 4:32, 1:04:32, or 2 days 4:05:00.
  const two = (n: number) => String(n).padStart(2, '0');
  const miniTime = `${d ? `${d} ${d === 1 ? 'day' : 'days'} ` : ''}${d || h ? `${h}:${two(m)}` : m}:${two(s)}`;
  if ($('miniTime').textContent !== miniTime) $('miniTime').textContent = miniTime;
  $('daysUnit').hidden = d === 0;
  $('daysLabel').textContent = d === 1 ? 'Day' : 'Days';
  $('hoursUnit').hidden = d === 0 && h === 0;
  setNum('days', String(d));
  setNum('hours', String(h).padStart(2, '0'));
  setNum('mins', String(m).padStart(2, '0'));
  setNum('secs', String(s).padStart(2, '0'));
  card.classList.toggle('is-final', left <= 10);
}

async function load() {
  try {
    const g: Countdown = await (await fetch('/api/countdown', { cache: 'no-store' })).json();
    if (g.serverNow) offset = g.serverNow - Date.now();
    const key = `${g.gameId}|${g.start}|${g.home && g.home.name}|${g.away && g.away.name}`;
    if (g.error) {
      if (key !== gameKey) { gameKey = key; console.warn('Countdown unavailable:', g.error); }
      start = null;
      card.hidden = true;
      msg.textContent = `Countdown unavailable: ${g.error}`;
      msg.hidden = false;
      return;
    }
    msg.hidden = true;
    if (key === gameKey) return;
    gameKey = key;
    window.pageLog?.('info', `Counting down to ${g.home.name} v ${g.away.name} (game ${g.gameId}) at ${g.date} ${g.time}`);
    start = g.start;
    shown = '';
    $('comp').textContent = g.competition || '';
    $('homeName').textContent = g.home.name;
    $('awayName').textContent = g.away.name;
    $('miniTeams').textContent = `${g.home.name} v ${g.away.name}`;
    if (mini) fitMini();
    setLogo('homeLogo', g.home);
    setLogo('awayLogo', g.away);
    const info = $('info');
    info.replaceChildren();
    [g.division, g.round, g.court, clock(g.time), g.venueName].filter(Boolean).forEach(t => info.appendChild(el('span', '', t)));
    card.hidden = false;
    render();
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Countdown could not reach the helper:', why);
  }
}

// Asks which game is next when the picked game changes (over Studio's scene socket), not every five seconds.
let pickedKey = '';
sceneEvents<unknown, { gameId?: string; date?: string; time?: string }>(null, { board: b => {
  const key = `${b.gameId}|${b.date}|${b.time}`;
  if (key === pickedKey) return;
  pickedKey = key;
  load();
} });
(function frame() { render(); requestAnimationFrame(frame); })();

// What makes this file a module (its names its own), as the first line says.
export {};
