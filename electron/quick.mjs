// Quick ask: Ctrl+Alt+Space in any app opens a small always-on-top window that is the same page in
// ?quick=1 mode, with the clipboard text already in the palette. Off until the setting is on.
import { BrowserWindow, app, clipboard, globalShortcut, ipcMain, Notification, screen } from 'electron';
import { settingsChanged } from '../lib/settings.mjs';
import { HASH_RE } from './hash.mjs';

const KEY = 'Ctrl+Alt+Space';
const MAX = 8000;   // characters of clipboard text that reach the page, cut on whole characters
const W = 720, H = 560;

export function initQuick({ url, preload, lock, goto, background }) {
  let win = null;
  let ready = false;
  let pending = null;   // clipboard text waiting for the page to say it is ready
  let owned = false;    // we hold the key
  const live = new Set();   // a Notification that gets collected never shows

  const mine = (e) => win && e.sender === win.webContents;

  // same spot as the palette: centred, about 15% down, on the screen the cursor is on
  const present = (text) => {
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    win.setBounds({ x: Math.round(a.x + (a.width - W) / 2), y: Math.round(a.y + a.height * 0.15), width: W, height: H });
    win.show(); win.focus();
    win.webContents.send('quick', text);
  };

  const toggle = () => {
    if (win?.isVisible() && win.isFocused()) { win.hide(); return; }
    const text = [...clipboard.readText()].slice(0, MAX).join('');
    if (win && ready) { present(text); return; }
    pending = text;
    if (win) return;
    // the window stays hidden until the page says it is ready, so a half-booted page is never seen
    win = new BrowserWindow({
      width: W, height: H, show: false, frame: false, alwaysOnTop: true, skipTaskbar: true,
      fullscreenable: false, minimizable: false, maximizable: false, title: 'Lectern quick ask',
      backgroundColor: background(), webPreferences: { preload },
    });
    lock(win);
    win.on('blur', () => win?.hide());
    win.on('closed', () => { win = null; ready = false; });
    // a reload or a dead page must not leave the popup hidden for good
    win.webContents.on('did-start-loading', () => { ready = false; });
    win.webContents.on('render-process-gone', () => win?.destroy());
    win.webContents.on('did-fail-load', (_e, _c, _d, _u, main) => { if (main) win?.destroy(); });
    win.loadURL(`${url}/?quick=1`);
  };

  ipcMain.on('quick:ready', (e) => {
    if (!mine(e)) return;
    ready = true;
    if (pending !== null) { const t = pending; pending = null; present(t); }
  });
  ipcMain.on('quick:hide', (e) => { if (!mine(e)) return; win.hide(); });
  ipcMain.on('quick:open', (e, hash) => {
    if (!mine(e)) return;
    if (typeof hash !== 'string' || !HASH_RE.test(hash)) return;
    win.hide();
    goto(hash);
  });

  const syncKey = () => {
    if (owned) { globalShortcut.unregister(KEY); owned = false; }
    if (process.env.LECTERN_QUICK_ASK !== '1') return;
    try { owned = globalShortcut.register(KEY, toggle); } catch {}
    if (!owned) {
      const n = new Notification({ title: 'Quick ask is off', body: `${KEY} is already used by another app.` });
      live.add(n); n.on('close', () => live.delete(n));
      n.show();
    }
  };

  syncKey();
  settingsChanged.on('change', (keys) => { if (keys.includes('LECTERN_QUICK_ASK')) try { syncKey(); } catch {} });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
