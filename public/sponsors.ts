// FirstPass Studio - the Sponsors page's script (sponsors.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What Studio answers (sponsors.ts view()): the competition's sponsors, tiers, moments and vacancy card.
interface Ad { file: string; seconds: number }
interface Sponsor {
  id: string; name: string; tagline?: string; website: string; tracking?: boolean; offer?: string; colour?: string; category?: string;
  logo?: string; logoWhite?: string; start?: string; end?: string; targetSeconds?: number; targetPlays?: number; ads?: Ad[];
  competitions: Record<string, { tier: string }>; logoUrl?: string; logoWhiteUrl?: string; state?: string; qrLink?: string;
}
// The sponsor being edited: a new one has no id yet.
type SponsorDraft = Sponsor & { ads: Ad[] };
type LogoField = 'logo' | 'logoWhite';
interface Tier { key: string; name: string; empty: string; share: number }
interface SponsorsView {
  competition: { id: string; name: string } | null; competitions: { id: string; name: string; sameOrganisation: boolean }[]; tiers: Tier[];
  nameSets: { names: Record<string, string>; metals: Record<string, string> }; tierNames: string; ownNames: Record<string, string>;
  emptyDefaults: Record<string, string>; vacancy: Record<string, string>; moments: { key: string; name: string; owner: string }[];
  vacancyDefaults: { heading: string; message: string }; vacancyLink: string; sponsors: Sponsor[]; readOnly: boolean;
}
const EMPTY = [['down', 'Pull up'], ['up', 'Pull down'], ['skip', 'Skip tier'], ['vacancy', 'Advertise vacancy']];
// Set by load() before anything is drawn, and by openEditor() before the editor shows.
let view: SponsorsView, editing: SponsorDraft, editColour = '';
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const errText = (err: unknown) => err instanceof Error ? err.message : String(err);
// The competition shown ('' with none).
const compId = () => view.competition?.id || '';

async function api<T = SponsorsView>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Studio answered ${r.status}`);
  return data;
}
const post = (path: string, body: object) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const tierName = (key: string) => view.tiers.find(t => t.key === key)?.name || key;
const here = (s: Sponsor) => view.competition ? s.competitions[view.competition.id] : undefined;
const share = (n: number) => n === 0.5 ? '½' : String(n);

function render() {
  const c = view.competition;
  $('noComp').hidden = !!c;
  for (const id of ['listSection', 'tierSection', 'momentSection', 'vacancySection']) $(id).hidden = !c;
  $('readOnlyNote').hidden = !view.readOnly;
  if (!c) return;
  $('compName').textContent = c.name;
  document.querySelectorAll('.edComp').forEach(e => { e.textContent = c.name; });

  // Sponsors, by tier
  const list = $('tierList');
  list.innerHTML = '';
  for (const t of view.tiers) {
    const inTier = view.sponsors.filter(s => here(s)?.tier === t.key);
    const div = document.createElement('div');
    div.className = 'tier';
    const rule = EMPTY.find(e => e[0] === t.empty)?.[1] || '';
    const emptyText = inTier.length ? '' : t.empty === 'vacancy' && !view.vacancyLink
      ? 'No sponsor · Advertise vacancy, but the vacancy card has no link yet, so it skips'
      : `No sponsor · ${rule}`;
    div.innerHTML = `<div class="tier__head"><span class="pill ${t.key === 'naming' ? 'naming' : ''}">${esc(t.name)}</span>${emptyText ? `<span class="tier__empty">${esc(emptyText)}</span>` : ''}</div>`;
    if (inTier.length) {
      const cards = document.createElement('div');
      cards.className = 'cards';
      for (const s of inTier) cards.append(card(s));
      div.append(cards);
    }
    list.append(div);
  }

  // Sponsors from other competitions (or none) that can be shown here too
  const others = view.sponsors.filter(s => !here(s));
  $('shareRow').hidden = !others.length;
  $<HTMLSelectElement>('shareWhich').innerHTML = others.map(s => {
    const on = Object.keys(s.competitions).map(id => view.competitions.find(c => c.id === id)?.name).filter(Boolean);
    return `<option value="${esc(s.id)}">${esc(s.name)}${on.length ? ` (${esc(on.join(', '))})` : ''}</option>`;
  }).join('');
  $<HTMLSelectElement>('shareTier').innerHTML = view.tiers.map(t => `<option value="${t.key}">${esc(t.name)}</option>`).join('');
  $<HTMLSelectElement>('shareTier').value = 'major';

  // Tier names and empty rules
  $('setNames').textContent = 'Names: ' + Object.values(view.nameSets.names).slice(1).join(', ');
  $('setMetals').textContent = 'Metals: ' + Object.values(view.nameSets.metals).slice(1).join(', ');
  const set = document.querySelector<HTMLInputElement>(`input[name=set][value=${view.tierNames}]`);
  if (set) set.checked = true;
  const own = view.tierNames === 'own';
  $<HTMLTableSectionElement>('tierRows').innerHTML = view.tiers.map(t => `<tr>
    <td>${own ? `<input type="text" data-own="${t.key}" maxlength="30" value="${esc(view.ownNames[t.key] || '')}" placeholder="${esc(view.nameSets.names[t.key])}" aria-label="Name for the ${esc(view.nameSets.names[t.key])} tier">` : `<b>${esc(t.name)}</b>`}</td>
    <td>${share(t.share)}</td>
    <td><select data-empty="${t.key}" aria-label="When ${esc(t.name)} has no sponsor">${EMPTY.map(([v, l]) =>
      `<option value="${v}" ${t.empty === v ? 'selected' : ''} ${(v === 'up' && t.key === 'naming') || (v === 'down' && t.key === 'supporter') ? 'disabled' : ''}>${l}${v === view.emptyDefaults[t.key] ? ' (default)' : ''}</option>`).join('')}</select></td></tr>`).join('');

  // Sponsored moments
  const elite = tierName('elite');
  $('momentTier').textContent = elite;
  const mine = view.sponsors.filter(s => here(s) && s.state !== 'ended')
    .sort((a, b) => view.tiers.findIndex(t => t.key === here(a)?.tier) - view.tiers.findIndex(t => t.key === here(b)?.tier) || a.name.localeCompare(b.name));
  $<HTMLTableSectionElement>('momentRows').innerHTML = view.moments.map(m => {
    const gone = m.owner && m.owner !== 'off' && !mine.some(s => s.id === m.owner);
    return `<tr><td>${esc(m.name)}</td><td><select data-moment="${m.key}" aria-label="${esc(m.name)} brought to you by">
      <option value="">${esc(elite)} sponsors take turns</option><option value="off"${m.owner === 'off' ? ' selected' : ''}>No sponsor</option>
      ${mine.map(s => `<option value="${esc(s.id)}"${m.owner === s.id ? ' selected' : ''}>${esc(s.name)} (${esc(tierName(here(s)?.tier || ''))})</option>`).join('')}
      ${gone ? `<option value="${esc(m.owner)}" selected disabled>A sponsor no longer here: ${esc(elite)} take turns</option>` : ''}</select></td></tr>`;
  }).join('');

  // Vacancy card
  for (const [f, el] of [['heading', 'vHeading'], ['message', 'vMessage'], ['contact', 'vContact'], ['link', 'vLink']]) {
    if (document.activeElement !== $(el)) $<HTMLInputElement>(el).value = view.vacancy[f] || '';
  }
  $<HTMLInputElement>('vHeading').placeholder = view.vacancyDefaults.heading;
  $<HTMLInputElement>('vMessage').placeholder = view.vacancyDefaults.message;
  showQr($('vQr'), $('vQrLink'), view.vacancyLink ? `/api/sponsors/qr.svg?vacancy=1&t=${Date.now()}` : null, view.vacancyLink, 'No link yet');

  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('main input, main select, main button').forEach(e => { if (view.readOnly && !e.closest('.fp-bar')) e.disabled = true; });
}

function card(s: Sponsor) {
  const d = document.createElement('div');
  d.className = 'sp' + (s.state === 'ended' ? ' ended' : '');
  const meta = [s.website.replace(/^https?:\/\/(www\.)?|^mailto:/g, '').replace(/\/$/, ''), s.offer && `offer "${s.offer}"`,
    s.targetSeconds && `${Math.round(s.targetSeconds / 6) / 10} min a stream`, s.targetPlays && `${s.targetPlays} ad plays`, s.ads && s.ads.length && (s.ads.length === 1 ? '1 ad' : `${s.ads.length} ads`)].filter(Boolean).join(' · ');
  const others = Object.keys(s.competitions).filter(id => id !== compId()).map(id => view.competitions.find(c => c.id === id)?.name).filter(Boolean);
  const state = s.state === 'ended' ? `<span class="pill ended">Ended ${esc(s.end)}</span>` : s.state === 'starts' ? `<span class="pill starts">Starts ${esc(s.start)}</span>` : '';
  d.innerHTML = `<div class="sp__logo">${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="">` : esc(s.name.slice(0, 8).toUpperCase())}</div>
    <div><div class="sp__name">${esc(s.name)} ${state}</div><div class="sp__meta">${esc(meta || 'No website yet')}</div>
    ${others.length ? `<div class="sp__meta">Also on ${esc(others.join(', '))}</div>` : ''}</div>
    <div><button class="alt small" type="button">Edit</button></div>`;
  d.querySelector<HTMLButtonElement>('button')!.onclick = () => openEditor(s);
  (d.children[1] as HTMLElement).append(tonightLine(s.id));
  return d;
}

function showQr(box: HTMLElement, linkEl: HTMLElement, src: string | null, link: string, none: string) {
  box.innerHTML = src ? `<img src="${esc(src)}" alt="QR code">` : esc(none);
  linkEl.textContent = link || '';
}

async function load() {
  view = await api('/api/sponsors');
  render();
  tonightNow();
}

// Tonight so far on each sponsor's card (the Sponsor report has the rest), every 30 seconds.
let tonight: Record<string, { seconds: number; plays: number }> = {}, tonightTimer: ReturnType<typeof setTimeout> | undefined;
const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
async function tonightNow() {
  clearTimeout(tonightTimer);
  tonightTimer = setTimeout(tonightNow, 30000);
  if (!view || !view.competition) return;
  try {
    const r = await api<{ sponsors: { id: string; seconds: number; plays: number }[] }>(`/api/sponsors/report?competition=${encodeURIComponent(view.competition.id)}`);
    tonight = Object.fromEntries(r.sponsors.map(s => [s.id, s]));
  } catch { return; }
  for (const el of document.querySelectorAll<HTMLElement>('[data-tonight]')) el.replaceWith(tonightLine(el.dataset.tonight || ''));
}
function tonightLine(id: string) {
  const d = document.createElement('div');
  d.dataset.tonight = id;
  const s = view.sponsors.find(x => x.id === id), t = tonight[id];
  if (!s || (!t && !s.targetSeconds)) return d;
  const sec = t ? t.seconds : 0, plays = t ? t.plays : 0;
  const words = [s.targetSeconds ? `Tonight ${mins(sec)} of ${mins(s.targetSeconds)} on screen` : `Tonight ${mins(sec)} on screen`,
    s.targetPlays ? `${plays} of ${s.targetPlays} ad plays` : plays ? `${plays} ad play${plays === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  const f = s.targetSeconds ? Math.min(1, sec / s.targetSeconds) : 0;
  d.innerHTML = `${s.targetSeconds ? `<div class="meter"><i class="${f >= 1 ? 'done' : ''}" style="width:${Math.round(f * 100)}%"></i></div>` : ''}<div class="sp__meta">${esc(words)}${f >= 1 ? ' ✓' : ''}</div>`;
  return d;
}

// ─── Tiers and vacancy card: saved as they change ──────────────────────────
let settingsTimer: ReturnType<typeof setTimeout> | undefined;
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const own: Record<string, string> = {};
    document.querySelectorAll<HTMLInputElement>('[data-own]').forEach(i => { own[i.dataset.own || ''] = i.value; });
    const empty: Record<string, string> = {};
    document.querySelectorAll<HTMLSelectElement>('[data-empty]').forEach(s => { empty[s.dataset.empty || ''] = s.value; });
    const body: { sponsorTierNames: string; sponsorEmpty: Record<string, string>; sponsorVacancy: Record<string, string>; sponsorOwnNames?: Record<string, string> } = {
      sponsorTierNames: document.querySelector<HTMLInputElement>('input[name=set]:checked')?.value || '',
      sponsorEmpty: empty,
      sponsorVacancy: { heading: $<HTMLInputElement>('vHeading').value, message: $<HTMLInputElement>('vMessage').value, contact: $<HTMLInputElement>('vContact').value, link: $<HTMLInputElement>('vLink').value },
    };
    if (Object.keys(own).length || body.sponsorTierNames !== 'own') body.sponsorOwnNames = Object.keys(own).length ? own : view.ownNames;
    try {
      view = await post('/api/sponsors/settings', body);
      render();
      studioStatus('Saved');
    } catch (err) { studioStatus(errText(err), 'error'); }
  }, 450);
}
$('sets').onchange = () => saveSettings();
$<HTMLTableSectionElement>('tierRows').addEventListener('change', () => saveSettings());
$<HTMLTableSectionElement>('tierRows').addEventListener('input', e => { if (e.target instanceof HTMLElement && e.target.dataset.own) saveSettings(); });
for (const id of ['vHeading', 'vMessage', 'vContact', 'vLink']) $(id).addEventListener('input', () => saveSettings());
$<HTMLTableSectionElement>('momentRows').addEventListener('change', async () => {
  const moments: Record<string, string> = {};
  document.querySelectorAll<HTMLSelectElement>('[data-moment]').forEach(s => { if (s.value) moments[s.dataset.moment || ''] = s.value; });
  try {
    view = await post('/api/sponsors/settings', { sponsorMoments: moments });
    render();
    studioStatus('Saved');
  } catch (err) { studioStatus(errText(err), 'error'); }
});

// ─── QR codes as PNG files ─────────────────────────────────────────────────
async function savePng(src: string, name: string) {
  const svg = await (await fetch(src)).text();
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 1200;
  const g = c.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, c.width, c.height);
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `${name} QR code.png`;
  a.click();
}
$<HTMLButtonElement>('vSave').onclick = () => { if (view.vacancyLink) savePng('/api/sponsors/qr.svg?vacancy=1', `${view.competition?.name || 'Sponsorship'} sponsorship`); };

// ─── Sponsors ──────────────────────────────────────────────────────────────
$<HTMLButtonElement>('addSponsor').onclick = () => openEditor(null);
$<HTMLButtonElement>('shareAdd').onclick = async () => {
  const s = view.sponsors.find(x => x.id === $<HTMLSelectElement>('shareWhich').value);
  if (!s) return;
  view = await post('/api/sponsors', { ...s, competitions: { ...s.competitions, [compId()]: { tier: $<HTMLSelectElement>('shareTier').value } } });
  render();
};

const colourField = ColourPicker.field('#2274a5', h => { editColour = h; }, { label: 'Brand colour' });
$('edColour').append(colourField);

function openEditor(s: Sponsor | null) {
  const copy: Sponsor = s ? structuredClone(s) : { id: '', name: '', website: '', tracking: true, competitions: { [compId()]: { tier: 'major' } } };
  editing = { ...copy, ads: copy.ads || [] };
  $('edTitle').textContent = s ? s.name : 'New sponsor';
  $<HTMLInputElement>('edName').value = editing.name;
  $<HTMLSelectElement>('edTier').innerHTML = `<option value="">Not shown</option>` + view.tiers.map(t => `<option value="${t.key}">${esc(t.name)}</option>`).join('');
  $<HTMLSelectElement>('edTier').value = editing.competitions[compId()]?.tier || '';
  $<HTMLInputElement>('edTagline').value = editing.tagline || '';
  $<HTMLInputElement>('edWebsite').value = (editing.website || '').replace(/^mailto:/, '');
  $<HTMLInputElement>('edOffer').value = editing.offer || '';
  $<HTMLInputElement>('edCategory').value = editing.category || '';
  $<HTMLDataListElement>('categories').innerHTML = [...new Set(view.sponsors.map(x => x.category).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('');
  $<HTMLInputElement>('edStart').value = editing.start || '';
  $<HTMLInputElement>('edEnd').value = editing.end || '';
  $<HTMLInputElement>('edTargetMin').value = editing.targetSeconds ? String(editing.targetSeconds / 60) : '';
  $<HTMLInputElement>('edTargetPlays').value = editing.targetPlays ? String(editing.targetPlays) : '';
  $<HTMLInputElement>('edTracking').checked = editing.tracking !== false;
  editColour = editing.colour || '';
  colourField.setValue(editing.colour || '#2274a5');
  $<HTMLButtonElement>('edDelete').hidden = !s;
  $('edError').hidden = true;
  renderLogos();
  renderAds();
  renderShown();
  renderEditorQr();
  $<HTMLDialogElement>('editor').showModal();
  editorGuard.opened();
}

// Ads: files in the scene's media folder, a still with its seconds on screen.
let media: MediaFile[] = [];
const VIDEO = /\.(mp4|m4v|webm|mov)$/i;
async function loadMedia() {
  try { const got: { media?: MediaFile[] } = await (await fetch('/api/scene/media', { cache: 'no-store' })).json(); media = (got.media || []).filter(m => m.kind === 'video' || m.kind === 'image'); } catch { media = []; }
  $<HTMLSelectElement>('edAdPick').innerHTML = '<option value="">or pick from the media folder…</option>' + media.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
}
function renderAds() {
  $('edAds').innerHTML = editing.ads.length ? '' : '<div class="empty">No ads yet.</div>';
  editing.ads.forEach((ad, i) => {
    const row = document.createElement('div');
    row.className = 'ad';
    const m = media.find(x => x.name === ad.file);
    const video = VIDEO.test(ad.file);
    row.innerHTML = `<div><b></b> <span class="help" style="margin:0"></span></div><div class="len"></div><button class="alt small" type="button">Remove</button>`;
    row.querySelector<HTMLElement>('b')!.textContent = ad.file;
    row.querySelector<HTMLElement>('span')!.textContent = !m ? 'not in the media folder' : video ? `video${m.duration ? `, ${Math.round(m.duration)} s` : ''}` : 'still';
    if (!video) {
      const sec = Object.assign(document.createElement('input'), { type: 'number', min: '3', max: '60', value: String(ad.seconds || 8), title: 'Seconds on screen' });
      sec.onchange = () => { ad.seconds = Math.max(3, Math.min(60, Math.round(Number(sec.value) || 8))); };
      row.querySelector<HTMLElement>('.len')!.append(sec, ' s');
    }
    row.querySelector<HTMLButtonElement>('button')!.onclick = () => { editing.ads.splice(i, 1); renderAds(); };
    row.querySelector<HTMLButtonElement>('button')!.disabled = view.readOnly;
    $('edAds').append(row);
  });
  $<HTMLInputElement>('edAdFile').disabled = $<HTMLSelectElement>('edAdPick').disabled = view.readOnly || editing.ads.length >= 10;
}
function addAd(file: string) {
  if (!file || editing.ads.some(a => a.file === file)) return;
  editing.ads.push({ file, seconds: 8 });
  renderAds();
}
$<HTMLSelectElement>('edAdPick').onchange = () => { addAd($<HTMLSelectElement>('edAdPick').value); $<HTMLSelectElement>('edAdPick').value = ''; };
$<HTMLInputElement>('edAdFile').onchange = async () => {
  const f = $<HTMLInputElement>('edAdFile').files?.[0];
  $<HTMLInputElement>('edAdFile').value = '';
  if (!f) return;
  $('edAdNote').textContent = `Adding ${f.name}…`;
  try {
    const r = await fetch(`/api/scene/media?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    await loadMedia();
    addAd(body.file);
    $('edAdNote').textContent = body.converting ? 'Added. Studio is converting the .mov so it plays in a browser.' : 'Added. Save to keep it.';
  } catch (err) { $('edAdNote').textContent = `Couldn't add it: ${errText(err)}`; }
};
loadMedia();

function renderLogos() {
  $('edLogoNote').hidden = !!editing.id;
  document.querySelectorAll<HTMLElement>('.logoslot').forEach(slot => {
    const which = slot.dataset.which as LogoField, url = editing.id && editing[which] ? `/sponsors/${editing.id}/${encodeURIComponent(editing[which])}?t=${Date.now()}` : null;
    const made = !url && which === 'logoWhite' && editing.id && editing.logo ? `/sponsors/${editing.id}/${encodeURIComponent(editing.logo)}` : null;
    slot.querySelector<HTMLElement>('.pic')!.innerHTML = url ? `<img src="${esc(url)}" alt="">`
      : made ? `<img src="${esc(made)}" alt="" style="filter:brightness(0) invert(1)" title="Made from the colour logo">` : 'No logo';
    slot.querySelector<HTMLElement>('[data-remove]')!.hidden = !url;
    slot.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach(e => { e.disabled = !editing.id || view.readOnly; });
  });
}

function renderShown() {
  $<HTMLTableSectionElement>('edShown').innerHTML = view.competitions.filter(c => c.id !== compId()).map(c => `<tr>
    <td>${esc(c.name)}${c.sameOrganisation ? ' <span class="org">same organisation</span>' : ''}</td>
    <td><select data-comp="${esc(c.id)}" aria-label="Tier on ${esc(c.name)}"><option value="">Not shown</option>${view.tiers.map(t =>
      `<option value="${t.key}" ${editing.competitions[c.id]?.tier === t.key ? 'selected' : ''}>${esc(view.nameSets.names[t.key])}</option>`).join('')}</select></td></tr>`).join('')
    || `<tr><td class="empty">No other competitions yet. A sponsor can be shown on more than one, at its own tier in each.</td></tr>`;
}

let qrTimer: ReturnType<typeof setTimeout> | undefined;
function renderEditorQr() {
  clearTimeout(qrTimer);
  qrTimer = setTimeout(() => {
    const website = $<HTMLInputElement>('edWebsite').value.trim();
    if (!editing.id || !website) {
      showQr($('edQr'), $('edQrLink'), null, '', website ? 'Save the sponsor to see its QR code' : 'No website yet');
      $<HTMLButtonElement>('edQrSave').disabled = true;
      return;
    }
    const src = `/api/sponsors/qr.svg?id=${encodeURIComponent(editing.id)}&link=${encodeURIComponent(website)}&tracking=${$<HTMLInputElement>('edTracking').checked ? 1 : 0}`;
    const s = view.sponsors.find(x => x.id === editing.id);
    showQr($('edQr'), $('edQrLink'), src, $<HTMLInputElement>('edTracking').checked ? (s && s.website === editing.website ? s.qrLink || '' : '') : website, '');
    $<HTMLButtonElement>('edQrSave').disabled = false;
    $<HTMLButtonElement>('edQrSave').onclick = () => savePng(src, $<HTMLInputElement>('edName').value || 'Sponsor');
  }, 300);
}
$<HTMLInputElement>('edWebsite').addEventListener('input', renderEditorQr);
$<HTMLInputElement>('edTracking').addEventListener('change', renderEditorQr);

function fromEditor(): SponsorDraft {
  const comps: Record<string, { tier: string }> = {};
  document.querySelectorAll<HTMLSelectElement>('[data-comp]').forEach(s => { if (s.value) comps[s.dataset.comp || ''] = { tier: s.value }; });
  if ($<HTMLSelectElement>('edTier').value) comps[compId()] = { tier: $<HTMLSelectElement>('edTier').value };
  return { ...editing, name: $<HTMLInputElement>('edName').value, tagline: $<HTMLInputElement>('edTagline').value, website: $<HTMLInputElement>('edWebsite').value, offer: $<HTMLInputElement>('edOffer').value,
    category: $<HTMLInputElement>('edCategory').value, start: $<HTMLInputElement>('edStart').value, end: $<HTMLInputElement>('edEnd').value, colour: editColour,
    targetSeconds: Math.round((Number($<HTMLInputElement>('edTargetMin').value) || 0) * 60), targetPlays: Number($<HTMLInputElement>('edTargetPlays').value) || 0,
    tracking: $<HTMLInputElement>('edTracking').checked, competitions: comps, ads: editing.ads || [] };
}

async function saveSponsor() {
  if (!$<HTMLInputElement>('edName').value.trim()) { $<HTMLInputElement>('edName').focus(); return false; }
  try {
    const wasNew = !editing.id;
    const before = new Set(view.sponsors.map(s => s.id));
    view = await post('/api/sponsors', fromEditor());
    render();
    if (wasNew) {
      // Stay open on a new sponsor, so its logos can be added straight away.
      const s = view.sponsors.find(x => !before.has(x.id));
      if (s) { editing = { ...structuredClone(s), ads: s.ads || [] }; $('edTitle').textContent = s.name; $<HTMLButtonElement>('edDelete').hidden = false; renderLogos(); renderEditorQr(); editorGuard.opened(); return 'open'; }
    }
    return true;
  } catch (err) { $('edError').textContent = errText(err); $('edError').hidden = false; return false; }
}
$<HTMLFormElement>('edForm').addEventListener('submit', async e => {
  if (e.submitter instanceof HTMLButtonElement && e.submitter.value === 'cancel') return;
  e.preventDefault();
  if (await saveSponsor() === true) $<HTMLDialogElement>('editor').close();
});
// Escape or leaving the page with changes not saved asks first (unsaved.js). Logos are saved as
// they're added, so they don't count.
const editorGuard = unsavedDialog($<HTMLDialogElement>('editor'), {
  what: () => $<HTMLInputElement>('edName').value.trim() || 'the new sponsor',
  snapshot: () => { const { logo, logoWhite, ...x } = fromEditor(); return x; },
  save: async () => { if (!await saveSponsor()) return false; $<HTMLDialogElement>('editor').close(); return true; },
});
$<HTMLButtonElement>('edDelete').onclick = async () => {
  const on = Object.keys(editing.competitions).length;
  if (!await askConfirm(`Delete ${editing.name}${on > 1 ? ` from all ${on} competitions it's shown on` : ''}, with its logos?`, 'To take it off just this competition, set its tier to Not shown.', { ok: 'Delete', danger: true })) return;
  view = await api(`/api/sponsors?id=${encodeURIComponent(editing.id)}`, { method: 'DELETE' });
  render();
  $<HTMLDialogElement>('editor').close();
};

async function uploadLogo(which: LogoField, file: File | undefined) {
  if (!file || !editing.id) return;
  try {
    view = await api(`/api/sponsors/logo?id=${encodeURIComponent(editing.id)}&which=${which}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const s = view.sponsors.find(x => x.id === editing.id);
    editing[which] = s?.[which];
    render(); renderLogos();
  } catch (err) { $('edError').textContent = errText(err); $('edError').hidden = false; }
}
document.querySelectorAll<HTMLElement>('.logoslot').forEach(slot => {
  const which = slot.dataset.which as LogoField, input = slot.querySelector<HTMLInputElement>('input[type=file]')!;
  input.onchange = () => uploadLogo(which, input.files?.[0]);
  slot.querySelector<HTMLElement>('[data-remove]')!.onclick = async () => {
    view = await api(`/api/sponsors/logo?id=${encodeURIComponent(editing.id)}&which=${which}`, { method: 'DELETE' });
    editing[which] = '';
    render(); renderLogos();
  };
  slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('over'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('over'));
  slot.addEventListener('drop', e => { e.preventDefault(); slot.classList.remove('over'); uploadLogo(which, e.dataTransfer?.files[0]); });
});

load().catch((err: unknown) => { document.querySelector('main')?.insertAdjacentHTML('beforeend', `<p class="error">${esc(errText(err))}</p>`); });

// What makes this file a module (its names its own), as the first line says.
export {};
