// FirstPass Studio - the lower third's script (lowerthird.html loads it as a module, so its names stay its own).

// What /api/lowerthird answers: the competition's logos, and the athlete named (their team, logo and photo) when it's one.
interface Athlete { name: string; team: string; logo?: string | null; known: boolean; photo?: string | null; silhouette?: string }
interface LowerThird extends LogoRules { competition: string; athlete: Athlete | null; error?: string }
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const type = params.get('type') === 'guest' ? 'guest' : 'athlete';
const name = (params.get('name') || '').trim();
const title = (params.get('title') || '').trim();
const position = params.get('position') || '';
if (['center', 'bottom', 'bottom-center', 'right', 'bottom-right', 'left-half', 'bottom-left-half'].includes(position)) document.body.classList.add(position);
if (position === 'right' || position === 'bottom-right') $('l3').classList.add('l3--right');

// Puts the words in el, squeezed narrower to fit its width (down to `squeeze`, 0.7 is 70% of their width).
// Only words still too wide squeezed that far get a smaller font, never below `smallest` px.
function fitText(el: HTMLElement, text: string, squeeze: number, smallest: number) {
  const span = el.appendChild(document.createElement('span'));
  span.textContent = text;
  const room = el.clientWidth;
  let size = parseInt(getComputedStyle(el).fontSize, 10);
  while (span.offsetWidth * squeeze > room && size > smallest) { size -= 2; el.style.fontSize = size + 'px'; }
  const fit = Math.min(1, room / span.offsetWidth);
  if (fit < 1) span.style.scale = `${Math.floor(fit * 1000) / 1000} 1`;
  if (fit < 1 || size < smallest + 1) window.pageLog?.('info', `Lower third: "${text}" squeezed to ${Math.round(fit * 100)}% width at ${size}px to fit`);
}

function show(d: LowerThird) {
  const comp = params.get('mode') === 'light' ? d.competitionLogoLight || d.competitionLogoDark : d.competitionLogoDark || d.competitionLogoLight;
  const a = type === 'athlete' ? d.athlete : null;
  let lineText = '';
  const shown = (params.get('display') || '').trim() || (a ? a.name : name);
  if (a) {
    lineText = [a.team, title].filter(Boolean).join('  ·  ');
    $('badge').append(a.team ? logoEl({ name: a.team, logo: a.logo }, 'l3__logo') : logoEl({ name: d.competition, logo: comp }, 'l3__logo'));
    if (!a.known) console.warn(`Lower third: ${a.name} isn't in the competition's athletes yet, so their team isn't known (add &team=)`);
    if (params.get('photo') === '1') { $<HTMLImageElement>('photo').src = a.photo || a.silhouette || ''; $('photo').hidden = false; $('bar').classList.add('has-photo'); }
  } else {
    lineText = title;
    $('badge').append(logoEl({ name: d.competition, logo: comp }, 'l3__logo'));
  }
  $('tag').textContent = params.get('tag') || '';
  $('l3').hidden = false;
  document.fonts.ready.then(() => {
    fitText($('name'), shown, 0.7, 36);
    if (lineText) fitText($('line'), lineText, 0.8, 20);
    $('stage').classList.add('go');
    window.pageLog?.('info', `Lower third: ${type} ${shown}${lineText ? ' / ' + lineText : ''}`);
  });
  const out = Number(params.get('out'));
  if (out > 0) setTimeout(() => { $('stage').classList.replace('go', 'away'); studioDone(600); }, out * 1000);
}

(async () => {
  if (!name) {
    $('message').textContent = type === 'guest' ? 'Lower third: type the guest\'s name (name=)' : 'Lower third: pick an athlete (name=)';
    $('message').hidden = false;
    console.warn('Lower third: no name given');
    return;
  }
  try {
    const q = new URLSearchParams({ type, name });
    const team = params.get('team');
    if (team) q.set('team', team);
    const res = await fetch('/api/lowerthird?' + q, { cache: 'no-store' });
    const d: LowerThird = await res.json();
    if (d.error && res.status >= 400) throw new Error(d.error);
    show(d);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Lower third unavailable:', why);
    show({ competition: '', athlete: type === 'athlete' ? { name, team: params.get('team') || '', known: true } : null });
  }
})();

// What makes this file a module (its names its own), as the first line says.
export {};
