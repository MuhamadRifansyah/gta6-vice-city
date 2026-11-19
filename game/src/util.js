// Solmar Bay — small math and random helpers shared by every system.
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
// Deterministic mulberry32 so the city layout is the same every run.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function randRange(rng, a, b) { return a + rng() * (b - a); }
// Circle vs axis-aligned box push-out. Returns true when a collision happened.
export function collideCircleBox(px, pz, r, box) {
  const cx = clamp(px, box.minX, box.maxX);
  const cz = clamp(pz, box.minZ, box.maxZ);
  const dx = px - cx, dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, depth: r - d };
  }
  // Centre inside the box: push out along the smallest penetration axis.
  const pl = px - box.minX, pr = box.maxX - px, pt = pz - box.minZ, pb = box.maxZ - pz;
  const m = Math.min(pl, pr, pt, pb);
  if (m === pl) return { nx: -1, nz: 0, depth: pl + r };
  if (m === pr) return { nx: 1, nz: 0, depth: pr + r };
  if (m === pt) return { nx: 0, nz: -1, depth: pt + r };
  return { nx: 0, nz: 1, depth: pb + r };
}
