import * as THREE from 'three/webgpu';
import { color, float, frontFacing, max, positionLocal, smoothstep, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOW, KEY_DEPTH, KEY_EXTENT, OFFSET_X, RECTS } from './shapes';

const BEVEL = 0.02;
/** Width of the warm seam drawn just behind the solid front. */
const SEAM = 0.12;

/**
 * The metal key: the same silhouette as the particle key, extruded and bevelled,
 * so one can replace the other without a jump.
 *
 * Only the part beyond `front` (key-local x) is drawn: the key solidifies from the
 * tip towards the bow while the particle key, cut at the same line, covers the rest.
 * A narrow warm band at the cut marks where the metal is forming.
 */
export function createKeyMesh() {
  const extrude = (shape: THREE.Shape) =>
    new THREE.ExtrudeGeometry(shape, {
      depth: KEY_DEPTH - BEVEL * 2,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 2,
      curveSegments: 48,
    });

  const bow = new THREE.Shape().absarc(BOW.x, BOW.y, BOW.outer - BEVEL, 0, Math.PI * 2, false);
  bow.holes.push(new THREE.Path().absarc(BOW.x, BOW.y, BOW.inner + BEVEL, 0, Math.PI * 2, true));

  const parts = [bow, ...RECTS.map(([x0, y0, x1, y1]) => {
    const b = BEVEL;
    return new THREE.Shape()
      .moveTo(x0 + b, y0 + b).lineTo(x1 - b, y0 + b).lineTo(x1 - b, y1 - b).lineTo(x0 + b, y1 - b).closePath();
  })].map(extrude);

  const geometry = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  geometry.translate(OFFSET_X, 0, -(KEY_DEPTH - BEVEL * 2) / 2);

  const front = uniform(KEY_EXTENT.maxX + 1);

  // Brass: warm, between the cream of the particles and the amber of their motion.
  // Double-sided, so the cut shows the inside of the metal rather than a hole.
  const material = new THREE.MeshStandardNodeMaterial({
    color: '#c9a36a',
    metalness: 1,
    roughness: 0.26,
    side: THREE.DoubleSide,
  });
  material.maskNode = positionLocal.x.greaterThan(front);
  // The seam glows like metal still forming; through the cut, the inside of the key
  // (its back faces) glows too, so the cut reads as hot metal rather than a hollow shell.
  const seam = smoothstep(front.add(SEAM), front, positionLocal.x);
  const inside = frontFacing.not().select(float(1), float(0));
  material.emissiveNode = color('#e3a35a').mul(max(seam, inside)).mul(1.6);

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
