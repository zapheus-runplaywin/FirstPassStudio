// FirstPass Studio - the Output page, part 10 of 15: Export and import of the scene, scenes and sequences.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Export and import ────────────────────────────────────────────────
// Export downloads a .zip of the sources (and the images and videos they use) to keep or to
// import on another Mac. Import replaces every source with the ones in the file, all hidden.
const sceneNote = text => { $('sceneNote').textContent = text; $('sceneNote').classList.toggle('hidden', !text); };
$('exportScene').onclick = async () => {
  $('err').textContent = ''; sceneNote('');
  if (!scene.sources.length) { $('err').textContent = 'There are no sources to export yet.'; return; }
  const withMedia = $('exportMedia').checked;
  // A link rather than a fetch, so a big video streams straight to the file instead of through this page.
  const a = document.createElement('a');
  a.href = `/api/scene/export${withMedia ? '' : '?media=0'}`;
  a.download = '';
  document.body.append(a); a.click(); a.remove();
  const files = new Set(scene.sources.filter(s => s.file).map(s => s.file)).size;
  sceneNote(`Exporting ${scene.sources.length} source${scene.sources.length === 1 ? '' : 's'}${withMedia && files ? ` and ${files} image and video file${files === 1 ? '' : 's'}` : ''} as a .zip file.`
    + (withMedia ? '' : ' Its images and videos have to be in the other Studio\'s media folder already.'));
  console.log(`Exporting the scene (${scene.sources.length} sources${withMedia ? ', with media' : ', without media'})`);
};
$('importScene').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  $('err').textContent = ''; sceneNote('');
  if (scene.sources.length && !await askConfirm(`Replace the ${scene.sources.length} source${scene.sources.length === 1 ? '' : 's'} in the scene with the ones in ${file.name}?`,
    'The imported sources start hidden, and Stream Deck keys for sources that aren\'t in the file stop working.'
    + ' If the file has scenes they replace these scenes; an older file without them keeps these scenes.', { ok: 'Replace' })) return;
  $('importScene').disabled = true;
  sceneNote(`Importing ${file.name}…`);
  try {
    const r = await fetch('/api/scene/import', { method: 'POST', body: file });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    selected = null; renderForm(); drawBox();
    if (body.media) media = body.media;
    sceneNote(`Imported ${body.sources} source${body.sources === 1 ? '' : 's'}, all hidden${body.scenes != null ? `, and ${body.scenes} scene${body.scenes === 1 ? '' : 's'}` : ''}.`
      + (body.copied.length ? ` Added ${body.copied.join(', ')} to the media folder.` : '')
      + (body.missing.length ? ` Missing from the media folder: ${body.missing.join(', ')}. Add ${body.missing.length === 1 ? 'it' : 'them'} with Add image or Add video.` : ''));
    console.log(`Imported ${file.name}: ${body.sources} sources`);
  } catch (err) { sceneNote(''); $('err').textContent = `Couldn't import it: ${err.message}`; }
  $('importScene').disabled = false;
};
