// FirstPass Studio - the Competitions setup page's script (setup.html loads it as a module, so its names stay its own).
// What Studio answers (competitions.ts and server.ts /api/setup*): the competitions, and one's settings and files.
interface Stream { id?: string; platform: string; name: string; where: string }
interface Club { logo?: string; colour?: string }
// A competition's settings as the form edits them. The boxes marked data-key in setup.html fill the fields by name.
interface Form {
  [field: string]: unknown;
  name: string; displayName?: string; competitionName?: string; venueName?: string; periodType: string; panelOpacity: number; fontSize: number;
  font: string; colours: Record<string, string>; brandColours?: Swatch[]; streams?: Stream[]; finalsFormat?: string;
  divisionFinals?: Record<string, string>; divisionSuperShots?: Record<string, boolean>; superShots?: boolean;
  competitionLogo?: string; competitionLogoDark?: string; teamClubs: Record<string, string>; clubs: Record<string, Club>;
}
interface FinalsFormat { id: string; name: string; teams?: number; all?: boolean; summary: string; weeks: string[]; marks: string[] }
interface SetupInfo {
  active: string | null; readOnly?: boolean; dataDir: string; dataLocation?: { name: string } | null; fonts: string[];
  competitions: { id: string; name: string; competitionName?: string; organisationUrl?: string; active?: boolean }[];
  defaults: { colours: Record<string, string>; panelOpacity: number }; finalsFormats?: FinalsFormat[];
}
interface Files { logos: string[]; brand: string[]; fonts: string[]; fontFamilies: string[] }
interface Opened extends Files { settings: Form; active?: boolean }
interface ViewerStream { id: string; hasKey?: boolean; at?: number; error?: string; live?: boolean; count: number; title?: string }
interface Viewers { streams: ViewerStream[]; live: number; total: number }
interface Found { organisation?: string; competitions: { name: string; seasons: string[]; currentSeason?: string }[] }
interface Team { name: string; division: string; autoClub: string }
// The colour box in a club's row, which draws itself again.
type ClubColourBox = HTMLDivElement & { redraw?: () => void };
const errText = (err: unknown) => err instanceof Error ? err.message : String(err);

(function () {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string | number | null) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  const COLOURS = [
    ['main', 'Main', 'banners, headers, team name panels'], ['dark', 'Main, dark', 'venue bar, shadows'],
    ['highlight', 'Highlight', 'round tab, points, VS'], ['accent', 'Accent', 'stripes, tabs, score flash'],
    ['panel', 'Panels', 'behind tables and team lists'], ['panelAlt', 'Panels, alternate', 'every second row'],
    ['text', 'Text', 'on the main colour and panels'], ['textOnHighlight', 'Text on highlight', 'round tab, points'],
    ['muted', 'Small print', 'column headings, footers'],
  ] as const;
  let info: SetupInfo = { active: null, dataDir: '', fonts: [], competitions: [], defaults: { colours: {}, panelOpacity: 1 } };
  let editing: string | null = null;  // id being edited
  let form: Form;      // settings being edited (set by open() before the form shows)
  let files: Files = { logos: [], brand: [], fonts: [], fontFamilies: [] };
  let macFonts: string[] = [];   // the fonts installed on this Mac (/api/setup-fonts)
  let dirty = false;

  async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(path, { cache: 'no-store', ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  const post = <T>(path: string, body: object) => api<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const imgUrl = (kind: string, name: string) => `/api/setup/${editing}/image?kind=${kind}&name=${encodeURIComponent(name)}&v=${Date.now() % 1e7}`;
  function note(id: string, text: string, cls = '') { $(id).textContent = text; $(id).className = 'note' + (cls ? ' ' + cls : ''); }
  function markDirty() { dirty = true; note('saveNote', 'Not saved yet.'); }

  // Before anything that would lose unsaved changes: asks to save them, discard them or stay put
  // (unsaved.js, which also asks before a tab, the Mac app's Go menu, closing or reloading).
  // Resolves to false to stay put, else to 'saved', 'discarded' or true (nothing to save).
  const guard = unsavedPage({
    what: () => form?.name || 'this competition',
    changed: () => dirty,
    save: async () => { try { await save(true); return true; } catch (err) { note('saveNote', `Couldn't save: ${errText(err)}`, 'error'); return false; } },
    discard: () => { dirty = false; },
  });
  const settle = () => guard.settle();
  // After discarding changes but staying on this competition: show what's saved again.
  async function reopen() { const id = editing; editing = null; if (id) await open(id); }

  // ─── Competition list ───────────────────────────────────────────────────
  async function loadList(pick?: string | null) {
    info = await api<SetupInfo>('/api/setup');
    api<{ mac?: string[] }>('/api/setup-fonts').then(d => { macFonts = d.mac || []; if (form) { buildFonts(); preview(); } }).catch(() => {});
    $('readOnlyNote').hidden = !info.readOnly;
    $('noComps').hidden = info.competitions.length > 0;
    $('dataDir').textContent = info.dataLocation ? `Saved in ${info.dataLocation.name}, in this Mac's folder: ${info.dataDir}` : `Saved on this computer in ${info.dataDir}`;
    $<HTMLButtonElement>('importTemplate').disabled = !!info.readOnly;
    const comps = $('comps');
    comps.replaceChildren();
    for (const c of info.competitions) {
      const row = el('div', 'comp' + (c.id === (pick || editing) ? ' editing' : ''));
      const name = el('div', 'comp__name', c.name);
      name.append(el('div', 'comp__sub', c.competitionName ? `PlayHQ: ${c.competitionName}` : 'No PlayHQ competition yet'));
      row.append(name);
      if (!c.organisationUrl || !c.competitionName) row.append(el('span', 'badge draft', 'Needs PlayHQ link'));
      if (c.active) row.append(el('span', 'badge', 'In use'));
      else {
        const use = el('button', 'alt', 'Use this one');
        use.onclick = e => { e.stopPropagation(); activate(c.id); };
        row.append(use);
      }
      row.onclick = () => { if (c.id !== editing) open(c.id); };
      comps.append(row);
    }
    const want = pick || editing || info.active;
    if (!want) { editing = null; $('editor').hidden = true; $<HTMLButtonElement>('save').disabled = true; $<HTMLButtonElement>('useComp').hidden = true; return; }
    if (want !== editing) await open(want);
  }

  async function open(id: string) {
    if (!await settle()) return;
    const d = await api<Opened>(`/api/setup/${id}`);
    editing = id; form = d.settings; files = { logos: d.logos, brand: d.brand, fonts: d.fonts, fontFamilies: d.fontFamilies }; dirty = false;
    [...$('comps').children].forEach((row, i) => row.classList.toggle('editing', info.competitions[i].id === id));
    fill(); note('saveNote', d.active ? 'This competition is in use.' : 'Not in use. Save and use it to put it on the graphics.');
    $<HTMLButtonElement>('useComp').hidden = !!d.active;
    $<HTMLButtonElement>('deleteComp').disabled = !!info.readOnly;
    $('editor').hidden = false;
    $<HTMLButtonElement>('save').disabled = !!info.readOnly;
    $('findNote').textContent = '';
    loadTeams(!!d.active);
  }

  async function activate(id: string) {
    const settled = await settle();
    if (!settled) return;
    if (!await askConfirm('Switch every graphic, Scoreboard control and the Stream Deck to this competition?', 'The scoreboard starts again on its first game.', { ok: 'Use this competition' })) { if (settled === 'discarded') reopen(); return; }
    try {
      await post(`/api/setup/${id}/activate`, {});
      editing = null; dirty = false;
      await loadList(id);
      note('saveNote', 'Now in use. Graphics reload on their own.', 'ok');
    } catch (err) { note('saveNote', `Couldn't switch: ${errText(err)}`, 'error'); }
  }

  // ─── The form ───────────────────────────────────────────────────────────
  function fill() {
    buildFonts();
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach(i => {
      const v = form[i.dataset.key || ''];
      if (i instanceof HTMLInputElement && i.type === 'checkbox') i.checked = !!v; else i.value = v == null ? '' : String(v);
    });
    document.querySelectorAll<HTMLInputElement>('[name=periodType]').forEach(r => { r.checked = r.value === form.periodType; });
    $<HTMLInputElement>('panelOpacity').value = String(form.panelOpacity);
    $<HTMLInputElement>('fontSize').value = String(form.fontSize);
    buildColours();
    renderBrand(); renderLogos(); renderFinals(); renderSuperShots(); preview();
    streamKeys = {};
    loadViewers();
  }

  // ─── Live viewers: the streams, with their keys saved separately (kept on this Mac only) ───────
  let streamKeys: Record<string, string> = {}, viewerState: Viewers | null = null;
  const PLATFORMS: Record<string, { name: string; where: string; key: string }> = { youtube: { name: 'YouTube', where: 'Channel ID, @handle or live video link', key: 'YouTube API key' },
    facebook: { name: 'Facebook', where: "Page ID or link", key: 'Page access token' } };
  async function loadViewers(check = false) {
    try { viewerState = await api<Viewers>(`/api/viewers?competition=${encodeURIComponent(editing || '')}${check ? '&check=1' : ''}`); } catch { viewerState = null; }
    renderStreams();
  }
  function renderStreams() {
    const streams = form.streams = form.streams || [];
    const box = $('streams');
    box.replaceChildren();
    if (!streams.length) { box.append(el('p', 'help', 'No streams yet.')); return; }
    const grid = el('div', 'streams');
    streams.forEach((st, i) => {
      const p = PLATFORMS[st.platform];
      const known = viewerState && viewerState.streams.find(x => x.id === st.id);
      const name = el('input'); name.type = 'text'; name.placeholder = 'Name, e.g. PIVT YouTube'; name.value = st.name || ''; name.maxLength = 40;
      name.oninput = () => { st.name = name.value; markDirty(); };
      const where = el('input'); where.type = 'text'; where.placeholder = p.where; where.value = st.where || ''; where.maxLength = 300;
      where.oninput = () => { st.where = where.value; markDirty(); };
      const key = el('input'); key.type = 'password'; key.autocomplete = 'off';
      key.placeholder = st.id && known && known.hasKey ? `${p.key} saved` : p.key;
      key.value = streamKeys[st.id || `new-${i}`] || '';
      key.oninput = () => { streamKeys[st.id || `new-${i}`] = key.value; markDirty(); };
      const rm = el('button', 'alt small', 'Remove'); rm.type = 'button';
      rm.onclick = () => { streams.splice(i, 1); markDirty(); renderStreams(); };
      grid.append(el('span', 'platform', p.name), name, where, key, rm);
      if (known && known.at) {
        const text = known.error ? known.error : known.live ? `${known.count.toLocaleString()} watching${known.title ? ` · ${known.title}` : ''}` : 'Not live right now';
        grid.append(el('div', `status ${known.error ? 'error' : known.live ? 'live' : ''}`, text));
      }
    });
    box.append(grid);
  }
  const addStream = (platform: string) => { const streams = form.streams = form.streams || []; if (streams.length >= 8) return; streams.push({ platform, name: '', where: '' }); markDirty(); renderStreams(); };
  $<HTMLButtonElement>('addYoutube').onclick = () => addStream('youtube');
  $<HTMLButtonElement>('addFacebook').onclick = () => addStream('facebook');
  $<HTMLButtonElement>('checkViewers').onclick = async () => {
    try {
      if (dirty) await save(true);
      note('viewersNote', 'Checking…');
      await loadViewers(true);
      const v = viewerState;
      note('viewersNote', !v || !v.streams.length ? 'Add a stream first.' : v.live ? `${v.total.toLocaleString()} watching on ${v.live} stream${v.live === 1 ? '' : 's'}.` : 'None of them is live right now.', v && v.live ? 'ok' : '');
    } catch (err) { note('viewersNote', `Couldn't check: ${errText(err)}`, 'error'); }
  };

  // ─── Finals formats ─────────────────────────────────────────────────────
  const formatById = (id: string | undefined) => (info.finalsFormats || []).find(f => f.id === id) || null;
  function formatOptions(sel: HTMLSelectElement, first: HTMLOptionElement[]) {
    sel.replaceChildren(...first);
    for (const n of [2, 4, 6, 8]) {
      const group = Object.assign(document.createElement('optgroup'), { label: `Top ${n}` });
      for (const f of (info.finalsFormats || []).filter(x => x.teams === n)) group.append(new Option(f.name, f.id));
      if (group.children.length) sel.append(group);
    }
    const every = Object.assign(document.createElement('optgroup'), { label: 'Every team' });
    for (const f of (info.finalsFormats || []).filter(x => x.all)) every.append(new Option(f.name, f.id));
    if (every.children.length) sel.append(every);
  }
  const about = (f: FinalsFormat | null) => f ? `${f.summary} Weeks: ${f.weeks.join(', ')}.` : 'No finals: the ladder has no finals marks.';
  function renderFinals() {
    const sel = $<HTMLSelectElement>('finalsFormat');
    formatOptions(sel, [new Option('No finals', '')]);
    sel.value = formatById(form.finalsFormat) ? form.finalsFormat || '' : '';
    $('finalsAbout').textContent = about(formatById(form.finalsFormat));
    sel.onchange = () => { form.finalsFormat = sel.value; markDirty(); renderFinals(); preview(); };
    // A row per division: from PlayHQ's teams (competition in use), plus any already set.
    const box = $('divisionFinals');
    box.replaceChildren();
    const divisionFinals = form.divisionFinals = form.divisionFinals || {};
    const divisions = [...new Set([...teams.map(t => t.division), ...Object.keys(divisionFinals)])].filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (!divisions.length) { box.append(el('p', 'help', 'Use this competition to give its divisions their own finals formats (the divisions come from PlayHQ).')); return; }
    const grid = el('div', 'divfin');
    for (const d of divisions) {
      const own = divisionFinals[d] || '';
      const s = el('select');
      const def = formatById(form.finalsFormat);
      formatOptions(s, [new Option(`Same as the competition (${def ? def.name : 'no finals'})`, ''), new Option('No finals', 'none')]);
      s.value = own === 'none' || formatById(own) ? own : '';
      s.onchange = () => { if (s.value) divisionFinals[d] = s.value; else delete divisionFinals[d]; markDirty(); renderFinals(); };
      grid.append(el('label', '', d), s);
      if (own && own !== 'none' && formatById(own)) grid.append(el('div', 'about', about(formatById(own))));
    }
    box.append(grid);
  }
  // Super shots per division (competitions.ts superShotsFor has the same matching): a division's own
  // setting, else a word in its name ("Open", "21", "Men"), else the competition's tick box.
  function superWord(own: Record<string, boolean>, d: string) {
    const name = d.toLowerCase(), esc = (k: string) => k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Object.keys(own).filter(k => k.toLowerCase() !== name && new RegExp(`(^|[^a-z0-9])${esc(k)}([^a-z0-9]|$)`).test(name))
      .sort((a, b) => b.length - a.length)[0];
  }
  function renderSuperShots() {
    const box = $('divisionSuperShots');
    box.replaceChildren();
    const own = form.divisionSuperShots = form.divisionSuperShots || {};
    const says = (on: boolean) => on ? 'super shots' : 'no super shots';
    const divisions = [...new Set(teams.map(t => t.division))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const exactKey = (d: string) => Object.keys(own).find(k => k.toLowerCase() === d.toLowerCase());
    // Words and names saved that aren't one of PlayHQ's divisions get a row of their own.
    const extra = Object.keys(own).filter(k => !divisions.some(d => d.toLowerCase() === k.toLowerCase())).sort();
    if (!divisions.length && !extra.length) { box.append(el('p', 'help', 'Use this competition to give its divisions their own super shot setting (the divisions come from PlayHQ).')); return; }
    const grid = el('div', 'divfin');
    const row = (label: string, key: string | undefined, first: string) => {
      const s = el('select');
      s.append(new Option(first, ''), new Option('Super shots', 'true'), new Option('No super shots', 'false'));
      s.value = key && own[key] !== undefined ? String(own[key]) : '';
      s.onchange = () => { if (key) delete own[key]; if (s.value) own[key || label] = s.value === 'true'; markDirty(); renderSuperShots(); };
      grid.append(el('label', '', label), s);
    };
    for (const d of divisions) {
      const word = superWord(own, d);
      row(d, exactKey(d), word ? `Set by "${word}" (${says(own[word])})` : `Same as the competition (${says(form.superShots !== false)})`);
    }
    for (const k of extra) row(k, k, 'Remove this setting');
    box.append(grid);
  }
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach(i => {
    const tick = i instanceof HTMLInputElement && i.type === 'checkbox';
    i.addEventListener(tick || i.tagName === 'SELECT' ? 'change' : 'input', () => {
      form[i.dataset.key || ''] = i instanceof HTMLInputElement && tick ? i.checked : i.type === 'number' ? Number(i.value) : i.value;
      markDirty(); preview();
      if (i.dataset.key === 'superShots') renderSuperShots();
    });
  });
  document.querySelectorAll<HTMLInputElement>('[name=periodType]').forEach(r => r.onchange = () => { form.periodType = r.value; markDirty(); preview(); });
  $<HTMLInputElement>('panelOpacity').oninput = () => { form.panelOpacity = Number($<HTMLInputElement>('panelOpacity').value); markDirty(); preview(); };
  $<HTMLInputElement>('fontSize').oninput = () => { form.fontSize = Number($<HTMLInputElement>('fontSize').value); markDirty(); preview(); };

  // Swatches in every colour picker: the brand kit, then the colours this setup already uses.
  const swatches = () => [
    { title: 'Brand kit', colours: form.brandColours || [] },
    { title: 'This competition', colours: COLOURS.map(([key, label]) => ({ hex: form.colours[key], name: label })) },
  ];
  function buildColours() {
    ColourPicker.close();
    const box = $('colours');
    box.replaceChildren();
    for (const [key, label, help] of COLOURS) {
      const row = el('div', 'colour');
      const pick = ColourPicker.field(form.colours[key], hex => { form.colours[key] = hex; markDirty(); preview(); }, { label, swatches });
      const text = el('span'); text.append(el('b', '', label), el('br'), help);
      row.append(pick, text);
      box.append(row);
    }
    buildKit();
  }
  $<HTMLButtonElement>('resetColours').onclick = () => { form.colours = { ...info.defaults.colours }; form.panelOpacity = info.defaults.panelOpacity; $<HTMLInputElement>('panelOpacity').value = String(form.panelOpacity); buildColours(); markDirty(); preview(); };

  // Brand kit colours: pasted text, kept with the setup as swatches for the pickers.
  function buildKit() {
    const list = $('kitList'), kit = form.brandColours || [];
    list.replaceChildren();
    for (const c of kit) {
      const chip = el('span', 'kitc'), sw = el('i');
      sw.style.backgroundColor = c.hex;
      chip.title = `RGB ${ColourPicker.toRgb(c.hex).join(', ')}`;
      const del = Object.assign(el('button', '', '×'), { type: 'button', title: `Remove ${c.name || c.hex}` });
      del.onclick = () => { form.brandColours = kit.filter(k => k !== c); buildKit(); markDirty(); };
      chip.append(sw, ...(c.name ? [el('span', '', c.name)] : []), el('code', '', c.hex), del);
      list.append(chip);
    }
    $('kitCount').textContent = kit.length ? `(${kit.length})` : '';
  }
  $<HTMLButtonElement>('kitAdd').onclick = () => {
    const found = ColourPicker.findAll($<HTMLTextAreaElement>('kitText').value);
    const kit = form.brandColours || [];
    const fresh = found.filter(f => !kit.some(k => k.hex === f.hex));
    if (!found.length) { note('kitNote', 'No colours found. Each needs a # before its HEX, or RGB before its numbers.', 'error'); return; }
    form.brandColours = [...kit, ...fresh].slice(0, 40);
    $<HTMLTextAreaElement>('kitText').value = '';
    note('kitNote', fresh.length ? `Added ${fresh.length} colour${fresh.length === 1 ? '' : 's'}.` : 'Those colours are already here.', 'ok');
    buildKit(); if (fresh.length) markDirty();
  };

  // The same colour variables the helper writes into theme.css.
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (h: string, o: string, t: number) => '#' + rgb(h).map((v, i) => Math.round(v + (rgb(o)[i] - v) * t).toString(16).padStart(2, '0')).join('');
  let fontLink: HTMLLinkElement | null = null;
  function preview() {
    const c = form.colours, o = form.panelOpacity, p = $('preview').style;
    const vars: Record<string, string> = { '--purple': c.main, '--purple-light': mix(c.main, '#ffffff', .25), '--purple-shade': mix(c.main, '#000000', .15),
      '--purple-dark': c.dark, '--purple-dark-light': mix(c.dark, '#ffffff', .15), '--purple-deep': `rgba(${rgb(c.panel)}, ${o})`,
      '--purple-deep-alt': `rgba(${rgb(c.panelAlt)}, ${o})`, '--yellow': c.highlight, '--pink': c.accent, '--text': c.text,
      '--text-on-yellow': c.textOnHighlight, '--muted': c.muted, '--font': `"Studio ${form.font}", "${form.font}", "Montserrat", Arial, sans-serif` };
    for (const [k, v] of Object.entries(vars)) p.setProperty(k, v);
    $('opacityPct').textContent = `${Math.round((1 - o) * 100)}%`;
    if (!fontLink) { fontLink = el('link'); fontLink.rel = 'stylesheet'; document.head.append(fontLink); }
    fontLink.href = `/api/setup/${editing}/fontcss?font=${encodeURIComponent(form.font)}&size=${form.fontSize}`;
    // Montserrat is the size every other font is matched to, so it has no Text size.
    $<HTMLLabelElement>('fontSizeRow').style.display = $('fontSizeHelp').style.display = form.font === 'Montserrat' ? 'none' : '';
    $('fontSizePct').textContent = `${form.fontSize}%`;
    $('fontHelp').textContent = fontKind(form.font) === 'mac' ? 'A font on this Mac: a graphic opened on another computer shows Montserrat instead.'
      : fontKind(form.font) === 'added' ? 'A font added to this competition: it goes with it in its template file.'
      : fontKind(form.font) === 'missing' ? `${form.font} isn't on this computer, so the graphics show Montserrat instead.`
      : 'Comes with Studio: works on any computer, with no internet.';
    $('pvComp').textContent = form.displayName || form.competitionName || form.name;
    $('pvVenue').textContent = form.venueName || 'Venue';
    $('pvClock').textContent = `${form.periodType === 'halves' ? 'H' : 'Q'}2 7:42`;
    const pvLogo = form.competitionLogo || form.competitionLogoDark;
    $<HTMLImageElement>('pvLogo').hidden = !pvLogo;
    if (pvLogo) $<HTMLImageElement>('pvLogo').src = imgUrl('brand', pvLogo);
    const lad = $('pvLadder');
    lad.replaceChildren();
    const head = el('div', 'h', (form.displayName || form.competitionName || form.name) + ' '); head.append(el('span', '', 'Division 1'));
    lad.append(head);
    const th = el('div', 'r th'); th.append(el('div', 'p', '#'), el('div', '', 'TEAM'), el('div', '', 'P'), el('div', 'pts', 'PTS')); lad.append(th);
    const fmt = formatById(form.finalsFormat), marks = fmt ? fmt.marks : [];
    const kind = (m: string) => m === 'elim' ? '' : m === 'third' || m === 'placing' ? ' fin--third' : ' fin--top';
    ['Team A', 'Team B', 'Team C', 'Team D', 'Team E', 'Team F', 'Team G', 'Team H', 'Team I'].slice(0, Math.max(6, marks.length + (fmt && fmt.all ? 0 : 1))).forEach((t, i) => {
      const r = el('div', 'r' + (i < marks.length ? ' fin' + kind(marks[i]) + (i === marks.length - 1 ? ' fin--last' : '') : ''));
      r.append(el('div', 'p', i + 1), el('div', '', t), el('div', '', 8), el('div', 'pts', 28 - i * 4));
      lad.append(r);
    });
  }

  // ─── Fonts ──────────────────────────────────────────────────────────────
  // The Font box: the fonts that come with Studio, then this competition's added fonts, then every
  // font on this Mac. A saved font that's none of them (a Mac font on another computer) shows too.
  const fontKind = (f: string) => info.fonts.includes(f) ? 'bundled' : files.fontFamilies.includes(f) ? 'added' : macFonts.includes(f) ? 'mac' : 'missing';
  function buildFonts() {
    const group = (label: string, list: string[]) => { const g = el('optgroup'); g.label = label; g.append(...list.map(f => Object.assign(el('option', '', f), { value: f }))); return g; };
    const groups: HTMLElement[] = [group('Comes with Studio', info.fonts)];
    const added = files.fontFamilies.filter(f => !info.fonts.includes(f));
    if (added.length) groups.push(group('Added to this competition', added));
    const mac = macFonts.filter(f => !info.fonts.includes(f) && !added.includes(f));
    if (mac.length) groups.push(group('On this Mac', mac));
    if (form.font && fontKind(form.font) === 'missing') groups.unshift(Object.assign(el('option', '', `${form.font} (not on this computer)`), { value: form.font }));
    $<HTMLSelectElement>('font').replaceChildren(...groups);
    $<HTMLSelectElement>('font').value = form.font;
    $('fontCount').textContent = files.fonts.length ? `(${files.fonts.length} added)` : '';
    const list = $('fontList');
    list.replaceChildren(...files.fonts.map(name => {
      const chip = el('span', 'kitc'); chip.append(el('code', '', name));
      const del = el('button', '', '×'); del.type = 'button'; del.title = `Remove ${name}`;
      del.onclick = async () => {
        if (!await askConfirm(`Remove ${name}?`, '', { ok: 'Remove', danger: true })) return;
        const d = await api<Files>(`/api/setup/${editing}/image?kind=fonts&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
        files.fonts = d.fonts; files.fontFamilies = d.fontFamilies; buildFonts(); preview();
      };
      chip.append(del); return chip;
    }));
  }
  $<HTMLInputElement>('fontFile').onchange = async () => {
    const list = [...$<HTMLInputElement>('fontFile').files || []];
    $<HTMLInputElement>('fontFile').value = '';
    let d: (Files & { family: string }) | null = null;
    for (const f of list) {
      note('fontNote', `Adding ${f.name}…`);
      try { d = await upload<Files & { family: string }>('fonts', f); }
      catch (err) { note('fontNote', `Couldn't add ${f.name}: ${errText(err)}`, 'error'); return; }
    }
    if (!d) return;
    // Pick the font just added.
    files.fonts = d.fonts; files.fontFamilies = d.fontFamilies; form.font = d.family; markDirty();
    buildFonts(); preview();
    note('fontNote', `Added ${list.length} font file${list.length === 1 ? '' : 's'}: ${d.family} is picked in the Font box. Press Save to use it.`, 'ok');
  };

  // ─── PlayHQ lookup ──────────────────────────────────────────────────────
  let found: Found | null = null;
  $<HTMLButtonElement>('find').onclick = async () => {
    note('findNote', 'Asking PlayHQ…');
    try {
      const got = found = await api<Found>(`/api/setup-find?url=${encodeURIComponent($<HTMLInputElement>('organisationUrl').value.trim())}`);
      $<HTMLDataListElement>('compList').replaceChildren(...got.competitions.map(c => Object.assign(el('option'), { value: c.name })));
      note('findNote', got.competitions.length
        ? `${got.organisation || 'This organisation'} has ${got.competitions.length} competition${got.competitions.length === 1 ? '' : 's'} on PlayHQ: ${got.competitions.map(c => c.name).join(', ')}. Pick one in the box below.`
        : 'PlayHQ lists no competitions for this organisation.', got.competitions.length ? 'ok' : 'error');
      seasons();
    } catch (err) { note('findNote', `PlayHQ said: ${errText(err)}`, 'error'); }
  };
  function seasons() {
    const c = found && found.competitions.find(x => x.name.toLowerCase() === String(form.competitionName).toLowerCase());
    $<HTMLDataListElement>('seasonList').replaceChildren(...(c ? c.seasons : []).map(s => Object.assign(el('option'), { value: s })));
    if (c) $<HTMLInputElement>('seasonName').placeholder = `Blank = the current season${c.currentSeason ? ` (${c.currentSeason})` : ''}`;
  }
  $<HTMLInputElement>('competitionName').addEventListener('change', seasons);

  // ─── Logos ──────────────────────────────────────────────────────────────
  // Light and dark mode competition logos: [setting, box, file input, name in messages].
  const BRAND_SLOTS = [['competitionLogo', 'brandLogo', 'brandFile', 'light mode'], ['competitionLogoDark', 'brandLogoDark', 'brandFileDark', 'dark mode']] as const;
  function renderBrand() {
    for (const [key, boxId, , label] of BRAND_SLOTS) {
      const box = $(boxId);
      box.replaceChildren();
      const other = key === 'competitionLogo' ? 'competitionLogoDark' : 'competitionLogo', mine = form[key];
      if (mine && files.brand.includes(mine)) {
        const img = el('img'); img.src = imgUrl('brand', mine);
        const remove = el('button', 'alt', 'Remove');
        remove.onclick = async () => {
          // Keep the file if the other mode uses it too.
          if (form[other] !== mine) {
            const d = await api<Files>(`/api/setup/${editing}/image?kind=brand&name=${encodeURIComponent(mine)}`, { method: 'DELETE' });
            files.brand = d.brand;
          }
          form[key] = ''; markDirty(); renderBrand(); preview();
        };
        box.append(img, el('span', '', mine), remove);
      } else box.append(el('span', 'help', files.brand.includes(form[other] || '')
        ? `No ${label} logo: the ${label === 'light mode' ? 'dark' : 'light'} mode one is used.` : 'No competition logo.'));
    }
  }
  for (const [key, , fileId, label] of BRAND_SLOTS) {
    $<HTMLInputElement>(fileId).onchange = async () => {
      const f = $<HTMLInputElement>(fileId).files?.[0];
      if (!f) return;
      try {
        const d = await upload<Files & { name: string }>('brand', f);
        files.brand = d.brand; form[key] = d.name; markDirty(); renderBrand(); preview();
        note('saveNote', `Competition logo (${label}) added. Press Save to use it.`);
      } catch (err) { note('saveNote', `Couldn't add the logo: ${errText(err)}`, 'error'); }
      $<HTMLInputElement>(fileId).value = '';
    };
  }
  async function upload<T = Files>(kind: string, file: File) {
    return api<T>(`/api/setup/${editing}/image?kind=${kind}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  }
  async function uploadLogos(list: FileList | null | undefined) {
    if (!list) return;
    const imgs = [...list].filter(f => /\.(png|jpe?g|webp|svg|gif)$/i.test(f.name));
    if (!imgs.length) return note('uploadNote', 'Those aren\'t image files (PNG, JPG, WebP, SVG or GIF).', 'error');
    let done = 0;
    for (const f of imgs) {
      note('uploadNote', `Adding ${f.name}…`);
      try { files.logos = (await upload('logos', f)).logos; done++; }
      catch (err) { note('uploadNote', `Couldn't add ${f.name}: ${errText(err)}`, 'error'); return; }
    }
    note('uploadNote', `Added ${done} logo${done === 1 ? '' : 's'}.`, 'ok');
    renderLogos(); loadTeams(editing === info.active);
  }
  $<HTMLInputElement>('logoFiles').onchange = () => { uploadLogos($<HTMLInputElement>('logoFiles').files); $<HTMLInputElement>('logoFiles').value = ''; };
  const drop = $('drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); uploadLogos(e.dataTransfer?.files); };
  function renderLogos() {
    const box = $('logos');
    box.replaceChildren();
    if (!files.logos.length) box.append(el('p', 'help', 'No team logos yet.'));
    for (const name of files.logos) {
      const card = el('div', 'logo');
      const img = el('img'); img.src = imgUrl('logos', name); img.alt = '';
      const del = el('button', 'alt', '×'); del.title = `Remove ${name}`;
      del.onclick = async () => {
        if (!await askConfirm(`Remove ${name}?`, '', { ok: 'Remove', danger: true })) return;
        files.logos = (await api<Files>(`/api/setup/${editing}/image?kind=logos&name=${encodeURIComponent(name)}`, { method: 'DELETE' })).logos;
        renderLogos(); loadTeams(editing === info.active);
      };
      card.append(img, el('div', '', name), del);
      box.append(card);
    }
  }

  // Clubs: a club's logo and colour (behind its name on the scoreboard and The Clash) are shared
  // by all its teams in every division. The helper finds each team's club from its name
  // ("Comets 21U" and "Comets Open" are Comets); the Club box links a team to another club.
  let teams: Team[] = [];      // teams from PlayHQ
  let clubRows: Record<string, ClubColourBox[]> = {};   // club name (lower case) -> the colour box in each of its rows
  const clubOfTeam = (t: Team) => form.teamClubs[t.name] || t.autoClub;
  const clubKey = (club: string) => Object.keys(form.clubs).find(k => k.toLowerCase() === String(club).toLowerCase());
  const clubEntry = (club: string): Club => form.clubs[clubKey(club) || ''] || {};
  function setClub(club: string, field: keyof Club, value: string | null) {
    const key = clubKey(club) || club, entry = { ...(form.clubs[key] || {}) };
    if (value) entry[field] = value; else delete entry[field];
    if (Object.keys(entry).length) form.clubs[key] = entry; else delete form.clubs[key];
    markDirty();
  }
  // The same loose match the helper uses: "Perth Coastal" finds "Perth Coastals.png".
  const logoNorm = (s: string) => String(s || '').toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  function matchLogo(...names: string[]) {
    for (const want of names.map(logoNorm)) {
      if (!want) continue;
      const hit = files.logos.find(f => logoNorm(f) === want) || files.logos.find(f => want.includes(logoNorm(f)) || logoNorm(f).includes(want));
      if (hit) return hit;
    }
    return '';
  }
  const swatchesForClubs = () => [...swatches(), { title: 'Other clubs', colours: Object.entries(form.clubs).filter(([, c]) => c.colour).map(([name, c]) => ({ name, hex: c.colour || '' })) }];
  function colourPicker(club: string) {
    const box: ClubColourBox = el('div', 'teamcolour');
    const draw = () => {
      const colour = clubEntry(club).colour;
      if (!colour) {
        const add = Object.assign(el('button', 'alt', 'Add colour'), { type: 'button' });
        add.onclick = () => { setClub(club, 'colour', form.colours.main); redrawClub(club); };
        box.replaceChildren(add);
        return;
      }
      const pick = ColourPicker.field(colour, hex => { setClub(club, 'colour', hex); redrawClub(club, box); },
        { label: `${club}'s colour`, swatches: swatchesForClubs });
      const clear = Object.assign(el('button', 'alt', '×'), { type: 'button', title: 'No club colour (use the competition colours)' });
      clear.onclick = () => { setClub(club, 'colour', null); redrawClub(club); };
      box.replaceChildren(pick, clear);
    };
    box.redraw = draw;
    (clubRows[club.toLowerCase()] = clubRows[club.toLowerCase()] || []).push(box);
    draw();
    return box;
  }
  // Redraw every row of a club, except the one being changed so its picker stays open.
  function redrawClub(club: string, except?: HTMLElement) {
    for (const b of clubRows[club.toLowerCase()] || []) {
      if (b === except) continue;
      const field = b.querySelector<ColourField>('.cp-field'), colour = clubEntry(club).colour;
      if (field && colour) field.setValue(colour); else b.redraw?.();
    }
  }
  function clubSelect(t: Team) {
    const sel = el('select'), club = clubOfTeam(t);
    const names = new Map<string, string>();
    for (const n of [...teams.map(clubOfTeam), ...Object.keys(form.clubs), t.name]) if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), n);
    sel.append(new Option(`${t.autoClub} (from its name)`, ''));
    [...names.values()].filter(n => n.toLowerCase() !== t.autoClub.toLowerCase()).sort((x, y) => x.localeCompare(y))
      .forEach(n => sel.append(new Option(n === t.name ? `${n} (its own)` : n, n)));
    sel.append(new Option('New club…', '\u0000new'));
    sel.value = form.teamClubs[t.name] && club.toLowerCase() !== t.autoClub.toLowerCase() ? [...names.values()].find(n => n.toLowerCase() === club.toLowerCase()) || '' : '';
    sel.onchange = async () => {
      let v: string | null = sel.value;
      if (v === '\u0000new') { v = await askText(`Club for ${t.name}`); if (!v) return renderTeams(); }
      if (v && v.toLowerCase() !== t.autoClub.toLowerCase()) form.teamClubs[t.name] = v; else delete form.teamClubs[t.name];
      markDirty(); renderTeams();
    };
    return sel;
  }
  function renderTeams() {
    const body = $<HTMLTableElement>('teams').tBodies[0];
    body.replaceChildren();
    clubRows = {};
    const sorted = [...teams].sort((a, b) => clubOfTeam(a).localeCompare(clubOfTeam(b)) || a.division.localeCompare(b.division, 'en', { numeric: true }) || a.name.localeCompare(b.name));
    for (const t of sorted) {
      const club = clubOfTeam(t), picked = clubEntry(club).logo, matched = matchLogo(club, t.name);
      const tr = body.insertRow();
      const logo = picked || matched;
      tr.insertCell().replaceChildren(logo ? Object.assign(el('img'), { src: imgUrl('logos', logo) }) : el('div', 'none', 'none'));
      tr.insertCell().textContent = t.name;
      tr.insertCell().textContent = t.division;
      tr.insertCell().append(clubSelect(t));
      const sel = el('select');
      sel.append(new Option(matched ? `Matched by name: ${matched}` : 'Match by name', ''));
      files.logos.forEach(f => sel.append(new Option(f, f)));
      sel.value = picked && files.logos.includes(picked) ? picked : '';
      sel.onchange = () => { setClub(club, 'logo', sel.value); renderTeams(); };
      tr.insertCell().append(sel);
      tr.insertCell().append(colourPicker(club));
    }
  }

  // Teams from PlayHQ, for the competition in use: their club, and the logo and colour each gets.
  async function loadTeams(active: boolean) {
    const table = $<HTMLTableElement>('teams');
    table.hidden = true;
    if (!active) { teams = []; renderFinals(); renderSuperShots(); }
    if (!active) return note('teamsNote', 'Use this competition (or save its PlayHQ link and switch to it) to see its teams and which logo each one gets.');
    note('teamsNote', 'Loading the teams from PlayHQ…');
    try {
      const d = await api<{ teams: { name: string; division: string; autoClub?: string; logo?: string }[]; competition: string; season: string }>('/api/setup-teams');
      teams = d.teams.map(t => ({ name: t.name, division: t.division, autoClub: t.autoClub || t.name }));
      renderTeams(); renderFinals(); renderSuperShots();
      table.hidden = !d.teams.length;
      const missing = d.teams.filter(t => !t.logo).length;
      const clubs = new Set(teams.map(t => clubOfTeam(t).toLowerCase())).size;
      note('teamsNote', d.teams.length ? `${d.teams.length} teams from ${clubs} clubs in ${d.competition} ${d.season}${missing ? `, ${missing} without a logo` : ', all with a logo'}.` : 'PlayHQ has no teams for this competition yet.', missing ? '' : 'ok');
    } catch (err) { note('teamsNote', `Couldn't load the teams from PlayHQ: ${errText(err)}`, 'error'); }
  }

  // ─── Save, new, delete ──────────────────────────────────────────────────
  async function save(quiet = false) {
    const streamsBefore = (form.streams || []).map((st, i) => st.id || `new-${i}`);
    const d = await post<Opened>(`/api/setup/${editing}`, form);
    form = d.settings; dirty = false;
    const keys: Record<string, string> = {}, saved = form.streams || [];
    streamsBefore.forEach((k, i) => { if (streamKeys[k] && saved[i]?.id) keys[saved[i].id || ''] = streamKeys[k]; });
    // Always sent, so the keys of streams that were removed go too.
    try { await post('/api/viewers/keys', { competition: editing, keys }); streamKeys = {}; } catch (err) { note('saveNote', `Saved, but the stream keys weren't: ${errText(err)}`, 'error'); }
    loadViewers();
    if (!quiet) note('saveNote', d.active ? 'Saved. Graphics reload with the changes on their own.' : 'Saved.', 'ok');
    const before = JSON.stringify(info.competitions);
    info = await api<SetupInfo>('/api/setup');
    if (JSON.stringify(info.competitions) !== before) { const id = editing; editing = null; await loadList(id); }
    if (d.active) loadTeams(true);
    return d;
  }
  $<HTMLButtonElement>('save').onclick = () => save().catch((err: unknown) => note('saveNote', `Couldn't save: ${errText(err)}`, 'error'));
  $<HTMLButtonElement>('useComp').onclick = () => { if (editing) activate(editing); };
  $<HTMLButtonElement>('newComp').onclick = async () => {
    const name = await askText('Name for the new competition (e.g. AMMNA Nationals 2027)');
    if (!name || !await settle()) return;
    try {
      const d = await post<{ id: string }>('/api/setup-new', { name });
      editing = null;
      await loadList(d.id);
      note('saveNote', 'New competition made. Add its PlayHQ link, colours and logos, then Save and use it.', 'ok');
    } catch (err) { note('saveNote', `Couldn't make it: ${errText(err)}`, 'error'); }
  };
  $<HTMLButtonElement>('deleteComp').onclick = async () => {
    const inUse = editing === info.active;
    const next = info.competitions.find(c => c.id !== editing);
    const then = !inUse ? '' : next ? ` It's in use, so every graphic switches to ${next.name}.` : " It's in use and it's your only competition, so the graphics will have none until you import or make one.";
    if (!await askConfirm(`Delete ${form.name}, with its settings and logos?`, `This can't be undone.${then}`, { ok: 'Delete', danger: true })) return;
    try {
      const d = await api<{ active: string | null }>(`/api/setup/${editing}`, { method: 'DELETE' });
      dirty = false; editing = null;
      await loadList(d.active);
    } catch (err) { note('saveNote', `Couldn't delete: ${errText(err)}`, 'error'); }
  };
  $<HTMLButtonElement>('templateComp').onclick = async () => {
    try {
      if (dirty) {
        const choice = await askChoice('Save your changes first?', 'The template file is made from the saved settings.',
          [{ label: 'Keep editing', value: 'cancel', alt: true }, { label: 'Save', value: 'save' }]);
        if (choice !== 'save') return;
        await save(true);
      }
      const tpl = await api<unknown>(`/api/setup/${editing}/template`);
      const a = el('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' }));
      a.download = `${form.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'competition'}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      note('saveNote', `Exported ${a.download}.`, 'ok');
    } catch (err) { note('saveNote', `Couldn't export it: ${errText(err)}`, 'error'); }
  };
  $<HTMLButtonElement>('importTemplate').onclick = () => $<HTMLInputElement>('templateFile').click();
  $<HTMLInputElement>('templateFile').onchange = async () => {
    const file = $<HTMLInputElement>('templateFile').files?.[0];
    $<HTMLInputElement>('templateFile').value = '';
    if (!file || !await settle()) return;
    try {
      const d = await api<Opened & { id: string }>('/api/setup-template', { method: 'POST', headers: { 'content-type': 'application/json' }, body: file });
      editing = null;
      await loadList(d.id);
      note('saveNote', d.active ? `Imported ${d.settings.name}. It's in use now.` : `Imported ${d.settings.name}. Check its settings, then Save and use it.`, 'ok');
    } catch (err) { note('saveNote', `Couldn't import it: ${errText(err)}`, 'error'); }
  };

  loadList().catch((err: unknown) => note('saveNote', `Couldn't load the competitions: ${errText(err)}`, 'error'));
})();

// What makes this file a module (its names its own), as the first line says.
export {};
