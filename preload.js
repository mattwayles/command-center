const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runTrivia:   (amount) => ipcRenderer.invoke('trivia:run', amount),
  sendStandup: () => ipcRenderer.invoke('standup:run'),
});
