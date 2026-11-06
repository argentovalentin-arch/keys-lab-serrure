/**
 * Particle layouts sampled on the CPU and uploaded to the GPU once: the start
 * positions and the key shape. Each holds one xyz position per particle.
 */

/** Small seeded generator: the same layouts on every load. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Start positions: points spread through a sphere, no order at all. */
export function chaosLayout(count: number, radius = 4.5): Float32Array {
  const random = mulberry32(1);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Cube-root radius gives an even density through the volume.
    const r = radius * Math.cbrt(random());
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    out[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    out[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
    out[i * 3 + 2] = r * Math.cos(phi);
  }
  return out;
}

export type Rect = [x0: number, y0: number, x1: number, y1: number];

// Key silhouette in scene units, bow on the left, bits hanging under the shaft.
// The particle key and the metal key (keyMesh.ts) are both built from it.
export const BOW = { x: -1.55, y: 0, outer: 0.85, inner: 0.4 };
export const RECTS: Rect[] = [
  [-0.8, -0.22, -0.55, 0.22], // collar
  [-0.75, -0.12, 2.3, 0.12], // shaft
  [1.35, -0.6, 1.6, -0.12], // bits
  [1.85, -0.45, 2.05, -0.12],
  [2.1, -0.55, 2.3, -0.12],
];
const BOUNDS: Rect = [-2.4, -0.85, 2.3, 0.85];
export const OFFSET_X = 0.05; // centres the key on screen
/** Thickness of the key, particle or metal. */
export const KEY_DEPTH = 0.24;

/** Horizontal span of the key once centred, from the bow to the tip. */
export const KEY_EXTENT = { minX: BOUNDS[0] + OFFSET_X, maxX: BOUNDS[2] + OFFSET_X };

function insideKey(x: number, y: number): boolean {
  const d = Math.hypot(x - BOW.x, y - BOW.y);
  if (d <= BOW.outer && d >= BOW.inner) return true;
  return RECTS.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

/** Chapter 3, "la clé": points filling a flat key, a few tenths thick. */
export function keyLayout(count: number): Float32Array {
  const random = mulberry32(3);
  const out = new Float32Array(count * 3);
  const [bx0, by0, bx1, by1] = BOUNDS;
  let i = 0;
  while (i < count) {
    const x = bx0 + random() * (bx1 - bx0);
    const y = by0 + random() * (by1 - by0);
    if (!insideKey(x, y)) continue;
    out[i * 3] = x + OFFSET_X;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = (random() - 0.5) * KEY_DEPTH;
    i++;
  }
  return out;
}
