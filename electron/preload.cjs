const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('atlasDesktop', {
  catalog: () => ipcRenderer.invoke('atlas:catalog'),
  chooseFolder: () => ipcRenderer.invoke('atlas:choose'),
  load: (key, source) => ipcRenderer.invoke('atlas:load', { key, source }),
  copyLoc: (text) => ipcRenderer.invoke('atlas:copy-loc', text),
  exportPNG: (bytes, name) => ipcRenderer.invoke('atlas:export', { bytes, name }),
});
