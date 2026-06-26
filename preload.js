const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadTasks:   () => ipcRenderer.invoke('tasks:load'),
  saveTasks:   (tasks) => ipcRenderer.invoke('tasks:save', tasks),
  runTrivia:   (amount) => ipcRenderer.invoke('trivia:run', amount),
  sendStandup: () => ipcRenderer.invoke('standup:run'),
});
