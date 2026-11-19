import * as THREE from 'three/webgpu';
import { abs, color, exp, float, floor, fract, hash, instanceIndex, instancedArray, mix, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { centerX, groundAt, headingAt } from './path';
import { CHART } from './pace';
import { particleShape } from '../world/sprite';

const CREAM = '#f4ecdc';
const WARM = '#ffd9a0';
const WIDTH = 9.6;
const HEIGHT = 5;
/** The back plane (grid) stands this far behind the front one (axes, curve): depth. */
const BACK = 0.7;
const GRID_LINES = 3;
const CURVE_POINTS = 260;
const FILL_COLUMNS = 90;
const MOTES = 90;

// Kinds of point, stored with each one (with its place along what it draws, in the same float).
const AXIS = 0;
const GRID = 1;
const CURVE = 2;
const CURSOR = 3;
const TARGET = 4;
const MARK = 5;
const DROP = 6;
const FILL = 7;
const FRAME = 8;
const MOTE = 9;

/** The level set before the curve starts (« les indicateurs sont définis avant de produire »). */
const TARGET_LEVEL = 0.62;
/** Points of the curve marked as it reaches them, named by terrain.ts. */
export const MONITOR_MARKS = [0.22, 0.5, 0.74, 0.9];

/**
 * The evolution shown: rising overall, with its ups and downs. A shape, not data: there
 * are no figures anywhere on the chart, only the rise towards the target and past it.
 */
const curveAt = (t: number) => 0.08 + 0.72 * t ** 1.4 + 0.07 * Math.sin(t * 15) * (0.4 + t) + 0.03 * Math.sin(t * 37);

export interface MonitorOptions {
  /** The Terrain's clock, for the motes drifting up through the chart. */
  time: THREE.Node<'float'>;
}

/**
 * « Mesurer pour décider »: a chart standing in the landscape on the right of the path,
 * just before the summit, made of the same points of light as everything else. It is set
 * in the world and seen coming, growing as the visitor nears it, the eyes drawn to it
 * (pace.ts, CHART), while the ride slows right down.
 *
 * It builds itself in order: the frame's corners and the axes draw in, the grid fades up
 * on a plane set behind them (so the chart has depth), the target line shows; then the
 * curve draws itself, a bright head sweeping along it with the cursor, a soft veil of
 * light filling in under it; each level it reaches is marked by a ring that pops and a
 * dotted line dropping to the axis. Motes drift up through it all the while. Labels
 * (terrain.ts) name the target, the evolution followed and what to strengthen.
 */
export function createMonitor(scene: THREE.Scene, { time }: MonitorOptions) {
  // Each point: x, y (0..1 on the chart), z (world units, depth), and kind + place in one float.
  const data: number[] = [];
  const add = (x: number, y: number, z: number, kind: number, w = 0) => data.push(x, y, z, kind + Math.min(w, 0.999));
  const line = (x0: number, y0: number, x1: number, y1: number, n: number, kind: number, z = 0) => {
    for (let i = 0; i <= n; i++) add(x0 + (x1 - x0) * (i / n), y0 + (y1 - y0) * (i / n), z, kind, i / n);
  };
  line(0, 0, 1, 0, 90, AXIS); // time
  line(0, 0, 0, 1, 52, AXIS); // value
  for (let g = 1; g <= GRID_LINES; g++) line(0, g / (GRID_LINES + 0.6), 1, g / (GRID_LINES + 0.6), 50, GRID, -BACK);
  for (let v = 1; v <= 6; v++) line(v / 6, 0, v / 6, 1, 26, GRID, -BACK);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = i / (CURVE_POINTS - 1);
    add(t, curveAt(t), 0, CURVE, t);
  }
  // The target, dashed, there from the start.
  for (let i = 0; i <= 70; i++) if (i % 3 !== 2) add(i / 70, TARGET_LEVEL, 0, TARGET, i / 70);
  // A ring of points around each marked point of the curve, and a dotted drop to the axis.
  for (const t of MONITOR_MARKS) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      add(t + (Math.cos(a) * 0.05) / (WIDTH / HEIGHT), curveAt(t) + Math.sin(a) * 0.05, 0, MARK, t);
    }
    const n = Math.round(curveAt(t) * 18);
    for (let k = 0; k < n; k++) if (k % 2 === 0) add(t, curveAt(t) * (k / n), 0, DROP, t);
  }
  // A veil under the curve: columns of faint points, a little in depth.
  for (let c = 0; c < FILL_COLUMNS; c++) {
    const t = (c + 0.5) / FILL_COLUMNS;
    const n = Math.max(1, Math.round(curveAt(t) * 9));
    for (let k = 0; k < n; k++) add(t, (curveAt(t) * (k + 0.5)) / n, -BACK * ((k * 0.37 + c * 0.61) % 1) * 0.6, FILL, t);
  }
  // The frame's four corners, as on a screen of light.
  const corner = (x: number, y: number, dx: number, dy: number) => {
    line(x, y, x + dx * 0.07, y, 6, FRAME, -BACK * 0.5);
    line(x, y, x, y + dy * 0.12, 6, FRAME, -BACK * 0.5);
  };
  corner(-0.04, -0.06, 1, 1);
  corner(1.04, -0.06, -1, 1);
  corner(-0.04, 1.08, 1, -1);
  corner(1.04, 1.08, -1, -1);
  for (let i = 0; i < MOTES; i++) add(((i * 0.618) % 1) * 1.1 - 0.05, (i * 0.377) % 1, -BACK * ((i * 0.29) % 1) * 1.4, MOTE, (i * 0.123) % 1);
  const cursorPoints = 30;
  for (let i = 0; i <= cursorPoints; i++) add(0, i / cursorPoints, 0, CURSOR, i / cursorPoints);
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
  // The cursor stands where the curve is drawing; the motes drift slowly up.
  const x = is(CURSOR).select(reveal, point.x);
  const y = is(MOTE).select(fract(point.y.add(time.mul(float(0.025).add(w.mul(0.03))))), point.y);
  const local = vec3(x.sub(0.5).mul(WIDTH), y.mul(HEIGHT), point.z);

  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = placement.mul(vec4(local, 1)).xyz;
  // The axes and frame draw in from their origin, the grid fades up after them.
  const built = smoothstep(w.sub(0.04), w, build);
  // The curve is drawn up to `reveal`, its head bright; the veil follows it a little behind.
  const drawn = smoothstep(reveal.add(0.004), reveal.sub(0.004), w);
  const head = exp(abs(w.sub(reveal)).mul(-55));
  const veiled = smoothstep(reveal, reveal.sub(0.06), w);
  // A mark pops as the curve reaches it: it swells, then settles; its drop runs down after.
  const sinceMark = reveal.sub(w);
  const marked = smoothstep(0, 0.012, sinceMark);
  const pop = exp(sinceMark.mul(-11)).mul(marked);
  const dropped = smoothstep(0.01, 0.06, sinceMark);
  const working = smoothstep(0, 0.02, reveal).mul(float(1).sub(smoothstep(0.98, 1, reveal)));
  const strength = is(AXIS).select(built.mul(0.75),
    is(GRID).select(smoothstep(0.6, 1, build).mul(0.36),
      is(CURVE).select(drawn.mul(0.95).add(head.mul(1.6).mul(drawn)),
        is(TARGET).select(built.mul(0.42),
          is(MARK).select(marked.mul(0.75).add(pop.mul(0.9)),
            is(DROP).select(dropped.mul(0.45),
              is(FILL).select(veiled.mul(0.11),
                is(FRAME).select(built.mul(0.7),
                  is(MOTE).select(smoothstep(0, 0.15, y).mul(smoothstep(1, 0.75, y)).mul(0.28).mul(build),
                    working.mul(0.26))))))))));
  const shape = particleShape();
  const warm = is(CURVE).or(is(MARK)).or(is(FILL)).or(is(MOTE)).select(float(1), float(0));
  material.colorNode = mix(color(CREAM).mul(0.8), color(WARM).mul(1.6), warm);
  material.opacityNode = shape.alpha.mul(strength).mul(shown);
  material.scaleNode = is(CURVE).select(float(0.13).add(head.mul(0.22).mul(drawn)),
    is(MARK).select(float(0.09).add(pop.mul(0.1)),
      is(FILL).select(float(0.11),
        is(MOTE).select(float(0.06).add(hash(instanceIndex).mul(0.05)), float(0.075)))));
  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  scene.add(sprite);

  // Under it, a soft pool of light on the ground, as from a projector: it stands on the land.
  const poolMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const r = uv().sub(0.5).mul(2).length();
  poolMaterial.colorNode = color(WARM).mul(0.9);
  poolMaterial.opacityNode = exp(r.mul(r).mul(-4)).mul(smoothstep(1, 0.7, r)).mul(build).mul(shown).mul(0.35);
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
    position.set(px, ground + 0.75, pz);
    // Turned towards the visitor coming up the path, a little in towards it.
    rotation.setFromEuler(euler.set(0, -heading - (narrow ? 0.3 : 0.55), 0));
    scale.setScalar(narrow ? 0.48 : 1);
    placement.value.compose(position, rotation, scale);
    // The pool's plane is laid flat in its geometry: it only turns with the chart.
    pool.position.set(px, ground + 0.04, pz);
    pool.quaternion.copy(rotation);
    pool.scale.setScalar(scale.x);
  };
  place(false);

  const smooth = THREE.MathUtils.smoothstep;
  const toWorld = (cx: number, cy: number) =>
    new THREE.Vector3((cx - 0.5) * WIDTH, cy * HEIGHT, 0).applyMatrix4(placement.value);
  return {
    /** World position of a point of the curve (0..1 along it), and of the target line's right end. */
    curvePoint: (t: number) => toWorld(t, curveAt(t)),
    targetEnd: () => toWorld(1, TARGET_LEVEL),
    /** World position of its middle, where the eyes go. */
    centre: () => toWorld(0.5, 0.45),
    /** The guide distance at which the curve reaches a point of it (0..1). */
    distanceAt: (t: number) => CHART.draw[0] + t * (CHART.draw[1] - CHART.draw[0]),
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
