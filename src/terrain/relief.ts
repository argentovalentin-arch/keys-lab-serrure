import * as THREE from 'three/webgpu';
import { SPRITE_GROWTH, coreColor, particleShape } from '../world/sprite';
import { LAB } from '../core/brand';
import {
  attribute, cameraPosition, clamp, color, cos, exp, float, hash, instanceIndex, mix, positionLocal, sin, smoothstep, uint, uniform, uv, varying, vec2, vec3,
} from 'three/tsl';
import { SEA_LEVEL } from './coast';
import { CONTOUR_SHARE, topoSize, topoTone } from './topography';
import {
  ACTIVATE_AT, CONTOUR_STEP, END_AT, MOUNTAIN_RADIUS, PATH_HALF, PERFORM_AT, STRUCTURE_AT, SUMMIT_HEIGHT, SUMMIT_Z, centerX,
  centerXNode, groundAt, groundNode, lateralAt, type TrajectoryPoint,
} from './path';

const CREAM = LAB.dust;
const WARM = LAB.light;
const LOW = '#8fa6c8'; // far below, in the haze
const TOP_RADIUS = 9; // as in path.ts: the flat top
const JOURNEY_POINTS = 360;

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
  /** While crossing: 1, and where the ride's field band starts (the guide's distance). */
  const bandOn = uniform(0);
  const bandAt = uniform(0);
  /** Seen from the sea, low and far, the points are drawn finer and quieter than from the top. */
  const fromSea = uniform(0);
  const deepenNode = (y: THREE.Node<'float'>) => float(SUMMIT_HEIGHT).sub(float(SUMMIT_HEIGHT).sub(y).mul(depth));
  const laneCount = Math.floor(count * 0.18);
  const isLane = instanceIndex.lessThan(uint(laneCount));
  const seedA = hash(instanceIndex);
  const seedB = hash(instanceIndex.add(uint(count)));
  const seedC = hash(instanceIndex.add(uint(count * 2)));

  // Mountain particles: a point over the mountain's footprint (more of them near the top,
  // where the eye is), then, for most of them, moved onto the nearest contour line: one step
  // of Newton's method along the ground's slope, which works for any relief. The lines then
  // follow every spur and valley, tightening where the ground is steep, as on a relief map.
  const footprint = TOP_RADIUS + MOUNTAIN_RADIUS;
  const angle = seedA.mul(Math.PI * 2);
  const radius = seedB.pow(0.7).mul(footprint);
  const looseX = cos(angle).mul(radius);
  const looseZ = sin(angle).mul(radius).add(SUMMIT_Z);
  const STEP = 0.6;
  const h0 = groundNode(looseX, looseZ);
  const gradX = groundNode(looseX.add(STEP), looseZ).sub(h0).div(STEP);
  const gradZ = groundNode(looseX, looseZ.add(STEP)).sub(h0).div(STEP);
  const slope2 = gradX.mul(gradX).add(gradZ.mul(gradZ)).max(0.0004);
  const level = h0.div(CONTOUR_STEP).add(0.5).floor().mul(CONTOUR_STEP).min(SUMMIT_HEIGHT);
  const shift = h0.sub(level).div(slope2).clamp(-3, 3);
  const onContour = seedC.lessThan(CONTOUR_SHARE);
  const mountainX = onContour.select(looseX.sub(gradX.mul(shift)), looseX);
  const mountainZ = onContour.select(looseZ.sub(gradZ.mul(shift)), looseZ);
  const mountainY = groundNode(mountainX, mountainZ);
  // Its tone (topography.ts): how the ground there faces the light, and whether it lies on a
  // crest (where the ground falls away on both sides) or in a hollow. As the mountain
  // deepens, its slopes steepen with it.
  const normal = vec3(gradX.negate(), float(1).div(depth), gradZ.negate()).normalize();
  const around = groundNode(mountainX.add(6), mountainZ).add(groundNode(mountainX.sub(6), mountainZ))
    .add(groundNode(mountainX, mountainZ.add(6))).add(groundNode(mountainX, mountainZ.sub(6)));
  const cavity = clamp(mountainY.mul(4).sub(around).mul(0.3), -1, 1);
  // The landmarks stand out of the relief: a ring of light round each, on the ground.
  const ringAt = (x: number, z: number) => {
    const d = vec2(mountainX.sub(x), mountainZ.sub(z)).length();
    return exp(d.sub(3.6).mul(2.4).pow(2).negate());
  };
  const landmarks = ringAt(centerX(STRUCTURE_AT), -STRUCTURE_AT).add(ringAt(centerX(ACTIVATE_AT), -ACTIVATE_AT))
    .add(ringAt(centerX(PERFORM_AT), -PERFORM_AT));

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
  const shape = particleShape();
  const worldPoint = vec3(isLane.select(laneX, mountainX), deepenNode(isLane.select(laneY, mountainY)), isLane.select(laneZ, mountainZ));
  // Its topography marked more strongly from the summit (topography.ts); from the sea, as it was.
  const contrast = uniform(0);
  const tone = topoTone(normal, cavity, cameraPosition.sub(worldPoint).normalize(), contrast);
  // The lane: the route itself, in the light tone, as on the ride; the landmarks warm.
  const base = isLane.select(mix(color(CREAM), color(WARM), 0.6), mix(tone.colour, color(WARM), landmarks.min(1)));
  material.colorNode = coreColor(varying(mix(base, color(LOW), haze.mul(0.45))), shape.core).mul(1.25);
  // The lane fades over its last stretch, right under the camera on the summit, where
  // close-up particles would blot out the view rather than draw the route.
  const laneFade = float(1).sub(smoothstep(END_AT - 45, END_AT - 12, p)).max(0.15);
  const shading = tone.strength.add(landmarks.mul(1.2));
  // Under the sea (coast.ts) there is no mountain to see; while crossing, the strip of
  // ground the ride's own field draws ahead is left to it, so nothing is drawn twice.
  const groundY = isLane.select(laneY.sub(0.12), mountainY);
  const dry = smoothstep(SEA_LEVEL - 0.05, SEA_LEVEL + 0.15, groundY);
  const worldX = isLane.select(laneX, mountainX);
  const along = isLane.select(laneZ, mountainZ).negate();
  const inBand = smoothstep(17, 14, worldX.sub(centerXNode(along)).abs())
    .mul(smoothstep(bandAt.sub(12), bandAt.sub(8), along)).mul(smoothstep(bandAt.add(60), bandAt.add(52), along));
  const visible = dry.mul(float(1).sub(inBand.mul(bandOn))).mul(float(1).sub(fromSea.mul(0.45)));
  const strength = isLane.select(laneFade.mul(0.85), onContour.select(float(1.2), float(0.75)).mul(shading));
  material.opacityNode = shape.alpha.mul(varying(strength.mul(float(1).sub(haze.mul(isLane.select(float(0.2), float(0.35))))).mul(visible))).mul(shown);
  // Seen from far up the mountain, the particles need to be larger than underfoot; the
  // contour lines most of all, as they draw the mountain's shape from a distance
  // (topography.ts, the same rule as for the islands).
  const fromEye = worldPoint.sub(cameraPosition).length();
  material.scaleNode = isLane.select(float(0.16).add(seedC.pow(6).mul(0.12)).mul(SPRITE_GROWTH).mul(fromEye.div(55).max(1).pow(0.85)), topoSize(fromEye, onContour, seedC).mul(tone.size))
    .mul(float(1).sub(fromSea.mul(0.5)));
  const points = new THREE.Sprite(material);
  points.count = count;
  points.frustumCulled = false;
  scene.add(points);

  // The ground itself, unseen: a surface just under the particles that only writes depth.
  // Seen from the top, a spur or a hill then hides what lies behind it, the route's light
  // included, which reappears further down: the mountain has a body, not only lines.
  const SURFACE = 200;
  const surfaceGeometry = new THREE.PlaneGeometry(footprint * 2, footprint * 2, SURFACE, SURFACE).rotateX(-Math.PI / 2);
  // Drawn among the see-through things, after the horizon's band and the last light (which
  // it must never hide) and before every point (which it hides when they lie behind a slope).
  const surfaceMaterial = new THREE.MeshBasicNodeMaterial({ colorWrite: false, transparent: true, depthWrite: true, side: THREE.DoubleSide });
  const groundX = positionLocal.x;
  const groundZ = positionLocal.z.add(SUMMIT_Z);
  surfaceMaterial.positionNode = vec3(groundX, deepenNode(groundNode(groundX, groundZ)).sub(depth.mul(0.55)), groundZ);
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  surface.frustumCulled = false;
  surface.renderOrder = -1;
  surface.visible = false;
  scene.add(surface);

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
      bandOn.value = 0;
      fromSea.value = 0;
      contrast.value = 1;
      points.visible = amount > 0.001;
      surface.visible = amount > 0.5;
      start.visible = amount > 0.001;
      line.visible = amount > 0.001 && line.userData.ready === true;
    },
    /** How much it shows now. */
    get shownAmount() {
      return shown.value;
    },
    /**
     * While riding, from the sea to the summit: the whole mountain around, all of it but the
     * band the ride's own field draws (from the guide's distance `at`), finer than from the
     * top; `amount` 0..1, and how marked its topography is (topography.ts: none from the sea,
     * as the field from the climb on).
     */
    setCrossing(amount: number, at: number, marked = 0) {
      this.setShown(amount);
      bandOn.value = 1;
      fromSea.value = 1;
      contrast.value = marked;
      bandAt.value = at;
      // Its unseen ground stays: the open sea beyond the mountain does not show through it,
      // so the horizon's line stops where the land stands in front of it.
      surface.visible = amount > 0.5;
      // The start's column is for the view from the top; at the shore it would blind.
      start.visible = false;
    },
    /**
     * On the summit, from the mountain as ridden to the mountain seen whole from the top:
     * `whole` 0..1 lifts the band's gap and brings its points to their size from above, so
     * it never goes out and comes back.
     */
    setFromTop(whole: number, at: number) {
      this.setShown(1);
      bandAt.value = at;
      bandOn.value = 1 - whole;
      fromSea.value = 1 - whole;
      start.visible = whole > 0.001;
      line.visible = whole > 0.001 && line.userData.ready === true;
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
      this.setShown(0);
    },
    dispose() {
      // Not points.geometry: every three.js Sprite shares one geometry, the story's
      // particles included; disposing it would break them.
      material.dispose();
      surfaceGeometry.dispose();
      surfaceMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      start.geometry.dispose();
      startMaterial.dispose();
    },
  };
}
