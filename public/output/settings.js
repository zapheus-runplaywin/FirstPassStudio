// FirstPass Studio - the Output page, part 8 of 12: Source settings: the selected source's name, address and page options, placing and fades.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Settings for the selected source ─────────────────────────────────
const FIELDS = { fName: 'name', fUrl: 'url', fFile: 'file', fWidth: 'width', fHeight: 'height', fFade: 'fadeMs', fX: 'x', fY: 'y', fScale: 'scale' };
function renderForm(force) {
  const s = current();
  $('noSel').classList.toggle('hidden', !!s);
  $('selForm').classList.toggle('hidden', !s);
  if (!s) return;
  for (const el of document.querySelectorAll('.forBrowser')) el.classList.toggle('hidden', s.type !== 'browser');
  for (const el of document.querySelectorAll('.forMedia')) el.classList.toggle('hidden', s.type === 'browser');
  for (const el of document.querySelectorAll('.forVideo')) el.classList.toggle('hidden', s.type !== 'video');
  $('fFileLabel').textContent = s.type === 'video' ? 'Video' : 'Image';
  if (s.type !== 'browser') fillMedia($('fFile'), s.file, s.type);
  if (s.type === 'video') {
    $('fRestartOnShow').checked = s.restartOnShow; $('fLoop').checked = s.loop; $('fHideWhenDone').checked = s.hideWhenDone;
    $('fHideWhenDone').disabled = s.loop; $('fSound').checked = s.sound;
    if (force || document.activeElement !== $('fVolume')) $('fVolume').value = s.volume;
    $('fVolumeText').textContent = s.volume + '%';
  }
  // Don't overwrite a box someone is typing in (a Stream Deck press re-sends the scene).
  for (const [id, key] of Object.entries(FIELDS)) {
    if (s[key] === undefined) continue;
    if (force || document.activeElement !== $(id)) $(id).value = s[key];
  }
  $('fReload').checked = !!s.reloadOnShow;
  renderOptions(s, force);
  const i = scene.sources.indexOf(s);
  $('fUp').disabled = i === 0;
  $('fDown').disabled = i === scene.sources.length - 1;
  const name = encodeURIComponent(slug(s.name));
  $('links').innerHTML = '';
  for (const verb of ['toggle', 'on', 'off', ...(s.type === 'image' ? [] : ['restart']), ...(s.type === 'video' ? ['sound/toggle', 'sound/on', 'sound/off'] : [])]) {
    const row = document.createElement('div');
    row.innerHTML = '<code></code><button class="alt">Copy</button>';
    const link = `${base}/deck/layer/${name}/${verb}`;
    row.querySelector('code').textContent = link;
    row.querySelector('button').onclick = () => copy(link, row.querySelector('button'));
    $('links').appendChild(row);
  }
  // With more than one output: each other output's on and off links for this source.
  for (const o of extraOutputs()) {
    for (const verb of ['toggle', 'on', 'off']) {
      const row = document.createElement('div');
      row.innerHTML = '<code></code><button class="alt">Copy</button>';
      const link = `${base}/deck/output/${encodeURIComponent(o.link)}/layer/${name}/${verb}`;
      row.querySelector('code').textContent = link;
      row.querySelector('code').style.borderLeft = `4px solid ${o.colour}`;
      row.querySelector('button').onclick = () => copy(link, row.querySelector('button'));
      $('links').appendChild(row);
    }
  }
}
// A Studio page's options (pageoptions.js) as fields, kept in the source's address. Options it
// doesn't know, and anything typed into the address by hand, stay as they are.
function renderOptions(s, force) {
  const [path, query = ''] = s.type === 'browser' ? String(s.url).split('?') : [''];
  const options = !/^https?:/i.test(path) && PAGE_OPTIONS[path.replace(/^\/+/, '')];
  $('fOptionsBox').classList.toggle('hidden', !options);
  if (!options) return;
  const box = $('fOptions');
  if (!force && box.contains(document.activeElement) && box.dataset.url === s.url) return;
  box.dataset.url = s.url;
  box.innerHTML = '';
  const params = new URLSearchParams(query);
  for (const o of options) {
    const label = document.createElement('label');
    label.textContent = o.label;
    label.htmlFor = 'opt-' + o.key;
    const value = params.get(o.key) ?? '';
    let input;
    if (o.type === 'select') {
      input = document.createElement('select');
      for (const [v, text] of o.choices) input.add(new Option(text, v));
      if (o.list === 'audio') {
        input.dataset.list = 'audio';
        for (const f of tracks()) if (!o.choices.some(([v]) => v === f)) input.add(new Option(songName(f), f));
      }
      if (![...input.options].some(opt => opt.value === value)) input.add(new Option(value, value));
    } else {
      input = document.createElement('input');
      input.type = o.type === 'number' ? 'number' : 'text';
      for (const k of ['min', 'max', 'step', 'placeholder']) if (o[k] !== undefined) input[k] = o[k];
      if (o.list === 'athletes') input.setAttribute('list', 'list-athletes');
    }
    input.id = 'opt-' + o.key;
    input.value = value;
    input.onchange = () => {
      const q = new URLSearchParams(String(current().url).split('?')[1] || '');
      if (input.value.trim() === '') q.delete(o.key); else q.set(o.key, input.value.trim());
      const qs = q.toString();
      change({ url: path + (qs ? '?' + qs : '') });
    };
    const cell = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(input);
    if (o.type !== 'select') input.style.flex = '1';
    // A song or sound added here goes into the media folder (as is, no loudness change) and is picked at once.
    if (o.list === 'audio') {
      const add = document.createElement('label');
      add.className = 'inline';
      add.style.fontWeight = '400';
      add.innerHTML = 'Add a sound <input type="file" accept=".mp3,.m4a,.aac,.wav,.aif,.aiff,audio/*">';
      const file = add.querySelector('input');
      file.id = 'opt-' + o.key + '-add';
      file.onchange = async () => {
        const f = file.files[0];
        if (!f) return;
        const note = cell.querySelector('.addNote') || cell.appendChild(Object.assign(document.createElement('p'), { className: 'note addNote' }));
        note.textContent = `Adding ${f.name}…`;
        try {
          const res = await fetch(`/api/scene/media?name=${encodeURIComponent(f.name)}&level=0`, { method: 'POST', body: f });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || res.statusText);
          await loadMedia();
          input.add(new Option(songName(body.file), body.file));
          input.value = body.file;
          note.remove();
          input.onchange();
        } catch (err) { note.textContent = `Could not add ${f.name}: ${err.message}`; }
      };
      row.appendChild(add);
    }
    if (o.unit) { const u = document.createElement('span'); u.className = 'unit'; u.textContent = o.unit; row.appendChild(u); }
    cell.appendChild(row);
    // While the chroma output is chroma key safe, say what this option does then (its setting is kept for the other outputs).
    if (o.chroma && out && (out.outputs || [out]).some(x => x.chromaSafeNow)) {
      const note = document.createElement('p');
      note.className = 'note chromaNote';
      note.textContent = `Chroma key safe: ${o.chroma}`;
      cell.appendChild(note);
    }
    if (o.picks) {
      const picks = document.createElement('div');
      picks.className = 'row picks';
      for (const [v, text] of o.picks) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'alt'; b.textContent = text; b.title = v ? `Use ${v}` : 'None';
        b.onclick = () => { input.value = v; input.onchange(); };
        picks.appendChild(b);
      }
      cell.appendChild(picks);
    }
    if (o.gameOnly) {
      const tick = document.createElement('label');
      tick.className = 'row';
      tick.style.cssText = 'gap: 6px; margin-top: 4px; font-weight: normal';
      tick.innerHTML = '<input type="checkbox" id="opt-gameOnly"> Only athletes in the picked game';
      tick.querySelector('input').checked = gameOnly();
      tick.querySelector('input').onchange = e => { try { localStorage.setItem('studio-lowerthird-game', e.target.checked ? '1' : ''); } catch { /* none */ } fillAthletes(); };
      cell.appendChild(tick);
    }
    if (o.help) { const n = document.createElement('p'); n.className = 'note'; n.style.margin = '2px 0 0'; n.textContent = o.help; cell.appendChild(n); }
    if (o.lengthCheck) { const n = document.createElement('p'); n.className = 'note'; n.id = 'optLengthCheck'; n.style.margin = '4px 0 0'; cell.appendChild(n); }
    box.append(label, cell);
  }
  if (options.some(o => o.list === 'athletes' || o.list === 'teams')) loadAthletes();
  if (options.some(o => o.lengthCheck)) checkThemeLength(params);
}
// The intro and outro's theme against the animation (introtiming.js), checked again whenever its options change (a new
// style, theme, timing, hold or division): a warning when the two are more than 25% apart, as the theme can line up
// with only one end of the animation and stretching it goes only 25% either way.
const teamCounts = new Map(); // type|division -> { n, at }
let lengthParams = null;
async function checkThemeLength(params = lengthParams) {
  lengthParams = params;
  const note = $('optLengthCheck');
  if (!note || !params) return;
  const theme = params.get('theme') || '', fit = params.get('themefit') || 'start';
  if (!theme) { note.textContent = ''; return; }
  const sec = durationOf(theme);
  if (!sec) { note.textContent = 'Reading the theme\'s length…'; return; }
  const key = `${params.get('type') || ''}|${params.get('division') || ''}`;
  let n = teamCounts.get(key);
  if (!n || Date.now() - n.at > 60000) {
    try {
      const q = new URLSearchParams({ type: params.get('type') || 'intro' });
      if (params.get('division')) q.set('division', params.get('division'));
      const d = await (await fetch('/api/introoutro?' + q, { cache: 'no-store' })).json();
      n = { n: (d.teams || []).length, at: Date.now() };
      teamCounts.set(key, n);
    } catch { n = { n: 8, at: 0 }; }
    if (params !== lengthParams) return; // changed again while asking
  }
  const hold = Number.isFinite(parseFloat(params.get('hold'))) ? parseFloat(params.get('hold')) : 5, outOn = params.get('out') !== '0';
  const speed = parseFloat(params.get('speed')) > 0 ? parseFloat(params.get('speed')) : 0;
  const style = (params.get('style') || 'orbit').toLowerCase(), STYLES = ['orbit', 'parade', 'tiles', 'spotlight', 'court', 'blueprint'];
  const s1 = x => x.toFixed(1) + ' s';
  const say = (warn, text) => { note.textContent = (warn ? '⚠️ ' : '') + text; note.style.color = warn ? '#b45309' : ''; note.style.fontWeight = warn ? '700' : ''; };
  const runs = st => introLength(st, n.n, hold, outOn) / (speed || 1);
  if (!STYLES.includes(style)) {
    const lens = STYLES.map(runs), lo = Math.min(...lens), hi = Math.max(...lens);
    const off = lens.some(l => Math.abs(sec - l) / l > .25);
    return say(off, `The theme is ${s1(sec)}. A different style each time runs ${s1(lo)} to ${s1(hi)}${off ? ', so some styles are more than 25% longer or shorter than the theme.' : '.'}`);
  }
  const len = runs(style), apart = Math.abs(sec - len) / len;
  const head = `The theme is ${s1(sec)} and this animation ${s1(len)} with ${n.n} team${n.n === 1 ? '' : 's'}.`;
  const k = len / sec, fits = k >= .75 && k <= 1.25;
  if (fit === 'stretch' && !speed) {
    const rate = Math.max(.75, Math.min(1.25, k));
    if (fits) return say(false, `${head} It plays at ${rate.toFixed(2)}× to last as long as the theme.`);
    return say(true, `${head} That's more than 25% apart and stretching goes only 25%, so it plays at ${rate.toFixed(2)}× and ${sec > len / rate ? `the theme runs ${s1(sec - len / rate)} past the end` : `the theme ends ${s1(len / rate - sec)} early`}.`);
  }
  if (apart <= .25) return say(false, `${head} They line up${fit === 'logo' ? ' with the theme ending on the logo' : fit === 'end' ? ' at the end' : ' from the start'}.`);
  const ct = introTiming(style, n.n).ct / (speed || 1);
  const what = fit === 'logo' ? (sec > ct ? `the theme is longer than the ${s1(ct)} before the logo lands, so its first ${s1(sec - ct)} are skipped` : `the theme starts ${s1(ct - sec)} in and ends as the logo lands`)
    : fit === 'end' ? (sec > len ? `its first ${s1(sec - len)} are skipped` : `the theme starts ${s1(len - sec)} in`)
    : sec > len ? `the theme runs ${s1(sec - len)} past the end and is cut off` : `the theme ends ${s1(len - sec)} before the animation`;
  say(true, `${head} They're more than 25% apart: ${what}.${fit === 'stretch' ? ' Speed is set, so it doesn\'t stretch.' : fits ? ' Stretch would fit them.' : ''}`);
}
// The person lower third's suggestions (list: 'athletes' and list: 'teams' in pageoptions.js): the active
// competition's athletes, read again each time its options are shown so a competition switched on the
// setup page shows its own. The team picked and the "picked game" tick box narrow the names.
let lowerThird = null;
const gameOnly = () => { try { return localStorage.getItem('studio-lowerthird-game') === '1'; } catch { return false; } };
const sameName = (a, b) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '') === String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function fillAthletes() {
  const dl = $('list-athletes') || document.body.appendChild(Object.assign(document.createElement('datalist'), { id: 'list-athletes' }));
  dl.replaceChildren();
  if (!lowerThird) return;
  const team = $('opt-team') ? $('opt-team').value : '';
  const g = lowerThird.game;
  const inGame = t => g.teams.some(n => sameName(n, t.team)) && (!g.division || t.division === g.division);
  let list = lowerThird.athletes;
  if (team) list = list.filter(a => a.teams.some(t => sameName(t.team, team)));
  if ($('opt-gameOnly') && $('opt-gameOnly').checked) {
    list = list.filter(a => a.teams.some(inGame));
    if (!g.teams.length) console.warn('Lower third: no game picked on the control page, so no athletes are in it');
  }
  for (const a of list) dl.appendChild(new Option([...new Set(a.teams.map(t => t.team))].join(', '), a.name));
}
async function loadAthletes() {
  try {
    lowerThird = await (await fetch('/api/lowerthird/athletes', { cache: 'no-store' })).json();
  } catch (err) { console.warn('Athlete suggestions unavailable:', err.message); lowerThird = null; }
  const sel = $('opt-team');
  if (sel && lowerThird) {
    const keep = sel.value;
    for (const name of [...new Set(lowerThird.teams.map(t => t.team))]) if (![...sel.options].some(o => o.value === name)) sel.add(new Option(name, name));
    sel.value = keep;
    sel.addEventListener('change', fillAthletes);
  }
  fillAthletes();
}
function change(changes) { const s = current(); if (s) act({ type: 'update', id: s.id, changes }); }
for (const [id, key] of Object.entries(FIELDS)) {
  $(id).addEventListener('change', () => change({ [key]: ['name', 'url', 'file'].includes(key) ? $(id).value : Number($(id).value) }));
}
$('fReload').onchange = () => change({ reloadOnShow: $('fReload').checked });
$('fRestartOnShow').onchange = () => change({ restartOnShow: $('fRestartOnShow').checked });
$('fLoop').onchange = () => change({ loop: $('fLoop').checked });
$('fHideWhenDone').onchange = () => change({ hideWhenDone: $('fHideWhenDone').checked });
$('fSound').onchange = () => change({ sound: $('fSound').checked });
$('fVolume').oninput = () => { $('fVolumeText').textContent = $('fVolume').value + '%'; };
$('fVolume').onchange = () => change({ volume: Number($('fVolume').value) });
$('fRestartVideo').onclick = () => act({ type: 'restart', id: selected });
$('fFull').onclick = () => {
  const s = current(); if (!s) return;
  const [w, h] = s.type === 'browser' ? [s.width, s.height] : (naturalSize.get(s.file) || [1920, 1080]);
  change({ x: 0, y: 0, scale: Math.round(Math.min(1920 / w, 1080 / h) * 10000) / 100 });
};
$('fUp').onclick = () => act({ type: 'move', id: selected, direction: 'up' });
$('fDown').onclick = () => act({ type: 'move', id: selected, direction: 'down' });
$('fRestart').onclick = () => act({ type: 'restart', id: selected });
// Preview opens the selected source on its own: a page at its address, an image or video from the media folder.
function previewSource(s) {
  const to = s.type === 'browser' ? (/^https?:\/\//i.test(s.url) ? s.url : '/' + String(s.url).replace(/^\/+/, '')) : '/media/' + encodeURIComponent(s.file);
  console.log(`Preview "${s.name}": ${to}`);
  // Half size (the page is still laid out at 1080p and scaled), so a few fit on one screen.
  window.open(`/pvw.html?src=${encodeURIComponent(to)}&name=${encodeURIComponent(s.name)}`, '_blank', 'popup,width=960,height=540');
}
$('fPreview').onclick = () => { const s = current(); if (s) previewSource(s); };
$('fRemove').onclick = () => {
  const s = current();
  if (s && confirm(`Remove "${s.name}" from the scene? Its Stream Deck links will stop working.`)) act({ type: 'remove', id: s.id }).then(() => { selected = null; renderForm(); drawBox(); });
};
// Hide all: every source off on the outputs the Sources list shows (all of them, or the one picked in Show).
$('hideAll').onclick = async () => {
  const outs = out && out.outputs && out.outputs.length > 1 ? out.outputs.filter(o => outFilter === 'all' || o.id === outFilter) : [{ primary: true }];
  for (const o of outs) await act({ type: 'hideAll', ...(o.primary ? {} : { output: o.id }) });
};
// The video output state (`out`), the Scene View's sound and listen() are in preview.js, which runs first.
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let viewWas = '';
const showOut = o => {
  const relisten = !out || out.previewSound !== o.previewSound;
  const hadExtras = extraOutputs().map(x => `${x.id}:${x.name}:${x.colour}`).join();
  out = o;
  if (!o.outputs) o.outputs = [{ ...o, id: 'main', slot: 1, name: 'Output 1', primary: true, colour: '#ea9a38', link: 'output-1' }];
  // The output being set up here (and shown in the Scene View): picked on its card or tab.
  const so = o.outputs.find(x => x.id === outSel) || o.outputs[0];
  outSel = so.id;
  renderOutputs(o, so);
  renderPerf(o, so);
  if (hadExtras !== extraOutputs().map(x => `${x.id}:${x.name}:${x.colour}`).join()) { renderList(); renderForm(); renderTabs(); }
  if (relisten) { listen(); if (popped) popChannel.postMessage('ask'); }
  $('outNoApp').classList.toggle('hidden', o.app);
  $('outForm').classList.toggle('hidden', !o.app);
  $('outOn').classList.toggle('hidden', !o.app);
  const extra = o.displays.filter(d => !d.primary);
  for (const r of document.querySelectorAll('input[name=outMode]')) { r.checked = r.value === so.mode; r.disabled = false; }
  // Fill and key needs two displays besides the Mac's own (an M1 MacBook Pro drives only one).
  $('outFillKey').disabled = extra.length < 2 && so.mode !== 'fillkey';
  const fillSel = (id, value, fallback) => {
    const sel = $(id);
    sel.innerHTML = '<option value="">Choose a display</option>' + o.displays.map(d => `<option value="${d.id}">${d.label} (${d.width} × ${d.height})${d.primary ? ', this Mac\'s main screen' : ''}</option>`).join('');
    sel.value = o.displays.some(d => d.id === value) ? value : '';
    if (!sel.value && fallback) sel.value = fallback.id;
  };
  fillSel('outChromaDisplay', so.chromaDisplay, extra[0]);
  fillSel('outFillDisplay', so.fillDisplay, extra[0]);
  fillSel('outKeyDisplay', so.keyDisplay, extra[1]);
  // A display that isn't drawn at exactly 1920 x 1080 (a 720p signal, or a scaled or HiDPI setting) makes
  // the scene softer than it is: say which, and how to fix it.
  const picked = so.mode === 'chroma' ? [so.chromaDisplay] : so.mode === 'fillkey' ? [so.fillDisplay, so.keyDisplay] : [];
  const off = o.displays.filter(d => picked.includes(d.id) && (d.width !== 1920 || d.height !== 1080 || (d.scale || 1) !== 1));
  $('outDisplaySize').innerHTML = off.map(d => `<b>${esc(d.label)}</b> is set to ${d.width} × ${d.height}${(d.scale || 1) !== 1 ? ` (HiDPI, ${d.scale}x)` : ''}, not 1920 × 1080, so the scene is scaled and looks softer. `
    + 'In System Settings, Displays, pick it, turn on Show all resolutions and choose 1920 × 1080 (not the HiDPI one).').join('<br>');
  $('outDisplaySize').classList.toggle('hidden', !off.length);
  // Blackmagic devices, and the 1080p formats each can send (interlaced and 720p look soft, so they aren't offered).
  const dl = o.decklink || {};
  const devices = dl.ok ? dl.devices : [];
  $('outDecklink').disabled = !devices.length && so.mode !== 'decklink';
  $('outDlNote').textContent = dl.ok ? (devices.length ? '' : '(no device connected)') : dl.error ? (/Desktop Video/.test(dl.error) ? '(needs Blackmagic Desktop Video)' : '(not available)') : '';
  $('outDlDevice').innerHTML = devices.length ? devices.map(d => `<option value="${d.id}">${d.name}${d.externalKeying ? '' : ' (no fill and key)'}</option>`).join('') : '<option value="">No device connected</option>';
  const device = devices.find(d => d.id === so.decklinkDevice) || devices[0];
  $('outDlDevice').value = device ? device.id : '';
  const modes = device ? device.modes.filter(m => m.supported && m.height === 1080 && !m.interlaced) : [];
  $('outDlMode').innerHTML = modes.map(m => `<option value="${m.mode}">${m.name}${so.decklinkKeying === 'external' && !m.keying ? ' (no fill and key)' : ''}</option>`).join('');
  const pickedMode = modes.find(m => m.mode === so.decklinkMode) || defaultMode(modes);
  $('outDlMode').value = String((pickedMode || {}).mode || '');
  $('outDlKeying').value = so.decklinkKeying;
  $('outDlStraight').checked = so.decklinkStraight;
  // NDI: whether the NDI runtime is installed, and the formats it can send.
  const nd = o.ndi || {};
  $('outNdi').disabled = !nd.ok && so.mode !== 'ndi';
  $('outNdiNote').textContent = nd.ok ? '' : nd.error ? (/runtime isn't installed/.test(nd.error) ? '(needs the NDI runtime)' : '(not available)') : '';
  // What to install for an option that can't be picked yet, with where to get it.
  const needs = [];
  if (!dl.ok && dl.error) needs.push(/Desktop Video/.test(dl.error)
    ? '<b>Blackmagic:</b> install Blackmagic Desktop Video (free) from <a href="https://www.blackmagicdesign.com/support/family/capture-and-playback" target="_blank" rel="noopener">blackmagicdesign.com/support</a> (under Capture and Playback), then quit and reopen Studio.'
    : `<b>Blackmagic:</b> ${esc(dl.error)}`);
  if (!nd.ok && nd.error) needs.push(/runtime isn't installed/.test(nd.error)
    ? '<b>NDI:</b> install NDI\'s runtime for Mac (free, the libNDI installer) from <a href="https://ndi.link/NDIRedistV6Apple" target="_blank" rel="noopener">ndi.link/NDIRedistV6Apple</a>. NDI Tools on its own isn\'t always enough. Studio finds it as soon as it\'s installed.'
    : `<b>NDI:</b> ${esc(nd.error)}`);
  $('outNeeds').innerHTML = needs.join('<br>');
  $('outNeeds').classList.toggle('hidden', !needs.length);
  $('outNdiSignal').value = so.ndiSignal;
  if ($('outNdiFormat').options.length !== o.ndiFormats.length) $('outNdiFormat').innerHTML = o.ndiFormats.map(f => `<option value="${f.id}">${f.id}</option>`).join('');
  $('outNdiFormat').value = so.ndiFormat;
  if (document.activeElement !== $('outNdiName')) $('outNdiName').value = so.ndiName;
  $('outColor').value = so.chromaColor;
  $('outChromaSafe').checked = so.chromaSafe;
  $('outChromaWarn').classList.toggle('hidden', !so.chromaSafeNow);
  // The competition's colours a key on this colour would cut into (logos can't be checked).
  $('outNearKey').innerHTML = (so.nearKey || []).length ? `<b>Close to the key colour:</b> ${so.nearKey.map(c => `${esc(c.name)} (${esc(c.hex)})`).join(', ')}. `
    + 'A keyer may cut holes in these: try the other key colour, or change them in the Competitions setup. Check the logos too.' : '';
  $('outNearKey').classList.toggle('hidden', !(so.nearKey || []).length);
  $('fFadeChroma').classList.toggle('hidden', !so.chromaSafeNow);
  // Chroma key safe changed, or another output picked: the Live View shows that output as it goes out, and the
  // source's options say what chroma key safe does to them.
  if (chromaWas !== so.chromaSafeNow || previewOutput !== so.id) {
    chromaWas = so.chromaSafeNow;
    previewOutput = so.id;
    showPreview();
    const s = current();
    if (s) renderOptions(s, true);
  }
  // The Scenes and Sequences sections follow the picked output, and the outputs' names and colours.
  const view = [so.id, ...(out.outputs || []).map(o => `${o.id}:${o.name}:${o.colour}`)].join('|');
  if (view !== viewWas) { viewWas = view; if (sceneAll.scenes) show(sceneAll); }
  for (const el of document.querySelectorAll('.forNdi')) el.classList.toggle('hidden', so.mode !== 'ndi');
  for (const el of document.querySelectorAll('.forNdiChroma')) el.classList.toggle('hidden', so.mode !== 'chroma' && !(so.mode === 'ndi' && so.ndiSignal === 'chroma'));
  for (const el of document.querySelectorAll('.forChroma:not(.forNdiChroma)')) el.classList.toggle('hidden', so.mode !== 'chroma');
  for (const el of document.querySelectorAll('.forFillKey')) el.classList.toggle('hidden', so.mode !== 'fillkey');
  for (const el of document.querySelectorAll('.forDecklink')) el.classList.toggle('hidden', so.mode !== 'decklink');
  const sending = so.on && so.mode !== 'off';
  $('outOn').textContent = o.outputs.length > 1 ? `${so.name} ${sending ? 'on' : 'off'}` : sending ? 'Output on' : 'Output off';
  $('outOn').className = sending ? '' : 'alt';
  const name = id => (o.displays.find(d => d.id === id) || {}).label || 'a display';
  const st = so.decklinkStatus || {};
  const ns = so.ndiStatus || {};
  const watching = s => s.connections ? `${s.name} (${s.connections} receiving)` : `${s.name} (nothing receiving yet)`;
  $('outStatus').textContent = so.clash ? `${so.name} can't send: ${so.clash} is already using that ${so.mode === 'ndi' ? 'NDI source name' : so.mode === 'decklink' ? 'Blackmagic device' : 'display'}. Pick another, or change ${so.clash}.`
    : so.mode === 'off' ? 'Not sending the scene anywhere.'
    : !so.on ? 'Output is off: nothing is sent until it\'s turned on.'
    : so.mode === 'decklink' ? (st.error ? `Couldn't start the Blackmagic output: ${st.error}`
      : st.running ? `Sending to ${st.name} (${st.mode}${so.decklinkKeying === 'external' ? ', fill and key' : ', fill only'}).${st.late || st.dropped ? ` ${st.late} late and ${st.dropped} dropped frames so far.` : ''}`
      : so.showing.length ? 'Starting the Blackmagic output…' : dl.ok ? 'Pick the device and video format.' : dl.error || 'Looking for Blackmagic devices…')
    : so.mode === 'ndi' ? (ns.error ? `Couldn't start NDI: ${ns.error}`
      : ns.running && ns.sources?.length ? `Sending NDI at ${ns.format}: ${ns.sources.map(watching).join(', ')}.`
      : so.showing.length ? 'Starting NDI…' : nd.ok ? 'Pick the signal and video format.' : nd.error || 'Checking for NDI…')
    : so.showing.length ? 'Showing ' + so.showing.map(w => `${w.kind} on ${name(w.display)}`).join(' and ') + '.'
    : 'Pick the display to use.';
  $('outDeck').textContent = so.primary ? `${base}/deck/output/toggle` : `${base}/deck/output/${so.link}/toggle`;
  // Off has nothing to turn on; and while the output is on its setup is locked, so it's turned off before changing.
  const live = sending;
  $('outOn').disabled = so.mode === 'off';
  for (const el of document.querySelectorAll('#outForm .form input, #outForm .form select, #outForm .form button')) {
    if (live) el.disabled = true;
    else if (el.name !== 'outMode') el.disabled = false;
  }
  // Counts for sponsors changes nothing being sent, so it stays free while the output is on.
  $('outSponsors').disabled = false;
  $('outLocked').classList.toggle('hidden', !live);
};
// Changes the output being set up here (changes.output), or adds or removes one ({ add }, { remove }).
const setOut = async changes => {
  try {
    if (!changes.add && changes.remove === undefined && changes.output === undefined) changes = { output: outSel, ...changes };
    const r = await fetch('/api/outputs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changes) });
    const body = await r.json();
    if (!r.ok && body.error) $('err').textContent = body.error;
    showOut(body);
    setTimeout(loadOut, 1500); // the Blackmagic and NDI outputs report how they started a moment later
  } catch (err) { $('err').textContent = `Could not change the display output: ${err.message}`; }
};
// ?scan=1 has the app look for Blackmagic devices again (plugged in or out).
const loadOut = () => fetch('/api/outputs?scan=1').then(r => r.json()).then(showOut).catch(() => {});
// The format to start with (the same as outputs.js uses): 1080p50 if the device can key it (Australian
// switchers mostly run at 50), else the first 1080p format that can, else the first.
const defaultMode = modes => ['1080p50', '1080p25'].map(n => modes.find(m => m.keying && m.name.replace(/\s/g, '').includes(n))).find(Boolean)
  || modes.find(m => m.keying) || modes[0];
loadOut();
// Displays come and go (plugged in, the app starting up): check again now and then.
setInterval(() => { if (!document.hidden) loadOut(); }, 5000);
for (const r of document.querySelectorAll('input[name=outMode]')) r.addEventListener('change', () => {
  // Picked with the output off (it has to be): it stays off until Output on, so the setup can be checked first.
  const changes = { mode: r.value, on: false };
  // Fill in the displays shown as chosen, so picking a mode is enough.
  if (r.value === 'chroma') changes.chromaDisplay = $('outChromaDisplay').value;
  if (r.value === 'fillkey') { changes.fillDisplay = $('outFillDisplay').value; changes.keyDisplay = $('outKeyDisplay').value; }
  if (r.value === 'decklink') { changes.decklinkDevice = $('outDlDevice').value; changes.decklinkMode = Number($('outDlMode').value) || 0; }
  if (r.value === 'ndi') { changes.ndiSignal = $('outNdiSignal').value; changes.ndiFormat = $('outNdiFormat').value; }
  setOut(changes);
});
$('outChromaDisplay').onchange = () => setOut({ chromaDisplay: $('outChromaDisplay').value });
$('outFillDisplay').onchange = () => setOut({ fillDisplay: $('outFillDisplay').value });
$('outKeyDisplay').onchange = () => setOut({ keyDisplay: $('outKeyDisplay').value });
$('outColor').onchange = () => setOut({ chromaColor: $('outColor').value });
$('outChromaSafe').onchange = () => setOut({ chromaSafe: $('outChromaSafe').checked });
$('outSponsors').onchange = () => setOut({ sponsors: $('outSponsors').checked });
$('outDlDevice').onchange = () => setOut({ decklinkDevice: $('outDlDevice').value, decklinkMode: 0 }).then(() => setOut({ decklinkMode: Number($('outDlMode').value) || 0 }));
$('outDlMode').onchange = () => setOut({ decklinkMode: Number($('outDlMode').value) || 0 });
$('outDlKeying').onchange = () => setOut({ decklinkKeying: $('outDlKeying').value });
$('outDlStraight').onchange = () => setOut({ decklinkStraight: $('outDlStraight').checked });
$('outNdiSignal').onchange = () => setOut({ ndiSignal: $('outNdiSignal').value });
$('outNdiFormat').onchange = () => setOut({ ndiFormat: $('outNdiFormat').value });
$('outNdiName').onchange = () => setOut({ ndiName: $('outNdiName').value });
for (const b of document.querySelectorAll('[data-color]')) b.onclick = () => setOut({ chromaColor: b.dataset.color });
$('outOn').onclick = () => setOut({ on: !(selectedOutput() && selectedOutput().on) });
$('outName').onchange = () => setOut({ name: $('outName').value });
$('outAdd').onclick = async () => {
  const before = new Set((out?.outputs || []).map(o => o.id));
  await setOut({ add: true });
  const added = (out?.outputs || []).find(o => !before.has(o.id));
  if (added) pickOutput(added.id);
};
$('outRemove').onclick = () => {
  const so = selectedOutput();
  if (!so || so.primary) return;
  if (!confirm(`Remove ${so.name}? It stops sending, and its Stream Deck links stop working. The sources stay; only what was on for ${so.name} is forgotten.`)) return;
  setOut({ remove: so.id }).then(() => pickOutput('main'));
};

// ─── More than one output ─────────────────────────────────────────────
// The cards above the setup (one per output, with its colour, what it sends to and an on/off), shown once
// there's more than one. Picking a card picks that output here and in the Scene View.
function renderOutputs(o, so) {
  const many = o.outputs.length > 1;
  $('outAdd').classList.toggle('hidden', !o.app || o.outputs.length >= (o.max || 4));
  $('outList').classList.toggle('hidden', !many);
  for (const el of document.querySelectorAll('.forMulti')) el.classList.toggle('hidden', !many);
  $('outRemove').classList.toggle('hidden', so.primary);
  $('outExtraNote').classList.toggle('hidden', so.primary);
  for (const el of document.querySelectorAll('.forExtra')) el.classList.toggle('hidden', so.primary);
  $('outSponsors').checked = !!so.sponsors;
  if (document.activeElement !== $('outName')) $('outName').value = so.name;
  document.documentElement.style.setProperty('--oc', many ? so.colour : 'transparent');
  $('outSection').classList.toggle('picked', many);
  const list = $('outList');
  list.innerHTML = '';
  if (!many) return;
  for (const x of o.outputs) {
    const card = document.createElement('div');
    card.className = 'outCard' + (x.id === so.id ? ' sel' : '');
    card.style.setProperty('--c', x.colour);
    card.innerHTML = '<span class="dot"></span><span class="what"><b></b> <small></small></span><button></button>';
    card.querySelector('b').textContent = `${x.slot} · ${x.name}`;
    const small = card.querySelector('small');
    small.textContent = (x.clash ? `can't send (${x.clash} has it)` : outWhere(o, x)) + (x.primary ? ' · primary, with sound' : '');
    if (x.perf) {
      const p = document.createElement('span');
      p.textContent = ' · ' + perfText(x.perf);
      p.classList.toggle('slow', perfSlow(x.perf));
      small.appendChild(p);
    }
    const live = x.on && x.mode !== 'off';
    const b = card.querySelector('button');
    b.textContent = live ? 'On' : 'Off';
    b.className = live ? 'onBtn' : 'alt';
    b.disabled = x.mode === 'off';
    b.title = live ? `${x.name} is sending: click to turn it off` : `Turn ${x.name} on`;
    b.onclick = e => { e.stopPropagation(); setOut({ output: x.id, on: !x.on }); };
    card.onclick = () => pickOutput(x.id);
    list.appendChild(card);
  }
}
// How hard an output is working (the app checks every 5 seconds while it's on).
const perfText = p => `${p.cpu}% CPU, ${p.memMB} MB, ${p.fps} of ${p.target} fps`;
// Drawing well under its frame rate: the Mac isn't keeping up.
const perfSlow = p => p.target > 0 && p.fps < p.target * 0.9;
function renderPerf(o, so) {
  const el = $('outPerf');
  const t = o.perfTotal;
  el.classList.toggle('hidden', !so.perf && !t);
  if (!so.perf && !t) return;
  const mine = so.perf ? `${o.outputs.length > 1 ? so.name : 'This output'}: ${perfText(so.perf)}${perfSlow(so.perf) ? ', so the Mac isn\'t keeping up' : ''}.` : '';
  const all = t ? ` Studio in all: ${t.cpu}% CPU, ${t.memMB >= 1024 ? `${(t.memMB / 1024).toFixed(1)} GB` : `${t.memMB} MB`}, graphics processor ${t.gpu}%.` : '';
  el.textContent = (mine + all).trim();
  el.classList.toggle('slow', !!so.perf && perfSlow(so.perf));
}
// What an output sends to, in a few words.
function outWhere(o, x) {
  const disp = id => (o.displays.find(d => d.id === id) || {}).label || 'a display';
  return x.mode === 'off' ? 'not set up'
    : x.mode === 'chroma' ? `chroma on ${disp(x.chromaDisplay)}`
    : x.mode === 'fillkey' ? `fill and key on ${disp(x.fillDisplay)} and ${disp(x.keyDisplay)}`
    : x.mode === 'decklink' ? 'Blackmagic, ' + (x.decklinkKeying === 'external' ? 'fill and key' : 'fill only')
    : `NDI "${x.ndiName}"` + { fillkey: ', fill and key', chroma: ', chroma', alpha: ', with transparency' }[x.ndiSignal];
}

// The Stream Deck plugin ships with the Mac app; opening it hands it to the Stream Deck app to install.
fetch('/api/scene/streamdeck').then(r => r.json()).then(b => $('deckRow').classList.toggle('hidden', !b.available)).catch(() => {});
$('deckInstall').onclick = async () => {
  $('err').textContent = '';
  try {
    const r = await fetch('/api/scene/streamdeck', { method: 'POST' });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    $('deckInstall').textContent = 'Opened in the Stream Deck app';
    console.log('Opened the Stream Deck plugin to install it');
  } catch (err) { $('err').textContent = `Could not open the Stream Deck plugin: ${err.message}`; }
};
