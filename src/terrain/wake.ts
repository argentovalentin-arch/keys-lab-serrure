import * as THREE from 'three/webgpu';
import {
  abs, cameraPosition, color, exp, float, floor, hash, instanceIndex, max, mix, pow, reflect, select, sin, cos,
  smoothstep, uint, uniform, uniformArray, vec2, vec3,
} from 'three/tsl';
import { DUSK, SEA_LEVEL, waveNode } from './coast';
import { particleShape, twinkle } from '../world/sprite';
import { BRAND, LAB } from '../core/brand';

/**
 * The boat's trail on the water, in the sea's own particles (sea.ts): what the hull leaves
 * behind it as it goes, from where it really went.
 *
 * The boat's path is kept as it goes (a point every STEP of travel: where it was, its
 * heading, its speed, when), and the trail is drawn from that path, so it follows the boat
 * through its turns and stays where the water was disturbed while the boat goes on.
 * Along each stretch of that path:
 * - the two arms: the water raised at the stern quarter, where it closes in behind the
 *   hull, runs outward from the track as the boat goes on: narrow at the stern, they
 *   open behind it (about 26° either side: the white water spreads wider than the waves'
 *   cusp line), in a few crests one behind the other, more scattered, uneven and faint the
 *   further back, until they melt into the sea;
 * - the wash: right behind the stern, the churned water, brighter, a band that widens and
 *   wanders, then settles back into the sea within a few seconds;
 * - across them, the transverse waves: light and shade in bands behind the stern;
 * - the foam, in champagne: thrown up along the hull (more towards the bow) and churned up
 *   behind the stern, in uneven patches and flecks of all sizes, tossed about, spreading
 *   back and dissolving within a few seconds; the faster the boat, the more of it.
 * Every particle rides the swell (coast.ts) and catches the last light as the sea's own do,
 * in its colours; all of it grows with the boat's speed and is gone once it has stopped.
 */

/** Where the boat has been: a point every STEP of travel, or every HOLD seconds when it hardly moves. */
const SLOTS = 128;
const STEP = 0.25;
const HOLD = 0.6;
/** How long the water keeps a trace of it at most (seconds); it also fades with the way the boat has gone on since. */
const LIFE = 40;
/** The hull (boat.ts): half its length, and its half-width amidships. */
const HALF_LENGTH = 2.4;
const HALF_BEAM = 0.82;
/**
 * How fast the arms run out from the track, per unit of the boat's way (about 26° either
 * side): seen from the boat, they leave its stern side by side and part towards the horizon.
 */
const ARM_OPEN = Math.tan((26 * Math.PI) / 180);

export interface WakeOptions {
  time: THREE.Node<'float'>;
  /** Particles along each stretch of path: for each arm, for the wash, for the foam. */
  arm: number;
  wash: number;
  foam: number;
}

export interface WakeBoat {
  x: number;
  z: number;
  heading: number;
  /** Over the water, units a second. */
  speed: number;
}

export function createWake(scene: THREE.Scene, { time, arm, wash, foam: foamCount }: WakeOptions) {
  const perSlot = arm * 2 + wash + foamCount;
  const path = Array.from({ length: SLOTS }, () => new THREE.Vector4());
  const times = new Array<number>(SLOTS).fill(-1e6);
  // Read by the GPU every frame from these arrays (three.js uniform arrays).
  const samples = uniformArray(path, 'vec4');
  const stamps = uniformArray(times, 'float');
  /** The boat now (x, z, heading, speed): the end of the newest stretch. */
  const head = uniform(new THREE.Vector4());
  const newest = uniform(SLOTS - 1);
  const shown = uniform(0);

  const seed = (k: number) => hash(instanceIndex.add(uint(k * 7919 + 13)));
  const slot = instanceIndex.mod(uint(SLOTS));
  const j = instanceIndex.div(uint(SLOTS)).toFloat();
  const isNewest = slot.toFloat().equal(newest);
  const nextSlot = slot.add(uint(1)).mod(uint(SLOTS));
  // (The element nodes are typed loosely: they are what they hold.)
  const from = samples.element(slot) as unknown as THREE.Node<'vec4'>;
  const to = select(isNewest, head, samples.element(nextSlot) as unknown as THREE.Node<'vec4'>);
  const bornFrom = stamps.element(slot) as unknown as THREE.Node<'float'>;
  const bornTo = select(isNewest, time, stamps.element(nextSlot) as unknown as THREE.Node<'float'>);

  // Where along this stretch of path the particle was raised, and when.
  const f = seed(1);
  const at = mix(from, to, f);
  const age = time.sub(mix(bornFrom, bornTo, f));
  const valid = select(bornFrom.greaterThan(float(-1e5)), float(1), float(0));
  const heading = at.z;
  const speed = at.w;
  const fwd = vec2(sin(heading), cos(heading).negate());
  const sideDir = vec2(cos(heading), sin(heading));

  const isArm = select(j.lessThan(float(arm * 2)), float(1), float(0));
  const isFoam = select(j.lessThan(float(arm * 2 + wash)), float(0), float(1));
  const sideSign = select(j.lessThan(float(arm)), float(-1), float(1));

  // An arm: raised where the water closes in behind the hull, at its stern quarter, then left
  // behind and running out from the track as the boat goes on, in a few crests one behind the
  // other; it scatters, wavers and thins the further back it is. (Born at the stern, the two
  // arms part from there: seen from the boat they leave its stern side by side and open out
  // towards the horizon.)
  const along = mix(float(-HALF_LENGTH * 0.97), float(-HALF_LENGTH * 0.7), pow(seed(2), 1.3));
  const hullHalf = float(HALF_BEAM).mul(max(float(1).sub(along.div(HALF_LENGTH).pow(2)), 0).pow(0.6));
  const crest = floor(seed(3).mul(3));
  const spacing = float(0.35).add(speed.mul(0.1));
  const formed = smoothstep(0, 1.6, age);
  const run = speed.mul(age);
  const scatter = float(0.03).add(pow(run.add(0.01), 0.8).mul(0.045));
  const waver = sin(run.mul(0.42).add(seed(12).mul(6.28))).mul(run.mul(0.035).min(0.6));
  const armOut = hullHalf.mul(0.6).add(run.mul(ARM_OPEN))
    .sub(crest.mul(spacing).mul(0.5).mul(formed))
    .add(seed(4).sub(0.5).mul(2).mul(scatter)).add(waver);
  const armAlong = along.sub(crest.mul(spacing).mul(0.8).mul(formed)).add(seed(5).sub(0.5).mul(scatter));

  // The wash: the churned water behind the stern, a band that widens as it settles.
  const spread = float(0.36).add(pow(age.add(0.01), 0.7).mul(0.2));
  const washOut = seed(6).sub(0.5).mul(2).mul(spread);
  const washAlong = float(-HALF_LENGTH - 0.05).sub(seed(7).mul(0.4));

  const out = mix(washOut, sideSign.mul(max(armOut, hullHalf.mul(0.6))), isArm);
  const forward = mix(washAlong, armAlong, isArm);

  // The foam: cut at the stem, thrown up along the hull (more of it towards the bow), churned
  // up behind the stern; pushed out from the hull, tossed about, spreading back, gone within
  // seconds. (Seen from above the hull is fuller than the line the arms leave from: its
  // outline here, so the foam comes up just outside it.)
  // Where: at the stem, along the hull's sides, along the arms where they leave the stern
  // (their white water), or in the stern's churn.
  const site = seed(11);
  const atStem = select(site.lessThan(0.1), float(1), float(0));
  const atHull = select(site.lessThan(0.45), float(1), float(0));
  const onArm = select(site.lessThan(0.72), float(1), float(0)).mul(float(1).sub(atHull));
  const sideAlong = mix(float(-2.4), float(2.1), pow(seed(12), 0.55));
  const sideBeam = float(HALF_BEAM).mul(max(float(1).sub(sideAlong.div(2.5).pow(2)), 0).pow(0.5));
  const pushed = speed.mul(0.22).mul(age.min(1.5));
  const sideOut = sideBeam.add(0.08).add(seed(14).mul(0.2)).add(pushed);
  const stemOut = float(0.05).add(seed(14).mul(0.3)).add(pushed);
  const foamSide = select(seed(13).lessThan(0.5), float(-1), float(1));
  const sternOut = seed(16).sub(0.5).mul(2).mul(float(0.35).add(pow(age.add(0.01), 0.6).mul(0.42)));
  const armFoamOut = foamSide.mul(float(0.25).add(run.mul(ARM_OPEN).mul(mix(float(0.75), float(1.08), seed(16))))
    .add(seed(14).sub(0.5).mul(float(0.12).add(run.mul(0.08)))));
  const armFoamAlong = float(-HALF_LENGTH * 0.9).sub(seed(15).mul(0.5));
  const foamOut = mix(mix(sternOut, armFoamOut, onArm), foamSide.mul(mix(sideOut, stemOut, atStem)), atHull);
  const foamAlong = mix(mix(float(-2.55).sub(seed(15).mul(0.9)), armFoamAlong, onArm), mix(sideAlong, float(2.25).add(seed(12).mul(0.25)), atStem), atHull);

  // Where it was raised, then moved about with the water: a little for the arms, more for the
  // churned water, tossed about for the foam.
  const raised = at.xy.add(fwd.mul(mix(forward, foamAlong, isFoam))).add(sideDir.mul(mix(out, foamOut, isFoam)));
  const churn = mix(float(0.04).add(age.mul(0.05)).min(0.45).mul(mix(float(1), float(0.35), isArm)), float(0.05).add(age.mul(0.16)).min(0.6), isFoam);
  const pace = mix(float(0.45), float(1.1), isFoam);
  // (Sums of slow waves at each particle's own phases rather than a noise function: the
  // same unsteady drift, far lighter for the GPU to build when the Lab opens.)
  const drift = age.mul(pace);
  const phase = seed(8).mul(40);
  const phase2 = seed(9).mul(40);
  const drifted = raised.add(vec2(
    sin(drift.mul(1.7).add(phase)).add(sin(drift.mul(2.9).add(phase2)).mul(0.5)),
    cos(drift.mul(1.3).add(phase2)).add(cos(drift.mul(3.3).add(phase)).mul(0.5)),
  ).mul(churn).mul(0.6));
  // The hull, where it is now, pushes aside what it comes over: foam under it is moved out
  // to just beside it, so it slides along the hull's sides before it is left behind.
  const fwdNow = vec2(sin(head.z), cos(head.z).negate());
  const sideNow = vec2(cos(head.z), sin(head.z));
  const loose = drifted.sub(head.xy);
  const alongNow = loose.dot(fwdNow);
  const acrossNow = loose.dot(sideNow);
  const beamNow = float(HALF_BEAM).mul(max(float(1).sub(alongNow.div(2.5).pow(2)), 0).pow(0.5));
  const clear = select(acrossNow.lessThan(0), float(-1), float(1))
    .mul(max(abs(acrossNow), beamNow.add(0.06).add(seed(21).mul(0.12)).mul(smoothstep(2.65, 2.35, abs(alongNow)))));
  const flat = mix(drifted, head.xy.add(fwdNow.mul(alongNow)).add(sideNow.mul(clear)), isFoam);

  // On the swell, as the sea is; the churned water a touch raised at first, the foam thrown up.
  const wave = waveNode(flat.x, flat.y, time);
  const lift = mix(exp(age.mul(-1.5)).mul(0.05).mul(float(1).sub(isArm)).add(0.02), exp(age.mul(-2)).mul(0.05).add(0.03), isFoam);
  const position = vec3(flat.x, float(SEA_LEVEL).add(wave.height).add(lift), flat.y);

  // Its light, as the sea's: the surface, ruffled by the passing waves, mirrors the last light.
  const ruffle = vec3(
    sin(flat.x.mul(2.3).add(flat.y.mul(0.7)).add(time.mul(1.1))).mul(0.3),
    0,
    cos(flat.y.mul(2.1).add(flat.x.mul(0.6)).sub(time.mul(0.9))).mul(0.3),
  );
  const normal = wave.normal.add(ruffle).normalize();
  const view = position.sub(cameraPosition).normalize();
  const mirrored = max(reflect(view, normal).dot(vec3(DUSK.x, DUSK.y, DUSK.z)), 0);
  const glint = pow(mirrored, 40).mul(twinkle(time, seed(10), 0.8)).mul(1.5).add(pow(mirrored, 6).mul(0.25));

  // The faster the boat went there, the more it shows; nothing once it has stopped.
  const strength = smoothstep(0.05, 0.6, speed).mul(float(0.75).add(smoothstep(0.6, 4.5, speed).mul(0.25)));
  // It fades as the boat goes on (over so much of its way: a slow boat's trail is as long) and
  // with time (the arms last, the churned water settles sooner).
  const behind = speed.mul(age);
  const fade = mix(exp(age.div(-11)).mul(exp(behind.div(-14))), exp(age.div(-40)).mul(exp(behind.div(-22))), isArm)
    .mul(smoothstep(0, 0.12, age)).mul(smoothstep(LIFE, LIFE * 0.7, age));
  // The transverse waves: bands of light and shade behind the stern, as far apart as the boat is fast.
  const transverse = sin(behind.mul(Math.PI * 2).div(float(0.9).add(speed.mul(0.35)))).mul(0.25).add(0.75);
  // The churned water is whitest right behind the stern.
  const foam = exp(behind.div(-3.5)).mul(1.1).mul(float(1).sub(isArm));
  // In uneven patches (where the water breaks, it breaks in clumps), flecks of all sizes.
  const patch = smoothstep(-0.2, 0.6, sin(raised.x.mul(1.3).add(1.7)).mul(sin(raised.y.mul(1.1).add(0.4)))
    .add(sin(raised.x.mul(0.5).sub(raised.y.mul(0.7))).mul(0.5)));
  // The leading crest of each arm, where the water is raised most, reads most; along it the
  // white water comes and goes in clumps.
  const armLight = mix(float(2.1), float(1), crest.div(2)).mul(patch.mul(0.8).add(0.5))
    // Whitest where they leave the stern, the water still broken there.
    .mul(exp(run.div(-5)).mul(1.4).add(1));
  const base = mix(float(1.6), armLight, isArm).mul(transverse);
  const brightness = base.add(glint).add(foam).mul(fade).mul(strength).mul(valid).mul(shown);
  const fleck = pow(seed(19), 3);
  const foamStrength = smoothstep(0.1, 0.7, speed).mul(float(0.85).add(smoothstep(0.7, 4.5, speed).mul(0.15)));
  const foamFade = mix(mix(exp(age.div(-5.5)).mul(exp(behind.div(-14))), exp(age.div(-4)).mul(exp(behind.div(-9))), onArm), exp(age.div(-2.6)).mul(exp(behind.div(-8))), atHull)
    .mul(smoothstep(0, 0.08, age)).mul(smoothstep(LIFE, LIFE * 0.7, age));
  const foamLight = float(2).add(twinkle(time.mul(2.5), seed(20), 0.6).mul(1.1))
    .mul(patch).mul(foamFade).mul(foamStrength).mul(valid).mul(shown);

  const shape = particleShape();
  const fromEye = position.sub(cameraPosition).length();
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = position;
  material.colorNode = mix(
    mix(mix(vec3(0.62, 0.7, 0.86), vec3(1, 1, 1), 0.5).mul(color(LAB.dust)), color(BRAND.champagne).mul(1.35),
      glint.add(foam).add(exp(run.div(-7)).mul(0.6).mul(isArm)).min(1)),
    // The foam in champagne, the larger flecks whiter at heart.
    mix(color(BRAND.champagne).mul(1.25), color(LAB.dust).mul(1.2), fleck.mul(0.5)),
    isFoam,
  );
  material.opacityNode = shape.alpha.mul(mix(brightness, foamLight, isFoam)).min(1);
  const size = float(0.032).add(fromEye.mul(0.0042));
  material.scaleNode = mix(
    // (The arms' points of all sizes, a few large among many small: not a line of beads.)
    size.mul(mix(float(1.35), mix(float(0.85), float(1.7), fleck), isArm)).mul(float(1).add(glint.mul(0.4))),
    size.mul(mix(float(0.8), float(2.8), fleck)),
    isFoam,
  );
  const sprite = new THREE.Sprite(material);
  sprite.count = SLOTS * perSlot;
  sprite.frustumCulled = false;
  sprite.visible = false;
  scene.add(sprite);

  let cursor = 0;
  let started = false;
  const last = { x: 0, z: 0, t: 0 };

  const write = (x: number, z: number, h: number, v: number, t: number) => {
    path[cursor].set(x, z, h, v);
    times[cursor] = t;
    newest.value = cursor;
    cursor = (cursor + 1) % SLOTS;
    last.x = x;
    last.z = z;
    last.t = t;
  };

  return {
    /**
     * This frame: how much it shows, where the boat is now, and the clock. `underWay` is the
     * speed the boat had before the visitor came aboard: the path behind it is laid as if it
     * had come that way at that speed, so the water already bears its trace.
     */
    update(state: { shown: number; boat: WakeBoat; now: number; underWay: number }) {
      const { boat, now } = state;
      shown.value = state.shown;
      sprite.visible = state.shown > 0.001;
      const moved = Math.hypot(boat.x - last.x, boat.z - last.z);
      if (!started || moved > 4) {
        // Aboard (or carried elsewhere at once): the path behind, as if under way.
        const v = Math.max(state.underWay, 0.2);
        cursor = 0;
        for (let k = 0; k < SLOTS; k++) {
          const back = (SLOTS - k) * STEP;
          write(boat.x - Math.sin(boat.heading) * back, boat.z + Math.cos(boat.heading) * back, boat.heading, v, now - back / v);
        }
        started = true;
      } else if (moved >= STEP || now - last.t >= HOLD) {
        write(boat.x, boat.z, boat.heading, boat.speed, now);
      }
      head.value.set(boat.x, boat.z, boat.heading, boat.speed);
    },
    /** « Rejouer »: a new crossing, a new trail. */
    reset() {
      started = false;
      shown.value = 0;
      sprite.visible = false;
    },
    dispose() {
      scene.remove(sprite);
      material.dispose();
    },
  };
}

export type Wake = ReturnType<typeof createWake>;
