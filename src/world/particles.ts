import * as THREE from 'three/webgpu';
import {
  Fn, clamp, color, cos, float, hash, instanceIndex, instancedArray, length, min, mix, mx_noise_vec3, pow, sin,
  smoothstep, sqrt, uint, uniform, uv, vec3,
} from 'three/tsl';
import { chaosLayout, keyLayout, KEY_EXTENT } from './shapes';
import { DOOR_X } from './door';

const CHAOS_RADIUS = 4.5;
// Light streaming through the open door: where it starts, how far it travels.
const FLOW_START = DOOR_X + 1.5;
const FLOW_LENGTH = 12;
const FLOW_SPEED = 0.07;
const LATTICE_SIZE = 3.4;
// How much of the transition is spent waiting for the wave to reach a particle.
const WAVE = 0.6;
const WAVE_JITTER = 0.15;
const WAVE_SPEED = 1 + WAVE + WAVE_JITTER;

/**
 * GPU particle system. Positions and velocities live in storage buffers and are
 * updated by a compute pass every frame; the sprites read the same buffers to
 * draw, so particle data never travels back to the CPU.
 *
 * `morph` drives the shapes: 0 = noise, 1 = lattice, 2 = key. With `flow` at 1 the
 * particles leave the springs and stream out of the doorway as light.
 *
 * The compute pass uses three storage buffers at most: on the WebGL 2 fallback
 * each one becomes a transform feedback output, and WebGL 2 only guarantees four.
 * That is why the noise and lattice targets are worked out in the shader from the
 * particle index; only the key shape, which needs CPU sampling, is a buffer.
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

  // Noise home: a fixed random point in a flattened sphere, even density through the volume.
  const radius = pow(hash(instanceIndex), 1 / 3).mul(CHAOS_RADIUS);
  const theta = hash(instanceIndex.add(uint(count))).mul(Math.PI * 2);
  const cosPhi = hash(instanceIndex.add(uint(count * 2))).mul(2).sub(1);
  const sinPhi = sqrt(float(1).sub(cosPhi.mul(cosPhi)));
  const jitter = hash(instanceIndex.add(uint(count * 3)));

  // Lattice: particle i sits at cell (i % side, i / side % side, i / side²).
  const side = Math.ceil(Math.cbrt(count));
  const latticeHome = vec3(
    instanceIndex.mod(uint(side)).toFloat(),
    instanceIndex.div(uint(side)).mod(uint(side)).toFloat(),
    instanceIndex.div(uint(side * side)).toFloat(),
  ).mul(LATTICE_SIZE / (side - 1)).sub(LATTICE_SIZE / 2);

  // Flow: each particle loops along its own straight lane, from behind the doorway
  // out past the camera, widening as it goes. `travel` runs 0 -> 1 along the lane.
  const travel = hash(instanceIndex.add(uint(count * 5)))
    .add(time.mul(FLOW_SPEED).mul(hash(instanceIndex.add(uint(count * 6))).mul(0.8).add(0.6)))
    .fract();
  const spread = travel.mul(0.8).add(1);
  const flowHome = vec3(
    float(FLOW_START).sub(travel.mul(FLOW_LENGTH)),
    hash(instanceIndex.add(uint(count * 7))).sub(0.5).mul(5.4).mul(spread),
    hash(instanceIndex.add(uint(count * 8))).sub(0.5).mul(3.6).mul(spread),
  );

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
    const drift = mx_noise_vec3(chaosHome.mul(0.3).add(vec3(0, 0, time.mul(0.15)))).mul(2)
      .add(mx_noise_vec3(chaosHome.mul(0.9).sub(vec3(time.mul(0.25), 0, 0))).mul(0.6))
      .mul(wander);

    // Each shape builds as a wave rather than all at once: the lattice from the
    // floor up, the key from the bow to the tip. A little jitter keeps the front alive.
    const latticeDelay = latticeHome.y.div(LATTICE_SIZE).add(0.5).mul(WAVE).add(jitter.mul(WAVE_JITTER));
    const toLattice = smoothstep(0, 1, clamp(morph.mul(WAVE_SPEED).sub(latticeDelay), 0, 1));
    const keyDelay = keyHome.x.sub(KEY_EXTENT.minX).div(KEY_EXTENT.maxX - KEY_EXTENT.minX).mul(WAVE).add(jitter.mul(WAVE_JITTER));
    const toKey = smoothstep(0, 1, clamp(morph.sub(1).mul(WAVE_SPEED).sub(keyDelay), 0, 1));

    const target = mix(mix(chaosHome.add(drift), latticeHome, toLattice), keyHome, toKey);

    // Spring towards the target. Near the pointer, particles are pushed away and
    // swirled around it; the swirl fades once the shapes have formed.
    const force = target.sub(position).mul(12).toVar();
    const away = position.sub(pointer);
    const distance = length(away);
    const falloff = smoothstep(1.6, 0, distance).mul(pointerStrength);
    const outward = away.div(distance.add(0.0001));
    const around = vec3(outward.y, outward.x.negate(), 0);
    const swirl = float(1).sub(toLattice.mul(0.7));
    force.addAssign(outward.mul(falloff.mul(14)).add(around.mul(falloff.mul(swirl).mul(22))));

    velocity.assign(velocity.add(force.mul(delta)).mul(float(1).sub(delta.mul(5)).max(0)));
    position.addAssign(velocity.mul(delta));

    // In the flow the lane decides the position outright. The switch happens while
    // the particles are hidden, and the loop back to the lane start is faded out.
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

  // Calm particles stay cream; the ones the pointer scatters warm up.
  const speed = length(velocities.toAttribute());
  material.colorNode = mix(color('#f4ecdc'), color('#e3a35a'), smoothstep(0.4, 3, speed));

  // A soft disc, dimmer at the back for depth. The key is dense, so it is drawn
  // fainter, otherwise the additive blend burns it to flat white.
  const disc = clamp(float(1).sub(length(uv().sub(0.5)).mul(2)), 0, 1);
  const depth = mix(0.35, 1, smoothstep(-CHAOS_RADIUS, CHAOS_RADIUS, drawn.z));
  const density = mix(mix(1, 0.35, smoothstep(1, 2, morph)), 1, flow);
  // Along a flow lane, particles fade in at the start and out at the end, so the loop never shows.
  const lane = mix(1, sin(travel.mul(Math.PI)), flow);
  material.opacityNode = min(disc.mul(disc).mul(0.5).mul(depth).mul(density).mul(brightness).mul(lane).mul(visibility), 1);

  // Most particles are fine dust; a few are larger, which gives the cloud some grain.
  const grain = hash(instanceIndex.add(uint(count * 4)));
  material.scaleNode = float(0.02).add(pow(grain, 6).mul(0.06));

  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;

  return {
    object: sprite, update, positions, velocities, morph, time, delta, pointer, pointerStrength, wander, brightness,
    flow, visibility, capacity: count,
  };
}

export type Particles = ReturnType<typeof createParticles>;
