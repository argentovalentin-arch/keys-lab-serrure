import * as THREE from 'three/webgpu';
import { color, uniform } from 'three/tsl';

/** Front face of the door, on the x axis: the key points straight at it. */
export const DOOR_X = 2.6;
const HALF_HEIGHT = 3;
const HALF_WIDTH = 2;
const THICKNESS = 0.3;
const WALL_REACH = 30;

/**
 * Wall, door and lock. The door turns on a hinge along its far edge (z = -HALF_WIDTH)
 * and swings away from the viewer. The key is parented to the door through
 * `keyHolder`, so once it is in the lock it swings open with the door.
 * Behind the wall, a bright panel stands for the light on the other side.
 */
export function createDoor() {
  const group = new THREE.Group();
  const fading: THREE.Material[] = [];
  const material = (params: ConstructorParameters<typeof THREE.MeshStandardNodeMaterial>[0]) => {
    const m = new THREE.MeshStandardNodeMaterial({ ...params, transparent: true, opacity: 0 });
    fading.push(m);
    return m;
  };

  // Wall: four slabs around the doorway.
  const wallMaterial = material({ color: '#0c1422', roughness: 0.95 });
  const slab = (y0: number, y1: number, z0: number, z1: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(THICKNESS, y1 - y0, z1 - z0), wallMaterial);
    mesh.position.set(DOOR_X + THICKNESS / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    group.add(mesh);
  };
  slab(HALF_HEIGHT, WALL_REACH, -WALL_REACH, WALL_REACH);
  slab(-WALL_REACH, -HALF_HEIGHT, -WALL_REACH, WALL_REACH);
  slab(-HALF_HEIGHT, HALF_HEIGHT, -WALL_REACH, -HALF_WIDTH);
  slab(-HALF_HEIGHT, HALF_HEIGHT, HALF_WIDTH, WALL_REACH);

  // The light beyond the doorway; it only shows once the door opens.
  const glow = uniform(0);
  const lightMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  lightMaterial.colorNode = color('#fff1d6').mul(glow.mul(1.6));
  const lightPanel = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), lightMaterial);
  lightPanel.rotation.y = -Math.PI / 2;
  lightPanel.position.x = DOOR_X + 3;
  const spill = new THREE.PointLight('#ffd9a0', 0, 30, 1.2);
  spill.position.set(DOOR_X + 1, 0, 0);
  group.add(lightPanel, spill);

  // Door on its hinge. Children are placed relative to the hinge line.
  const pivot = new THREE.Group();
  pivot.position.set(DOOR_X, 0, -HALF_WIDTH);
  group.add(pivot);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(THICKNESS, HALF_HEIGHT * 2, HALF_WIDTH * 2),
    material({ color: '#17243b', metalness: 0.35, roughness: 0.45 }),
  );
  door.position.set(THICKNESS / 2, 0, HALF_WIDTH);
  pivot.add(door);

  // Lock: a brass plate and, inside it, the plug that turns with the key.
  const brass = material({ color: '#b8925a', metalness: 1, roughness: 0.32 });
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 64), brass);
  plate.rotation.z = Math.PI / 2;
  plate.position.set(-0.03, 0, HALF_WIDTH);
  pivot.add(plate);

  const plug = new THREE.Group();
  plug.position.set(-0.065, 0, HALF_WIDTH);
  const plugFace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.03, 48),
    material({ color: '#8f6f42', metalness: 1, roughness: 0.4 }),
  );
  plugFace.rotation.z = Math.PI / 2;
  // Keyway: tall and thin, the key's profile from the top of the shaft to the deepest bit.
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.76, 0.09), material({ color: '#05080d', roughness: 1 }));
  slot.position.y = -0.24;
  plug.add(plugFace, slot);
  pivot.add(plug);

  // Hinge space -> world origin, where the key is shown before it moves.
  const keyHolder = new THREE.Group();
  keyHolder.position.set(-DOOR_X, 0, HALF_WIDTH);
  pivot.add(keyHolder);

  return {
    group,
    pivot,
    plug,
    keyHolder,
    /** 0 = absent, 1 = fully drawn. */
    setReveal(amount: number) {
      group.visible = amount > 0.001;
      for (const m of fading) m.opacity = amount;
    },
    /** 0 = dark, 1 = full light behind the doorway. */
    setGlow(amount: number) {
      glow.value = amount;
      spill.intensity = amount * 14;
      lightPanel.visible = amount > 0.001;
    },
  };
}

export type Door = ReturnType<typeof createDoor>;
