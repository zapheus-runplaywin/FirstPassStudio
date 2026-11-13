// FirstPass Studio - the Sponsor report page's script (sponsorreport.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What Studio answers (exposure.ts report() and nights(), sponsors.ts state()).
interface ReportSponsor {
  id: string; name: string; tier: string; gone: boolean; seconds: number; qrSeconds: number; plays: number; adFiles: Record<string, number>;
  viewerMinutes: number; places: Record<string, number>; target: { seconds: number; plays: number };
  showings: { place: string; source: string; from: number; to: number; seconds: number }[];
}
interface Report {
  competition: { id: string; name: string; tiers: { key: string; name: string }[] } | null; nights: string[]; offAir: boolean;
  sponsors: ReportSponsor[]; viewers: { peak: number; average: number; readings: number } | null;
}
interface Nights { tonight: string; nights: string[] }
interface SponsorsView { competitions?: { id: string; name: string }[]; competition?: { id: string } | null }
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
const PLACES: Record<string, string> = { scoreboard: 'Scoreboard tab', title: 'Title', countdown: 'Countdown', stats: 'Stat card footers', ticker: 'Ticker',
  card: 'Sponsor card', wall: 'Sponsor wall', night: 'End of night card', ad: 'Ads', moment: 'Sponsored moments' };
const place = (p: string) => PLACES[p] || p;
function time(seconds: number) {
  const sec = Math.round(seconds || 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const day = (n: string) => new Date(n + 'T12:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const params = new URLSearchParams(location.search);
let tonight = '', picked = new Set<string>(), comp = params.get('competition') || '';

async function load() {
  const [n, v]: [Nights, SponsorsView] = await Promise.all([
    fetch('/api/sponsors/nights', { cache: 'no-store' }).then(r => r.json()),
    fetch('/api/sponsors', { cache: 'no-store' }).then(r => r.json()),
  ]);
  tonight = n.tonight;
  const all = [...new Set([tonight, ...n.nights])].sort().reverse();
  if (!picked.size) for (const x of (params.get('nights') || tonight).split(',')) picked.add(x);
  const comps = v.competitions || [];
  if (!comp) comp = (v.competition && v.competition.id) || (comps[0] && comps[0].id) || '';
  $<HTMLSelectElement>('comp').innerHTML = comps.map(c => `<option value="${esc(c.id)}"${c.id === comp ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  $('nights').innerHTML = all.map(x => `<label class="${picked.has(x) ? 'on' : ''}"><input type="checkbox" value="${x}"${picked.has(x) ? ' checked' : ''}>${x === tonight ? 'Tonight' : esc(day(x))}</label>`).join('');
  $('nights').dataset.all = all.join(',');
  await report();
}

async function report() {
  const q = new URLSearchParams({ nights: [...picked].join(','), competition: comp });
  if ($<HTMLInputElement>('offAir').checked) q.set('offair', '1');
  const r: Report = await (await fetch(`/api/sponsors/report?${q}`, { cache: 'no-store' })).json();
  const tierName = Object.fromEntries(((r.competition && r.competition.tiers) || []).map(t => [t.key, t.name]));
  const name = r.competition ? r.competition.name : '';
  $('compName').textContent = name || 'the competition in use';
  const when = r.nights.length === 1 ? (r.nights[0] === tonight ? 'Tonight' : day(r.nights[0])) : `${r.nights.length} nights`;
  $('tableTitle').textContent = when + (r.viewers ? ` · up to ${r.viewers.peak.toLocaleString()} watching, ${r.viewers.average.toLocaleString()} on average` : '');
  $<HTMLTableSectionElement>('rows').closest('table')?.classList.toggle('noviewers', !r.viewers);
  $('printHead').innerHTML = `<b>${esc(name)}</b> · ${esc(r.nights.length === 1 ? day(r.nights[0]) : `${r.nights.length} nights, ${day(r.nights[r.nights.length - 1])} to ${day(r.nights[0])}`)}`;
  document.title = `Sponsor report ${name ? '· ' + name + ' ' : ''}· FirstPass Studio`;
  $('none').hidden = r.sponsors.length > 0;

  const against = (s: ReportSponsor) => {
    const parts: [string, number, string][] = [];
    if (s.target.seconds) parts.push(['Time', s.seconds / s.target.seconds, `${time(s.seconds)} of ${time(s.target.seconds)}`]);
    if (s.target.plays) parts.push(['Ads', s.plays / s.target.plays, `${s.plays} of ${s.target.plays} plays`]);
    if (!parts.length) return '<span class="empty">No target</span>';
    return parts.map(([what, f, words]) => `<div class="bar" title="${esc(words)}"><em>${what}</em><span><i class="${f >= 1 ? 'met' : ''}" style="width:${Math.min(100, Math.round(f * 100))}%"></i></span><b>${esc(words)}</b></div>`).join('');
  };
  $<HTMLTableSectionElement>('rows').innerHTML = r.sponsors.map(s => `<tr>
      <td><b>${esc(s.name)}</b>${s.tier ? `<span class="tier">${esc(tierName[s.tier] || s.tier)}</span>` : ''}
        <div class="places">${Object.entries(s.places).sort((a, b) => b[1] - a[1]).map(([p, sec]) => `${esc(place(p))} ${time(sec)}`).join(' · ')}</div></td>
      <td class="num">${time(s.seconds)}</td><td class="num">${s.plays || '–'}</td><td class="num">${s.qrSeconds ? time(s.qrSeconds) : '–'}</td><td class="num vm">${s.viewerMinutes ? s.viewerMinutes.toLocaleString() : '–'}</td>
      <td>${against(s)}</td></tr>`).join('');

  $('details').innerHTML = r.sponsors.map(s => `<section class="sponsor">
      <h2>${esc(s.name)}</h2>
      <div class="row"><span>On screen <b>${time(s.seconds)}</b></span><span>Ad plays <b>${s.plays}</b></span><span>QR on screen <b>${time(s.qrSeconds)}</b></span>${r.viewers ? `<span>Viewer-minutes <b>${s.viewerMinutes.toLocaleString()}</b></span>` : ''}</div>
      ${Object.keys(s.adFiles).length ? `<p class="help">Ads: ${Object.entries(s.adFiles).map(([f, n]) => `${esc(f)} × ${n}`).join(', ')}</p>` : ''}
      <details${matchMedia('print').matches ? ' open' : ''}><summary>Every showing (${s.showings.length})</summary>
        <div class="tblwrap"><table class="showings"><thead><tr>${r.nights.length > 1 ? '<th>Night</th>' : ''}<th>From</th><th>Where</th><th>Source</th><th class="num">How long</th></tr></thead><tbody>
        ${s.showings.map(x => `<tr>${r.nights.length > 1 ? `<td>${esc(day(nightOf(x.from)))}</td>` : ''}<td>${esc(clock(x.from))}</td><td>${esc(place(x.place))}</td><td>${esc(x.source)}</td><td class="num">${time(x.seconds)}</td></tr>`).join('')}
        </tbody></table></div></details></section>`).join('');
}
function nightOf(ms: number) {
  const d = new Date(ms - 4 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

$('nights').addEventListener('change', e => {
  const box = e.target as HTMLInputElement;
  if (box.checked) picked.add(box.value); else picked.delete(box.value);
  if (!picked.size) { picked.add(box.value); box.checked = true; }
  box.closest('label')?.classList.toggle('on', box.checked);
  report();
});
const pickOnly = (list: string[]) => { picked = new Set(list); for (const b of $('nights').querySelectorAll('input')) { b.checked = picked.has(b.value); b.closest('label')?.classList.toggle('on', b.checked); } report(); };
$<HTMLButtonElement>('allNights').onclick = () => pickOnly(($('nights').dataset.all || '').split(','));
$<HTMLButtonElement>('tonightOnly').onclick = () => pickOnly([tonight]);
$<HTMLSelectElement>('comp').onchange = () => { comp = $<HTMLSelectElement>('comp').value; report(); };
$<HTMLInputElement>('offAir').onchange = report;
$<HTMLButtonElement>('print').onclick = () => window.print();
window.addEventListener('beforeprint', () => document.querySelectorAll('details').forEach(d => { d.open = true; }));
load().catch(err => { $('none').hidden = false; $('none').textContent = `The report couldn't load: ${err instanceof Error ? err.message : String(err)}`; });

// What makes this file a module (its names its own), as the first line says.
export {};
