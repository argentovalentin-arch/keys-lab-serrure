import * as THREE from 'three/webgpu';
import { abs, color, exp, float, floor, fract, hash, instanceIndex, instancedArray, mix, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { centerX, groundAt, headingAt } from './path';
import { CHART } from './pace';
import { particleShape } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';

/**
 * Before the summit, on the right of the path: Keys Performance's own method chart, as it
 * stands on keysperformance.com (« Comprendre avant de proposer »), set in the land in
 * points of light. Three dotted lines are the three pillars (Structurer, Activer,
 * Performer); a curve runs through the method's six steps, 01 Comprendre to 06 Piloter,
 * each marked by a ring that fills as the curve reaches it.
 *
 * As the site says under it: the three lines are the pillars, not a scale of results; the
 * chart says in which order things happen, nothing else. So there is no figure on it, no
 * area under the curve, no target, no cursor: only the order, drawn.
 *
 * It builds itself in order, as the visitor comes up to it (pace.ts, CHART): the frame's
 * corners and the pillars draw in from the left, then the curve draws itself through the
 * steps, its head bright; motes drift up through it. Its labels (terrain.ts) name the
 * pillars and each step as the curve reaches it.
 */

const WIDTH = 9.6;
const HEIGHT = 3.7;
/** The pillars stand a little behind the curve: depth. */
const BACK = 0.35;
const CURVE_POINTS = 300;
const MOTES = 70;

/** The three pillars, bottom to top, as on the site. */
export const PILLARS = ['Structurer', 'Activer', 'Performer'] as const;
const PILLAR_LEVELS = [0, 0.5, 1];

/**
 * The method's six steps (keysperformance.com): across, evenly; up, on their pillar.
 * 04 Construire stands halfway between Structurer and Activer, as on the site.
 */
export const STEPS = [
  { numeral: '01', name: 'Comprendre', level: 0 },
  { numeral: '02', name: 'Diagnostiquer', level: 0 },
  { numeral: '03', name: 'Prioriser', level: 0 },
  { numeral: '04', name: 'Construire', level: 0.25 },
  { numeral: '05', name: 'Activer', level: 0.5 },
  { numeral: '06', name: 'Piloter', level: 1 },
] as const;
/** Where each step stands across the chart (0..1). */
export const stepAt = (i: number) => i / (STEPS.length - 1);

/** The curve between the steps: level, then an eased rise to the next step's level. */
const curveAt = (x: number) => {
  const span = 1 / (STEPS.length - 1);
  const i = Math.min(STEPS.length - 2, Math.floor(x / span));
  const t = (x - i * span) / span;
  const eased = t * t * (3 - 2 * t);
  return STEPS[i].level + (STEPS[i + 1].level - STEPS[i].level) * eased;
};

// Kinds of point, stored with each one (with its place along what it draws, in the same float).
const PILLAR = 0;
const CURVE = 1;
const RING = 2;
const CORE = 3;
const FRAME = 4;
const MOTE = 5;

export interface MonitorOptions {
  /** The Terrain's clock, for the motes drifting up through the chart. */
  time: THREE.Node<'float'>;
}

export function createMonitor(scene: THREE.Scene, { time }: MonitorOptions) {
  // Each point: x, y (0..1 on the chart), z (world units, depth), and kind + place in one float.
  const data: number[] = [];
  const add = (x: number, y: number, z: number, kind: number, w = 0) => data.push(x, y, z, kind + Math.min(Math.max(w, 0), 0.999));
  // The pillars: dotted lines, a little wider than the steps, behind the curve.
  PILLAR_LEVELS.forEach((level) => {
    for (let i = 0; i <= 74; i++) if (i % 2 === 0) add(-0.06 + (i / 74) * 1.12, level, -BACK, PILLAR, i / 74);
  });
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = i / (CURVE_POINTS - 1);
    add(x, curveAt(x), 0, CURVE, x);
  }
  // Each step: a ring (open, as on the site), and its heart, which fills once reached.
  STEPS.forEach((step, s) => {
    const x = stepAt(s);
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      add(x + (Math.cos(a) * 0.05) / (WIDTH / HEIGHT), step.level + Math.sin(a) * 0.05, 0, RING, x);
    }
    add(x, step.level, 0.01, CORE, x);
  });
  // The frame's four corners, the brand's corner brackets.
  const corner = (x: number, y: number, dx: number, dy: number) => {
    for (let i = 0; i <= 7; i++) add(x + dx * (i / 7) * 0.06, y, -BACK, FRAME, 0);
    for (let i = 1; i <= 7; i++) add(x, y + dy * (i / 7) * 0.13, -BACK, FRAME, 0);
  };
  corner(-0.1, -0.16, 1, 1);
  corner(1.1, -0.16, -1, 1);
  corner(-0.1, 1.16, 1, -1);
  corner(1.1, 1.16, -1, -1);
  for (let i = 0; i < MOTES; i++) add(((i * 0.618) % 1) * 1.2 - 0.1, (i * 0.377) % 1, -BACK * 3 * ((i * 0.29) % 1), MOTE, (i * 0.123) % 1);
  const count = data.length / 4;
  const points = instancedArray(new Float32Array(data), 'vec4');

  const shown = uniform(0);
  const build = uniform(0);
  const reveal = uniform(0);
  const placement = uniform(new THREE.Matrix4());

  const point = points.element(instanceIndex);
  const kind = floor(point.w);
  const w = fract(point.w);
  const is = (k: number) => kind.equal(k);
  const y = is(MOTE).select(fract(point.y.add(time.mul(float(0.022).add(w.mul(0.03))))), point.y);
  const local = vec3(point.x.sub(0.5).mul(WIDTH), y.mul(HEIGHT), point.z);

  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = placement.mul(vec4(local, 1)).xyz;
  // The pillars and the frame draw in from the left.
  const built = smoothstep(w.sub(0.04), w, build);
  // The curve is drawn up to `reveal`, its head bright.
  const drawn = smoothstep(reveal.add(0.003), reveal.sub(0.003), w);
  const head = exp(abs(w.sub(reveal)).mul(-60)).mul(smoothstep(0, 0.01, reveal)).mul(float(1).sub(smoothstep(0.985, 1, reveal)));
  // A step is reached when the curve gets to it: its ring brightens, its heart fills, briefly flaring.
  const since = reveal.sub(w);
  const reached = smoothstep(-0.004, 0.008, since);
  const flare = exp(since.mul(-14)).mul(reached);
  const strength = is(PILLAR).select(built.mul(0.38),
    is(CURVE).select(drawn.mul(0.95).add(head.mul(1.5)),
      is(RING).select(built.mul(0.35).add(reached.mul(0.45)).add(flare.mul(0.6)),
        is(CORE).select(reached.mul(0.9).add(flare.mul(1.2)),
          is(FRAME).select(built.mul(0.6),
            smoothstep(0, 0.15, y).mul(smoothstep(1, 0.75, y)).mul(0.22).mul(build))))));
  const shape = particleShape();
  // Champagne light for what is drawn; the pillars and frame in off-white, quieter.
  const lit = is(CURVE).or(is(RING)).or(is(CORE)).or(is(MOTE)).select(float(1), float(0));
  material.colorNode = mix(color(LAB.dust).mul(0.75), color(BRAND.champagne).mul(1.5), lit);
  material.opacityNode = shape.alpha.mul(strength).mul(shown);
  material.scaleNode = is(CURVE).select(float(0.12).add(head.mul(0.2)),
    is(CORE).select(float(0.16).add(flare.mul(0.18)),
      is(RING).select(float(0.075),
        is(MOTE).select(float(0.05).add(hash(instanceIndex).mul(0.04)), float(0.07)))));
  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  scene.add(sprite);

  // Under it, a soft pool of light on the ground: it stands on the land.
  const poolMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const r = uv().sub(0.5).mul(2).length();
  poolMaterial.colorNode = color(LAB.light).mul(0.9);
  poolMaterial.opacityNode = exp(r.mul(r).mul(-4)).mul(smoothstep(1, 0.7, r)).mul(build).mul(shown).mul(0.3);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH * 1.1, 2.6).rotateX(-Math.PI / 2), poolMaterial);
  scene.add(pool);

  // Set once (it stands still in the land), again only if the screen's shape changes: on
  // a portrait phone it stands nearer the lane, and smaller, to stay in the view.
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3(1, 1, 1);
  let placedNarrow: boolean | null = null;
  const place = (narrow: boolean) => {
    placedNarrow = narrow;
    const p = CHART.at;
    const heading = headingAt(p);
    const offset = narrow ? CHART.narrowOffset : CHART.offset;
    const px = centerX(p) + offset * Math.cos(heading);
    const pz = -p + offset * Math.sin(heading);
    const ground = groundAt(px, pz);
    // Raised so its lowest pillar stands clear of the horizon's light.
    position.set(px, ground + (narrow ? 0.75 : 1.7), pz);
    // Turned towards the visitor coming up the path, a little in towards it.
    rotation.setFromEuler(euler.set(0, -heading - (narrow ? 0.3 : 0.32), 0));
    scale.setScalar(narrow ? 0.48 : 1);
    placement.value.compose(position, rotation, scale);
    // The pool's plane is laid flat in its geometry: it only turns with the chart.
    pool.position.set(px, ground + 0.04, pz);
    pool.quaternion.copy(rotation);
    pool.scale.setScalar(scale.x);
  };
  place(false);

  const smooth = THREE.MathUtils.smoothstep;
  const toWorld = (cx: number, cy: number, z = 0) =>
    new THREE.Vector3((cx - 0.5) * WIDTH, cy * HEIGHT, z).applyMatrix4(placement.value);
  return {
    /** World position of a step's mark, and of a pillar's left end (where their labels stand). */
    stepPoint: (i: number) => toWorld(stepAt(i), STEPS[i].level),
    pillarEnd: (i: number) => toWorld(-0.06, PILLAR_LEVELS[i], -BACK),
    /** World position of its middle, where the eyes go. */
    centre: () => toWorld(0.5, 0.45),
    /** The guide distance at which the curve reaches a point of it (0..1 across). */
    distanceAt: (x: number) => CHART.draw[0] + x * (CHART.draw[1] - CHART.draw[0]),
    /** 0..1: how much it shows now. */
    get shown() { return shown.value; },
    /** From the guide's distance: it builds, draws its curve, stays to be read, and goes. */
    update(distance: number, narrow: boolean) {
      if (narrow !== placedNarrow) place(narrow);
      shown.value = smooth(distance, CHART.build[0] - 1, CHART.build[0] + 0.5) * (1 - smooth(distance, CHART.gone[0], CHART.gone[1]));
      build.value = smooth(distance, CHART.build[0], CHART.build[1]);
      reveal.value = THREE.MathUtils.clamp((distance - CHART.draw[0]) / (CHART.draw[1] - CHART.draw[0]), 0, 1);
      sprite.visible = pool.visible = shown.value > 0.001;
    },
    /** It is gone by the summit; kept hidden for the view back. */
    setShown(amount: number) {
      sprite.visible = sprite.visible && amount > 0.001;
      pool.visible = sprite.visible;
    },
    dispose() {
      // Not sprite.geometry: every three.js Sprite shares one geometry.
      material.dispose();
      poolMaterial.dispose();
      pool.geometry.dispose();
    },
  };
}
