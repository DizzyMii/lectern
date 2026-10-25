// Graph layouts for the Studio graph renderer. Pure functions, no DOM.
// layered(): longest-path layering, dummy nodes for long edges, barycenter
// ordering with crossing counts, then order-preserving coordinate placement.
// radial(): BFS tree from the busiest node, wedges by leaf weight, leaves on an
// outer ring drawn radially.

// Minimise sum (p - d)^2 subject to p[i+1] - p[i] >= sep[i] (pool adjacent violators).
export function placeOrdered(desired, sep) {
  const n = desired.length;
  if (!n) return [];
  const off = new Array(n);
  const blocks = [];
  for (let i = 0; i < n; i++) {
    let b = { start: i, end: i, sum: desired[i], count: 1 };
    off[i] = 0;
    b.pos = b.sum;
    blocks.push(b);
    while (blocks.length > 1) {
      const a = blocks[blocks.length - 2];
      const c = blocks[blocks.length - 1];
      const aEnd = a.pos + off[a.end];
      if (aEnd + sep[a.end] <= c.pos + 1e-9) break;
      const shift = off[a.end] + sep[a.end];
      let sum = a.sum;
      for (let j = c.start; j <= c.end; j++) { off[j] += shift; sum += desired[j] - off[j]; }
      const m = { start: a.start, end: c.end, sum, count: a.count + c.count };
      m.pos = m.sum / m.count;
      blocks.splice(blocks.length - 2, 2, m);
    }
  }
  const out = new Array(n);
  for (const b of blocks) for (let j = b.start; j <= b.end; j++) out[j] = b.pos + off[j];
  return out;
}

function crossings(upper, lower, adjDown, pos) {
  const segs = [];
  for (const u of upper) for (const v of adjDown[u]) if (pos[v] !== undefined) segs.push([pos[u], pos[v]]);
  segs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[j][0] > segs[i][0] && segs[j][1] < segs[i][1]) c++;
  return c;
}

// nodes: [{id, w, h}], edges: [{from, to}] by id. dir: 'LR' | 'TB'.
export function layered(nodes, edges, { dir = 'LR', rankGap = 90, nodeGap = 14, cap } = {}) {
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const out = Array.from({ length: n }, () => []);
  const valid = [];
  const seenPair = new Set();
  edges.forEach((e, ei) => {
    const u = idx.get(e.from), v = idx.get(e.to);
    if (u === undefined || v === undefined || u === v) return;
    valid.push({ ei, u, v });
    const k = u + ':' + v;
    if (!seenPair.has(k)) { seenPair.add(k); out[u].push(v); }
  });

  // break cycles: DFS from sources first, back edges get reversed
  const indeg = new Array(n).fill(0);
  for (const u of out.keys()) for (const v of out[u]) indeg[v]++;
  const color = new Uint8Array(n);
  const back = new Set();
  const starts = [...Array(n).keys()].sort((a, b) => (indeg[a] === 0 ? 0 : 1) - (indeg[b] === 0 ? 0 : 1) || a - b);
  for (const s of starts) {
    if (color[s]) continue;
    const stack = [[s, 0]];
    color[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [u, i] = top;
      if (i < out[u].length) {
        top[1]++;
        const v = out[u][i];
        if (color[v] === 1) back.add(u + ':' + v);
        else if (!color[v]) { color[v] = 1; stack.push([v, 0]); }
      } else { color[u] = 2; stack.pop(); }
    }
  }
  const succ = Array.from({ length: n }, () => new Set());
  const pred = Array.from({ length: n }, () => new Set());
  for (const e of valid) {
    const rev = back.has(e.u + ':' + e.v);
    e.rev = rev;
    const a = rev ? e.v : e.u, b = rev ? e.u : e.v;
    e.a = a; e.b = b;
    if (a !== b) { succ[a].add(b); pred[b].add(a); }
  }

  // longest path layering over a topological order
  const deg = pred.map((p) => p.size);
  const topo = [];
  const q = [];
  for (let i = 0; i < n; i++) if (!deg[i]) q.push(i);
  while (q.length) {
    const u = q.shift();
    topo.push(u);
    for (const v of succ[u]) if (--deg[v] === 0) q.push(v);
  }
  const layer = new Array(n).fill(0);
  for (const u of topo) for (const v of succ[u]) layer[v] = Math.max(layer[v], layer[u] + 1);
  // pull sources next to their nearest successor
  for (let i = topo.length - 1; i >= 0; i--) {
    const u = topo[i];
    if (pred[u].size || !succ[u].size) continue;
    layer[u] = Math.min(...[...succ[u]].map((v) => layer[v])) - 1;
  }
  // isolated nodes and crowded layers: move nodes forward while successors allow
  const limit = cap ?? Math.max(8, Math.ceil(Math.sqrt(n) * 1.7));
  let maxL = Math.max(0, ...layer);
  for (let L = 0; L <= maxL; L++) {
    const here = [];
    for (let i = 0; i < n; i++) if (layer[i] === L) here.push(i);
    if (here.length <= limit) continue;
    const movable = here.filter((u) => [...succ[u]].every((v) => layer[v] > L + 1)).sort((a, b) => succ[a].size - succ[b].size);
    const extra = here.length - limit;
    for (const u of movable.slice(0, extra)) layer[u] = L + 1;
    maxL = Math.max(maxL, L + 1);
  }

  // dummy chains for edges spanning more than one layer
  const total = { count: n };
  const layerOf = layer.slice();
  const down = Array.from({ length: n }, () => []);
  const up = Array.from({ length: n }, () => []);
  const isDummy = [];
  const chainOf = new Map();
  const link = (a, b) => { down[a].push(b); up[b].push(a); };
  for (const [a, set] of succ.entries()) {
    for (const b of set) {
      let prev = a;
      const chain = [];
      for (let L = layer[a] + 1; L < layer[b]; L++) {
        const d = total.count++;
        layerOf[d] = L; down[d] = []; up[d] = []; isDummy[d] = true;
        link(prev, d); chain.push(d); prev = d;
      }
      link(prev, b);
      chainOf.set(a + ':' + b, chain);
    }
  }
  const N = total.count;
  const layers = Array.from({ length: maxL + 1 }, () => []);
  // initial order: DFS-ish by original index, then one barycenter pass
  for (let i = 0; i < N; i++) layers[layerOf[i]].push(i);
  const pos = new Array(N);
  const setPos = () => layers.forEach((l) => l.forEach((u, i) => { pos[u] = i; }));
  setPos();

  const bary = (u, nbrs) => {
    if (!nbrs.length) return pos[u];
    let s = 0;
    for (const v of nbrs) s += pos[v];
    return s / nbrs.length;
  };
  const sweep = (downward) => {
    const order = downward ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(1);
    for (const L of order) {
      const lay = layers[L];
      const keys = new Map(lay.map((u) => [u, bary(u, downward ? up[u] : down[u])]));
      lay.sort((a, b) => keys.get(a) - keys.get(b) || pos[a] - pos[b]);
      lay.forEach((u, i) => { pos[u] = i; });
    }
  };
  const totalCross = () => {
    let c = 0;
    for (let L = 0; L < layers.length - 1; L++) c += crossings(layers[L], layers[L + 1], down, pos);
    return c;
  };
  // adjacent swaps that lower crossings with both neighbouring layers
  const transpose = () => {
    let improved = true, rounds = 0;
    while (improved && rounds++ < 4) {
      improved = false;
      for (let L = 0; L < layers.length; L++) {
        const lay = layers[L];
        for (let i = 0; i < lay.length - 1; i++) {
          const local = () => (L > 0 ? crossings(layers[L - 1], lay, down, pos) : 0) + (L < layers.length - 1 ? crossings(lay, layers[L + 1], down, pos) : 0);
          const before = local();
          [lay[i], lay[i + 1]] = [lay[i + 1], lay[i]];
          pos[lay[i]] = i; pos[lay[i + 1]] = i + 1;
          if (local() < before) improved = true;
          else { [lay[i], lay[i + 1]] = [lay[i + 1], lay[i]]; pos[lay[i]] = i; pos[lay[i + 1]] = i + 1; }
        }
      }
    }
  };
  sweep(true);
  let best = layers.map((l) => l.slice());
  let bestC = totalCross();
  for (let it = 0; it < 6 && bestC > 0; it++) {
    sweep(it % 2 === 1);
    sweep(it % 2 === 0);
    if (N < 400) transpose();
    const c = totalCross();
    if (c < bestC) { bestC = c; best = layers.map((l) => l.slice()); }
  }
  best.forEach((l, L) => { layers[L] = l; });
  setPos();

  // sizes along the order axis (o) and the rank axis (r)
  const LR = dir !== 'TB';
  const size = (u) => {
    if (isDummy[u]) return { o: 6, r: 0 };
    const nd = nodes[u];
    return LR ? { o: nd.h, r: nd.w } : { o: nd.w, r: nd.h };
  };
  const o = new Array(N);
  for (const lay of layers) {
    let acc = 0;
    lay.forEach((u, i) => { const s = size(u).o; if (i) acc += nodeGap; o[u] = acc + s / 2; acc += s; });
    const mid = acc / 2;
    lay.forEach((u) => { o[u] -= mid; });
  }
  const sepFor = (lay) => lay.slice(0, -1).map((u, i) => size(u).o / 2 + size(lay[i + 1]).o / 2 + (isDummy[u] && isDummy[lay[i + 1]] ? 4 : nodeGap));
  for (let it = 0; it < 10; it++) {
    const downward = it % 2 === 0;
    const order = downward ? [...layers.keys()] : [...layers.keys()].reverse();
    for (const L of order) {
      const lay = layers[L];
      const want = lay.map((u) => {
        const nb = downward ? up[u] : down[u];
        const other = downward ? down[u] : up[u];
        const all = nb.length ? nb : other;
        if (!all.length) return o[u];
        let s = 0, w = 0;
        for (const v of all) { const k = isDummy[v] && isDummy[u] ? 4 : 1; s += o[v] * k; w += k; }
        return (s / w) * 0.85 + o[u] * 0.15;
      });
      const placed = placeOrdered(want, sepFor(lay));
      lay.forEach((u, i) => { o[u] = placed[i]; });
    }
  }

  // rank coordinates
  const rankSize = layers.map((lay) => Math.max(0, ...lay.map((u) => size(u).r)));
  const r = [];
  let acc = 0;
  rankSize.forEach((s, L) => { r[L] = acc + s / 2; acc += s + rankGap; });

  const pt = (u) => (LR ? { x: r[layerOf[u]], y: o[u] } : { x: o[u], y: r[layerOf[u]] });
  const outNodes = nodes.map((nd, i) => ({ ...pt(i), w: nd.w, h: nd.h, layer: layerOf[i] }));
  const port = (u, side) => {
    const p = pt(u);
    if (isDummy[u]) return p;
    const half = (LR ? nodes[u].w : nodes[u].h) / 2;
    return LR ? { x: p.x + side * half, y: p.y } : { x: p.x, y: p.y + side * half };
  };
  const outEdges = edges.map(() => null);
  for (const e of valid) {
    if (e.a === e.b) continue;
    const chain = chainOf.get(e.a + ':' + e.b) || [];
    let pts = [port(e.a, 1), ...chain.map((d) => pt(d)), port(e.b, -1)];
    if (e.rev) pts = pts.reverse();
    outEdges[e.ei] = { points: pts, reversed: e.rev };
  }
  edges.forEach((e, ei) => {
    if (outEdges[ei] || idx.get(e.from) === undefined || idx.get(e.to) === undefined) return;
    if (e.from === e.to) outEdges[ei] = { self: true, points: [pt(idx.get(e.from))] };
  });
  return { nodes: outNodes, edges: outEdges, dir: LR ? 'LR' : 'TB', crossings: bestC, layers: layers.length };
}

// Radial: returns node positions plus, for leaves, an angle so they can be drawn radially.
export function radial(nodes, edges, { pad = 14, ringPad = 46 } = {}) {
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const adj = Array.from({ length: n }, () => []);
  edges.forEach((e) => {
    const u = idx.get(e.from), v = idx.get(e.to);
    if (u === undefined || v === undefined || u === v) return;
    adj[u].push(v); adj[v].push(u);
  });
  const degree = adj.map((a) => new Set(a).size);
  const parent = new Array(n).fill(-1);
  const children = Array.from({ length: n }, () => []);
  const depth = new Array(n).fill(-1);
  const pickRoot = (cands) => cands.reduce((b, i) => (degree[i] > degree[b] ? i : b), cands[0]);
  const bfs = (root, d0) => {
    depth[root] = d0;
    const q = [root];
    while (q.length) {
      const u = q.shift();
      for (const v of adj[u]) if (depth[v] < 0) { depth[v] = depth[u] + 1; parent[v] = u; children[u].push(v); q.push(v); }
    }
  };
  const root = n ? pickRoot([...Array(n).keys()]) : -1;
  if (root >= 0) bfs(root, 0);
  // other components hang off the root without a drawn edge
  for (;;) {
    const rest = [...Array(n).keys()].filter((i) => depth[i] < 0);
    if (!rest.length) break;
    const r = pickRoot(rest);
    parent[r] = root; children[root].push(r);
    bfs(r, 1);
  }
  const isLeaf = (u) => u !== root && !children[u].length;
  const weight = new Array(n).fill(0);
  const wOf = (u) => {
    if (isLeaf(u)) return (weight[u] = 1);
    let s = 0;
    for (const c of children[u]) s += wOf(c);
    return (weight[u] = Math.max(s, u === root ? 1 : 2.5));
  };
  if (root >= 0) wOf(root);
  // big subtrees alternate with small ones so crowded wedges spread out
  for (const u of children.keys()) {
    const cs = children[u].slice().sort((a, b) => weight[b] - weight[a]);
    const mixed = [];
    while (cs.length) { mixed.push(cs.shift()); if (cs.length) mixed.push(cs.pop()); }
    children[u] = mixed;
  }
  const angle = new Array(n).fill(0);
  const assign = (u, a, b) => {
    angle[u] = (a + b) / 2;
    let t = a;
    for (const c of children[u]) { const span = ((b - a) * weight[c]) / weight[u]; assign(c, t, t + span); t += span; }
  };
  if (root >= 0) assign(root, -Math.PI / 2, Math.PI * 1.5);

  const ext = (u, th) => Math.abs(Math.cos(th)) * nodes[u].w / 2 + Math.abs(Math.sin(th)) * nodes[u].h / 2;
  const tangentNeed = (u, th) => {
    const s = Math.abs(Math.sin(th)), c = Math.abs(Math.cos(th));
    return Math.min(s > 1e-3 ? nodes[u].w / s : Infinity, c > 1e-3 ? nodes[u].h / c : Infinity);
  };
  // leaves sit on the ring of their own depth as level pills, so a chain stays compact and every label reads flat
  const inner = [...Array(n).keys()].filter((u) => u !== root);
  const maxDepth = Math.max(0, ...inner.map((u) => depth[u]));
  const radius = new Array(n).fill(0);

  // spread nodes on one ring by angle, keeping order, with min tangential gaps
  const spread = (ids, rad, needFn) => {
    if (ids.length < 2) return;
    const TAU = Math.PI * 2;
    const norm = (a) => ((a % TAU) + TAU) % TAU;
    const sorted = ids.slice().sort((a, b) => norm(angle[a]) - norm(angle[b]));
    const as = sorted.map((u) => norm(angle[u]));
    let gapAt = 0, gap = -1;
    for (let i = 0; i < as.length; i++) {
      const g = (i === as.length - 1 ? as[0] + TAU : as[i + 1]) - as[i];
      if (g > gap) { gap = g; gapAt = i; }
    }
    const order = [...sorted.slice(gapAt + 1), ...sorted.slice(0, gapAt + 1)];
    let base = norm(angle[order[0]]);
    const want = order.map((u) => { let a = norm(angle[u]); if (a < base) a += TAU; return a; });
    const sep = order.slice(0, -1).map((u, i) => (Math.max(needFn(u, want[i]), needFn(order[i + 1], want[i + 1])) + pad) / rad);
    const got = placeOrdered(want, sep);
    order.forEach((u, i) => { angle[u] = got[i]; });
  };
  const ringNeed = (ids, needFn) => ids.reduce((s, u) => s + needFn(u, angle[u]) + pad, 0) / (Math.PI * 2);

  let prevR = 0, prevExt = root >= 0 ? Math.max(nodes[root].w, nodes[root].h) / 2 : 0;
  for (let d = 1; d <= maxDepth; d++) {
    const ring = inner.filter((u) => depth[u] === d);
    if (!ring.length) continue;
    const e = Math.max(...ring.map((u) => ext(u, angle[u])));
    let rad = Math.max(prevR + prevExt + e + ringPad, ringNeed(ring, tangentNeed) * 1.08);
    spread(ring, rad, tangentNeed);
    ring.forEach((u) => { radius[u] = rad; });
    prevR = rad; prevExt = Math.max(...ring.map((u) => ext(u, angle[u])));
  }
  const outNodes = nodes.map((nd, i) => {
    const th = angle[i], rad = i === root ? 0 : radius[i];
    const x = Math.cos(th) * rad, y = Math.sin(th) * rad;
    return { x, y, cx: x, cy: y, w: nd.w, h: nd.h, angle: th, radius: rad, leaf: false };
  });
  const outEdges = edges.map((e) => {
    const u = idx.get(e.from), v = idx.get(e.to);
    if (u === undefined || v === undefined) return null;
    if (u === v) return { self: true, points: [outNodes[u]] };
    const tree = parent[v] === u || parent[u] === v;
    return { tree, points: [outNodes[u], outNodes[v]] };
  });
  return { nodes: outNodes, edges: outEdges, root, depth };
}
