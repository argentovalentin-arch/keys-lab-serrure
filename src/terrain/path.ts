import * as THREE from 'three/webgpu';
import { clamp, float, max, sin, smoothstep, vec2 } from 'three/tsl';

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
  { word: 'Structurer', step: 1, label: 'Les fondations', at: 60 },
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

/** Ground height at a point of the world (x, z). */
export const groundAt = (x: number, z: number) => {
  const away = Math.max(Math.hypot(x, z - SUMMIT_Z) - TOP_RADIUS, 0) / MOUNTAIN_RADIUS;
  return SUMMIT_HEIGHT * Math.max(1 - away, 0) ** STEEPNESS;
};
/** Same, in a shader. */
export const groundNode = (x: THREE.Node<'float'>, z: THREE.Node<'float'>) => {
  const away = max(vec2(x, z.sub(SUMMIT_Z)).length().sub(TOP_RADIUS), 0).div(MOUNTAIN_RADIUS);
  return clamp(float(1).sub(away), 0, 1).pow(STEEPNESS).mul(SUMMIT_HEIGHT);
};
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
