// FirstPass Studio - the viewers count's script (viewers.html loads it as a module, so its names stay its own).

// What /api/viewers answers (viewers.ts): the live streams' viewers now, and tonight's peak.
interface Viewers { total: number; live: number; minimum?: number; streams: { platform: string }[]; peak: { n: number } | null }
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = params.get('show') === 'peak' ? 'peak' : 'now';
const minOf = (v: Viewers) => params.has('min') ? Number(params.get('min')) || 0 : v.minimum || 0;
const platforms = (v: Viewers) => {
  const names = [...new Set(v.streams.map(s => s.platform === 'facebook' ? 'Facebook' : 'YouTube'))];
  return names.length ? `on ${names.join(' and ')}` : '';
};

// Counts from the number on screen to the new one, so a reading going up looks alive.
let shown = 0, raf = 0;
function countTo(box: HTMLElement, n: number) {
  cancelAnimationFrame(raf);
  const from = shown, start = performance.now();
  const step = (now: number) => {
    const f = Math.min(1, (now - start) / 1200);
    shown = Math.round(from + (n - from) * (1 - Math.pow(1 - f, 3)));
    box.textContent = shown.toLocaleString();
    if (f < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

async function viewers(): Promise<Viewers> { return (await fetch('/api/viewers', { cache: 'no-store' })).json(); }

let wasOn: boolean | null = null;
async function now() {
  try {
    const v = await viewers();
    const on = v.live > 0 && v.total >= minOf(v);
    if (on) countTo($('nowN'), v.total);
    $('now').classList.toggle('on', on);
    if (on !== wasOn) window.pageLog?.('info', on ? `Viewers: showing ${v.total} watching` : `Viewers: hidden (${v.live ? `${v.total} is under ${minOf(v)}` : 'no stream live'})`);
    wasOn = on;
  } catch (err) { console.warn('Viewers unavailable:', err instanceof Error ? err.message : err); }
  setTimeout(now, 15000);
}

async function peak() {
  try {
    const v = await viewers();
    const p = v.peak;
    if (!p || p.n < minOf(v)) { window.pageLog?.('info', `Viewers: no peak to show tonight${p ? ` (${p.n} is under ${minOf(v)})` : ''}`); return; }
    const title = params.get('title');
    if (title) $('peakTitle').textContent = title;
    $('peakSub').textContent = ['watching live', platforms(v)].filter(Boolean).join(' ');
    $('peak').hidden = false;
    countTo($('peakN'), p.n);
    window.pageLog?.('info', `Viewers: tonight's peak ${p.n}`);
    const out = Number(params.get('out'));
    if (out > 0) {
      setTimeout(() => { $('peak').classList.add('out'); }, out * 1000);
      studioDone(out * 1000 + 700);
    }
  } catch (err) { console.warn('Viewers unavailable:', err instanceof Error ? err.message : err); }
}

if (show === 'peak') { $('now').hidden = true; peak(); } else now();

// What makes this file a module (its names its own), as the first line says.
export {};
