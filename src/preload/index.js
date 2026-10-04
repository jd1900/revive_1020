const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPrinterStatus: () => ipcRenderer.invoke('printer:get-status'),
  startSetup: () => ipcRenderer.invoke('printer:start-setup'),
  printFile: (filePath, copies) => ipcRenderer.invoke('printer:print-file', { filePath, copies }),
  getLogs: () => ipcRenderer.invoke('printer:get-logs'),
  selectFile: () => ipcRenderer.invoke('dialog:open-file'),

  onSetupProgress: (callback) => {
    ipcRenderer.on('setup-progress', (event, data) => callback(data));
  },
  onPrintProgress: (callback) => {
    ipcRenderer.on('print-progress', (event, data) => callback(data));
  },
});
