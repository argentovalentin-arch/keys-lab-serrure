import * as THREE from 'three/webgpu';
import {
  abs, cameraPosition, color, cos, exp, float, floor, hash, instanceIndex, max, mix, mx_noise_float, pow,
  reflect, round, sin, smoothstep, uint, uniform, vec2, vec3,
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
  /**
   * How far out round the mountain the far layer reaches (world units): out to its last ring
   * while riding; nearer for the closing view, so its horizon comes down the screen and the
   * sky over it holds the closing curve (terrain.ts). Its outer rings fade, from the edge in.
   */
  const reach = uniform(1e6);

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
    let parted: THREE.Node<'vec2'> = vec2(0, 0);
    let surface: THREE.Node<'vec3'> = wave.normal;
    let wakeHeight: THREE.Node<'float'> = float(0);
    /** How much light the water gives where the boat's waves run: more on their crests, less in their troughs. */
    let wakeShade: THREE.Node<'float'> = float(1);
    if (nearLayer) {
      // The boat moving over the water, as water answers it (from its real place, heading and
      // speed, `boat.w`, terrain.ts). The sea's own surface takes the boat's waves: along the
      // hull the water is pushed aside and raised at the bow; from the stern, the waves a moving
      // hull leaves (a Kelvin wake): divergent crests running out and back on either side,
      // transverse ones between them, all within a V of about 19.5 degrees that widens behind
      // and dies away. They tilt the surface, so the last light glints off it differently:
      // the wake is read as water is, in its reflections. Right behind the hull, the water is
      // broken and smoothed in turn, a little foam at the stern only.
      const heading = boat.z;
      const go = boat.w;
      const fwd = vec2(sin(heading), cos(heading).negate());
      const sideDir = vec2(fwd.y.negate(), fwd.x);
      /** The wake's height at a point of the water (world units), from the boat's waves. */
      const boatWaves = (px: THREE.Node<'float'>, pz: THREE.Node<'float'>) => {
        const off = vec2(px.sub(boat.x), pz.sub(boat.y));
        const ahead = off.dot(fwd);
        const across = abs(off.dot(sideDir));
        const behind = ahead.negate().sub(2.25);
        const astern = smoothstep(-0.4, 0.8, behind);
        const dies = exp(behind.div(-9)).mul(smoothstep(17, 10, behind));
        const edge = behind.mul(0.354).add(0.6);
        const inside = smoothstep(edge.add(0.9), edge.sub(0.2), across);
        // Divergent crests, at about 35 degrees to the track, running outward as the boat goes on.
        const divergent = sin(across.mul(0.82).add(behind.mul(0.57)).mul(4.2).sub(time.mul(3))).mul(smoothstep(edge.mul(0.2), edge.mul(0.85), across));
        // Transverse crests across the track, between the arms.
        const transverse = sin(behind.mul(3.4).sub(time.mul(3.2))).mul(float(1).sub(smoothstep(edge.mul(0.35), edge, across))).mul(0.7);
        // The bow wave, and the water lifted along the hull's sides.
        const hullHalf = float(0.82).mul(max(float(1).sub(ahead.div(2.4).pow(2)), 0).pow(0.6));
        const byHull = exp(across.sub(hullHalf).div(0.38).pow(2).negate()).mul(smoothstep(2.7, 1.9, abs(ahead)));
        const bow = exp(ahead.sub(2.3).div(0.5).pow(2).negate()).mul(exp(across.div(0.8).pow(2).negate()));
        return divergent.mul(0.55).add(transverse.mul(0.45)).mul(inside).mul(dies).mul(astern).mul(0.12)
          .add(bow.mul(0.08)).add(byHull.mul(0.035)).mul(go);
      };
      const offset = vec2(x.sub(boat.x), z.sub(boat.y));
      const ahead = offset.dot(fwd);
      const sideways = offset.dot(sideDir);
      const across = abs(sideways);
      const behind = ahead.negate().sub(2.25);
      const astern = smoothstep(-0.4, 0.8, behind);
      wakeHeight = boatWaves(x, z);
      // The surface's tilt from those waves (read a little way off), added to the swell's.
      const E = 0.12;
      const tiltX = boatWaves(x.add(E), z).sub(wakeHeight).div(E);
      const tiltZ = boatWaves(x, z.add(E)).sub(wakeHeight).div(E);
      // Right behind the hull the water is broken (small, quick ripples), then smoother than
      // the sea round it for a while: the wake's calm band.
      const band = exp(across.div(behind.mul(0.1).add(0.6)).pow(2).negate()).mul(astern).mul(go);
      const broken = band.mul(exp(behind.div(-2.5)));
      const calmBand = band.mul(float(1).sub(exp(behind.div(-2.5)))).mul(exp(behind.div(-12)));
      const chop = mx_noise_float(vec3(x.mul(2.2), z.mul(2.2), time.mul(1.4)));
      const swellTilt = vec3(wave.normal.x, 0, wave.normal.z).mul(float(1).sub(calmBand.mul(0.6)));
      surface = vec3(swellTilt.x.sub(tiltX).add(chop.mul(broken).mul(0.35)), 1, swellTilt.z.sub(tiltZ).add(chop.mul(broken).mul(0.2))).normalize();
      // The points themselves move with the water: pushed out by the hull, spread as the V opens.
      const hullHalf = float(0.82).mul(max(float(1).sub(ahead.div(2.4).pow(2)), 0).pow(0.6));
      const byHull = exp(across.sub(hullHalf).div(0.38).pow(2).negate()).mul(smoothstep(2.7, 1.9, abs(ahead)));
      const opening = exp(behind.div(-8)).mul(astern).mul(smoothstep(0, 1.4, across)).mul(smoothstep(behind.mul(0.354).add(1.4), behind.mul(0.354), across));
      // The water thins out in the hull's track and gathers along the V's arms.
      parted = sideDir.mul(sideways.sign()).mul(byHull.mul(0.2).add(opening.mul(0.3)).mul(go));
      // The crests catch the light as the sea's own crests do; the troughs between them darken.
      wakeShade = float(1).add(wakeHeight.div(0.12).mul(3.5)).max(0.15);
      height = height.add(wakeHeight).add(chop.mul(broken).mul(0.02));
      // A little foam at the stern only, in uneven patches, gone within a few lengths.
      const foamy = smoothstep(0.1, 0.65, mx_noise_float(vec3(x.mul(1.7), z.mul(1.7), time.mul(0.9))));
      wake = broken.mul(foamy).mul(0.55);
      // No sea inside the hull.
      dry = smoothstep(0.8, 1.15, ahead.div(2.45).pow(2).add(across.div(0.86).pow(2)));
    }
    const position = vec3(x.add(parted.x), level.add(height).add(foam.mul(0.04)), z.add(parted.y));
    // The glints: the surface turned to mirror the last light towards the eye.
    const view = position.sub(cameraPosition).normalize();
    const mirrored = max(reflect(view, surface).dot(light), 0);
    const glint = pow(mirrored, 70).mul(twinkle(time, seed, 0.85)).mul(2.6).add(pow(mirrored, 7).mul(0.35));
    const crest = smoothstep(0.05, 0.3, wave.height.mul(calm).add(wakeHeight.mul(1.5)));
    const fromEye = position.sub(cameraPosition).length();
    const haze = smoothstep(1500, 260, fromEye);
    const base = float(0.3).add(crest.mul(0.25)).mul(haze.mul(0.75).add(0.25));
    const brightness = base.mul(clear).mul(wakeShade).add(glint.mul(glints)).add(foam.mul(1.3)).add(wake);
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
    const aside = nearLayer ? nearShown : float(1).sub(nearShown.mul(smoothstep(30, 24, vec2(x, z).sub(centre).length())))
      .mul(smoothstep(reach, reach.mul(0.9), vec2(x, z.sub(SUMMIT_Z)).length()));
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
    /** How far out the far layer reaches (world units round the mountain): see `reach`. */
    setReach(radius: number) {
      reach.value = radius;
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
