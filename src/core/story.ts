import * as THREE from 'three/webgpu';
import { DOOR_X } from '../world/door';
import { PARTICLE_LIFE } from '../world/dissolve';

/**
 * The whole experience is driven by one number, the story position `s`:
 * 0 = noise, 1 = the key emerging from it, 2 = particle key, then metal, 3 = key turned
 * in the lock, 4 = door open.
 * Every function here turns `s` into the state of one element, so the scroll can
 * move both ways and the scene always matches it.
 */
export const STORY_END = 4;

const { clamp, smoothstep } = THREE.MathUtils;
/** 0 before `from`, 1 after `to`, eased in between. */
const span = (s: number, from: number, to: number) => smoothstep(s, from, to);

export interface StoryState {
  /** Particle shape: 0 noise, 2 key, the key emerging in between. */
  morph: number;
  /** 1 once the particles have left the key for the door, ready to break it up. */
  flow: number;
  /** Particle opacity; they hand over to the metal key, then come back as the door breaks up. */
  particles: number;
  /** How much the slow idle sway of the particle shapes applies. */
  sway: number;
  /**
   * Share of the key that is solid metal, from the tip back to the bow. Once the
   * particle silhouette is complete it turns into the modelled key, in place, while the
   * camera moves round to show its depth; only then does it go into the lock.
   */
  solid: number;
  /** Wall and casing opacity. */
  door: number;
  /** The door building itself up, 0 to 1 (see dissolve.ts). */
  build: number;
  /** Key travel into the lock, in scene units. */
  insert: number;
  /** Size of the metal key, around the keyhole: it shrinks before it turns. */
  keyScale: number;
  /** Key and plug rotation, radians. */
  turn: number;
  /** Door opening angle, radians. */
  open: number;
  glow: number;
  /** Progress of the open door dissolving into particles (see dissolve.ts). */
  dissolve: number;
}

// The tip ends inside the door (front face at DOOR_X, 0.3 thick) without coming out at the back.
const INSERT_DEPTH = 0.5;
// The door swings away from the viewer, almost fully open.
export const OPEN_ANGLE = 1.7;
// Once in the lock, the key settles to half its size before it turns. Full size, it sticks
// out of the lock by almost five units: turning, its bits would cut through the lock plate,
// and with the door opening, its bow would sweep through the wall beside the doorway.
// Measured over the whole turn and opening, it clears both from 0.6 down; 0.5 keeps a margin.
const KEY_OPEN_SCALE = 0.5;

export function storyAt(s: number): StoryState {
  const insertion = span(s, 2.55, 2.82);
  return {
    morph: clamp(s, 0, 2),
    flow: s >= 3 ? 1 : 0,
    // The particles stay until the key is fully in; the solid front hides them as it moves
    // (and has passed them all before the insertion starts).
    // They come back on the door, each one showing only as the dissolve releases it.
    particles: 1 - span(s, 2.8, 2.82) + span(s, 3.6, 3.62),
    sway: 1 - span(s, 1.4, 2),
    solid: span(s, 2.05, 2.45),
    door: span(s, 2.15, 2.6),
    // While the wall fades in; complete just before the key reaches the lock.
    build: span(s, 2.15, 2.52),
    insert: insertion * INSERT_DEPTH,
    keyScale: 1 - span(s, 2.82, 2.9) * (1 - KEY_OPEN_SCALE),
    turn: span(s, 2.9, 3) * (Math.PI / 2),
    open: span(s, 3.05, 3.65) * OPEN_ANGLE,
    glow: span(s, 3.05, 3.5),
    // Once the door is fully open: from just before the first point goes to just
    // after the last particle has faded.
    dissolve: span(s, 3.66, 3.98) * (1 + PARTICLE_LIFE + 0.04) - 0.02,
  };
}

interface Shot {
  at: number;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

// Camera: face-on for the particle chapters, three-quarter view to see the key go
// into the lock, then a slow push towards the doorway.
const SHOTS: Shot[] = [
  { at: 2, position: new THREE.Vector3(0, 0, 10), target: new THREE.Vector3(0, 0, 0) },
  { at: 2.7, position: new THREE.Vector3(-4.6, 2.2, 7.2), target: new THREE.Vector3(1.4, 0, 0) },
  { at: 3.1, position: new THREE.Vector3(-4.2, 1.8, 6.4), target: new THREE.Vector3(1.8, 0, 0) },
  // Last shot: the doorway full of light, and the open door with the key still in its lock.
  { at: 4, position: new THREE.Vector3(-3.6, 1.1, 5.4), target: new THREE.Vector3(DOOR_X + 1, 0, 0.6) },
];

/**
 * Camera position and target for story position `s`. `distanceScale` pushes the
 * camera back along its line of sight (portrait screens need more room).
 */
export function cameraAt(s: number, distanceScale: number, position: THREE.Vector3, target: THREE.Vector3): void {
  let i = 0;
  while (i < SHOTS.length - 2 && s > SHOTS[i + 1].at) i++;
  const a = SHOTS[i];
  const b = SHOTS[i + 1];
  const t = span(s, a.at, b.at);
  target.lerpVectors(a.target, b.target, t);
  position.lerpVectors(a.position, b.position, t).sub(target).multiplyScalar(distanceScale).add(target);
}
