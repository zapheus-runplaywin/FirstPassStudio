// Shared by the season graphics: load one helper API once and show any error on the page.
// loadJson(path, onData): one of Studio's own answers, typed by the page that asks (T).
async function loadJson<T>(path: string, onData: (data: T) => void) {
  const params = new URLSearchParams(location.search);
  const msg = document.getElementById('message');
  try {
    const res = await fetch(`${path}?${params}`, { cache: 'no-store' });
    const data: unknown = await res.json();
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    if (error && res.status >= 400) throw new Error(String(error));
    onData(data as T);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`${document.title} unavailable:`, why);
    if (msg) { msg.textContent = `${document.title} unavailable: ${why}`; msg.hidden = false; }
  }
}
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const record = (l: { won?: number, lost?: number, drawn?: number }) => `${l.won ?? 0}W ${l.lost ?? 0}L${l.drawn ? ` ${l.drawn}D` : ''}`;
const shortDate = (d: string | null | undefined) => { const x = d ? new Date(`${d}T00:00:00`) : null; return x && !isNaN(x.getTime()) ? x.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''; };
