import * as THREE from 'three/webgpu';
import { abs, color, exp, float, instanceIndex, instancedArray, mix, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { centerX, groundAt, headingAt } from './path';

const CREAM = '#f4ecdc';
const WARM = '#ffd9a0';
const WIDTH = 5.4;
const HEIGHT = 3;
const GRID_LINES = 3;
const CURVE_POINTS = 220;

// Kinds of point, stored with each one.
const AXIS = 0;
const GRID = 1;
const CURVE = 2;
const CURSOR = 3;
const TARGET = 4;
const MARK = 5;

/** The level set before the curve starts (« les indicateurs sont définis avant de produire »). */
const TARGET_LEVEL = 0.62;
/** Points of the curve marked as it reaches them, named by terrain.ts. */
export const MONITOR_MARKS = [0.22, 0.5, 0.78, 0.97];

/** The evolution shown: rising overall, with its ups and downs (an illustration, not data). */
const curveAt = (t: number) => 0.08 + 0.72 * t ** 1.4 + 0.07 * Math.sin(t * 15) * (0.4 + t) + 0.03 * Math.sin(t * 37);

export interface MonitorOptions {
  /** Where along the path it stands, and on which side (-1 left, 1 right), how far out. */
  /** How far ahead of the guide it keeps, on which side (-1 left, 1 right), how far out. */
  lead: number;
  side: -1 | 1;
  offset: number;
  /** Guide distances over which it shows (its note's), the curve tracing itself meanwhile. */
  from: number;
  to: number;
}

/**
 * « Mesurer pour décider »: a monitoring screen standing beside the path, in particles: two
 * axes, faint grid lines, and a curve that traces itself as the visitor advances, a bright
 * point at its tip and a cursor line sweeping along with it: an evolution followed as it
 * happens. Turned towards the visitor coming up the path, it keeps pace with them, a
 * little ahead, for as long as its note shows, so it can be watched as the curve grows.
 */
export function createMonitor(scene: THREE.Scene, { lead, side, offset, from, to }: MonitorOptions) {
  // Each point: x and y on the screen (0..1), its kind, and for the curve its place along it.
  const data: number[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number, n: number, kind: number) => {
    for (let i = 0; i <= n; i++) data.push(x0 + (x1 - x0) * (i / n), y0 + (y1 - y0) * (i / n), kind, 0);
  };
  line(0, 0, 1, 0, 70, AXIS); // time
  line(0, 0, 0, 1, 40, AXIS); // value
  for (let g = 1; g <= GRID_LINES; g++) line(0, g / (GRID_LINES + 0.6), 1, g / (GRID_LINES + 0.6), 36, GRID);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = i / (CURVE_POINTS - 1);
    data.push(t, curveAt(t), CURVE, t);
  }
  // The target, dashed, there from the start.
  for (let i = 0; i <= 60; i++) if (i % 3 !== 2) data.push(i / 60, TARGET_LEVEL, TARGET, 0);
  // A ring of points around each marked point of the curve, popping as the curve reaches it.
  for (const t of MONITOR_MARKS) {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      data.push(t + (Math.cos(a) * 0.06) / (WIDTH / HEIGHT), curveAt(t) + Math.sin(a) * 0.06, MARK, t);
    }
  }
  const cursorPoints = 26;
  for (let i = 0; i <= cursorPoints; i++) data.push(0, i / cursorPoints, CURSOR, 0);
  const count = data.length / 4;
  const points = instancedArray(new Float32Array(data), 'vec4');

  const shown = uniform(0);
  const reveal = uniform(0);
  const placement = uniform(new THREE.Matrix4());

  const point = points.element(instanceIndex);
  const kind = point.z;
  const isCurve = kind.equal(CURVE);
  const isCursor = kind.equal(CURSOR);
  const x = isCursor.select(reveal, point.x);
  const local = vec3(x.sub(0.5).mul(WIDTH), point.y.mul(HEIGHT), 0);

  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = placement.mul(vec4(local, 1)).xyz;
  // The curve is drawn up to `reveal`, its tip bright; the cursor stands where it is drawing.
  const drawn = smoothstep(reveal.add(0.004), reveal.sub(0.004), point.w);
  const tip = exp(abs(point.w.sub(reveal)).mul(-60));
  // A mark pops as the curve reaches it: it swells, then settles.
  const sinceMark = reveal.sub(point.w);
  const marked = smoothstep(0, 0.01, sinceMark);
  const pop = exp(sinceMark.mul(-12)).mul(marked);
  const strength = kind.equal(AXIS).select(float(0.55),
    kind.equal(GRID).select(float(0.16),
      isCurve.select(drawn.mul(0.9).add(tip.mul(1.4).mul(drawn)),
        kind.equal(TARGET).select(float(0.45),
          kind.equal(MARK).select(marked.mul(0.7).add(pop.mul(0.8)),
            float(0.22).mul(smoothstep(0, 0.02, reveal)))))));
  const disc = float(1).sub(uv().sub(0.5).length().mul(2)).clamp(0, 1);
  const warm = isCurve.or(kind.equal(MARK)).select(float(1), float(0));
  material.colorNode = mix(color(CREAM).mul(0.8), color(WARM).mul(1.6), warm);
  material.opacityNode = disc.mul(disc).mul(strength).mul(shown);
  material.scaleNode = isCurve.select(float(0.1).add(tip.mul(0.16).mul(drawn)),
    kind.equal(MARK).select(float(0.07).add(pop.mul(0.08)), float(0.06)));
  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  scene.add(sprite);

  // Beside the path, a little above the ground, turned towards the visitor coming up the
  // path and slightly in towards it; placed again every frame, as it keeps pace.
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const unit = new THREE.Vector3(1, 1, 1);
  const place = (p: number) => {
    const heading = headingAt(p);
    const px = centerX(p) + side * offset * Math.cos(heading);
    const pz = -p + side * offset * Math.sin(heading);
    position.set(px, groundAt(px, pz) + 0.5, pz);
    rotation.setFromEuler(euler.set(0, -heading - side * 0.45, 0));
    placement.value.compose(position, rotation, unit);
  };
  place(from + lead);
  // It comes in once its note has been read (a quarter of its stretch), then traces its curve.
  const start = from + (to - from) * 0.24;
  const drawOver = to - start - 4;

  const smooth = THREE.MathUtils.smoothstep;
  const toWorld = (x: number, y: number) =>
    new THREE.Vector3((x - 0.5) * WIDTH, y * HEIGHT, 0).applyMatrix4(placement.value);
  return {
    /** World position of a point of the curve (0..1 along it), and of the target line's right end. */
    curvePoint: (t: number) => toWorld(t, curveAt(t)),
    targetEnd: () => toWorld(1, TARGET_LEVEL),
    /** The guide distance at which the curve reaches a point of it (0..1). */
    distanceAt: (t: number) => start + 1 + t * drawOver,
    /** 0..1: how much it shows now. */
    get shown() { return shown.value; },
    /** From the guide's distance: it comes in with the note, traces its curve, and fades as the note goes. */
    update(distance: number) {
      shown.value = smooth(distance, start - 1, start + 3) * (1 - smooth(distance, to - 2, to + 1.5));
      reveal.value = THREE.MathUtils.clamp((distance - (start + 1)) / drawOver, 0, 1);
      sprite.visible = shown.value > 0.001;
      if (sprite.visible) place(distance + lead);
    },
    /** 0..1: it fades with the walls for the view back from the summit. */
    setShown(amount: number) {
      sprite.visible = sprite.visible && amount > 0.001;
    },
    dispose() {
      // Not sprite.geometry: every three.js Sprite shares one geometry.
      material.dispose();
    },
  };
}
