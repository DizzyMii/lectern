// Graph artifacts: own SVG, layered or radial layout, pan/zoom/fit, neighbour
// highlight, search, layer legend, matrix view, detail card with an edge walk,
// SVG/PNG/Mermaid export. Node colour names the source layer of its ref; the
// kind is a word on the card, never a hue (DESIGN 2.2).

import { radial, placeOrdered } from './graph-layout.js';
import {
  h, icon, s, textWidth, clip, slug, download, copy, btn, iconButton, segmented, menuButton,
  citeHost, md, stateView, emptyView, summaryBlock, inlineSvg, svgToPng, cssVar, mermaidId, mermaidText,
  layerOf, statusOf, statusLine, markShapes, hatchDefs, swatch, citesIn, citeCard, sourceName, isExternal,
  refLabel, regenButton, UI_FONT, MONO_FONT, STATUS_WORD,
} from './common.js';

const LABEL_MAX = 34;
const FONT = `580 13px ${UI_FONT}`;
const KIND_FONT = `450 11.5px ${MONO_FONT}`;
const EDGE_FONT = `450 11.5px ${MONO_FONT}`;
const CARD_W = 300;
const R = 6;
// light hexes from DESIGN 3.3 for Mermaid, which renders outside the page
const MERMAID = {
  water: ['#CAECFF', '#84C0E4'], heath: ['#EDDFFF', '#C3ABE1'], spruce: ['#C5F0ED', '#77C8C3'], sand: ['#F6E4C5', '#D2B27C'],
  moor: ['#FFDBEA', '#DFA3BF'], lichen: ['#E5EAC9', '#B5BE82'], clay: ['#FFDECC', '#E2A989'], dusk: ['#DAE6FF', '#A3B5EB'],
};
let uid = 0;

function validGraph(d) {
  return d && Array.isArray(d.nodes) && d.nodes.every((n) => n && n.id != null);
}

// ---------- layered layout ----------
// Sugiyama steps: greedy cycle removal, longest-path layering with span-shortening moves,
// dummy nodes on long edges, median and barycenter sweeps with transposition, Brandes-Kopf
// coordinates so long edges run straight, then orthogonal routes with a lane per edge in
// each gap between ranks. Edges out of one node share a lane, nothing else does.
// The order axis (o) runs across the flow, the rank axis (r) along it.
function layeredLayout(nodes, edges, { dir = 'TB', rankGap = 60, nodeGap = 20, lane = 9, dummyGap = 10, labelRoom = 0, cap } = {}) {
  const LR = dir === 'LR';
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const pairs = new Map();
  edges.forEach((e, ei) => {
    const u = idx.get(e.from), v = idx.get(e.to);
    if (u === undefined || v === undefined || u === v) return;
    const k = u + ':' + v;
    if (!pairs.has(k)) pairs.set(k, { u, v, eis: [] });
    pairs.get(k).eis.push(ei);
  });

  // cycle removal (Eades, Lin, Smyth): sinks to the right, sources to the left, else the node
  // with the most out minus in; edges that point backwards in that sequence get reversed
  const outS = Array.from({ length: n }, () => new Set()), inS = Array.from({ length: n }, () => new Set());
  for (const { u, v } of pairs.values()) { outS[u].add(v); inS[v].add(u); }
  const alive = new Set(nodes.keys());
  const drop = (x) => { for (const y of outS[x]) inS[y].delete(x); for (const y of inS[x]) outS[y].delete(x); alive.delete(x); };
  const left = [], right = [];
  while (alive.size) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const x of alive) if (!outS[x].size) { right.unshift(x); drop(x); changed = true; }
      for (const x of alive) if (!inS[x].size) { left.push(x); drop(x); changed = true; }
    }
    if (!alive.size) break;
    let best = -1, bs = -Infinity;
    for (const x of alive) { const sc = outS[x].size - inS[x].size; if (sc > bs) { bs = sc; best = x; } }
    left.push(best); drop(best);
  }
  const seq = left.concat(right);
  const seqPos = new Array(n);
  seq.forEach((u, i) => { seqPos[u] = i; });
  const links = new Map();
  for (const p of pairs.values()) {
    p.rev = seqPos[p.u] > seqPos[p.v];
    const a = p.rev ? p.v : p.u, b = p.rev ? p.u : p.v;
    const k = a + ':' + b;
    if (!links.has(k)) links.set(k, { a, b, pairs: [] });
    links.get(k).pairs.push(p);
  }
  const succ = Array.from({ length: n }, () => []), pred = Array.from({ length: n }, () => []);
  for (const { a, b } of links.values()) { succ[a].push(b); pred[b].push(a); }

  // layering: longest path over the sequence (a topological order), then each node moves
  // within its slack to the side with more edges, which shortens the total span
  const layer = new Array(n).fill(0);
  for (const u of seq) for (const v of succ[u]) layer[v] = Math.max(layer[v], layer[u] + 1);
  for (let round = 0; round < 12; round++) {
    let moved = false;
    for (const u of seq) {
      const np = pred[u].length, ns = succ[u].length;
      if (np === ns) continue;
      const want = np > ns ? Math.max(...pred[u].map((p) => layer[p] + 1)) : Math.min(...succ[u].map((s) => layer[s] - 1));
      if (want !== layer[u]) { layer[u] = want; moved = true; }
    }
    if (!moved) break;
  }
  const minL = Math.min(0, ...layer);
  for (let i = 0; i < n; i++) layer[i] -= minL;
  // crowded layers push nodes forward while their successors allow
  const limit = cap ?? Math.max(8, Math.ceil(Math.sqrt(n) * 1.7));
  let maxL = Math.max(0, ...layer);
  for (let L = 0; L <= maxL; L++) {
    const here = [];
    for (let i = 0; i < n; i++) if (layer[i] === L) here.push(i);
    if (here.length <= limit) continue;
    const movable = here.filter((u) => succ[u].every((v) => layer[v] > L + 1)).sort((a, b) => succ[a].length - succ[b].length || pred[a].length - pred[b].length);
    for (const u of movable.slice(0, here.length - limit)) layer[u] = L + 1;
    maxL = Math.max(maxL, L + 1);
  }

  // dummy chains for edges that span more than one layer
  let N = n;
  const layerOf = layer.slice();
  const isD = new Array(n).fill(false);
  const down = Array.from({ length: n }, () => []), up = Array.from({ length: n }, () => []);
  for (const lk of links.values()) {
    lk.chain = [lk.a];
    for (let L = layer[lk.a] + 1; L < layer[lk.b]; L++) {
      const d = N++;
      layerOf[d] = L; isD[d] = true; down[d] = []; up[d] = [];
      lk.chain.push(d);
    }
    lk.chain.push(lk.b);
    for (let i = 0; i + 1 < lk.chain.length; i++) { down[lk.chain[i]].push(lk.chain[i + 1]); up[lk.chain[i + 1]].push(lk.chain[i]); }
  }
  maxL = Math.max(0, ...layerOf);

  // ordering
  let layers = Array.from({ length: maxL + 1 }, () => []);
  const pos = new Array(N);
  const setPos = () => layers.forEach((l) => l.forEach((u, i) => { pos[u] = i; }));
  const bilayer = (upper, lowerLen) => {
    // accumulator tree count (Barth, Juenger, Mutzel)
    let first = 1;
    while (first < lowerLen) first <<= 1;
    const tree = new Array(2 * first - 1).fill(0);
    first -= 1;
    let c = 0;
    for (const u of upper) {
      const ps = down[u].map((v) => pos[v]).sort((a, b) => a - b);
      for (const p of ps) {
        let i = p + first;
        tree[i]++;
        while (i > 0) { if (i % 2) c += tree[i + 1]; i = (i - 1) >> 1; tree[i]++; }
      }
    }
    return c;
  };
  const totalCross = () => { let c = 0; for (let L = 0; L < maxL; L++) c += bilayer(layers[L], layers[L + 1].length); return c; };
  const median = (nb) => {
    const ps = nb.map((v) => pos[v]).sort((a, b) => a - b);
    const m = ps.length;
    if (!m) return -1;
    if (m % 2) return ps[(m - 1) / 2];
    if (m === 2) return (ps[0] + ps[1]) / 2;
    const l = ps[m / 2 - 1] - ps[0], r = ps[m - 1] - ps[m / 2];
    return l + r ? (ps[m / 2 - 1] * r + ps[m / 2] * l) / (l + r) : (ps[m / 2 - 1] + ps[m / 2]) / 2;
  };
  const bary = (nb) => (nb.length ? nb.reduce((s, v) => s + pos[v], 0) / nb.length : -1);
  const reorder = (L, nbOf, fn) => {
    const lay = layers[L];
    const keys = lay.map((u) => fn(nbOf[u]));
    // nodes with no neighbours on that side keep their slot
    const slots = lay.map((_, i) => i).filter((i) => keys[i] >= 0);
    const sorted = slots.slice().sort((i, j) => keys[i] - keys[j] || i - j);
    const next = lay.slice();
    slots.forEach((slot, k) => { next[slot] = lay[sorted[k]]; });
    layers[L] = next;
    next.forEach((u, i) => { pos[u] = i; });
  };
  const pairCross = (u, v, nbOf) => { let c = 0; for (const a of nbOf[u]) for (const b of nbOf[v]) if (pos[a] > pos[b]) c++; return c; };
  const transpose = () => {
    for (let guard = 0, improved = true; improved && guard < 12; guard++) {
      improved = false;
      for (const lay of layers) {
        for (let i = 0; i + 1 < lay.length; i++) {
          const u = lay[i], v = lay[i + 1];
          if (pairCross(v, u, up) + pairCross(v, u, down) < pairCross(u, v, up) + pairCross(u, v, down)) {
            lay[i] = v; lay[i + 1] = u; pos[v] = i; pos[u] = i + 1; improved = true;
          }
        }
      }
    }
  };
  const byLayer = [...Array(N).keys()].sort((a, b) => layerOf[a] - layerOf[b] || a - b);
  const dfsInit = () => {
    const ls = Array.from({ length: maxL + 1 }, () => []);
    const seen = new Uint8Array(N);
    const visit = (u) => { seen[u] = 1; ls[layerOf[u]].push(u); for (const v of down[u]) if (!seen[v]) visit(v); for (const v of up[u]) if (!seen[v]) visit(v); };
    for (const u of byLayer) if (!seen[u]) visit(u);
    return ls;
  };
  const plainInit = () => { const ls = Array.from({ length: maxL + 1 }, () => []); for (const u of byLayer) ls[layerOf[u]].push(u); return ls; };
  let best = null, bestC = Infinity;
  for (const init of [dfsInit, plainInit]) {
    layers = init();
    setPos();
    let c = totalCross();
    if (c < bestC) { bestC = c; best = layers.map((l) => l.slice()); }
    for (let it = 0; it < 24 && bestC > 0; it++) {
      const fn = it % 4 < 2 ? median : bary;
      if (it % 2 === 0) for (let L = 1; L <= maxL; L++) reorder(L, up, fn);
      else for (let L = maxL - 1; L >= 0; L--) reorder(L, down, fn);
      if (N < 600) transpose();
      c = totalCross();
      if (c < bestC) { bestC = c; best = layers.map((l) => l.slice()); }
    }
  }
  layers = best;
  setPos();

  // coordinates across the flow (Brandes, Koepf): four alignments of medians into straight
  // blocks, compacted, then balanced; inner segments of long edges win conflicts
  const so = (u) => (isD[u] ? 0 : LR ? nodes[u].h : nodes[u].w);
  const sr = (u) => (isD[u] ? 0 : LR ? nodes[u].w : nodes[u].h);
  const sep = (a, b) => so(a) / 2 + so(b) / 2 + (isD[a] && isD[b] ? dummyGap : isD[a] || isD[b] ? Math.max(dummyGap, nodeGap / 2) : nodeGap);
  const ck = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  const conflict = new Set();
  for (let i = 0; i < maxL; i++) {
    const upper = layers[i], lower = layers[i + 1];
    let k0 = 0, l = 0;
    for (let l1 = 0; l1 < lower.length; l1++) {
      const v = lower[l1];
      const w = isD[v] ? up[v].find((x) => isD[x]) : undefined;
      if (l1 === lower.length - 1 || w !== undefined) {
        const k1 = w !== undefined ? pos[w] : upper.length - 1;
        for (; l <= l1; l++) for (const u of up[lower[l]]) if (pos[u] < k0 || pos[u] > k1) conflict.add(ck(u, lower[l]));
        k0 = k1;
      }
    }
  }
  const align4 = (vert, horiz) => {
    let lays = layers.map((ly) => (horiz === 'l' ? ly.slice() : ly.slice().reverse()));
    if (vert === 'u') lays = lays.reverse();
    const pt = new Array(N);
    lays.forEach((ly) => ly.forEach((u, i) => { pt[u] = i; }));
    const nb = vert === 'd' ? up : down;
    const root = [...Array(N).keys()], align = [...Array(N).keys()];
    for (let L = 1; L < lays.length; L++) {
      let r = -1;
      for (const v of lays[L]) {
        const ws = nb[v].slice().sort((a, b) => pt[a] - pt[b]);
        const d = ws.length;
        if (!d) continue;
        const ms = [Math.floor((d - 1) / 2), Math.ceil((d - 1) / 2)];
        for (const m of ms[0] === ms[1] ? [ms[0]] : ms) {
          if (align[v] !== v) break;
          const w = ws[m];
          if (!conflict.has(ck(w, v)) && r < pt[w]) { align[w] = v; root[v] = root[w]; align[v] = root[v]; r = pt[w]; }
        }
      }
    }
    // block graph: consecutive blocks in a layer must sit sep apart
    const bsucc = new Map(), bpred = new Map();
    const addB = (m, a, b, w) => { if (!m.has(a)) m.set(a, new Map()); const e = m.get(a); e.set(b, Math.max(e.get(b) ?? -Infinity, w)); };
    for (const ly of lays) for (let i = 1; i < ly.length; i++) { const w = sep(ly[i - 1], ly[i]); addB(bsucc, root[ly[i - 1]], root[ly[i]], w); addB(bpred, root[ly[i]], root[ly[i - 1]], w); }
    const roots = [...new Set(root)];
    const indeg = new Map(roots.map((b) => [b, bpred.get(b)?.size || 0]));
    const topo = roots.filter((b) => !indeg.get(b));
    for (let i = 0; i < topo.length; i++) for (const s of bsucc.get(topo[i])?.keys() || []) { indeg.set(s, indeg.get(s) - 1); if (!indeg.get(s)) topo.push(s); }
    const x = new Map();
    for (const b of topo) { let v = 0; for (const [p, w] of bpred.get(b) || []) v = Math.max(v, x.get(p) + w); x.set(b, v); }
    for (let i = topo.length - 1; i >= 0; i--) {
      const b = topo[i];
      let m = Infinity;
      for (const [s, w] of bsucc.get(b) || []) m = Math.min(m, x.get(s) - w);
      if (m !== Infinity) x.set(b, Math.max(x.get(b), m));
    }
    return [...Array(N).keys()].map((u) => (horiz === 'l' ? 1 : -1) * x.get(root[u]));
  };
  const runs = [];
  for (const vert of ['u', 'd']) for (const horiz of ['l', 'r']) {
    const xs = align4(vert, horiz);
    let lo = Infinity, hi = -Infinity;
    xs.forEach((x, u) => { lo = Math.min(lo, x - so(u) / 2); hi = Math.max(hi, x + so(u) / 2); });
    runs.push({ xs, horiz, lo, hi });
  }
  const tight = runs.reduce((a, b) => (b.hi - b.lo < a.hi - a.lo ? b : a));
  for (const rn of runs) {
    const d = rn.horiz === 'l' ? tight.lo - rn.lo : tight.hi - rn.hi;
    rn.xs = rn.xs.map((x) => x + d);
  }
  const o = [...Array(N).keys()].map((u) => { const v = runs.map((rn) => rn.xs[u]).sort((a, b) => a - b); return (v[1] + v[2]) / 2; });

  // ports: edges out of a node leave from one bus port (reversed edges get their own),
  // edges into a node land on ports spread along its side in the order they arrive
  const segs = [];
  const outOf = Array.from({ length: N }, () => []), into = Array.from({ length: N }, () => []);
  for (const lk of links.values()) {
    lk.segs = [];
    const fwd = lk.pairs.some((p) => !p.rev);
    for (let i = 0; i + 1 < lk.chain.length; i++) {
      const sg = { s: lk.chain[i], t: lk.chain[i + 1], L: layerOf[lk.chain[i]], key: fwd ? 'bus' : 'r' + lk.a + ':' + lk.b };
      segs.push(sg); lk.segs.push(sg); outOf[sg.s].push(sg); into[sg.t].push(sg);
    }
  }
  const spread = (u, want, center) => {
    const half = so(u) / 2, m = Math.min(10, half / 2);
    const lo = o[u] - half + m, hi = o[u] + half - m;
    const k = want.length;
    const clamp = (x) => Math.max(lo, Math.min(hi, x));
    if (k === 1) return [center || want[0] < lo || want[0] > hi ? o[u] : want[0]];
    const gap = Math.min(12, (hi - lo) / (k - 1));
    const got = placeOrdered(want.map(clamp), new Array(k - 1).fill(gap));
    const shift = got[0] < lo ? lo - got[0] : got[k - 1] > hi ? hi - got[k - 1] : 0;
    return got.map((x) => x + shift);
  };
  for (let u = 0; u < N; u++) {
    if (!outOf[u].length) continue;
    if (isD[u]) { for (const sg of outOf[u]) sg.top = o[u]; continue; }
    const groups = new Map();
    for (const sg of outOf[u]) { if (!groups.has(sg.key)) groups.set(sg.key, []); groups.get(sg.key).push(sg); }
    const gs = [...groups.entries()].map(([key, list]) => ({ key, list, mean: list.reduce((s, sg) => s + o[sg.t], 0) / list.length }));
    gs.sort((a, b) => a.mean - b.mean);
    const ports = spread(u, gs.map((g) => (g.key === 'bus' ? o[u] : g.mean)), gs.length === 1);
    gs.forEach((g, i) => { for (const sg of g.list) { sg.top = ports[i]; sg.group = u + '|' + g.key; } });
  }
  for (let u = 0; u < N; u++) {
    if (!into[u].length) continue;
    if (isD[u]) { for (const sg of into[u]) sg.bot = o[u]; continue; }
    const list = into[u].slice().sort((a, b) => a.top - b.top || o[a.s] - o[b.s]);
    const ports = spread(u, list.map((sg) => sg.top), false);
    list.forEach((sg, i) => { sg.bot = ports[i]; });
  }

  // channel routing: each gap between ranks gets tracks; a net that must jog takes a track,
  // ordered so its verticals do not cut other nets' horizontals where that can be avoided
  const tracksIn = new Array(maxL).fill(0);
  for (let L = 0; L < maxL; L++) {
    const nets = new Map();
    for (const sg of segs) {
      if (sg.L !== L) continue;
      const key = sg.group && sg.key === 'bus' ? sg.group : sg;
      if (!nets.has(key)) nets.set(key, { top: sg.top, bots: [], segs: [] });
      const net = nets.get(key);
      net.bots.push(sg.bot); net.segs.push(sg); sg.net = net;
    }
    const need = [...nets.values()].filter((nt) => nt.bots.some((b) => Math.abs(b - nt.top) > 0.5));
    for (const nt of need) { nt.lo = Math.min(nt.top, ...nt.bots); nt.hi = Math.max(nt.top, ...nt.bots); nt.preds = new Set(); }
    const inside = (x, nt) => x >= nt.lo - 0.5 && x <= nt.hi + 0.5;
    for (let i = 0; i < need.length; i++) {
      for (let j = i + 1; j < need.length; j++) {
        const A = need[i], B = need[j];
        if (A.hi + 6 < B.lo || B.hi + 6 < A.lo) continue;
        const ab = inside(A.top, B) || B.bots.some((x) => inside(x, A));
        const ba = inside(B.top, A) || A.bots.some((x) => inside(x, B));
        if (ab && !ba) B.preds.add(A);
        else if (ba && !ab) A.preds.add(B);
      }
    }
    let rest = need.slice(), t = 0;
    while (rest.length) {
      let free = rest.filter((nt) => [...nt.preds].every((p) => p.track !== undefined && p.track < t));
      if (!free.length) free = [rest.reduce((a, b) => ([...b.preds].filter((p) => p.track === undefined).length < [...a.preds].filter((p) => p.track === undefined).length ? b : a))];
      free.sort((a, b) => a.lo - b.lo);
      let lastHi = -Infinity;
      for (const nt of free) if (nt.lo > lastHi + 6) { nt.track = t; lastHi = nt.hi; }
      rest = rest.filter((nt) => nt.track === undefined);
      t++;
    }
    tracksIn[L] = t;
  }

  // rank coordinates: each gap is as deep as its tracks need; with edge labels the tracks
  // pack toward the upper rank and leave the last legs long enough to carry a label
  const rankSize = layers.map((ly) => Math.max(0, ...ly.map(sr)));
  const r = [], gapOf = [];
  let acc = 0;
  for (let L = 0; L <= maxL; L++) {
    r[L] = acc + rankSize[L] / 2;
    gapOf[L] = Math.max(rankGap, (tracksIn[L] + 1) * lane + (tracksIn[L] ? labelRoom : 0));
    acc += rankSize[L] + gapOf[L];
  }
  const trackAt = (L, t) => r[L] + rankSize[L] / 2 + (labelRoom ? (t + 1) * lane : ((t + 1) * gapOf[L]) / (tracksIn[L] + 1));
  const P = (oo, rr) => (LR ? { x: rr, y: oo } : { x: oo, y: rr });

  const outEdges = edges.map(() => null);
  for (const lk of links.values()) {
    const first = lk.segs[0], last = lk.segs[lk.segs.length - 1];
    const raw = [[first.top, r[layerOf[lk.a]] + sr(lk.a) / 2]];
    for (const sg of lk.segs) if (sg.net.track !== undefined) { const tr = trackAt(sg.L, sg.net.track); raw.push([sg.top, tr], [sg.bot, tr]); }
    raw.push([last.bot, r[layerOf[lk.b]] - sr(lk.b) / 2]);
    // drop repeats and points in the middle of a straight run
    const pts = [];
    for (const q of raw) {
      const z = pts[pts.length - 1];
      if (z && Math.abs(z[0] - q[0]) < 0.01 && Math.abs(z[1] - q[1]) < 0.01) continue;
      const y = pts[pts.length - 2];
      if (y && ((Math.abs(y[0] - z[0]) < 0.01 && Math.abs(z[0] - q[0]) < 0.01) || (Math.abs(y[1] - z[1]) < 0.01 && Math.abs(z[1] - q[1]) < 0.01))) pts.pop();
      pts.push(q);
    }
    const route = pts.map(([oo, rr]) => P(oo, rr));
    for (const p of lk.pairs) for (const ei of p.eis) outEdges[ei] = { points: p.rev ? route.slice().reverse() : route, reversed: p.rev, route: true };
  }
  const nodePt = (u) => P(o[u], r[layerOf[u]]);
  edges.forEach((e, ei) => {
    const u = idx.get(e.from);
    if (!outEdges[ei] && u !== undefined && e.from === e.to) outEdges[ei] = { self: true, points: [nodePt(u)] };
  });
  const outNodes = nodes.map((nd, i) => ({ ...nodePt(i), w: nd.w, h: nd.h, layer: layerOf[i] }));
  return { nodes: outNodes, edges: outEdges, dir: LR ? 'LR' : 'TB', crossings: bestC, layers: maxL + 1 };
}

export function render(container, artifact, ctx = {}) {
  container.classList.add('artifact-canvas');
  const root = h('div', { class: 'sa sa-graph' });
  container.append(root);
  const cleanup = [];
  const done = { destroy() { cleanup.forEach((f) => f()); root.remove(); } };

  if (artifact.status === 'invalid' || artifact.status === 'error' || (artifact.data && !validGraph(artifact.data))) {
    root.append(stateView(container, artifact, ctx, artifact.status === 'error' ? { message: artifact.error || 'The run ended with an error.' } : {}));
    return done;
  }
  const data = artifact.data || {};
  if (!data.nodes?.length) {
    const r = artifact.inputs?.root;
    const where = typeof r === 'string' ? r : r?.name || '';
    root.append(emptyView(`No nodes. The model found nothing to map${where ? ' in ' + where : ''}.`, null, regenButton(container, artifact, ctx)));
    return done;
  }

  // dedupe ids, drop edges to unknown nodes but keep a count for the footer
  const seen = new Set();
  const nodes = [];
  const sizeOf = (n) => {
    const lw = textWidth(n.shown, FONT) + (n.ref && !n.kind ? 22 : 0);
    const kw = n.kind ? textWidth(clip(n.kind, 22), KIND_FONT) + (n.ref ? 22 : 0) : 0;
    return { w: Math.ceil(Math.max(120, Math.max(lw, kw) + 22 + (n.layer ? 4 : 0))), h: n.kind ? 44 : 32 };
  };
  for (const n of data.nodes) {
    const id = String(n.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const label = String(n.label ?? id);
    const kind = n.kind ? String(n.kind) : '';
    const ext = isExternal(kind);
    const node = { ...n, id, label, kind, shown: clip(label, LABEL_MAX), ext, decision: /^(decision|condition)$/i.test(kind) };
    node.layer = n.ref && !ext ? layerOf(n.ref, ctx) : null;
    node.st = n.ref ? statusOf(n.ref, artifact) : null;
    Object.assign(node, sizeOf(node));
    nodes.push(node);
  }
  const edges = (data.edges || []).map((e) => ({ ...e, from: String(e.from), to: String(e.to) })).filter((e) => seen.has(e.from) && seen.has(e.to));
  const dropped = (data.edges || []).length - edges.length;
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const nbrs = nodes.map(() => new Set());
  const inc = nodes.map(() => []);
  edges.forEach((e, ei) => {
    const u = byId.get(e.from), v = byId.get(e.to);
    nbrs[u].add(v); nbrs[v].add(u); inc[u].push(ei); if (u !== v) inc[v].push(ei);
  });
  const catOf = (n) => (n.ext ? 'external' : n.layer || 'none');

  // over 20 nodes the view opens on the busiest node and its 2-hop neighbourhood
  // the busiest node from the sources (externals are context, not the subject) anchors focus mode
  const score = (i) => nbrs[i].size + (nodes[i].ext ? -1000 : 0);
  let hub = 0;
  nodes.forEach((_, i) => { if (score(i) > score(hub)) hub = i; });
  const hood = new Set([hub]);
  for (const j of nbrs[hub]) { hood.add(j); for (const k of nbrs[j]) hood.add(k); }
  // two hops that cover most of the map are no focus at all, so fall back to one
  if (hood.size > nodes.length * 0.4) { hood.clear(); hood.add(hub); for (const j of nbrs[hub]) hood.add(j); }
  let focusMode = nodes.length > 20;
  // focus in a layered map lays out only the neighbourhood, so the first view fits and reads
  const collapsed = () => focusMode && mode === 'layered' && hood.size < nodes.length;
  const OFF = { x: -1e6, y: -1e6 };

  let mode = data.layout === 'radial' ? 'radial' : 'layered';
  let dir = data.direction === 'TB' || data.direction === 'LR' ? data.direction : 'TB';
  let lay = null;
  let view = { x: 0, y: 0, k: 1 };
  let userMoved = false;
  let fitAll = false;
  // the first view fits; it only stops shrinking where labels would hide (60%)
  const MIN_OPEN_K = 0.62;
  const layCache = new Map();
  let selected = -1, hover = -1, query = '', layerFilter = null, walkAt = 0, matrixOn = false;
  const pid = `sgh${++uid}`;

  // ---------- chrome ----------
  const search = h('input', { type: 'search', class: 'sa-input', placeholder: 'Find a node', 'aria-label': 'Find a node' });
  const count = h('span', { class: 'sa-count', 'aria-live': 'polite' });
  const searchBox = h('div', { class: 'sa-search sg-find' }, icon('search', 14), search, count, h('kbd', null, 'F'));
  const viewSeg = segmented([['graph', 'Graph'], ['matrix', 'Matrix']], 'graph', (v) => setMatrix(v === 'matrix'), 'View');
  const modeSeg = segmented([['layered', 'Layered'], ['radial', 'Radial']], mode, (v) => { mode = v; dirSeg.hidden = v !== 'layered'; relayout(); }, 'Layout');
  const dirSeg = segmented([['TB', 'Top down'], ['LR', 'Left to right']], dir, (v) => { dir = v; relayout(); }, 'Direction');
  dirSeg.hidden = mode !== 'layered';
  const focusSeg = segmented([['focus', 'Focus'], ['all', 'All nodes']], focusMode ? 'focus' : 'all', (v) => { focusMode = v === 'focus'; relayout(); }, 'Show');
  focusSeg.hidden = nodes.length <= 20;
  // layout and direction sit behind one quiet menu so the toolbar stays calm
  const layoutMenu = menuButton('Layout', [
    { label: 'Layered, top down', run: () => { mode = 'layered'; dir = 'TB'; modeSeg.set(mode); dirSeg.set(dir); relayout(); } },
    { label: 'Layered, left to right', run: () => { mode = 'layered'; dir = 'LR'; modeSeg.set(mode); dirSeg.set(dir); relayout(); } },
    { label: 'Radial', run: () => { mode = 'radial'; modeSeg.set(mode); relayout(); } },
  ], { iconName: 'grid' });
  const exportMenu = menuButton('Export', [
    { label: 'SVG image', hint: '.svg', run: () => exportSvg() },
    { label: 'PNG image', hint: '.png, 2x', run: () => exportPng() },
    { label: 'Mermaid', hint: 'copy', run: () => copy(mermaid(), ctx, 'Mermaid copied') },
    { label: 'Mermaid file', hint: '.mmd', run: () => download(mermaid(), slug(artifact.title || data.title) + '.mmd') },
  ]);
  const toolbar = h('div', { class: 'sa-toolbar' },
    h('div', { class: 'sa-group' }, viewSeg, h('kbd', null, 'M')),
    h('div', { class: 'sa-spacer' }),
    exportMenu);
  // focus and layout belong to the canvas, so they sit beside the find box
  const tools = h('div', { class: 'sg-tools' }, focusSeg, layoutMenu);

  const svg = s('svg', { class: 'sg-svg', role: 'img', 'aria-label': `${data.title || artifact.title || 'Graph'}: ${nodes.length} nodes, ${edges.length} edges` });
  const viewport = s('g', { class: 'sg-viewport' });
  const content = s('g', { class: 'sg-content' });
  const usedLayers = [...new Set(nodes.map((n) => n.layer).filter(Boolean))];
  const gEdges = s('g', { class: 'sg-edges' });
  const gLabels = s('g', { class: 'sg-elabels' });
  const gNodes = s('g', { class: 'sg-nodes' });
  content.append(hatchDefs(pid, usedLayers), gEdges, gLabels, gNodes);
  viewport.append(content);
  svg.append(viewport);

  const zoomPct = h('button', { type: 'button', class: 'sg-pct', title: 'Zoom to 100%', onclick: () => zoomTo(1) }, '100%');
  const zoomBar = h('div', { class: 'sg-zoom' },
    h('button', { type: 'button', class: 'icon-btn sa-icon', 'aria-label': 'Zoom out', title: 'Zoom out (-)', onclick: () => zoomBy(0.8) }, h('span', { 'aria-hidden': 'true' }, '−')),
    zoomPct,
    h('button', { type: 'button', class: 'icon-btn sa-icon', 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => zoomBy(1.25) }, h('span', { 'aria-hidden': 'true' }, '+')),
    h('button', { type: 'button', class: 'btn quiet sa-btn sg-fit', title: 'Fit to view (0)', onclick: () => { userMoved = false; fitAll = true; fit(); } }, icon('grid', 13), h('span', null, 'Fit'), h('kbd', null, '0')));
  const legend = h('div', { class: 'sg-legend', role: 'group', 'aria-label': 'Layers' }, h('span', { class: 't-kicker' }, 'Layers'));
  const totals = h('span', { class: 'sg-totals' }, `${nodes.length} nodes · ${edges.length} edges`, dropped > 0 ? ` · ${dropped} to unknown nodes hidden` : '');
  const foot = h('div', { class: 'sg-foot' }, legend, h('div', { class: 'sa-spacer' }), totals, zoomBar);
  const card = h('aside', { class: 'sg-card', hidden: true, 'aria-label': 'Node details' });
  citeHost(card, artifact, ctx);
  const stage = h('div', { class: 'sg-stage', tabindex: '0', 'aria-label': 'Graph canvas. Drag to pan, wheel to zoom, 0 to fit, F to find, M for the matrix.' }, svg, searchBox, tools, card, foot);
  const matrix = h('div', { class: 'sg-matrix', hidden: true, tabindex: '0', 'aria-label': 'Adjacency matrix' });
  root.append(toolbar, stage, matrix);
  const sum = summaryBlock(artifact);
  if (sum) { citeHost(sum, artifact, ctx); root.append(sum); }

  // ---------- legend ----------
  const cats = new Map();
  for (const n of nodes) cats.set(catOf(n), (cats.get(catOf(n)) || 0) + 1);
  const catName = (c) => {
    if (c === 'external') return 'external';
    if (c === 'none') return 'no source';
    return sourceName(nodes.find((x) => x.layer === c)?.ref, ctx) || c;
  };
  const legendBtns = [];
  const rank = (c) => (c === 'external' ? 2 : c === 'none' ? 1 : 0);
  for (const [c, k] of [...cats].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1])) {
    const plain = c === 'external' || c === 'none';
    const b = h('button', { type: 'button', class: `sg-leg${plain ? ' ' + (c === 'external' ? 'ext' : 'none') : ''}`, 'aria-pressed': 'false', title: `${k} ${k === 1 ? 'node' : 'nodes'}. Click to pick them out.`, onclick: () => { layerFilter = layerFilter === c ? null : c; paint(); } },
      plain ? h('span', { class: 'swatch' }) : swatch(c), h('span', { class: 'k' }, catName(c)));
    b.dataset.cat = c;
    legendBtns.push(b);
    legend.append(b);
  }

  // ---------- drawing ----------
  let nodeEls = [], edgeEls = [], labelEls = [];
  // shown label boxes of the drawn layout, so fit and export keep them in frame
  let labBoxes = { lay: null, list: [] };

  function layout() {
    const key = mode === 'radial' ? 'radial' : `layered:${dir}${collapsed() ? ':focus' : ''}`;
    if (!layCache.has(key)) layCache.set(key, computeLayout());
    return layCache.get(key);
  }
  function computeLayout() {
    if (mode === 'radial') return { kind: 'radial', ...radial(nodes.map((n) => ({ id: n.id, w: n.w, h: n.h })), edges) };
    const keep = collapsed() ? [...hood].sort((a, b) => a - b) : nodes.map((_, i) => i);
    const ln = keep.map((i) => ({ id: nodes[i].id, w: nodes[i].w, h: nodes[i].h }));
    const labelled = edges.filter((e) => e.label);
    const maxLab = Math.max(0, ...labelled.map((e) => textWidth(clip(e.label, 28), EDGE_FONT)));
    const rankGap = dir === 'LR' ? Math.max(72, Math.min(190, labelled.length ? maxLab + 48 : 72)) : labelled.length ? 84 : 60;
    const labelRoom = labelled.length ? (dir === 'LR' ? Math.min(150, maxLab + 16) : 34) : 0;
    const r = layeredLayout(ln, edges, { dir, rankGap, nodeGap: dir === 'LR' ? 16 : 28, labelRoom });
    // nodes left out sit far off and are not drawn; layered() already skips their edges
    const full = nodes.map(() => ({ ...OFF, off: true }));
    keep.forEach((i, k) => { full[i] = r.nodes[k]; });
    return { kind: 'layered', ...r, nodes: full };
  }

  const boundary = (p, n, toward) => {
    const dx = toward.x - p.x, dy = toward.y - p.y;
    if (!dx && !dy) return p;
    const t = Math.min(dx ? (n.w / 2) / Math.abs(dx) : Infinity, dy ? (n.h / 2) / Math.abs(dy) : Infinity);
    return t >= 1 ? p : { x: p.x + dx * t, y: p.y + dy * t };
  };
  const f = (n) => n.toFixed(1);

  function roundedPath(pts) {
    let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      const r = Math.min(R, l1 / 2, l2 / 2);
      if (r < 0.5) { d += ` L${f(b.x)},${f(b.y)}`; continue; }
      const p1 = { x: b.x - ((b.x - a.x) / l1) * r, y: b.y - ((b.y - a.y) / l1) * r };
      const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
      d += ` L${f(p1.x)},${f(p1.y)} Q${f(b.x)},${f(b.y)} ${f(p2.x)},${f(p2.y)}`;
    }
    const z = pts[pts.length - 1];
    return d + ` L${f(z.x)},${f(z.y)}`;
  }

  function edgeGeometry(ei) {
    const geo = lay.edges[ei];
    if (!geo) return null;
    const e = edges[ei];
    const u = byId.get(e.from), v = byId.get(e.to);
    if (geo.self) {
      const p = lay.nodes[u];
      const x = (p.cx ?? p.x) + nodes[u].w / 2 - 14, y = (p.cy ?? p.y) - nodes[u].h / 2;
      const pts = [{ x: x - 16, y }, { x: x - 16, y: y - 18 }, { x: x + 6, y: y - 18 }, { x: x + 6, y }];
      return { d: roundedPath(pts), end: pts[3], from: pts[2], lab: { x: x + 10, y: y - 18 }, beside: true };
    }
    if (lay.kind === 'layered') {
      // the layout already routed it orthogonally; labels pick a leg in draw()
      const pts = geo.points;
      return { d: roundedPath(pts), end: pts[pts.length - 1], from: pts[pts.length - 2], pts };
    }
    // radial: straight lines between node edges
    const A = lay.nodes[u], B = lay.nodes[v];
    const start = A.leaf ? A : boundary(A, nodes[u], B);
    const end = B.leaf ? B : boundary(B, nodes[v], A);
    return { d: `M${f(start.x)},${f(start.y)} L${f(end.x)},${f(end.y)}`, end, from: start, lab: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, beside: false };
  }

  function arrow(end, from) {
    const ang = Math.atan2(end.y - from.y, end.x - from.x);
    const L = 6, W = 3.4;
    const bx = end.x - Math.cos(ang) * L, by = end.y - Math.sin(ang) * L;
    const px = -Math.sin(ang) * W, py = Math.cos(ang) * W;
    return `M${f(end.x)},${f(end.y)} L${f(bx + px)},${f(by + py)} L${f(bx - px)},${f(by - py)} Z`;
  }

  function nodeShape(n) {
    const x = -n.w / 2, y = -n.h / 2, w = n.w, hh = n.h;
    if (n.decision) {
      const c = 8;
      return s('path', { class: 'box', d: `M${x + c},${y} H${x + w - c} L${x + w},${y + c} V${y + hh - c} L${x + w - c},${y + hh} H${x + c} L${x},${y + hh - c} V${y + c} Z` });
    }
    return s('rect', { class: 'box', x, y, width: w, height: hh, rx: 4 });
  }

  function draw() {
    gEdges.replaceChildren(); gNodes.replaceChildren(); gLabels.replaceChildren();
    edgeEls = []; labelEls = []; nodeEls = [];
    svg.classList.toggle('sg-quiet-labels', edges.filter((e, ei) => e.label && lay.edges[ei]).length > 36);
    // labels never sit on a node or on another label; the ones that would are dropped (DESIGN 12.2)
    const placed = lay.nodes.map((p, i) => ({ x: p.x - nodes[i].w / 2, y: p.y - nodes[i].h / 2, w: nodes[i].w, h: nodes[i].h }));
    const geos = edges.map((_, ei) => edgeGeometry(ei));
    labBoxes = { lay, list: [] };
    // routed legs of every edge, so a label can also keep off other edges' lines
    const legs = [];
    geos.forEach((g, ei) => { if (g?.pts) for (let i = 0; i + 1 < g.pts.length; i++) legs.push({ ei, a: g.pts[i], b: g.pts[i + 1] }); });
    const hitsBox = (box) => placed.some((b) => b.x < box.x + box.w + 2 && box.x < b.x + b.w + 2 && b.y < box.y + box.h + 2 && box.y < b.y + b.h + 2);
    const hitsLeg = (box, ei) => legs.some((l) => l.ei !== ei && Math.min(l.a.x, l.b.x) < box.x + box.w && Math.max(l.a.x, l.b.x) > box.x && Math.min(l.a.y, l.b.y) < box.y + box.h && Math.max(l.a.y, l.b.y) > box.y);
    // a leg that runs along another edge (a shared bus) would make its label ambiguous
    const shared = (a, b, ei) => legs.some((l) => l.ei !== ei && (Math.abs(a.y - b.y) < 0.5
      ? Math.abs(l.a.y - l.b.y) < 0.5 && Math.abs(l.a.y - a.y) < 1 && Math.min(Math.max(a.x, b.x), Math.max(l.a.x, l.b.x)) - Math.max(Math.min(a.x, b.x), Math.min(l.a.x, l.b.x)) > 4
      : Math.abs(l.a.x - l.b.x) < 0.5 && Math.abs(l.a.x - a.x) < 1 && Math.min(Math.max(a.y, b.y), Math.max(l.a.y, l.b.y)) - Math.max(Math.min(a.y, b.y), Math.min(l.a.y, l.b.y)) > 4));
    // candidate spots: the last leg first (beside a vertical one, stepping back from the
    // arrow; above or below a horizontal one), then earlier legs, shared legs last
    const spots = (g, w, ei) => {
      if (!g.pts) return [{ x: g.beside ? g.lab.x + 5 : g.lab.x - w / 2, y: g.lab.y }];
      const own = [], bus = [];
      for (let i = g.pts.length - 2; i >= 0; i--) {
        const a = g.pts[i], b = g.pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 20) continue;
        const out = shared(a, b, ei) ? bus : own;
        if (Math.abs(a.x - b.x) < 0.5) {
          const sgn = Math.sign(b.y - a.y);
          for (let d = 14; d <= len - 8; d += 18) out.push({ x: b.x + 5, y: b.y - sgn * d }, { x: b.x - 5 - w, y: b.y - sgn * d });
        } else {
          for (const t of [0.5, 0.75, 0.25]) { const x = a.x + (b.x - a.x) * t; out.push({ x: x - w / 2, y: a.y - 10 }, { x: x - w / 2, y: a.y + 10 }); }
        }
      }
      const all = own.concat(bus);
      return all.length ? all : [{ x: (g.pts[0].x + g.end.x) / 2 - w / 2, y: (g.pts[0].y + g.end.y) / 2 }];
    };
    edges.forEach((e, ei) => {
      const g = geos[ei];
      if (!g) { edgeEls.push(null); labelEls.push(null); return; }
      const kind = String(e.kind || '').toLowerCase();
      const dashed = /async|optional|weak/.test(kind);
      const el = s('g', { class: `sg-edge${kind === 'cycle' ? ' cycle' : ''}${dashed ? ' dashed' : ''}` },
        s('path', { class: 'line', d: g.d }),
        s('path', { class: 'head', d: arrow(g.end, g.from) }),
        s('title', null, `${nodes[byId.get(e.from)].label} → ${nodes[byId.get(e.to)].label}${e.label ? ': ' + e.label : ''}`));
      gEdges.append(el);
      edgeEls.push(el);
      if (e.label) {
        const t = clip(e.label, 28);
        const w = textWidth(t, EDGE_FONT) + 6;
        const boxes = spots(g, w, ei).map((p) => ({ x: p.x, y: p.y - 8, w, h: 16 }));
        const free = boxes.filter((b) => !hitsBox(b));
        const box = free.find((b) => !g.pts || !hitsLeg(b, ei)) || free[0] || boxes[0];
        const hit = !free.length;
        const lab = s('g', { class: 'sg-elabel', transform: `translate(${f(box.x)},${f(box.y + 8)})` },
          s('rect', { x: 0, y: -8, width: w, height: 16 }),
          s('text', { x: 3, y: 0.5, 'dominant-baseline': 'central' }, t));
        if (!hit) { placed.push(box); labBoxes.list.push(box); }
        lab.classList.toggle('sg-hidden', hit);
        gLabels.append(lab);
        labelEls.push(lab);
      } else labelEls.push(null);
    });
    nodes.forEach((n, i) => {
      const p = lay.nodes[i];
      const x0 = -n.w / 2, y0 = -n.h / 2;
      const tx = x0 + 10 + (n.layer ? 4 : 0);
      const g = s('g', {
        class: `sg-node${p.off ? ' off' : ''}${n.ext ? ' ext' : ''}${n.layer ? ' has-layer' : ''}${n.ref ? ' has-ref' : ''}`,
        'data-layer': n.layer, transform: `translate(${f(p.x)},${f(p.y)})`, tabindex: '0', role: 'button',
        'aria-label': `${n.label}${n.kind ? ', ' + n.kind : ''}${n.st ? ', ' + STATUS_WORD[n.st] : ''}`,
      },
      s('rect', { class: 'ring', x: x0 - 3, y: y0 - 3, width: n.w + 6, height: n.h + 6, rx: 6 }),
      nodeShape(n),
      n.layer ? s('rect', { class: 'strip', x: x0 + 0.5, y: y0 + 0.5, width: 4, height: n.h - 1, fill: `url(#${pid}-${n.layer})` }) : null,
      n.kind ? s('text', { class: 'kind', x: tx, y: y0 + 13, 'dominant-baseline': 'central' }, clip(n.kind, 22)) : null,
      s('text', { class: 'label', x: tx, y: n.kind ? y0 + 30 : 0.5, 'dominant-baseline': 'central' }, n.shown),
      n.ref ? s('g', { class: `mk${n.st ? ' st-' + n.st : ''}`, transform: `translate(${f(x0 + n.w - 19)},${f(y0 + 6)}) scale(0.75)` }, markShapes(n.st)) : null,
      s('title', null, `${n.label}${n.kind ? ' (' + n.kind + ')' : ''}${n.ref ? '\n' + n.ref : ''}`));
      g.dataset.i = i;
      g.addEventListener('pointerenter', () => { hover = i; paint(); });
      g.addEventListener('pointerleave', () => { if (hover === i) { hover = -1; paint(); } });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); } });
      g.addEventListener('focus', () => { hover = i; paint(); });
      g.addEventListener('blur', () => { if (hover === i) { hover = -1; paint(); } });
      gNodes.append(g);
      nodeEls.push(g);
    });
    paint();
  }

  // highlight: hover or selection wins, then search, then the legend, then focus mode
  function paint() {
    const focus = hover >= 0 ? hover : selected;
    const q = query.trim().toLowerCase();
    const matches = q ? nodes.map((n, i) => (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || n.kind.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0) : null;
    let lit = null, litEdges = null, why = '';
    if (focus >= 0) { lit = new Set([focus, ...nbrs[focus]]); litEdges = new Set(inc[focus]); why = 'hover'; }
    else if (matches) { lit = new Set(matches); why = 'search'; }
    else if (layerFilter) { lit = new Set(nodes.map((n, i) => (catOf(n) === layerFilter ? i : -1)).filter((i) => i >= 0)); why = 'filter'; }
    else if (focusMode && !collapsed()) { lit = hood; why = 'focus'; }
    if (why) svg.dataset.dim = why; else delete svg.dataset.dim;
    nodeEls.forEach((el, i) => {
      el.classList.toggle('lit', Boolean(lit?.has(i)));
      el.classList.toggle('sel', i === selected);
      el.classList.toggle('match', Boolean(matches?.includes(i)));
    });
    edgeEls.forEach((el, ei) => {
      if (!el) return;
      const e = edges[ei];
      const on = litEdges ? litEdges.has(ei) : lit ? lit.has(byId.get(e.from)) && lit.has(byId.get(e.to)) : false;
      el.classList.toggle('lit', on);
      labelEls[ei]?.classList.toggle('lit', on);
    });
    count.textContent = matches ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : '';
    searchBox.classList.toggle('has-q', Boolean(q));
    legendBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === layerFilter)));
  }

  // ---------- detail card ----------
  function edgeRows(i) {
    const n = nodes[i];
    const ins = inc[i].filter((ei) => edges[ei].to === n.id && edges[ei].from !== n.id).map((ei) => ({ e: edges[ei], j: byId.get(edges[ei].from), out: false }));
    const outs = inc[i].filter((ei) => edges[ei].from === n.id).map((ei) => ({ e: edges[ei], j: byId.get(edges[ei].to), out: true }));
    return [...ins, ...outs];
  }
  function select(i) {
    // picking a node the focus view left out opens the whole map first
    if (i >= 0 && lay?.nodes[i]?.off) { focusMode = false; focusSeg.set('all'); selected = -1; relayout(); }
    selected = i;
    walkAt = 0;
    paint();
    if (i < 0) { card.hidden = true; return; }
    drawCard();
    card.hidden = false;
  }
  function drawCard() {
    const n = nodes[selected];
    const rows = edgeRows(selected);
    const nIn = rows.filter((r) => !r.out).length, nOut = rows.length - nIn;
    const cites = citesIn(artifact, n.detail);
    const list = h('ul', { class: 'sg-edges-list' }, rows.slice(0, 60).map((r, k) => h('li', { class: k === walkAt ? 'cur' : null },
      h('button', { type: 'button', onclick: () => go(r.j), onpointerenter: () => { hover = r.j; paint(); }, onpointerleave: () => { hover = -1; paint(); } },
        h('span', { class: 'dir', 'aria-label': r.out ? 'to' : 'from' }, r.out ? '→' : '←'),
        h('span', { class: 'what' }, r.e.label ? h('span', { class: 'el' }, clip(r.e.label, 40), r.out ? '' : ' from') : null, h('bdi', { class: 'to' }, nodes[r.j].label))))));
    card.replaceChildren(...[
      h('div', { class: 'sg-card-main', 'data-layer': n.layer },
        h('div', { class: 'sg-card-head' },
          h('span', { class: 'kind' }, n.kind || 'node', n.layer ? h('span', { class: 'src' }, ' · ', swatch(n.layer, true), ' ', sourceName(n.ref, ctx)) : n.ext ? ' · external' : ''),
          h('div', { class: 'sa-spacer' }),
          n.ref ? statusLine(n.st) : null,
          iconButton('x', 'Close details (Esc)', () => { select(-1); stage.focus({ preventScroll: true }); })),
        h('h3', null, n.label),
        n.ref ? h('div', { class: 'path' }, refLabel(n.ref)) : null,
        n.detail ? md(n.detail, artifact, 'sg-detail') : h('p', { class: 'sa-muted' }, 'No description.'),
        cites.length ? h('div', { class: 'sg-cites' }, cites.map((c) => citeCard(c, ctx))) : null,
        n.ref ? h('div', { class: 'sa-row sg-card-acts' },
          btn('Open at line', () => ctx.openRef?.(n.ref), { kbd: 'O' }),
          h('div', { class: 'sa-spacer' }),
          btn('Copy ref', () => copy(n.ref, ctx, 'Ref copied'), { cls: 'quiet' })) : null),
      rows.length ? h('div', { class: 'sg-walk' },
        h('div', { class: 'sg-walk-head' },
          h('span', { class: 't-kicker' }, 'Edges'), h('span', { class: 'cnt' }, `${nIn} in · ${nOut} out`),
          h('div', { class: 'sa-spacer' }),
          h('button', { type: 'button', class: 'kb', 'aria-label': 'Previous edge', onclick: () => walkStep(-1) }, h('kbd', null, '←')),
          h('button', { type: 'button', class: 'kb', 'aria-label': 'Next edge', onclick: () => walkStep(1) }, h('kbd', null, '→')),
          h('span', { class: 'cnt' }, 'walk')),
        list) : null].filter(Boolean));
  }
  function walkStep(d) {
    const rows = edgeRows(selected);
    if (!rows.length) return;
    walkAt = (walkAt + d + rows.length) % rows.length;
    card.querySelectorAll('.sg-edges-list li').forEach((li, k) => li.classList.toggle('cur', k === walkAt));
    hover = rows[walkAt].j; paint(); hover = -1;
  }
  function go(j) {
    select(j);
    if (!inView(j)) centerOn(j);
    nodeEls[j]?.focus({ preventScroll: true });
  }
  // arrow keys walk to the neighbour that lies most nearly in that direction
  function walk(key) {
    const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key];
    const p = lay.nodes[selected];
    let best = -1, bs = Infinity;
    for (const j of nbrs[selected]) {
      if (j === selected || lay.nodes[j].off) continue;
      const q = lay.nodes[j];
      const dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy) || 1;
      const cos = (dx * d[0] + dy * d[1]) / dist;
      if (cos < 0.3) continue;
      if (dist / cos < bs) { bs = dist / cos; best = j; }
    }
    if (best >= 0) go(best);
  }

  // ---------- matrix ----------
  function setMatrix(on) {
    matrixOn = on;
    viewSeg.set(on ? 'matrix' : 'graph');
    stage.hidden = on;
    matrix.hidden = !on;
    modeSeg.hidden = on; dirSeg.hidden = on || mode !== 'layered'; focusSeg.hidden = on || nodes.length <= 20; layoutMenu.hidden = on;
    if (on) { drawMatrix(); matrix.focus({ preventScroll: true }); }
    else { stage.focus({ preventScroll: true }); if (!userMoved) fit(); }
  }
  function drawMatrix() {
    const key = (a, b) => a + '\u0000' + b;
    const cyc = new Set();
    edges.forEach((e, ei) => { if (String(e.kind || '').toLowerCase() === 'cycle' || lay?.edges[ei]?.reversed) cyc.add(key(e.from, e.to)); });
    const adj = new Map();
    for (const e of edges) adj.set(key(e.from, e.to), cyc.has(key(e.from, e.to)) ? 'cyc' : 'on');
    const N = nodes.length;
    const grid = h('div', { class: 'sg-mx', style: { gridTemplateColumns: `max-content repeat(${N}, 14px)` } });
    grid.append(h('div', { class: 'corner' }));
    nodes.forEach((n, c) => grid.append(h('div', { class: `ch${c === selected ? ' sel' : ''}`, title: n.label }, h('span', null, clip(n.label, 28)))));
    nodes.forEach((rn, r) => {
      grid.append(h('button', { type: 'button', class: `rh${r === selected ? ' sel' : ''}`, title: `Show ${rn.label} in the graph`, onclick: () => { setMatrix(false); go(r); } }, clip(rn.label, 34)));
      nodes.forEach((cn, c) => {
        const v = adj.get(key(rn.id, cn.id));
        const cls = [v, r === selected || c === selected ? 'hl' : ''].filter(Boolean).join(' ');
        grid.append(h('i', { class: cls || null, title: v ? `${rn.label} → ${cn.label}${v === 'cyc' ? ' (cycle)' : ''}` : null }));
      });
    });
    matrix.replaceChildren(
      h('div', { class: 'sg-mx-head' },
        h('span', null, `${N} nodes · ${edges.length} edges · ${cyc.size} ${cyc.size === 1 ? 'cycle' : 'cycles'}`),
        h('div', { class: 'sa-spacer' }),
        h('span', { class: 'key' }, h('i', { class: 'on' }), 'edge'), h('span', { class: 'key' }, h('i', { class: 'cyc' }), 'cycle')),
      h('div', { class: 'sg-mx-scroll' }, grid),
      h('div', { class: 'sg-mx-foot' }, h('span', null, 'Rows point to columns.'), h('div', { class: 'sa-spacer' }),
        h('button', { type: 'button', class: 'btn quiet sa-btn', onclick: () => setMatrix(false) }, h('kbd', null, 'M'), h('span', null, 'graph'))));
  }

  // ---------- view transform ----------
  const apply = () => {
    viewport.setAttribute('transform', `translate(${f(view.x)},${f(view.y)}) scale(${view.k.toFixed(4)})`);
    const g = 24 * view.k;
    stage.style.backgroundSize = `${g.toFixed(2)}px ${g.toFixed(2)}px`;
    stage.style.backgroundPosition = `${f(view.x)}px ${f(view.y)}px`;
    svg.classList.toggle('sg-far', view.k < 0.6);
    zoomPct.textContent = `${Math.round(view.k * 100)}%`;
  };
  function bbox(only = null) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    lay.nodes.forEach((p, i) => { if ((only && !only.has(i)) || p.off) return; const n = nodes[i]; add(p.x - n.w / 2, p.y - n.h / 2); add(p.x + n.w / 2, p.y + n.h / 2); });
    if (!only) for (const g of lay.edges) if (g?.points) for (const p of g.points) add(p.x, p.y);
    if (!only && labBoxes.lay === lay) for (const b of labBoxes.list) { add(b.x, b.y); add(b.x + b.w, b.y + b.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // the part of the stage not covered by the search box, card and foot
  const insets = () => ({ top: 60, bottom: (foot.offsetHeight || 40) + 20, right: card.hidden ? 28 : CARD_W + 20, left: 28 });
  function fit() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H || !lay) return;
    const ins = insets();
    const aw = W - ins.left - ins.right, ah = H - ins.top - ins.bottom;
    const fitOf = (b) => Math.min(aw / Math.max(1, b.w), ah / Math.max(1, b.h), 1.25);
    // a big map opens on the focused neighbourhood at a readable size: two hops if they fit, else one,
    // else centred on the hub
    if (focusMode && !collapsed() && !fitAll && hood.size < nodes.length) {
      const near = new Set([hub, ...nbrs[hub]]);
      let b = bbox(hood);
      if (fitOf(b) < MIN_OPEN_K) b = bbox(near);
      const k = Math.max(MIN_OPEN_K, fitOf(b));
      const hp = lay.nodes[hub];
      const LR = mode === 'layered' && lay.dir === 'LR';
      let x = ins.left + aw / 2 - (b.x + b.w / 2) * k, y = ins.top + ah / 2 - (b.y + b.h / 2) * k;
      // too big: start the flow at the top (or left) edge, centred on the hub across it
      if (b.w * k > aw) x = LR ? ins.left - b.x * k : ins.left + aw / 2 - hp.x * k;
      if (b.h * k > ah) y = LR ? ins.top + ah / 2 - hp.y * k : ins.top - b.y * k;
      view = { k, x, y };
      apply();
      return;
    }
    const b = bbox();
    const fitK = fitOf(b);
    const k = fitAll ? fitK : Math.max(fitK, MIN_OPEN_K);
    let x = ins.left + aw / 2 - (b.x + b.w / 2) * k, y = ins.top + ah / 2 - (b.y + b.h / 2) * k;
    if (k > fitK) {
      // too big to read at fit: start where the flow starts, centred on the busiest node across it
      const p = lay.nodes[hub];
      const LR = mode === 'layered' && lay.dir === 'LR', TB = mode === 'layered' && !LR;
      if (b.w * k > aw) x = LR ? ins.left - b.x * k : ins.left + aw / 2 - p.x * k;
      if (b.h * k > ah) y = TB ? ins.top - b.y * k : ins.top + ah / 2 - p.y * k;
    }
    view = { k, x, y };
    apply();
  }
  function zoomAt(fk, cx, cy) {
    const k = Math.max(0.06, Math.min(4, view.k * fk));
    const r = k / view.k;
    view = { k, x: cx - (cx - view.x) * r, y: cy - (cy - view.y) * r };
    userMoved = true;
    apply();
  }
  const zoomBy = (fk) => zoomAt(fk, stage.clientWidth / 2, stage.clientHeight / 2);
  const zoomTo = (k) => zoomBy(k / view.k);
  function inView(i) {
    const p = lay.nodes[i], n = nodes[i];
    const x = p.x * view.k + view.x, y = p.y * view.k + view.y;
    const ins = insets();
    return x - (n.w / 2) * view.k > ins.left && x + (n.w / 2) * view.k < stage.clientWidth - ins.right && y > ins.top && y < stage.clientHeight - ins.bottom;
  }
  function centerOn(i) {
    const p = lay.nodes[i];
    const k = Math.max(view.k, 0.9);
    const ins = insets();
    // the source drawer may cover the right of the stage
    let covered = 0;
    const drawer = document.querySelector('.drawer:not([hidden])');
    if (drawer) covered = Math.max(0, stage.getBoundingClientRect().right - drawer.getBoundingClientRect().left);
    const right = Math.max(ins.right, covered + (card.hidden ? 0 : CARD_W));
    const aw = Math.max(160, stage.clientWidth - ins.left - right);
    const ah = stage.clientHeight - ins.top - ins.bottom;
    view = { k, x: ins.left + aw / 2 - (p.cx ?? p.x) * k, y: ins.top + ah / 2 - (p.cy ?? p.y) * k };
    userMoved = true;
    apply();
  }

  // drag to pan; a press that does not move is a click
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if ((e.button !== 0 && e.button !== 1) || e.target.closest('.sg-card, .sg-foot, .sg-find, .sg-tools')) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, node: e.target.closest('.sg-node') };
    try { stage.setPointerCapture(e.pointerId); } catch {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    stage.classList.add('panning');
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    userMoved = true;
    apply();
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    stage.classList.remove('panning');
    if (d.moved || e.type === 'pointercancel') return;
    if (d.node) select(Number(d.node.dataset.i));
    else if (selected >= 0) select(-1);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  // design-tool wheel: scroll pans, Ctrl+scroll and pinch zoom
  stage.addEventListener('wheel', (e) => {
    if (e.target.closest('.sg-card, .sg-foot')) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else { view.x -= e.shiftKey ? e.deltaY : e.deltaX; view.y -= e.shiftKey ? 0 : e.deltaY; userMoved = true; apply(); }
  }, { passive: false });

  const onKey = (e) => {
    if (e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'm' || k === 'M') setMatrix(!matrixOn);
    else if (matrixOn) { if (k === 'Escape') setMatrix(false); else return; }
    else if (k === 'f' || k === 'F') search.focus();
    else if (k === '+' || k === '=') zoomBy(1.2);
    else if (k === '-' || k === '_') zoomBy(1 / 1.2);
    else if (k === '0') { userMoved = false; fitAll = true; fit(); }
    else if ((k === 'o' || k === 'O') && selected >= 0 && nodes[selected].ref) ctx.openRef?.(nodes[selected].ref);
    else if (k === 'Escape' && selected >= 0) { select(-1); stage.focus({ preventScroll: true }); }
    else if (k.startsWith('Arrow') && selected >= 0 && !e.target.closest('.sg-card')) walk(k);
    else if (k.startsWith('Arrow') && e.target === stage) {
      const step = 60;
      view.x += k === 'ArrowLeft' ? step : k === 'ArrowRight' ? -step : 0;
      view.y += k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : 0;
      userMoved = true;
      apply();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  stage.addEventListener('keydown', onKey);
  matrix.addEventListener('keydown', onKey);

  search.addEventListener('input', () => { query = search.value; if (selected >= 0) select(-1); paint(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = query.trim().toLowerCase();
      const hits = nodes.map((n, i) => (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0);
      if (q && hits.length) {
        const i = hits[(hits.indexOf(selected) + 1) % hits.length];
        selected = i; drawCard(); card.hidden = false; centerOn(i); paint();
      }
    } else if (e.key === 'Escape') {
      if (search.value) { search.value = ''; query = ''; paint(); } else stage.focus({ preventScroll: true });
      e.stopPropagation();
    }
  });

  function relayout() {
    lay = layout();
    totals.textContent = `${collapsed() ? `${hood.size} of ` : ''}${nodes.length} nodes · ${edges.length} edges${dropped > 0 ? ` · ${dropped} to unknown nodes hidden` : ''}`;
    draw();
    if (selected >= 0) select(selected);
    userMoved = false;
    fit();
    if (matrixOn) drawMatrix();
  }

  const ro = new ResizeObserver(() => { if (!userMoved) fit(); });
  ro.observe(stage);
  cleanup.push(() => ro.disconnect());
  // with no direction from the model: flows run left to right, maps top down (DESIGN 12.2),
  // unless top down would have to shrink to well under half the scale left to right needs
  if (mode === 'layered' && !data.direction) {
    dir = artifact.recipe === 'flow-diagram' ? 'LR' : 'TB';
    if (dir === 'TB' && stage.clientWidth && stage.clientHeight) {
      const score = {};
      for (const d of ['TB', 'LR']) {
        dir = d; lay = layout();
        const b = bbox();
        score[d] = Math.min((stage.clientWidth - 72) / Math.max(1, b.w), (stage.clientHeight - 140) / Math.max(1, b.h));
      }
      dir = score.TB >= score.LR * 0.45 ? 'TB' : 'LR';
    }
    dirSeg.set(dir);
  }
  relayout();
  // the font may land after the first measure; redo widths once it does
  document.fonts?.ready?.then(() => {
    if (!root.isConnected) return;
    let changed = false;
    for (const n of nodes) { const sz = sizeOf(n); if (sz.w !== n.w) { n.w = sz.w; changed = true; } }
    if (changed) { layCache.clear(); relayout(); }
  });

  // ---------- export ----------
  function exportSource() {
    const saved = { hover, selected, query, layerFilter, focusMode };
    const wasCollapsed = collapsed();
    hover = -1; selected = -1; query = ''; layerFilter = null; focusMode = false;
    if (wasCollapsed) { lay = layout(); draw(); }
    paint();
    const b = bbox();
    const pad = 28;
    const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    const text = inlineSvg(content, { box, background: cssVar(container, '--paper', '#ffffff') });
    ({ hover, selected, query, layerFilter, focusMode } = saved);
    if (wasCollapsed) { lay = layout(); draw(); if (selected >= 0) select(selected); }
    paint();
    return { text, box };
  }
  function exportSvg() {
    download(exportSource().text, slug(artifact.title || data.title) + '.svg', 'image/svg+xml');
  }
  async function exportPng() {
    try {
      const { text, box } = exportSource();
      const scale = Math.min(2, 8000 / Math.max(box.w, box.h));
      download(await svgToPng(text, box.w, box.h, scale), slug(artifact.title || data.title) + '.png', 'image/png');
    } catch (e) { ctx.toast?.(e.message); }
  }
  function mermaid() {
    const used = new Map();
    const lines = [`flowchart ${mode === 'layered' ? dir : 'LR'}`];
    if (data.title) lines.unshift(`---\ntitle: ${mermaidText(data.title)}\n---`);
    for (const n of nodes) {
      const id = mermaidId(n.id, used);
      const t = mermaidText(n.kind ? `${n.kind}: ${n.label}` : n.label);
      const k = n.kind.toLowerCase();
      const shape = n.decision ? `{"${t}"}` : n.ext ? `[["${t}"]]` : k === 'database' || k === 'store' ? `[("${t}")]` : `["${t}"]`;
      lines.push(`  ${id}${shape}`);
    }
    for (const e of edges) {
      const a = mermaidId(e.from, used), b = mermaidId(e.to, used);
      const op = /cycle|optional|async|weak/i.test(e.kind || '') ? '-.->' : '-->';
      lines.push(e.label ? `  ${a} ${op}|"${mermaidText(e.label)}"| ${b}` : `  ${a} ${op} ${b}`);
    }
    for (const L of usedLayers) {
      const [fill, mid] = MERMAID[L];
      lines.push(`  classDef ${L} fill:${fill},stroke:${mid},color:#2B241E`);
      lines.push(`  class ${nodes.filter((n) => n.layer === L).map((n) => mermaidId(n.id, used)).join(',')} ${L}`);
    }
    const ext = nodes.filter((n) => n.ext);
    if (ext.length) {
      lines.push('  classDef external fill:#FCFAF6,stroke:#B9AEA2,stroke-dasharray:4 3,color:#2B241E');
      lines.push(`  class ${ext.map((n) => mermaidId(n.id, used)).join(',')} external`);
    }
    return lines.join('\n') + '\n';
  }

  return done;
}
