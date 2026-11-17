import * as THREE from 'three/webgpu';
import { color, float, frontFacing, max, positionLocal, positionWorld, smoothstep, uniform, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KEY_DEPTH, KEY_EXTENT, OFFSET_X, MEDALLION, RECTS, bowRects, kOutlines, medallionInner } from './shapes';
import { LEAF } from './door';
import { DISSOLVE_EDGE, dissolveField, dissolveProgress, leafInverse } from './dissolve';

const BEVEL = 0.02;
/** Width of the warm seam drawn just behind the solid front. */
const SEAM = 0.12;

/**
 * The key's solid geometry: the same silhouette as the particle key (shapes.ts), its bow
 * a medallion holding the brand's « k. », extruded and bevelled, centred like the particle key. Shared with
 * the keys of the ring on the summit (src/terrain/summit.ts).
 */
export function buildKeyGeometry(): THREE.BufferGeometry {
  const extrude = (shape: THREE.Shape, bevel = BEVEL) =>
    new THREE.ExtrudeGeometry(shape, {
      depth: KEY_DEPTH - BEVEL * 2,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 48,
    });
  // The letter's traced outline: bevelled lightly, as it is not inset.
  const letter = kOutlines().map((loop) => extrude(new THREE.Shape(loop), BEVEL * 0.5));
  // The medallion's ring.
  const ring = new THREE.Shape().absarc(MEDALLION.cx, 0, MEDALLION.outer - BEVEL, 0, Math.PI * 2, false);
  ring.holes.push(new THREE.Path().absarc(MEDALLION.cx, 0, medallionInner() + BEVEL, 0, Math.PI * 2, true));
  const parts = [
    ...letter,
    extrude(ring),
    ...[...RECTS, ...bowRects()].map(([x0, y0, x1, y1]) => {
      const b = BEVEL;
      return extrude(new THREE.Shape()
        .moveTo(x0 + b, y0 + b).lineTo(x1 - b, y0 + b).lineTo(x1 - b, y1 - b).lineTo(x0 + b, y1 - b).closePath());
    }),
  ];
  const geometry = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  geometry.translate(OFFSET_X, 0, -(KEY_DEPTH - BEVEL * 2) / 2);
  return geometry;
}

/**
 * The metal key: the same silhouette as the particle key, extruded and bevelled,
 * so one can replace the other without a jump.
 *
 * Only the part beyond `front` (key-local x) is drawn: the key solidifies from the
 * tip towards the bow while the particle key, cut at the same line, covers the rest.
 * A narrow warm band at the cut marks where the metal is forming.
 */
export function createKeyMesh() {
  const geometry = buildKeyGeometry();

  const front = uniform(KEY_EXTENT.maxX + 1);

  // Brass: warm, between the cream of the particles and the amber of their motion.
  // Double-sided, so the cut shows the inside of the metal rather than a hole.
  const material = new THREE.MeshStandardNodeMaterial({
    color: '#c9a36a',
    metalness: 1,
    roughness: 0.26,
    side: THREE.DoubleSide,
  });
  // Once the door is open, the key dissolves with it, in the same field (dissolve.ts).
  const field = dissolveField(leafInverse.mul(vec4(positionWorld, 1)).xyz, LEAF.width);
  material.maskNode = positionLocal.x.greaterThan(front).and(field.greaterThan(dissolveProgress));
  // The seam glows like metal still forming; through the cut, the inside of the key
  // (its back faces) glows too, so the cut reads as hot metal rather than a hollow shell.
  const seam = smoothstep(front.add(SEAM), front, positionLocal.x);
  const inside = frontFacing.not().select(float(1), float(0));
  const dissolving = smoothstep(dissolveProgress.add(DISSOLVE_EDGE), dissolveProgress, field);
  material.emissiveNode = color('#e3a35a').mul(max(max(seam, inside), dissolving)).mul(1.6);

  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    material,
    /** 0 = no metal yet, 1 = the whole key is solid. */
    setSolid(amount: number) {
      // A hair past each end, so 0 and 1 are exactly "nothing" and "everything".
      const from = KEY_EXTENT.maxX + 0.01;
      const to = KEY_EXTENT.minX - 0.01;
      front.value = from + (to - from) * amount;
      mesh.visible = amount > 0;
    },
    /** Key-local x of the solid front, shared with the particle key. */
    front,
  };
}
