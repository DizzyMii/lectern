// What the sanitizer lets through for model answers, artifacts and pinned docs. Kept free of
// DOM code so node tests can check it. Nothing rendered may load a resource from another host.

// No styles or forms: they could restyle the app or overlay a fake UI. No media tags, whose
// src, poster and srcset fetch on their own. Buttons stay because citation chips are buttons.
export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['data-n', 'data-layer', 'data-dense'],
  FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'option', 'video', 'audio', 'source', 'picture', 'track', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'srcset', 'imagesrcset', 'poster', 'background', 'ping', 'action', 'formaction', 'lowsrc', 'dynsrc'],
};

// Attributes that load something without a click. href on a link only navigates when clicked.
export const FETCH_ATTRS = ['src', 'srcset', 'poster', 'background', 'data', 'lowsrc', 'dynsrc', 'xlink:href', 'href'];

// Same-origin paths and inline images only. Browsers drop tabs and newlines inside a URL and
// read a backslash as a slash, so a path that starts with a slash then either one is refused.
export const safeResource = (url) => /^(\/(?![/\\])|data:image\/)/i.test(String(url ?? '').replace(/[\t\n\r]/g, '').trim());

// runs on every element after its attributes are cleaned
export function afterAttributes(node) {
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'A') {
    const href = node.getAttribute('href');
    if (href && /^https?:/i.test(href)) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    node.removeAttribute('ping');
    return;
  }
  for (const a of FETCH_ATTRS) {
    if (node.hasAttribute?.(a) && !safeResource(node.getAttribute(a))) node.removeAttribute(a);
  }
}
