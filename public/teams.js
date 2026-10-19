// Shared by teamlist.html and shooting.html: loads the selected game's team sheets.
window.loadTeams = function (onData) {
  const params = new URLSearchParams(location.search);
  let last = '';
  async function load() {
    try {
      const res = await fetch('/api/teams', { cache: 'no-store' });
      const data = await res.json();
      if (data.error) console.warn('Team sheets:', data.error);
      const json = JSON.stringify(data, (k, v) => (k === 'updatedAt' ? undefined : v));
      if (json !== last) { last = json; onData(data); }
    } catch (err) { console.warn('Team sheets unavailable:', err.message); }
  }
  load();
};

window.el = function (tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};

// Logo, or the team's initials in a circle when there's no logo file for it.
window.logoEl = function (team, cls) {
  if (team.logo) { const img = el('img', cls); img.src = team.logo; img.alt = ''; return img; }
  const initials = String(team.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return el('div', cls + ' logo-fallback', initials);
};
