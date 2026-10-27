// The desktop app: runs the Lectern server inside Electron and shows it in a window.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { applySettings } from '../lib/settings.mjs';

// the window buttons sit in the page's own top bar, in its paper-2 and ink colours (tokens.css)
const BAR = { height: 47 };
const LIGHT = { ...BAR, color: '#f7f3ec', symbolColor: '#261d17' };
const DARK = { ...BAR, color: '#151c25', symbolColor: '#ebe7df' };

// ready waits for this module to finish, so nothing at the top level may await it
async function start() {
  const { startServer } = await import('../lib/server.mjs');
  const port = Number(process.env.PORT) || 4317;
  // null means something already serves that port, most likely lectern serve from a terminal, so use it
  const srv = await startServer({ port });
  const url = `http://127.0.0.1:${srv?.address().port ?? port}`;

  const win = new BrowserWindow({
    width: 1400, height: 900, title: 'Lectern', show: false,
    titleBarStyle: 'hidden', titleBarOverlay: LIGHT,
    webPreferences: { preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs') },
  });
  ipcMain.on('theme', (e, dark) => { if (e.sender === win.webContents) win.setTitleBarOverlay(dark ? DARK : LIGHT); });
  win.once('ready-to-show', () => win.show());
  // links in answers and fetched pages go to the real browser, never into the app window
  const external = (u) => { if (/^https?:\/\//i.test(u) && !u.startsWith(url)) shell.openExternal(u); };
  win.webContents.setWindowOpenHandler(({ url: u }) => { external(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); external(u); } });
  win.loadURL(url);
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  applySettings();
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch((e) => { console.error(e); app.quit(); });
}
