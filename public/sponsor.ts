// FirstPass Studio - the sponsor card's script (sponsor.html loads it as a module, so its names stay its own).

// What /api/sponsors/next?place=card answers: the sponsor to show, the tier's vacancy card, or none.
interface CardSponsor extends Sponsor {
  id: string; colour?: string; tier?: string; tierName?: string; tagline?: string; offer?: string; website?: string; qrLink?: string;
}
interface Vacancy { heading: string; message?: string; contact?: string }
interface NextSponsor { sponsor?: CardSponsor; vacancy?: Vacancy; none?: boolean; error?: string }
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const off = (k: string) => params.get(k) === '0';
const show = (id: string, text?: string | null) => { $(id).textContent = text || ''; $(id).hidden = !text; };

function plate(src: string | null | undefined, words: string, vacant = false) {
  const p = $('plate');
  p.classList.toggle('vacant', vacant);
  if (src) {
    const img = new Image();
    img.alt = '';
    img.onerror = () => { p.replaceChildren(initials(words)); };
    img.src = src;
    p.replaceChildren(img);
  } else p.replaceChildren(initials(words));
}
function initials(words: string) { const d = document.createElement('div'); d.className = 'initials'; d.textContent = words; return d; }
function qr(src: string | null) {
  if (off('qr') || !src) { $('qr').hidden = true; $('body').classList.add('noqr'); return; }
  $<HTMLImageElement>('qrImg').src = src;
  $('qr').hidden = false;
}

(async () => {
  try {
    const q = new URLSearchParams({ place: 'card' });
    const own = params.get('sponsor'), tiers = params.get('tiers');
    if (own) q.set('sponsor', own);
    if (tiers) q.set('tiers', tiers);
    const r: NextSponsor = await (await fetch(`/api/sponsors/next?${q}`, { cache: 'no-store' })).json();
    if (r.error) throw new Error(r.error);
    if (r.none) throw new Error(own ? `There is no sponsor "${own}" on the Sponsors page` : 'No sponsors to show yet: add them on the Sponsors page');
    if (r.vacancy) {
      const v = r.vacancy;
      show('heading', params.get('title') || 'Sponsor this stream');
      plate(null, 'Your logo here', true);
      show('name', v.heading);
      show('tagline', v.message);
      show('site', v.contact ? `Talk to ${v.contact}` : '');
      qr('/api/sponsors/qr.svg?vacancy=1');
      window.pageLog?.('info', 'Showing the vacancy card');
    } else {
      const s = r.sponsor;
      if (!s) throw new Error('No sponsors to show yet: add them on the Sponsors page');
      if (s.colour) $('card').style.setProperty('--brand', s.colour);
      show('heading', params.get('title') || 'Brought to you by');
      show('tier', s.tierName && s.tier === 'naming' ? s.tierName : '');
      plate(s.logoUrl, s.name);
      show('name', s.name);
      show('tagline', off('tagline') ? '' : s.tagline);
      show('offer', off('offer') ? '' : s.offer);
      show('site', s.website);
      qr(s.qrLink ? `/api/sponsors/qr.svg?id=${encodeURIComponent(s.id)}&place=card` : null);
      window.pageLog?.('info', `Showing ${s.name}`);
    }
    $('card').hidden = false;
    const out = Number(params.get('out'));
    if (out > 0) {
      setTimeout(() => { $('card').classList.add('out'); }, out * 1000);
      studioDone(out * 1000 + 700);
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Sponsor unavailable:', why);
    show('message', why);
  }
})();

// What makes this file a module (its names its own), as the first line says.
export {};
