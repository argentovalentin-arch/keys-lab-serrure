import * as THREE from 'three/webgpu';
import {
  cameraPosition, color, exp, float, hash, instanceIndex, instancedArray, mix, sin, smoothstep, uint, uniform, uv, varying,
} from 'three/tsl';
import { DUSK, SEA_LEVEL } from './coast';
import { particleShape, twinkle } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';
import { CONTOUR_SHARE, fbm, noise2, ridged, slopeAt, toContour, topoSize, topoTone } from './topography';

/**
 * Out to sea, beyond the start: the Parata and the Îles Sanguinaires, at the mouth of the
 * Gulf of Ajaccio, against the last light of the day. The visitor sees them first from the
 * boat, low on the water, as they set off across the gulf; and finds them again from the
 * summit after the climb, in the same direction, far below: the same horizon.
 *
 * Laid out after the real ones (sources: Paradis & Piazza 2003; HELP/PIM/OFB 2025;
 * Wikipédia; OpenStreetMap; see livrables/08): from the coast out to sea, the ridge running
 * down from the heights to the Parata's hill (85 m), its narrow isthmus, the point (55 m)
 * with its round Genoese tower; past the Passe des Sanguinaires (about 500 m), Porri (31 m,
 * its top flattened), the rock of U Sbiru (13 m), Isoloto, the cormorants' island, a little
 * pyramid (33 m), Cala d'Alga (20 to 30 m) and, a few metres beyond it, the Grande
 * Sanguinaire, Mezu Mare, 1.35 km long: its crest climbs to its high point (80 m) a third of
 * the way out, where the lighthouse stands (a square tower over a square keeper's house,
 * three white flashes every 15 s), falls to a second hump (58 m, the old semaphore), the
 * Tabernacle spur on its gulf side, the small square tower of Castelluccio (29 m), then its
 * low south-western tip and two rocks beyond.
 *
 * Lengths and gaps are to scale (SCALE); heights are 2.5 times the true ratio, so the
 * islands read from afar; the chain is turned a little more across the view than from
 * Ajaccio itself, where its islets hide one another. No name is written anywhere: whoever
 * knows them will know them.
 *
 * They are drawn as the mountain is (topography.ts): nothing but points of light, half of
 * them on contour lines, every one toned in champagne by how its ground faces the light,
 * crests and breaks of slope picked out, hollows in shade, the waterline breaking white.
 * Their ground is real relief: the crest's true heights, an outline of coves and points,
 * a steep, cliffed flank to the open sea and a gentler one to the gulf, ridges and gullies
 * down the flanks, hollows, rock, breaks of slope. Under the points, an unseen surface only
 * writes depth, as under the mountain: a nearer island hides what lies behind it.
 */

/** World units per metre along the ground, and up (heights exaggerated 2.5 times). */
const SCALE = 0.085;
const UP = SCALE * 2.5;
/** Contour lines on the islands: twice as close as on the mountain (they are lower, and seen from far). */
const STEP = 1.25;
/** The lowest line: the waterline, where the sea breaks on the rock. */
const SHORE = SEA_LEVEL + 0.28;

/** The Parata's car park, where the peninsula leaves the coast (world x, z), and the chain's direction out to sea. */
const ORIGIN = new THREE.Vector2(-173, 210);
const AXIS = new THREE.Vector2(0.819, 0.574);
/** The coast from the car park back towards Ajaccio, round the gulf (towards the viewer). */
const COAST = new THREE.Vector2(-0.52, -0.855);

interface Landmass {
  /** Its centre line (world x, z), from its landward end out to sea. */
  line: THREE.Vector2[];
  /** Widths (metres) along it: [position 0..1, width]. */
  widths: [number, number][];
  /** Heights (metres): [position 0..1, height, spread (share of its length)]. */
  hills: [number, number, number][];
  /** A height it is cut off at (a flattened top), metres. */
  flat?: number;
  /** Its outline's irregularity and a seed for it. */
  rough: number;
  seed: number;
  /** How densely it is drawn (1: the Sanguinaires; the coast behind is a backdrop). */
  density?: (a: number) => number;
}

/** A point of the chain, `metres` out from the car park along its axis, `across` metres to its north-west (+) or gulf side (-). */
const chain = (metres: number, across = 0) =>
  new THREE.Vector2(
    ORIGIN.x + (AXIS.x * metres - AXIS.y * across) * SCALE,
    ORIGIN.y + (AXIS.y * metres + AXIS.x * across) * SCALE,
  );
/** An island along the chain, from `from` to `to` metres, `across` metres off the axis. */
const islet = (from: number, to: number, across: number) => [chain(from, across), chain(to, across)];

const LANDMASSES: Landmass[] = [
  // The coast: the ridge coming down from the heights round the gulf to the Parata's car
  // park, then the peninsula: its hill, its isthmus, the point and its tower.
  {
    line: [
      new THREE.Vector2(ORIGIN.x + COAST.x * 4200 * SCALE - 90, ORIGIN.y + COAST.y * 4200 * SCALE),
      new THREE.Vector2(ORIGIN.x + COAST.x * 1500 * SCALE - 20, ORIGIN.y + COAST.y * 1500 * SCALE),
      chain(0), chain(560), chain(900), chain(1276),
    ],
    widths: [[0, 420], [0.12, 1600], [0.4, 1100], [0.6, 520], [0.75, 360], [0.85, 50], [0.95, 200], [1, 90]],
    hills: [[0.14, 125, 0.085], [0.33, 105, 0.12], [0.55, 90, 0.07], [0.75, 85, 0.04], [0.85, 14, 0.022], [0.958, 55, 0.024]],
    rough: 0.3, seed: 1,
    density: (a) => 0.1 + 0.9 * THREE.MathUtils.smoothstep(a, 0.52, 0.7),
  },
  { line: islet(1712, 1889, -110), widths: [[0, 60], [0.5, 120], [1, 50]], hills: [[0.43, 34, 0.42]], flat: 31, rough: 0.5, seed: 2 },
  { line: islet(2132, 2168, -20), widths: [[0, 25], [0.5, 35], [1, 20]], hills: [[0.5, 13, 0.4]], rough: 0.6, seed: 3 },
  { line: islet(2291, 2426, 0), widths: [[0, 50], [0.5, 95], [1, 45]], hills: [[0.49, 33, 0.3]], rough: 0.55, seed: 4 },
  { line: islet(2715, 2816, -100), widths: [[0, 120], [0.45, 160], [1, 110]], hills: [[0.44, 25, 0.45]], rough: 0.5, seed: 5 },
  // Mezu Mare, the Grande Sanguinaire.
  {
    line: islet(2823, 4163, 0),
    widths: [[0, 110], [0.1, 220], [0.36, 260], [0.55, 300], [0.67, 500], [0.75, 330], [0.88, 200], [1, 50]],
    hills: [
      [0.04, 8, 0.04], [0.2, 43, 0.08], [0.36, 80, 0.07], [0.52, 55, 0.07], [0.7, 58, 0.05], [0.83, 29, 0.05], [0.95, 5, 0.05],
    ],
    rough: 0.4, seed: 6,
  },
  // The Tabernacle spur on its gulf side, and the two rocks off its south-western tip.
  { line: islet(3640, 3760, -230), widths: [[0, 60], [0.5, 120], [1, 50]], hills: [[0.5, 36, 0.35]], rough: 0.6, seed: 7 },
  { line: islet(4200, 4235, 15), widths: [[0, 18], [0.5, 30], [1, 15]], hills: [[0.5, 8, 0.4]], rough: 0.6, seed: 8 },
  { line: islet(4275, 4300, -10), widths: [[0, 12], [0.5, 22], [1, 10]], hills: [[0.5, 5, 0.4]], rough: 0.6, seed: 9 },
];

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const smooth = THREE.MathUtils.smoothstep;
const wobble = (t: number, seed: number) =>
  Math.sin(t * 6.1 + seed * 1.7) * 0.5 + Math.sin(t * 13.7 + seed * 4.1) * 0.3 + Math.sin(t * 29.3 + seed * 2.3) * 0.2;
const lerpTable = (table: [number, number][], t: number) => {
  for (let i = 1; i < table.length; i++) {
    if (t <= table[i][0]) {
      const [a, va] = table[i - 1];
      const [b, vb] = table[i];
      const u = (t - a) / Math.max(b - a, 1e-6);
      return va + (vb - va) * (u * u * (3 - 2 * u));
    }
  }
  return table[table.length - 1][1];
};

/** A landmass laid out: its centre line's segments, their lengths, its bounds (world). */
interface Laid {
  mass: Landmass;
  segments: { from: THREE.Vector2; dir: THREE.Vector2; length: number; start: number }[];
  length: number;
  bounds: [number, number, number, number];
}
const LAID: Laid[] = LANDMASSES.map((mass) => {
  let start = 0;
  const segments = mass.line.slice(1).map((to, i) => {
    const from = mass.line[i];
    const length = from.distanceTo(to);
    const segment = { from, dir: to.clone().sub(from).normalize(), length, start };
    start += length;
    return segment;
  });
  const reach = (Math.max(...mass.widths.map(([, w]) => w)) * SCALE * 1.3) / 2 * 1.6;
  const xs = mass.line.map((p) => p.x);
  const zs = mass.line.map((p) => p.y);
  return {
    mass, segments, length: start,
    bounds: [Math.min(...xs) - reach, Math.max(...xs) + reach, Math.min(...zs) - reach, Math.max(...zs) + reach],
  };
});

/** Half its width (world units) at `a` along it. */
const halfWidth = (mass: Landmass, a: number) => (lerpTable(mass.widths, a) * SCALE * 1.3) / 2;

/**
 * A landmass's height (metres above the sea; -6 under it) at (along 0..1, across -1..1 of
 * its half-width there); (mx, mz): where that is, in metres, for its detail.
 */
function metresAt(laid: Laid, a: number, b: number, mx: number, mz: number): number {
  const { mass } = laid;
  let crest = 0;
  for (const [at, h, spread] of mass.hills) crest = Math.max(crest, h * Math.exp(-(((a - at) / spread) ** 2)));
  if (mass.flat !== undefined) crest = Math.min(crest, mass.flat + 2.5 * fbm(mx / 45, mz / 45, 2));
  // The skyline: knolls, saddles and rocky tops along the crest, not one smooth line.
  const alongMetres = (a * laid.length) / SCALE;
  crest *= 1 + 0.2 * fbm(alongMetres / 110 + mass.seed * 2.7, mass.seed, 3) + 0.16 * (ridged(alongMetres / 48 + mass.seed, mass.seed * 1.3, 2) - 0.45);
  // The outline: coves and points, at two scales.
  const ends = Math.pow(Math.max(Math.sin(Math.PI * clamp01(a)), 0), 0.35);
  const outline = 1 + mass.rough * (0.3 * wobble(a, mass.seed) + 0.38 * fbm(mx / 150 + mass.seed * 7, mz / 150, 3));
  const edge = Math.max(ends * outline, 0.001);
  const u = Math.abs(b) / edge;
  if (u >= 1) return -6;
  const relief = crest + 6;
  // The flanks: cliffs to the open sea (north-west), a long slope to the gulf.
  let h = relief * (b > 0 ? Math.pow(1 - u ** 3, 0.7) : 1 - u ** 1.25);
  const flank = 4 * u * (1 - u);
  const size = Math.min(1, relief / 30);
  // Spurs and ridges down the flanks, strongest mid-slope.
  h += relief * 0.34 * flank * (ridged(mx / 70 + mass.seed * 3.1, mz / 70) - 0.42);
  // Gullies running down to the sea, across the island.
  const gully = Math.abs(noise2(alongMetres / 52 + mass.seed * 5.3, u * 1.4 + mass.seed));
  h -= relief * 0.26 * flank * (1 - smooth(gully, 0, 0.3)) * size;
  // A few hollows in the higher ground.
  h -= relief * 0.14 * Math.max(0, noise2(mx / 34 + 40, mz / 34 - 12) - 0.3) * (1 - u);
  // Rock: fine roughness, rougher towards the water.
  h += 2.4 * fbm(mx / 13, mz / 13, 3) * (0.3 + u) * size + 4 * fbm(mx / 34 + 9, mz / 34, 2) * (0.2 + u) * size;
  // Breaks of slope: a soft terracing.
  const t = h / 11;
  const f = t - Math.floor(t);
  h = h * 0.86 + (Math.floor(t) + smooth(f, 0.32, 0.68)) * 11 * 0.14;
  return Math.max(h, 0) - 6;
}

/** Where a world point stands on a landmass: along it (0..1) and across it (-1..1 of its half-width). */
function paramOf(laid: Laid, x: number, z: number): [number, number] {
  let best = Infinity;
  let a = 0;
  let across = 0;
  for (const s of laid.segments) {
    const dx = x - s.from.x;
    const dz = z - s.from.y;
    const t = THREE.MathUtils.clamp(dx * s.dir.x + dz * s.dir.y, 0, s.length);
    const qx = dx - s.dir.x * t;
    const qz = dz - s.dir.y * t;
    const d2 = qx * qx + qz * qz;
    if (d2 < best) {
      best = d2;
      a = (s.start + t) / laid.length;
      across = qx * -s.dir.y + qz * s.dir.x;
    }
  }
  return [a, across / halfWidth(laid.mass, a)];
}

/** Across a landmass, its heights are worked out this far out (share of its half-width). */
const REACH = 1.4;
/** Its heights, worked out once on a grid along and across it (metres), read back between nodes. */
const GRIDS = LAID.map((laid) => {
  const along = Math.max(24, Math.ceil(laid.length / 0.42));
  const across = 72;
  const metres = new Float32Array((along + 1) * (across + 1));
  for (let i = 0; i <= along; i++) {
    const a = i / along;
    const segment = laid.segments.find((s) => a * laid.length <= s.start + s.length) ?? laid.segments[laid.segments.length - 1];
    const t = a * laid.length - segment.start;
    const half = halfWidth(laid.mass, a);
    for (let j = 0; j <= across; j++) {
      const b = (j / across) * 2 * REACH - REACH;
      const x = segment.from.x + segment.dir.x * t - segment.dir.y * b * half;
      const z = segment.from.y + segment.dir.y * t + segment.dir.x * b * half;
      metres[i * (across + 1) + j] = metresAt(laid, a, b, x / SCALE, z / SCALE);
    }
  }
  return { along, across, metres };
});

/** Ground height (world units) at a world point: the highest of the landmasses there, else the sea floor. */
function heightAt(x: number, z: number): number {
  let metres = -6;
  LAID.forEach((laid, m) => {
    const [x0, x1, z0, z1] = laid.bounds;
    if (x < x0 || x > x1 || z < z0 || z > z1) return;
    const [a, b] = paramOf(laid, x, z);
    if (Math.abs(b) >= REACH) return;
    const grid = GRIDS[m];
    const u = a * grid.along;
    const v = ((b + REACH) / (2 * REACH)) * grid.across;
    const i = Math.min(Math.floor(u), grid.along - 1);
    const j = Math.min(Math.floor(v), grid.across - 1);
    const fu = u - i;
    const fv = v - j;
    const row = grid.across + 1;
    const at = (di: number, dj: number) => grid.metres[(i + di) * row + j + dj];
    const here = (at(0, 0) * (1 - fv) + at(0, 1) * fv) * (1 - fu) + (at(1, 0) * (1 - fv) + at(1, 1) * fv) * fu;
    metres = Math.max(metres, here);
  });
  return SEA_LEVEL + metres * UP;
}

/** A point on a landmass's centre line, at `a` along it, on its ground. */
function onGround(index: number, a: number) {
  const laid = LAID[index];
  const segment = laid.segments.find((s) => a * laid.length <= s.start + s.length) ?? laid.segments[laid.segments.length - 1];
  const t = a * laid.length - segment.start;
  const x = segment.from.x + segment.dir.x * t;
  const z = segment.from.y + segment.dir.y * t;
  return new THREE.Vector3(x, heightAt(x, z), z);
}

/** Where to look at them from the sea: between the Parata and the Grande Sanguinaire, a little over the water. */
export const ISLANDS_VIEW = (() => {
  const p = chain(2700, 0);
  return new THREE.Vector3(p.x, SEA_LEVEL + 3, p.y);
})();

/** Kinds of point (fourth component of their place). */
const LOOSE = 0;
const CONTOUR = 1;
const WATERLINE = 2;
const BUILT = 3;

/**
 * The points, laid out once: where each one is, what kind it is, its ground's normal and
 * curvature. Spread over the landmasses by area (the coast behind thinner), half of them
 * moved onto contour lines, the lowest of which is the waterline.
 */
function layPoints(count: number) {
  const places: number[] = [];
  const grounds: number[] = [];
  // Each landmass's share: its area, weighted by how densely it is drawn.
  const tables = LAID.map((laid) => {
    const steps = 200;
    const cdf: number[] = [0];
    for (let i = 1; i <= steps; i++) {
      const a = (i - 0.5) / steps;
      const w = halfWidth(laid.mass, a) * (laid.mass.density?.(a) ?? 1);
      cdf.push(cdf[i - 1] + w * (laid.length / steps));
    }
    return cdf;
  });
  const totals = tables.map((cdf) => cdf[cdf.length - 1]);
  const all = totals.reduce((s, v) => s + v, 0);
  let seed = 12345;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  LAID.forEach((laid, m) => {
    const wanted = Math.round((count * totals[m]) / all);
    const cdf = tables[m];
    let made = 0;
    for (let tries = 0; made < wanted && tries < wanted * 6; tries++) {
      // Along it, by its area; across it, evenly.
      const r = random() * cdf[cdf.length - 1];
      let i = 1;
      while (i < cdf.length - 1 && cdf[i] < r) i++;
      const a = (i - 1 + (r - cdf[i - 1]) / Math.max(cdf[i] - cdf[i - 1], 1e-9)) / (cdf.length - 1);
      const b = (random() * 2 - 1) * 1.35;
      const segment = laid.segments.find((s) => a * laid.length <= s.start + s.length) ?? laid.segments[laid.segments.length - 1];
      const t = a * laid.length - segment.start;
      const half = halfWidth(laid.mass, a);
      let x = segment.from.x + segment.dir.x * t - segment.dir.y * b * half;
      let z = segment.from.y + segment.dir.y * t + segment.dir.x * b * half;
      let y = heightAt(x, z);
      if (y < SHORE - STEP * 0.4) continue;
      let kind = LOOSE;
      if (random() < CONTOUR_SHARE * 0.7) {
        const [cx, cz, level] = toContour((px, pz) => heightAt(px, pz) - SHORE, x, z, STEP);
        x = cx;
        z = cz;
        y = SHORE + level;
        kind = level < STEP * 0.5 ? WATERLINE : CONTOUR;
      }
      const { normal, cavity } = slopeAt(heightAt, x, z, 1.1, 1.1);
      places.push(x, y, z, kind);
      grounds.push(normal.x, normal.y, normal.z, cavity);
      made++;
    }
  });
  return { places, grounds };
}

/** The buildings, in points: edges and courses of points, as the levers and the pavers are drawn. */
function layBuildings(places: number[], grounds: number[]) {
  const yaw = Math.atan2(AXIS.x, AXIS.y);
  const push = (at: THREE.Vector3, local: THREE.Vector3, out: THREE.Vector3) => {
    const p = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(at);
    const n = out.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    places.push(p.x, p.y, p.z, BUILT);
    grounds.push(n.x, n.y, n.z, 0.4);
  };
  /** A box (w × h × d) standing on `at`: its edges, and a course of points every `course` up its faces. */
  const box = (at: THREE.Vector3, w: number, h: number, d: number, course: number) => {
    const spacing = 0.07;
    const hw = w / 2;
    const hd = d / 2;
    for (let y = 0; y <= h + 1e-6; y += course) {
      const top = y > h - course * 0.5;
      for (let s = -hw; s <= hw + 1e-6; s += spacing) {
        push(at, new THREE.Vector3(s, y, -hd), new THREE.Vector3(0, top ? 1 : 0, -1));
        push(at, new THREE.Vector3(s, y, hd), new THREE.Vector3(0, top ? 1 : 0, 1));
      }
      for (let s = -hd + spacing; s < hd; s += spacing) {
        push(at, new THREE.Vector3(-hw, y, s), new THREE.Vector3(-1, top ? 1 : 0, 0));
        push(at, new THREE.Vector3(hw, y, s), new THREE.Vector3(1, top ? 1 : 0, 0));
      }
    }
    for (let y = 0; y <= h; y += spacing) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) push(at, new THREE.Vector3(sx * hw, y, sz * hd), new THREE.Vector3(sx, 0, sz).normalize());
    }
  };
  /** A round tower: courses of points round it, its top a little wider. */
  const tower = (at: THREE.Vector3, radius: number, h: number) => {
    for (let y = 0; y <= h + 1e-6; y += 0.11) {
      const r = radius * (1 + (y > h - 0.25 ? 0.1 : 0) - 0.1 * (y / h));
      const around = Math.max(10, Math.round((Math.PI * 2 * r) / 0.09));
      for (let k = 0; k < around; k++) {
        const angle = (k / around) * Math.PI * 2;
        const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        push(at, out.clone().multiplyScalar(r).setY(y), out);
      }
    }
  };
  // The Parata's Genoese tower: round, 12 m, 7.3 m across (slightly enlarged to read).
  tower(onGround(0, 0.958), 0.55, 12 * UP);
  // The lighthouse: a square tower of 18 m over a square keeper's house.
  const lightAt = onGround(5, 0.36);
  box(lightAt, 1.5, 5 * UP, 1.5, 0.22);
  box(lightAt.clone().setY(lightAt.y + 5 * UP), 0.42, 13 * UP, 0.42, 0.2);
  // The old semaphore, on the second hump; the small square tower of Castelluccio.
  box(onGround(5, 0.7), 0.9, 4 * UP, 0.7, 0.2);
  box(onGround(5, 0.83), 0.4, 8 * UP, 0.4, 0.2);
  return lightAt.clone().setY(lightAt.y + 18 * UP);
}

/** The unseen ground under the points, per landmass: it only writes depth. */
function layGround(): THREE.BufferGeometry[] {
  const ALONG = 160;
  const ACROSS = 26;
  return LAID.map((laid) => {
    const positions: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= ALONG; i++) {
      const a = i / ALONG;
      const segment = laid.segments.find((s) => a * laid.length <= s.start + s.length) ?? laid.segments[laid.segments.length - 1];
      const t = a * laid.length - segment.start;
      const half = halfWidth(laid.mass, a);
      for (let j = 0; j <= ACROSS; j++) {
        const b = ((j / ACROSS) * 2 - 1) * 1.3;
        const x = segment.from.x + segment.dir.x * t - segment.dir.y * b * half;
        const z = segment.from.y + segment.dir.y * t + segment.dir.x * b * half;
        // A little under the points, so they always lie in front of it.
        positions.push(x, Math.max(heightAt(x, z), SEA_LEVEL - 0.6) - 0.3, z);
      }
    }
    for (let i = 0; i < ALONG; i++) {
      for (let j = 0; j < ACROSS; j++) {
        const p = i * (ACROSS + 1) + j;
        const q = p + ACROSS + 1;
        index.push(p, q, p + 1, q, q + 1, p + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    return geometry;
  });
}

/**
 * Seen from the summit at the end, the archipelago is drawn in nearer, lower in the view and
 * a little to the right, off the mountain's foot below the path: it sits with the land just
 * climbed rather than floating in the middle of the view, behind the closing curve. Only its
 * place changes, by this much (world units), never its shape; from the boat it stands where
 * it does.
 */
const SUMMIT_PLACE = new THREE.Vector3(-168, 0, -345);

export function createIslands(scene: THREE.Scene, { time, count }: { time: THREE.Node<'float'>; count: number }) {
  const group = new THREE.Group();
  /** The islands themselves (not the last light behind them): what is placed for the summit's view. */
  const land = new THREE.Group();
  group.add(land);
  const shown = uniform(0);
  /** Their topography marked more strongly from the summit (topography.ts); from the boat, as it is. */
  const contrast = uniform(0);

  // ---- The ground, in points (topography.ts).
  const started = performance.now();
  const { places, grounds } = layPoints(count);
  if (import.meta.env.DEV) console.info(`KEYS Lab islands: ${places.length / 4} points laid in ${Math.round(performance.now() - started)} ms`);
  const lightAt = layBuildings(places, grounds);
  const placeArray = instancedArray(new Float32Array(places), 'vec4');
  const groundArray = instancedArray(new Float32Array(grounds), 'vec4');
  const place = placeArray.element(instanceIndex);
  const ground = groundArray.element(instanceIndex);
  const kind = place.w;
  const seed = hash(instanceIndex.add(uint(7)));
  const toEye = cameraPosition.sub(place.xyz).normalize();
  const fromEye = cameraPosition.sub(place.xyz).length();
  const tone = topoTone(ground.xyz, ground.w, toEye, contrast);
  const isLine = kind.greaterThan(0.5);
  const isWaterline = kind.greaterThan(1.5).and(kind.lessThan(2.5));
  const isBuilt = kind.greaterThan(2.5);
  // The sea breaks on the waterline, in time with the swell.
  const breaking = sin(time.mul(0.9).add(place.x.mul(0.21)).add(place.z.mul(0.17))).mul(0.5).add(0.5);
  // Further off, paler and dimmer: the haze over the sea.
  const haze = smoothstep(260, 900, fromEye);
  const colour = isWaterline.select(color(LAB.dust).mul(1.05), isBuilt.select(mix(tone.colour, color(BRAND.offwhite), 0.45), tone.colour));
  // Seen from far, against the last light, most of what faces the eye is in shade: it keeps
  // a glow of its own, so the islands read as bodies of light, modelled by the tone.
  const strength = isWaterline.select(breaking.mul(0.45).add(0.65), isBuilt.select(tone.strength.mul(1.25).add(0.2), tone.strength.mul(0.75).add(float(0.3).sub(contrast.mul(0.16))).mul(isLine.select(float(1.05), float(0.9)))));
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  // Drawn a little towards the eye, so the unseen ground they lie on never hides them.
  material.positionNode = place.xyz.add(toEye.mul(0.25));
  const shape = particleShape();
  material.colorNode = varying(mix(colour, color(BRAND.navy60).mul(1.4), haze.mul(0.35)));
  // From the summit they are nearer than from the boat: each point gives less light, so the
  // tones, not the sheer number of points, draw their relief.
  const near = mix(float(1), float(0.46), contrast);
  material.opacityNode = shape.alpha.mul(varying(strength.mul(float(1).sub(haze.mul(0.3))).mul(twinkle(time, seed, 0.18)).mul(near))).mul(shown);
  // As the mountain seen from the sea (relief.ts): the same points, finer from afar.
  material.scaleNode = topoSize(fromEye, isLine, seed).mul(isBuilt.select(float(0.32), tone.size.mul(0.72)));
  const points = new THREE.Sprite(material);
  points.count = places.length / 4;
  points.frustumCulled = false;
  land.add(points);

  // ---- The unseen ground: it hides what lies behind an island (its far side, the sea
  // beyond, the next island), never the last light behind them all (drawn before it).
  const groundMaterial = new THREE.MeshBasicNodeMaterial({ colorWrite: false, transparent: true, depthWrite: true, side: THREE.DoubleSide });
  const geometries = layGround();
  for (const geometry of geometries) {
    const mesh = new THREE.Mesh(geometry, groundMaterial);
    mesh.renderOrder = -2;
    land.add(mesh);
  }

  // ---- The light: three white flashes every 15 seconds, as the real one.
  const beamMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const r = uv().sub(0.5).length().mul(2);
  const cycle = time.div(15).fract().mul(15);
  const pulse = (at: number) => exp(cycle.sub(at).div(0.22).pow(2).negate());
  const flash = pulse(0.5).add(pulse(2.2)).add(pulse(3.9));
  beamMaterial.colorNode = color(LAB.lightCore).mul(1.8);
  beamMaterial.opacityNode = exp(r.mul(r).mul(-7)).mul(smoothstep(1, 0.6, r)).mul(flash.add(0.1)).mul(shown);
  const beam = new THREE.Sprite(beamMaterial);
  beam.position.copy(lightAt);
  beam.scale.setScalar(4.5);
  land.add(beam);

  // ---- The last light of the day, low on the horizon behind them.
  const glowMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const height = uv().y;
  const across = uv().x.sub(0.5);
  const centre = exp(across.mul(across).mul(-9));
  glowMaterial.colorNode = mix(color(BRAND.champagne), color(LAB.lightCore), centre.mul(exp(height.mul(-14))).mul(0.6));
  // Gone well before the arc's ends, so it never shows an edge.
  const ends = smoothstep(0.5, 0.36, across.abs());
  // Quieter than when the islands were dark shapes against it: they are light themselves now.
  glowMaterial.opacityNode = exp(height.mul(-6.5)).mul(centre.mul(0.8).add(0.2)).mul(0.36)
    .add(exp(height.mul(height).mul(-12000)).mul(centre.mul(0.45).add(0.1)))
    .mul(ends).mul(shown);
  // On a wide arc round the mountain, centred on the light: its foot is a level horizon
  // from wherever it is seen. Drawn before the islands' unseen ground, which never hides it.
  const azimuth = Math.atan2(DUSK.x, DUSK.z);
  const ARC = 3.4;
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1350, 1350, 460, 96, 1, true, azimuth - ARC / 2, ARC), glowMaterial);
  glow.position.set(0, SEA_LEVEL - 2 + 230, -195);
  glow.renderOrder = -3;
  group.add(glow);

  group.visible = false;
  scene.add(group);

  return {
    /** 0..1: how much they show; and where the sea's surface is (lower once the summit's view deepens). */
    /** How far out round the mountain the last light's arc stands (world units; it stands at 1350 unless told). */
    setHorizon(radius: number) {
      glow.scale.set(radius / 1350, 1, radius / 1350);
    },
    update(amount: number, level = SEA_LEVEL, fromSummit = false) {
      shown.value = amount;
      group.visible = amount > 0.001;
      group.position.y = level - SEA_LEVEL;
      contrast.value = fromSummit ? 1 : 0;
      land.position.copy(SUMMIT_PLACE).multiplyScalar(fromSummit ? 1 : 0);
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      glow.geometry.dispose();
      [material, groundMaterial, beamMaterial, glowMaterial].forEach((m) => m.dispose());
    },
  };
}

export type Islands = ReturnType<typeof createIslands>;
