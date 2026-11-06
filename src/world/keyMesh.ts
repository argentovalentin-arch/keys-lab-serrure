import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOW, KEY_DEPTH, OFFSET_X, RECTS } from './shapes';

const BEVEL = 0.02;

/**
 * The metal key: the same silhouette as the particle key, extruded and bevelled,
 * so one can replace the other without a jump.
 */
export function createKeyMesh(): { mesh: THREE.Mesh; material: THREE.MeshStandardNodeMaterial } {
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

  // Brass: warm, between the cream of the particles and the amber of their motion.
  const material = new THREE.MeshStandardNodeMaterial({
    color: '#c9a36a',
    metalness: 1,
    roughness: 0.26,
    transparent: true,
    opacity: 0,
  });
  return { mesh: new THREE.Mesh(geometry, material), material };
}
