const { contextBridge } = require('electron');
// Presentation metadata only. The page receives no Node, filesystem or IPC access.
contextBridge.exposeInMainWorld('edaDesktop', Object.freeze({ titlebarHeight: 40 }));
