// FirstPass Studio - the Output page, part 10 of 12: Adding sources: a page from the one list of graphics (pages.js), an image or a video.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Adding sources ───────────────────────────────────────────────────
// media: [{ name, kind, converting, converted, opaque }] from the helper's media folder.
function fillMedia(sel, value, kind) {
  sel.innerHTML = '';
  const list = media.filter(m => m.kind === kind);
  if (!list.length) sel.innerHTML = `<option value="">No ${kind}s yet: add one below</option>`;
  for (const m of list) {
    const note = m.converting ? ' (converting…)'
      : m.opaque ? ` (no transparency: it's ${m.opaque.toUpperCase()}, not ProRes 4444; use ${m.converted || 'the WebM'})`
      : m.converted ? ` (ProRes: use ${m.converted})` : /\.mov$/i.test(m.name) ? ' (may not play: needs converting)' : '';
    sel.add(new Option(m.name + note, m.name, false, m.name === value));
  }
  if (value && !list.some(m => m.name === value)) sel.add(new Option(`${value} (missing)`, value, true, true));
}
function mediaNote() {
  const busy = media.filter(m => m.converting).map(m => m.name);
  $('mediaNote').textContent = adding !== 'video' ? '' :
    (busy.length ? `Converting ${busy.join(', ')} to WebM so it can play. This can take a few minutes; you can add it now and it switches over when done. ` : '') +
    (canConvert ? 'A .mov (ProRes 4444 keeps its transparency) is converted to a WebM beside it when added; the original is kept.'
      : 'A .mov (ProRes) has to be converted to play, and this copy of Studio has no ffmpeg to do it (the Mac app includes one; from a copy of the code run vendor/ffmpeg/build.sh or brew install ffmpeg). MP4 and WebM play as they are.');
}
async function loadMedia(value) {
  try { const body = await (await fetch('/api/scene/media')).json(); media = body.media || []; canConvert = !!body.canConvert; mediaLoaded = true; } catch { media = []; }
  renderList();
  if (adding && adding !== 'browser') fillMedia($('newFile'), value || $('newFile').value, adding);
  mediaNote();
  const s = current();
  if (s && s.type !== 'browser') fillMedia($('fFile'), s.file, s.type);
  // A page option that lists the songs (the intro and outro's Theme) shows the ones just added.
  if (s && s.type === 'browser' && $('fOptions').querySelector('[data-list="audio"]')) renderOptions(s);
  if (scene.music) renderMusic();
  // Studio measures a song's or video's length the first time it's asked: ask again shortly for the ones it hadn't yet.
  if (!mediaRetried && media.some(m => (m.kind === 'audio' || m.kind === 'video') && !m.converting && !m.duration)) { mediaRetried = true; setTimeout(() => loadMedia(), 1500); }
  if (!isFolded($('mediaSection'))) loadLibrary();
}
let mediaRetried = false;
