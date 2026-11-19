import * as THREE from 'three/webgpu';
import {
  abs, atan, color, exp, float, floor, fract, instanceIndex, instancedArray, max, mix, smoothstep, uint, uniformArray, uv,
} from 'three/tsl';
import { particleShape } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';

/**
 * The brand's graduated rule, as a ring on a plane's uv: a hairline circle, fine ticks all
 * round and a longer one every sixth.
 */
export const graduatedRing = () => {
  const centre = uv().sub(0.5);
  const r = centre.length().mul(2);
  const turn = atan(centre.y, centre.x).div(Math.PI * 2).add(0.5);
  const tick = turn.mul(60).fract();
  const major = turn.mul(10).fract();
  const fine = smoothstep(0.18, 0.06, abs(tick.sub(0.5))).mul(smoothstep(0.86, 0.88, r)).mul(smoothstep(0.97, 0.95, r));
  const long = smoothstep(0.03, 0.01, abs(major.sub(0.5))).mul(smoothstep(0.78, 0.8, r)).mul(smoothstep(0.97, 0.95, r));
  const line = exp(r.sub(0.97).mul(90).pow(2).negate());
  return fine.mul(0.6).add(long).add(line.mul(0.8)).mul(r.lessThan(1).select(float(1), float(0)));
};

/**
 * A badge's projection (« l'épure lumineuse »): the one line that ties a badge, its words
 * and its hologram (ui/holograms.ts) to the thing they explain. It plays first, as the
 * badge's announcement:
 *  1. a point of light comes on where the thing is, flaring once;
 *  2. a fine line of light rises from it to the badge, its head bright;
 *  3. it holds, quiet, while the badge is read; it withdraws to the ground as the badge goes.
 * Nothing else: no ring, no extra points, so the badge and its hologram stay the subject.
 *
 * Every step is timed from the moment the badge comes in (seconds). SLOTS at a time, all in
 * one draw, from a few uniforms per slot.
 */
export const SLOTS = 6;
/** When each step happens, in seconds from the badge's start (its card follows, style.css). */
export const PROJECTION = { flash: 0.35, beamFrom: 0.1, beamTo: 0.6 };

const BEAM_POINTS = 44;
const AURA = 7; // soft glows along the line: the light it gives off

// Kinds of point.
const BEAM = 0;
const GLOW = 1;
const ANCHOR = 2;

export interface ProjectionSlot {
  ground: THREE.Vector3;
  top: THREE.Vector3;
  /** Seconds since the badge came in. */
  age: number;
  /** 0..1, how much it shows (its badge's opacity). */
  fade: number;
}

export function createProjections(scene: THREE.Scene) {
  const data: number[] = [];
  const add = (kind: number, w: number) => data.push(0, 0, 0, kind + Math.min(Math.max(w, 0), 0.999));
  for (let i = 0; i < BEAM_POINTS; i++) add(BEAM, i / (BEAM_POINTS - 1));
  for (let i = 0; i < AURA; i++) add(GLOW, (i + 0.5) / AURA);
  add(ANCHOR, 0);
  const perSlot = data.length / 4;
  const points = instancedArray(new Float32Array(data), 'vec4');

  const grounds = uniformArray(Array.from({ length: SLOTS }, () => new THREE.Vector3()), 'vec3');
  const tops = uniformArray(Array.from({ length: SLOTS }, () => new THREE.Vector3()), 'vec3');
  /** age, fade, unused, unused. */
  const states = uniformArray(Array.from({ length: SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');

  const slot = instanceIndex.div(uint(perSlot));
  const point = points.element(instanceIndex.mod(uint(perSlot)));
  const kind = floor(point.w);
  const w = fract(point.w);
  const is = (k: number) => kind.equal(k);
  const ground = grounds.element(slot) as unknown as THREE.Node<'vec3'>;
  const top = tops.element(slot) as unknown as THREE.Node<'vec3'>;
  const state = states.element(slot) as unknown as THREE.Node<'vec4'>;
  const age = state.x;
  const fade = state.y;

  // The line rises to the badge, and withdraws as the badge goes.
  const rising = smoothstep(PROJECTION.beamFrom, PROJECTION.beamTo, age).mul(smoothstep(0, 0.55, fade));
  const reach = rising.mul(rising).mul(float(3).sub(rising.mul(2)));
  const beamShows = smoothstep(reach.add(0.02), reach.sub(0.02), w);
  const head = exp(abs(w.sub(reach)).mul(-30)).mul(smoothstep(0.02, 0.1, reach)).mul(float(1).sub(smoothstep(0.9, 1, rising)));
  const settled = smoothstep(PROJECTION.beamTo, PROJECTION.beamTo + 0.6, age);
  const flash = exp(age.mul(-2.2 / PROJECTION.flash));

  const position = is(ANCHOR).select(ground, mix(ground, top, w.mul(reach)));
  const strength = is(BEAM).select(beamShows.mul(mix(1, 0.5, settled)).add(head.mul(2)),
    is(GLOW).select(beamShows.mul(mix(0.18, 0.08, settled)), flash.mul(2).add(0.65)));
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = position;
  const shape = particleShape();
  const fromCentre = uv().sub(0.5).length().mul(2);
  const soft = exp(fromCentre.mul(fromCentre).mul(-4)).mul(smoothstep(1, 0.7, fromCentre));
  // Champagne while it forms (the head, the anchor's flash), off-white once it holds.
  material.colorNode = mix(color(LAB.dust).mul(0.9), color(BRAND.champagne).mul(1.5), max(head, flash).min(1));
  material.opacityNode = is(GLOW).select(soft, shape.alpha).mul(strength).mul(fade);
  material.scaleNode = is(BEAM).select(float(0.06).add(head.mul(0.12)),
    is(GLOW).select(float(0.5), float(0.16).add(flash.mul(0.22))));
  const sprite = new THREE.Sprite(material);
  sprite.count = perSlot * SLOTS;
  sprite.frustumCulled = false;
  sprite.visible = false;
  scene.add(sprite);

  return {
    /** The projections of this frame; at most SLOTS, the rest are not drawn. */
    update(slots: ProjectionSlot[]) {
      const n = Math.min(SLOTS, slots.length);
      for (let i = 0; i < SLOTS; i++) {
        const s = slots[i];
        const st = states.array[i] as THREE.Vector4;
        if (i < n && s) {
          (grounds.array[i] as THREE.Vector3).copy(s.ground);
          (tops.array[i] as THREE.Vector3).copy(s.top);
          st.set(s.age, s.fade, 0, 0);
        } else {
          st.set(0, 0, 0, 0);
        }
      }
      sprite.visible = n > 0;
    },
    dispose() {
      // Not sprite.geometry: every three.js Sprite shares one geometry.
      material.dispose();
    },
  };
}

export type Projections = ReturnType<typeof createProjections>;
