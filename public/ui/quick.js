// The quick-ask popup (?quick=1, the desktop app's Ctrl+Alt+Space window). The page is the same one;
// this adds the clipboard text to the palette and the way back to the main window. Nothing here asks a model.
import { h, store } from './dom.js';
import { state, ctx, on } from './state.js';
import { openPalette, closePalette } from './palette.js';
import { viewerOpen } from './viewer.js';
import { kbd } from './layers.js';
import { flat, restore } from './quicktext.js';

export function initQuick() {
  const quick = window.lecternApp?.quick;
  if (!quick) return;                       // a browser tab on ?quick=1 just shows the page
  let short = '', full = '';
  const open = h('button', { class: 'btn', id: 'tb-open-main', type: 'button', disabled: true, title: 'Open this question in the main window',
    onclick: () => openMain() }, 'Open in Lectern', kbd('Alt', 'Enter'));
  document.getElementById('tb-palette').before(open);
  const sync = () => { open.disabled = !state.convId || Boolean(state.streaming); };
  const openMain = () => { sync(); if (!open.disabled) quick.open(location.hash); };
  on('conversation', sync); on('notebook', sync);

  // capture phase, so these run before the palette's and the composer's own Enter and Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !state.streaming && !viewerOpen() && !document.querySelector('dialog[open], .menu, #cite-card')) {
      e.preventDefault(); e.stopPropagation(); quick.hide();
    } else if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation(); openMain();
    }
  }, true);

  // the model gets the original lines; the palette only shows them joined
  const ask = ctx.ask;
  ctx.ask = (q) => { const text = restore(q, short, full); short = full = ''; return ask(text); };

  quick.ready(async (text) => {
    if (state.streaming) { sync(); return; }   // the answer still coming is what the popup shows
    // the main window may have moved to another notebook since the last time
    const last = store.get('lastNotebook', null);
    if (last && last !== state.nbId) {
      if (!state.notebooks.some((n) => n.id === last)) await ctx.loadNotebooks();
      if (state.notebooks.some((n) => n.id === last)) await ctx.selectNotebook(last, { conv: null });
    } else if (state.nbId) await ctx.refreshNotebook();   // questions and sources added in the main window
    closePalette(false);
    if (!state.nbId) return;                   // first run: the page's own setup screen
    state.model = 'haiku';                     // opening an old question may have switched it
    ctx.newConversation();
    full = text.trim(); short = flat(text);
    openPalette(short);
    sync();
  });
}
