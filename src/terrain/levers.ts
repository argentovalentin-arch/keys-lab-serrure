import * as THREE from 'three/webgpu';
import { color, exp, float, length, positionLocal, smoothstep, uniform, uv } from 'three/tsl';
import { centerX, groundAt, headingAt } from './path';

const CREAM = '#f4ecdc';
const CHAMPAGNE = '#dcc59b';
const WARM = '#ffd9a0';

/** Arm angle at rest (leaning back towards the visitor) and once thrown (forward). */
const REST = 0.7;
const THROWN = -0.7;
/**
 * A chosen lever is thrown over this stretch before the guide reaches it: close enough
 * that, the eyes turned to its side (pace.ts, LEVERS), it stands well in view as it goes.
 */
export const THROW_FROM = 4;
const THROW_TO = 1.5;
/** The flare of light that marks the throw, over this much path after it starts. */
const FLARE_OVER = 5;
/** Distance over which the pulse runs out on the ground once a lever is thrown. */
const PULSE_OVER = 4.5;
/** Spacing of the points that make up a lever (in its own space), as for the walls' bricks. */
const DOT = 0.045;

const smooth = THREE.MathUtils.smoothstep;

/** Additive, see-through: made of light, like the field's particles. */
function light(opacity: THREE.Node<'float'>, tint: THREE.Node<'vec3'>) {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.colorNode = tint;
  material.opacityNode = opacity;
  return material;
}

/** Soft points on a regular grid in the shape's own space: the shape drawn in particles. */
const points = (spacing: number, size = 0.24) =>
  smoothstep(size, size * 0.4, length(positionLocal.div(spacing).fract().sub(0.5)));
/** Points along y only, for the thin arm: a line of particles. */
const pointsAlongY = (spacing: number) => smoothstep(0.3, 0.1, positionLocal.y.div(spacing).fract().sub(0.5).abs());

export interface LeverOptions {
  /** Distance along the path of the first lever, and between two. */
  from: number;
  spacing: number;
  /** One entry per lever, in order: whether it is one of the levers to throw. */
  chosen: boolean[];
  /** How far from the route's centre line they stand, alternately left and right. */
  offset: number;
}

/**
 * « Activer »'s levers: a row of them, one after the other along the path, alternately on
 * either side, drawn in particles like the walls' bricks: a hexagonal plinth, an arm, a
 * knob. The chosen ones are marked from afar by a champagne ring on their plinth; as the
 * guide nears each of them, in turn, its arm swings forward, it lights up warm and a
 * single pulse runs out on the ground (terrain.ts names it at the same moment). The others stay dim and leaning back: not
 * every lever is thrown.
 */
export function createLevers(scene: THREE.Scene, { from, spacing, chosen, offset }: LeverOptions) {
  const plinthGeometry = new THREE.CylinderGeometry(0.22, 0.3, 0.14, 6, 2).translate(0, 0.07, 0);
  const collarGeometry = new THREE.RingGeometry(0.14, 0.19, 6).rotateX(-Math.PI / 2).translate(0, 0.142, 0);
  const armGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.86, 6).translate(0, 0.43, 0);
  const pulseGeometry = new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2).translate(0, 0.03, 0);

  const levers = chosen.map((isChosen, i) => {
    const at = from + i * spacing;
    const seen = uniform(0);
    const thrown = uniform(0);
    const pulse = uniform(0);
    const flare = uniform(0);

    // Plinth: cream points, as faint as the bricks.
    const plinthMaterial = light(points(DOT).mul(0.55).mul(seen), color(CREAM).mul(0.42));
    // Arm: a line of champagne points, lit warm once thrown. The levers left alone stay
    // fainter: what is chosen stands out from what is not.
    const armMaterial = light(
      pointsAlongY(0.05).mul(float(isChosen ? 0.8 : 0.5).add(thrown.mul(0.2))).mul(seen),
      color(CHAMPAGNE).mul(float(0.9).add(thrown.mul(1.2))),
    );
    // Knob: a soft point of light at the top, faint at rest, bright once thrown.
    const centre = uv().sub(0.5).length().mul(2);
    const knobMaterial = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    knobMaterial.colorNode = color(WARM).mul(float(0.8).add(thrown.mul(1.6)));
    knobMaterial.opacityNode = exp(centre.mul(centre).mul(-9)).mul(float(isChosen ? 0.55 : 0.22).add(thrown.mul(0.6)).add(flare.mul(0.8))).mul(seen);
    // The collar marks a chosen lever: faint until thrown, then bright.
    const collarMaterial = light(seen.mul(isChosen ? 0.4 : 0).add(thrown.mul(0.9)), color(CHAMPAGNE).mul(1.3));
    // One ring running out on the ground as the lever is thrown.
    const band = centre.sub(pulse).mul(14);
    const pulseMaterial = light(
      exp(band.mul(band).negate()).mul(float(1).sub(pulse)).mul(pulse.greaterThan(0).select(float(0.8), float(0))),
      color(WARM).mul(1.2),
    );

    // The throw's flare: a column of light rising over the lever, bright as it is thrown,
    // then settling to a faint glow that keeps it marked as one of the chosen.
    const columnMaterial = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const across = uv().x.sub(0.5).mul(5);
    const rise = smoothstep(0, 0.18, uv().y).mul(smoothstep(1, 0.35, uv().y));
    columnMaterial.colorNode = color(WARM).mul(1.4);
    columnMaterial.opacityNode = exp(across.mul(across).negate()).mul(rise).mul(flare.mul(0.85).add(thrown.mul(0.16))).mul(seen);
    const column = new THREE.Sprite(columnMaterial);
    column.center.set(0.5, 0);
    column.scale.set(0.55, 3.4, 1);
    column.position.y = 0.1;
    column.visible = isChosen;

    const group = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.y = 0.14;
    // A point of light (a sprite, so it always faces the camera).
    const knob = new THREE.Sprite(knobMaterial);
    knob.position.y = 0.88;
    knob.scale.setScalar(0.42);
    pivot.add(new THREE.Mesh(armGeometry, armMaterial), knob);
    group.add(
      new THREE.Mesh(plinthGeometry, plinthMaterial),
      new THREE.Mesh(collarGeometry, collarMaterial),
      new THREE.Mesh(pulseGeometry, pulseMaterial),
      pivot,
      column,
    );
    // Beside the lane, square to the route where it stands, on the ground there.
    const heading = headingAt(at);
    const side = (i % 2 ? 1 : -1) * offset;
    const x = centerX(at) + side * Math.cos(heading);
    const z = -at + side * Math.sin(heading);
    const baseY = groundAt(x, z);
    group.position.set(x, baseY, z);
    group.rotation.y = -heading;
    pivot.rotation.x = REST;
    scene.add(group);
    return {
      at, isChosen, group, pivot, knob, baseY, seen, thrown, pulse, flare,
      materials: [plinthMaterial, armMaterial, knobMaterial, collarMaterial, pulseMaterial, columnMaterial],
    };
  });

  return {
    /** Where each chosen lever stands (its plinth on the ground), in order, for its label. */
    chosenPlaces(): { at: number; place: THREE.Vector3; side: number }[] {
      return levers.filter((l) => l.isChosen).map((l) => ({
        at: l.at, place: l.group.position.clone(), side: levers.indexOf(l) % 2 ? 1 : -1,
      }));
    },
    /** From the guide's distance: each lever comes into view, and the chosen ones are thrown in turn. */
    update(distance: number, lookingBack: number) {
      for (const lever of levers) {
        const left = lever.at - distance;
        lever.seen.value = Math.max(1 - smooth(left, 24, 34), lookingBack);
        const thrown = lever.isChosen ? smooth(distance, lever.at - THROW_FROM, lever.at - THROW_TO) : 0;
        lever.thrown.value = thrown;
        lever.pulse.value = lever.isChosen ? THREE.MathUtils.clamp((distance - (lever.at - THROW_TO)) / PULSE_OVER, 0, 1) : 0;
        // Eased so the arm sets off gently and lands firmly: a deliberate throw.
        const swing = thrown * thrown * (3 - 2 * thrown);
        lever.pivot.rotation.x = THREE.MathUtils.lerp(REST, THROWN, swing);
        // The flare rises with the throw and fades over the next few steps.
        const sinceThrow = (distance - (lever.at - THROW_FROM)) / FLARE_OVER;
        lever.flare.value = lever.isChosen && sinceThrow > 0 && sinceThrow < 1 ? Math.sin(Math.PI * Math.sqrt(sinceThrow)) : 0;
        lever.knob.scale.setScalar(0.42 * (1 + lever.flare.value * 1.1));
      }
    },
    /** Moves the levers with the ground when it deepens for the view back (relief.ts). */
    setHeight(height: (y: number) => number) {
      for (const lever of levers) lever.group.position.y = height(lever.baseY);
    },
    dispose() {
      // Not the knobs' geometry: every three.js Sprite shares one.
      for (const geometry of [plinthGeometry, collarGeometry, armGeometry, pulseGeometry]) geometry.dispose();
      for (const lever of levers) lever.materials.forEach((material) => material.dispose());
    },
  };
}

export type Levers = ReturnType<typeof createLevers>;
