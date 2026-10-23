/* Street Dominoes - placement policy (drop-in for layoutTry / layoutFit).
   RULES
   1. A double is crosswise (perpendicular to the line) and NEVER pivots.
   2. The stone right after a double continues straight in the same direction.
   3. Near an edge: zoom out first (down to the floor) instead of turning.
   4. shouldPivot is true ONLY for a normal stone, whose predecessor is not a
      double, when straight placement does not fit even at the soft zoom limit.
   isDouble is never an input of shouldPivot except to forbid it. */

const ZL = [1, .9, .85, .8, .75, .7, .65, .6, .55];
const SOFT_IDX = 6;               // 0.65: normal stones turn instead of shrinking further
const FLOOR_IDX = ZL.length - 1;  // 0.55: doubles / successors may zoom this far
const PAD = 16;                   // virtual px frame padding
const EPS = 0.5;                  // touching stones are not a collision

const isDoubleStone = s => s.a === s.b;

// L = stone length, W = thickness. dir = {x:+-1,y:0} or {x:0,y:+-1}.
function stoneRect(head, dir, double, L, W) {
  const along = double ? W : L;    // crosswise double occupies only its thickness along the line
  const across = double ? L : W;
  const h = dir.x !== 0;
  const a0 = h ? head.x : head.y, a1 = a0 + (h ? dir.x : dir.y) * along;
  const c = h ? head.y : head.x;
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const rect = h
    ? { x0: lo, x1: hi, y0: c - across / 2, y1: c + across / 2 }
    : { y0: lo, y1: hi, x0: c - across / 2, x1: c + across / 2 };
  return { rect, head: h ? { x: a1, y: head.y } : { x: head.x, y: a1 } };
}

const overlaps = (a, b) =>
  a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.y0 < b.y1 - EPS && a.y1 > b.y0 + EPS;
const collides = (r, rects) => rects.some(o => overlaps(r, o));

function fitsAtZoom(rects, tableW, tableH, z) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of rects) { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1); }
  return (x1 - x0) <= tableW / z - 2 * PAD && (y1 - y0) <= tableH / z - 2 * PAD;
}

// first zoom index in [from..to] where all rects fit, else -1
function firstFit(rects, tableW, tableH, from, to) {
  for (let i = from; i <= to; i++) if (fitsAtZoom(rects, tableW, tableH, ZL[i])) return i;
  return -1;
}

/* st = { rects, head, dir, prevWasDouble, tableW, tableH, zoomIdx, L, W }
   returns { dir, zoomIdx, pivot, double, fallback? } */
function planNext(st, stone) {
  const double = isDoubleStone(stone);
  const { rects, head, dir, tableW, tableH, L, W } = st;

  // Rule 4: separate condition; a double or a successor of a double can never pivot.
  const mayPivot = !double && !st.prevWasDouble;
  const limit = Math.max(mayPivot ? SOFT_IDX : FLOOR_IDX, st.zoomIdx); // zoom never goes back up

  const placed = stoneRect(head, dir, double, L, W);
  const need = [...rects, placed.rect];
  let ok = !collides(placed.rect, rects);
  if (double && ok) {
    // reserve room for the successor so we zoom NOW instead of pivoting after the double
    const succ = stoneRect(placed.head, dir, false, L, W).rect;
    ok = !collides(succ, rects);
    if (ok) need.push(succ);
  }
  if (ok) {
    const z = firstFit(need, tableW, tableH, st.zoomIdx, limit);
    if (z >= 0) return { dir, zoomIdx: z, pivot: false, double, rect: placed.rect, head: placed.head };
  }

  if (mayPivot) {
    const options = [];
    for (const d of (dir.x !== 0 ? [{ x: 0, y: -1 }, { x: 0, y: 1 }] : [{ x: -1, y: 0 }, { x: 1, y: 0 }])) {
      // corner placement: turn stone sits flush with the chain end, one half-thickness off the line
      const ph = dir.x !== 0
        ? { x: head.x - dir.x * W / 2, y: head.y + d.y * W / 2 }
        : { x: head.x + d.x * W / 2, y: head.y - dir.y * W / 2 };
      const p = stoneRect(ph, d, false, L, W);
      if (collides(p.rect, rects)) continue;
      const z = firstFit([...rects, p.rect], tableW, tableH, st.zoomIdx, Math.max(FLOOR_IDX, st.zoomIdx));
      if (z >= 0) options.push({ d, z, rect: p.rect, head: p.head });
    }
    if (options.length) {
      options.sort((a, b) => a.z - b.z);       // more free room = less zoom needed
      return { dir: options[0].d, zoomIdx: options[0].z, pivot: true, double, rect: options[0].rect, head: options[0].head };
    }
  }
  // last resort: stay straight at the floor zoom (never turn a double or its successor).
  // If this still overflows, keep your existing "turn after double" fallback here.
  return { dir, zoomIdx: Math.max(FLOOR_IDX, st.zoomIdx), pivot: false, double, fallback: true, rect: placed.rect, head: placed.head };
}

if (typeof module !== 'undefined') module.exports = { planNext, stoneRect, ZL, isDoubleStone };
