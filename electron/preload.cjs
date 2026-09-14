const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('atlasDesktop', {
  navigation: (command, value, operation) =>
    ipcRenderer.invoke('atlas:navigation', command, value, operation),
  onNavigationProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('atlas:navigation-progress', listener);
    return () =>
      ipcRenderer.removeListener('atlas:navigation-progress', listener);
  },
  catalog: () => ipcRenderer.invoke('atlas:catalog'),
  chooseFolder: () => ipcRenderer.invoke('atlas:choose'),
  load: (key, source) => ipcRenderer.invoke('atlas:load', { key, source }),
  copyLoc: (text) => ipcRenderer.invoke('atlas:copy-loc', text),
  exportPNG: (bytes, name) =>
    ipcRenderer.invoke('atlas:export', { bytes, name }),
});
