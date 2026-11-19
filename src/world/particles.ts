import * as THREE from 'three/webgpu';
import {
  Fn, clamp, color, cos, float, hash, instanceIndex, instancedArray, length, min, mix, mx_noise_vec3, pow, sin,
  smoothstep, sqrt, uint, uniform, uv, vec3, vec4,
} from 'three/tsl';
import { chaosLayout, keyLayout } from './shapes';
import { LEAF } from './door';
import { againstLight, outward, throughDoorway } from './portal';
import { PARTICLE_LIFE, dissolveField, dissolveProgress, leafMatrix } from './dissolve';
import { SPRITE_GROWTH, coreColor, particleShape, twinkle } from './sprite';
import { BRAND, LAB } from '../core/brand';

const CHAOS_RADIUS = 4.5;
// Share of the door's particles that fly all the way out through the doorway as light.
const ESCAPE_SHARE = 0.06;
// The key emerging from the noise (morph 0 to 2): each particle sets off for its place
// in the key at its own moment, in the order of the key layout (outline first, see
// shapes.ts), and takes this share of the transition to get there. None leaves before
// KEY_FIRST, so the start is pure noise; the last one arrives as morph reaches 2.
const KEY_FIRST = 0.15;
const KEY_TRAVEL = 0.26;
// Meanwhile the cloud draws in around the key's plane: it gets smaller, flatter and calmer.
const GATHER_SIZE = 0.62;
const GATHER_FLAT = 0.4;

/**
 * GPU particle system. Positions and velocities live in storage buffers and are
 * updated by a compute pass every frame; the sprites read the same buffers to
 * draw, so particle data never travels back to the CPU.
 *
 * `morph` drives the shapes: 0 = noise, 2 = key, emerging in between. With `flow` at 1 the
 * particles leave the springs and become the open door breaking up (dissolve.ts):
 * each one sits on a point of the door and drifts off when the dissolve reaches it.
 *
 * The compute pass uses three storage buffers at most: on the WebGL 2 fallback
 * each one becomes a transform feedback output, and WebGL 2 only guarantees four.
 * That is why the noise target is worked out in the shader from the particle index;
 * only the key shape, which needs CPU sampling, is a buffer.
 */
export function createParticles(count: number) {
  const positions = instancedArray(chaosLayout(count, CHAOS_RADIUS), 'vec3');
  const velocities = instancedArray(count, 'vec3');
  const keyTargets = instancedArray(keyLayout(count), 'vec3');

  const morph = uniform(0);
  const time = uniform(0);
  const delta = uniform(1 / 60);
  // Pointer position in the particles' local space; far away when there is none.
  const pointer = uniform(new THREE.Vector3(0, 0, 100));
  const pointerStrength = uniform(1);
  const wander = uniform(1);
  // Fewer particles draw a little brighter, so every quality tier reads the same.
  const brightness = uniform(1);
  const flow = uniform(0);
  const visibility = uniform(1);
  // Local x beyond which particles give way to the solid metal key (see keyMesh.ts).
  const cut = uniform(100);

  // Noise home: a fixed random point in a flattened sphere, even density through the volume.
  const radius = pow(hash(instanceIndex), 1 / 3).mul(CHAOS_RADIUS);
  const theta = hash(instanceIndex.add(uint(count))).mul(Math.PI * 2);
  const cosPhi = hash(instanceIndex.add(uint(count * 2))).mul(2).sub(1);
  const sinPhi = sqrt(float(1).sub(cosPhi.mul(cosPhi)));
  const jitter = hash(instanceIndex.add(uint(count * 3)));

  // When this particle sets off for the key: its place in the key layout's order.
  // The first few go one by one, then more and more at once: a faint outline first,
  // which thickens as the structuring goes on, rather than the whole outline in one go.
  const keyStart = pow(instanceIndex.toFloat().div(count), 0.55).mul(1 - KEY_FIRST - KEY_TRAVEL).add(KEY_FIRST);

  // Door: each particle has its own point in the door leaf, through its whole volume
  // (leaf space: x through the thickness, y up, z from the hinge edge). It is released
  // when the dissolve reaches that point, the very moment the surface there stops being
  // drawn, then lives for PARTICLE_LIFE of dissolve progress.
  const doorPoint = vec3(
    hash(instanceIndex.add(uint(count * 5))).mul(LEAF.thickness + 0.06).sub(0.06),
    hash(instanceIndex.add(uint(count * 6))).sub(0.5).mul(LEAF.height),
    hash(instanceIndex.add(uint(count * 7))).mul(LEAF.width),
  );
  const age = clamp(dissolveProgress.sub(dissolveField(doorPoint, LEAF.width)).div(PARTICLE_LIFE), 0, 1);
  const eased = float(1).sub(float(1).sub(age).pow(2));
  // Released, a flake lifts off the door's front face, then leaves through the doorway
  // (portal.ts): drawn in to the opening on its way, then free beyond it, fanning out and
  // rising, along a slow swirl. Nothing bounds it once it is out: the door's matter goes
  // out into the world as light (see the colour below).
  const flakeSeed = (k: number) => hash(instanceIndex.add(uint(count * k)));
  const faceNormal = leafMatrix.mul(vec4(-1, 0, 0, 0)).xyz;
  const leftFrom = leafMatrix.mul(vec4(doorPoint, 1)).xyz.add(faceNormal.mul(eased.mul(0.55)));
  // Out towards the visitor: quick at first, then slowing. Only a share of the door goes
  // all the way out, as light; the rest drifts a little and fades in the doorway's light.
  const escapes = flakeSeed(11).lessThan(ESCAPE_SHARE);
  const reach = escapes.select(mix(3.4, 7.5, flakeSeed(8)), mix(0.3, 1.5, flakeSeed(8)));
  const travelledOut = float(1).sub(float(1).sub(age).pow(2.6)).mul(reach);
  const flight = throughDoorway(leftFrom, travelledOut, outward(flakeSeed(9), mix(0.2, 3.6, flakeSeed(10).pow(0.9)), leftFrom));
  const flakeOut = smoothstep(0, 1.2, flight.beyond);
  const swirl = mx_noise_vec3(doorPoint.mul(0.9).add(vec3(0, time.mul(0.12), 0))).mul(mix(0.12, 0.6, flakeOut)).mul(eased);
  const flowHome = flight.position.add(swirl).add(vec3(0, eased.mul(eased).mul(flakeOut).mul(1.1), 0));

  const update = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);
    const keyHome = keyTargets.element(instanceIndex);

    // The noise cloud turns on itself, the core faster than the rim, while each
    // particle wanders along a slowly changing noise field.
    const spin = time.mul(0.12).mul(float(1.6).sub(radius.div(CHAOS_RADIUS)));
    const angle = theta.add(spin);
    const chaosHome = vec3(
      radius.mul(sinPhi).mul(cos(angle)),
      radius.mul(sinPhi).mul(sin(angle)).mul(0.7),
      radius.mul(cosPhi),
    );
    // Structuring: as the key emerges, the cloud around it draws in towards its plane
    // and calms down, so what is left of the noise visibly organises itself too.
    const gather = smoothstep(0.1, 1.7, morph);
    const gathered = chaosHome.mul(vec3(
      mix(1, GATHER_SIZE, gather),
      mix(1, GATHER_SIZE, gather),
      mix(1, GATHER_SIZE * GATHER_FLAT, gather),
    ));
    const drift = mx_noise_vec3(chaosHome.mul(0.3).add(vec3(0, 0, time.mul(0.15)))).mul(2)
      .add(mx_noise_vec3(chaosHome.mul(0.9).sub(vec3(time.mul(0.25), 0, 0))).mul(0.6))
      .mul(wander).mul(float(1).sub(gather.mul(0.55)));

    // The key: each particle leaves the cloud at its own moment (keyStart) and settles
    // into its place, so the silhouette appears out of the particles, outline first.
    const toKey = smoothstep(keyStart, keyStart.add(KEY_TRAVEL), morph.mul(0.5).add(jitter.mul(0.015)));

    const target = mix(gathered.add(drift), keyHome, toKey);

    // Spring towards the target. Near the pointer, particles are pushed away and
    // swirled around it; the swirl fades once the shapes have formed.
    const force = target.sub(position).mul(12).toVar();
    const away = position.sub(pointer);
    const distance = length(away);
    const falloff = smoothstep(1.6, 0, distance).mul(pointerStrength);
    const awayDir = away.div(distance.add(0.0001));
    const around = vec3(awayDir.y, awayDir.x.negate(), 0);
    const swirl = float(1).sub(gather.mul(0.7));
    force.addAssign(awayDir.mul(falloff.mul(14)).add(around.mul(falloff.mul(swirl).mul(22))));

    velocity.assign(velocity.add(force.mul(delta)).mul(float(1).sub(delta.mul(5)).max(0)));
    position.addAssign(velocity.mul(delta));

    // On the door, its point decides the position outright. The switch happens while
    // the particles are hidden, and a particle only shows once released.
    position.assign(mix(position, flowHome, flow));
    velocity.assign(velocity.mul(float(1).sub(flow)));
  })().compute(count);

  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const drawn = positions.toAttribute();
  material.positionNode = drawn;

  // Calm particles stay cream; the ones the pointer scatters warm up. Off the door, in
  // its light, they leave burning, like the front they break from, and settle to the door's
  // own navy: seen against the light of the doorway, they read as dark flakes of door
  // (additive cream would vanish into that light; see setDoorMode). Through the opening
  // and out in the dark, the door's matter has become light: champagne points.
  const speed = length(velocities.toAttribute());
  const shapeColor = mix(color(LAB.dust), color(LAB.warmth), smoothstep(0.4, 3, speed));
  const shape = particleShape();
  // Seen against the doorway's light, a flake is a dark piece of door; against the dark,
  // a point of light (portal.ts): it changes as it leaves the light behind it.
  const inLight = againstLight(drawn);
  const matter = mix(color(LAB.light), color(BRAND.navy), smoothstep(0, 0.35, age));
  const doorColor = mix(coreColor(vec3(...new THREE.Color(LAB.light).toArray()), shape.core), matter, inLight);
  // Points of light (sprite.ts): a whiter core in a faint halo.
  // Far in the cloud they cool towards the night's blue, near they stay cream: depth.
  const nearness = smoothstep(-CHAOS_RADIUS, CHAOS_RADIUS * 0.6, positions.toAttribute().z);
  const depthTint = mix(vec3(0.72, 0.8, 0.95), vec3(1, 1, 1), nearness);
  material.colorNode = mix(coreColor(shapeColor.mul(depthTint), shape.core), doorColor, flow);

  // Dimmer at the back for depth. The key is dense, so it is drawn fainter, otherwise
  // the additive blend burns it to flat white. Loose in the cloud, each particle shimmers
  // a little; settled in the key, it holds still.
  const grainSeed = hash(instanceIndex.add(uint(count * 4)));
  // The door's flakes keep their plain soft disc: they read as pieces of door, not light.
  const flake = clamp(float(1).sub(length(uv().sub(0.5)).mul(2)), 0, 1);
  const shimmer = mix(twinkle(time, grainSeed), 1, smoothstep(1.2, 2, morph).max(flow));
  const depth = mix(mix(0.35, 1, smoothstep(-CHAOS_RADIUS, CHAOS_RADIUS, drawn.z)), 1, flow);
  const density = mix(mix(1, 0.35, smoothstep(1, 2, morph)), 1, flow);
  // Off the door, a particle shows only once released, then fades out as it drifts away.
  const lane = mix(1, smoothstep(0, 0.1, age).mul(float(1).sub(smoothstep(0.6, 1, age))), flow);
  // Particles fade out just before the cut, so they never overlap the solid part.
  const beforeCut = smoothstep(cut, cut.sub(0.06), drawn.x);
  // Door flakes are drawn with normal blending against the light: a little more opaque.
  const doorOpacity = mix(1, 1.8, flow);
  // A flake in the light is a soft disc of matter; out in the dark, a point of light.
  const doorAlpha = mix(shape.alpha.mul(0.34), flake.mul(flake).mul(0.5), inLight);
  material.opacityNode = min(
    mix(shape.alpha.mul(0.62), doorAlpha, flow).mul(depth).mul(density).mul(brightness).mul(lane).mul(visibility).mul(beforeCut)
      .mul(doorOpacity).mul(shimmer),
    1,
  );

  // Most particles are fine dust; a few are larger, which gives the cloud some grain.
  // Off the door, they are flakes, a little larger, to read against the light; out of it,
  // points of light, a little finer.
  const grain = grainSeed;
  material.scaleNode = float(0.02).add(pow(grain, 6).mul(mix(0.06, 0.035, flow))).mul(mix(SPRITE_GROWTH, mix(1.6, 2.2, inLight), flow));

  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;

  return {
    object: sprite, update, positions, velocities, morph, time, delta, pointer, pointerStrength, wander, brightness,
    flow, visibility, cut, capacity: count,
    /** Light on dark for the shapes (additive), flakes against the light for the door (normal). */
    setDoorMode(on: boolean) {
      const blending = on ? THREE.NormalBlending : THREE.AdditiveBlending;
      if (material.blending === blending) return;
      material.blending = blending;
      material.needsUpdate = true;
    },
  };
}

export type Particles = ReturnType<typeof createParticles>;
