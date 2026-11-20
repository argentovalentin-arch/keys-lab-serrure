import * as THREE from 'three/webgpu';
import { abs, attribute, cameraPosition, color, exp, float, length, max, mix, positionWorld, smoothstep, uniform, uv, vec2 } from 'three/tsl';
import { PIER, SEA_LEVEL } from './coast';
import { BRAND, LAB } from '../core/brand';

/**
 * The landing stage at the mountain's foot, where the crossing ends: a long, narrow deck of
 * planks on slender piles, from the beach out over the water, and a single light on a post
 * at its far end, the point to come alongside. The boat comes in on its left side and stops
 * there; the visitor steps onto the deck and walks it to the beach, where the land begins.
 *
 * Drawn in the Lab's own matter, as the pavers and the levers are: each plank a face of fine
 * points of light with brighter edges (the joints read as dark lines between them), the
 * deck's two long edges as hairlines of champagne, the piles as lines of points fading into
 * the water. One light, no ornament.
 */

const PLANK = 0.3;
const JOINT = 0.07;
const THICK = 0.07;
const DOT = 0.05;
const PILE_EVERY = 2.6;
const PILE_RADIUS = 0.055;

/** Additive, see-through: made of light, like the field's particles. */
function light() {
  return new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

/** Boxes merged into one geometry, each vertex knowing where it is in its own box (`local`) and the box's size (`size`). */
function boxes(list: { centre: THREE.Vector3; size: THREE.Vector3 }[]) {
  const positions: number[] = [];
  const locals: number[] = [];
  const sizes: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (const { centre, size } of list) {
    const box = new THREE.BoxGeometry(size.x, size.y, size.z);
    const p = box.getAttribute('position');
    const n = box.getAttribute('normal');
    const base = positions.length / 3;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i) + centre.x, p.getY(i) + centre.y, p.getZ(i) + centre.z);
      locals.push(p.getX(i), p.getY(i), p.getZ(i));
      sizes.push(size.x, size.y, size.z);
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const idx = box.getIndex()!;
    for (let i = 0; i < idx.count; i++) index.push(base + idx.getX(i));
    box.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('boxLocal', new THREE.Float32BufferAttribute(locals, 3));
  geometry.setAttribute('boxSize', new THREE.Float32BufferAttribute(sizes, 3));
  geometry.setIndex(index);
  return geometry;
}

export function createPier(scene: THREE.Scene) {
  const group = new THREE.Group();
  const shown = uniform(0);
  /** The light at the end: brighter while the boat comes in. */
  const beacon = uniform(1);
  const width = PIER.half * 2;
  const length_ = PIER.sea - PIER.land;

  // ---- The deck: planks across it, side by side.
  const planks: { centre: THREE.Vector3; size: THREE.Vector3 }[] = [];
  for (let z = PIER.land + PLANK / 2; z <= PIER.sea - PLANK / 2 + 1e-6; z += PLANK + JOINT) {
    planks.push({ centre: new THREE.Vector3(0, PIER.deck - THICK / 2, z), size: new THREE.Vector3(width, THICK, PLANK) });
  }
  const deckGeometry = boxes(planks);
  const local = attribute('boxLocal', 'vec3');
  const size = attribute('boxSize', 'vec3');
  const onTop = attribute('normal', 'vec3').y.greaterThan(0.5);
  const face = onTop.select(local.xz, local.xy);
  const point = smoothstep(0.26, 0.1, length(face.div(DOT).fract().sub(0.5)));
  const toEdge = max(abs(local.x).div(size.x.mul(0.5)), abs(local.z).div(size.z.mul(0.5)));
  const edge = smoothstep(0.86, 0.98, toEdge);
  const deckMaterial = light();
  deckMaterial.colorNode = mix(color(LAB.dust).mul(0.42), color(BRAND.champagne).mul(0.55), edge);
  deckMaterial.opacityNode = point.mul(float(0.22).add(edge.mul(0.4))).add(edge.mul(0.06)).mul(onTop.select(float(1), float(0.35))).mul(shown);
  const deck = new THREE.Mesh(deckGeometry, deckMaterial);
  group.add(deck);

  // ---- The deck's long edges: two hairlines of champagne, the stage's lines from afar.
  const railGeometry = boxes([-1, 1].map((side) => ({
    centre: new THREE.Vector3(side * (PIER.half + 0.02), PIER.deck - 0.04, (PIER.land + PIER.sea) / 2),
    size: new THREE.Vector3(0.035, 0.035, length_),
  })));
  const railMaterial = light();
  const along = attribute('boxLocal', 'vec3').z;
  railMaterial.colorNode = color(BRAND.champagne).mul(1.2);
  railMaterial.opacityNode = smoothstep(0.32, 0.1, along.div(0.07).fract().sub(0.5).abs()).mul(0.75).mul(shown);
  const rails = new THREE.Mesh(railGeometry, railMaterial);
  group.add(rails);

  // ---- The piles: pairs under the deck's edges, from the sea floor to a little over the deck.
  const piles: { centre: THREE.Vector3; size: THREE.Vector3 }[] = [];
  const bottom = -0.7;
  const top = PIER.deck + 0.22;
  for (let z = PIER.sea - 0.15; z > PIER.land + 2.2; z -= PILE_EVERY) {
    for (const side of [-1, 1]) {
      piles.push({ centre: new THREE.Vector3(side * (PIER.half + 0.05), (bottom + top) / 2, z), size: new THREE.Vector3(PILE_RADIUS * 2, top - bottom, PILE_RADIUS * 2) });
    }
  }
  // The post at the far end, on the side the boat comes in: taller, it carries the light.
  const postTop = PIER.deck + 1.15;
  piles.push({ centre: new THREE.Vector3(-PIER.half - 0.05, (bottom + postTop) / 2, PIER.sea - 0.15), size: new THREE.Vector3(PILE_RADIUS * 2.2, postTop - bottom, PILE_RADIUS * 2.2) });
  const pileGeometry = boxes(piles);
  const pileMaterial = light();
  const height = attribute('boxLocal', 'vec3').y;
  // Under the water they fade: the sea's surface reads where they enter it.
  const dry = smoothstep(SEA_LEVEL - 0.5, SEA_LEVEL + 0.05, attribute('position', 'vec3').y);
  pileMaterial.colorNode = color(LAB.dust).mul(0.8);
  // One point per course, in the middle of each face: a slender column of points.
  const pileLocal = attribute('boxLocal', 'vec3');
  const pileSize = attribute('boxSize', 'vec3');
  const sideways = attribute('normal', 'vec3').x.abs().greaterThan(0.5).select(pileLocal.z.div(pileSize.z), pileLocal.x.div(pileSize.x));
  const dot = smoothstep(0.32, 0.12, vec2(height.div(0.07).fract().sub(0.5), sideways.mul(0.9)).length());
  // Passed close by (from the boat), a post steps back rather than fill the view with large points.
  const close = smoothstep(1.2, 3, cameraPosition.distance(positionWorld));
  pileMaterial.opacityNode = dot.mul(dry.mul(0.72).add(0.03)).mul(0.55).mul(close).mul(shown);
  const pileMesh = new THREE.Mesh(pileGeometry, pileMaterial);
  group.add(pileMesh);

  // ---- The light at the end of the stage: where to come alongside.
  const lampMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const r = uv().sub(0.5).length().mul(2);
  lampMaterial.colorNode = mix(color(BRAND.champagne), color(LAB.lightCore), exp(r.mul(r).mul(-40))).mul(1.6);
  // Close to the eye (the boat passing it) it steps back, rather than fill the view.
  const near = smoothstep(1.5, 5, cameraPosition.distance(positionWorld));
  lampMaterial.opacityNode = exp(r.mul(r).mul(-9)).mul(smoothstep(1, 0.7, r)).mul(beacon.mul(0.5).add(0.5)).mul(near.mul(0.8).add(0.2)).mul(shown);
  const lamp = new THREE.Sprite(lampMaterial);
  lamp.position.set(-PIER.half - 0.05, postTop + 0.1, PIER.sea - 0.15);
  lamp.scale.setScalar(0.7);
  group.add(lamp);

  group.visible = false;
  scene.add(group);

  return {
    /** 0..1: how much it shows; how bright its light (the boat coming in); where the sea's surface is now (the summit's view lowers it). */
    update(amount: number, call = 1, level = SEA_LEVEL) {
      shown.value = amount;
      beacon.value = call;
      group.visible = amount > 0.001;
      group.position.y = level - SEA_LEVEL;
      lamp.scale.setScalar(0.7 + call * 0.35);
    },
    dispose() {
      [deckGeometry, railGeometry, pileGeometry].forEach((g) => g.dispose());
      [deckMaterial, railMaterial, pileMaterial, lampMaterial].forEach((m) => m.dispose());
    },
  };
}

export type Pier = ReturnType<typeof createPier>;
