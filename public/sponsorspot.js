// FirstPass Studio - sponsor spots on the graphics: "presented by" a sponsor of the competition in use
// (Sponsors page, sponsors.js). Each page asks for its sponsor once when it loads:
//   sponsorSpot.naming(place)        the naming rights sponsor (or what the competition's empty-tier rule gives
//                                    instead), for the title, scoreboard tab and countdown
//   sponsorSpot.next(place, tiers)   the next sponsor in rotation from those tiers (Major and up by default), for
//                                    footers on the stat cards and the ticker; each call is a turn
//   sponsorSpot.badge(sponsor, opts) a "presented by [logo]" element: the logo on a small white plate, or the name
//   sponsorSpot.moment(key, box)     a moment's "brought to you by" tag (super shot, hot streaks, game moments): the
//                                    sponsor that owns it, or the Elite sponsors taking turns; asked each time it plays
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

  // A sponsored moment's tag: "brought to you by [logo]" on a white pill in box (the animation's stage, which
  // fades it out with everything else). It comes in at --moment-at (1.1 s) once the stage has class "go",
  // at --moment-top (800px). Asked each time the moment plays, so the Elite sponsors take turns; null hides it.
  const TAG_SECONDS = 2;
  async function moment(key, box) {
    let tag = box && box.querySelector(':scope > .sponsor-moment');
    let s = null;
    if (!off) {
      try {
        const q = new URLSearchParams({ moment: key, seconds: TAG_SECONDS });
        if (own) q.set('sponsor', own);
        const r = await (await fetch(`/api/sponsors/moment?${q}`, { cache: 'no-store' })).json();
        s = r && r.sponsor ? r.sponsor : null;
      } catch (err) { console.warn('Sponsor unavailable:', err.message); }
    }
    if (!box) return s;
    if (!s) { if (tag) tag.hidden = true; return null; }
    if (!tag) {
      style();
      if (!document.getElementById('sponsorMomentCss')) {
        const css = document.createElement('style');
        css.id = 'sponsorMomentCss';
        css.textContent = `
          .sponsor-moment { position: absolute; left: 0; right: 0; top: var(--moment-top, 800px); display: flex; justify-content: center; opacity: 0; pointer-events: none; }
          .sponsor-moment > span { background: #fff; color: #111; border-radius: 999px; padding: 10px 30px 10px 34px; font-size: 40px; box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
            font-family: var(--font, "Montserrat"), "Montserrat", sans-serif; }
          .sponsor-moment .sponsor-badge__plate { padding: 0; height: 1.6em; }
          .go .sponsor-moment { animation: sponsorMomentIn .4s cubic-bezier(.2,.9,.2,1) var(--moment-at, 1.1s) forwards; }
          @keyframes sponsorMomentIn { 0% { opacity: 0; transform: translateY(30px) scale(.9); } 100% { opacity: 1; transform: none; } }`;
        document.head.append(css);
      }
      tag = document.createElement('div');
      tag.className = 'sponsor-moment';
      box.append(tag);
    }
    const pill = document.createElement('span');
    pill.append(badge(s, { words: 'Brought to you by' }));
    tag.replaceChildren(pill);
    tag.hidden = false;
    const img = pill.querySelector('img');
    if (img) await Promise.race([img.decode().catch(() => {}), new Promise(r => setTimeout(r, 1000))]);
    return s;
  }

  window.sponsorSpot = { naming, next, badge, footer, moment, off };
})();
