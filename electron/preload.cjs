// The page tells the app which theme it's in, so the window buttons can match the top bar.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lecternApp', {
  setTheme: (dark) => ipcRenderer.send('theme', Boolean(dark)),
  agents: {
    status: () => ipcRenderer.invoke('agents:status'),
    preview: (id) => ipcRenderer.invoke('agents:preview', String(id)),
    connect: (id) => ipcRenderer.invoke('agents:connect', String(id)),
  },
});
