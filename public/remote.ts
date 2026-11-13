// FirstPass Studio - the Remote page's script (remote.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (t: unknown) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ESC[c]);
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let health: Health | null = null, scene: SceneState | null = null;

function showError(msg: string) { $('err').innerHTML = msg || ''; $('err').hidden = !msg; }

// A change, as the Output page makes it (POST /api/scene). A phone that isn't allowed to is pointed at pairing.
async function act(action: { type: string; [more: string]: unknown }) {
  showError('');
  try {
    const res = await fetch('/api/scene', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...action, output: 'main' }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) {
      showError(`This phone can't change things yet. <a href="/pair.html?then=%2Fremote.html">Pair it with the Mac</a> and choose Allow everything.`);
      return;
    }
    if (!res.ok) throw new Error(body.error || res.statusText);
    if (body.sources) { scene = body; draw(); }
  } catch (err) { showError(esc(err instanceof Error ? err.message : String(err))); }
}

// ─── The status at a glance ─────────────────────────────────────────
const line = (dot: string, lbl: string, main: string, sub = '') => `<span class="dot ${dot}"></span><span class="lbl">${lbl}</span><span><b>${main}</b>${sub ? `<small>${sub}</small>` : ''}</span>`;
function drawStatus() {
  const h = health;
  if (!h) return void ($('status').innerHTML = line('bad', 'Studio', 'Not answering', 'Is the Mac on the same Wi-Fi, with Studio open?'));
  const o: Partial<Health['output']> = h.output || {};
  const onAir = (o.onAir || []).map(x => esc(x.name)).join(', ');
  let html = line(o.on ? 'live' : '', 'Studio', o.on ? 'On air' : 'Off air', o.on ? onAir : 'no output is sending');
  if (h.game) {
    const s: Partial<NonNullable<Health['score']>> = h.score || {}, c = h.clock || {};
    const p: Partial<Health['playhq']> = h.playhq || {};
    const src = h.source === 'playhq' ? (p.trouble ? 'PlayHQ isn\'t scoring live' : p.state === 'bad' ? 'PlayHQ not answering' : p.state === 'warn' ? 'PlayHQ slow' : 'Following PlayHQ') : 'Scored by hand';
    const dot = h.source === 'playhq' ? (p.state === 'ok' && !p.trouble ? 'ok' : p.state === 'bad' ? 'bad' : 'warn') : 'warn';
    html += line(dot, 'Game', `<span class="score">${esc(s.homeName)} ${s.home} – ${s.away} ${esc(s.awayName)}</span>`,
      `${esc(c.periodLabel || 'Q')}${c.period || ''} · ${c.left != null ? mmss(c.left * 1000) : ''}${c.running ? ' running' : ' stopped'} · ${src}`);
  } else html += line('', 'Game', 'No game on the board');
  const pl = h.playing;
  html += pl ? line(pl.paused ? 'warn' : 'live', 'Sequence', esc(pl.name || 'Sequence'), `step ${pl.step} of ${pl.steps}${pl.paused ? ' · paused' : ''}${pl.totalLeftMs != null && (pl.totalLeftMs || !pl.totalOpen) ? ` · ${mmss(pl.totalLeftMs || 0)}${pl.totalOpen ? '+' : ''} in all` : ''}`)
    : line('', 'Sequence', 'Nothing playing');
  if (h.armed) html += line('ok', 'Armed', esc(h.armed.name), h.armed.leftMs != null ? `starts in ${mmss(h.armed.leftMs)}` : 'after the one playing');
  if (h.recording && h.recording.on) html += line('bad', 'Recording', 'Recording');
  $('status').innerHTML = html;
}

// ─── Run order, the sequence playing and the keys ───────────────────
function draw() {
  drawStatus();
  const sc = scene;
  const ro = (sc && sc.runOrder || []).filter(it => !it.gone);
  const playing = sc && sc.playing;
  $('roHead').innerHTML = ro.length ? `<b>▶ ${esc(ro[0].name)}</b><small>${ro[1] ? `then ${esc(ro[1].name)}${ro.length > 2 ? ` · ${ro.length - 2} more` : ''}` : 'last in the run order'}</small>`
    : `Empty<small>${playing ? 'Play next ends the sequence playing (its Then)' : 'Add to it on the Output page'}</small>`;
  $<HTMLButtonElement>('roNext').disabled = !ro.length && !playing;
  $<HTMLButtonElement>('roSkip').disabled = !ro.length;
  const seqs = sc && sc.sequences || [];
  const on = playing && seqs.find(s => s.id === playing.id);
  $('seqHead').innerHTML = on && playing ? `<b>${esc(on.name)}</b><small>step ${playing.step + 1} of ${playing.steps}${playing.paused ? ' · paused' : ''}</small>` : 'Nothing playing';
  for (const id of ['seqNext', 'seqPause', 'seqStop']) $<HTMLButtonElement>(id).disabled = !on;
  $<HTMLButtonElement>('seqPause').textContent = playing && playing.paused ? 'Carry on' : 'Pause';
  const keys = $('keys');
  const want = seqs.map(s => s.id).join();
  if (keys.dataset.ids !== want) {
    keys.dataset.ids = want;
    keys.replaceChildren(...seqs.map(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = s.id;
      // Read at the press: the key may have been made before this sequence started.
      b.onclick = () => act(scene && scene.playing && scene.playing.id === s.id ? { type: 'seqStop' } : { type: 'seqPlay', sequence: s.id });
      return b;
    }));
    if (!seqs.length) keys.innerHTML = '<p class="help">No sequences yet: make them on the Output page.</p>';
  }
  for (const b of keys.querySelectorAll('button')) {
    const s = seqs.find(x => x.id === b.dataset.id);
    if (!s) continue;
    const lit = !!(playing && playing.id === s.id);
    b.className = `${['blue', 'green', 'grey', 'yellow', 'purple'].includes(s.colour) ? s.colour : 'blue'}${lit ? ' on' : ''}`;
    b.setAttribute('aria-pressed', String(lit));
    b.innerHTML = `${esc(s.name)}${lit && playing ? `<small>ON · ${playing.step + 1}/${playing.steps}</small>` : ''}`;
  }
}

$<HTMLButtonElement>('roNext').onclick = () => act({ type: 'roNext' });
$<HTMLButtonElement>('roSkip').onclick = () => act({ type: 'roSkip' });
$<HTMLButtonElement>('seqNext').onclick = () => act({ type: 'seqNext' });
$<HTMLButtonElement>('seqPause').onclick = () => act({ type: 'seqPauseToggle' });
$<HTMLButtonElement>('seqStop').onclick = () => act({ type: 'seqStop' });

// ─── Scoring by hand ────────────────────────────────────────────────
// Only while the scoreboard is on Manual (a score press on the Mac or a Stream Deck switches it): the scores, the
// clock and the quarter, through POST /api/scoreboard like Scoreboard control, which a phone allowed to score only
// may do too. Its rules (super shots worth 2, quarters or halves) come from the scoreboard, read once on Manual.
let rules: { superShots?: boolean } | null = null, scoreOk = true;
async function score(action: { type: string; [more: string]: unknown }) {
  showError('');
  try {
    const res = await fetch('/api/scoreboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) return showError(`This phone can't change the score yet. <a href="/pair.html?then=%2Fremote.html">Pair it with the Mac</a>.`);
    if (!res.ok) throw new Error(body.error || res.statusText);
    if (body.rules) rules = body.rules;
    readHealth();
  } catch (err) { showError(esc(err instanceof Error ? err.message : String(err))); }
}
function drawScoring() {
  const h = health, manual = !!(h && h.game && h.source === 'manual');
  $('scoreCard').hidden = !manual;
  if (!h || !manual) { rules = null; return; }
  if (!rules && scoreOk) { scoreOk = false; fetch('/api/scoreboard', { cache: 'no-store' }).then(r => r.json()).then(b => { rules = b.rules || {}; drawScoring(); }).catch(() => {}).finally(() => { scoreOk = true; }); }
  const s: Partial<NonNullable<Health['score']>> = h.score || {}, c = h.clock || {};
  $('homeName').textContent = s.homeName || ''; $('awayName').textContent = s.awayName || '';
  $('homePts').textContent = String(s.home ?? ''); $('awayPts').textContent = String(s.away ?? '');
  for (const b of document.querySelectorAll<HTMLElement>('#scoreCard .super')) b.hidden = !(rules && rules.superShots);
  $('clock').textContent = c.left != null ? mmss(c.left * 1000) : '';
  $('period').textContent = `${c.periodLabel || 'Q'}${c.period || ''}`;
  $<HTMLButtonElement>('clockToggle').textContent = c.running ? 'Stop clock' : 'Start clock';
  $<HTMLButtonElement>('nextPeriod').textContent = (c.periodLabel || 'Q') === 'H' ? 'Next half' : 'Next quarter';
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#scoreCard [data-delta]')) b.onclick = () => score({ type: 'score', side: b.dataset.side, delta: Number(b.dataset.delta) });
$<HTMLButtonElement>('clockToggle').onclick = () => score({ type: health && health.clock && health.clock.running ? 'clockStop' : 'clockStart' });
$<HTMLButtonElement>('nextPeriod').onclick = () => score({ type: 'period', value: 'next' });

async function readHealth() {
  try { health = await (await fetch('/api/health', { cache: 'no-store' })).json(); } catch { health = null; }
  drawStatus();
  drawScoring();
}
readHealth(); setInterval(readHealth, 2000);
// The scene as it changes (the Stream Deck plugin's feed), redrawn at once.
const events = new EventSource('/api/scene/events');
events.onmessage = e => { try { scene = JSON.parse(e.data); draw(); } catch { /* the next one */ } };

// What makes this file a module (its names its own), as the first line says.
export {};
