import * as THREE from 'three/webgpu';
import { abs, clamp, color, float, mix, pow, smoothstep, vec3 } from 'three/tsl';
import { SPRITE_GROWTH } from '../world/sprite';
import { BRAND } from '../core/brand';

/**
 * How the Lab draws relief, in one place: the mountain (relief.ts), the ground the ride
 * crosses (terrain.ts), the shore (path.ts) and the islands (islands.ts) are the same
 * matter, read the same way.
 *
 * - The shape is drawn as a relief map draws it: half the points lie on contour lines (one
 *   every `step` of height), moved there from where they fell by one step of Newton's
 *   method along the slope; the others stay where they fell.
 * - Its volume is read in champagne (brand.ts), from one light: the last light of the day,
 *   from over the sea beyond the islands, to the right and well up. Every point takes a
 *   tone from how its ground faces that light, and from whether it lies on a crest or in a
 *   hollow: in the light towards off-white, on the slopes champagne, in the shade and the
 *   hollows champagne cooled towards the navy and dimmer, crests and breaks of slope
 *   picked out. The tone sets both the colour and how much light the point gives, so the
 *   shading reads even where many points overlap.
 */

/** The light that models the relief (from the ground towards it). */
export const KEY = new THREE.Vector3(0.55, 0.62, 0.56).normalize();

/** Share of the points moved onto a contour line. */
export const CONTOUR_SHARE = 0.5;

// The tones, all from the brand's colours: champagne in the shade (cooled towards navy 60),
// champagne, champagne whitening towards off-white in the light.
const SHADE = new THREE.Color(BRAND.champagne).lerp(new THREE.Color(BRAND.navy60), 0.55);
const MID = new THREE.Color(BRAND.champagne);
const LIT = new THREE.Color(BRAND.champagne).lerp(new THREE.Color(BRAND.offwhite), 0.65);
// With more contrast (see `contrast`): a deep champagne for the hollows and the slopes turned
// away, darkened towards the navy (never black, never another hue), and a bright champagne
// for the crests, the edges and the faces in the light.
const DEEP = new THREE.Color(BRAND.champagne).lerp(new THREE.Color(BRAND.navy), 0.62);
const BRIGHT = new THREE.Color(BRAND.champagne).lerp(new THREE.Color(BRAND.offwhite), 0.85);

export interface Tone {
  /** 0 (deep shade) .. 1 (full light). */
  tone: THREE.Node<'float'>;
  colour: THREE.Node<'vec3'>;
  /** How much light the point gives (multiplies its opacity). */
  strength: THREE.Node<'float'>;
  /** 0..1: on a crest or a break of slope. */
  crest: THREE.Node<'float'>;
  /** How much larger (> 1) or finer (< 1) the point is drawn: the light ones a little larger. */
  size: THREE.Node<'float'>;
}

/**
 * The tone of a point of relief: its ground's normal (world, unit), its curvature
 * (`cavity`: > 0 on a crest, < 0 in a hollow, about -1..1) and, optionally, the direction
 * from it to the eye, for the skylines (a silhouette turned to the light catches it).
 */
/**
 * `contrast` (0..1) widens the reading: from 0, the tones as they were first set, to 1, a
 * more marked topography: the shade and the hollows go down to a deep champagne and give
 * less light, the crests, edges and faces in the light go up to a bright champagne and give
 * more; the points follow, finer in the shade, a little larger in the light. The tones stay
 * champagne throughout: no new hue, and the dark ones never black.
 */
export function topoTone(
  normal: THREE.Node<'vec3'>, cavity: THREE.Node<'float'>, toEye?: THREE.Node<'vec3'>, contrast: THREE.Node<'float'> = float(0),
): Tone {
  const facing = normal.dot(vec3(KEY.x, KEY.y, KEY.z));
  // Wrapped, so the shade has its own gradations rather than one flat dark.
  const lit = clamp(facing.add(0.35).div(1.35), 0, 1);
  const crest = smoothstep(0.08, 0.7, cavity);
  const hollow = smoothstep(-0.08, -0.7, cavity);
  let tone: THREE.Node<'float'> = lit.mul(0.82).add(crest.mul(0.32)).sub(hollow.mul(0.38));
  if (toEye) {
    // A skyline: the ground turned edge-on to the eye.
    const rim = pow(float(1).sub(abs(normal.dot(toEye))), 4).mul(smoothstep(-0.2, 0.4, facing));
    tone = tone.add(rim.mul(0.35));
  }
  tone = clamp(tone, 0, 1);
  const soft = mix(mix(color(SHADE), color(MID), smoothstep(0, 0.55, tone)), color(LIT), smoothstep(0.55, 1, tone));
  const softStrength = float(0.3).add(tone.mul(0.95)).add(crest.mul(0.3));
  // The marked reading: the tone pulled apart round its middle; the breaks of slope (crests
  // and hollows alike) given their own weight, light on a crest, deep in a hollow.
  const marked = clamp(tone.sub(0.5).mul(1.7).add(0.5).add(crest.mul(0.24)).sub(hollow.mul(0.3)), 0, 1);
  const deep = mix(mix(color(DEEP), color(SHADE), smoothstep(0, 0.4, marked)), color(MID), smoothstep(0.3, 0.65, marked));
  const strong = mix(deep, color(BRIGHT), smoothstep(0.62, 1, marked).add(crest.mul(0.35)).min(1));
  const strongStrength = float(0.13).add(marked.mul(marked).mul(1.35)).add(crest.mul(0.6));
  const colour = mix(soft, strong, contrast);
  const strength = mix(softStrength, strongStrength, contrast);
  const size = mix(float(1), mix(float(0.82), float(1.2), marked), contrast);
  return { tone, colour, strength, crest, size };
}

/**
 * A point of relief's size: points on contour lines a little larger than the others (they
 * draw the shape from afar), a few larger still; and seen from far, larger, so the whole
 * relief shows and not only what is near.
 */
export function topoSize(fromEye: THREE.Node<'float'>, onContour: THREE.Node<'bool'>, seed: THREE.Node<'float'>) {
  return onContour.select(float(0.26), float(0.2)).add(seed.pow(6).mul(0.12)).mul(SPRITE_GROWTH)
    .mul(fromEye.div(55).max(1).pow(0.85));
}

/**
 * On the CPU, for relief laid out once (the islands): a point moved onto its nearest
 * contour line. `height` gives the ground at (x, z); returns [x, z, level].
 */
export function toContour(height: (x: number, z: number) => number, x: number, z: number, step: number, top = Infinity): [number, number, number] {
  const STEP = 0.4;
  const h0 = height(x, z);
  const gx = (height(x + STEP, z) - h0) / STEP;
  const gz = (height(x, z + STEP) - h0) / STEP;
  const slope2 = Math.max(gx * gx + gz * gz, 0.0004);
  const level = Math.min(Math.round(h0 / step) * step, top);
  const shift = THREE.MathUtils.clamp((h0 - level) / slope2, -2, 2);
  return [x - gx * shift, z - gz * shift, level];
}

/**
 * On the CPU: the ground's normal and curvature at (x, z), from its heights `reach` away on
 * either side (the same reading the shaders make of the mountain).
 */
export function slopeAt(height: (x: number, z: number) => number, x: number, z: number, reach: number, cavityScale: number) {
  const h0 = height(x, z);
  const e = height(x + reach, z);
  const w = height(x - reach, z);
  const n = height(x, z - reach);
  const s = height(x, z + reach);
  const normal = new THREE.Vector3(-(e - w) / (2 * reach), 1, -(s - n) / (2 * reach)).normalize();
  const cavity = THREE.MathUtils.clamp((4 * h0 - e - w - n - s) * cavityScale, -1, 1);
  return { normal, cavity, height: h0 };
}

// ---- Noise, on the CPU, for relief laid out once: gradient noise, its sums, its ridges.
const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 20250611;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return [...p, ...p];
})();
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, dx: number, dy: number) => {
  const g = GRAD[h & 7];
  return g[0] * dx + g[1] * dy;
};

/** Gradient noise, about -1..1. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 255;
  const Y = yi & 255;
  const aa = PERM[PERM[X] + Y];
  const ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y];
  const bb = PERM[PERM[X + 1] + Y + 1];
  const u = fade(xf);
  const v = fade(yf);
  const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
  const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
  return (x1 + v * (x2 - x1)) * 1.3;
}

/** Sum of `octaves` of noise, each finer and fainter, about -1..1. */
export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged noise, 0..1: sharp crests along the noise's zero lines, rounded troughs between. */
export function ridged(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.6;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const r = 1 - Math.abs(noise2(x, y));
    sum += r * r * amp;
    norm += amp;
    x = x * 2.1 + 5.3;
    y = y * 2.1 + 11.9;
    amp *= 0.5;
  }
  return sum / norm;
}
