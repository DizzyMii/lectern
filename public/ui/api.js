// HTTP + SSE client. With ?mock=1 the dev mock stands in for fetch.

let doFetch = (...a) => fetch(...a);
export let mockMode = false;

export async function initApi() {
  if (new URLSearchParams(location.search).get('mock') === '1') {
    // the mocks are dev-only and left out of the npm package; without them it runs for real
    let m, s;
    try { [m, s] = await Promise.all([import('/dev-mock.js'), import('./mock-studio.js')]); } catch { return; }
    // dev-mock answers first; studio routes it does not know fall through to the studio mock
    doFetch = async (url, opts) => {
      const r = await m.mockFetch(url, opts);
      return r.status === 404 && s.handles(url) ? s.studioFetch(url, opts) : r;
    };
    mockMode = true;
  }
}

async function req(method, path, body, signal) {
  const opts = { method, headers: {}, signal };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await doFetch(path, opts);
  const type = r.headers.get('content-type') || '';
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText || ''}`.trim();
    try { const j = type.includes('json') ? await r.json() : { error: await r.text() }; msg = j.error || j.message || msg; } catch {}
    const err = new Error(msg); err.status = r.status; throw err;
  }
  if (r.status === 204) return null;
  return type.includes('json') ? r.json() : r.text();
}

export const api = {
  get: (p, signal) => req('GET', p, undefined, signal),
  post: (p, b) => req('POST', p, b ?? {}),
  patch: (p, b) => req('PATCH', p, b ?? {}),
  del: (p, b) => req('DELETE', p, b),
};

export const nbPath = (id, rest = '') => `/api/notebooks/${encodeURIComponent(id)}${rest}`;

// POST that answers with text/event-stream. Calls onEvent for each event and
// resolves when the stream ends. A JSON answer is passed to onEvent as one 'done'.
export async function stream(path, body, onEvent, signal) {
  const r = await doFetch(path, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  const type = r.headers.get('content-type') || '';
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  if (!type.includes('event-stream')) {
    const j = type.includes('json') ? await r.json() : { message: await r.text() };
    onEvent({ type: j.type || 'done', ...j });
    return;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ev = { name: '', data: [] };
  const flush = () => {
    if (!ev.data.length) { ev = { name: '', data: [] }; return; }
    const raw = ev.data.join('\n');
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { text: raw }; }
    if (typeof payload !== 'object' || payload === null) payload = { value: payload };
    if (!payload.type && ev.name) payload.type = ev.name;
    if (!payload.type) payload.type = 'message';
    try { onEvent(payload); } catch (e) { console.error(e); }
    ev = { name: '', data: [] };
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') flush();
      else if (line.startsWith(':')) continue;
      else if (line.startsWith('data:')) ev.data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) ev.name = line.slice(6).trim();
    }
  }
  if (buf.trim().startsWith('data:')) ev.data.push(buf.trim().slice(5).trim());
  flush();
}
