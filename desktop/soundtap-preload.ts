// FirstPass Studio Mac app - the bridge for desktop/soundtap.html: its sound and what it says go to the app.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('studioTap', {
  sound: (buf: ArrayBuffer | ArrayBufferView) => ipcRenderer.send('soundtap:sound', buf),
  level: (l: unknown, r: unknown) => ipcRenderer.send('soundtap:level', Number(l) || 0, Number(r) || 0),
  said: (text: unknown) => ipcRenderer.send('soundtap:said', String(text)),
});
