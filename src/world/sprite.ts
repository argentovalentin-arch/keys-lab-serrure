import * as THREE from 'three/webgpu';
import { cos, exp, float, length, mix, smoothstep, uv } from 'three/tsl';

/**
 * The look of one particle, shared by the story (particles.ts) and the Terrain: a small,
 * crisp, bright core in a faint halo, like a point of light, rather than a flat disc
 * blurred to its edge, which reads as grey fuzz once thousands of them overlap.
 *
 * `alpha` is the particle's coverage (to multiply into the opacity), `core` how much of
 * the fragment is the core (for a whiter centre). The sprite is drawn larger than the old
 * disc (SPRITE_GROWTH) so the halo has room; the core stays about the old dot's size.
 */
export const SPRITE_GROWTH = 1.45;

export function particleShape() {
  const d = length(uv().sub(0.5)).mul(2); // 0 at the centre, 1 at the sprite's edge
  const core = smoothstep(0.34, 0.04, d);
  const halo = exp(d.mul(d).mul(-7)).mul(smoothstep(1, 0.72, d));
  return { core, alpha: core.mul(0.85).add(halo.mul(0.38)) };
}

/** Slow, gentle shimmer, each particle at its own pace (seed in 0..1). */
export function twinkle(time: THREE.Node<'float'>, seed: THREE.Node<'float'>, depth = 0.22) {
  return float(1 - depth).add(cos(time.mul(seed.mul(1.6).add(0.6)).add(seed.mul(40))).mul(0.5).add(0.5).mul(depth));
}

/** Whiter at the core, the given colour in the halo. */
export function coreColor(base: THREE.Node<'vec3'>, core: THREE.Node<'float'>) {
  return mix(base, base.mul(0.35).add(0.68), core.mul(0.55));
}
