import * as THREE from 'three/webgpu';
import { color, float, hash, instanceIndex, mix, mx_noise_vec3, sin, smoothstep, uint, uniform, vec3 } from 'three/tsl';
import { DOOR_X } from './door';
import { SPRITE_GROWTH, coreColor, particleShape, twinkle } from './sprite';

/**
 * The open door's breath: a current of gold particles coming out of the doorway, out of
 * the light, towards the visitor, as if a whole world behind the door were spilling over.
 *
 * Each particle runs its own loop (no simulation, no buffer to update): it leaves from a
 * point inside the doorway, drifts out along a slow, curling path towards a point in front
 * of the visitor (or towards the pointer, which draws the current to it), and fades before
 * it gets there; then it starts again from the doorway. A loop takes several seconds and
 * every particle is at its own place in it, so the current is steady and never bursts.
 *
 * `intensity` comes from the light behind the door (story.ts, glow) and rises as the
 * visitor goes towards it (« Entrer »): the current thickens and brightens as they near.
 */
const DOORWAY = { halfHeight: 2.7, halfWidth: 1.75 };

export function createDoorStream(count: number, reducedMotion: boolean) {
  const time = uniform(0);
  const intensity = uniform(0);
  /** Where the current goes: in front of the visitor, or the pointer (world space). */
  const attract = uniform(new THREE.Vector3(-3, 1, 5));

  const seed = (k: number) => hash(instanceIndex.add(uint(count * k)));
  const rate = mix(0.075, 0.15, seed(1)).mul(reducedMotion ? 0.45 : 1);
  const t = time.mul(rate).add(seed(2)).fract();
  const eased = t.mul(t).mul(float(3).sub(t.mul(2)));
  // From inside the doorway, in the light…
  const start = vec3(
    seed(3).mul(1.6).add(DOOR_X + 0.5),
    seed(4).sub(0.5).mul(DOORWAY.halfHeight * 2),
    seed(5).sub(0.5).mul(DOORWAY.halfWidth * 2),
  );
  // …towards the visitor, fanning out past the door frame, over the dark wall where they
  // read (in front of the light itself they would vanish), never quite reaching them.
  const fan = seed(8).sub(0.5).mul(2);
  const spread = vec3(seed(6).sub(0.5).mul(2.5), seed(7).sub(0.5).mul(6.5), fan.mul(fan.abs().add(0.6)).mul(6.5));
  const target = attract.add(spread);
  const along = mix(start, target, eased.mul(0.78));
  // A slow curl, strongest mid-way: the current breathes rather than streams.
  const curl = mx_noise_vec3(start.mul(0.45).add(vec3(0, time.mul(0.08), time.mul(0.05)))).mul(reducedMotion ? 0.5 : 1.25)
    .mul(sin(t.mul(Math.PI)));

  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = along.add(curl);
  const shape = particleShape();
  material.colorNode = coreColor(mix(color('#ffd9a0'), color('#f4ecdc'), seed(9).mul(0.6)), shape.core);
  // In out of the light, out before the visitor; each at its own shimmer.
  const life = smoothstep(0, 0.14, t).mul(smoothstep(1, 0.62, t));
  material.opacityNode = shape.alpha.mul(life).mul(twinkle(time, seed(10), 0.35)).mul(intensity).mul(1.15);
  // A few larger motes among the fine dust; all a little larger as they come closer.
  material.scaleNode = float(0.03).add(seed(11).pow(5).mul(0.06)).mul(float(1).add(eased.mul(0.8))).mul(SPRITE_GROWTH);

  const object = new THREE.Sprite(material);
  object.count = count;
  object.frustumCulled = false;
  object.visible = false;

  return {
    object,
    time,
    intensity,
    attract,
    /** Fewer particles on lower quality tiers. */
    setCount(next: number) {
      object.count = Math.max(1, Math.min(count, next));
    },
    dispose() {
      // Not the geometry: every three.js Sprite shares one.
      material.dispose();
    },
  };
}
