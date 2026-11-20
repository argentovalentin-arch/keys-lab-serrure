import * as THREE from 'three/webgpu';
import { cos, float, sin, vec3 } from 'three/tsl';

/**
 * The coast: what the sea, the boat and the islands share, so that the sea crossed at the
 * start and the sea seen from the summit are one and the same.
 *
 * The mountain (path.ts) rises out of the sea: its foot, where the ground falls to sea
 * level, is the shore where the boat lands and the path begins. Behind the start, out to
 * sea (+z), lie the Parata headland and the Îles Sanguinaires, against the last light of
 * the day: what the visitor sees first from the boat, and finds again from the summit, in
 * the same direction, after the climb (islands.ts).
 */

/** Height of the sea's surface at rest (world units): the shore is where the ground meets it. */
export const SEA_LEVEL = 0.45;

/**
 * The swell: a few long, slow waves crossing each other, as on a calm evening at sea. The
 * same sums in the shaders (sea.ts) and on the CPU (the boat), so the boat rides the
 * waves it floats on.
 */
const WAVES = [
  { dir: [0.8, 0.6], length: 14, height: 0.2, speed: 0.85 },
  { dir: [-0.5, 0.866], length: 8.5, height: 0.12, speed: 1.2 },
  { dir: [0.196, -0.98], length: 4.6, height: 0.06, speed: 1.7 },
  { dir: [0.954, -0.3], length: 2.7, height: 0.028, speed: 2.3 },
].map((w) => ({ ...w, k: (Math.PI * 2) / w.length }));

/** Wave height at (x, z) and time t (seconds), on the CPU. */
export function waveAt(x: number, z: number, t: number): number {
  let h = 0;
  for (const w of WAVES) h += w.height * Math.sin(w.k * (w.dir[0] * x + w.dir[1] * z) - w.speed * t);
  return h;
}

/** Wave height and its slope (d/dx, d/dz) at a point, in a shader. */
export function waveNode(x: THREE.Node<'float'>, z: THREE.Node<'float'>, t: THREE.Node<'float'>) {
  let h: THREE.Node<'float'> = float(0);
  let dx: THREE.Node<'float'> = float(0);
  let dz: THREE.Node<'float'> = float(0);
  for (const w of WAVES) {
    const phase = x.mul(w.k * w.dir[0]).add(z.mul(w.k * w.dir[1])).sub(t.mul(w.speed));
    h = h.add(sin(phase).mul(w.height));
    const c = cos(phase).mul(w.height * w.k);
    dx = dx.add(c.mul(w.dir[0]));
    dz = dz.add(c.mul(w.dir[1]));
  }
  return { height: h, normal: vec3(dx.negate(), 1, dz.negate()).normalize() };
}

/**
 * The landing stage, where the boat comes alongside (pier.ts): on the route's axis, from the
 * beach (world z, where its deck meets the sand, path.ts COVE) out over the water; its deck's
 * height and half-width. The boat comes in on its left (port) side and stops alongside.
 */
export const PIER = {
  land: -1.3,
  sea: 16.5,
  deck: SEA_LEVEL + 0.42,
  half: 0.85,
  /** Where the boat comes to rest: its middle's distance along the path (-z), and its line (x). */
  moor: -13,
  side: -1.78,
} as const;

/**
 * The last light of the day, low over the sea beyond the islands (+z): where the sun has
 * just set, behind the Sanguinaires. Its direction (from the scene towards it).
 */
export const DUSK = new THREE.Vector3(0.12, 0.05, 1).normalize();
