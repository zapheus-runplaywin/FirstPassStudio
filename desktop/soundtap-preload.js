// FirstPass Studio Mac app - the bridge for desktop/soundtap.html: its sound and what it says go to the app.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioTap', {
  sound: buf => ipcRenderer.send('soundtap:sound', buf),
  said: text => ipcRenderer.send('soundtap:said', String(text)),
});
