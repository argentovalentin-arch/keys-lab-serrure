import * as THREE from 'three/webgpu';
import {
  abs, color, cos, exp, float, floor, fract, instanceIndex, instancedArray, mix, sin, smoothstep, uniform, vec3,
} from 'three/tsl';
import { particleShape } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';

/**
 * The summit's crown: the arrival's architecture, in the same light as every projection of
 * the Terrain (« l'épure lumineuse », projection.ts). It stands just beyond the top, where
 * the key ring will hang, so the visitor sees it rise ahead as they climb the last stretch:
 * - on the ground, a ring of the brand's graduated rule draws round, then its ticks;
 * - twelve uprights of light rise from it, one after the other round the ring;
 * - from each upright's top a line of light runs up to one point above the middle, the
 *   apex, where the key ring will hang: everything converges on the result;
 * - three rings, one above the other and narrower each time, draw in round it: the three
 *   pillars, Structurer, Activer, Performer, the last at the top;
 * - motes rise from the ground to the apex.
 * On arrival the apex flares, a pulse runs down every line to the ground, then it all
 * settles to a quieter glow (stabilisation) while the summit's note and keys play out, and
 * fades as the visitor turns round.
 */

const RADIUS = 8.5;
const UPRIGHTS = 12;
const APEX = 7.6; // as high as the key ring hangs (terrain.ts CROWN_TOP + summit.ts's 1.6)
const LEVELS = [
  { height: 1.7, radius: 6.6 },
  { height: 3.6, radius: 4.6 },
  { height: 5.5, radius: 2.6 },
];
// Kinds of point.
const BASE = 0;
const TICK = 1;
const UPRIGHT = 2;
const CONVERGE = 3;
const LEVEL = 4;
const MOTE = 5;
const TOP = 6;

export function createCrown(scene: THREE.Scene, { time }: { time: THREE.Node<'float'> }) {
  // Each point: x, y, z in the crown's own space, kind + its place along what it draws;
  // and a second vec4: its stagger (when, round the ring, it comes), the level, unused.
  const data: number[] = [];
  const extra: number[] = [];
  const add = (x: number, y: number, z: number, kind: number, w: number, stagger = 0, level = 0) => {
    data.push(x, y, z, kind + Math.min(Math.max(w, 0), 0.999));
    extra.push(stagger, level, 0, 0);
  };
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    add(Math.cos(a) * RADIUS, 0.05, Math.sin(a) * RADIUS, BASE, i / 180, i / 180);
  }
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    for (let k = 1; k <= (long ? 5 : 2); k++) {
      const r = RADIUS - k * 0.14;
      add(Math.cos(a) * r, 0.05, Math.sin(a) * r, TICK, k / 5, i / 60);
    }
  }
  for (let u = 0; u < UPRIGHTS; u++) {
    const a = (u / UPRIGHTS) * Math.PI * 2;
    const height = 3 + (u % 2) * 1.1;
    const x = Math.cos(a) * RADIUS;
    const z = Math.sin(a) * RADIUS;
    for (let k = 0; k < 30; k++) add(x, (k / 29) * height, z, UPRIGHT, k / 29, u / UPRIGHTS);
    for (let k = 1; k <= 40; k++) {
      const t = k / 40;
      add(x * (1 - t), height + (APEX - height) * t, z * (1 - t), CONVERGE, t, u / UPRIGHTS);
    }
  }
  LEVELS.forEach(({ height, radius }, l) => {
    const n = Math.round(radius * 16);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      add(Math.cos(a) * radius, height, Math.sin(a) * radius, LEVEL, i / n, i / n, l);
    }
  });
  for (let i = 0; i < 90; i++) {
    const a = ((i * 0.618) % 1) * Math.PI * 2;
    const r = 1.2 + ((i * 0.377) % 1) * (RADIUS - 2);
    add(Math.cos(a) * r, 0, Math.sin(a) * r, MOTE, (i * 0.271) % 1);
  }
  add(0, APEX, 0, TOP, 0);
  const count = data.length / 4;
  const points = instancedArray(new Float32Array(data), 'vec4');
  const extras = instancedArray(new Float32Array(extra), 'vec4');

  /** 0..1, how far it is built (from the guide's distance); the arrival's flare; settled; shown. */
  const build = uniform(0);
  const flare = uniform(0);
  const calm = uniform(0);
  const shown = uniform(0);
  const placement = uniform(new THREE.Vector3());

  const point = points.element(instanceIndex);
  const more = extras.element(instanceIndex);
  const kind = floor(point.w);
  const w = fract(point.w);
  const stagger = more.x;
  const level = more.y;
  const is = (k: number) => kind.equal(k);
  // Built in order: the ring (0..0.25), its ticks, the uprights round it (0.2..0.6), the
  // lines to the apex (0.5..0.85), the three rings bottom to top (0.65..1).
  const window = (from: number | THREE.Node<'float'>, to: number | THREE.Node<'float'>) => smoothstep(from as THREE.Node<'float'>, to as THREE.Node<'float'>, build);
  const ringDrawn = smoothstep(w.sub(0.02), w, window(0, 0.25));
  const tickDrawn = smoothstep(stagger.sub(0.03), stagger, window(0.12, 0.32));
  const uprightRise = window(stagger.mul(0.25).add(0.2), stagger.mul(0.25).add(0.4));
  const uprightDrawn = smoothstep(w.sub(0.04), w, uprightRise);
  const toApex = window(stagger.mul(0.12).add(0.5), stagger.mul(0.12).add(0.75));
  const convergeDrawn = smoothstep(w.sub(0.04), w, toApex);
  const levelDrawn = smoothstep(stagger.sub(0.03), stagger, window(level.mul(0.1).add(0.65), level.mul(0.1).add(0.8)));
  // Once arrived: a pulse runs down every line from the apex, then, settled, slow ones.
  const down = fract(time.mul(0.22).add(stagger.mul(0.13)));
  const pulse = exp(abs(w.sub(float(1).sub(down))).mul(-22)).mul(calm.mul(0.8)).add(exp(abs(w.sub(float(1).sub(flare))).mul(-14)).mul(flare.greaterThan(0.01).select(float(1), float(0))));
  // The rings turn slowly, each its own way.
  const turn = time.mul(0.04).mul(level.mul(2).sub(1)).mul(is(LEVEL).select(float(1), float(0)))
    .add(time.mul(0.012).mul(is(BASE).or(is(TICK)).select(float(1), float(0))));
  const rx = point.x.mul(cos(turn)).sub(point.z.mul(sin(turn)));
  const rz = point.x.mul(sin(turn)).add(point.z.mul(cos(turn)));
  // Motes rising to the apex, drawn in towards the middle as they go.
  const rise = fract(time.mul(0.08).add(w));
  const moteAt = vec3(point.x.mul(float(1).sub(rise)), rise.mul(APEX), point.z.mul(float(1).sub(rise)));
  const local = is(MOTE).select(moteAt, vec3(rx, point.y, rz));

  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = local.add(placement);
  // Brighter while it builds and on arrival, then quieter: it holds, it does not shout.
  const intensity = mix(float(1), float(0.55), calm).add(flare.mul(0.8));
  const top = exp(flare.sub(0.5).abs().mul(-3)).mul(flare.greaterThan(0.01).select(float(1), float(0)));
  const strength = is(BASE).select(ringDrawn.mul(0.75),
    is(TICK).select(tickDrawn.mul(0.6),
      is(UPRIGHT).select(uprightDrawn.mul(float(0.5).add(w.mul(0.45))).add(pulse.mul(0.9)),
        is(CONVERGE).select(convergeDrawn.mul(0.55).add(pulse.mul(1.2)),
          is(LEVEL).select(levelDrawn.mul(level.equal(2).select(float(1.05), float(0.7))),
            is(MOTE).select(smoothstep(0, 0.1, rise).mul(smoothstep(1, 0.75, rise)).mul(window(0.8, 1)).mul(0.6),
              window(0.75, 0.9).mul(1.2).add(top.mul(2.5))))))));
  const shape = particleShape();
  // Champagne for what converges and for the top ring (Performer); off-white for the rule.
  const warm = is(CONVERGE).or(is(TOP)).or(is(MOTE)).or(level.equal(2).and(is(LEVEL))).select(float(1), pulse.min(1));
  material.colorNode = mix(color(LAB.dust).mul(0.95), color(BRAND.champagne).mul(1.6), warm);
  material.opacityNode = shape.alpha.mul(strength).mul(intensity).mul(shown);
  material.scaleNode = is(TOP).select(float(0.5).add(top.mul(1.4)),
    is(UPRIGHT).or(is(CONVERGE)).select(float(0.11).add(pulse.mul(0.1)),
      is(LEVEL).select(float(0.12), is(MOTE).select(float(0.09), float(0.1)))));
  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.visible = false;
  scene.add(sprite);

  return {
    /** Sets where it stands: the middle of its ring, on the ground. */
    place(at: THREE.Vector3) {
      placement.value.copy(at);
    },
    /** 0..1 each: built, the arrival's flare (0..1 over its run), settled, shown. */
    update(state: { build: number; flare: number; calm: number; shown: number }) {
      build.value = state.build;
      flare.value = state.flare;
      calm.value = state.calm;
      shown.value = state.shown;
      sprite.visible = state.shown > 0.001 && state.build > 0.001;
    },
    dispose() {
      // Not sprite.geometry: every three.js Sprite shares one geometry.
      material.dispose();
    },
  };
}
