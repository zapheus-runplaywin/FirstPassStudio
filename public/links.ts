// FirstPass Studio - the Links list on the Devices tab: every link Studio answers, each drawn the same way (its name,
// what it does, the link, and Copy; Preview for a graphic, Try for a read). It is made from the two lists Studio
// already keeps, so nothing here is written twice:
//   - the graphics, from graphiclinks.js (what each one does) and pageoptions.js (the options its link takes, the
//     same ones the Output page offers as fields), with a link per division for the ladder, finals and top shooters, and one per output for the output canvas;
//   - the Stream Deck links and the status reads, from openapi.yaml (as /openapi.json): each one's summary, description,
//     settings, and its x-links, the ready-made links to copy.
// Stream Deck links are copied with the picked link set's key in front (linksets.js), as a key press needs it; the
// graphics and reads are plain links. Needs graphiclinks.js and pageoptions.js.

'use strict';

// The Links list's handle for the Devices tab (api.html): linksets.js hands over the picked link set's start.
interface StudioLinks { setDeckBase(base: string): void, ready: Promise<void> }
var studioLinks: StudioLinks;

(function () {
  const root = document.getElementById('linkGroups');
  const filter = document.getElementById('linkFilter') as HTMLInputElement | null;
  if (!root) return;
  const list = root;
  // One copyable link drawn on the list, redrawn when the link set (or this Mac's name) changes.
  interface Entry { code: HTMLElement, button: HTMLElement, path: string, deck: boolean }
  // Studio's own openapi.json, the parts the list reads.
  interface ApiParam { name?: string, in?: string, description?: string, schema?: { enum?: string[] } }
  interface ApiOp { summary: string, description?: string, tags?: string[], parameters?: ApiParam[], 'x-links'?: [string, string][] }
  interface ApiDoc { tags?: { name: string, description?: string }[], paths?: Record<string, Record<string, ApiOp>> }
  interface Structure { grades: { name: string, division: string | number }[] }
  interface Output { id: string, name: string }
  let plainBase = location.origin; // this Mac's .local name once /api/version says it
  let deckBase = location.origin;  // with the link set's key in front (/k/<key>)
  const links: Entry[] = [];

  const el = (tag: string, cls?: string | null, text?: string | null) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
  // openapi.yaml's descriptions: plain text with `code` and blank lines between paragraphs.
  const md = (s: string | undefined) => String(s || '').trim().split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`).join('');
  // Copy, on this Mac or another computer (a page opened over the network isn't a secure context, so no clipboard API).
  function copy(text: string, button: HTMLElement) {
    const done = () => { button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, () => { button.textContent = 'Select it'; });
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove(); done();
  }
  const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  function linkRow(label: string, path: string, { deck = false, preview = false, read = false } = {}) {
    const row = el('div', 'lnk__link');
    if (label) row.append(el('span', 'lnk__label', label));
    const code = el('code');
    const copyBtn = el('button', 'alt small', 'Copy');
    const entry: Entry = { code, button: copyBtn, path, deck };
    links.push(entry);
    draw(entry);
    const buttons = el('span', 'lnk__buttons');
    buttons.append(copyBtn);
    if (preview) {
      const a = el('a', 'btn alt small pvw', 'Preview') as HTMLAnchorElement;
      a.href = `/pvw.html?${new URLSearchParams({ src: path, name: label || path })}`;
      a.target = '_blank';
      buttons.append(a);
    }
    if (read) {
      const tryBtn = el('button', 'alt small', 'Try');
      const out = el('pre', 'lnk__out');
      out.hidden = true;
      tryBtn.onclick = async () => {
        out.hidden = false;
        out.textContent = 'Asking Studio…';
        try {
          const r = await fetch(path);
          const t = await r.text();
          let shown = t;
          try { shown = JSON.stringify(JSON.parse(t), null, 2); } catch { /* not JSON */ }
          out.textContent = `${r.status}\n${shown.slice(0, 20000)}`;
        } catch (err) { out.textContent = `Studio didn't answer: ${err instanceof Error ? err.message : String(err)}`; }
      };
      buttons.append(tryBtn);
      row.append(code, buttons, out);
      return row;
    }
    row.append(code, buttons);
    return row;
  }
  function draw(entry: Entry) {
    const full = (entry.deck ? deckBase : plainBase) + entry.path;
    entry.code.textContent = full;
    entry.button.onclick = () => copy(full, entry.button);
  }
  const redraw = () => links.forEach(draw);

  // One link's card: its name, what it does, its links and its settings, the same for a graphic and a key.
  interface Card { title: string, path?: string, method?: string, about: string, rows: HTMLElement[], settings: [string, string][] }
  function card({ title, path, method, about, rows, settings }: Card) {
    const c = el('article', 'lnk');
    const head = el('div', 'lnk__head');
    head.append(el('h4', null, title));
    if (path) {
      const p = el('code', 'lnk__path');
      p.textContent = (method && method !== 'GET' ? method + ' ' : '') + path;
      head.append(p);
    }
    c.append(head);
    if (about) { const a = el('div', 'lnk__about'); a.innerHTML = about; c.append(a); } // our own text, not data
    rows.forEach(r => c.append(r));
    if (settings && settings.length) {
      const dl = el('dl', 'lnk__settings');
      for (const [name, text] of settings) {
        dl.append(el('dt', null, name));
        const dd = el('dd'); dd.innerHTML = text; dl.append(dd);
      }
      c.append(dl);
    }
    c.dataset.text = (c.textContent || '').toLowerCase();
    return c;
  }
  function group(id: string, title: string, about?: string) {
    const s = el('section', 'lnkgroup');
    s.id = `links-${id}`;
    s.append(el('h3', null, title));
    if (about) { const a = el('div', 'lnk__about'); a.innerHTML = about; s.append(a); }
    list.append(s);
    return s;
  }

  // A graphic's link options, from pageoptions.js: each with what it does and the values it takes.
  function options(file: string): [string, string][] {
    return ((typeof PAGE_OPTIONS !== 'undefined' ? PAGE_OPTIONS : {})[file] || []).map(o => {
      const vals = o.type === 'select'
        ? (o.choices || []).filter(([v]) => v !== '').map(([v, t]) => `<code>${esc(v)}</code> ${esc(t)}`).join(', ') + (o.choices && o.choices[0] ? ` (left out: ${esc(o.choices[0][1])})` : '')
        : `${o.type === 'number' ? 'a number' : 'text'}${o.unit ? ` in ${esc(o.unit)}` : ''}${o.placeholder ? ` (left out: ${esc(o.placeholder)})` : ''}`;
      return [`${o.label}`, `<code>?${esc(o.key)}=</code> ${vals}${o.help ? `. ${esc(o.help)}` : ''}`];
    });
  }
  const fileOf = (link: string) => link.replace(/^\//, '').split(/[?#]/)[0];

  function graphics(structure: Structure | null, outputs: Output[] | null) {
    const { GROUPS, LINKS } = GRAPHIC_LINKS;
    // One row per output for the output canvas: Output 1's link as it is, the others' naming the output.
    const perOutput = (l: GraphicLink) => (outputs && outputs.length ? outputs : [{ id: 'main', name: 'Output 1' }])
      .map(o => linkRow(o.name, o.id === 'main' ? l.link : `${l.link}&output=${encodeURIComponent(o.id)}`, { preview: true }));
    for (const g of GROUPS) {
      const rows = LINKS.filter(l => l.group === g.id);
      const per = g.perDivision;
      const divisions = per && structure ? structure.grades.map(d => ({ name: `${per.name}: ${d.name}`, link: per.link + d.division })) : [];
      if (!rows.length && !divisions.length) continue;
      const s = group(slug(g.id), g.title, g.about);
      for (const l of rows) {
        s.append(card({ title: l.name, about: l.about, rows: g.perOutput ? perOutput(l) : [linkRow('', l.link, { preview: true })], settings: options(fileOf(l.link)) }));
      }
      if (per && divisions.length) {
        s.append(card({ title: per.name, about: '', rows: divisions.map(d => linkRow(d.name, d.link, { preview: true })),
          settings: options(fileOf(per.link)) }));
      }
    }
  }

  // The tags in the order the list shows them: the scene first, then the scoreboard, then the rest.
  const TITLES: Record<string, string> = { Status: 'Status reads', Pairing: 'Pairing a program' };
  const ORDER = ['Scene', 'Scores', 'Scoring mode', 'Clock', 'Quarter', 'Game', 'Ticker', 'Switcher', 'Recordings', 'Status', 'Pairing'];
  function api(doc: ApiDoc) {
    const tags = (doc.tags || []).slice().sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99));
    const ops: { path: string, method: string, op: ApiOp }[] = [];
    for (const [path, item] of Object.entries(doc.paths || {})) {
      for (const [method, op] of Object.entries(item)) ops.push({ path, method: method.toUpperCase(), op });
    }
    for (const t of tags) {
      const mine = ops.filter(o => (o.op.tags || [])[0] === t.name);
      if (!mine.length) continue;
      const s = group(slug(t.name), TITLES[t.name] || `${t.name} links`, md(t.description));
      for (const { path, method, op } of mine) {
        const deck = path.startsWith('/deck/');
        const read = method === 'GET' && path.startsWith('/api/');
        const examples: [string, string][] = op['x-links'] || [];
        const rows = method === 'GET'
          ? (examples.length ? examples : [['', path]]).map(([label, link]) => linkRow(label, link, { deck, read: read && !link.includes('{') }))
          : [];
        const settings = (op.parameters || []).filter(p => p.name && p.in !== 'header').map((p): [string, string] => {
          const values = p.schema && p.schema.enum ? `One of ${p.schema.enum.map(v => `<code>${esc(v)}</code>`).join(', ')}.` : '';
          return [`${p.name} (${p.in === 'path' ? 'in the link' : 'after ?'})`, [md(p.description).replace(/<\/?p>/g, ''), values].filter(Boolean).join(' ')];
        });
        s.append(card({ title: op.summary, path, method, about: md(op.description), rows, settings }));
      }
    }
  }

  // Find: hides the links whose words don't match, and groups left with none.
  if (filter) {
    filter.oninput = () => {
      const q = filter.value.trim().toLowerCase();
      for (const s of list.querySelectorAll<HTMLElement>('.lnkgroup')) {
        let shown = false;
        for (const c of s.querySelectorAll<HTMLElement>('.lnk')) { const on = !q || (c.dataset.text || '').includes(q); c.hidden = !on; shown = shown || on; }
        s.hidden = !shown;
      }
    };
  }

  // The Preview button opens a half-size window (pvw.html), as the Output page's does.
  list.addEventListener('click', e => {
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a.pvw') : null;
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    window.open(a.href, '_blank', 'popup,width=960,height=540');
  });

  studioLinks = {
    // linksets.js hands over the picked link set's start, key included.
    setDeckBase(base: string) { deckBase = base; redraw(); },
    ready: (async () => {
      const [structure, doc, version, outputs]: [Structure | null, ApiDoc, { base?: string }, Output[] | null] = await Promise.all([
        fetch('/api/structure').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/openapi.json').then(r => r.json()),
        fetch('/api/version').then(r => r.json()).catch(() => ({})),
        fetch('/api/outputs').then(r => r.ok ? r.json() : null).then(o => o && o.outputs).catch(() => null),
      ]);
      if (version.base) { plainBase = version.base; if (deckBase === location.origin) deckBase = version.base; }
      graphics(structure, outputs);
      api(doc);
      redraw();
    })(),
  };
})();
