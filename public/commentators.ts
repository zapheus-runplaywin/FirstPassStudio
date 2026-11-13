// FirstPass Studio - the commentators graphic's script (commentators.html loads it as a module, so its names stay its own).

// Who is on the mic, as the Production Planner knows them (/api/planner/onair): a guest has a headshot.
interface Person { name: string; guest?: boolean; headshot?: string }
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const asked = params.get('style');
const style = asked === 'box' || asked === 'lowerthirds' ? asked : 'line';
document.body.classList.add(style + '-style');
// The names typed in its options, else whoever the Production Planner has on the mic for the game on the
// scoreboard (see the start, below).
let names = ['name', 'name2', 'name3', 'name4'].map(k => (params.get(k) || '').trim()).filter(Boolean);
// The same people as { name, guest, headshot }: only the Production Planner knows who is a guest and has their headshot.
let people: Person[] = names.map(name => ({ name }));
const rawLabel = params.get('label');
let label = '';
// The label typed in, else Commentator(s), or Special guest commentator(s) when every planned name is a special guest.
const labelFor = (guest: boolean) => rawLabel === '0' ? '' : (rawLabel || '').trim()
  || `${guest ? 'Special guest commentator' : 'Commentator'}${names.length === 1 ? '' : 's'}`;
const position = params.get('position') || '';
const places = style === 'box' ? ['under-left', 'under-right', 'center'] : style === 'lowerthirds' ? ['above'] : ['center', 'bottom', 'bottom-center'];
if (places.includes(position)) document.body.classList.add(position);
else if (style === 'box') document.body.classList.add('corner');

// Squeezes the words in el narrower to fit its width (down to `squeeze`, 0.7 is 70% of their width), and only
// then makes their font smaller, never below `smallest` px. el holds one span (the words).
function fitText(el: HTMLElement, squeeze: number, smallest: number) {
  const span = el.firstElementChild as HTMLElement;
  const room = el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight);
  let size = parseInt(getComputedStyle(el).fontSize, 10);
  while (span.offsetWidth * squeeze > room && size > smallest) { size -= 2; el.style.fontSize = size + 'px'; }
  const fit = Math.min(1, room / span.offsetWidth);
  if (fit < 1) span.style.scale = `${Math.floor(fit * 1000) / 1000} 1`;
  if (fit < 1 || size < smallest + 1) window.pageLog?.('info', `Commentators: "${span.textContent}" squeezed to ${Math.round(fit * 100)}% width at ${size}px to fit`);
}

// "Honey Harrington and Will Linter", "A, B and C", with the "and" in yellow.
function joined(list: string[]) {
  const span = document.createElement('span');
  list.forEach((n, i) => {
    if (i) {
      const and = span.appendChild(document.createElement('span'));
      and.className = 'and';
      and.textContent = i === list.length - 1 ? ' and ' : ', ';
      and.style.whiteSpace = 'pre';
    }
    span.append(n);
  });
  return span;
}

// A lower third for each person (up to three), side by side: the full bar for one, half width left and right for two,
// a third each for three. The pink tab is the label typed in, else Special guest for a planned special guest; the
// yellow line is ?title= (Commentator); with ?photo=1 a headshot takes the logo's place.
function showThirds(comp: string | undefined, competition: string) {
  const shown = people.slice(0, 3);
  if (people.length > 3) console.warn(`Commentators: the lower thirds fit three people, so ${people.slice(3).map(x => x.name).join(', ')} is left out`);
  const tab = rawLabel === '0' ? null : (rawLabel || '').trim();
  const rawTitle = params.get('title');
  const title = rawTitle === '0' ? '' : (rawTitle || '').trim() || 'Commentator';
  const photos = params.get('photo') === '1';
  $('thirds').classList.add(['one', 'two', 'three'][shown.length - 1]);
  shown.forEach((x, i) => {
    const l3 = $('thirds').appendChild(document.createElement('div'));
    l3.className = 'l3' + (shown.length === 2 && i === 1 ? ' l3--right' : '');
    l3.style.setProperty('--delay', (i * 0.2) + 's');
    l3.innerHTML = '<div class="l3__tag"></div><div class="l3__bar"><div class="l3__badge"></div><div class="l3__text"><div class="l3__name"></div><div class="l3__line"></div></div></div>';
    l3.querySelector('.l3__tag')!.textContent = tab === null ? '' : tab || (x.guest ? 'Special guest' : '');
    const badge = l3.querySelector('.l3__badge')!;
    if (photos && x.headshot) {
      const img = document.createElement('img');
      img.className = 'l3__photo';
      img.alt = '';
      img.src = x.headshot;
      badge.replaceWith(img);
    } else badge.append(logoEl({ name: competition, logo: comp }, 'l3__logo'));
    l3.querySelector('.l3__name')!.appendChild(document.createElement('span')).textContent = x.name;
    if (title) l3.querySelector('.l3__line')!.appendChild(document.createElement('span')).textContent = title;
  });
  $('thirds').hidden = false;
}

function show(d: LogoRules & { competition?: string }) {
  const comp = params.get('mode') === 'light' ? d.competitionLogoLight || d.competitionLogoDark : d.competitionLogoDark || d.competitionLogoLight;
  if (style === 'lowerthirds') showThirds(comp, d.competition || '');
  else if (style === 'line') {
    $('lineLabel').textContent = label;
    $('lineNames').append(joined(names));
    $('line').hidden = false;
  } else {
    if (label) $('boxLabel').appendChild(document.createElement('span')).textContent = label;
    // In the corner the competition logo is right beside the box, so the box doesn't repeat it unless asked to.
    const logo = params.get('logo');
    const withLogo = logo ? logo !== '0' : places.includes(position);
    if (withLogo) {
      if (comp || d.competition) $('badge').append(logoEl({ name: d.competition, logo: comp }, 'box__logo'));
    }
    for (const n of names) {
      const row = $('boxNames').appendChild(document.createElement('div'));
      row.className = 'box__name';
      row.appendChild(document.createElement('span')).textContent = n;
    }
    $('box').hidden = false;
  }
  document.fonts.ready.then(() => {
    if (style === 'lowerthirds') {
      document.querySelectorAll<HTMLElement>('.l3__name').forEach(el => fitText(el, 0.7, Math.round(parseInt(getComputedStyle(el).fontSize, 10) * 0.75)));
      document.querySelectorAll<HTMLElement>('.l3__line:not(:empty)').forEach(el => fitText(el, 0.8, 16));
    } else if (style === 'line') fitText($('lineNames'), 0.75, 24);
    else document.querySelectorAll<HTMLElement>('.box__name, .box__label:not(:empty)').forEach(el => fitText(el, 0.7, el.classList.contains('box__label') ? 12 : 20));
    $('stage').classList.add('go');
    window.pageLog?.('info', `Commentators (${style}): ${label ? label + ': ' : ''}${names.join(', ')}`);
  });
  const out = Number(params.get('out'));
  if (out > 0) setTimeout(() => { $('stage').classList.replace('go', 'away'); studioDone(600); }, out * 1000);
}

(async () => {
  let guest = false;
  if (!names.length) {
    try {
      const on: { people?: Person[]; guest?: boolean; game?: string } = await (await fetch('/api/planner/onair', { cache: 'no-store' })).json();
      people = (on.people || []).slice(0, 4);
      names = people.map(x => x.name);
      guest = !!on.guest;
      if (names.length) window.pageLog?.('info', `Commentators: from the Production Planner for ${on.game}`);
    } catch (err) { console.warn('Commentators: the Production Planner is unavailable:', err instanceof Error ? err.message : err); }
  }
  label = labelFor(guest);
  if (!names.length) {
    $('message').textContent = 'Commentators: nobody is planned on the mic for this game in the Production Planner. Plan them there, or type their names (name=, name2=)';
    $('message').hidden = false;
    console.warn('Commentators: no names given');
    return;
  }
  if (style === 'line') return show({});
  try {
    const res = await fetch('/api/lowerthird?type=guest', { cache: 'no-store' });
    const d: LogoRules & { competition?: string; error?: string } = await res.json();
    if (d.error && res.status >= 400) throw new Error(d.error);
    show(d);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Commentators: competition logo unavailable:', why);
    show({ competition: '' });
  }
})();

// What makes this file a module (its names its own), as the first line says.
export {};
