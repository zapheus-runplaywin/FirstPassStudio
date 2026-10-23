// FirstPass Studio - asks for a line of text in a dialog on the page.
//
// window.prompt() does nothing in the Mac app's windows (Electron doesn't support it), so pages
// that need a name ask with this instead. askText(question, value) resolves to the trimmed
// text, or null when cancelled or left empty.

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
// ([{ label, value, alt }], the last one the default) and resolves to the value of the one
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
