// Draggable, keyboard-resizable dividers with persisted widths: rail, Studio panel, source drawer.

import { store } from './dom.js';

const LIMITS = { rail: [200, 420], studio: [320, 560], drawer: [400, 1100] };
const DEFAULTS = { rail: 248, studio: 392, drawer: 640 };
const VARS = { rail: '--rail-w-user', studio: '--studio-w', drawer: '--drawer-w' };

export function initPanes(app) {
  const root = document.documentElement;
  const widths = { ...DEFAULTS, ...store.get('panes3', {}) };
  const apply = () => { for (const k of Object.keys(VARS)) root.style.setProperty(VARS[k], widths[k] + 'px'); };
  apply();
  const bind = (div, which) => {
    if (!div) return;
    const fromLeft = which === 'rail';
    const set = (w) => {
      const [lo, hi] = LIMITS[which];
      widths[which] = Math.round(Math.max(lo, Math.min(hi, w, window.innerWidth - 420)));
      apply();
      div.setAttribute('aria-valuenow', widths[which]);
    };
    div.setAttribute('aria-valuemin', LIMITS[which][0]);
    div.setAttribute('aria-valuemax', LIMITS[which][1]);
    div.setAttribute('aria-valuenow', widths[which]);
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      div.setPointerCapture(e.pointerId);
      app.classList.add('dragging');
      root.classList.add('dragging');
      div.classList.add('on');
      const move = (ev) => set(fromLeft ? ev.clientX : window.innerWidth - ev.clientX);
      const up = () => {
        app.classList.remove('dragging');
        root.classList.remove('dragging');
        div.classList.remove('on');
        div.removeEventListener('pointermove', move);
        div.removeEventListener('pointerup', up);
        store.set('panes3', widths);
      };
      div.addEventListener('pointermove', move);
      div.addEventListener('pointerup', up);
    });
    div.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 64 : 16;
      const dir = fromLeft ? 1 : -1;
      if (e.key === 'ArrowLeft') set(widths[which] - step * dir);
      else if (e.key === 'ArrowRight') set(widths[which] + step * dir);
      else return;
      e.preventDefault();
      store.set('panes3', widths);
    });
    div.addEventListener('dblclick', () => { set(DEFAULTS[which]); store.set('panes3', widths); });
  };
  bind(app.querySelector('.rail-div'), 'rail');
  bind(app.querySelector('.studio-div'), 'studio');
  bind(document.querySelector('.drawer-div'), 'drawer');
}
