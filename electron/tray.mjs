// The tray icon and menu, and the notifications from the drift watch (lib/watch.mjs).
import { app, Menu, Notification, Tray, nativeImage } from 'electron';
import { describe, markSeen, startWatch, unseenList, watchEvents } from '../lib/watch.mjs';
import { HASH_RE } from './hash.mjs';

// No image file ships, so the icon is drawn: the favicon's lectern on a red tile, 32px at 2x.
const RED = [0x22, 0x35, 0xc1, 255];     // #C13522 as BGRA
const CREAM = [0xf6, 0xfa, 0xfc, 255];   // #FCFAF6
const STROKES = [[8, 8.4, 24, 8.4], [16, 12.8, 16, 24.8], [9.2, 24.8, 16, 12.8], [22.8, 24.8, 16, 12.8]];
const segDist = (px, py, [x1, y1, x2, y2]) => {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};
function trayIcon() {
  const buf = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const px = x + 0.5, py = y + 0.5;
    if (Math.hypot(px - Math.min(26, Math.max(6, px)), py - Math.min(26, Math.max(6, py))) > 6) continue;
    buf.set(STROKES.some((s) => segDist(px, py, s) <= 1.5) ? CREAM : RED, (y * 32 + x) * 4);
  }
  return nativeImage.createFromBitmap(buf, { width: 32, height: 32, scaleFactor: 2 });
}

const MAX_ROWS = 8;
const live = new Set();   // a Notification that gets collected never fires click
let tray = null;         // a collected Tray disappears from the taskbar

export function initTray({ showMain, goto }) {
  const open = (item) => {
    markSeen(item.nb, item.kind, item.id);
    if (HASH_RE.test(item.hash)) goto(item.hash);
  };
  const sync = () => {
    if (!tray) return;
    const items = unseenList();
    tray.setToolTip(items.length ? `Lectern: ${items.length} answer${items.length === 1 ? '' : 's'} drifted` : 'Lectern');
    const rows = items.slice(0, MAX_ROWS).map((i) => ({ label: `${i.label.replace(/&/g, '&&')}: ${i.worse} citation${i.worse === 1 ? '' : 's'} off`, click: () => open(i) }));
    if (items.length > MAX_ROWS) rows.push({ label: `and ${items.length - MAX_ROWS} more`, enabled: false });
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Lectern', click: showMain },
      ...(rows.length ? [{ type: 'separator' }, ...rows] : []),
      { type: 'separator' },
      { label: 'Quit Lectern', click: () => app.quit() },
    ]));
  };
  watchEvents.on('unseen', sync);
  startWatch({
    onDrift(nb, items) {
      if (!Notification.isSupported()) return;
      // silent: the app's sounds are for in-app events (DESIGN 9)
      const n = new Notification({ ...describe(nb, items), silent: true });
      live.add(n);
      n.on('close', () => live.delete(n));
      n.on('click', () => open(items[0]));
      n.show();
    },
  });
  return {
    ensure() {
      if (!tray) {
        tray = new Tray(trayIcon());
        tray.on('click', showMain);
      }
      sync();
    },
  };
}
