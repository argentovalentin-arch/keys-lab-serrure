import * as THREE from 'three/webgpu';
import {
  attribute, clamp, color, cos, float, hash, instanceIndex, length, mix, positionLocal, sin, smoothstep, uint, uniform, uv, vec3,
} from 'three/tsl';
import {
  CONTOUR_STEP, END_AT, MOUNTAIN_RADIUS, PATH_HALF, SUMMIT_HEIGHT, SUMMIT_Z, centerX, centerXNode, groundAt,
  groundNode, lateralAt, type TrajectoryPoint,
} from './path';

const CREAM = '#f4ecdc';
const WARM = '#ffd9a0';
const LOW = '#8fa6c8'; // far below, in the haze
const TOP_RADIUS = 9; // as in path.ts: the flat top
const STEEPNESS = 1.6;
const JOURNEY_POINTS = 360;
const PLAIN_RINGS = 18;
const PLAIN_RING_STEP = 24;

/**
 * The whole mountain, fixed in place, for the view back from the summit. During the ride
 * the ground is a short treadmill band that only covers what is just ahead; turning round
 * at the top, the visitor needs to see everything down to the start.
 *
 * It is drawn the way a relief map is: most particles lie on contour lines, one every
 * CONTOUR_STEP of height, so the mountain's shape reads at once (rings tightening towards
 * the top, spreading at the foot). On it: the route's lane winding up, the visitor's own
 * line along it, and a column of light at the start, down in the valley.
 */
export function createRelief(scene: THREE.Scene, count: number) {
  const shown = uniform(0);
  // Depth: once the visitor has turned round on the summit, the mountain below deepens,
  // every point's drop from the top multiplied by this (1 = the ground as ridden), so the
  // start lies far down and the path visibly descends. The top itself does not move.
  const depth = uniform(1);
  const deepenNode = (y: THREE.Node<'float'>) => float(SUMMIT_HEIGHT).sub(float(SUMMIT_HEIGHT).sub(y).mul(depth));
  const laneCount = Math.floor(count * 0.25);
  const isLane = instanceIndex.lessThan(uint(laneCount));
  const seedA = hash(instanceIndex);
  const seedB = hash(instanceIndex.add(uint(count)));
  const seedC = hash(instanceIndex.add(uint(count * 2)));

  // Mountain particles: a point picked evenly over the mountain's footprint, then, for
  // most of them, pulled onto the nearest contour line (the ring at that height).
  const footprint = TOP_RADIUS + MOUNTAIN_RADIUS;
  const angle = seedA.mul(Math.PI * 2);
  const radius = seedB.sqrt().mul(footprint);
  const looseHeight = groundNode(cos(angle).mul(radius), sin(angle).mul(radius).add(SUMMIT_Z));
  const level = looseHeight.div(CONTOUR_STEP).add(0.5).floor().mul(CONTOUR_STEP).min(SUMMIT_HEIGHT);
  const levelRadius = float(1).sub(level.div(SUMMIT_HEIGHT).pow(1 / STEEPNESS)).mul(MOUNTAIN_RADIUS).add(TOP_RADIUS);
  const onContour = seedC.lessThan(0.78);
  const r = onContour.select(levelRadius, radius);
  const mountainX = cos(angle).mul(r);
  const mountainZ = sin(angle).mul(r).add(SUMMIT_Z);
  const mountainY = onContour.select(level, looseHeight);

  // Lane particles: along the route's centre line, from the start to the top.
  const p = seedA.mul(END_AT);
  const laneX = centerXNode(p).add(seedB.sub(0.5).mul(PATH_HALF * 2));
  const laneZ = p.negate();
  const laneY = groundNode(laneX, laneZ).add(0.12);

  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = vec3(
    isLane.select(laneX, mountainX),
    deepenNode(isLane.select(laneY, mountainY)),
    isLane.select(laneZ, mountainZ),
  );
  // Aerial perspective, as the mountain deepens: the lower, the paler and cooler, so the
  // eye reads the rings as lying further and further down rather than on one flat plane.
  const drop = float(SUMMIT_HEIGHT).sub(isLane.select(laneY, mountainY)).div(SUMMIT_HEIGHT).clamp(0, 1);
  const haze = drop.mul(clamp(depth.sub(1).mul(1.5), 0, 1));
  material.colorNode = mix(mix(color(CREAM), color(WARM), isLane.select(float(0.6), float(0))), color(LOW), haze.mul(0.55));
  const disc = clamp(float(1).sub(length(uv().sub(0.5)).mul(2)), 0, 1);
  // The lane fades over its last stretch, right under the camera on the summit, where
  // close-up particles would blot out the view rather than draw the route.
  const laneFade = float(1).sub(smoothstep(END_AT - 45, END_AT - 12, p)).max(0.15);
  const strength = isLane.select(laneFade.mul(0.85), onContour.select(float(1), float(0.25)));
  material.opacityNode = disc.mul(disc).mul(strength).mul(float(1).sub(haze.mul(isLane.select(float(0.2), float(0.35))))).mul(shown);
  // Seen from far up the mountain, the particles need to be larger than underfoot; the
  // contour lines most of all, as they draw the mountain's shape from a distance.
  material.scaleNode = isLane.select(float(0.16), onContour.select(float(0.24), float(0.13))).add(seedC.pow(6).mul(0.12));
  const points = new THREE.Sprite(material);
  points.count = count;
  points.frustumCulled = false;
  scene.add(points);

  // The valley floor around the mountain, out towards the horizon, at the start's level:
  // rings of faint particles, continuing the contour lines. It only shows as the mountain
  // deepens, and gives the drop below the summit a scale: the plain far down, flat to the
  // horizon, the mountain standing out of it.
  const plainCount = Math.floor(count * 0.3);
  const plainSeedA = hash(instanceIndex.add(uint(count * 3)));
  const plainSeedB = hash(instanceIndex.add(uint(count * 4)));
  const plainRing = plainSeedB.pow(1.4).mul(PLAIN_RINGS).floor();
  const plainRadius = plainRing.mul(PLAIN_RING_STEP).add(footprint + PLAIN_RING_STEP);
  const plainAngle = plainSeedA.mul(Math.PI * 2);
  const plainMaterial = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  plainMaterial.positionNode = vec3(
    cos(plainAngle).mul(plainRadius),
    deepenNode(float(0)),
    sin(plainAngle).mul(plainRadius).add(SUMMIT_Z),
  );
  plainMaterial.colorNode = color(LOW);
  const plainFar = float(1).sub(smoothstep(footprint + 120, footprint + PLAIN_RINGS * PLAIN_RING_STEP, plainRadius));
  const deepened = clamp(depth.sub(1).mul(1.5), 0, 1);
  // It recedes as the eyes rise to the curve, so it never runs behind the chart.
  const plainShown = uniform(1);
  plainMaterial.opacityNode = disc.mul(disc).mul(0.9).mul(plainFar).mul(deepened).mul(plainShown).mul(shown);
  // Larger further out, so the far rings still read as lines.
  plainMaterial.scaleNode = plainRadius.sub(footprint).mul(0.005).add(0.3);
  const plain = new THREE.Sprite(plainMaterial);
  plain.count = plainCount;
  plain.frustumCulled = false;
  scene.add(plain);

  // The visitor's line along the route, from the start to the summit.
  const linePositions = new Float32Array(JOURNEY_POINTS * 2 * 3);
  const lineSide = new Float32Array(JOURNEY_POINTS * 2);
  for (let i = 0; i < JOURNEY_POINTS; i++) lineSide.set([-1, 1], i * 2);
  // The line fades out over its last stretch, right under the camera on the summit,
  // where it would otherwise read as a broad streak rather than a line on the ground.
  const lineFade = new Float32Array(JOURNEY_POINTS * 2);
  const index: number[] = [];
  for (let i = 0; i < JOURNEY_POINTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute('journeySide', new THREE.BufferAttribute(lineSide, 1));
  lineGeometry.setAttribute('journeyFade', new THREE.BufferAttribute(lineFade, 1));
  lineGeometry.setIndex(index);
  const lineMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  lineMaterial.colorNode = color(WARM).mul(1.6);
  lineMaterial.positionNode = vec3(positionLocal.x, deepenNode(positionLocal.y), positionLocal.z);
  const edge = float(1).sub(attribute('journeySide', 'float').abs());
  lineMaterial.opacityNode = edge.mul(edge).mul(attribute('journeyFade', 'float')).mul(shown);
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);

  // The start, down in the valley: a column of light where the visitor set off, sized to
  // be seen from the summit, some two hundred units away.
  const startMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = uv().x.sub(0.5).mul(6);
  startMaterial.colorNode = color(WARM).mul(1.6);
  startMaterial.opacityNode = beam.mul(beam).negate().exp().mul(smoothstep(1, 0.1, uv().y)).mul(shown);
  const start = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 18), startMaterial);
  const startGround = groundAt(centerX(0), 0);
  start.position.set(centerX(0), startGround + 9, 0);
  scene.add(start);

  return {
    /** 0..1: the mountain, the visitor's line and the start mark fade in together. */
    setShown(amount: number) {
      shown.value = amount;
      points.visible = amount > 0.001;
      plain.visible = amount > 0.001;
      start.visible = amount > 0.001;
      line.visible = amount > 0.001 && line.userData.ready === true;
    },
    /** Lays the visitor's line along the route, once the ride is over. */
    setJourney(trajectory: TrajectoryPoint[], end: number, width: number) {
      for (let i = 0; i < JOURNEY_POINTS; i++) {
        const d = (i / (JOURNEY_POINTS - 1)) * end;
        const x = centerX(d) + lateralAt(trajectory, d);
        const y = groundAt(x, -d) + 0.3;
        linePositions.set([x - width, y, -d, x + width, y, -d], i * 6);
        const fade = 1 - THREE.MathUtils.smoothstep(d, end - 40, end - 12);
        lineFade.set([fade, fade], i * 2);
      }
      lineGeometry.attributes.position.needsUpdate = true;
      lineGeometry.attributes.journeyFade.needsUpdate = true;
      line.userData.ready = true;
    },
    /** 1..: how much deeper than the ridden ground the mountain shows (see `depth`). */
    setDepth(amount: number) {
      depth.value = amount;
      start.position.y = this.deepen(startGround) + 9;
    },
    /** 0..1: the valley plain, faded while the curve is on screen. */
    setPlainShown(amount: number) {
      plainShown.value = amount;
    },
    /** A height on the ridden ground, where it now shows on the deepened mountain. */
    deepen(y: number) {
      return SUMMIT_HEIGHT - (SUMMIT_HEIGHT - y) * depth.value;
    },
    /** The start mark is a flat beam: it turns (upright) to face the camera. */
    faceStart(camera: THREE.Camera) {
      start.rotation.y = Math.atan2(camera.position.x - start.position.x, camera.position.z - start.position.z);
    },
    reset() {
      line.userData.ready = false;
      this.setDepth(1);
      this.setPlainShown(1);
      this.setShown(0);
    },
    dispose() {
      // Not points.geometry: every three.js Sprite shares one geometry, the story's
      // particles included; disposing it would break them.
      material.dispose();
      plainMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      start.geometry.dispose();
      startMaterial.dispose();
    },
  };
}
