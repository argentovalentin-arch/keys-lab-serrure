import * as THREE from 'three/webgpu';
import { float, mx_noise_float, uniform } from 'three/tsl';

/**
 * The door building itself up, and the open door dissolving into particles. One field,
 * `dissolveField`, decides when each point of the door comes and goes: the metal and
 * wood surfaces (door.ts, keyMesh.ts) are drawn there or not, and the particles sampled
 * at that same point (particles.ts) are released when it goes. All read it in the door
 * leaf's own space, so the surface and its particles stay in step whatever the door's position.
 *
 * The field runs from the free edge (0) to the hinge (1), broken up by noise, so the
 * front is ragged and organic: never a straight cut, never whole blocks. The door builds
 * from the hinge to the free edge and dissolves the other way: what comes last goes first.
 */

/** Progress of the dissolve: below 0 nothing has gone, above 1 + PARTICLE_LIFE all is gone. */
export const dissolveProgress = uniform(-1);
/** Build front, falling from above 1 (nothing drawn) to below 0 (all drawn); see setBuild. */
export const buildFront = uniform(2);
/** Door leaf world matrix, and its inverse (world -> leaf space). */
export const leafMatrix = uniform(new THREE.Matrix4());
export const leafInverse = uniform(new THREE.Matrix4());

/** Width of the glowing band along the dissolving front, in field units. */
export const DISSOLVE_EDGE = 0.07;
/** How long a released particle lives, in field units of progress. */
export const PARTICLE_LIFE = 0.32;

/** 0 = no door yet, 1 = the whole door drawn. The front runs past both ends of the field. */
export function setBuild(amount: number): void {
  buildFront.value = 1 + DISSOLVE_EDGE - amount * (1 + 2 * DISSOLVE_EDGE);
}

/** `local` is a leaf-space position (x through the door, z from the hinge edge). */
export function dissolveField(local: THREE.Node<'vec3'>, leafWidth: number) {
  const fromFreeEdge = float(1).sub(local.z.div(leafWidth).clamp(0, 1));
  const grain = mx_noise_float(local.mul(1.7)).mul(0.5).add(0.5);
  return fromFreeEdge.mul(0.7).add(grain.mul(0.3));
}
