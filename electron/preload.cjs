// The page tells the app which theme it's in, so the window buttons can match the top bar.
const { contextBridge, ipcRenderer } = require('electron');
// the shape setHash in public/app.js writes: #/<nb>, #/<nb>/<conv> or #/<nb>/artifact/<id>. Main only sends hashes it
// built from ids that passed ID_RE; this is the second lock. A sandboxed preload cannot import, so main-side copies are tested for equality.
const HASH_RE = /^#\/[a-z0-9][\w.-]{0,63}(?:\/(?:artifact\/)?[a-z0-9][\w.-]{0,63})?$/i;

contextBridge.exposeInMainWorld('lecternApp', {
  setTheme: (dark) => ipcRenderer.send('theme', Boolean(dark)),
  agents: {
    status: () => ipcRenderer.invoke('agents:status'),
    preview: (id) => ipcRenderer.invoke('agents:preview', String(id)),
    connect: (id) => ipcRenderer.invoke('agents:connect', String(id)),
  },
  // braces on purpose: an arrow that returned ipcRenderer.on(...) would hand the page the ipcRenderer object
  onGoto: (fn) => { ipcRenderer.on('goto', (_e, hash) => { if (typeof hash === 'string' && HASH_RE.test(hash)) fn(hash); }); },
});
