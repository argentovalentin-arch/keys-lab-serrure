/**
 * The badges' holograms (« l'épure lumineuse »): one per badge, its own explanatory diagram
 * of what the badge says, projected over it while it is the one in focus (terrain.ts,
 * `focus`).
 *
 * They are drawn as vector line work on a canvas, in the page, inside the badge's own card
 * (epilogue.ts): the badge, its words and its diagram form one composition, never two frames
 * side by side, and the line work stays sharp at any size. The card's projection line
 * (projection.ts) runs from the point in the scene up to it.
 *
 * Each is a diagram as a consultant draws it on a board to explain the idea: a radar of the
 * situation, a pipeline and its bottleneck, a positioning map, an impact and effort matrix,
 * a journey, a roadmap… with a few words (Archivo capitals, as the brand's labels) naming
 * its parts, so it can be understood before the badge's own words are read. No figure, no
 * fake result: mechanisms and relations.
 *
 * Every diagram follows the same grammar:
 * - its base, the brand's graduated rule, draws out from the middle first: the plate it is
 *   projected from;
 * - the diagram builds in order (its frame, its parts, their names), over its own time;
 * - then it runs its one movement, which is what it explains, slowly enough to be followed.
 * Champagne for what acts, off-white for what holds; one line weight, one glow.
 */

export type Illustration =
  | 'scan' | 'block' | 'flow' | 'target' | 'priorities' | 'journey' | 'roadmap'
  | 'content' | 'social' | 'influence' | 'funnel' | 'loop';

/** Logical size of a hologram (CSS pixels on a computer; smaller on a phone, same drawing). */
export const HOLO = { width: 260, height: 172 };
/** When the drawing starts, after its badge has come in (seconds from the badge's start). */
export const HOLO_DELAY = 0.6;
/** How long each diagram takes to build: the more it has to say, the longer. */
export const HOLO_BUILD: Record<Illustration, number> = {
  scan: 1.6, block: 1.4, flow: 1.3, target: 1.5, priorities: 1.7, journey: 1.5, roadmap: 1.6,
  content: 1.4, social: 1.5, influence: 1.4, funnel: 1.4, loop: 1.4,
};

const CHAMPAGNE = '233, 215, 180';
const CREAM = '253, 251, 245';
const W = HOLO.width;
const H = HOLO.height;
const BASE_Y = H - 9;
const TAU = Math.PI * 2;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const fract = (v: number) => v - Math.floor(v);
/** 0..1 over [a, z] of the build. */
const phase = (b: number, a: number, z: number) => ease((b - a) / (z - a));
const bump = (d: number, width: number) => Math.exp(-((d / width) ** 2));

type Pt = [number, number];

/** Line style: champagne (acting) or cream (holding), with its glow. */
function pen(ctx: CanvasRenderingContext2D, alpha: number, warm = false, width = 1.35) {
  const rgb = warm ? CHAMPAGNE : CREAM;
  const a = Math.min(1, alpha * 1.15);
  ctx.strokeStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
  ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
  ctx.shadowColor = `rgba(${CHAMPAGNE}, ${(a * 0.8).toFixed(3)})`;
  ctx.shadowBlur = warm ? 7 : 3;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}
/** A faint fill (champagne), for an area. */
function wash(ctx: CanvasRenderingContext2D, alpha: number) {
  ctx.fillStyle = `rgba(${CHAMPAGNE}, ${alpha.toFixed(3)})`;
  ctx.shadowBlur = 0;
}

/** A polyline drawn up to `progress` (0..1) of its length. */
function polyline(ctx: CanvasRenderingContext2D, pts: Pt[], progress = 1, close = false) {
  if (progress <= 0 || pts.length < 2) return;
  const all = close ? [...pts, pts[0]] : pts;
  let total = 0;
  for (let i = 1; i < all.length; i++) total += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
  let left = total * clamp01(progress);
  ctx.beginPath();
  ctx.moveTo(all[0][0], all[0][1]);
  for (let i = 1; i < all.length && left > 0; i++) {
    const seg = Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
    const t = Math.min(1, left / seg);
    ctx.lineTo(all[i - 1][0] + (all[i][0] - all[i - 1][0]) * t, all[i - 1][1] + (all[i][1] - all[i - 1][1]) * t);
    left -= seg;
  }
  ctx.stroke();
}
/** The point at `u` (0..1) along a polyline. */
function along(pts: Pt[], u: number): Pt {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lengths.push(l);
    total += l;
  }
  let left = total * clamp01(u);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = left / Math.max(lengths[i], 1e-6);
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    left -= lengths[i];
  }
  return pts[pts.length - 1];
}
const sample = (n: number, f: (u: number) => Pt): Pt[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const line = (ctx: CanvasRenderingContext2D, a: Pt, z: Pt, progress = 1) => polyline(ctx, [a, z], progress);

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, progress = 1) {
  if (progress <= 0) return;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(progress));
  ctx.stroke();
}
function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, progress = 1) {
  if (progress <= 0) return;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI + TAU * clamp01(progress));
  ctx.stroke();
}
/** A box drawn round from its top left. */
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, progress = 1) {
  polyline(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], progress, true);
}
/** The brand's square mark. */
function square(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, filled: boolean) {
  if (filled) ctx.fillRect(x - size / 2, y - size / 2, size, size);
  else ctx.strokeRect(x - size / 2, y - size / 2, size, size);
}
/** An arrowhead at `p`, pointing along `angle`. */
function arrow(ctx: CanvasRenderingContext2D, p: Pt, angle: number, size = 5) {
  polyline(ctx, [
    [p[0] - Math.cos(angle - 0.5) * size, p[1] - Math.sin(angle - 0.5) * size], p,
    [p[0] - Math.cos(angle + 0.5) * size, p[1] - Math.sin(angle + 0.5) * size],
  ]);
}
/** A few words naming a part: the brand's label (Archivo capitals, spaced). */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number, align: CanvasTextAlign = 'center', warm = false) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.shadowColor = 'rgba(5, 9, 17, 0.95)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = `rgba(${warm ? CHAMPAGNE : CREAM}, ${Math.min(1, alpha).toFixed(3)})`;
  ctx.font = "500 8px 'Archivo', 'Helvetica Neue', Arial, sans-serif";
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.9px';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}
/** A numeral set as on the brand's site (Bodoni), small. */
function numeral(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number, warm = true) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(${warm ? CHAMPAGNE : CREAM}, ${Math.min(1, alpha).toFixed(3)})`;
  ctx.font = "500 11px 'Bodoni Moda', Didot, serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** The base every hologram stands on: a graduated rule, drawn out from its middle. */
function base(ctx: CanvasRenderingContext2D, t: number) {
  const open = ease(t / 0.4);
  if (open <= 0) return;
  const half = 112 * open;
  pen(ctx, 0.5);
  line(ctx, [W / 2 - half, BASE_Y], [W / 2 + half, BASE_Y]);
  for (let i = -8; i <= 8; i++) {
    const x = W / 2 + i * 14;
    if (Math.abs(x - W / 2) > half) continue;
    const major = i % 4 === 0;
    pen(ctx, major ? 0.6 : 0.32);
    line(ctx, [x, BASE_Y], [x, BASE_Y + (major ? 5 : 3)]);
  }
}

/** Small pictograms drawn in line, for the diagrams' parts. */
const glyph = {
  eye(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.quadraticCurveTo(x, y - s * 0.8, x + s, y);
    ctx.quadraticCurveTo(x, y + s * 0.8, x - s, y);
    ctx.stroke();
    ring(ctx, x, y, s * 0.32);
  },
  search(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ring(ctx, x - s * 0.15, y - s * 0.15, s * 0.55);
    line(ctx, [x + s * 0.25, y + s * 0.25], [x + s * 0.75, y + s * 0.75]);
  },
  bag(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    box(ctx, x - s * 0.7, y - s * 0.3, s * 1.4, s * 1.1);
    ctx.beginPath();
    ctx.arc(x, y - s * 0.3, s * 0.4, Math.PI, 0);
    ctx.stroke();
  },
  loop(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.7, -2.6, 2.2);
    ctx.stroke();
    const end: Pt = [x + Math.cos(2.2) * s * 0.7, y + Math.sin(2.2) * s * 0.7];
    arrow(ctx, end, 2.2 + Math.PI / 2, s * 0.45);
  },
  mail(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    box(ctx, x - s, y - s * 0.65, s * 2, s * 1.3);
    polyline(ctx, [[x - s, y - s * 0.65], [x, y + s * 0.1], [x + s, y - s * 0.65]]);
  },
  person(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ring(ctx, x, y - s * 0.45, s * 0.38);
    ctx.beginPath();
    ctx.arc(x, y + s * 0.75, s * 0.75, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  },
  play(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    polyline(ctx, [[x - s * 0.4, y - s * 0.55], [x + s * 0.55, y], [x - s * 0.4, y + s * 0.55]], 1, true);
  },
  check(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, progress = 1) {
    polyline(ctx, [[x - s * 0.55, y], [x - s * 0.15, y + s * 0.4], [x + s * 0.6, y - s * 0.45]], progress);
  },
};

/** Each diagram: `b` is its build (0..1), `T` a running clock (seconds) for its movement. */
const DRAWINGS: Record<Illustration, (ctx: CanvasRenderingContext2D, b: number, T: number) => void> = {
  // « Votre situation »: a radar of the business, five dimensions; a sweep goes round reading
  // each; the shape of the situation draws in (strong here, weak there); the reticle settles
  // on the weakest one: where to look first.
  scan(ctx, b, T) {
    const cx = W / 2;
    const cy = 82;
    const R = 50;
    const names = ['MARCHÉ', 'OFFRE', 'CLIENTS', 'CANAUX', 'ÉQUIPE'];
    const values = [0.8, 0.58, 0.86, 0.4, 0.66];
    const angleOf = (k: number) => -Math.PI / 2 + (k / 5) * TAU;
    const at = (k: number, r: number): Pt => [cx + Math.cos(angleOf(k)) * r, cy + Math.sin(angleOf(k)) * r];
    [1 / 3, 2 / 3, 1].forEach((f, j) => {
      pen(ctx, 0.22 + j * 0.08);
      polyline(ctx, [0, 1, 2, 3, 4].map((k) => at(k, R * f)), phase(b, j * 0.08, 0.3 + j * 0.08), true);
    });
    names.forEach((name, k) => {
      const shown = phase(b, 0.2 + k * 0.04, 0.42 + k * 0.04);
      pen(ctx, 0.35 * shown);
      line(ctx, [cx, cy], at(k, R), shown);
      const [lx, ly] = at(k, R + 14);
      label(ctx, name, lx, ly, shown * 0.85, Math.abs(lx - cx) < 4 ? 'center' : lx < cx ? 'right' : 'left');
    });
    // The situation's shape, traced point by point.
    const draw = phase(b, 0.5, 1);
    const shape = values.map((v, k) => at(k, R * v));
    if (draw > 0) {
      ctx.beginPath();
      shape.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      wash(ctx, 0.1 * draw);
      ctx.fill();
      pen(ctx, 0.9, true, 1.6);
      polyline(ctx, shape, draw, true);
    }
    // The sweep, reading the dimensions one after another.
    if (b >= 1) {
      const sweep = fract(T / 4.5);
      const angle = -Math.PI / 2 + sweep * TAU;
      pen(ctx, 0.55, true, 1);
      line(ctx, [cx, cy], [cx + Math.cos(angle) * (R + 4), cy + Math.sin(angle) * (R + 4)]);
      shape.forEach(([x, y], k) => {
        const passed = bump(fract(sweep - k / 5 + 0.5) - 0.5, 0.06);
        pen(ctx, 0.7 + passed * 0.3, true);
        dot(ctx, x, y, 2 + passed * 1.6);
      });
      // The weakest: where to look first.
      const [wx, wy] = shape[3];
      const pulse = 0.6 + 0.4 * Math.sin(T * 3);
      pen(ctx, pulse, true);
      ring(ctx, wx, wy, 8);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) line(ctx, [wx + dx * 10, wy + dy * 10], [wx + dx * 14, wy + dy * 14]);
    }
  },
  // « Ce qui bloque »: the way from a visit to a sale, in four stages; the flow runs into a
  // bottleneck between two of them and piles up there; past it, little gets through.
  block(ctx, b, T) {
    const stages = ['VISITE', 'INTÉRÊT', 'CONTACT', 'VENTE'];
    const xs = [34, 98, 162, 226];
    const y = 96;
    const neck = 130;
    stages.forEach((name, k) => {
      const shown = phase(b, k * 0.1, 0.3 + k * 0.1);
      const after = k >= 2;
      pen(ctx, (after ? 0.4 : 0.75) * shown);
      box(ctx, xs[k] - 22, y - 13, 44, 26, shown);
      label(ctx, name, xs[k], y + 25, shown * (after ? 0.55 : 0.9));
    });
    // The pipe between them, narrowing to a bottleneck.
    const pipe = phase(b, 0.35, 0.65);
    pen(ctx, 0.45 * pipe);
    line(ctx, [56, y - 6], [76, y - 6], pipe);
    line(ctx, [56, y + 6], [76, y + 6], pipe);
    polyline(ctx, [[120, y - 9], [neck - 2, y - 2], [140, y - 2]], pipe);
    polyline(ctx, [[120, y + 9], [neck - 2, y + 2], [140, y + 2]], pipe);
    line(ctx, [184, y - 4], [204, y - 4], pipe);
    line(ctx, [184, y + 4], [204, y + 4], pipe);
    if (b < 0.6) return;
    const flow = phase(b, 0.6, 1);
    // The flow: plenty up to the neck, piling up before it; a trickle past.
    for (let j = 0; j < 26; j++) {
      const u = fract(T * 0.16 + j / 26);
      const lane = (fract(j * 0.618) - 0.5) * 14;
      let x = 16 + u * 230;
      let a = 0.85;
      let warm = false;
      if (x > neck - 22 && j % 5 !== 0) {
        // Held up: they bunch before the neck.
        x = neck - 22 + (x - (neck - 22)) * 0.06;
        warm = true;
      }
      if (x > neck && j % 5 === 0) a = 0.6;
      const yy = y + lane * (x > neck - 10 ? 0.15 : 1);
      pen(ctx, a * flow, warm);
      dot(ctx, x, yy, 1.5);
    }
    // The bottleneck, marked.
    const alert = 0.6 + 0.4 * Math.sin(T * 3.2);
    pen(ctx, alert * flow, true, 1.6);
    line(ctx, [neck, y - 18], [neck, y + 18]);
    polyline(ctx, [[neck, y - 40], [neck - 8, y - 26], [neck + 8, y - 26]], flow, true);
    line(ctx, [neck, y - 36], [neck, y - 31], flow);
    label(ctx, 'GOULOT', neck, y - 48, flow, 'center', true);
  },
  // « Ce qui fonctionne »: the cycle that already turns, attract, convert, keep; pulses go
  // round it without stopping, and each stage is ticked as it is passed; at its heart, the
  // mechanism turning.
  flow(ctx, b, T) {
    const cx = W / 2;
    const cy = 78;
    const R = 46;
    const names = ['ATTIRER', 'CONVERTIR', 'FIDÉLISER'];
    const angleOf = (k: number) => -Math.PI / 2 + (k / 3) * TAU;
    const node = (k: number): Pt => [cx + Math.cos(angleOf(k)) * R, cy + Math.sin(angleOf(k)) * R];
    // The cycle's arcs, with their arrows.
    for (let k = 0; k < 3; k++) {
      const shown = phase(b, k * 0.12, 0.35 + k * 0.12);
      const a0 = angleOf(k) + 0.32;
      const a1 = angleOf(k + 1) - 0.32;
      const arc = sample(24, (u) => [cx + Math.cos(a0 + (a1 - a0) * u) * R, cy + Math.sin(a0 + (a1 - a0) * u) * R]);
      pen(ctx, 0.55 * shown);
      polyline(ctx, arc, shown);
      if (shown >= 1) arrow(ctx, arc[arc.length - 1], a1 + Math.PI / 2, 5);
    }
    const cycle = b >= 1 ? fract(T / 4) : -1;
    names.forEach((name, k) => {
      const shown = phase(b, 0.3 + k * 0.1, 0.55 + k * 0.1);
      const [x, y] = node(k);
      const passed = cycle >= 0 ? bump(fract(cycle - k / 3 + 0.5) - 0.5, 0.07) : 0;
      pen(ctx, (0.65 + passed * 0.35) * shown, passed > 0.2);
      ring(ctx, x, y, 11, shown);
      glyph.check(ctx, x, y, 8, phase(b, 0.6 + k * 0.1, 0.8 + k * 0.1));
      const below = y > cy;
      label(ctx, name, x, y + (below ? 21 : -21), shown * 0.9);
    });
    // The heart: a gear turning.
    const gear = phase(b, 0.5, 0.8);
    if (gear > 0) {
      const turn = T * 0.6;
      pen(ctx, 0.6 * gear);
      ring(ctx, cx, cy, 9, gear);
      for (let k = 0; k < 8; k++) {
        const a = turn + (k / 8) * TAU;
        line(ctx, [cx + Math.cos(a) * 9, cy + Math.sin(a) * 9], [cx + Math.cos(a) * 13, cy + Math.sin(a) * 13], gear);
      }
      dot(ctx, cx, cy, 2);
    }
    if (cycle >= 0) {
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + fract(cycle + k / 3) * TAU;
        pen(ctx, 1, true);
        dot(ctx, cx + Math.cos(a) * R, cy + Math.sin(a) * R, 2.6);
      }
    }
  },
  // « Positionnement »: the market as a map, two axes; the competitors gathered where they
  // all are; the brand moves out to a place of its own, free, and is set there.
  target(ctx, b, T) {
    const cx = W / 2;
    const cy = 80;
    const ax = 96;
    const ay = 54;
    const axes = phase(b, 0, 0.35);
    pen(ctx, 0.5 * axes);
    line(ctx, [cx - ax, cy], [cx + ax, cy], axes);
    line(ctx, [cx, cy + ay], [cx, cy - ay], axes);
    arrow(ctx, [cx + ax, cy], 0, 5 * axes);
    arrow(ctx, [cx, cy - ay], -Math.PI / 2, 5 * axes);
    const names = phase(b, 0.2, 0.45);
    label(ctx, 'ACCESSIBLE', cx - ax, cy - 8, names * 0.8, 'left');
    label(ctx, 'PREMIUM', cx + ax, cy + 9, names * 0.8, 'right');
    label(ctx, 'EXPERT', cx - 6, cy - ay + 3, names * 0.8, 'right');
    label(ctx, 'GÉNÉRALISTE', cx + 6, cy + ay - 3, names * 0.8, 'left');
    // The competitors, crowded together.
    const others: Pt[] = [[-46, 16], [-30, 26], [-60, 30], [-20, 12], [-42, 36], [24, 28], [36, 18]];
    others.forEach(([dx, dy], k) => {
      const shown = phase(b, 0.3 + k * 0.04, 0.45 + k * 0.04);
      pen(ctx, 0.55 * shown);
      ring(ctx, cx + dx, cy + dy, 3.5, shown);
    });
    // Named once, beside the crowd, with a hairline to it.
    const named = phase(b, 0.5, 0.7);
    pen(ctx, 0.35 * named, false, 1);
    line(ctx, [cx - 78, cy + 44], [cx - 64, cy + 34], named);
    label(ctx, 'CONCURRENTS', cx - 96, cy + 51, named * 0.75, 'left');
    label(ctx, 'CONCURRENTS', cx - 40, cy + 34 + 12, 0);
    // The brand: from among them, out to a free place, high and to the right.
    const move = phase(b, 0.55, 1);
    const from: Pt = [cx - 28, cy + 24];
    const to: Pt = [cx + 52, cy - 30];
    const bend: Pt = [cx + 10, cy + 10];
    const path = sample(20, (u) => {
      const v = 1 - u;
      return [v * v * from[0] + 2 * v * u * bend[0] + u * u * to[0], v * v * from[1] + 2 * v * u * bend[1] + u * u * to[1]];
    });
    if (move > 0) {
      pen(ctx, 0.45, true, 1);
      ctx.setLineDash([2, 3]);
      polyline(ctx, path, move);
      ctx.setLineDash([]);
      const p = along(path, move);
      pen(ctx, 1, true);
      square(ctx, p[0], p[1], 7, true);
    }
    if (b >= 1) {
      const wave = fract(T / 2.8);
      pen(ctx, 0.75 * (1 - wave), true);
      ring(ctx, to[0], to[1], 6 + wave * 14);
      pen(ctx, 0.9, true);
      ring(ctx, to[0], to[1], 9);
      label(ctx, 'VOTRE PLACE', to[0], to[1] - 17, 1, 'center', true);
    }
  },
  // « Priorités »: every action set on an impact and effort matrix; those with most impact
  // for least effort come out on top, numbered as on the site: the order of work.
  priorities(ctx, b, T) {
    const x0 = 34;
    const y0 = 18;
    const size = 120;
    const grid = phase(b, 0, 0.3);
    pen(ctx, 0.5 * grid);
    line(ctx, [x0, y0 + size], [x0 + size, y0 + size], grid);
    line(ctx, [x0, y0 + size], [x0, y0], grid);
    pen(ctx, 0.25 * grid);
    line(ctx, [x0 + size / 2, y0], [x0 + size / 2, y0 + size], grid);
    line(ctx, [x0, y0 + size / 2], [x0 + size, y0 + size / 2], grid);
    const names = phase(b, 0.15, 0.4);
    label(ctx, 'EFFORT', x0 + size, y0 + size + 9, names * 0.8, 'right');
    ctx.save();
    ctx.translate(x0 - 9, y0 + 4);
    ctx.rotate(-Math.PI / 2);
    label(ctx, 'IMPACT', 0, 0, names * 0.8, 'right');
    ctx.restore();
    // The quadrant that matters: much impact, little effort.
    const zone = phase(b, 0.35, 0.55);
    wash(ctx, 0.12 * zone);
    ctx.fillRect(x0 + 1, y0, size / 2 - 1, size / 2);
    label(ctx, 'PRIORITÉ', x0 + size / 4, y0 - 8, zone, 'center', true);
    // The actions: placed where they belong (from scattered to set).
    const items: [number, number, number][] = [
      [0.2, 0.25, 1], [0.32, 0.4, 2], [0.4, 0.15, 3], [0.7, 0.3, 0], [0.62, 0.72, 0], [0.25, 0.75, 0], [0.82, 0.6, 0],
    ];
    const place = phase(b, 0.4, 0.8);
    items.forEach(([ex, ey, rank], k) => {
      const sx = fract(k * 0.37 + 0.2);
      const sy = fract(k * 0.61 + 0.1);
      const x = x0 + (sx + (ex - sx) * place) * size;
      const y = y0 + (sy + (ey - sy) * place) * size;
      const chosen = rank > 0 && place >= 1;
      pen(ctx, chosen ? 1 : 0.55, chosen);
      dot(ctx, x, y, chosen ? 3.2 : 2.4);
      if (chosen) numeral(ctx, `0${rank}`, x + 9, y - 6, 1);
    });
    // And the order of work, beside it.
    const list = phase(b, 0.75, 1);
    [1, 2, 3].forEach((rank, k) => {
      const y = 40 + k * 26;
      numeral(ctx, `0${rank}`, 178, y, list * (k === 0 ? 1 : 0.75));
      pen(ctx, (k === 0 ? 0.9 : 0.55) * list, k === 0, k === 0 ? 2 : 1.35);
      line(ctx, [192, y], [192 + (56 - k * 12), y], list);
    });
    if (b >= 1) {
      const u = fract(T / 3.4);
      pen(ctx, 0.9 * Math.sin(u * Math.PI), true);
      dot(ctx, 192 + u * 56, 40, 2.2);
    }
  },
  // « Parcours »: the customer's way, from discovering to coming back: four moments, each
  // drawn; someone goes along it, each moment lighting as they reach it; and the way back.
  journey(ctx, b, T) {
    const stations: [string, Pt, keyof typeof glyph][] = [
      ['DÉCOUVRIR', [34, 92], 'eye'], ['COMPARER', [98, 66], 'search'], ['ACHETER', [162, 80], 'bag'], ['REVENIR', [226, 54], 'loop'],
    ];
    const path = sample(80, (u) => {
      const k = Math.min(2, Math.floor(u * 3));
      const t = u * 3 - k;
      const a = stations[k][1];
      const z = stations[k + 1][1];
      const e = t * t * (3 - 2 * t);
      return [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * e];
    });
    pen(ctx, 0.6);
    polyline(ctx, path, phase(b, 0.05, 0.6));
    // The way back, from the last moment to the first.
    const back = phase(b, 0.6, 0.85);
    pen(ctx, 0.3 * back);
    ctx.setLineDash([2, 4]);
    const loop = sample(30, (u) => [226 - u * 192, 54 + Math.sin(u * Math.PI) * 70 + u * 38]);
    polyline(ctx, loop, back);
    ctx.setLineDash([]);
    const travel = b >= 1 ? fract(T / 5) : -1;
    stations.forEach(([name, [x, y], g], k) => {
      const shown = phase(b, 0.15 + k * 0.12, 0.4 + k * 0.12);
      const reached = travel >= k / 3 - 0.01;
      pen(ctx, (reached ? 0.95 : 0.55) * shown, reached);
      ring(ctx, x, y, 12, shown);
      if (shown > 0.5) glyph[g](ctx, x, y, 6.5);
      label(ctx, name, x, y + 22, shown * 0.9);
    });
    if (travel >= 0) {
      const p = along(path, travel);
      pen(ctx, 1, true);
      dot(ctx, p[0], p[1], 3);
    }
  },
  // « Feuille de route »: the plan over time, in the brand's three stages: each starts in
  // turn and overlaps the next, its milestone at its end; « now » moves along, and what is
  // behind it is done.
  roadmap(ctx, b, T) {
    const x0 = 78;
    const x1 = 240;
    const rows: [string, number, number][] = [['STRUCTURER', 0, 0.45], ['ACTIVER', 0.3, 0.78], ['PERFORMER', 0.6, 1]];
    const head = phase(b, 0, 0.3);
    pen(ctx, 0.35 * head);
    line(ctx, [x0, 22], [x1, 22], head);
    ['M1', 'M2', 'M3', 'M4'].forEach((m, k) => {
      const x = x0 + ((k + 0.5) / 4) * (x1 - x0);
      label(ctx, m, x, 14, head * 0.65);
      pen(ctx, 0.2 * head);
      line(ctx, [x0 + (k / 4) * (x1 - x0), 22], [x0 + (k / 4) * (x1 - x0), 128], head);
    });
    const now = b >= 1 ? 0.04 + fract(T / 8) * 0.94 : 0;
    rows.forEach(([name, from, to], k) => {
      const y = 44 + k * 32;
      const shown = phase(b, 0.25 + k * 0.15, 0.55 + k * 0.15);
      label(ctx, name, x0 - 8, y, shown * 0.9, 'right', k === 0);
      const a = x0 + from * (x1 - x0);
      const z = x0 + to * (x1 - x0);
      pen(ctx, 0.55 * shown);
      box(ctx, a, y - 6, (z - a) * shown, 12);
      const done = clamp01((now - from) / (to - from));
      if (done > 0) {
        wash(ctx, 0.55);
        ctx.fillRect(a + 2, y - 4, Math.max(0, (z - a - 4) * done), 8);
      }
      pen(ctx, (done >= 1 ? 1 : 0.6) * shown, true);
      ctx.save();
      ctx.translate(z, y);
      ctx.rotate(Math.PI / 4);
      square(ctx, 0, 0, 7, done >= 1);
      ctx.restore();
      if (k > 0) {
        // Each stage starts from what the one before has laid.
        const prev = x0 + rows[k - 1][1] * (x1 - x0) + 12;
        pen(ctx, 0.3 * shown);
        ctx.setLineDash([2, 3]);
        polyline(ctx, [[prev, y - 26], [prev, y], [a, y]], shown);
        ctx.setLineDash([]);
      }
    });
    if (b >= 1) {
      const x = x0 + now * (x1 - x0);
      pen(ctx, 0.9, true, 1.2);
      line(ctx, [x, 26], [x, 134]);
      label(ctx, 'AUJOURD’HUI', x, 142, 0.85, 'center', true);
    }
  },
  // « Contenu »: the brand at the centre of what it publishes: articles, videos, posts, each
  // made in turn and sent out to the people it reaches.
  content(ctx, b, T) {
    const hub: Pt = [44, 80];
    const cards: [string, number, keyof typeof glyph | null][] = [['ARTICLE', 34, null], ['VIDÉO', 80, 'play'], ['POST', 126, null]];
    const hubShown = phase(b, 0, 0.25);
    pen(ctx, 0.85 * hubShown, true);
    square(ctx, hub[0], hub[1], 18, false);
    numeral(ctx, 'k.', hub[0], hub[1], hubShown);
    label(ctx, 'MARQUE', hub[0], hub[1] + 20, hubShown * 0.85);
    const active = b >= 1 ? Math.floor(T / 1.6) % 3 : -1;
    const sent = b >= 1 ? fract(T / 1.6) : 0;
    cards.forEach(([name, y, g], k) => {
      const shown = phase(b, 0.2 + k * 0.12, 0.45 + k * 0.12);
      const on = k === active;
      const x = 112;
      pen(ctx, 0.45 * shown);
      line(ctx, [hub[0] + 9, hub[1]], [x - 24, y], shown);
      pen(ctx, (on ? 1 : 0.6) * shown, on);
      box(ctx, x - 22, y - 14, 44, 28, shown);
      // Its inside: an article's lines, a video's frame, a post's picture.
      if (shown > 0.6) {
        pen(ctx, (on ? 0.85 : 0.4) * shown, on, 1);
        if (k === 0) [0, 1, 2].forEach((r) => line(ctx, [x - 15, y - 7 + r * 7], [x + (r === 2 ? 4 : 15), y - 7 + r * 7]));
        if (g === 'play') glyph.play(ctx, x, y, 9);
        if (k === 2) {
          box(ctx, x - 15, y - 9, 14, 14);
          line(ctx, [x + 4, y - 5], [x + 15, y - 5]);
          line(ctx, [x + 4, y + 1], [x + 12, y + 1]);
        }
      }
      label(ctx, name, x + 30, y, shown * 0.85, 'left');
    });
    // The audience, reached by what is sent out.
    const crowd: Pt[] = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) crowd.push([196 + c * 14 + (r % 2) * 7, 46 + r * 18]);
    const crowdShown = phase(b, 0.6, 0.9);
    crowd.forEach(([x, y], k) => {
      const lit = active >= 0 && (k + active * 5) % 3 === 0 && sent > 0.6;
      pen(ctx, (lit ? 1 : 0.45) * crowdShown, lit);
      dot(ctx, x, y, lit ? 2.6 : 1.8);
    });
    label(ctx, 'AUDIENCE', 220, 128, crowdShown * 0.8);
    if (active >= 0) {
      const from: Pt = [168, cards[active][1]];
      const to: Pt = [196, 74];
      const p: Pt = [from[0] + (to[0] - from[0]) * Math.min(1, sent * 1.6), from[1] + (to[1] - from[1]) * Math.min(1, sent * 1.6)];
      pen(ctx, 0.9 * (1 - Math.max(0, sent - 0.62) / 0.38), true);
      dot(ctx, p[0], p[1], 2.4);
    }
  },
  // « Social media »: an account at the centre of its community; a post goes out to the
  // followers, ring after ring, they react, and their shares carry it further.
  social(ctx, b, T) {
    const cx = W / 2;
    const cy = 78;
    const inner = Array.from({ length: 6 }, (_, k): Pt => [cx + Math.cos((k / 6) * TAU) * 40, cy + Math.sin((k / 6) * TAU) * 28]);
    const outer = Array.from({ length: 12 }, (_, k): Pt => [cx + Math.cos((k / 12) * TAU + 0.26) * 80, cy + Math.sin((k / 12) * TAU + 0.26) * 50]);
    const hub = phase(b, 0, 0.25);
    pen(ctx, 0.95 * hub, true);
    ring(ctx, cx, cy, 11, hub);
    glyph.person(ctx, cx, cy + 1, 8 * hub);
    const wave = b >= 1 ? fract(T / 4) : -1;
    inner.forEach(([x, y], k) => {
      const shown = phase(b, 0.2 + k * 0.03, 0.42 + k * 0.03);
      const reached = wave >= 0 && wave > 0.15 && wave < 0.85;
      pen(ctx, 0.35 * shown);
      line(ctx, [cx + (x - cx) * 0.35, cy + (y - cy) * 0.35], [x, y], shown);
      pen(ctx, (reached ? 0.95 : 0.6) * shown, reached);
      ring(ctx, x, y, 5, shown);
      if (reached && wave > 0.3) {
        // A reaction: a small mark rising off the follower.
        const up = (wave - 0.3) * 30;
        pen(ctx, Math.max(0, 1 - (wave - 0.3) * 2), true, 1);
        line(ctx, [x + 4, y - 6 - up], [x + 8, y - 6 - up]);
        line(ctx, [x + 6, y - 8 - up], [x + 6, y - 4 - up]);
      }
      // Two shares from each of them, out to the outer ring.
      [2 * k, 2 * k + 1].forEach((j) => {
        const [ox, oy] = outer[j];
        const s = phase(b, 0.45 + k * 0.03, 0.7 + k * 0.03);
        const shared = wave >= 0.45 && wave < 0.95;
        pen(ctx, (shared ? 0.55 : 0.2) * s, shared);
        line(ctx, [x, y], [ox, oy], s);
        pen(ctx, (shared && wave > 0.6 ? 0.9 : 0.45) * s, shared && wave > 0.6);
        dot(ctx, ox, oy, 2);
      });
    });
    // The post itself, travelling out.
    if (wave >= 0) {
      const r = wave < 0.45 ? (wave / 0.45) * 34 : 34 + ((wave - 0.45) / 0.55) * 30;
      pen(ctx, 0.7 * (1 - wave), true);
      ellipse(ctx, cx, cy, r, r * 0.74);
    }
    // Named outside the network, each with a hairline to what it names.
    const names = phase(b, 0.6, 0.9);
    pen(ctx, 0.35 * names, false, 1);
    line(ctx, [44, 20], [cx - 9, cy - 8], names);
    line(ctx, [216, 20], inner[5], names);
    line(ctx, [216, 140], outer[1], names);
    label(ctx, 'PUBLICATION', 12, 14, names * 0.9, 'left', true);
    label(ctx, 'ABONNÉS', 248, 14, names * 0.85, 'right');
    label(ctx, 'PARTAGES', 248, 146, names * 0.85, 'right');
  },
  // « Influence »: the brand speaks through creators: its message goes to each, and each
  // carries it to their own audience, which the brand would not reach on its own.
  influence(ctx, b, T) {
    const brand: Pt = [30, 76];
    const creators: Pt[] = [[112, 36], [112, 76], [112, 116]];
    const crowds: Pt[][] = creators.map(([, y]) => Array.from({ length: 6 }, (_, k): Pt => [196 + (k % 3) * 16, y - 8 + Math.floor(k / 3) * 16]));
    const hub = phase(b, 0, 0.25);
    pen(ctx, 0.9 * hub, true);
    square(ctx, brand[0], brand[1], 18, false);
    numeral(ctx, 'k.', brand[0], brand[1], hub);
    label(ctx, 'MARQUE', brand[0], brand[1] + 21, hub * 0.9);
    const cycle = b >= 1 ? fract(T / 4.4) : -1;
    creators.forEach(([x, y], k) => {
      const shown = phase(b, 0.2 + k * 0.1, 0.45 + k * 0.1);
      pen(ctx, 0.45 * shown);
      line(ctx, [brand[0] + 10, brand[1]], [x - 14, y], shown);
      const lit = cycle >= 0 && cycle > 0.25;
      pen(ctx, (lit ? 1 : 0.65) * shown, lit);
      ring(ctx, x, y, 13, shown);
      if (shown > 0.5) {
        glyph.person(ctx, x - 1, y + 1, 7);
        // Their voice: two short arcs going out to the right.
        [5, 9].forEach((r) => {
          ctx.beginPath();
          ctx.arc(x + 4, y - 3, r, -0.6, 0.6);
          ctx.stroke();
        });
      }
      if (lit && cycle < 0.6) {
        // Amplified: a ring opening round the creator.
        const w = (cycle - 0.25) / 0.35;
        pen(ctx, 0.7 * (1 - w), true);
        ring(ctx, x, y, 13 + w * 12);
      }
      crowds[k].forEach(([cx, cy]) => {
        const s = phase(b, 0.5 + k * 0.08, 0.75 + k * 0.08);
        const reached = cycle >= 0.55;
        pen(ctx, 0.2 * s, false, 1);
        line(ctx, [x + 13, y], [cx - 3, cy], s);
        pen(ctx, (reached ? 0.95 : 0.45) * s, reached);
        dot(ctx, cx, cy, reached ? 2.4 : 1.8);
      });
    });
    // The message travelling: brand to creators, creators to their audiences.
    if (cycle >= 0) {
      creators.forEach(([x, y]) => {
        if (cycle < 0.25) {
          const u = cycle / 0.25;
          pen(ctx, 1, true);
          dot(ctx, brand[0] + 10 + (x - 14 - brand[0] - 10) * u, brand[1] + (y - brand[1]) * u, 2.4);
        } else if (cycle > 0.55 && cycle < 0.8) {
          const u = (cycle - 0.55) / 0.25;
          pen(ctx, 1 - u * 0.4, true);
          dot(ctx, x + 13 + (196 - x - 13) * u, y, 2.2);
        }
      });
    }
    const names = phase(b, 0.6, 0.9);
    label(ctx, 'CRÉATEURS', 112, 142, names * 0.85, 'center', true);
    label(ctx, 'AUDIENCES', 212, 142, names * 0.85);
  },
  // « Campagnes Ads »: the funnel from an audience to customers, stage by stage; people
  // come in wide at the top, fewer at each stage, and those who arrive are kept.
  funnel(ctx, b, T) {
    const stages = ['AUDIENCE', 'CLICS', 'LEADS', 'CLIENTS'];
    const top = 18;
    const step = 26;
    const half = (k: number) => 70 - k * 16;
    const cx = 104;
    stages.forEach((name, k) => {
      const shown = phase(b, k * 0.12, 0.3 + k * 0.12);
      const y = top + k * step;
      pen(ctx, (0.45 + k * 0.12) * shown, k === 3);
      polyline(ctx, [[cx - half(k), y], [cx + half(k), y], [cx + half(k + 1), y + step - 3], [cx - half(k + 1), y + step - 3]], shown, true);
      label(ctx, name, cx + half(k) + 10, y + step / 2 - 1, shown * 0.9, 'left', k === 3);
    });
    if (b < 0.55) return;
    const flow = phase(b, 0.55, 0.9);
    for (let j = 0; j < 34; j++) {
      const u = fract(T * 0.2 + j / 34);
      const y = top - 6 + u * (step * 4 + 6);
      const k = Math.min(3, Math.max(0, Math.floor((y - top) / step)));
      // Fewer go on at each stage.
      const goes = j % (k + 1) === 0;
      if (!goes && y > top + step * k + 4) continue;
      const lane = fract(j * 0.618) - 0.5;
      const width = half(k) - ((y - top - k * step) / step) * 16;
      pen(ctx, (0.4 + u * 0.55) * flow, k >= 3);
      dot(ctx, cx + lane * 2 * (width - 6), y, 1.6);
    }
    // The customers gained, kept: stacking up at the foot.
    const kept = b >= 1 ? Math.floor(fract(T / 9) * 12) : 0;
    for (let i = 0; i < 12; i++) {
      const x = cx - 22 + (i % 6) * 9;
      const y = top + step * 4 + 10 + Math.floor(i / 6) * 9;
      pen(ctx, i < kept ? 0.95 : 0.25, i < kept);
      square(ctx, x, y, 5, i < kept);
    }
  },
  // « CRM & fidélisation »: the customer base at the centre; around it the relationship:
  // a purchase, a message, a return; each time a customer comes back, the base grows.
  loop(ctx, b, T) {
    const cx = W / 2;
    const cy = 80;
    const rx = 92;
    const ry = 50;
    const stations: [string, number, keyof typeof glyph][] = [['ACHAT', -Math.PI / 2, 'bag'], ['MESSAGE', Math.PI / 6, 'mail'], ['RETOUR', (5 * Math.PI) / 6, 'loop']];
    const orbit = phase(b, 0, 0.45);
    pen(ctx, 0.45 * orbit);
    ellipse(ctx, cx, cy, rx, ry, orbit);
    const cycle = b >= 1 ? fract(T / 5) : -1;
    stations.forEach(([name, a, g], k) => {
      const shown = phase(b, 0.25 + k * 0.12, 0.5 + k * 0.12);
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      const angleNow = -Math.PI / 2 + cycle * TAU;
      const here = cycle >= 0 ? bump(Math.atan2(Math.sin(angleNow - a), Math.cos(angleNow - a)), 0.35) : 0;
      pen(ctx, (0.6 + here * 0.4) * shown, here > 0.3);
      ring(ctx, x, y, 12, shown);
      if (shown > 0.5) glyph[g](ctx, x, y, 6.5);
      label(ctx, name, x, y + (y > cy ? 21 : -20), shown * 0.9);
    });
    // The base: a cylinder of records, filling as customers come back.
    const db = phase(b, 0.35, 0.65);
    const level = b >= 1 ? 0.3 + 0.6 * fract(T / 15) : 0.3;
    pen(ctx, 0.85 * db, true);
    ellipse(ctx, cx, cy - 16, 18, 5, db);
    line(ctx, [cx - 18, cy - 16], [cx - 18, cy + 16], db);
    line(ctx, [cx + 18, cy - 16], [cx + 18, cy + 16], db);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 16, 18, 5, 0, 0, Math.PI);
    ctx.stroke();
    if (db > 0.5) {
      wash(ctx, 0.35);
      ctx.fillRect(cx - 17, cy + 16 - 30 * level, 34, 30 * level);
      pen(ctx, 0.5);
      [0.33, 0.66].forEach((f) => {
        ctx.beginPath();
        ctx.ellipse(cx, cy + 16 - 32 * f, 18, 5, 0, 0, Math.PI);
        ctx.stroke();
      });
    }
    label(ctx, 'BASE CLIENTS', cx, cy + 32, db * 0.9, 'center', true);
    if (cycle >= 0) {
      const a = -Math.PI / 2 + cycle * TAU;
      pen(ctx, 1, true);
      dot(ctx, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 3);
      // At the message, a letter goes out to them; at the return, they come in to the base.
      const returning = bump(Math.atan2(Math.sin(a - (5 * Math.PI) / 6), Math.cos(a - (5 * Math.PI) / 6)), 0.25);
      if (returning > 0.2) {
        pen(ctx, returning, true, 1);
        ctx.setLineDash([2, 3]);
        line(ctx, [cx + Math.cos((5 * Math.PI) / 6) * rx * 0.85, cy + Math.sin((5 * Math.PI) / 6) * ry * 0.85], [cx - 18, cy]);
        ctx.setLineDash([]);
      }
    }
  },
};

/**
 * Draws a hologram on its canvas. `t`: seconds since its badge came in (it starts at
 * HOLO_DELAY); `T`: a running clock for its movement.
 */
export function drawHologram(ctx: CanvasRenderingContext2D, kind: Illustration, t: number, T: number, pixelRatio: number, scale: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const local = t - HOLO_DELAY;
  if (local <= 0) return;
  ctx.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, 0, 0);
  base(ctx, local);
  const build = clamp01((local - 0.25) / HOLO_BUILD[kind]);
  if (build > 0) DRAWINGS[kind](ctx, build, T);
  ctx.shadowBlur = 0;
}
