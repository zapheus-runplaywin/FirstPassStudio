// Shared by the season graphics: load one helper API once and show any error on the page.
window.loadJson = async function (path, onData) {
  const params = new URLSearchParams(location.search);
  const msg = document.getElementById('message');
  try {
    const res = await fetch(`${path}?${params}`, { cache: 'no-store' });
    const data = await res.json();
    if (data.error && res.status >= 400) throw new Error(data.error);
    onData(data);
  } catch (err) {
    console.warn(`${document.title} unavailable:`, err.message);
    if (msg) { msg.textContent = `${document.title} unavailable: ${err.message}`; msg.hidden = false; }
  }
};
window.ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
window.record = l => `${l.won ?? 0}W ${l.lost ?? 0}L${l.drawn ? ` ${l.drawn}D` : ''}`;
window.shortDate = d => { const x = d ? new Date(`${d}T00:00:00`) : null; return x && !isNaN(x) ? x.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''; };
