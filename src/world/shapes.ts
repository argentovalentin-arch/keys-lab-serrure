import * as THREE from 'three/webgpu';
import { keyGlyph } from './glyph';

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

// Key silhouette in scene units, the bits hanging under the shaft, the tip on the right.
// The particle key and the metal key (keyMesh.ts) are both built from it, and the keys of
// the ring on the summit too (src/terrain/summit.ts).
//
// The bow is a round medallion: an open ring with, inside it, the brand's « k. » as it
// stands in the Keys wordmark (glyph.ts: the brand typeface's own « k » and full stop,
// their proportions and spacing untouched), upright, welded to the ring where its ends
// reach it. The shaft carries straight on from the ring's right side to the bits.
export const MEDALLION = {
  /** Centre (key x; it sits on the shaft's line, y = 0). */
  cx: -2.2,
  /** Outer radius, and the width of the ring's band. */
  outer: 0.85,
  band: 0.15,
};
export const RECTS: Rect[] = [
  [1.35, -0.6, 1.6, -0.12], // bits
  [1.85, -0.45, 2.05, -0.12],
  [2.1, -0.55, 2.3, -0.12],
];
export const OFFSET_X = 0.3; // centres the key on screen
/** Thickness of the key, particle or metal. */
export const KEY_DEPTH = 0.24;

/** Horizontal span of the key once centred, from the medallion's left edge to the tip. */
export const KEY_EXTENT = { minX: MEDALLION.cx - MEDALLION.outer + OFFSET_X, maxX: 2.3 + OFFSET_X };

/** Inner radius of the medallion's ring. */
export const medallionInner = () => MEDALLION.outer - MEDALLION.band;

/** Width of the fine ties that hold the letter to the ring. */
const TIE = 0.05;

/**
 * The « k. » laid out in the medallion, at the size it has always had (the whole « k. »
 * fitted so its farthest ends reach halfway into the ring's band).
 *
 * The « k » is centred on its visual centre: two thirds the middle of its ink, one third
 * its centre of mass, so the heavy stem on its left does not make it look off to that side.
 * The full stop keeps its size and its gap from the letter; there is no room for it on the
 * baseline inside the ring, so it sits low on the right, against the ring's inner edge.
 */
interface Layout {
  scale: number;
  /** Glyph x from which ink belongs to the full stop. */
  split: number;
  /** The « k »'s visual centre (glyph), placed on the medallion's centre. */
  kc: THREE.Vector2;
  /** The full stop's centre (glyph), and where it goes (key space, from the medallion's centre). */
  dc: THREE.Vector2;
  dot: THREE.Vector2;
  /** The stem's axis (key x) and its ends (key y), for the ties. */
  stemX: number;
  stemTop: number;
  stemFoot: number;
}
let layoutCache: Layout | null = null;
function letter() {
  const g = keyGlyph();
  if (!layoutCache) {
    let far = 0;
    for (const loop of g.outlines) for (const p of loop) far = Math.max(far, Math.hypot(p.x - g.aspect / 2, p.y - 0.5));
    const scale = (medallionInner() + MEDALLION.band * 0.5) / far;

    // The full stop: the piece reaching furthest right; the « k »: everything left of it.
    const bounds = (loop: THREE.Vector2[]) => new THREE.Box2().setFromPoints(loop);
    const dotBox = g.outlines.map(bounds).reduce((a, b) => (b.max.x > a.max.x ? b : a));
    const split = dotBox.min.x - 0.01;
    const kBox = new THREE.Box2();
    let kMass: THREE.Vector2 | null = null;
    let kArea = 0;
    for (const loop of g.outlines) {
      if (bounds(loop).min.x >= split) continue;
      kBox.union(bounds(loop));
      let area = 0, mx = 0, my = 0;
      loop.forEach((p, i) => {
        const q = loop[(i + 1) % loop.length];
        const c = p.x * q.y - q.x * p.y;
        area += c; mx += (p.x + q.x) * c; my += (p.y + q.y) * c;
      });
      if (Math.abs(area) > kArea) { kArea = Math.abs(area); kMass = new THREE.Vector2(mx / (3 * area), my / (3 * area)); }
    }
    const middle = kBox.getCenter(new THREE.Vector2());
    const kc = kMass ? middle.clone().multiplyScalar(2 / 3).add(kMass.clone().multiplyScalar(1 / 3)) : middle;

    const dc = dotBox.getCenter(new THREE.Vector2());
    const dotR = ((dotBox.max.x - dotBox.min.x) / 2) * scale;
    // Where the wordmark puts it; if that falls in the ring, it is brought in against the
    // ring's inner edge (welded to it), as low as it goes while keeping the wordmark's gap
    // from the « k ».
    const dot = dc.clone().sub(kc).multiplyScalar(scale);
    const reach = medallionInner() + 0.03 - dotR;
    if (dot.length() > reach) {
      const gap = (dotBox.min.x - kBox.max.x) * scale;
      const inK = (x: number, y: number) => {
        const gx = x / scale + kc.x;
        return gx < split && g.inside(gx, y / scale + kc.y);
      };
      const clear = (cx: number, cy: number) => {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          if (inK(cx + Math.cos(a) * (dotR + gap), cy + Math.sin(a) * (dotR + gap))) return false;
        }
        return true;
      };
      for (let y = dot.y; y < 0; y += 0.005) {
        dot.set(Math.sqrt(Math.max(reach * reach - y * y, 0)), y);
        if (clear(dot.x, dot.y)) break;
      }
    }

    const stem = (g.stem[0] + g.stem[1]) / 2;
    layoutCache = {
      scale, split, kc, dc, dot,
      stemX: MEDALLION.cx + (stem - kc.x) * scale,
      stemTop: (kBox.max.y - kc.y) * scale,
      stemFoot: (kBox.min.y - kc.y) * scale,
    };
  }
  return { g, ...layoutCache };
}
/** A point of the letter or the full stop (normalised) in key space. */
const placed = (gx: number, gy: number) => {
  const { scale, split, kc, dc, dot } = letter();
  if (gx >= split) return new THREE.Vector2(MEDALLION.cx + dot.x + (gx - dc.x) * scale, dot.y + (gy - dc.y) * scale);
  return new THREE.Vector2(MEDALLION.cx + (gx - kc.x) * scale, (gy - kc.y) * scale);
};

/** Whether (x, y), in key space (before OFFSET_X), lies in the « k. ». */
export function insideK(x: number, y: number): boolean {
  const { g, scale, split, kc, dc, dot } = letter();
  const kx = (x - MEDALLION.cx) / scale + kc.x;
  if (kx < split && g.inside(kx, y / scale + kc.y)) return true;
  const dx = (x - MEDALLION.cx - dot.x) / scale + dc.x;
  return dx >= split && g.inside(dx, (y - dot.y) / scale + dc.y);
}

/** The « k. »'s outlines (the letter, the full stop), in key space (before OFFSET_X). */
export function kOutlines(): THREE.Vector2[][] {
  return keyGlyph().outlines.map((loop) => loop.map((p) => placed(p.x, p.y)));
}

/**
 * The shaft, from the medallion's right side straight on to the tip; and the two fine ties
 * holding the « k » to the ring, carrying its stem on up and down to the band's middle.
 */
export function bowRects(): Rect[] {
  const { stemX, stemTop, stemFoot } = letter();
  const band = (medallionInner() + MEDALLION.outer) / 2;
  const ringY = Math.sqrt(Math.max(band * band - (stemX - MEDALLION.cx) ** 2, 0));
  return [
    [MEDALLION.cx + MEDALLION.outer - 0.06, -0.12, 2.3, 0.12],
    [stemX - TIE / 2, stemTop - 0.02, stemX + TIE / 2, ringY],
    [stemX - TIE / 2, -ringY, stemX + TIE / 2, stemFoot + 0.02],
  ];
}

/** Where a key hangs from a ring: through the top of the medallion's band (centred key space). */
export function bowHangPoint(): THREE.Vector2 {
  return new THREE.Vector2(MEDALLION.cx + OFFSET_X, medallionInner() + MEDALLION.band * 0.5);
}

/** The key's extent in key space, for sampling it. */
function keyBounds(): Rect {
  return [KEY_EXTENT.minX - OFFSET_X, -MEDALLION.outer, 2.3, MEDALLION.outer];
}

/**
 * How far (x, y) lies inside the key, from its nearest edge; negative outside. Where two
 * parts overlap (letter, ring, shaft), the deeper one counts.
 */
function insideDepth(x: number, y: number): number {
  let depth = -1;
  if (insideK(x, y)) {
    // In the letter: how far to its edge, sampled around the point.
    depth = 0.12;
    search: for (const r of [0.03, 0.06, 0.09]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (!insideK(x + Math.cos(a) * r, y + Math.sin(a) * r)) {
          depth = r - 0.015;
          break search;
        }
      }
    }
  }
  const r = Math.hypot(x - MEDALLION.cx, y);
  depth = Math.max(depth, Math.min(r - medallionInner(), MEDALLION.outer - r));
  for (const [x0, y0, x1, y1] of [...RECTS, ...bowRects()]) depth = Math.max(depth, Math.min(x - x0, x1 - x, y - y0, y1 - y));
  return depth;
}

/** Inside depth from which a point counts as the key's body rather than its outline. */
const OUTLINE = 0.09;

/**
 * Chapter 3, "la clé": points filling a flat key, a few tenths thick.
 *
 * The points are ordered by when they take their place as the key emerges from the noise
 * (particles.ts reads the order from the index): points on the outline mostly come first,
 * so the silhouette is drawn before it fills, with enough chance mixed in that it builds
 * up everywhere at once rather than as a wave.
 */
export function keyLayout(count: number): Float32Array {
  const random = mulberry32(3);
  const points: { x: number; y: number; z: number; order: number }[] = [];
  const [bx0, by0, bx1, by1] = keyBounds();
  while (points.length < count) {
    const x = bx0 + random() * (bx1 - bx0);
    const y = by0 + random() * (by1 - by0);
    const depth = insideDepth(x, y);
    if (depth < 0) continue;
    const outline = Math.min(depth / OUTLINE, 1);
    points.push({ x: x + OFFSET_X, y, z: (random() - 0.5) * KEY_DEPTH, order: outline * 0.4 + random() * 0.6 });
  }
  points.sort((a, b) => a.order - b.order);
  const out = new Float32Array(count * 3);
  points.forEach((p, i) => out.set([p.x, p.y, p.z], i * 3));
  return out;
}
