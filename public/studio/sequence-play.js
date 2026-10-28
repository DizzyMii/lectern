// The numbers and the two pure pieces behind Play on sequence sheets. sequence.js owns the DOM.
export const HOP = 320;   // ms for the packet to cross one arrow
export const BEAT = 140;  // ms it rests on the arrowhead before the next arrow leaves
export const READ = 900;  // ms to rest when the drawer just opened that step's source, and after every step under reduced motion

export const hold = (opened, reduced) => (opened || reduced ? READ : BEAT);

// Keyframes for one hop along a polyline of [x, y] points in svg user units. Offsets follow segment
// length, so the packet keeps one speed round the corners of a self-call.
export function hopFrames(pts) {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  let run = 0;
  return pts.map((p, i) => {
    if (i) run += seg[i - 1];
    return { transform: `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`, offset: total ? run / total : i / (pts.length - 1) };
  });
}

// Which bars are drawn at step i while playing, parallel to bars. A bar opens when its call has
// landed and closes when its reply leaves.
export const liveBars = (bars, i, landed) => bars.map((b) => b.to > i && (b.from < i || (b.from === i && landed)));
