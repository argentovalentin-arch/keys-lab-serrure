import * as THREE from 'three/webgpu';
import { abs, color, float, max, normalLocal, positionLocal, smoothstep, uniform, vec2 } from 'three/tsl';
import { centerX, groundAt, headingAt } from './path';

const BRICK = { length: 0.56, height: 0.2, depth: 0.28, gap: 0.035 };
const COURSES = 3;
/** Brick by brick, the build runs this far ahead of the guide at most… */
const LEAD = 22;
/** …catching up with it from the landmark this many times faster than the guide moves. */
const CATCH_UP = 2.2;
/** Each course follows the one under it by this much path. */
const COURSE_DELAY = 2.6;
/** Distance over which a brick comes down into its place. */
const SETTLE_OVER = 3.2;

/** Spacing of the points that make up a brick's faces. */
const DOT = 0.05;

export interface WallOptions {
  /** Path stretch the walls line (distances along the path), and stretches left open. */
  from: number;
  /** Guide distance from which the walls build (« Clarifier les fondations », notes.ts). */
  startAt: number;
  to: number;
  gaps: [number, number][];
  /** How far from the route's centre line they stand, on both sides. */
  offset: number;
}

/**
 * Foundation walls along the path, up to « Performer »: low walls of bricks made of
 * points of light, like the rest of the Terrain, three courses, on both sides, following
 * the ground.
 * They build up as the visitor climbs: a build front runs ahead of the guide, and every
 * brick it reaches comes down into its place, course after course, briefly lit as it
 * settles. Behind the visitor the walls stay. Clear of the lane, the levers and the
 * landmarks' dials (left open around them), and low, under the notes and the titles.
 */
export function createWalls(scene: THREE.Scene, { from, startAt, to, gaps, offset }: WallOptions) {
  interface Brick { p: number; course: number; side: number; place: THREE.Vector3; yaw: number; progress: number }
  const bricks: Brick[] = [];
  const step = BRICK.length + BRICK.gap;
  for (const side of [-1, 1]) {
    for (let course = 0; course < COURSES; course++) {
      for (let p = from + (course % 2) * step * 0.5; p <= to; p += step) {
        if (gaps.some(([a, b]) => p > a && p < b)) continue;
        const heading = headingAt(p);
        const x = centerX(p) + side * offset * Math.cos(heading);
        const z = -p + side * offset * Math.sin(heading);
        const y = groundAt(x, z) + BRICK.height / 2 + course * (BRICK.height + 0.02);
        bricks.push({ p, course, side, place: new THREE.Vector3(x, y, z), yaw: -heading, progress: -1 });
      }
    }
  }

  const shown = uniform(1);
  // Each face is a grid of soft points (in the brick's own space, so every face has the
  // same spacing), with the edges a touch brighter: the brick shape reads, made of particles.
  // Additive and see-through, like the field's particles.
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const n = abs(normalLocal);
  const across = n.x.greaterThan(0.5).select(positionLocal.zy, n.y.greaterThan(0.5).select(positionLocal.xz, positionLocal.xy));
  const point = smoothstep(0.26, 0.1, across.div(DOT).fract().sub(0.5).length());
  const half = vec2(BRICK.length / 2, BRICK.height / 2);
  const toEdge = max(abs(positionLocal.x).div(half.x), abs(positionLocal.y).div(half.y));
  const edge = smoothstep(0.86, 1, toEdge);
  material.colorNode = color('#f4ecdc').mul(0.42);
  material.opacityNode = point.mul(float(0.22).add(edge.mul(0.5))).add(edge.mul(0.03)).mul(shown);
  const geometry = new THREE.BoxGeometry(BRICK.length, BRICK.height, BRICK.depth);
  const mesh = new THREE.InstancedMesh(geometry, material, bricks.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  bricks.forEach((_, i) => {
    mesh.setMatrixAt(i, hidden);
    mesh.setColorAt(i, tint.setScalar(1));
  });

  return {
    /** From the guide's distance: brings in the bricks the build front has reached. */
    update(distance: number) {
      const front = distance < startAt ? -Infinity : Math.min(from + (distance - startAt) * CATCH_UP, distance + LEAD);
      let changed = false;
      bricks.forEach((brick, i) => {
        const start = brick.p + brick.course * COURSE_DELAY + (brick.side > 0 ? 0.9 : 0);
        const progress = THREE.MathUtils.clamp((front - start) / SETTLE_OVER, 0, 1);
        if (progress === brick.progress) return;
        brick.progress = progress;
        changed = true;
        if (progress === 0) {
          mesh.setMatrixAt(i, hidden);
          return;
        }
        // Down from above and slightly outside, turning into line, growing to size.
        const e = 1 - (1 - progress) ** 3;
        const away = 1 - e;
        position.copy(brick.place);
        position.y += away * 1.6;
        position.x += Math.cos(-brick.yaw) * brick.side * away * 0.6;
        position.z += Math.sin(-brick.yaw) * brick.side * away * 0.6;
        rotation.setFromEuler(euler.set(away * 0.5 * brick.side, brick.yaw + away * 0.4, 0));
        scale.setScalar(0.55 + 0.45 * e);
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
        // Lit as it lands, then its own colour.
        mesh.setColorAt(i, tint.setScalar(1 + 1.2 * Math.sin(Math.PI * Math.min(progress * 1.25, 1))));
      });
      if (changed) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
    /** 0..1: the walls fade for the view back from the summit, where the ground deepens. */
    setShown(amount: number) {
      shown.value = amount;
      mesh.visible = amount > 0.001;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
