// The desktop app: runs the Lectern server inside Electron and shows it in a window.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import { applySettings } from '../lib/settings.mjs';
import { initTray } from './tray.mjs';
import { initQuick } from './quick.mjs';

// the window buttons sit in the page's own top bar, in its paper-2 and ink colours (tokens.css)
const BAR = { height: 47 };
const LIGHT = { ...BAR, color: '#f7f3ec', symbolColor: '#261d17' };
const DARK = { ...BAR, color: '#151c25', symbolColor: '#ebe7df' };
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ready waits for this module to finish, so nothing at the top level may await it
async function start() {
  const { startServer } = await import('../lib/server.mjs');
  const port = Number(process.env.PORT) || 4317;
  // null means something already serves that port, most likely lectern serve from a terminal, so use it
  const srv = await startServer({ port });
  const url = `http://127.0.0.1:${srv?.address().port ?? port}`;

  const preload = path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs');
  const win = new BrowserWindow({
    width: 1400, height: 900, title: 'Lectern', show: false,
    titleBarStyle: 'hidden', titleBarOverlay: LIGHT,
    webPreferences: { preload },
  });
  ipcMain.on('theme', (e, dark) => { if (e.sender === win.webContents) win.setTitleBarOverlay(dark ? DARK : LIGHT); });
  // Settings > Agents: register lectern mcp with Claude Code or Cursor, running through this exe
  const agents = await import('../lib/agents.mjs');
  const target = () => ({ exe: process.execPath, script: path.join(APP_DIR, 'bin', 'lectern.mjs'), home: process.env.LECTERN_HOME ? path.resolve(process.env.LECTERN_HOME) : undefined });
  const mine = (e) => e.sender === win.webContents;
  ipcMain.handle('agents:status', (e) => (mine(e) ? agents.status(target()) : null));
  ipcMain.handle('agents:preview', (e, id) => (mine(e) ? agents.preview(String(id), target()) : null));
  ipcMain.handle('agents:connect', (e, id) => (mine(e) ? agents.connect(String(id), target()) : null));
  win.once('ready-to-show', () => win.show());
  // links in answers and fetched pages go to the real browser, never into a Lectern window
  const external = (u) => { if (/^https?:\/\//i.test(u) && !u.startsWith(url)) shell.openExternal(u); };
  const lock = (w) => {
    w.webContents.setWindowOpenHandler(({ url: u }) => { external(u); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); external(u); } });
  };
  lock(win);
  win.loadURL(url);
  // closing hides the window while Lectern lives in the tray. Quit in the tray menu, or the
  // Quit-when-the-window-closes setting, really closes it. Windows logoff must not be blocked.
  let quitting = false;
  const keep = () => process.env.LECTERN_QUIT_ON_CLOSE !== '1';
  const showMain = () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); };
  const goto = (hash) => { showMain(); win.webContents.send('goto', hash); };
  const tray = initTray({ showMain, goto });
  app.on('before-quit', () => { quitting = true; });
  win.on('session-end', () => { quitting = true; });
  win.on('close', (e) => { if (!quitting && keep()) { e.preventDefault(); win.hide(); tray.ensure(); } });
  win.on('closed', () => app.quit());
  if (keep()) tray.ensure();
  app.on('second-instance', showMain);
  initQuick({ url, preload, lock, goto, background: () => (nativeTheme.shouldUseDarkColors ? DARK.color : LIGHT.color) });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  applySettings();
  app.setAppUserModelId('dev.dizzymii.lectern');
  app.whenReady().then(start).catch((e) => { console.error(e); app.quit(); });
}
