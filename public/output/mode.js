// FirstPass Studio - the Output page, part 15 of 16: The set-up behind buttons: the output's Settings drawer, each source's settings under its row, Music and Mics Settings.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.
//
// The page is one view: the picture and the status board, then scenes, sequences and the sources as On and Off, with
// the set-up a click away in each section's header rather than a second view of the page. Every id stays where it
// was, so Stream Deck links and tests do too.

// Settings, in the row over the picture: opens the picked output's set-up as a drawer under the row.
function setOutCfg(open) {
  $('outSection').classList.toggle('cfgOpen', open);
  $('outCfg').setAttribute('aria-pressed', String(open));
  if (open && isFolded($('outSection'))) setFolded($('outSection'), false);
  requestAnimationFrame(fitPreview);
}
$('outCfg').onclick = () => setOutCfg(!$('outSection').classList.contains('cfgOpen'));
if (location.hash === '#outSection') setOutCfg(true); // a link to the output's settings opens the drawer

// Done under a source's settings closes them (the pencil in its row does too).
$('settingsDone').onclick = () => { editOpen = false; renderList(); };

// Music and Mics: Settings in the header unfolds the section's form (output.html's styles key off cfgOpen).
for (const [btn, sec] of [['musicCfg', 'musicSection'], ['micsCfg', 'micsSection']]) {
  $(btn).onclick = () => {
    const open = !$(sec).classList.contains('cfgOpen');
    $(sec).classList.toggle('cfgOpen', open);
    $(btn).setAttribute('aria-pressed', String(open));
    if (open && isFolded($(sec))) setFolded($(sec), false);
  };
}
