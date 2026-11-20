import * as THREE from 'three/webgpu';
import {
  abs, cameraPosition, color, cos, exp, float, floor, hash, instanceIndex, max, mix, pow, reflect, round, sin, smoothstep,
  uint, uniform, vec2, vec3,
} from 'three/tsl';
import { DUSK, SEA_LEVEL, waveNode } from './coast';
import { SUMMIT_Z, groundNode } from './path';
import { particleShape, twinkle } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';

/**
 * The sea, made of the Lab's own particles: a surface of points of light that rises and
 * falls with the swell (coast.ts), catches the last light of the day in a path of glints
 * towards it, and runs up the shore in a line of foam. The same sea all round the
 * mountain: crossed by boat at the start, seen from the summit at the end.
 *
 * Two layers of particles, one material each:
 * - near: a fine grid that travels with the camera (a treadmill fixed to the world, so the
 *   swell stays in place), for the crossing, where the eye is just over the water; the
 *   boat parts it: a wave at its bow, a wake opening behind it;
 * - far: rings round the mountain out to the horizon, sparser further out, for the
 *   distance (during the crossing) and for the whole view from the summit.
 * Where the ground stands above the sea, there is no sea: the shore is wherever the ground
 * meets the water, and the foam runs along it.
 */

const NEAR = { size: 64, spacing: 0.42 };
const FAR = { from: 192, to: 1150 };

export interface SeaOptions {
  time: THREE.Node<'float'>;
  /** Particles for the near layer and for the far one. */
  near: number;
  far: number;
}

export function createSea(scene: THREE.Scene, { time, near: nearCount, far: farCount }: SeaOptions) {
  /** 0..1: how much it shows. */
  const shown = uniform(0);
  /** 0..1: the near layer (the crossing). */
  const nearShown = uniform(0);
  /** Where the sea's surface is drawn (SEA_LEVEL while riding; lower once the summit's view deepens). */
  const level = uniform(SEA_LEVEL);
  /** How strongly the swell shows (larger from far above, where it would otherwise not read). */
  const swell = uniform(1);
  /** The near layer's centre (the camera, on the water), and the boat: x, z, heading, speed (0..1). */
  const centre = uniform(new THREE.Vector2());
  const boat = uniform(new THREE.Vector4(0, 1000, 0, 0));
  /** 0..1: the glints and the sky's light, faded while the curve is drawn at the end. */
  const glints = uniform(1);

  const shape = particleShape();
  const light = vec3(DUSK.x, DUSK.y, DUSK.z);

  /** Everything a particle of sea is, from where it lies on the water (x, z) and its seed. */
  const water = (x: THREE.Node<'float'>, z: THREE.Node<'float'>, seed: THREE.Node<'float'>, nearLayer: boolean) => {
    const ground = groundNode(x, z);
    const depth = float(SEA_LEVEL).sub(ground);
    // The sea is where the ground is under it; calmer in the shallows.
    const wet = smoothstep(-0.02, 0.2, depth);
    const calm = smoothstep(0, 2.5, depth).mul(0.75).add(0.25);
    const wave = waveNode(x, z, time);
    let height: THREE.Node<'float'> = wave.height.mul(calm).mul(swell);
    // The foam running up the shore and back, wave after wave.
    const surge = sin(time.mul(0.9).add(x.mul(0.13)).add(z.mul(0.09))).mul(0.12).add(0.14);
    const foam = exp(depth.sub(surge).div(0.24).pow(2).negate()).mul(smoothstep(-0.1, 0.05, depth));
    // In the shallows the surface thins out over its floor, which shows through (terrain.ts):
    // the water reads lighter and clearer as it nears the beach.
    const clear = smoothstep(0.15, 1.1, depth).mul(0.6).add(0.4);
    let wake: THREE.Node<'float'> = float(0);
    let dry: THREE.Node<'float'> = float(1);
    if (nearLayer) {
      // The boat: a wave at its bow, and its wake opening behind it in a V.
      const heading = boat.z;
      const fwd = vec2(sin(heading), cos(heading).negate());
      const offset = vec2(x.sub(boat.x), z.sub(boat.y));
      const ahead = offset.dot(fwd);
      const across = abs(offset.x.mul(fwd.y.negate()).add(offset.y.mul(fwd.x)));
      const behind = ahead.negate().sub(2.2);
      const arms = exp(across.sub(behind.mul(0.36)).sub(0.75).div(0.32).pow(2).negate())
        .mul(exp(behind.mul(-0.07))).mul(behind.greaterThan(0).select(float(1), float(0)));
      const trough = exp(across.div(0.9).pow(2).negate()).mul(exp(behind.mul(-0.12))).mul(behind.greaterThan(-0.4).select(float(1), float(0)));
      const bow = exp(ahead.sub(2.35).div(0.45).pow(2).negate()).mul(exp(across.div(0.75).pow(2).negate()));
      wake = arms.mul(0.9).add(trough.mul(0.45)).add(bow.mul(0.8)).mul(boat.w);
      // No sea inside the hull.
      dry = smoothstep(0.8, 1.15, ahead.div(2.45).pow(2).add(across.div(0.86).pow(2)));
      height = height.add(sin(behind.mul(2.6).sub(time.mul(3.2))).mul(0.05).mul(arms.add(trough)).mul(boat.w))
        .add(bow.mul(0.08).mul(boat.w));
    }
    const position = vec3(x, level.add(height).add(foam.mul(0.04)), z);
    // The glints: the surface turned to mirror the last light towards the eye.
    const view = position.sub(cameraPosition).normalize();
    const mirrored = max(reflect(view, wave.normal).dot(light), 0);
    const glint = pow(mirrored, 70).mul(twinkle(time, seed, 0.85)).mul(2.6).add(pow(mirrored, 7).mul(0.35));
    const crest = smoothstep(0.05, 0.3, wave.height.mul(calm));
    const fromEye = position.sub(cameraPosition).length();
    const haze = smoothstep(1500, 260, fromEye);
    const base = float(0.3).add(crest.mul(0.25)).mul(haze.mul(0.75).add(0.25));
    const brightness = base.mul(clear).add(glint.mul(glints)).add(foam.mul(1.3)).add(wake);
    const tint = mix(mix(vec3(0.62, 0.7, 0.86), vec3(1, 1, 1), crest.mul(0.5).add(haze.mul(0.3))).mul(color(LAB.dust)),
      color(BRAND.champagne).mul(1.35), glint.mul(glints).add(foam).add(wake).min(1));
    const size = float(0.03).add(fromEye.mul(0.0042)).mul(float(1).add(glint.mul(glints).mul(0.5)));
    return { position, brightness: brightness.mul(wet).mul(dry), tint, size };
  };

  const makeLayer = (count: number, place: (seed: THREE.Node<'float'>) => { x: THREE.Node<'float'>; z: THREE.Node<'float'> }, nearLayer: boolean) => {
    const seed = hash(instanceIndex.add(uint(nearLayer ? 7 : 911)));
    const { x, z } = place(seed);
    const w = water(x, z, seed, nearLayer);
    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    material.positionNode = w.position;
    material.colorNode = w.tint;
    // The far layer steps aside where the near one is, during the crossing.
    const aside = nearLayer ? nearShown : float(1).sub(nearShown.mul(smoothstep(30, 24, vec2(x, z).sub(centre).length())));
    material.opacityNode = shape.alpha.mul(w.brightness).mul(aside).mul(shown).min(1);
    material.scaleNode = w.size;
    const sprite = new THREE.Sprite(material);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, material };
  };

  // Near: a grid fixed to the world, its cells taken where the camera is.
  const side = Math.max(16, Math.floor(Math.sqrt(nearCount)));
  const cell = (index: THREE.Node<'float'>, at: THREE.Node<'float'>) => {
    const here = floor(at.div(NEAR.spacing));
    return index.add(round(here.sub(index).div(side)).mul(side));
  };
  const nearLayer = makeLayer(side * side, () => {
    const i = instanceIndex.mod(uint(side)).toFloat();
    const j = instanceIndex.div(uint(side)).toFloat();
    const cx = cell(i, centre.x);
    const cz = cell(j, centre.y);
    const jitter = hash(cx.add(50000).mul(131).add(cz.add(50000)).toUint());
    return {
      x: cx.add(jitter.mul(0.8)).mul(NEAR.spacing),
      z: cz.add(hash(jitter.mul(1e6).toUint()).mul(0.8)).mul(NEAR.spacing),
    };
  }, true);

  // Far: rings round the mountain, further apart further out.
  const rings = Math.max(40, Math.round(Math.sqrt(farCount / 4)));
  const perRing = Math.max(80, Math.floor(farCount / rings));
  const farLayer = makeLayer(rings * perRing, (seed) => {
    const k = instanceIndex.div(uint(perRing)).toFloat();
    const m = instanceIndex.mod(uint(perRing)).toFloat();
    const r = float(FAR.from).mul(pow(float(FAR.to / FAR.from), k.add(seed.mul(0.9)).div(rings)));
    const a = m.add(hash(instanceIndex.add(uint(3))).mul(0.8)).add(k.mul(0.5)).div(perRing).mul(Math.PI * 2);
    return { x: cos(a).mul(r), z: sin(a).mul(r).add(SUMMIT_Z) };
  }, false);

  return {
    /** This frame: how much it shows, the near layer's share, where the camera is, the boat. */
    update(state: { shown: number; near: number; camera: THREE.Vector3; boat?: { x: number; z: number; heading: number; speed: number } }) {
      shown.value = state.shown;
      nearShown.value = state.near;
      centre.value.set(state.camera.x, state.camera.z);
      if (state.boat) boat.value.set(state.boat.x, state.boat.z, state.boat.heading, state.boat.speed);
      else boat.value.set(0, 1e5, 0, 0);
      farLayer.sprite.visible = state.shown > 0.001;
      nearLayer.sprite.visible = state.shown > 0.001 && state.near > 0.001;
    },
    /** For the summit's view: where the surface is drawn, how strongly the swell reads, the glints. */
    setView(view: { level: number; swell: number; glints: number }) {
      level.value = view.level;
      swell.value = view.swell;
      glints.value = view.glints;
    },
    objects: [nearLayer.sprite, farLayer.sprite],
    dispose() {
      // Not the sprites' geometry: every three.js Sprite shares one.
      nearLayer.material.dispose();
      farLayer.material.dispose();
    },
  };
}

export type Sea = ReturnType<typeof createSea>;
