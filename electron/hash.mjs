// The hashes main may send to the page (#/<nb>, #/<nb>/<conv> or #/<nb>/artifact/<id>). preload.cjs
// cannot import, so it holds a copy of this; test/desktop.test.mjs checks the two are equal.
export const HASH_RE = /^#\/[a-z0-9][\w.-]{0,63}(?:\/(?:artifact\/)?[a-z0-9][\w.-]{0,63})?$/i;
