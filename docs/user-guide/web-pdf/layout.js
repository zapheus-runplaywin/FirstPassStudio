// Arranges the guide's chapters into the marketing layout: a hero per chapter, sections as groups with
// screenshots framed and floated beside their text, galleries as bento grids, and a pull quote. The text
// is the guide's own; nothing here writes new copy except the frame labels.
const WIN_TITLES = [
  [/^s-output|^s-sequence|^s-playlist/, 'Output'], [/^s-control/, 'Scoreboard control'], [/^s-setup/, 'Competitions setup'],
  [/^s-sponsorreport/, 'Sponsor report'], [/^s-sponsor/, 'Sponsors'], [/^s-athlete/, 'Athletes'],
  [/^s-devices/, 'Devices'], [/^s-planner/, 'Production Planner'], [/^s-docs/, 'Docs'],
];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fileOf = img => (img.getAttribute('src') || '').split('/').pop().replace(/\.\w+$/, '');

function frame(fig, inChapter) {
  const img = fig.querySelector('img'); if (!img || fig.dataset.framed) return;
  fig.dataset.framed = 1;
  const name = fileOf(img);
  const kind = fig.dataset.frame || (name.startsWith('s-') ? 'win' : name.startsWith('g-') ? 'mon' : 'plain');
  if (kind === 'plain') {
    const box = el('div', 'win plain'); const shot = el('div', 'shot'); img.replaceWith(box); shot.appendChild(img); box.appendChild(shot);
  } else if (kind === 'win') {
    const title = fig.dataset.title || (WIN_TITLES.find(([re]) => re.test(name)) || [, 'FirstPass Studio'])[1];
    const box = el('div', 'win'); box.appendChild(el('div', 'bar', `<i></i><i></i><i></i><span>FirstPass Studio · <b>${title}</b></span>`));
    const shot = el('div', 'shot'); img.replaceWith(box); shot.appendChild(img); box.appendChild(shot);
  } else {
    const box = el('div', 'mon'); img.replaceWith(box); box.appendChild(img);
    const b = fig.querySelector('figcaption b');
    const chip = b ? el('div', 'chip', `<u>Studio</u><s>${b.textContent.replace(/[.:]\s*$/, '')}</s>`) : null;
    if (!inChapter) {
      if (chip) box.appendChild(chip);
      if (name.startsWith('g-') && !img.src.includes('/crop/')) box.appendChild(el('div', 'res', '1920 × 1080'));
      return;
    }
    // In a chapter the monitor gets a bezel under the picture: the graphic's name, and where it sits on the
    // 1920 × 1080 frame. A graphic that fills little of the frame is shown close up.
    const foot = el('div', 'foot'); if (chip) foot.appendChild(chip); else foot.appendChild(el('i'));
    const z = ZOOM[name];
    if (z) {
      img.src = `../img-web/crop/${name}.jpg`; box.classList.add('zoom');
      const [x, y, w, h] = z.map(v => (v * 100).toFixed(2) + '%');
      foot.appendChild(el('div', 'map', `<span>Close up · on screen</span><div class="frame"><em style="left:${x};top:${y};width:${w};height:${h}"></em></div>`));
    } else if (name.startsWith('g-')) foot.appendChild(el('div', 'map', '<span>Full frame · 1920 × 1080</span>'));
    box.appendChild(foot);
  }
}

function hero(page, sec) {
  const ch = +page.dataset.ch;
  const h = el('div', 'hero');
  h.innerHTML = COURT;
  const bg = el('div', 'bgimg'); bg.style.backgroundImage = `url(${page.dataset.hero})`; h.appendChild(bg);
  h.appendChild(el('div', 'num', String(ch).padStart(2, '0')));
  h.appendChild(el('div', 'kick', `Chapter ${ch} of 11`));
  const h2 = sec.querySelector('h2'); h.appendChild(el('h2', '', h2.innerHTML)); h2.remove();
  const lead = sec.querySelector('p.lead'); if (lead) { h.appendChild(el('p', 'lead', lead.innerHTML)); lead.remove(); }
  const toc = sec.querySelector('.inthis');
  if (toc) {
    const row = el('div', 'toc');
    toc.querySelectorAll('a').forEach((a, i) => row.appendChild(el('span', '', `<b>${i + 1}</b>${a.textContent.replace(/^\d+/, '')}`)));
    h.appendChild(row); toc.remove();
  }
  sec.querySelector('.chno')?.remove();
  return h;
}

function groups(sec) {
  const out = []; let cur = { head: null, nodes: [] };
  [...sec.children].forEach(n => {
    if (n.tagName === 'H3') { if (cur.head || cur.nodes.length) out.push(cur); cur = { head: n, nodes: [] }; }
    else cur.nodes.push(n);
  });
  if (cur.head || cur.nodes.length) out.push(cur);
  return out;
}

const ratio = img => img.naturalHeight / img.naturalWidth;
const shownRatio = f => { const n = fileOf(f.querySelector('img')); const z = ZOOM[n]; return z ? (z[3] * 1080) / (z[2] * 1920) : ratio(f.querySelector('img')); };

// Two figures side by side, their widths set so the pictures come out about the same height.
function duo(a, b) {
  const d = el('div', 'duo');
  let wa = 1 / shownRatio(a), wb = 1 / shownRatio(b);
  const t = wa + wb; wa = Math.min(.66, Math.max(.34, wa / t)); wb = 1 - wa;
  d.style.gridTemplateColumns = `${wa.toFixed(3)}fr ${wb.toFixed(3)}fr`;
  a.before(d); d.append(a, b);
  return d;
}

// A gallery as rows: one figure across the top when the count is odd, then pairs.
function rows(gal) {
  const figs = [...gal.children].filter(c => c.tagName === 'FIGURE');
  const b = el('div', 'bento'); gal.before(b);
  let i = 0;
  if (figs.length % 2) { const one = el('div', 'one'); one.appendChild(figs[0]); b.appendChild(one); i = 1; }
  for (; i < figs.length; i += 2) { const holder = el('div'); b.appendChild(holder); holder.append(figs[i], figs[i + 1]); duo(figs[i], figs[i + 1]); holder.replaceWith(...holder.childNodes); }
  [...gal.childNodes].forEach(n => b.appendChild(n));
  gal.remove();
}

function layoutChapter(page) {
  const sec = page.querySelector('section.ch');
  const ch = +page.dataset.ch;
  const run = el('div', 'runhead', `<img src="../img/firstpass-studio.svg" alt=""><span>User guide · <b>${String(ch).padStart(2, '0')}</b> ${page.dataset.title}</span>`);
  const h = hero(page, sec);
  const body = el('div', 'body');
  let fig = 0, side = 0, n = 0;
  const gs = groups(sec);
  gs.forEach((g, gi) => {
    const box = el('div', 'grp');
    if (g.head) { n++; const t = g.head.innerHTML; g.head.innerHTML = `<span class="n">${ch}.${n}</span>${t}`; box.appendChild(g.head); }
    g.nodes.forEach(nd => box.appendChild(nd));
    body.appendChild(box);
    // galleries become bento grids, pairs stay pairs
    box.querySelectorAll(':scope > .gallery, :scope > .stack').forEach(rows);
    box.querySelectorAll(':scope > .two').forEach(t => { const f = [...t.querySelectorAll(':scope > figure')]; if (f.length === 2) { t.before(f[0]); duo(f[0], f[1]); t.remove(); } else t.className = 'duo'; });
    // two or more loose figures in a group pair up at the first one's place; a lone one floats beside the text
    let singles = [...box.querySelectorAll(':scope > figure')];
    while (singles.length >= 2) { const [a, b2] = singles.splice(0, 2); a.before(b2); duo(a, b2); }
    // a group that is only a picture (often the chapter's opening page view): caption on the left, the window on the right
    const rest = [...box.children].filter(c => c.tagName !== 'H3');
    if (singles.length === 1 && rest.length === 1 && fileOf(singles[0].querySelector('img')).startsWith('s-') && ratio(singles[0].querySelector('img')) > .7) {
      box.classList.add('solo'); singles = [];
    }
    singles.forEach(f => {
      const img = f.querySelector('img'); const r = ratio(img);
      f.classList.add('fl');
      if (r < 0.42 || (img.naturalWidth >= 1000 && r < 0.56 && fileOf(img).startsWith('s-'))) { f.classList.add('full'); return; }
      const w = r > 1.25 ? 40 : r > 0.75 ? 46 : 52;
      f.style.width = w + '%';
      f.classList.add(side++ % 2 ? 'l' : 'r');
      // a float goes to the top of its group, under the heading, so text wraps from the start
      const first = g.head ? g.head.nextSibling : box.firstChild;
      if (f !== first) box.insertBefore(f, first);
    });
    // text-only groups with plenty of words run in two columns
    const hasBlock = box.querySelector(':scope > figure, :scope > .bento, :scope > .duo, :scope > table, :scope > .tablewrap, :scope > ol.steps, :scope > .roles, :scope > ul.timeline, :scope > dl.glossary');
    const words = [...box.children].filter(c => c.tagName !== 'H3').map(c => c.textContent).join(' ').length;
    if (!hasBlock && words > 650) {
      box.classList.add('cols'); const txt = el('div', 'txt');
      [...box.children].filter(c => c.tagName !== 'H3').forEach(c => txt.appendChild(c)); box.appendChild(txt);
    }
    // pull quote after the group the quote comes from, or half way
    const q = QUOTES[ch];
    if (q && !page.dataset.quoted) {
      const at = gs.findIndex(x => x.head && x.head.textContent.includes(q[1]));
      const where = at >= 0 ? at : Math.floor(gs.length / 2);
      if (gi === where) { body.appendChild(el('div', 'quote', `<p>${q[0]}<small>Chapter ${ch} · ${page.dataset.title}</small></p>`)); page.dataset.quoted = 1; }
    }
  });
  // runs of short text-only sections sit side by side as tiles
  const plain = g => g.classList.contains('grp') && !g.classList.contains('cols') && g.querySelector(':scope > h3') &&
    ![...g.children].some(c => !['H3', 'P', 'UL'].includes(c.tagName)) && g.textContent.length < 1000;
  let run2 = [];
  const flush = () => { if (run2.length >= 2) { const t = el('div', 'tiles'); run2[0].before(t); run2.forEach(g => { g.classList.add('tile'); t.appendChild(g); }); } run2 = []; };
  [...body.children].forEach(c => { if (plain(c)) run2.push(c); else flush(); }); flush();
  // step cards fill their rows: three across for 3, 6 or 9 steps
  body.querySelectorAll('ol.steps').forEach(ol => { const n = ol.children.length; const c = n % 4 === 0 ? 4 : n % 3 === 0 ? 3 : Math.min(n, 4); ol.style.gridTemplateColumns = `repeat(${c}, 1fr)`; });
  // glossary terms as tiles
  body.querySelectorAll('dl.glossary').forEach(dl => {
    const items = []; let cur;
    [...dl.children].forEach(c => { if (c.tagName === 'DT') { cur = el('div', 'term'); items.push(cur); } cur && cur.appendChild(c); });
    dl.innerHTML = ''; items.forEach(i => dl.appendChild(i));
  });
  body.querySelectorAll('figure').forEach(f => {
    frame(f, true);
    const cap = f.querySelector('figcaption');
    if (cap) { fig++; cap.insertAdjacentHTML('afterbegin', `<span class="no">FIG ${ch}.${fig}</span>`); }
  });
  // in-page links have nowhere to go in a PDF
  body.querySelectorAll('a[href^="#"]').forEach(a => a.replaceWith(...a.childNodes));
  page.innerHTML = ''; page.append(run, h, body);
}

function fitFloats() {
  // A float taller than the words beside it leaves a gap: narrow it until the two roughly match.
  document.querySelectorAll('.grp').forEach(g => {
    g.querySelectorAll(':scope > figure.fl:not(.full)').forEach(f => {
      for (let i = 0; i < 8; i++) {
        const gb = g.getBoundingClientRect(), fb = f.getBoundingClientRect();
        const others = [...g.children].filter(c => c !== f && !c.classList.contains('fl'));
        const lastText = others.length ? Math.max(...others.map(c => c.getBoundingClientRect().bottom)) : gb.top;
        const gap = fb.bottom - lastText;
        const w = parseFloat(f.style.width);
        if (gap < 90 || w <= 40) break;
        f.style.width = (w - 4) + '%';
      }
    });
  });
  // A window still much taller than its words is cut to their height and fades out, so no hole is left.
  document.querySelectorAll('.grp').forEach(g => {
    g.querySelectorAll(':scope > figure.fl:not(.full)').forEach(f => {
      const shot = f.querySelector('.win .shot'); if (!shot) return;
      const others = [...g.children].filter(c => c !== f && !c.classList.contains('fl'));
      if (!others.length) return;
      const lastText = Math.max(...others.map(c => c.getBoundingClientRect().bottom));
      const gap = f.getBoundingClientRect().bottom - lastText;
      const sb = shot.getBoundingClientRect();
      const h = Math.max(420, Math.min(1250, sb.height - gap + 40));
      if (h < sb.height - 40) { shot.classList.add('capped'); shot.style.height = h + 'px'; }
    });
  });
  document.querySelectorAll('.solo .win .shot, .duo .win .shot').forEach(s => {
    if (s.getBoundingClientRect().height > 1300) { s.classList.add('capped'); s.style.height = '1300px'; }
  });
}

function checkQuotes(all) {
  Object.entries(QUOTES).forEach(([ch, [q]]) => {
    const probe = q.replace(/^The one rule that matters on stream night: /, '').replace(/[.]$/, '').slice(0, 60);
    if (!all.includes(probe)) console.warn('quote not found in chapter text', ch, q);
  });
}

window.addEventListener('load', async () => {
  await document.fonts.ready;
  const orig = [...document.querySelectorAll('section.ch')].map(s => s.textContent).join(' ').replace(/\s+/g, ' ');
  document.querySelectorAll('.cover figure, .intro figure').forEach(f => frame(f, false));
  document.querySelectorAll('.page.chapter').forEach(layoutChapter);
  fitFloats();
  checkQuotes(orig);
  document.body.dataset.ready = 1;
});
