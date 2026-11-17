import * as THREE from 'three/webgpu';

/**
 * The « k. » of the Keys wordmark (« keys. », set in Bodoni Moda, the brand's typeface,
 * already loaded by the page), turned into a shape the key's bow is made of: rendered once
 * into a canvas, then read back as an inside test (for the particle key) and traced into
 * an outline (for the metal key). Nothing is drawn by hand: the letter is the font's.
 *
 * Coordinates are normalised: the letter's ink spans 0..1 in height from its baseline,
 * x from 0 at its left edge (width `aspect`).
 */
export interface Glyph {
  /** Width of the ink over its height. */
  aspect: number;
  /** Height of the ink above the baseline over its full height (0..1; the rest is below). */
  baseline: number;
  /** Whether a point (normalised) lies in the letter. */
  inside(x: number, y: number): boolean;
  /** The letter's outline, one closed polygon per piece, normalised. */
  outlines: THREE.Vector2[][];
  /** The stem: its left and right edges (normalised x), read high up, above the branches. */
  stem: [number, number];
  /** Where the branches (arm and leg) meet the stem: normalised height. */
  junction: number;
}

const SIZE = 420; // canvas px
const FONT_PX = 340;
const FONT = `500 ${FONT_PX}px "Bodoni Moda", Didot, "Bodoni MT", serif`;

let glyph: Glyph | null = null;

/** Loads the brand typeface (if not yet) and prepares the « k. » (letter and full stop). Call once before building keys. */
export async function prepareKeyGlyph(): Promise<void> {
  if (glyph) return;
  try {
    await Promise.race([document.fonts.load(FONT, 'k'), new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    // The fallback serif still gives a « k ».
  }
  glyph = traceLetter('k.');
}

/** The prepared « k » (see prepareKeyGlyph). */
export function keyGlyph(): Glyph {
  if (!glyph) glyph = traceLetter('k.'); // fallback: whatever font is available now
  return glyph;
}

function traceLetter(letter: string): Glyph {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.font = FONT;
  ctx.textBaseline = 'alphabetic';
  const baselinePx = SIZE * 0.82;
  ctx.fillText(letter, SIZE * 0.2, baselinePx);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && data[(y * SIZE + x) * 4 + 3] > 110;

  // Bounding box of the ink.
  let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!ink(x, y)) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const h = y1 - y0 + 1;
  const toNorm = (px: number, py: number) => new THREE.Vector2((px - x0) / h, (y1 + 1 - py) / h);

  // Outer outlines of each piece (Moore-neighbour tracing), simplified.
  const seen = new Uint8Array(SIZE * SIZE);
  const outlines: THREE.Vector2[][] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!ink(x, y) || ink(x - 1, y) || seen[y * SIZE + x]) continue;
      const loop = trace(x, y, ink);
      if (loop.length < 12) continue;
      // Mark the piece as done (flood fill), so each is traced once.
      const stack = [[x, y]];
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        if (!ink(cx, cy) || seen[cy * SIZE + cx]) continue;
        seen[cy * SIZE + cx] = 1;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      outlines.push(simplify(loop, 0.9).map(([px, py]) => toNorm(px, py)));
    }
  }

  // The stem, read at 85 % of the height (above the branches, under the top serif).
  const rowAt = (ny: number) => Math.round(y1 + 1 - ny * h);
  let sl = -1, sr = -1;
  {
    const row = rowAt(0.85);
    for (let x = x0; x <= x1; x++) if (ink(x, row)) { if (sl < 0) sl = x; sr = x; } else if (sl >= 0) break;
  }
  // The junction: the height, between the baseline and the top of the branches, where ink
  // to the right of the stem comes closest to it (the arm and the leg meet there).
  let best = Infinity;
  let junctionRow = rowAt(0.25);
  const touching: number[] = [];
  for (let row = rowAt(0.6); row <= rowAt(0.05); row++) {
    let x = sr + 2;
    while (x <= x1 && !ink(x, row)) x++;
    // Ink touching the stem: the branches are joined to it here.
    let gap = x - sr;
    if (ink(sr + 1, row) && ink(sr + 2, row) && ink(sr + 3, row)) gap = 0;
    if (gap === 0) touching.push(row);
    if (gap < best) { best = gap; junctionRow = row; }
  }
  // Where they touch over several rows, the middle of that stretch.
  if (touching.length) junctionRow = touching[Math.floor(touching.length / 2)];
  return {
    stem: [(sl - x0) / h, (sr + 1 - x0) / h],
    junction: (y1 + 1 - junctionRow) / h,
    aspect: (x1 - x0 + 1) / h,
    baseline: (y1 + 1 - baselinePx) / h,
    inside: (nx, ny) => ink(Math.floor(x0 + nx * h), Math.floor(y1 + 1 - ny * h)),
    outlines,
  };
}

/** Moore-neighbour contour tracing from a boundary pixel (one whose left neighbour is empty). */
function trace(sx: number, sy: number, ink: (x: number, y: number) => boolean): [number, number][] {
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const loop: [number, number][] = [[sx, sy]];
  let cx = sx, cy = sy;
  let back = 0; // we came in from the left (west)
  for (let guard = 0; guard < 20000; guard++) {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (ink(nx, ny)) {
        back = (d + 4) % 8;
        cx = nx; cy = ny;
        found = true;
        break;
      }
    }
    if (!found || (cx === sx && cy === sy)) break;
    loop.push([cx, cy]);
  }
  return loop;
}

/** Ramer–Douglas–Peucker on a closed loop. */
function simplify(points: [number, number][], epsilon: number): [number, number][] {
  const rdp = (pts: [number, number][]): [number, number][] => {
    if (pts.length < 3) return pts;
    const [ax, ay] = pts[0];
    const [bx, by] = pts[pts.length - 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = 0;
    let index = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i];
      const dist = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / len;
      if (dist > worst) { worst = dist; index = i; }
    }
    if (worst <= epsilon) return [pts[0], pts[pts.length - 1]];
    return [...rdp(pts.slice(0, index + 1)).slice(0, -1), ...rdp(pts.slice(index))];
  };
  const half = Math.floor(points.length / 2);
  return [...rdp(points.slice(0, half + 1)).slice(0, -1), ...rdp([...points.slice(half), points[0]]).slice(0, -1)];
}
