const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('folioDesktop', {
  isDesktop: true,
  pickFile: () => ipcRenderer.invoke('folio:pick-file'),
  pickDirectory: () => ipcRenderer.invoke('folio:pick-directory'),
  writeFile: (filePath, bytes) =>
    ipcRenderer.invoke('folio:write-file', { filePath, bytes }),
  writeInDirectory: (dirPath, filename, bytes) =>
    ipcRenderer.invoke('folio:write-in-dir', { dirPath, filename, bytes }),
});
