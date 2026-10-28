// the palette input is one line, so pasted lines are joined; the model still gets the original lines
export const flat = (text) => String(text).replace(/\s+/g, ' ').trim();
// when the palette text still ends with the joined paste (the user typed in front of it), swap the original back in
export const restore = (q, short, full) => { const t = String(q).trim(); return short && t.endsWith(short) ? t.slice(0, -short.length) + full : q; };
