// FirstPass Studio - the sponsor wall's script (sponsorwall.html loads it as a module, so its names stay its own).

// What /api/sponsors/wall answers: the competition's sponsors by tier, each tier with its vacancy card when it has room.
interface Vacancy { heading: string; contact?: string }
interface WallTier { key: string; name: string; sponsors: Sponsor[]; vacancy?: Vacancy | null }
interface Wall { competition?: string; tiers: WallTier[]; error?: string }
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

function tile(s: Sponsor, delay: number) {
  const t = el('div', 'swall__tile');
  t.style.animationDelay = `${delay}s`;
  if (s.logoUrl) {
    const img = new Image();
    img.alt = s.name;
    img.onerror = () => { img.replaceWith(el('div', 'words', s.name)); };
    img.src = s.logoUrl;
    t.append(img);
    if (params.get('names') === '1') t.append(el('div', 'label', s.name));
  } else t.append(el('div', 'words', s.name));
  return t;
}
function vacancyTile(v: Vacancy, delay: number) {
  const t = el('div', 'swall__tile vacant');
  t.style.animationDelay = `${delay}s`;
  const img = new Image();
  img.alt = '';
  img.src = '/api/sponsors/qr.svg?vacancy=1';
  const words = el('div');
  words.append(el('div', 'words', v.heading), el('div', 'sub', v.contact ? `Scan or talk to ${v.contact}` : 'Scan to find out how'));
  t.append(img, words);
  return t;
}

(async () => {
  try {
    const tiers = params.get('tiers');
    const q = tiers ? `?tiers=${encodeURIComponent(tiers)}` : '';
    const r: Wall = await (await fetch(`/api/sponsors/wall${q}`, { cache: 'no-store' })).json();
    if (r.error) throw new Error(r.error);
    if (!r.tiers.length) throw new Error('No sponsors to show yet: add them on the Sponsors page');
    $('comp').textContent = r.competition || '';
    $('comp').hidden = !r.competition;
    const title = params.get('title');
    if (title) $('title').textContent = title;
    let delay = 0.3;
    for (const t of r.tiers) {
      const box = el('section', `swall__tier t-${t.key}`);
      const names = params.get('tiernames') !== '0';
      if (names) box.append(el('div', 'swall__tiername', t.name)); else box.classList.add('nonames');
      const row = el('div', 'swall__row');
      for (const s of t.sponsors) { row.append(tile(s, delay)); delay += 0.08; }
      if (t.vacancy) row.append(vacancyTile(t.vacancy, delay));
      box.append(row);
      if (names) box.append(el('div'));
      $('tiers').append(box);
      delay += 0.15;
    }
    $('card').hidden = false;
    window.pageLog?.('info', `Sponsor wall: ${r.tiers.map(t => `${t.name} ${t.sponsors.length}`).join(', ')}`);
    const out = Number(params.get('out'));
    if (out > 0) {
      setTimeout(() => { $('card').classList.add('out'); }, out * 1000);
      studioDone(out * 1000 + 700);
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Sponsor wall unavailable:', why);
    $('message').textContent = why;
    $('message').hidden = false;
  }
})();

// What makes this file a module (its names its own), as the first line says.
export {};
