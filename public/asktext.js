// FirstPass Studio - the questions a Studio page asks, each in the same dialog (.fp-ask, studio.css).
//
// window.prompt() does nothing in the Mac app's windows (Electron doesn't support it), and the
// browser's confirm() and alert() look nothing like Studio, so every page asks with these instead:
//   askText(question, value)                       a line of text, or null when cancelled or left empty
//   askConfirm(question, detail, { ok, danger })   true when the ok button (default "OK"; danger draws it red) is pressed
//   askChoice(question, detail, buttons)           the value of the button pressed, or null on Escape
//   tell(question, detail)                         says something, one OK button
// Each resolves once the dialog closes. They open over an editor's own <dialog> too (unsaved.js uses that).

'use strict';

window.askText = function askText(question, value = '') {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'fp-ask';
    const form = document.createElement('form');
    form.method = 'dialog';
    const label = document.createElement('label');
    label.textContent = question;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    label.append(input);
    const buttons = document.createElement('div');
    buttons.className = 'fp-ask__buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'alt'; cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.value = 'ok'; ok.textContent = 'OK';
    buttons.append(cancel, ok);
    form.append(label, buttons);
    dlg.append(form);
    document.body.append(dlg);
    cancel.onclick = () => dlg.close('');
    dlg.addEventListener('close', () => {
      const text = dlg.returnValue === 'ok' ? input.value.trim() : '';
      dlg.remove();
      resolve(text || null);
    });
    dlg.showModal();
    input.focus();
    input.select();
  });
};

// askChoice(question, detail, buttons) shows a question with a button for each of buttons
// ([{ label, value, alt, danger }], the last one the default) and resolves to the value of the one
// pressed, or null when the dialog is closed with Escape.
window.askChoice = function askChoice(question, detail, buttons) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'fp-ask';
    const form = document.createElement('form');
    form.method = 'dialog';
    const q = document.createElement('p');
    q.className = 'fp-ask__question';
    q.textContent = question;
    form.append(q);
    if (detail) { const p = document.createElement('p'); p.className = 'fp-ask__detail'; p.textContent = detail; form.append(p); }
    const row = document.createElement('div');
    row.className = 'fp-ask__buttons';
    let last = null;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'submit'; btn.value = b.value; btn.textContent = b.label;
      if (b.alt) btn.className = 'alt';
      if (b.danger) btn.className = 'danger';
      row.append(btn);
      last = btn;
    }
    form.append(row);
    dlg.append(form);
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      const v = buttons.find(b => b.value === dlg.returnValue);
      dlg.remove();
      resolve(v ? v.value : null);
    });
    dlg.showModal();
    if (last) last.focus();
  });
};

// askConfirm(question, detail, { ok, danger }) asks yes or no: Cancel, or the ok button ("OK" unless
// named, drawn red with danger: true when it deletes or stops something). Resolves to true or false.
window.askConfirm = async function askConfirm(question, detail = '', { ok = 'OK', danger = false } = {}) {
  return (await askChoice(question, detail, [{ label: 'Cancel', value: 'cancel', alt: true }, { label: ok, value: 'ok', danger }])) === 'ok';
};

// tell(question, detail) says something that needs no answer, with one OK button.
window.tell = function tell(question, detail = '') {
  return askChoice(question, detail, [{ label: 'OK', value: 'ok' }]);
};
