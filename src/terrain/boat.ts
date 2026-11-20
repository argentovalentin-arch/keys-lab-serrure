import * as THREE from 'three/webgpu';
import { color, exp, float, mix, normalView, pow, smoothstep, uniform, uv, vec2 } from 'three/tsl';
import { SEA_LEVEL, waveAt } from './coast';
import { BRAND, LAB } from '../core/brand';

/**
 * The boat that takes the visitor from the door to the shore: a pointu, the double-ended
 * wooden boat of the Corsican and Provençal coasts, its stem rising at the bow. Drawn in the
 * Lab's own matter: a dark hull, its planks lit by fine points of light, its gunwales, frames
 * and bow post in champagne hairlines, a lantern on the bow post.
 *
 * The visitor sits near the stern, looking over the bow: the hull's inside, the two
 * gunwales running to the stem, the thwarts. It rides the swell it floats on (coast.ts):
 * it rises and falls, pitches and rolls a little, all of it gently.
 *
 * Boat space: x across (starboard +), y up from the waterline, z along with the bow at -z.
 */

export const BOAT = { length: 4.6, beam: 1.56, depth: 0.62 };
/** Where the visitor's eye sits in the boat (boat space): near the stern, seated. */
export const EYE = new THREE.Vector3(0, 0.98, 1.25);

const U = 56;
const V = 28;
const half = (s: number) => (BOAT.beam / 2) * Math.pow(Math.max(1 - Math.pow(Math.abs(s), 2.4), 0), 0.62);
const sheer = (s: number) => BOAT.depth * 0.62 + 0.16 * s * s + 0.07 * Math.max(s, 0);
const keel = (s: number) => -BOAT.depth * 0.42 * (1 - Math.pow(Math.abs(s), 3)) + 0.05;
/** A point of the hull: s from stern (-1) to bow (1), v from port gunwale (-1) to starboard (1) through the keel. */
function hullPoint(s: number, v: number, inset = 0): THREE.Vector3 {
  const a = (v * Math.PI) / 2;
  const w = Math.max(half(s) - inset, 0);
  const y = keel(s) + (sheer(s) - keel(s)) * Math.pow(1 - Math.cos(a), 0.72) + inset * 0.6;
  return new THREE.Vector3(w * Math.sin(a), y, -s * (BOAT.length / 2));
}

export function createBoat(scene: THREE.Scene) {
  const group = new THREE.Group();
  const shown = uniform(1);

  // ---- The hull: one surface, dark, its planks lit by points of light.
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= U; i++) {
    const s = (i / U) * 2 - 1;
    for (let j = 0; j <= V; j++) {
      const v = (j / V) * 2 - 1;
      const p = hullPoint(s, v);
      positions.push(p.x, p.y, p.z);
      uvs.push(i / U, j / V);
    }
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j;
      const b = a + V + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const hullGeometry = new THREE.BufferGeometry();
  hullGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  hullGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  hullGeometry.setIndex(index);
  hullGeometry.computeVertexNormals();
  const hullMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  // Planks: seams running along the hull; on them, fine points of light.
  const plank = uv().y.mul(12).fract();
  const seam = smoothstep(0.06, 0, plank).add(smoothstep(0.94, 1, plank));
  const dots = smoothstep(0.24, 0.06, uv().mul(vec2(120, 18)).fract().sub(0.5).length());
  const rim = pow(float(1).sub(normalView.z.abs()), 2);
  hullMaterial.colorNode = mix(color(BRAND.navy).mul(0.62), color(LAB.dust), dots.mul(0.2).add(seam.mul(0.12)).add(rim.mul(0.08)))
    .mul(shown);
  const hull = new THREE.Mesh(hullGeometry, hullMaterial);
  hull.renderOrder = -1;
  group.add(hull);

  // ---- Lines of light: the gunwales, the frames, the bow post, the thwarts.
  const lines: THREE.Mesh[] = [];
  const lineMaterial = (strength: number) => {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const edge = pow(float(1).sub(normalView.z.abs()), 0.6);
    material.colorNode = color(BRAND.champagne).mul(strength);
    material.opacityNode = edge.mul(0.5).add(0.5).mul(shown);
    return material;
  };
  const rail = lineMaterial(1.5);
  const frame = lineMaterial(0.75);
  const tube = (points: THREE.Vector3[], radius: number, material: THREE.Material) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 3), radius, 6, false), material);
    lines.push(mesh);
    group.add(mesh);
  };
  for (const side of [-1, 1]) {
    tube(Array.from({ length: 41 }, (_, k) => hullPoint(k / 20 - 1, side, 0.02).add(new THREE.Vector3(0, 0.015, 0))), 0.024, rail);
  }
  // Frames, every few planks, across the inside.
  for (let i = 1; i < 11; i++) {
    const s = (i / 11) * 2 - 1;
    tube(Array.from({ length: 13 }, (_, k) => hullPoint(s, (k / 12) * 2 - 1, 0.035)), 0.011, frame);
  }
  // The keel line and the stems, bow and stern; the bow post rising above the gunwales.
  tube(Array.from({ length: 21 }, (_, k) => hullPoint(k / 10 - 1, 0, 0.03)), 0.013, frame);
  const bowTop = new THREE.Vector3(0, sheer(1) + 0.34, -BOAT.length / 2 - 0.1);
  tube([hullPoint(1, 0), new THREE.Vector3(0, sheer(1) - 0.05, -BOAT.length / 2 - 0.04), bowTop], 0.03, rail);
  tube([hullPoint(-1, 0), new THREE.Vector3(0, sheer(-1) + 0.08, BOAT.length / 2 + 0.05)], 0.026, rail);
  // Two thwarts (seats), planks across, lit along their edges.
  const thwartMaterial = new THREE.MeshBasicNodeMaterial();
  thwartMaterial.colorNode = color(BRAND.navy).mul(0.8).mul(shown);
  const thwarts = [0.22, -0.3].map((s) => {
    const width = half(s) * 2 - 0.1;
    const y = sheer(s) - 0.2;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, 0.24), thwartMaterial);
    seat.position.set(0, y, -s * (BOAT.length / 2));
    group.add(seat);
    for (const dz of [-0.12, 0.12]) {
      tube([new THREE.Vector3(-width / 2, y + 0.022, -s * (BOAT.length / 2) + dz), new THREE.Vector3(width / 2, y + 0.022, -s * (BOAT.length / 2) + dz)], 0.008, frame);
    }
    return seat;
  });

  // ---- The lantern on the bow post: a warm point of light, breathing.
  const lanternMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const r = uv().sub(0.5).length().mul(2);
  lanternMaterial.colorNode = color(LAB.light).mul(1.8);
  lanternMaterial.opacityNode = exp(r.mul(r).mul(-6)).mul(smoothstep(1, 0.7, r)).mul(shown);
  const lantern = new THREE.Sprite(lanternMaterial);
  lantern.position.copy(bowTop).add(new THREE.Vector3(0, 0.08, 0));
  lantern.scale.setScalar(0.42);
  group.add(lantern);

  group.visible = false;
  scene.add(group);

  const bowPoint = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  return {
    group,
    /**
     * Where it is this frame: on the water at (x, z), heading along `heading` (radians, 0 =
     * towards -z), riding the swell at time t; `aground` (0..1) settles it on the shore;
     * `swell` (0..1) how much it rides the waves (less with reduced motion).
     */
    place(x: number, z: number, heading: number, t: number, aground = 0, level = SEA_LEVEL, lanternSize = 0.42, swell = 1) {
      const fx = Math.sin(heading);
      const fz = -Math.cos(heading);
      const L = BOAT.length * 0.42;
      const W = BOAT.beam * 0.4;
      const bow = waveAt(x + fx * L, z + fz * L, t);
      const stern = waveAt(x - fx * L, z - fz * L, t);
      const port = waveAt(x - fz * W, z + fx * W, t);
      const starboard = waveAt(x + fz * W, z - fx * W, t);
      const ride = (1 - aground) * swell;
      const lift = ((bow + stern + port + starboard) / 4) * 0.85 * ride;
      group.position.set(x, level + lift + aground * 0.08, z);
      euler.set(Math.atan2(bow - stern, 2 * L) * 0.7 * ride + aground * 0.04, heading, Math.atan2(port - starboard, 2 * W) * 0.55 * ride);
      group.rotation.copy(euler);
      group.updateMatrixWorld();
      lantern.scale.setScalar(lanternSize * (0.92 + 0.08 * Math.sin(t * 2.3)));
    },
    /** The visitor's eye in the boat, in the world (it bobs with the boat, but does not roll with it). */
    eye(target: THREE.Vector3) {
      target.copy(EYE).applyMatrix4(group.matrixWorld);
      return target;
    },
    /** The bow, in the world. */
    bow() {
      return bowPoint.set(0, sheer(1), -BOAT.length / 2).applyMatrix4(group.matrixWorld);
    },
    setShown(amount: number) {
      shown.value = amount;
      group.visible = amount > 0.001;
    },
    dispose() {
      hullGeometry.dispose();
      hullMaterial.dispose();
      for (const mesh of lines) mesh.geometry.dispose();
      for (const seat of thwarts) seat.geometry.dispose();
      [rail, frame, thwartMaterial, lanternMaterial].forEach((m) => m.dispose());
    },
  };
}

export type Boat = ReturnType<typeof createBoat>;
