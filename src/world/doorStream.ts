import * as THREE from 'three/webgpu';
import {
  cameraPosition, color, exp, float, hash, instanceIndex, max, mix, mx_noise_vec3, smoothstep, uint, uniform, uv, varying, vec3,
} from 'three/tsl';
import { APERTURE, againstLight, outward, throughDoorway } from './portal';
import { SPRITE_GROWTH, coreColor, particleShape, twinkle } from './sprite';
import { LAB } from '../core/brand';

/**
 * The open door's breath: the light behind the door, released into the visitor's world
 * as a current of gold particles.
 *
 * Each particle runs its own loop (no simulation, no buffer to update), its position a
 * function of its age:
 * - it is born in the doorway's light, between the opening and the light's heart (door.ts),
 *   where it shows against the light's softer edges;
 * - it is released towards the visitor, quickly, then slows to a drift (an exponential
 *   ease, like something thrown into air);
 * - it goes out through the opening (portal.ts): until then it keeps to the opening's
 *   clear part; once through, nothing holds it, and it fans out, up more than down, wider
 *   from the opening's edges, past the jambs and well above the lintel;
 * - out in the open it rises slowly, like warm air, and drifts along a slow turbulent
 *   flow, spatially coherent, so neighbours curl together rather than jitter apart.
 * Every particle has its own speed, spread, rise and lifetime, so no two paths repeat.
 *
 * Fast particles leave a short trail: each is drawn with `ECHOES` copies a few hundredths
 * of a second behind it, fainter and smaller, visible only while it moves fast.
 *
 * `intensity` comes from the light behind the door (story.ts, glow) and rises as the
 * visitor goes towards it (« Entrer »). `pull` (0..1) bends the current towards the
 * pointer (`attract`, world space), lightly and only once out of the doorway.
 */
const ECHOES = 4;
/** Shares of the current bursting out to the side (round the jambs) and up (over the lintel). */
const BURST = { side: 0.3, top: 0.18 };
const ECHO_GAP = 0.04; // seconds between a particle and each of its echoes
/** Release speed (units/s) and how quickly it settles. */
const RELEASE = { slowest: 1.2, fastest: 2.4, settle: 0.38 };

export function createDoorStream(count: number, reducedMotion: boolean) {
  const time = uniform(0);
  const intensity = uniform(0);
  const attract = uniform(new THREE.Vector3(-3, 1, 5));
  const pull = uniform(0);
  /** Sprite size factor: a little larger when the camera stands further back (portrait screens). */
  const size = uniform(1);
  /**
   * Where the door leaf stands while it swings open (main.ts): the cotangent of its angle.
   * The leaf turns on its hinge (z = -2, at the wall's back face); in front of it, the
   * doorway is free. Closed, it is very large: nothing is let out.
   */
  const leafCot = uniform(1000);

  const echoes = reducedMotion ? 1 : ECHOES;
  const particle = instanceIndex.div(uint(echoes));
  const echo = instanceIndex.mod(uint(echoes)).toFloat();
  const seed = (k: number) => hash(particle.add(uint(count * k)));

  // Its own loop, at its own place in it; echoes a little behind.
  const lifetime = mix(4, 6.5, seed(1)).mul(reducedMotion ? 2.2 : 1);
  const born = time.div(lifetime).add(seed(2)).fract().mul(lifetime);
  const age = born.sub(echo.mul(ECHO_GAP)).max(0);
  const t = age.div(lifetime);

  // Its way out (portal.ts): a share bursts out to the side, round the jamb on the free
  // side (most of them) or the other, a share goes up over the lintel, the rest every way
  // round, some coming on towards the visitor.
  const pick = seed(15);
  const isSide = pick.lessThan(BURST.side);
  const isTop = pick.greaterThanEqual(BURST.side).and(pick.lessThan(BURST.side + BURST.top));
  const bursting = isSide.or(isTop);
  const towardFree = seed(16).lessThan(0.6);
  const sideTurn = towardFree.select(float(0), float(0.5)).add(seed(8).sub(0.5).mul(0.07));
  const turn = isSide.select(sideTurn, isTop.select(float(0.25).add(seed(8).sub(0.5).mul(0.12)), seed(8)));
  const lateral = bursting.select(mix(2.5, 4.2, seed(9)), mix(0.2, 4.2, seed(9).pow(0.9)));
  // Born in the light, just behind the opening (not deep in the doorway, where from an
  // angle the wall beside the opening would hide it until it came out), and only where
  // the door no longer stands: while it swings open, out of the gap on its free side.
  // A burst is born on its own side of the opening (by the jamb it goes round, under the
  // lintel it goes over), so it comes out right there and lingers beside the door.
  const startX = seed(3).mul(0.5).add(APERTURE.back + 0.08);
  const leafZ = startX.sub(APERTURE.back).mul(leafCot).add(-2).add(0.15).clamp(-1.55, 1.55);
  const sideZ = towardFree.select(mix(0.5, 1.55, seed(5)), mix(-1.55, -0.5, seed(5)));
  const startZ = isSide.select(sideZ, mix(leafZ, 1.55, seed(5))).max(leafZ);
  const startY = isTop.select(mix(1.1, 2.4, seed(4)), seed(4).sub(0.5).mul(2 * 2.4));
  const start = vec3(startX, startY, startZ);
  const gap = smoothstep(0, 0.35, float(1.55).sub(leafZ));
  // Released, then settling to a drift: distance covered and speed, at this age.
  // The bursts go out gently and settle beside the door, rather than flying past it.
  const release = mix(RELEASE.slowest, RELEASE.fastest, seed(6)).mul(isSide.select(float(0.85), isTop.select(float(0.9), float(1)))).mul(reducedMotion ? 0.5 : 1);
  const drift = mix(0.08, 0.24, seed(7));
  const settling = exp(age.mul(-RELEASE.settle));
  const travelled = release.div(RELEASE.settle).mul(float(1).sub(settling)).add(drift.mul(age));
  const speed = release.mul(settling).add(drift);
  const direction = outward(turn, lateral, start, isSide.select(float(0.2), float(1)));
  const path = throughDoorway(start, travelled, direction);
  const out = smoothstep(0, 1.4, path.beyond);
  // Rising like warm air, once out (behind the wall it would rise into the lintel).
  const rise = mix(0, 0.075, seed(10).pow(0.7)).mul(age.mul(age)).mul(out);
  // A slow flow, the same for neighbours; faint in the doorway, free outside.
  const flow = mx_noise_vec3(path.position.mul(0.33).add(vec3(time.mul(0.03), time.mul(0.05), 0)))
    .mul(mix(0.15, 1, out)).mul(smoothstep(0, 0.25, t)).mul(reducedMotion ? 0.4 : 0.85);
  const free = path.position.add(vec3(0, rise, 0)).add(flow);
  // The pointer bends the current, out in the open only.
  const position = free.add(attract.sub(free).mul(pull.mul(mix(0.1, 0.28, seed(11))).mul(smoothstep(0, 2, path.beyond))));

  // Light added, and, against the doorway's light, a little of that light held back: the
  // output colour is the light a particle adds, its alpha how much of what is behind it it
  // covers (blend: one, one minus source alpha). In the dark it is a plain point of light;
  // seen against the light, its bright core sits in a soft shade of its own, as a mote does
  // against the sun, so it can be followed from where it is born, inside the light.
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  material.positionNode = position;
  // Worked out once per particle (vertex), not again for every pixel of its sprite.
  const where = varying(position);
  const shape = particleShape();
  const tint = coreColor(mix(color(LAB.light), color(LAB.dust), seed(12).mul(0.6)), shape.core);
  // Out of the light's depth, then away; never right against the eye. Freshly out, it
  // burns brighter; further out it cools and thins: the current reads as coming from the
  // opening, not as a field of stars around it.
  const fromOpening = where.sub(vec3(APERTURE.front, 0.3, 0)).length();
  const lifeFade = smoothstep(0, 0.1, t).mul(float(1).sub(smoothstep(0.45, 1, t)))
    .mul(mix(1.3, 0.5, smoothstep(2, 9, fromOpening)));
  const nearEye = smoothstep(0.5, 1.6, where.sub(cameraPosition).length());
  // The head, then its echoes, which show only while it is fast.
  const isHead = echo.lessThan(0.5);
  const echoFade = float(1).sub(echo.div(echoes)).mul(0.5).mul(smoothstep(0.5, 1.8, speed))
    .mul(born.greaterThan(echo.mul(ECHO_GAP)).select(float(1), float(0)));
  const trail = isHead.select(float(1), echoFade);
  const presence = lifeFade.mul(nearEye).mul(trail).mul(intensity).mul(gap);
  material.colorNode = tint.mul(shape.alpha.mul(presence).mul(twinkle(time, seed(13), 0.35)).mul(1.15));
  // The shade: a soft disc a little wider than the core, only against the light.
  const disc = float(1).sub(uv().sub(0.5).length().mul(2)).max(0);
  material.opacityNode = disc.mul(disc).mul(againstLight(where)).mul(presence).mul(0.75).min(1);
  // Mostly fine dust, a few larger motes; the echoes taper.
  material.scaleNode = float(0.028).add(seed(14).pow(5).mul(0.06)).mul(max(float(1).sub(echo.mul(0.16)), 0.4))
    .mul(SPRITE_GROWTH).mul(size);

  const object = new THREE.Sprite(material);
  object.count = count * echoes;
  object.frustumCulled = false;
  object.visible = false;

  return {
    object,
    time,
    intensity,
    attract,
    pull,
    size,
    leafCot,
    /** Fewer particles on lower quality tiers. */
    setCount(next: number) {
      object.count = Math.max(1, Math.min(count, next)) * echoes;
    },
    dispose() {
      // Not the geometry: every three.js Sprite shares one.
      material.dispose();
    },
  };
}
