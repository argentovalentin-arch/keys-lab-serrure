import { cameraPosition, exp, float, mix, smoothstep, vec3 } from 'three/tsl';
import type * as THREE from 'three/webgpu';
import { DOOR_X, LEAF } from './door';

/**
 * The doorway as the way out of the light: the one opening every particle leaving the
 * light goes through. Behind the wall (x > `back`) a particle is in the doorway's light;
 * in front of it (x < `front`) it is out in the visitor's world. The clear part of the
 * opening is a little smaller than the opening itself (6 high, 4 wide), so that nothing,
 * sprite size and turbulence included, ever passes behind the wall or its jambs.
 */
export const APERTURE = {
  front: DOOR_X,
  back: DOOR_X + LEAF.thickness,
  clearY: 2.7,
  clearZ: 1.75,
};
/**
 * Where a particle is free: this far in front of the wall's face (and of its casing), so a
 * particle spreading along the wall never brushes it, and is never cut by it.
 */
const EXIT = 0.24;
/** Over this much path after the exit, a particle turns from straight out to its own way. */
const TURN = 0.55;

/**
 * `value` brought within about ±`limit`, smoothly: near the centre it is unchanged, and
 * towards the edge it bends in, so particles drawn in to the opening never pile up on one
 * line (a hard clamp would flatten them into a visible edge).
 */
const softLimit = (value: THREE.Node<'float'>, limit: number) =>
  value.div(float(1).add(value.abs().div(limit).pow(4)).pow(0.25));

/**
 * The way a particle goes once out of the doorway: a direction in space, not a cone along
 * the door's axis. `turn` (0..1) picks it round the opening (up, down, left, right…);
 * `lateral` says how much it goes that way for each unit it comes forward: below 1 it comes
 * on towards the visitor, above 2 it spreads along the wall, past the jambs and over the
 * lintel, far beyond the door's outline. A little lift (warm light rises), and a share of
 * where in the opening it came from (the top ones go up, the side ones out to their side).
 */
export function outward(
  turn: THREE.Node<'float'>, lateral: THREE.Node<'float'>, from: THREE.Node<'vec3'>, fromOpening: THREE.Node<'float'> | number = 1,
) {
  const angle = turn.mul(Math.PI * 2);
  const share = typeof fromOpening === 'number' ? float(fromOpening) : fromOpening;
  return vec3(
    -1,
    angle.sin().mul(lateral).add(float(0.3).add(from.y.div(APERTURE.clearY).mul(0.5)).mul(share)),
    angle.cos().mul(lateral).add(from.z.div(APERTURE.clearZ).mul(0.5).mul(share)),
  ).normalize();
}

/**
 * 0..1: how much a point is seen against the doorway's light, from the camera. The ray from
 * the eye through the point is followed to the wall's plane: if it meets it in the opening,
 * the light is what lies behind the point (whether the point is in the doorway or out in
 * front of it). Soft at the opening's edges.
 */
export function againstLight(position: THREE.Node<'vec3'>) {
  const ray = position.sub(cameraPosition);
  const along = float(APERTURE.front).sub(cameraPosition.x).div(ray.x.max(0.0001));
  const hit = cameraPosition.add(ray.mul(along));
  return smoothstep(3.25, 2.75, hit.y.abs()).mul(smoothstep(2.25, 1.75, hit.z.abs()))
    .mul(ray.x.greaterThan(0).select(float(1), float(0)));
}

/**
 * A path out of the light, in two parts, so the opening never acts as a limit:
 * - from `start` (in the doorway's light, behind the wall) the particle comes straight out
 *   towards the visitor (-x), drawn in to the opening's clear part on its way, as a flow
 *   does towards an aperture: the only part of its path the wall constrains;
 * - once out (EXIT in front of the wall), it is free: it turns, over TURN, to its own
 *   `direction` (see outward) and keeps going that way, past the door's outline on any
 *   side, as far as it travels.
 * `travelled` is the length of path it has covered. Returns its position and how far it is
 * past the exit.
 */
export function throughDoorway(start: THREE.Node<'vec3'>, travelled: THREE.Node<'float'>, direction: THREE.Node<'vec3'>) {
  const exitX = APERTURE.front - EXIT;
  const toExit = start.x.sub(exitX).max(0.001);
  const inside = travelled.min(toExit);
  const beyond = travelled.sub(toExit).max(0);
  // Drawing in over the way to the opening (at least half a unit, so it is never abrupt).
  const reach = smoothstep(0, 1, inside.div(toExit.max(0.5)).clamp(0, 1));
  const y = mix(start.y, softLimit(start.y, APERTURE.clearY), reach);
  const z = mix(start.z, softLimit(start.z, APERTURE.clearZ), reach);
  const exit = vec3(start.x.sub(inside), y, z);
  // Out: straight on at first, turning smoothly to its own way (the integral of a heading
  // that eases from -x to `direction`).
  const straight = vec3(-1, 0, 0);
  const turned = beyond.sub(float(TURN).mul(float(1).sub(exp(beyond.div(-TURN)))));
  const position = exit.add(straight.mul(beyond)).add(direction.sub(straight).mul(turned));
  return { position, beyond };
}
