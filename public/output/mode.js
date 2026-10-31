// FirstPass Studio - the Output page, part 14 of 15: Show and Prep: the two views of the page.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.
//
// Show is game night: the picture with its output tabs, the status board, scenes and sequences as tiles, and the sources
// as show-and-hide only. Prep is before the night: the sources with their settings, the scene and sequence editors, the
// outputs' settings, music and mic settings, the media folder. Everything is on the page in both; the body's class
// (mode-show, mode-prep) says what shows (output.html's styles). The choice is remembered on this Mac; a fresh Studio
// starts in Prep, where the sources are added. Every id stays the same in both, so Stream Deck links and tests do too.
const MODE_KEY = 'studio.outputMode';
let viewMode = (() => { try { return localStorage.getItem(MODE_KEY) === 'show' ? 'show' : 'prep'; } catch { return 'prep'; } })();
function setMode(m, save = true) {
  viewMode = m === 'show' ? 'show' : 'prep';
  document.body.classList.toggle('mode-show', viewMode === 'show');
  document.body.classList.toggle('mode-prep', viewMode === 'prep');
  for (const b of $('modeSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === viewMode));
  if (save) { try { localStorage.setItem(MODE_KEY, viewMode); } catch { /* no storage */ } }
  // The picture changes width between the views, and the board draws only in Show.
  requestAnimationFrame(() => { fitPreview(); if (typeof renderBoard === 'function') renderBoard(); });
}
for (const b of $('modeSeg').querySelectorAll('button')) b.onclick = () => setMode(b.dataset.mode);
setMode(viewMode, false);

// Settings, in the row over the picture: in Show, opens the picked output's set-up as a drawer under the row (it stays
// a folding section in Prep, where the button isn't needed).
$('outCfg').onclick = () => {
  const open = !$('outSection').classList.contains('cfgOpen');
  $('outSection').classList.toggle('cfgOpen', open);
  $('outCfg').setAttribute('aria-pressed', String(open));
  if (open && isFolded($('outSection'))) setFolded($('outSection'), false);
  requestAnimationFrame(fitPreview);
};

