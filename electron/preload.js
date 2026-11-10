const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('refsBridge', {
  // caminho no disco de um File escolhido/arrastado (vazio se não houver)
  caminhoDoArquivo(file) {
    try {
      return (webUtils?.getPathForFile ? webUtils.getPathForFile(file) : file?.path) || '';
    } catch (err) {
      return '';
    }
  },
  validarUrls(urls) {
    return ipcRenderer.invoke('refs:validarUrls', urls);
  },
  extrairEstruturaDocx(payload) {
    return ipcRenderer.invoke('refs:extrairEstruturaDocx', payload);
  },
  exportarDocxCorrigido(payload) {
    return ipcRenderer.invoke('refs:exportarDocxCorrigido', payload);
  },
  salvarTrabalho(payload) {
    return ipcRenderer.invoke('refs:salvarTrabalho', payload);
  },
  abrirTrabalho() {
    return ipcRenderer.invoke('refs:abrirTrabalho');
  },
  autosalvarTrabalho(estado) {
    return ipcRenderer.invoke('refs:autosalvarTrabalho', estado);
  },
  lerRecuperacao() {
    return ipcRenderer.invoke('refs:lerRecuperacao');
  },
  descartarRecuperacao() {
    return ipcRenderer.invoke('refs:descartarRecuperacao');
  }
});
