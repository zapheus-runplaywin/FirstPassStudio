// FirstPass Studio - the up next card's script (upnext.html loads it as a module, so its names stay its own).

// What /api/upnext answers: the next game on this court, or (none left tonight) the end of night card's words.
interface UpNext {
  competition?: string; division?: string; round?: string; time?: string; court?: string; venueName?: string; error?: string;
  home: { name: string }; away: { name: string }; logos?: { home?: string; away?: string }; wrap?: NightWrap;
}
interface NightWrap extends Wrap { round: string; competition: string; organisation?: string; competitionLogoLight?: string; competitionLogoDark?: string }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function clock(time?: string) {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : (time || '');
}
function setLogo(id: string, name: string, logo?: string) {
  const node = logoEl({ name, logo }, 'matchup__logo');
  node.id = id;
  $(id).replaceWith(node);
}

const params = new URLSearchParams(location.search);
// The end of night card: no game after this one tonight.
function showWrap(w: NightWrap) {
  const set = (id: string, text: string) => { $(id).textContent = text; };
  const words = wrapWords(w);
  set('wrapRound', w.round);
  set('wrapTitle', words.title);
  set('wrapComp', w.competition);
  set('wrapOrg', w.organisation && w.organisation !== w.competition ? w.organisation : '');
  const logo = (params.get('mode') === 'dark' ? w.competitionLogoDark : w.competitionLogoLight) || w.competitionLogoLight;
  const img = $<HTMLImageElement>('wrapLogo');
  if (logo) { img.src = logo; img.hidden = false; img.onerror = () => { img.hidden = true; }; }
  set('wrapInvite', params.get('message') || words.invite);
  set('wrapWhen', words.detail);
  $('wrap').hidden = false;
  confetti();
  sponsors();
}
// Thanks to our sponsors: their logos on white plates, naming rights to Major (?sponsors=all for every tier).
async function sponsors() {
  const want = params.get('sponsors');
  if (want === '0') return;
  try {
    const tiers = want === 'all' ? '' : '&tiers=naming,elite,major';
    const r: { tiers?: { sponsors: Sponsor[] }[] } = await (await fetch(`/api/sponsors/wall?place=night&max=8${tiers}`, { cache: 'no-store' })).json();
    const list = (r.tiers || []).flatMap(t => t.sponsors).slice(0, 8);
    if (!list.length) return;
    const row = $('wrapSponsorRow');
    for (const s of list) {
      const plate = document.createElement('div');
      plate.className = 'wrap__sponsor';
      const words = () => { const w = document.createElement('span'); w.textContent = s.name; return w; };
      if (s.logoUrl) {
        const img = new Image();
        img.alt = s.name;
        img.onerror = () => { img.replaceWith(words()); };
        img.src = s.logoUrl;
        plate.append(img);
      } else plate.append(words());
      row.append(plate);
    }
    $('wrapSponsors').hidden = false;
    window.pageLog?.('info', `End of night sponsors: ${list.map(s => s.name).join(', ')}`);
  } catch (err) { console.warn('Sponsors unavailable:', err instanceof Error ? err.message : err); }
}
// A short burst of confetti in the competition's colours, falling once behind the words.
function confetti() {
  const box = $('confetti');
  const colours = ['var(--yellow)', 'var(--pink)', 'var(--text)', 'var(--yellow-light)'];
  for (let i = 0; i < 36; i++) {
    const bit = document.createElement('i');
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = colours[i % colours.length];
    bit.style.animationDelay = `${0.2 + Math.random() * 1.4}s`;
    bit.style.animationDuration = `${2.4 + Math.random() * 1.6}s`;
    bit.style.setProperty('--spin', `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540)}deg`);
    bit.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 160)}px`);
    if (i % 3 === 0) bit.style.borderRadius = '50%';
    box.appendChild(bit);
  }
}

(async () => {
  const msg = $('message');
  try {
    const wrap = params.get('wrap');
    const g: UpNext = await (await fetch(`/api/upnext${wrap === '0' || wrap === '1' ? `?wrap=${wrap}` : ''}`, { cache: 'no-store' })).json();
    if (g.wrap) return showWrap(g.wrap);
    if (g.error) throw new Error(g.error);
    $('comp').textContent = g.competition || '';
    $('division').textContent = [g.division, g.round].filter(Boolean).join('  ·  ');
    $('homeName').textContent = g.home.name;
    $('awayName').textContent = g.away.name;
    setLogo('homeLogo', g.home.name, g.logos && g.logos.home);
    setLogo('awayLogo', g.away.name, g.logos && g.logos.away);
    $('time').textContent = clock(g.time);
    const info = $('info');
    info.replaceChildren();
    [g.court, g.venueName].filter(Boolean).forEach(t => info.appendChild(el('span', '', t)));
    $('card').hidden = false;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Up next unavailable:', why);
    msg.textContent = `Up next unavailable: ${why}`;
    msg.hidden = false;
  }
})();

// What makes this file a module (its names its own), as the first line says.
export {};
