/**
 * The badges' holograms (« l'épure lumineuse »): one per badge, its own drawing of what the
 * badge says, projected over it while it is the one in focus (terrain.ts, `focus`).
 *
 * They are drawn as vector line work on a small canvas, in the page, inside the badge's own
 * card (epilogue.ts): the badge, its words and its drawing form one composition, never two
 * frames side by side, and the line work stays sharp at any size. The card's projection
 * line (projection.ts) runs from the point in the scene up to it.
 *
 * Every drawing follows the same grammar:
 * - its base, the brand's graduated rule, draws out from the middle first: the plate it is
 *   projected from;
 * - the drawing builds over its own time (longer for a drawing with more to read);
 * - then it runs its single, slow movement, which is what it explains: a scan passing, a
 *   flow stopped, a point finding its place… It holds still enough to be read.
 * No figure, no fake result: mechanisms, as a consultant draws them on a board. Champagne
 * for what acts, off-white for what holds; one line weight, one glow.
 */

export type Illustration =
  | 'scan' | 'block' | 'flow' | 'target' | 'priorities' | 'journey' | 'roadmap'
  | 'content' | 'funnel' | 'loop';

/** Logical size of a hologram (CSS pixels on a computer; smaller on a phone, same drawing). */
export const HOLO = { width: 200, height: 128 };
/** When the drawing starts, after its badge has come in (seconds from the badge's start). */
export const HOLO_DELAY = 0.75;
/** How long each drawing takes to build: the more it has to say, the longer. */
export const HOLO_BUILD: Record<Illustration, number> = {
  scan: 1.1, block: 1.1, flow: 0.9, target: 1, priorities: 1.4, journey: 1.3, roadmap: 1.3,
  content: 1, funnel: 1, loop: 0.9,
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
/** 0..1 over [a, b] of the build. */
const phase = (b: number, a: number, z: number) => ease((b - a) / (z - a));

type Pt = [number, number];

/** Line style: champagne (acting) or cream (holding), with its glow. */
function pen(ctx: CanvasRenderingContext2D, alpha: number, warm = false, width = 1.4) {
  const rgb = warm ? CHAMPAGNE : CREAM;
  const a = Math.min(1, alpha * 1.15);
  ctx.strokeStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
  ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
  ctx.shadowColor = `rgba(${CHAMPAGNE}, ${(alpha * 0.85).toFixed(3)})`;
  ctx.shadowBlur = warm ? 7 : 4;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** A polyline drawn up to `progress` (0..1) of its length. */
function polyline(ctx: CanvasRenderingContext2D, pts: Pt[], progress = 1) {
  if (progress <= 0 || pts.length < 2) return;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * clamp01(progress);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const t = Math.min(1, left / seg);
    ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t);
    left -= seg;
  }
  ctx.stroke();
}
/** The point at `u` (0..1) along a polyline. */
function along(pts: Pt[], u: number): Pt {
  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lengths.push(l);
    total += l;
  }
  let left = total * clamp01(u);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = left / lengths[i];
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    left -= lengths[i];
  }
  return pts[pts.length - 1];
}
/** Samples of a curve, for polyline. */
const sample = (n: number, f: (u: number) => Pt): Pt[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
/** The brand's square mark. */
function square(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, filled: boolean) {
  if (filled) ctx.fillRect(x - size / 2, y - size / 2, size, size);
  else ctx.strokeRect(x - size / 2, y - size / 2, size, size);
}
/** A numeral set as on the brand's site (Bodoni), small. */
function numeral(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number, warm = true) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(${warm ? CHAMPAGNE : CREAM}, ${alpha.toFixed(3)})`;
  ctx.font = "500 10px 'Bodoni Moda', Didot, serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}
/** A hollow ellipse drawn round up to `progress`, from its left. */
function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, progress = 1) {
  if (progress <= 0) return;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI + TAU * clamp01(progress));
  ctx.stroke();
}

/** The base every hologram stands on: a graduated rule, drawn out from its middle. */
function base(ctx: CanvasRenderingContext2D, t: number) {
  const open = ease(t / 0.4);
  if (open <= 0) return;
  const half = 78 * open;
  pen(ctx, 0.55);
  ctx.beginPath();
  ctx.moveTo(W / 2 - half, BASE_Y);
  ctx.lineTo(W / 2 + half, BASE_Y);
  ctx.stroke();
  for (let i = -6; i <= 6; i++) {
    const x = W / 2 + i * 13;
    if (Math.abs(x - W / 2) > half) continue;
    const major = i % 3 === 0;
    pen(ctx, major ? 0.6 : 0.35);
    ctx.beginPath();
    ctx.moveTo(x, BASE_Y);
    ctx.lineTo(x, BASE_Y + (major ? 5 : 3));
    ctx.stroke();
  }
}

/** Each drawing: `b` is its build (0..1), `T` a running clock (seconds) for its movement. */
const DRAWINGS: Record<Illustration, (ctx: CanvasRenderingContext2D, b: number, T: number) => void> = {
  // « Votre situation »: a field seen in depth, examined row by row by a scan; a reticle
  // settles on one point, which stays marked: what is looked at closely.
  scan(ctx, b, T) {
    const rows = 5;
    const cols = 9;
    const at = (c: number, r: number): Pt => {
      const depth = r / (rows - 1); // 0 near (bottom), 1 far (top)
      const spread = 1 - depth * 0.38;
      return [W / 2 + (c - (cols - 1) / 2) * 17 * spread, 100 - depth * 66 + depth * depth * 8];
    };
    const sweep = b >= 1 ? fract(T / 3.4) : -1;
    const sweepX = 18 + sweep * (W - 36);
    for (let r = 0; r < rows; r++) {
      const shown = phase(b, 0.05 + r * 0.08, 0.3 + r * 0.08);
      for (let c = 0; c < cols; c++) {
        const [x, y] = at(c, r);
        const lit = sweep < 0 ? 0 : Math.exp(-(((x - sweepX) / 9) ** 2));
        pen(ctx, (0.32 + lit * 0.6) * shown, lit > 0.3);
        dot(ctx, x, y, 1.15 + lit * 0.6);
      }
    }
    if (sweep >= 0) {
      pen(ctx, 0.5, true, 1);
      polyline(ctx, [[sweepX, 22], [sweepX, BASE_Y - 4]]);
    }
    // The reticle comes in from the side and settles on its point.
    const settle = phase(b, 0.55, 1);
    if (settle > 0) {
      const target = at(6, 2);
      const x = target[0] + (1 - settle) * 46;
      const y = target[1] - (1 - settle) * 18;
      pen(ctx, 0.85 * settle, true);
      ellipse(ctx, x, y, 11, 11, settle);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        polyline(ctx, [[x + dx * 14, y + dy * 14], [x + dx * 19, y + dy * 19]], settle);
      }
      pen(ctx, settle, true);
      dot(ctx, target[0], target[1], 2.2 * settle);
    }
  },
  // « Ce qui bloque »: three flows; two run through, the middle one runs into a bar and
  // piles up against it, nothing past it.
  block(ctx, b, T) {
    const lanes = [38, 64, 90];
    const bar = 128;
    lanes.forEach((y, k) => {
      const shown = phase(b, 0.05 + k * 0.1, 0.45 + k * 0.1);
      const end = k === 1 ? bar - 4 : 184;
      pen(ctx, 0.22 * shown);
      polyline(ctx, [[16, y], [end, y]], shown);
      if (k === 1) {
        pen(ctx, 0.12 * shown);
        ctx.setLineDash([2, 4]);
        polyline(ctx, [[bar + 6, y], [184, y]], shown);
        ctx.setLineDash([]);
      }
      if (b < 0.6) return;
      // Dashes running along the lane; the middle ones slow and bunch up before the bar.
      for (let j = 0; j < 9; j++) {
        let u = fract(T * 0.18 + j / 9 + k * 0.13);
        let x = 16 + u * 168;
        let a = 0.75;
        if (k === 1) {
          const room = bar - 6 - 16;
          u = 1 - (1 - u) ** 2.4;
          x = 16 + u * room;
          a = 0.6 + u * 0.4;
        }
        pen(ctx, a * phase(b, 0.6, 1), k === 1 && x > bar - 30);
        polyline(ctx, [[x - 6, y], [x, y]]);
      }
    });
    const drop = phase(b, 0.45, 0.8);
    if (drop > 0) {
      const glow = 0.75 + 0.25 * Math.sin(T * 2.6);
      pen(ctx, glow * drop, true, 2);
      polyline(ctx, [[bar, 64 - 15 * drop], [bar, 64 + 15 * drop]]);
    }
  },
  // « Ce qui fonctionne »: a loop running smoothly, pulses going round it without a stop.
  flow(ctx, b, T) {
    const loop = sample(80, (u) => {
      const a = Math.PI + u * TAU;
      return [W / 2 + Math.cos(a) * 66, 66 + Math.sin(a) * 26];
    });
    pen(ctx, 0.55);
    polyline(ctx, loop, phase(b, 0, 0.7));
    // Direction marks along it.
    const marks = phase(b, 0.6, 0.9);
    for (let k = 0; k < 4; k++) {
      const p = along(loop, k / 4 + 0.125);
      const q = along(loop, k / 4 + 0.135);
      const angle = Math.atan2(q[1] - p[1], q[0] - p[0]);
      pen(ctx, 0.55 * marks);
      polyline(ctx, [
        [p[0] - Math.cos(angle - 0.6) * 6, p[1] - Math.sin(angle - 0.6) * 6], p,
        [p[0] - Math.cos(angle + 0.6) * 6, p[1] - Math.sin(angle + 0.6) * 6],
      ]);
    }
    if (b >= 0.9) {
      for (let k = 0; k < 3; k++) {
        const u = fract(T / 3.6 + k / 3);
        const p = along(loop, u);
        pen(ctx, 0.95, true);
        dot(ctx, p[0], p[1], 2.3);
        for (let tail = 1; tail <= 5; tail++) {
          const q = along(loop, u - tail * 0.008);
          pen(ctx, 0.5 - tail * 0.08, true);
          dot(ctx, q[0], q[1], 1.6);
        }
      }
    }
  },
  // « Positionnement »: a target seen in perspective; a point comes in, spiralling, and
  // settles at its centre, where a marker stands: a place that is its own.
  target(ctx, b, T) {
    const cx = W / 2;
    const cy = 78;
    [64, 42, 20].forEach((r, k) => {
      pen(ctx, 0.35 + k * 0.12);
      ellipse(ctx, cx, cy, r, r * 0.42, phase(b, k * 0.12, 0.45 + k * 0.12));
    });
    const ticks = phase(b, 0.4, 0.6);
    pen(ctx, 0.5 * ticks);
    for (const [dx, dy] of [[1, 0], [-1, 0]]) polyline(ctx, [[cx + dx * 70, cy + dy], [cx + dx * 80, cy]], ticks);
    const s = phase(b, 0.45, 1);
    if (s > 0) {
      const angle = 4.8 * (1 - s);
      const r = 62 * (1 - s) ** 1.3;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r * 0.42;
      pen(ctx, 1, true);
      dot(ctx, x, y, 2.4);
    }
    if (b >= 1) {
      // The marker: a stem and the brand's square, and a ring going out once in a while.
      pen(ctx, 0.8, true);
      polyline(ctx, [[cx, cy], [cx, cy - 34]]);
      square(ctx, cx, cy - 38, 7, true);
      const wave = fract(T / 3);
      pen(ctx, 0.6 * (1 - wave), true);
      ellipse(ctx, cx, cy, 8 + wave * 56, (8 + wave * 56) * 0.42);
      pen(ctx, 1, true);
      dot(ctx, cx, cy, 2.6);
    }
  },
  // « Priorités »: three bars, first in no order, then sorted, the most important first:
  // numbered as on the site; the first one holds the light.
  priorities(ctx, b, T) {
    const lengths = [150, 108, 66]; // in order of priority
    const startRow = [2, 0, 1]; // where each one starts, before the sorting
    const rowY = (row: number) => 30 + row * 30;
    const sort = phase(b, 0.45, 0.95);
    lengths.forEach((len, k) => {
      const grow = phase(b, 0.05 + k * 0.1, 0.4 + k * 0.1);
      const y = rowY(startRow[k]) + (rowY(k) - rowY(startRow[k])) * sort;
      const first = k === 0 && sort >= 1;
      pen(ctx, first ? 0.95 : 0.55, first, first ? 2 : 1.25);
      polyline(ctx, [[34, y], [34 + len, y]], grow);
      numeral(ctx, `0${k + 1}`, 20, y, grow * (0.4 + sort * 0.55), k === 0);
    });
    if (b >= 1) {
      // A glint running along the first one.
      const u = fract(T / 3.2);
      pen(ctx, 0.9 * Math.sin(u * Math.PI), true);
      dot(ctx, 34 + u * lengths[0], rowY(0), 2.2);
    }
  },
  // « Parcours »: a winding journey and its stages, each lit as a point of light reaches it.
  journey(ctx, b, T) {
    const path = sample(70, (u) => [18 + u * 164, 96 - u * 58 + Math.sin(u * TAU * 1.25) * 15]);
    pen(ctx, 0.6);
    polyline(ctx, path, phase(b, 0, 0.75));
    const travel = b >= 1 ? fract(T / 4.4) : -1;
    [0, 1 / 3, 2 / 3, 1].forEach((u, k) => {
      const shown = phase(b, 0.25 + k * 0.15, 0.45 + k * 0.15);
      if (shown <= 0) return;
      const p = along(path, u);
      const reached = travel >= u - 0.01;
      pen(ctx, (reached ? 0.95 : 0.55) * shown, reached);
      ellipse(ctx, p[0], p[1], 4.5, 4.5);
      if (reached) dot(ctx, p[0], p[1], 2);
    });
    if (travel >= 0) {
      const p = along(path, travel);
      pen(ctx, 1, true);
      dot(ctx, p[0], p[1], 2.4);
    }
  },
  // « Feuille de route »: the brand's graduated rule as a timeline, the work set on it in
  // rows, and « now » moving along: what is passed is done (champagne).
  roadmap(ctx, b, T) {
    const y0 = 98;
    const x0 = 16;
    const x1 = 184;
    pen(ctx, 0.6);
    polyline(ctx, [[x0, y0], [x1, y0]], phase(b, 0, 0.35));
    for (let i = 0; i <= 12; i++) {
      const x = x0 + (i / 12) * (x1 - x0);
      const major = i % 4 === 0;
      pen(ctx, (major ? 0.55 : 0.3) * phase(b, 0.15 + i * 0.015, 0.3 + i * 0.015));
      polyline(ctx, [[x, y0], [x, y0 + (major ? 5 : 3)]]);
    }
    const tasks: [number, number, number][] = [[0.04, 0.42, 30], [0.3, 0.7, 50], [0.58, 0.96, 70]];
    const now = b >= 1 ? 0.05 + fract(T / 7) * 0.9 : 0;
    tasks.forEach(([from, to, y], k) => {
      const shown = phase(b, 0.3 + k * 0.15, 0.6 + k * 0.15);
      const a = x0 + from * (x1 - x0);
      const z = x0 + to * (x1 - x0);
      pen(ctx, 0.5 * shown);
      ctx.strokeRect(a, y - 4, (z - a) * shown, 8);
      const done = clamp01((now - from) / (to - from));
      if (done > 0) {
        pen(ctx, 0.8, true);
        ctx.fillRect(a + 1.5, y - 2.5, (z - a - 3) * done * shown, 5);
      }
      pen(ctx, 0.5 * shown, true);
      square(ctx, a - 6, y, 4, done >= 1);
    });
    if (b >= 1) {
      const x = x0 + now * (x1 - x0);
      pen(ctx, 0.85, true);
      polyline(ctx, [[x, 18], [x, y0 + 6]]);
      dot(ctx, x, y0, 2.4);
    }
  },
  // « Contenu »: pieces of content set in a grid, published one after the other.
  content(ctx, b, T) {
    const cols = 3;
    const active = b >= 1 ? Math.floor(T / 0.9) % 6 : -1;
    for (let k = 0; k < 6; k++) {
      const cx = W / 2 + ((k % cols) - 1) * 52;
      const cy = k < cols ? 42 : 84;
      const shown = phase(b, k * 0.1, 0.35 + k * 0.1);
      if (shown <= 0) continue;
      const on = k === active;
      pen(ctx, (on ? 0.95 : 0.45) * shown, on);
      ctx.strokeRect(cx - 21, cy - 15, 42 * shown, 30);
      // An image block and two lines of text.
      pen(ctx, (on ? 0.8 : 0.3) * shown, on);
      ctx.strokeRect(cx - 16, cy - 10, 14, 11);
      polyline(ctx, [[cx + 2, cy - 7], [cx + 16, cy - 7]], shown);
      polyline(ctx, [[cx + 2, cy - 2], [cx + 12, cy - 2]], shown);
      polyline(ctx, [[cx - 16, cy + 8], [cx + 16, cy + 8]], shown);
      if (on) {
        // Sent out: a short line rising from it.
        const u = fract(T / 0.9);
        pen(ctx, 0.8 * (1 - u), true);
        polyline(ctx, [[cx, cy - 18 - u * 8], [cx, cy - 22 - u * 12]]);
      }
    }
  },
  // « Campagnes Ads »: a funnel; points come in wide at the top and are gathered at its foot.
  funnel(ctx, b, T) {
    const top = 22;
    const neck = 84;
    const shape = phase(b, 0, 0.6);
    pen(ctx, 0.6);
    polyline(ctx, [[22, top], [W / 2 - 10, neck], [W / 2 - 10, 100]], shape);
    polyline(ctx, [[W - 22, top], [W / 2 + 10, neck], [W / 2 + 10, 100]], shape);
    if (b < 0.6) return;
    const flow = phase(b, 0.6, 1);
    for (let j = 0; j < 22; j++) {
      const u = fract(T * 0.22 + j / 22);
      const lane = fract(j * 0.618) - 0.5; // -0.5..0.5 across
      const y = 10 + u * (104 - 10);
      const halfWidth = y < top ? 88 : y < neck ? 88 - ((y - top) / (neck - top)) * 78 : 10;
      const x = W / 2 + lane * 2 * (halfWidth - 6);
      pen(ctx, (0.35 + u * 0.6) * flow * Math.min(1, (1 - u) * 6), u > 0.7);
      dot(ctx, x, y, 1.3 + u * 0.6);
    }
    pen(ctx, flow * (0.85 + 0.15 * Math.sin(T * 3)), true);
    dot(ctx, W / 2, 108, 3);
  },
  // « CRM & fidélisation »: a base at the centre, and the customer who goes out and comes
  // back to it; each return brightens the base.
  loop(ctx, b, T) {
    const cx = W / 2;
    const cy = 64;
    pen(ctx, 0.5);
    ellipse(ctx, cx, cy, 70, 34, phase(b, 0, 0.6));
    // The base: a small cluster.
    const cluster = phase(b, 0.3, 0.7);
    const cycle = b >= 1 ? fract(T / 4) : 0;
    const back = cycle > 0.85 ? Math.exp(-(((cycle - 0.93) / 0.05) ** 2)) : 0;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      const r = k === 0 ? 0 : 7;
      pen(ctx, (0.6 + back * 0.4) * cluster, true);
      dot(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 1.6);
    }
    if (b < 1) return;
    // Out along a spoke, round the ring, back in.
    let p: Pt;
    if (cycle < 0.15) {
      const u = cycle / 0.15;
      p = [cx + u * 70, cy];
    } else if (cycle < 0.85) {
      const a = ((cycle - 0.15) / 0.7) * TAU;
      p = [cx + Math.cos(a) * 70, cy + Math.sin(a) * 34];
    } else {
      const u = (cycle - 0.85) / 0.15;
      p = [cx + (1 - u) * 70, cy];
    }
    pen(ctx, 0.35);
    ctx.setLineDash([2, 3]);
    polyline(ctx, [[cx + 10, cy], [cx + 70, cy]]);
    ctx.setLineDash([]);
    pen(ctx, 1, true);
    dot(ctx, p[0], p[1], 2.5);
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
