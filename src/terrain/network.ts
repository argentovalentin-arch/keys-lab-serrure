import * as THREE from 'three/webgpu';
import { abs, color, exp, float, floor, fract, instanceIndex, instancedArray, max, pow, sin, smoothstep, uniform } from 'three/tsl';
import { particleShape } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';

/**
 * « Les bons leviers. Pas tous. »: the chosen levers, and only they, are linked to one
 * another by arcs of dotted light, in the order they are thrown — the brand's demand of
 * traceability (« chaque action renvoie à une recommandation… ») made visible: what is
 * chosen forms one whole; what is left alone stays apart.
 *
 * Each arc draws itself from the previous chosen lever to the next while that one is
 * thrown, a bright head running ahead; the one from the last lever on the left to the
 * first on the right crosses over the lane, as the eyes come back to the path. Once the
 * chain is complete, a single pulse runs along it from the first lever to the last, then
 * the arcs settle to a faint glow with a slow current in them, and go as the ride moves on.
 *
 * All of it in one draw: points laid once on the CPU (place along the chain in their
 * fourth component), drawn and lit in the shader from a handful of uniforms.
 */

const POINTS_PER_ARC = 72;

export interface NetworkOptions {
  /** Where each chosen lever stands (its plinth), in the order they are thrown, and when. */
  stops: { at: number; place: THREE.Vector3 }[];
  /** Guide distances over which a lever's throw runs, before it (levers.ts). */
  throwFrom: number;
  throwTo: number;
  /** The Terrain's clock, for the current along the arcs. */
  time: THREE.Node<'float'>;
}

export function createNetwork(scene: THREE.Scene, { stops, throwFrom, throwTo, time }: NetworkOptions) {
  const arcs = Math.min(4, stops.length - 1);
  const data: number[] = [];
  const top = (p: THREE.Vector3) => p.clone().setY(p.y + 1.02);
  for (let i = 0; i < arcs; i++) {
    const a = top(stops[i].place);
    const b = top(stops[i + 1].place);
    const span = a.distanceTo(b);
    // A gentle arch, higher for a longer span (the one over the lane most of all).
    const control = a.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + 0.5 + span * 0.12);
    for (let k = 0; k < POINTS_PER_ARC; k++) {
      const t = k / (POINTS_PER_ARC - 1);
      const u = 1 - t;
      const x = u * u * a.x + 2 * u * t * control.x + t * t * b.x;
      const y = u * u * a.y + 2 * u * t * control.y + t * t * b.y;
      const z = u * u * a.z + 2 * u * t * control.z + t * t * b.z;
      data.push(x, y, z, i + Math.min(t, 0.999));
    }
  }
  const points = instancedArray(new Float32Array(data), 'vec4');
  /** How far each arc is drawn (0..1), one per component. */
  const reveal = uniform(new THREE.Vector4(0, 0, 0, 0));
  /** Where the pulse along the whole chain stands (0..arcs), or far off. */
  const cascade = uniform(-10);
  const shown = uniform(0);

  const point = points.element(instanceIndex);
  const arc = floor(point.w);
  const t = fract(point.w);
  const drawnTo = arc.equal(0).select(reveal.x, arc.equal(1).select(reveal.y, arc.equal(2).select(reveal.z, reveal.w)));
  const drawn = smoothstep(drawnTo.add(0.012), drawnTo.sub(0.012), t);
  const drawing = smoothstep(0, 0.02, drawnTo).mul(float(1).sub(smoothstep(0.97, 1, drawnTo)));
  const head = exp(abs(t.sub(drawnTo)).mul(-45)).mul(drawing);
  // Once an arc is whole, a slow current runs through it; the chain's pulse runs over all of them.
  const whole = smoothstep(0.97, 1, drawnTo);
  const current = pow(sin(t.mul(16).sub(time.mul(2.4)).add(arc)).mul(0.5).add(0.5), 6).mul(whole);
  const along = arc.add(t);
  const pulse = exp(along.sub(cascade).mul(2.6).pow(2).negate());

  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = point.xyz;
  const shape = particleShape();
  const strength = drawn.mul(float(0.55).add(current.mul(0.4)).add(pulse.mul(1.1))).add(head.mul(1.5));
  material.colorNode = color(BRAND.champagne).mul(1.45).add(color(LAB.lightCore).mul(max(head, pulse).mul(0.5)));
  material.opacityNode = shape.alpha.mul(strength).mul(shown);
  material.scaleNode = float(0.15).add(head.mul(0.16)).add(pulse.mul(0.1));
  const sprite = new THREE.Sprite(material);
  sprite.count = data.length / 4;
  sprite.frustumCulled = false;
  sprite.visible = false;
  scene.add(sprite);

  const smooth = THREE.MathUtils.smoothstep;
  const first = stops[0]?.at ?? 0;
  const last = stops[arcs]?.at ?? 0;
  return {
    /** From the guide's distance: each arc draws during the throw of the lever it leads to. */
    update(distance: number, lookingBack: number) {
      const values = [0, 0, 0, 0];
      for (let i = 0; i < arcs; i++) {
        const to = stops[i + 1].at;
        const r = THREE.MathUtils.clamp((distance - (to - throwFrom)) / (throwFrom - throwTo), 0, 1);
        values[i] = r * r * (3 - 2 * r);
      }
      reveal.value.set(values[0], values[1], values[2], values[3]);
      // The pulse along the whole chain, once the last arc is drawn.
      const complete = last - throwTo + 0.5;
      cascade.value = distance > complete ? ((distance - complete) / 4.5) * (arcs + 1) - 0.5 : -10;
      shown.value = smooth(distance, first - throwFrom - 2, first - throwFrom) * (1 - smooth(distance, last + 6, last + 10)) * (1 - lookingBack);
      sprite.visible = shown.value > 0.001;
    },
    dispose() {
      // Not sprite.geometry: every three.js Sprite shares one geometry.
      material.dispose();
    },
  };
}
