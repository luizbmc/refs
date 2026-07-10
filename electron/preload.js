const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('refsBridge', {
  validarUrls(urls) {
    return ipcRenderer.invoke('refs:validarUrls', urls);
  },
  extrairEstruturaDocx(payload) {
    return ipcRenderer.invoke('refs:extrairEstruturaDocx', payload);
  },
  exportarDocxCorrigido(payload) {
    return ipcRenderer.invoke('refs:exportarDocxCorrigido', payload);
  }
});
