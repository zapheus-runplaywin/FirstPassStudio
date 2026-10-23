// FirstPass Studio - editors in a dialog (a sponsor, a sequence, a playlist, an athlete's games)
// don't lose changes without asking.
//
// unsavedDialog(dlg, { what, snapshot, save }) watches dlg: call .opened() once the editor is
// filled and open. snapshot() returns the editor's state (anything JSON can hold), save() saves it
// and resolves true once saved and closed. Then, with changes not saved yet:
// - Escape asks Save, Don't save or Keep editing (the Cancel button still just cancels);
// - leaving the page from the Mac app's Go menu, Back or Forward asks the same
//   (window.studioBeforeLeave, see desktop/windows.js);
// - closing the window or reloading asks whether to leave without saving.
// Needs asktext.js (askChoice).

'use strict';

(function () {
  const guards = [];

  function ask(g) {
    return askChoice(`Save your changes to ${g.what() || 'this'}?`, "If you don't save them, they're lost.",
      [{ label: 'Keep editing', value: 'cancel', alt: true }, { label: "Don't save", value: 'discard', alt: true }, { label: 'Save', value: 'save' }]);
  }

  // Asks about any open editor with changes; resolves to true when it's fine to carry on.
  async function settle() {
    for (const g of guards) {
      if (!g.changed()) continue;
      const choice = await ask(g);
      if (choice === 'discard') { g.dlg.close(); continue; }
      if (choice !== 'save' || !await g.save()) return false;
    }
    return true;
  }

  window.unsavedDialog = function unsavedDialog(dlg, { what, snapshot, save }) {
    let baseline = null;
    const now = () => { try { return JSON.stringify(snapshot()); } catch { return baseline; } };
    const g = {
      dlg, save,
      what: typeof what === 'function' ? what : () => what,
      opened() { baseline = now(); },
      changed: () => dlg.open && baseline !== null && now() !== baseline,
    };
    dlg.addEventListener('close', () => { baseline = null; });
    dlg.addEventListener('cancel', async e => {
      if (!g.changed()) return;
      e.preventDefault();
      const choice = await ask(g);
      if (choice === 'discard') dlg.close();
      else if (choice === 'save') await save();
    });
    guards.push(g);
    if (guards.length === 1) {
      window.studioBeforeLeave = settle;
      addEventListener('beforeunload', e => { if (guards.some(x => x.changed())) { e.preventDefault(); e.returnValue = ''; } });
    }
    return g;
  };
})();
