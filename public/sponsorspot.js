// FirstPass Studio - sponsor spots on the graphics: "presented by" a sponsor of the competition in use
// (Sponsors page, sponsors.js). Each page asks for its sponsor once when it loads:
//   sponsorSpot.naming(place)        the naming rights sponsor (or what the competition's empty-tier rule gives
//                                    instead), for the title, scoreboard tab and countdown
//   sponsorSpot.next(place, tiers)   the next sponsor in rotation from those tiers (Major and up by default), for
//                                    footers on the stat cards and the ticker; each call is a turn
//   sponsorSpot.badge(sponsor, opts) a "presented by [logo]" element: the logo on a small white plate, or the name
// The page's own ?sponsor= link option wins: ?sponsor=0 shows none, ?sponsor=Golds%20Bakery always that one.
// All resolve to null when there's no sponsor to show, so a page with no sponsors looks as it always did.
(function () {
  const params = new URLSearchParams(location.search);
  const own = (params.get('sponsor') || '').trim();
  const off = own === '0';

  async function ask(q) {
    try {
      const r = await (await fetch(`/api/sponsors/${q}`, { cache: 'no-store' })).json();
      return r && r.sponsor ? r.sponsor : r && r.sponsors && r.sponsors.length ? r.sponsors[0] : null;
    } catch (err) { console.warn('Sponsor unavailable:', err.message); return null; }
  }
  const fixed = place => ask(`next?place=${encodeURIComponent(place)}&sponsor=${encodeURIComponent(own)}`);

  // Naming rights is one sponsor, so the first of the tier (a naming rights tier should only have one).
  async function naming(place) {
    if (off) return null;
    if (own) return fixed(place);
    return ask(`pick?tier=naming&place=${encodeURIComponent(place)}`);
  }
  async function next(place, tiers) {
    if (off) return null;
    if (own) return fixed(place);
    return ask(`next?place=${encodeURIComponent(place)}${tiers ? `&tiers=${encodeURIComponent(tiers)}` : ''}`);
  }

  let styled = false;
  function style() {
    if (styled) return;
    styled = true;
    const css = document.createElement('style');
    css.textContent = `
      .sponsor-badge { display: inline-flex; align-items: center; gap: .55em; white-space: nowrap; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .sponsor-badge__plate { display: inline-flex; align-items: center; justify-content: center; background: #fff; border-radius: .3em; padding: .2em .5em; height: 1.7em; box-sizing: border-box; }
      .sponsor-badge__plate img { height: 100%; max-width: 8em; object-fit: contain; display: block; }
      .sponsor-badge__name { color: inherit; font-weight: 800; letter-spacing: .04em; }
      .sponsor-badge__plate .sponsor-badge__name { color: #111; }`;
    document.head.append(css);
  }

  // "presented by" and the sponsor's logo on a white plate (or its name, when it has no logo or the logo won't load).
  function badge(s, opts = {}) {
    style();
    const wrap = document.createElement('span');
    wrap.className = 'sponsor-badge';
    if (opts.words !== '') wrap.append(document.createTextNode(opts.words || 'Presented by'));
    const name = () => { const n = document.createElement('span'); n.className = 'sponsor-badge__name'; n.textContent = s.name; return n; };
    if (s.logoUrl) {
      const plate = document.createElement('span');
      plate.className = 'sponsor-badge__plate';
      const img = new Image();
      img.alt = s.name;
      img.onerror = () => { img.replaceWith(name()); };
      img.src = s.logoUrl;
      plate.append(img);
      wrap.append(plate);
    } else wrap.append(name());
    return wrap;
  }

  // A stat card's footer: the next sponsor in rotation from Major and up, in the box with id "sponsor".
  async function footer(place) {
    const box = document.getElementById('sponsor');
    const s = await next(place, params.get('tiers') || undefined);
    if (!s || !box) return;
    box.replaceChildren(badge(s));
    box.hidden = false;
  }

  window.sponsorSpot = { naming, next, badge, footer, off };
})();
