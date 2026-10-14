const { contextBridge, ipcRenderer } = require('electron');
// Presentation metadata only; no model credentials, Node or filesystem access.
let visible = true;
const listeners = new Set();
ipcRenderer.on('workbench-visibility', (_event, value) => { visible = value === true; for (const callback of listeners) callback(visible); });
contextBridge.exposeInMainWorld('workbenchDesktop', Object.freeze({ titlebarHeight: 40,
  isVisible: () => visible,
  onVisibility: callback => { if (typeof callback !== 'function') return; listeners.add(callback); callback(visible); return () => listeners.delete(callback); },
}));
