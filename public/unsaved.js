// FirstPass Studio - editors don't lose changes without asking. One guard, one question
// ("Save your changes to X?" with Keep editing, Don't save and Save) for every editor, whether
// it's a dialog (a sponsor, a sequence, a playlist, a mic, an athlete's games, a scene's switcher
// actions) or a whole page (Competitions setup).
//
// unsavedDialog(dlg, { what, snapshot, save }) watches dlg: call .opened() once the editor is
// filled and open. snapshot() returns the editor's state (anything JSON can hold), save() saves it
// and resolves true once saved and closed. With changes not saved yet, Escape asks (the Cancel
// button still just cancels).
//
// unsavedPage({ what, changed, save, discard }) guards a page that edits in place: changed()
// says whether there's anything unsaved, save() saves it and resolves true when it worked,
// discard() forgets the changes. Its .settle() asks when there's something unsaved and resolves
// to false to stay put, else to 'saved', 'discarded' or true (nothing to save), for the page's
// own flows (opening another item, making a new one).
//
// Either way, with changes not saved yet:
// - leaving the page from the Mac app's Go menu, Back or Forward asks (window.studioBeforeLeave,
//   see desktop/windows.js), and so does a link in the page, such as a tab at the top;
// - closing the window or reloading asks whether to leave without saving.
// Needs asktext.js (askChoice).

'use strict';

(function () {
  const guards = [];

  function ask(g) {
    return askChoice(`Save your changes to ${g.what() || 'this'}?`, "If you don't save them, they're lost.",
      [{ label: 'Keep editing', value: 'cancel', alt: true }, { label: "Don't save", value: 'discard', alt: true }, { label: 'Save', value: 'save' }]);
  }

  // One guard: asks when it has changes; false to stay put, else 'saved', 'discarded' or true.
  async function settleOne(g) {
    if (!g.changed()) return true;
    const choice = await ask(g);
    if (choice === 'discard') { g.discard(); return 'discarded'; }
    if (choice !== 'save' || !await g.save()) return false;
    return 'saved';
  }

  // Asks about any open editor with changes; resolves to true when it's fine to carry on.
  async function settle() {
    for (const g of guards) if (!await settleOne(g)) return false;
    return true;
  }

  function add(g) {
    guards.push(g);
    if (guards.length > 1) return;
    window.studioBeforeLeave = settle;
    // Following a link in this window (the tabs at the top) asks first.
    document.addEventListener('click', async e => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!guards.some(x => x.changed())) return;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const to = new URL(a.href, location.href);
      if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search && to.hash) return;
      e.preventDefault();
      if (await settle()) location.href = to.href;
    });
    // Anything else (closing the window, reloading): the browser's own "Leave page?" question; the
    // Mac app asks Leave or Stay itself (desktop/windows.js), as Electron would cancel it silently.
    addEventListener('beforeunload', e => { if (guards.some(x => x.changed())) { e.preventDefault(); e.returnValue = ''; } });
  }

  window.unsavedDialog = function unsavedDialog(dlg, { what, snapshot, save }) {
    let baseline = null;
    const now = () => { try { return JSON.stringify(snapshot()); } catch { return baseline; } };
    const g = {
      dlg, save,
      what: typeof what === 'function' ? what : () => what,
      opened() { baseline = now(); },
      changed: () => dlg.open && baseline !== null && now() !== baseline,
      discard: () => dlg.close(),
    };
    dlg.addEventListener('close', () => { baseline = null; });
    dlg.addEventListener('cancel', async e => {
      if (!g.changed()) return;
      e.preventDefault();
      const choice = await ask(g);
      if (choice === 'discard') dlg.close();
      else if (choice === 'save') await save();
    });
    add(g);
    return g;
  };

  window.unsavedPage = function unsavedPage({ what, changed, save, discard }) {
    const g = { what: typeof what === 'function' ? what : () => what, changed, save, discard };
    g.settle = () => settleOne(g);
    add(g);
    return g;
  };
})();
