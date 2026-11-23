import * as THREE from 'three/webgpu';
import { Fn, atan, clamp, cos, float, max, mix, sin, smoothstep, vec2 } from 'three/tsl';
import { SEA_LEVEL } from './coast';

/**
 * The Terrain's route, shared by the ride (terrain.ts), the relief seen from the summit
 * (relief.ts) and the reward (reward.ts).
 *
 * The route climbs a mountain: from the start, down in the valley at z = 0, to the summit
 * at « Performer ». Distances along the route (`p`, or `d` for the guide) are measured
 * along -z; the route's centre line winds left and right of the axis in two broad bends,
 * then straightens for the last approach to the top. The ground everywhere is the same
 * mountain (a peak centred on the summit), so the route, the field around it and the
 * relief seen from the top always agree.
 */

/**
 * The three landmarks, passed in order, at these distances along the path. `step` and
 * `label` are shown small over the word, to say what the stage is about (the keysperformance.com wording:
 * « Clarifier les fondations », « Déployer les leviers adaptés », « Mesurer, optimiser
 * et piloter »).
 */
export const LANDMARKS = [
  // The first, near the beach: once ashore, the visitor reaches it soon, up the first slope
  // just beyond the cove (which hands over to the mountain by 26).
  { word: 'Structurer', step: 1, label: 'Les fondations', at: 40 },
  { word: 'Activer', step: 2, label: 'Les leviers adaptés', at: 125 },
  { word: 'Performer', step: 3, label: 'Mesurer et piloter', at: 195 },
] as const;
export type Landmark = (typeof LANDMARKS)[number];
export const [STRUCTURE_AT, ACTIVATE_AT, PERFORM_AT] = LANDMARKS.map((l) => l.at);

/** The ride stops just past the summit, on its flat top. */
export const END_AT = PERFORM_AT + 8;

// The lane the path's particles gather into, from « Structurer » on (terrain.ts).
export const PATH_HALF = 1.6; // half-width of the lane once formed

// ---- Bends: the centre line's sideways offset, a slow wave that fades in after the
// start and out before the summit, so the route sets off straight and arrives straight.
const BEND_SIZE = 10;
const BEND_LENGTH = 95; // distance between two bends to the same side
const bendAmount = (p: number) =>
  THREE.MathUtils.smoothstep(p, 10, 40) * (1 - THREE.MathUtils.smoothstep(p, 150, 185));

/** Sideways position of the route's centre line at distance p. */
export const centerX = (p: number) => BEND_SIZE * bendAmount(p) * Math.sin((p / BEND_LENGTH) * Math.PI * 2);
/** Same, in a shader. */
export const centerXNode = (p: THREE.Node<'float'>) =>
  smoothstep(10, 40, p).mul(float(1).sub(smoothstep(150, 185, p)))
    .mul(sin(p.div(BEND_LENGTH).mul(Math.PI * 2))).mul(BEND_SIZE);
/** Heading of the route at p (radians, 0 = straight along -z, positive = turning towards +x). */
export const headingAt = (p: number) => Math.atan2(centerX(p + 1) - centerX(p - 1), 2);

// ---- The mountain: a peak centred on the summit, flat-topped, steeper near the top and
// spreading into the valley floor, where the start lies.
// High enough that, looking back from the top, the route spreads down the view to the
// start instead of bunching up near the horizon.
export const SUMMIT_HEIGHT = 40;
const SUMMIT_Z = -PERFORM_AT;
const TOP_RADIUS = 9; // the flat top
export const MOUNTAIN_RADIUS = 200; // from the edge of the top to the foot
const STEEPNESS = 1.6;

/**
 * The mountain's own relief, over its smooth cone: spurs running down from the top with
 * valleys between them, hills and hollows on the slopes, finer folds; strongest on the
 * mid-slopes, gone on the flat top and at the foot. The route's own corridor is left as
 * it was (the lane, its walls, levers and labels stand on the same ground as before): the
 * relief rises beside it. Written twice, once for the CPU and once for the shaders, with the
 * same sums of waves, so both always agree.
 */
const RELIEF = { spurs: 7, spur: 6, hills: 3.4, folds: 1, corridor: [5.5, 24] as const, rise: [TOP_RADIUS + 14, TOP_RADIUS + 75] as const };
const smoothJS = THREE.MathUtils.smoothstep;
const reliefJS = (x: number, z: number, r: number) => {
  const envelope = smoothJS(r, RELIEF.rise[0], RELIEF.rise[1]) * (1 - smoothJS(r, MOUNTAIN_RADIUS * 0.72, MOUNTAIN_RADIUS + TOP_RADIUS));
  const theta = Math.atan2(z - SUMMIT_Z, x);
  const warp = 0.45 * Math.sin(r * 0.03 + theta * 2) + 0.25 * Math.sin(r * 0.071 - theta * 3);
  const crest = 1 - Math.abs(Math.sin(theta * (RELIEF.spurs / 2) + warp));
  const spurs = (crest ** 1.6 * 2 - 0.7) * RELIEF.spur;
  const hills = Math.sin(x * 0.083 + Math.sin(z * 0.047) * 1.3) * Math.cos(z * 0.071 + Math.sin(x * 0.059) * 1.1) * RELIEF.hills;
  const folds = Math.sin(x * 0.23 + z * 0.17) * Math.sin(z * 0.21 - x * 0.13) * RELIEF.folds;
  const p = Math.min(Math.max(-z, 0), END_AT);
  const corridor = smoothJS(Math.abs(x - centerX(p)), RELIEF.corridor[0], RELIEF.corridor[1]);
  return (spurs + hills + folds) * envelope * corridor * (0.5 + 0.5 * Math.min(1, r / 90));
};
const reliefNode = (x: THREE.Node<'float'>, z: THREE.Node<'float'>, r: THREE.Node<'float'>) => {
  const envelope = smoothstep(RELIEF.rise[0], RELIEF.rise[1], r).mul(float(1).sub(smoothstep(MOUNTAIN_RADIUS * 0.72, MOUNTAIN_RADIUS + TOP_RADIUS, r)));
  const theta = atan(z.sub(SUMMIT_Z), x);
  const warp = sin(r.mul(0.03).add(theta.mul(2))).mul(0.45).add(sin(r.mul(0.071).sub(theta.mul(3))).mul(0.25));
  const crest = float(1).sub(sin(theta.mul(RELIEF.spurs / 2).add(warp)).abs());
  const spurs = crest.pow(1.6).mul(2).sub(0.7).mul(RELIEF.spur);
  const hills = sin(x.mul(0.083).add(sin(z.mul(0.047)).mul(1.3))).mul(cos(z.mul(0.071).add(sin(x.mul(0.059)).mul(1.1)))).mul(RELIEF.hills);
  const folds = sin(x.mul(0.23).add(z.mul(0.17))).mul(sin(z.mul(0.21).sub(x.mul(0.13)))).mul(RELIEF.folds);
  const p = z.negate().clamp(0, END_AT);
  const corridor = smoothstep(RELIEF.corridor[0], RELIEF.corridor[1], x.sub(centerXNode(p)).abs());
  return spurs.add(hills).add(folds).mul(envelope).mul(corridor).mul(float(0.5).add(r.div(90).min(1).mul(0.5)));
};

/**
 * The landing cove, at the mountain's foot, where the boat comes in (coast.ts, PIER): a beach
 * curving between two rocky points, its sand rising from the water to the land, the sea
 * floor falling away offshore so the shallows show; behind the beach, the ground climbs to
 * meet the mountain. It reshapes the ground only there, in the same matter.
 */
const COVE = {
  /** The waterline on the route's axis (world z), and how it curves out to sea on either side. */
  shore: 1.5,
  bay: 0.018,
  /** The beach's rise inland and the sea floor's fall offshore, per unit; the floor further out. */
  beach: 0.15,
  seabed: 0.2,
  floor: -0.95,
  /** Where it hands over to the mountain: inland (world z) and to the sides (|x|). */
  inland: [-26, -10] as const,
  side: [20, 34] as const,
} as const;
/** The two rocky points framing the cove: from their root on the land to their tip out at sea. */
const CAPES = [
  { root: [-12, -5], tip: [-15.5, 17], width: [5, 2.6], height: 5.2 },
  { root: [12.5, -4], tip: [16, 15.5], width: [4.6, 2.4], height: 6.2 },
] as const;

const coveJS = (x: number, z: number, base: number) => {
  const s = COVE.shore + COVE.bay * x * x - z;
  let shaped = s > 0 ? SEA_LEVEL + COVE.beach * s : Math.max(SEA_LEVEL + COVE.seabed * s, COVE.floor);
  for (const cape of CAPES) {
    const dx = cape.tip[0] - cape.root[0];
    const dz = cape.tip[1] - cape.root[1];
    const length2 = dx * dx + dz * dz;
    const u = THREE.MathUtils.clamp(((x - cape.root[0]) * dx + (z - cape.root[1]) * dz) / length2, 0, 1);
    const v = Math.hypot(x - (cape.root[0] + dx * u), z - (cape.root[1] + dz * u));
    const width = cape.width[0] + (cape.width[1] - cape.width[0]) * u;
    const across = Math.max(1 - (v / width) ** 2, 0) ** 0.45;
    const along = (1 - u ** 2.5) * (0.82 + 0.18 * Math.sin(u * 9.4 + cape.root[0]));
    const rock = 0.38 * Math.sin(x * 1.7 + z * 0.9) * Math.sin(z * 1.3 - x * 1.1) + 0.2 * Math.sin(x * 3.1 - z * 2.3);
    shaped = Math.max(shaped, SEA_LEVEL - 0.6 + (cape.height + 0.6 + rock) * along * across);
  }
  const mask = smoothJS(z, COVE.inland[0], COVE.inland[1]) * (1 - smoothJS(Math.abs(x), COVE.side[0], COVE.side[1]));
  return base + ((s > 0 ? Math.max(base, shaped) : shaped) - base) * mask;
};
const coveNode = (x: THREE.Node<'float'>, z: THREE.Node<'float'>, base: THREE.Node<'float'>) => {
  const s = x.mul(x).mul(COVE.bay).add(COVE.shore).sub(z);
  let shaped: THREE.Node<'float'> = s.greaterThan(0).select(s.mul(COVE.beach).add(SEA_LEVEL), max(s.mul(COVE.seabed).add(SEA_LEVEL), COVE.floor));
  for (const cape of CAPES) {
    const dx = cape.tip[0] - cape.root[0];
    const dz = cape.tip[1] - cape.root[1];
    const length2 = dx * dx + dz * dz;
    const u = clamp(x.sub(cape.root[0]).mul(dx).add(z.sub(cape.root[1]).mul(dz)).div(length2), 0, 1);
    const v = vec2(x.sub(u.mul(dx).add(cape.root[0])), z.sub(u.mul(dz).add(cape.root[1]))).length();
    const width = u.mul(cape.width[1] - cape.width[0]).add(cape.width[0]);
    const across = max(float(1).sub(v.div(width).pow(2)), 0).pow(0.45);
    const along = float(1).sub(u.pow(2.5)).mul(sin(u.mul(9.4).add(cape.root[0])).mul(0.18).add(0.82));
    const rock = sin(x.mul(1.7).add(z.mul(0.9))).mul(sin(z.mul(1.3).sub(x.mul(1.1)))).mul(0.38).add(sin(x.mul(3.1).sub(z.mul(2.3))).mul(0.2));
    shaped = max(shaped, rock.add(cape.height + 0.6).mul(along).mul(across).add(SEA_LEVEL - 0.6));
  }
  const mask = smoothstep(COVE.inland[0], COVE.inland[1], z).mul(float(1).sub(smoothstep(COVE.side[0], COVE.side[1], x.abs())));
  return mix(base, s.greaterThan(0).select(max(base, shaped), shaped), mask);
};

/** Ground height at a point of the world (x, z). */
export const groundAt = (x: number, z: number) => {
  const r = Math.hypot(x, z - SUMMIT_Z);
  const away = Math.max(r - TOP_RADIUS, 0) / MOUNTAIN_RADIUS;
  return coveJS(x, z, SUMMIT_HEIGHT * Math.max(1 - away, 0) ** STEEPNESS + reliefJS(x, z, r));
};
/**
 * Same, in a shader: written once in each shader as a function of its own, then called,
 * rather than repeated wherever the ground is read (several times per material): the
 * shaders stay small and are ready sooner.
 */
const groundFn = Fn(([x, z]: [THREE.Node<'float'>, THREE.Node<'float'>]) => {
  const r = vec2(x, z.sub(SUMMIT_Z)).length();
  const away = max(r.sub(TOP_RADIUS), 0).div(MOUNTAIN_RADIUS);
  return coveNode(x, z, clamp(float(1).sub(away), 0, 1).pow(STEEPNESS).mul(SUMMIT_HEIGHT).add(reliefNode(x, z, r)));
}).setLayout({ name: 'keysGround', type: 'float', inputs: [{ name: 'x', type: 'float' }, { name: 'z', type: 'float' }] });
export const groundNode = (x: THREE.Node<'float'>, z: THREE.Node<'float'>): THREE.Node<'float'> => groundFn(x, z) as THREE.Node<'float'>;
/** Distance from the summit's centre at which the ground stands at height h. */
export const radiusAtHeight = (h: number) =>
  TOP_RADIUS + (1 - Math.min(Math.max(h / SUMMIT_HEIGHT, 0), 1) ** (1 / STEEPNESS)) * MOUNTAIN_RADIUS;
export { SUMMIT_Z };

/** Height between two contour lines, on the field during the climb and on the relief. */
export const CONTOUR_STEP = 2.5;

/** Ground height on the route's centre line at distance p. */
export const heightAt = (p: number) => groundAt(centerX(p), -p);

export interface TrajectoryPoint {
  /** The guide's sideways offset from the route's centre line. */
  x: number;
  /** Distance travelled along the path. */
  d: number;
}

/** Sideways offset at distance d, from a recorded trajectory (sorted by d). */
export function lateralAt(trajectory: TrajectoryPoint[], d: number): number {
  if (trajectory.length === 0) return 0;
  let lo = 0;
  let hi = trajectory.length - 1;
  if (d <= trajectory[lo].d) return trajectory[lo].x;
  if (d >= trajectory[hi].d) return trajectory[hi].x;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trajectory[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = trajectory[lo];
  const b = trajectory[hi];
  return a.x + (b.x - a.x) * ((d - a.d) / Math.max(b.d - a.d, 1e-6));
}
