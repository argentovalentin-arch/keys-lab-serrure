import * as THREE from 'three/webgpu';
import {
  abs, color, cos, exp, float, floor, fract, instanceIndex, instancedArray, max, pow, sin, smoothstep, uint, uniform, uniformArray, vec3,
} from 'three/tsl';
import { centerX, groundAt } from './path';
import { particleShape } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';

/**
 * « Les bons leviers. Pas tous. »: the energy that runs through the chosen levers, and only
 * them. It rises out of the lit path to the first lever, which it throws; from there it
 * bounces across the path to the next, on the other side, which it throws in turn; and so
 * on, left, right, left, right, until the last two, side by side on the right, where it
 * runs along. It ends there, on the last lever: nothing leaves it for the summit.
 *
 * Each leg is an impulse that can be followed with the eye: a bright head with a trail,
 * travelling along an arch over the path (lower along one side), leaving a faint trace;
 * it lands on the next lever's knob as that lever is thrown (levers.ts), with a ring of
 * light opening there: the impact, the bounce. All of it is tied to the guide's distance
 * (the ride's pace slows meanwhile, pace.ts), so each leg takes about two seconds.
 *
 * One draw: the points are laid once on the CPU (their leg and place along it in their
 * fourth component), moved and lit in the shader from one uniform per leg.
 */

const POINTS_PER_LEG = 120;
const IMPACT_POINTS = 28;
/** Height of a lever's knob over its plinth. */
const KNOB = 1.02;

export interface NetworkOptions {
  /** Where each chosen lever stands (its plinth), in the order they are thrown, and when. */
  stops: { at: number; place: THREE.Vector3; side: number }[];
  /** Guide distances over which a lever's throw runs, before it (levers.ts). */
  throwFrom: number;
  throwTo: number;
  /** The Terrain's clock, for the current along the traces. */
  time: THREE.Node<'float'>;
}

export function createNetwork(scene: THREE.Scene, { stops, throwFrom, throwTo, time }: NetworkOptions) {
  // The legs: from the path to the first lever, then from each lever to the next.
  interface Leg { from: THREE.Vector3; to: THREE.Vector3; start: number; end: number; height: number }
  const legs: Leg[] = [];
  const top = (p: THREE.Vector3) => p.clone().setY(p.y + KNOB);
  const onPath = (p: number, lift: number) => new THREE.Vector3(centerX(p), groundAt(centerX(p), -p) + lift, -p);
  if (stops.length) {
    const first = stops[0];
    // Out of the path, a little ahead of the guide, as the first lever's throw begins.
    legs.push({ from: onPath(first.at - 2, 0.15), to: top(first.place), start: first.at - throwFrom - 3, end: first.at - throwFrom, height: 1.4 });
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      const across = a.side !== b.side;
      // From the end of one throw to the start of the next: the impulse arrives as it is thrown.
      legs.push({ from: top(a.place), to: top(b.place), start: a.at - throwTo, end: b.at - throwFrom, height: across ? 2.1 : 1.1 });
    }
  }

  const data: number[] = [];
  legs.forEach((leg, i) => {
    const control = leg.from.clone().lerp(leg.to, 0.5);
    control.y = Math.max(leg.from.y, leg.to.y) + leg.height;
    for (let k = 0; k < POINTS_PER_LEG; k++) {
      const t = k / (POINTS_PER_LEG - 1);
      const u = 1 - t;
      data.push(
        u * u * leg.from.x + 2 * u * t * control.x + t * t * leg.to.x,
        u * u * leg.from.y + 2 * u * t * control.y + t * t * leg.to.y,
        u * u * leg.from.z + 2 * u * t * control.z + t * t * leg.to.z,
        i + Math.min(t, 0.999),
      );
    }
  });
  const legCount = legs.length;
  // The impacts: a ring of points round each lever's knob (the last leg ends on the path: none).
  stops.forEach((stop, s) => {
    const centre = top(stop.place);
    for (let k = 0; k < IMPACT_POINTS; k++) data.push(centre.x, centre.y, centre.z, legCount + s + k / IMPACT_POINTS);
  });
  const points = instancedArray(new Float32Array(data), 'vec4');
  /** How far each leg has gone (0..1); each impact's age (0 at its leg's arrival, -1 before). */
  const progress = uniformArray(legs.map(() => 0), 'float');
  const impacts = uniformArray(stops.map(() => -1), 'float');
  const shown = uniform(0);

  const point = points.element(instanceIndex);
  const index = floor(point.w);
  const t = fract(point.w);
  const isImpact = index.greaterThanEqual(float(legCount));
  const leg = isImpact.select(float(0), index);
  const reach = progress.element(uint(leg.min(float(legCount - 1)))) as unknown as THREE.Node<'float'>;
  const age = impacts.element(uint(index.sub(legCount).max(0).min(float(Math.max(stops.length - 1, 0))))) as unknown as THREE.Node<'float'>;

  // A leg: its trace behind the head, the head, its trail.
  const behind = reach.sub(t);
  const trace = smoothstep(-0.008, 0.008, behind);
  const travelling = smoothstep(0, 0.02, reach).mul(float(1).sub(smoothstep(0.985, 1, reach)));
  const head = exp(abs(behind).mul(-70)).mul(travelling);
  const trail = exp(behind.max(0).mul(-14)).mul(trace).mul(travelling);
  // Once landed, the trace settles to a faint line with a slow current in it.
  const landed = smoothstep(0.97, 1, reach);
  const current = pow(sin(t.mul(18).sub(time.mul(2.2)).add(leg)).mul(0.5).add(0.5), 6).mul(landed);
  const legStrength = trace.mul(float(0.35).add(current.mul(0.35)).add(trail.mul(1.1))).add(head.mul(3));

  // An impact: a ring opening from the knob, bright, gone in under a second of ride.
  const ring = age.mul(1.6).add(0.15);
  const angle = t.mul(Math.PI * 2);
  const impactStrength = age.greaterThanEqual(0).select(exp(age.mul(-2.4)).mul(2.2), float(0));

  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = isImpact.select(
    point.xyz.add(vec3(cos(angle).mul(ring), sin(angle).mul(ring).mul(0.55), sin(angle).mul(ring).mul(0.3))),
    point.xyz,
  );
  const shape = particleShape();
  const hot = max(head, impactStrength.min(1));
  material.colorNode = color(BRAND.champagne).mul(1.5).add(color(LAB.lightCore).mul(hot.mul(1.4)));
  material.opacityNode = shape.alpha.mul(isImpact.select(impactStrength, legStrength)).mul(shown);
  material.scaleNode = isImpact.select(float(0.13),
    float(0.1).add(head.mul(0.55)).add(trail.mul(0.12)));
  const sprite = new THREE.Sprite(material);
  sprite.count = data.length / 4;
  sprite.frustumCulled = false;
  sprite.visible = false;
  scene.add(sprite);

  const smooth = THREE.MathUtils.smoothstep;
  const first = legs[0]?.start ?? 0;
  // The traces between the levers stay a moment after the last one is thrown, then go as before.
  const lastEnd = stops.length ? stops[stops.length - 1].at + 3 : 0;
  return {
    /** From the guide's distance: each leg travels over its stretch; it lands as the next lever is thrown. */
    update(distance: number, lookingBack: number) {
      legs.forEach((l, i) => {
        progress.array[i] = THREE.MathUtils.clamp((distance - l.start) / (l.end - l.start), 0, 1);
      });
      stops.forEach((_, s) => {
        const arrival = legs[s].end;
        impacts.array[s] = distance >= arrival ? (distance - arrival) / 1.6 : -1;
      });
      const on = smooth(distance, first - 1, first) * (1 - smooth(distance, lastEnd + 4, lastEnd + 9)) * (1 - lookingBack);
      shown.value = on;
      sprite.visible = on > 0.001;
    },
    dispose() {
      // Not sprite.geometry: every three.js Sprite shares one geometry.
      material.dispose();
    },
  };
}

