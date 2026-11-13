// FirstPass Studio - the Recordings page's script (recordings.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What Studio answers (recorder.ts, practice.ts, replay.ts).
interface RecGame { id: string; at: number; home: string; away: string; division?: string; round?: string; court?: string; followed?: boolean }
interface Recording { name: string; started: number; ended: number; size: number; recording?: boolean; competition?: string; games: RecGame[] }
interface Recordings {
  record: boolean; afterMinutes: number; leadMinutes: number; keepDays: number; recording?: string | null;
  waiting?: { game: string; from?: number; why?: string } | null; recordings: Recording[]; error?: string;
}
interface DemoSide {
  team: string; recordedTeam: string; missing?: boolean; choices: { name: string; position?: string }[];
  pairs: { id: string; position?: string; recorded: string; shown?: string }[];
}
interface Demo { recorded: { home: string; away: string }; athletes: number; sides: Record<string, DemoSide> }
interface Practice {
  active: boolean; saved?: { name: string; what: string }[]; jumps: { id: string; label: string; at: number }[]; position: number; paused?: boolean;
  demo?: Demo | null; game: { home: { name: string }; away: { name: string }; division?: string }; recordedOn: number; error?: string;
}
interface Deck { conn: string; model?: string; error?: string; status?: string; tc?: string }
interface Follow { kind?: string; address?: string; offset?: number; hyperdeck?: Deck; sdi?: Deck }
interface Replay {
  active: boolean; game?: { home: string; away: string } | null; paused?: boolean; position: number; follow?: Follow;
  events: { t: number; label: string }[]; error?: string;
}
type PracticeAsk = Record<string, unknown>;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
// The element with sel that a click or change was on, or in.
const hit = <T extends HTMLElement = HTMLElement>(e: Event, sel: string) => e.target instanceof Element ? e.target.closest<T>(sel) : null;
const errText = (err: unknown) => err instanceof Error ? err.message : String(err);
const when = (t: number) => new Date(t).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const time = (t: number) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
const mb = (n: number) => n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const length = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

function show(s: Recordings) {
  $<HTMLInputElement>('record').checked = s.record;
  if (document.activeElement !== $<HTMLInputElement>('after')) $<HTMLInputElement>('after').value = String(s.afterMinutes);
  $('leadMin').textContent = String(s.leadMinutes);
  const w = s.waiting;
  $('recordNote').textContent = s.recording ? `Recording now. Recordings older than ${s.keepDays} days are removed when Studio starts.`
    : !s.record ? 'Not recording. Turn it on to keep games for practice games and 4K replays.'
    : w && w.from ? `${w.game} starts recording at ${time(w.from)}${new Date(w.from).toDateString() === new Date().toDateString() ? '' : ` on ${new Date(w.from).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`}.`
    : w ? `Not recording ${w.game}: ${w.why}.`
    : 'Recording starts when a PlayHQ game is due on the scoreboard while Studio is on air.';
  $('nights').innerHTML = s.recordings.length ? s.recordings.map(r => `<div class="night">
      <div class="head"><h3>${esc(when(r.started))}</h3>${r.recording ? '<span class="live">Recording</span>' : ''}
        <span class="meta">${esc(length(r.ended - r.started))} · ${mb(r.size)}${r.competition ? ` · ${esc(r.competition)}` : ''}</span>
        <span class="acts"><a class="btn alt small" href="/api/recordings/${encodeURIComponent(r.name)}/file" download>Download</a>
          <button class="danger small" data-remove="${esc(r.name)}"${r.recording ? ' disabled title="Still being recorded: it can be removed once it stops, after the game"' : ''}>Remove</button></span></div>
      ${r.games.length ? `<ul>${r.games.map(g => `<li>${esc(time(g.at))}: ${esc(g.home)} v ${esc(g.away)}${g.division ? ` · ${esc(g.division)}` : ''}${g.round ? ` · ${esc(g.round)}` : ''}${g.court ? ` · ${esc(g.court)}` : ''}${g.followed ? ' · <span class="help" style="margin:0" title="Studio followed this game in the background: no graphics went to air for it, so it plays back as a practice game, to put graphics over a video of it">followed, not streamed</span>' : ''}<button class="alt small" data-practise="${esc(r.name)}" data-game="${esc(g.id)}" title="Play this game back as if it were live">Practise</button><button class="alt small" data-demo="${esc(r.name)}" data-game="${esc(g.id)}" data-what="${esc(`${g.home} v ${g.away}`)}" title="Play this game back as one of your competition's, with its teams and athletes">Demo</button>${g.followed ? '' : `<button class="alt small" data-replay="${esc(r.name)}" data-game="${esc(g.id)}" title="Play this game's graphics again exactly as they went to air, for a 4K recording">Replay</button>`}</li>`).join('')}</ul>` : '<p class="help">No game picked yet.</p>'}
    </div>`).join('') : '<p class="fp-empty">No recordings yet. The next PlayHQ game on air is recorded.</p>';
}

// The last thing that went wrong (studioStatus shows it); '' once something works.
let lastError = '';
const fail = (msg: string) => { lastError = msg; studioStatus(msg, 'error'); };
async function call(method: string, path: string, body?: object) {
  lastError = '';
  try {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const s: Recordings = await r.json();
    if (!r.ok && s.error) fail(s.error);
    if (s.recordings) show(s);
  } catch (err) { fail(`Could not reach Studio: ${errText(err)}`); }
}

// The practice game running, if any: what it is, where it can jump to, Pause and Stop.
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function showPractice(p: Practice) {
  showSaved(p.saved);
  $('practice').hidden = !p.active;
  if (!p.active) { showPairs(null); return; }
  const start = p.jumps.find(j => j.id === 'start')?.at || p.position;
  $('practice').querySelector<HTMLElement>('h2')!.textContent = p.demo ? 'Demo game' : 'Practice game';
  $('practiceWhat').innerHTML = `<b>${esc(p.game.home.name)} v ${esc(p.game.away.name)}</b>${p.game.division ? ` · ${esc(p.game.division)}` : ''}${p.demo ? ` (playing ${esc(p.demo.recorded.home)} v ${esc(p.demo.recorded.away)}, ${p.demo.athletes} athletes matched)` : ''}, recorded ${esc(when(p.recordedOn))}.
    ${p.paused ? 'Paused' : 'Playing'} at ${clock(p.position - start)} from Start.`;
  $('practiceJumps').innerHTML = 'Jump to ' + p.jumps.map(j => `<button class="alt small" data-jump="${esc(j.id)}">${esc(j.label)}</button>`).join('');
  $<HTMLButtonElement>('practicePause').textContent = p.paused ? 'Play' : 'Pause';
  $<HTMLButtonElement>('practicePause').dataset.paused = p.paused ? '1' : '';
  showPairs(p.demo);
}
// A demo game's pairing table: drawn again only when it changes, so a list being picked from stays open.
let pairsKey = '';
function showPairs(d: Demo | null | undefined) {
  $('pairs').hidden = !d;
  const key = d ? JSON.stringify(d.sides) : '';
  if (!d || key === pairsKey) return;
  pairsKey = key;
  $('pairsSides').innerHTML = ['home', 'away'].map(k => {
    const s = d.sides[k];
    return `<table><tr><th colspan="2">${esc(s.team)}</th></tr>${s.pairs.map(r => `<tr><td>${esc(r.position || '')} ${esc(r.recorded)}</td>
      <td><select data-pair="${esc(r.id)}"><option value="">Unnamed (goals to the team)</option>${s.choices.map(c =>
        `<option value="${esc(c.name)}"${c.name === r.shown ? ' selected' : ''}>${esc(c.name)}${c.position ? ` (${esc(c.position)})` : ''}</option>`).join('')}</select></td></tr>`).join('')}
      ${s.missing ? `<tr><td colspan="2" class="help">${esc(s.recordedTeam)} has no line up in the recording, so ${esc(s.team)} play with their own line up and their goals go to the team.</td></tr>` : ''}</table>`;
  }).join('');
}
$('pairsSides').onchange = e => { const s = hit<HTMLSelectElement>(e, '[data-pair]'); if (s) practice({ pair: { id: s.dataset.pair, name: s.value } }); };
$<HTMLButtonElement>('saveDemo').onclick = async () => { await practice({ save: $<HTMLInputElement>('saveName').value }); if (!lastError) $<HTMLInputElement>('saveName').value = ''; };
// Saved demos: start one again, or remove it.
let savedKey = '';
function showSaved(list: { name: string; what: string }[] = []) {
  $('savedDemos').hidden = !list.length;
  const key = JSON.stringify(list);
  if (key === savedKey) return;
  savedKey = key;
  $('savedList').innerHTML = list.map(s => `<div class="saved"><b>${esc(s.name)}</b><span class="help" style="margin:0">${esc(s.what)}</span>
    <span class="acts" style="margin-left:auto;display:flex;gap:8px"><button data-run="${esc(s.name)}">Start demo</button><button class="danger" data-forget="${esc(s.name)}">Remove</button></span></div>`).join('');
}
$('savedList').onclick = async e => {
  const r = hit(e, '[data-run]');
  if (r) practice({ start: { saved: r.dataset.run, lead: lead(), rerun: rerun() } });
  const f = hit(e, '[data-forget]');
  if (f && await askConfirm(`Remove the saved demo ${f.dataset.forget}?`, '', { ok: 'Remove', danger: true })) practice({ forget: f.dataset.forget });
};
async function practice(body?: PracticeAsk) {
  if (body) lastError = '';
  try {
    const r = await fetch('/api/practice', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const p: Practice = await r.json();
    if (!r.ok && p.error) fail(p.error);
    showPractice(p);
  } catch (err) { fail(`Could not reach Studio: ${errText(err)}`); }
}
// Starts in: the minutes before the first centre pass a practice game starts from, remembered on this computer.
const lead = () => Math.max(0, Math.min(60, Math.round(Number($<HTMLInputElement>('lead').value) || 0)));
try { const saved = localStorage.getItem('practiceLead'); if (saved !== null) $<HTMLInputElement>('lead').value = saved; } catch { /* not kept */ }
$<HTMLInputElement>('lead').onchange = () => { $<HTMLInputElement>('lead').value = String(lead()); try { localStorage.setItem('practiceLead', String(lead())); } catch { /* not kept */ } };
// Run game-timed sequences again: on unless unticked, remembered on this computer. Chosen as a practice game starts.
const rerun = () => $<HTMLInputElement>('rerun').checked;
try { if (localStorage.getItem('practiceRerun') === 'off') $<HTMLInputElement>('rerun').checked = false; } catch { /* not kept */ }
$<HTMLInputElement>('rerun').onchange = () => { try { localStorage.setItem('practiceRerun', rerun() ? 'on' : 'off'); } catch { /* not kept */ } };
$('practiceJumps').onclick = e => { const b = hit(e, '[data-jump]'); if (b) practice({ jump: b.dataset.jump, lead: lead() }); };
$<HTMLButtonElement>('practicePause').onclick = () => practice({ pause: !$<HTMLButtonElement>('practicePause').dataset.paused });
$<HTMLButtonElement>('practiceStop').onclick = () => practice({ stop: true });
$('practice').addEventListener('click', e => { const b = hit(e, '[data-pnudge]'); if (b) practice({ nudge: Number(b.dataset.pnudge) }); });

// 4K replay: Play / Pause, the nudge, what went on air to jump to, and Stop.
const tod = (t: number) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + `.${String(Math.floor((t % 1000) / 100))}`;
let eventsKey = '';
function showReplay(r: Replay) {
  $('replay').hidden = !r.active;
  if (!r.active) { eventsKey = ''; return; }
  $('replayWhat').innerHTML = `${r.game ? `<b>${esc(r.game.home)} v ${esc(r.game.away)}</b>, ` : ''}${r.paused ? 'paused' : 'playing'} at <b>${esc(tod(r.position))}</b> in the game.`;
  $<HTMLButtonElement>('replayPlay').textContent = r.paused ? 'Play' : 'Pause';
  $<HTMLButtonElement>('replayPlay').dataset.paused = r.paused ? '1' : '';
  showFollow(r.follow || {});
  const key = JSON.stringify(r.events);
  if (key !== eventsKey) {
    eventsKey = key;
    $<HTMLSelectElement>('replayEvents').innerHTML = r.events.map(ev => `<option value="${ev.t}">${esc(tod(ev.t).replace(/\.\d$/, ''))} ${esc(ev.label)}</option>`).join('');
  }
}
async function replayCall(body?: PracticeAsk) {
  if (body) lastError = '';
  try {
    const r = await fetch('/api/replay', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const s: Replay = await r.json();
    if (!r.ok && s.error) fail(s.error);
    showReplay(s);
  } catch (err) { fail(`Could not reach Studio: ${errText(err)}`); }
}
// Follow: nothing, a HyperDeck's timecode (its address typed, as the ATEM's can be), or the SDI input's.
let followShown = '';
function showFollow(f: Follow) {
  const hd = f.kind === 'hyperdeck' || f.kind === 'sdi';
  // The choice and address only change here when they changed in Studio, so typing isn't overwritten.
  const key = `${f.kind}|${f.address}`;
  if (key !== followShown) { followShown = key; $<HTMLSelectElement>('followKind').value = f.kind || 'none'; $<HTMLInputElement>('followAddress').value = f.address || ''; }
  const picked = $<HTMLSelectElement>('followKind').value === 'hyperdeck';
  $<HTMLInputElement>('followAddress').hidden = $<HTMLButtonElement>('followSet').hidden = !picked;
  $<HTMLButtonElement>('replayPlay').disabled = hd;
  $<HTMLButtonElement>('replayPlay').title = hd ? "The player's play and stop drive the replay" : '';
  const h = f.kind === 'hyperdeck' ? f.hyperdeck : f.kind === 'sdi' ? f.sdi : undefined;
  const who = f.kind === 'sdi' ? 'the SDI input' : 'the HyperDeck';
  const offset = Math.round((f.offset || 0) / 100) / 10;
  $('followStatus').textContent = !hd || !h ? ''
    : h.conn === 'connected' ? `${h.model || (f.kind === 'sdi' ? 'SDI input' : 'HyperDeck')}: ${h.error ? h.error : `${h.status === 'play' ? 'playing' : h.status || 'stopped'} at ${h.tc || '--:--:--:--'}`}${offset ? `, graphics ${offset > 0 ? '+' : ''}${offset} s` : ''}`
    : h.conn === 'error' ? `Can't read ${who}: ${h.error}`
    : h.conn === 'lost' ? `Nothing from ${who}${h.error ? ` (${h.error})` : ''}. Trying again.`
    : `Connecting to ${who}${h.error ? ` (${h.error})` : ''}…`;
}
$<HTMLSelectElement>('followKind').onchange = () => {
  const hd = $<HTMLSelectElement>('followKind').value === 'hyperdeck';
  $<HTMLInputElement>('followAddress').hidden = $<HTMLButtonElement>('followSet').hidden = !hd;
  if (!hd) replayCall({ follow: { kind: $<HTMLSelectElement>('followKind').value } });
  else if ($<HTMLInputElement>('followAddress').value.trim()) replayCall({ follow: { kind: 'hyperdeck', address: $<HTMLInputElement>('followAddress').value } });
  else $<HTMLInputElement>('followAddress').focus();
};
$<HTMLButtonElement>('followSet').onclick = () => replayCall({ follow: { kind: 'hyperdeck', address: $<HTMLInputElement>('followAddress').value } });
$<HTMLInputElement>('followAddress').onkeydown = e => { if (e.key === 'Enter') $<HTMLButtonElement>('followSet').click(); };
$<HTMLButtonElement>('replayPlay').onclick = () => replayCall({ pause: !$<HTMLButtonElement>('replayPlay').dataset.paused });
$('replay').onclick = e => { const b = hit(e, '[data-nudge]'); if (b) replayCall({ nudge: Number(b.dataset.nudge) }); };
$<HTMLButtonElement>('replayJump').onclick = () => { if ($<HTMLSelectElement>('replayEvents').value) replayCall({ seek: Number($<HTMLSelectElement>('replayEvents').value) }); };
$<HTMLButtonElement>('replayStop').onclick = () => replayCall({ stop: true });

// Demo game: the recorded game picked with Demo, shown as a finished game of the competition in use.
let demoOf: { recording: string; game: string } | null = null;
const options = (list: [string, string][], first: string) => `<option value="">${first}</option>` + list.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
interface DemoChoices { competition?: string; divisions: { id: string; name: string }[]; games: { id: string; round?: string; home: string; away: string; score: (number | null)[] }[]; error?: string }
async function demoChoices(division: string): Promise<DemoChoices> {
  const r = await fetch(`/api/practice/games${division ? `?division=${encodeURIComponent(division)}` : ''}`);
  const c = await r.json();
  if (!r.ok) fail(c.error || 'Couldn\'t read your competition\'s games.');
  return c;
}
async function openDemo(recording: string, game: string, what: string) {
  demoOf = { recording, game };
  $('demo').hidden = false;
  $('demoRecorded').textContent = what;
  $<HTMLSelectElement>('demoGame').innerHTML = options([], 'Game…'); $<HTMLSelectElement>('demoGame').disabled = true; $<HTMLButtonElement>('demoStart').disabled = true;
  const c = await demoChoices('');
  if (c.competition) $('demoCompetition').textContent = c.competition;
  $<HTMLSelectElement>('demoDivision').innerHTML = options(c.divisions.map((d): [string, string] => [d.id, d.name]), 'Division…');
  $('demo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$<HTMLSelectElement>('demoDivision').onchange = async () => {
  $<HTMLSelectElement>('demoGame').disabled = true; $<HTMLButtonElement>('demoStart').disabled = true;
  if (!$<HTMLSelectElement>('demoDivision').value) return;
  const c = await demoChoices($<HTMLSelectElement>('demoDivision').value);
  $<HTMLSelectElement>('demoGame').innerHTML = options(c.games.map((g): [string, string] => [g.id, `${g.round ? g.round + ': ' : ''}${g.home} v ${g.away}${g.score[0] != null ? ` (${g.score[0]}–${g.score[1]})` : ''}`]), c.games.length ? 'Game…' : 'No finished games yet');
  $<HTMLSelectElement>('demoGame').disabled = !c.games.length;
};
$<HTMLSelectElement>('demoGame').onchange = () => { $<HTMLButtonElement>('demoStart').disabled = !$<HTMLSelectElement>('demoGame').value; };
$<HTMLButtonElement>('demoCancel').onclick = () => { $('demo').hidden = true; demoOf = null; };
$<HTMLButtonElement>('demoStart').onclick = async () => {
  if (!demoOf) return;
  $<HTMLButtonElement>('demoStart').disabled = true;
  $<HTMLButtonElement>('demoStart').textContent = 'Starting…';
  await practice({ start: { recording: demoOf.recording, game: demoOf.game, lead: lead(), rerun: rerun(),
    demo: { game: $<HTMLSelectElement>('demoGame').value, division: $<HTMLSelectElement>('demoDivision').value, swap: $<HTMLInputElement>('demoSwap').checked } } });
  $<HTMLButtonElement>('demoStart').textContent = 'Start demo';
  $<HTMLButtonElement>('demoStart').disabled = false;
  if (!lastError) { $('demo').hidden = true; demoOf = null; }
};

$<HTMLInputElement>('record').onchange = () => call('POST', '/api/recordings', { record: $<HTMLInputElement>('record').checked }).then(() => { if (!lastError) studioStatus('Saved'); });
$<HTMLInputElement>('after').onchange = () => call('POST', '/api/recordings', { afterMinutes: Number($<HTMLInputElement>('after').value) }).then(() => { if (!lastError) studioStatus('Saved'); });
$('nights').onclick = async e => {
  const rp = hit(e, '[data-replay]');
  if (rp) { replayCall({ start: { recording: rp.dataset.replay, game: rp.dataset.game } }); return; }
  const d = hit(e, '[data-demo]');
  if (d) { openDemo(d.dataset.demo || '', d.dataset.game || '', d.dataset.what || ''); return; }
  const p = hit(e, '[data-practise]');
  if (p) { practice({ start: { recording: p.dataset.practise, game: p.dataset.game, lead: lead(), rerun: rerun() } }); return; }
  const b = hit(e, '[data-remove]');
  if (b && await askConfirm(`Remove the recording of ${b.closest('.night')?.querySelector('h3')?.textContent}?`, "This can't be undone.", { ok: 'Remove', danger: true })) call('DELETE', `/api/recordings/${encodeURIComponent(b.dataset.remove || '')}`);
};
call('GET', '/api/recordings');
practice();
replayCall();
setInterval(() => { if (!document.hidden) call('GET', '/api/recordings'); }, 15000);
setInterval(() => { if (!document.hidden) practice(); }, 2000);
setInterval(() => { if (!document.hidden) replayCall(); }, 500); // the replay's position, to the tenth of a second

// What makes this file a module (its names its own), as the first line says.
export {};
