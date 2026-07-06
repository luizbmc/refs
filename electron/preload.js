const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('refsBridge', {
  validarUrls(urls) {
    return ipcRenderer.invoke('refs:validarUrls', urls);
  }
});
