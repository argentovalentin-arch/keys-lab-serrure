import * as THREE from 'three/webgpu';
import {
  abs, color, exp, float, floor, fract, hash, instanceIndex, instancedArray, max, mix, normalLocal, positionLocal,
  smoothstep, uint, uniform, vec2, vec3,
} from 'three/tsl';
import { centerX, groundAt, headingAt, heightAt } from './path';
import { particleShape } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';

/**
 * « Clarifier les fondations »: the path the visitor has just seen form (« Structurer », the
 * particles gathering into a lane) is paved, from there up to the summit. Ahead of the
 * visitor, the lane's particles gather into modules, the modules settle into courses, side
 * by side, the joints staggered as in a laid paving: the same matter, from loose to
 * organised to solid. Behind the paving front the visitor rides on a consolidated path.
 *
 * A paver is drawn as the walls' bricks were, in points of light (a dotted face, its edges
 * a touch brighter), flat on the lane: the path's own matter, never a separate object.
 * As the front reaches it, a few of the lane's particles converge on its place (a handful
 * of points per paver, worked out in the shader); it condenses there, lands, flashes once
 * in champagne and settles to the lane's off-white.
 */

const COURSE = 0.62; // along the path
const JOINT = 0.07;
const PAVER = 1.0; // across
const HEIGHT = 0.06;
/** Spacing of the points that draw a paver's face. */
const DOT = 0.05;
/** Points converging on each paver as it forms. */
const GATHER = 10;
/** Front travel over which a paver forms: points gather, it condenses, lands, settles. */
const SETTLE = 3.2;
/** The paving front runs this far ahead of the guide at most… */
const LEAD = 14;
/** …catching up with it from the start this many times faster than the guide moves. */
const CATCH_UP = 2.2;

export interface PavementOptions {
  /** Guide distance from which the paving runs, and the stretch of path it paves. */
  startAt: number;
  from: number;
  to: number;
  /** Half the lane's width (path.ts PATH_HALF): the pavers cover it exactly. */
  half: number;
}

export function createPavement(scene: THREE.Scene, { startAt, from, to, half }: PavementOptions) {
  interface Paver { p: number; across: number; width: number; start: number; place: THREE.Vector3; yaw: number; pitch: number; progress: number }
  const pavers: Paver[] = [];
  const step = COURSE + JOINT;
  const fullAcross = [-(PAVER + JOINT), 0, PAVER + JOINT];
  // Staggered courses: two full pavers on either side of the middle, and a half at each edge.
  const halfWidth = half - (PAVER + JOINT / 2) - JOINT / 2;
  const offsetAcross = [-(half - halfWidth / 2), -(PAVER + JOINT) / 2, (PAVER + JOINT) / 2, half - halfWidth / 2];
  let course = 0;
  for (let p = from; p <= to; p += step, course++) {
    const heading = headingAt(p);
    const slope = (heightAt(p + 0.3) - heightAt(p - 0.3)) / 0.6;
    const across = course % 2 ? offsetAcross : fullAcross;
    across.forEach((a, k) => {
      const width = course % 2 && (k === 0 || k === across.length - 1) ? halfWidth : PAVER;
      const x = centerX(p) + a * Math.cos(heading);
      const z = -p + a * Math.sin(heading);
      pavers.push({
        p, across: a, width,
        // The middle first, then outwards: each course is laid from its centre.
        start: p + Math.abs(a) * 0.55,
        place: new THREE.Vector3(x, groundAt(x, z) + HEIGHT / 2 + 0.03, z),
        yaw: -heading,
        pitch: Math.atan(slope),
        progress: -1,
      });
    });
  }

  const front = uniform(-1000);
  const shown = uniform(1);

  // ---- The pavers: flat bricks of points, as the walls' were.
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const n = abs(normalLocal);
  const onTop = n.y.greaterThan(0.5);
  const across2 = n.x.greaterThan(0.5).select(positionLocal.zy, onTop.select(positionLocal.xz, positionLocal.xy));
  const point = smoothstep(0.26, 0.1, across2.div(DOT).fract().sub(0.5).length());
  const toEdge = max(abs(positionLocal.x).div(PAVER / 2), abs(positionLocal.z).div(COURSE / 2));
  const edge = smoothstep(0.84, 0.98, toEdge);
  material.colorNode = color(LAB.dust).mul(0.4);
  // The top face reads (its points, its edges: the joints show as dark lines between pavers);
  // the sides only a little.
  material.opacityNode = point.mul(float(0.2).add(edge.mul(0.45))).add(edge.mul(0.05))
    .mul(onTop.select(float(1), float(0.35))).mul(shown);
  const geometry = new THREE.BoxGeometry(PAVER, HEIGHT, COURSE);
  const mesh = new THREE.InstancedMesh(geometry, material, pavers.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // ---- The particles converging on each paver as it forms (all of them in one draw).
  // Per paver: its place and yaw, then its start, width and pitch.
  const placeData = new Float32Array(pavers.length * 4);
  const shapeData = new Float32Array(pavers.length * 4);
  pavers.forEach((paver, i) => {
    placeData.set([paver.place.x, paver.place.y, paver.place.z, paver.yaw], i * 4);
    shapeData.set([paver.start, paver.width, paver.pitch, 0], i * 4);
  });
  const places = instancedArray(placeData, 'vec4');
  const shapes = instancedArray(shapeData, 'vec4');
  const which = instanceIndex.div(uint(GATHER));
  const k = instanceIndex.mod(uint(GATHER)).toFloat();
  const placeOf = places.element(which);
  const shapeOf = shapes.element(which);
  const progress = front.sub(shapeOf.x).div(SETTLE).clamp(0, 1);
  const seed = (s: number) => hash(instanceIndex.add(uint(pavers.length * GATHER * s)));
  // Where on the paver's face this point lands (a loose grid), and where it comes from: the
  // lane around it, a little above.
  const landing = vec2(fract(k.mul(0.381).add(seed(1).mul(0.2))).sub(0.5).mul(shapeOf.y.mul(0.9)),
    floor(k.div(GATHER / 2)).sub(0.5).mul(COURSE * 0.55).add(seed(2).sub(0.5).mul(0.12)));
  const loose = landing.add(vec2(seed(3).sub(0.5).mul(1.6), seed(4).sub(0.5).mul(1.4)));
  const gather = smoothstep(0, 0.55, progress);
  const local = mix(loose, landing, gather.mul(gather).mul(float(3).sub(gather.mul(2))));
  const lift = mix(seed(5).mul(0.35).add(0.15), float(HEIGHT * 0.6), gather);
  const yaw = placeOf.w;
  const cosY = yaw.cos();
  const sinY = yaw.sin();
  const world = vec3(
    placeOf.x.add(local.x.mul(cosY)).add(local.y.mul(sinY)),
    placeOf.y.add(lift).add(local.y.mul(shapeOf.z.tan()).negate()),
    placeOf.z.sub(local.x.mul(sinY)).add(local.y.mul(cosY)),
  );
  const motesMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  motesMaterial.positionNode = world;
  const motesShape = particleShape();
  // Gathering, they warm (the matter at work); they are gone once the paver has formed.
  const alive = smoothstep(0, 0.08, progress).mul(float(1).sub(smoothstep(0.5, 0.72, progress)));
  motesMaterial.colorNode = mix(color(LAB.dust), color(BRAND.champagne).mul(1.4), gather);
  motesMaterial.opacityNode = motesShape.alpha.mul(alive).mul(0.85).mul(shown);
  motesMaterial.scaleNode = float(0.07).add(exp(gather.sub(1).mul(4)).mul(0.04));
  const motes = new THREE.Sprite(motesMaterial);
  motes.count = pavers.length * GATHER;
  motes.frustumCulled = false;
  motes.visible = false;
  scene.add(motes);

  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  pavers.forEach((_, i) => {
    mesh.setMatrixAt(i, hidden);
    mesh.setColorAt(i, tint.setScalar(1));
  });

  return {
    /** The paving front (guide distance) for this frame: the lane's particles meet it (terrain.ts). */
    front: 0,
    /** From the guide's distance: lays the pavers the front has reached. */
    update(distance: number) {
      const at = distance < startAt ? -1000 : Math.min(from + (distance - startAt) * CATCH_UP, distance + LEAD);
      this.front = at;
      front.value = at;
      motes.visible = at > from - 1 && shown.value > 0.001;
      let changed = false;
      pavers.forEach((paver, i) => {
        const progress = THREE.MathUtils.clamp((at - paver.start) / SETTLE, 0, 1);
        if (progress === paver.progress) return;
        paver.progress = progress;
        changed = true;
        // It condenses once its points have gathered (0.45 on), lands, then settles.
        const form = THREE.MathUtils.smoothstep(progress, 0.45, 0.8);
        if (form <= 0) {
          mesh.setMatrixAt(i, hidden);
          return;
        }
        position.copy(paver.place);
        position.y += (1 - form) * 0.12;
        rotation.setFromEuler(euler.set(paver.pitch, paver.yaw, 0));
        scale.set(paver.width / PAVER, 1, 1).multiplyScalar(0.82 + 0.18 * form);
        scale.y = form;
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
        // Lit as it lands, then the lane's own light.
        const flash = Math.exp(-(((progress - 0.82) / 0.1) ** 2));
        mesh.setColorAt(i, tint.setRGB(form + flash * 1.4, form + flash * 1.25, form + flash * 1));
      });
      if (changed) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
    /** 0..1: the paving fades for the view back from the summit, where the ground deepens. */
    setShown(amount: number) {
      shown.value = amount;
      mesh.visible = amount > 0.001;
      motes.visible = motes.visible && amount > 0.001;
    },
    reset() {
      pavers.forEach((paver, i) => {
        paver.progress = -1;
        mesh.setMatrixAt(i, hidden);
      });
      mesh.instanceMatrix.needsUpdate = true;
      front.value = -1000;
      this.front = -1000;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      motesMaterial.dispose();
      mesh.dispose();
    },
  };
}
