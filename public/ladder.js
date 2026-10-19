(function () {
  const params = new URLSearchParams(location.search);
  const division = params.get('division') || ''; // blank = the division of the game picked on the control page
  const refreshSeconds = Number(params.get('refresh')) || 0; // 0 = load once (reloaded when shown again)
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
    // The logo sits on the coloured header, so it uses the dark mode logo unless ?mode=light.
    const logo = (params.get('mode') === 'light' ? rules.competitionLogoLight : rules.competitionLogoDark) || rules.competitionLogo;
    $('logo').hidden = !logo || params.get('logo') === '0';
    if (!$('logo').hidden) $('logo').src = logo;

    const finals = data.finals || { places: rules.finalsPlaces || 0, marks: Array(rules.finalsPlaces || 0).fill('elim'), legend: [] };
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
        // Finals places, marked by what each earns in the division's finals format (competition setup).
        const mark = r.position <= finals.places ? finals.marks[r.position - 1] : '';
        if (mark) tr.className = `finals finals--${mark}${r.position === finals.places ? ' finals--last' : ''}`;
        cols.forEach(c => {
          const v = r[c.key];
          tr.appendChild(cell('td', v === null || v === undefined ? '' : c.format ? c.format(v) : v, c.cls));
        });
      });
      tables.appendChild(table);
    });
    if (!pools.length) tables.appendChild(cell('p', 'No ladder published yet.', 'pool__name'));
    // A key to the finals marks, when places earn different things (?key=0 leaves it off).
    $('key').replaceChildren();
    $('key').hidden = !pools.length || finals.legend.length < 2 || params.get('key') === '0';
    for (const l of finals.legend) {
      const item = cell('span', '', 'ladder__key-item');
      item.className = `ladder__key-item finals--${l.mark}`;
      item.append(cell('i', ''), cell('span', l.label));
      $('key').appendChild(item);
    }
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
      const res = await fetch(`/api/ladder?division=${encodeURIComponent(division)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.stale) console.warn('Showing the last good ladder:', data.error);
      const json = JSON.stringify([data.division, data.pools, data.rules, data.finals]);
      if (json !== lastJson) { lastJson = json; render(data); }
      loadedOnce = true;
      $('message').hidden = true;
    } catch (err) {
      console.warn("Ladder unavailable:", err.message);
      showMessage(location.protocol === 'file:'
        ? 'Open this page through Studio (http://localhost:8080/ladder.html), not as a file.'
        : `Ladder unavailable: ${err.message}`);
    }
  }

  load();
  if (refreshSeconds > 0) setInterval(load, Math.max(15, refreshSeconds) * 1000);
})();
