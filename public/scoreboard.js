(function () {
  const params = new URLSearchParams(location.search);
  const boardId = params.get('board') || '1';
  document.body.classList.add(params.get('position') || 'above-ticker');

  const $ = id => document.getElementById(id);
  let state = null;
  let clockOffset = 0; // server time minus local time
  const textOn = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
  };

  function setText(id, text) { if ($(id).textContent !== String(text)) $(id).textContent = text; }

  // Shrink a team or court name until it fits its panel.
  function fitName(id) {
    const el = $(id), box = el.parentElement, cs = getComputedStyle(box);
    el.style.fontSize = '';
    const room = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > room && size > 12) { size -= 1; el.style.fontSize = size + 'px'; }
  }
  function setName(id, text) {
    if ($(id).textContent === String(text)) return;
    $(id).textContent = text;
    fitName(id);
  }

  function setScore(id, value) {
    const el = $(id);
    if (el.textContent !== String(value)) {
      const changed = el.textContent !== '';
      el.textContent = value;
      if (changed) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    }
  }

  // A team colour from the competition setup page goes behind that team's name, with
  // dark or white text, whichever reads better on it. No colour: the competition's.
  function setTeamColour(id, colour) {
    const box = $(id).parentElement;
    if ((box.dataset.colour || '') === (colour || '')) return;
    box.dataset.colour = colour || '';
    box.style.background = colour || '';
    box.style.color = colour ? textOn(colour) : '';
  }

  function clockText() {
    if (!state || !state.showClock) return '';
    const c = state.clock;
    const elapsed = state.clockElapsedMs + (c.running ? Date.now() + clockOffset - state.serverNow : 0);
    const left = Math.max(0, c.lengthSec * 1000 - elapsed);
    const s = Math.ceil(left / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function render() {
    if (!state) return;
    const firstShow = $('bug').hidden;
    $('bug').hidden = false;
    if (firstShow) { $('homeName').textContent = ''; $('awayName').textContent = ''; $('court').textContent = ''; }
    setName('homeName', state.home.name);
    setName('awayName', state.away.name);
    const colours = state.teamColours || {};
    setTeamColour('homeName', colours.home);
    setTeamColour('awayName', colours.away);
    setScore('homeScore', state.home.score ?? 0);
    setScore('awayScore', state.away.score ?? 0);
    setText('period', state.period >= 5 ? 'ET' : `${state.periodLabel}${state.period}`);
    setText('clock', clockText());
    $('bug').classList.toggle('has-court', !!state.court);
    setName('court', state.court || '');
    $('live').hidden = state.source !== 'playhq';
    $('bug').hidden = false;
  }

  async function load() {
    try {
      const res = await fetch(`/api/scoreboard?board=${encodeURIComponent(boardId)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state = await res.json();
      clockOffset = state.serverNow - Date.now();
      render();
    } catch (err) { console.warn('Scoreboard unavailable:', err.message); }
  }

  if (document.fonts) document.fonts.ready.then(() => { fitName('homeName'); fitName('awayName'); fitName('court'); });
  load();
  setInterval(load, 1000);
  setInterval(render, 250);
})();
