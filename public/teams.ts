// Shared by teamlist.html and shooting.html: loads the selected game's team sheets.
// With { every: ms } it asks again that often (calling onData only when something changed)
// until the stop function it returns is called.
// onData gets Studio's own /api/teams answer, typed by the page that asks (T).
function loadTeams<T>(onData: (data: T) => void, options?: { every?: number }) {
  const every = options && options.every;
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  const params = new URLSearchParams(location.search);
  let last = '';
  async function load() {
    try {
      const res = await fetch('/api/teams', { cache: 'no-store' });
      const data: unknown = await res.json();
      if (data && typeof data === 'object' && 'error' in data && data.error) console.warn('Team sheets:', data.error);
      const json = JSON.stringify(data, (k, v) => (k === 'updatedAt' ? undefined : v));
      if (json !== last) { last = json; onData(data as T); }
    } catch (err) { console.warn('Team sheets unavailable:', err instanceof Error ? err.message : err); }
    if (every && !stopped) timer = setTimeout(load, every);
  }
  load();
  return () => { stopped = true; clearTimeout(timer); };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | number | null): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

// Logo, or the team's initials in a circle when there's no logo file for it.
function logoEl(team: { logo?: string | null, name?: string }, cls: string): HTMLElement {
  if (team.logo) { const img = el('img', cls); img.src = team.logo; img.alt = ''; return img; }
  const initials = String(team.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return el('div', cls + ' logo-fallback', initials);
}
