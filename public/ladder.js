(function () {
  const params = new URLSearchParams(location.search);
  const division = params.get('division') || ''; // blank = the division of the game picked on the control page
  const boardId = params.get('board') || '1';
  const refreshSeconds = Number(params.get('refresh')) || 0; // 0 = load once (OBS refreshes the source)
  const maxRows = Number(params.get('rows')) || 0;

  // Columns shown when PlayHQ provides them. Edit the labels here.
  const COLUMNS = [
    { key: 'position', label: '#', cls: 'position' },
    { key: 'team', label: 'Team', cls: 'team' },
    { key: 'played', label: 'P' },
    { key: 'won', label: 'W' },
    { key: 'lost', label: 'L' },
    { key: 'drawn', label: 'D' },
    { key: 'byes', label: 'B' },
    { key: 'pointsFor', label: 'F' },
    { key: 'pointsAgainst', label: 'A' },
    { key: 'percentage', label: '%', format: v => Number(v).toFixed(1) },
    { key: 'points', label: 'Pts', cls: 'points' },
  ];

  const $ = id => document.getElementById(id);
  let lastJson = '';
  let loadedOnce = false;

  function cell(tag, text, cls) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  function render(data) {
    $('org').textContent = data.organisation || '';
    $('comp').textContent = data.competition || '';
    $('division').textContent = data.division || '';
    document.title = `${data.competition} ${data.division} Ladder`;
    const rules = data.rules || {};
    $('logo').hidden = !rules.competitionLogo || params.get('logo') === '0';
    if (!$('logo').hidden) $('logo').src = rules.competitionLogo;

    const tables = $('tables');
    tables.replaceChildren();
    const pools = (data.pools || []).filter(p => p.length);
    pools.forEach((rows, i) => {
      if (pools.length > 1) tables.appendChild(cell('h2', `Pool ${String.fromCharCode(65 + i)}`, 'pool__name'));
      const cols = COLUMNS.filter(c => rows.some(r => r[c.key] !== null && r[c.key] !== undefined));
      const table = document.createElement('table');
      const head = table.createTHead().insertRow();
      cols.forEach(c => head.appendChild(cell('th', c.label, c.cls)));
      const body = table.createTBody();
      (maxRows ? rows.slice(0, maxRows) : rows).forEach((r, n) => {
        const tr = body.insertRow();
        tr.style.animationDelay = `${n * 60}ms`;
        if (r.position <= (rules.finalsPlaces || 0)) tr.className = 'finals';
        cols.forEach(c => {
          const v = r[c.key];
          tr.appendChild(cell('td', v === null || v === undefined ? '' : c.format ? c.format(v) : v, c.cls));
        });
      });
      tables.appendChild(table);
    });
    if (!pools.length) tables.appendChild(cell('p', 'No ladder published yet.', 'pool__name'));
    $('ladder').hidden = false;
  }

  function showMessage(text) {
    // Only shown before the first successful load, so a hiccup never appears on stream.
    if (loadedOnce) return console.warn(text);
    $('message').textContent = text;
    $('message').hidden = false;
  }

  async function load() {
    try {
      const res = await fetch(`/api/ladder?division=${encodeURIComponent(division)}&board=${encodeURIComponent(boardId)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.stale) console.warn('Showing the last good ladder:', data.error);
      const json = JSON.stringify([data.division, data.pools, data.rules]);
      if (json !== lastJson) { lastJson = json; render(data); }
      loadedOnce = true;
      $('message').hidden = true;
    } catch (err) {
      console.warn("Ladder unavailable:", err.message);
      showMessage(location.protocol === 'file:'
        ? 'Open this page through the helper (http://localhost:8080/ladder.html), not as a file.'
        : `Ladder unavailable: ${err.message}`);
    }
  }

  load();
  if (refreshSeconds > 0) setInterval(load, Math.max(15, refreshSeconds) * 1000);
})();
