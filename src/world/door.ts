import * as THREE from 'three/webgpu';
import { color, uniform } from 'three/tsl';
import { KEY_DEPTH } from './shapes';

/** Front face of the door, on the x axis: the key points straight at it. */
export const DOOR_X = 2.6;
const HALF_HEIGHT = 3;
const HALF_WIDTH = 2;
const THICKNESS = 0.3;
const WALL_REACH = 30;

/**
 * Wall, door and lock. The door turns on a hinge along its far edge (z = -HALF_WIDTH)
 * and swings away from the viewer, stopping ajar (see OPEN_ANGLE in story.ts). The key is parented
 * to the door through `keyHolder`, so once it is in the lock it swings open with the door.
 * Behind the wall, a bright panel stands for the light on the other side.
 *
 * `logo` is the official KEYS wordmark; without it the door simply has no mark.
 */
export function createDoor(logo: THREE.Texture | null = null) {
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

  // Door on its hinge. A door that opens away from the viewer turns about the hinge
  // line on its back face; on the front face, its hinge-side edge would dig into the
  // jamb as it opens. `pivot` holds that line and turns; `leaf` holds the door itself,
  // with the front face at x = 0 (the viewer's side is -x) and the hinge edge at z = 0.
  const pivot = new THREE.Group();
  pivot.position.set(DOOR_X + THICKNESS, 0, -HALF_WIDTH);
  group.add(pivot);
  const leaf = new THREE.Group();
  leaf.position.x = -THICKNESS;
  pivot.add(leaf);

  // A little narrower than the doorway: its free edge needs that clearance to swing
  // past the far jamb without grazing it.
  const CLEARANCE = 0.03;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(THICKNESS, HALF_HEIGHT * 2, HALF_WIDTH * 2 - CLEARANCE),
    material({ color: '#17243b', metalness: 0.35, roughness: 0.45 }),
  );
  door.position.set(THICKNESS / 2, 0, HALF_WIDTH - CLEARANCE / 2);
  leaf.add(door);

  const box = (m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return mesh;
  };

  // Two raised panels, above and below the lock: a moulded frame around a slightly darker field.
  const moulding = material({ color: '#22324f', metalness: 0.4, roughness: 0.38 });
  const field = material({ color: '#121e33', metalness: 0.25, roughness: 0.6 });
  const BAR = 0.07;
  const RELIEF = 0.04;
  for (const [y0, y1] of [[0.75, 2.55], [-2.55, -0.75]]) {
    const z0 = 0.45;
    const z1 = HALF_WIDTH * 2 - 0.45;
    leaf.add(
      box(moulding, -RELIEF, 0, y1 - BAR, y1, z0, z1),
      box(moulding, -RELIEF, 0, y0, y0 + BAR, z0, z1),
      box(moulding, -RELIEF, 0, y0 + BAR, y1 - BAR, z0, z0 + BAR),
      box(moulding, -RELIEF, 0, y0 + BAR, y1 - BAR, z1 - BAR, z1),
      box(field, -0.012, 0, y0 + BAR, y1 - BAR, z0 + BAR, z1 - BAR),
    );
  }

  // Hinge knuckles on the hinge line (the back face, so they show once the door opens),
  // and a brushed kick plate at the foot of the door.
  const hingeBrass = material({ color: '#a8844f', metalness: 1, roughness: 0.3 });
  for (const y of [2.3, 0, -2.3]) {
    const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 24), hingeBrass);
    knuckle.position.set(THICKNESS, y, 0);
    leaf.add(knuckle);
  }
  const kickPlate = material({ color: '#9c7c4c', metalness: 1, roughness: 0.55 });
  leaf.add(box(kickPlate, -0.015, 0, -2.95, -2.7, 0.2, HALF_WIDTH * 2 - 0.2));

  // The KEYS wordmark, set in the upper panel: brass-tinted, like an engraved mark.
  if (logo) {
    const height = 0.5;
    const image = logo.image as { width: number; height: number };
    const width = height * (image.width / image.height);
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      material({ map: logo, color: '#c9a36a', metalness: 0.8, roughness: 0.35 }),
    );
    mark.rotation.y = -Math.PI / 2; // faces the viewer's side (-x)
    mark.position.set(-0.014, 1.65, HALF_WIDTH);
    leaf.add(mark);
  }

  // Door casing on the wall, around the doorway.
  const casing = material({ color: '#18253c', metalness: 0.3, roughness: 0.5 });
  const C = 0.22;
  group.add(
    box(casing, DOOR_X - 0.05, DOOR_X, -HALF_HEIGHT, HALF_HEIGHT + C, -HALF_WIDTH - C, -HALF_WIDTH),
    box(casing, DOOR_X - 0.05, DOOR_X, -HALF_HEIGHT, HALF_HEIGHT + C, HALF_WIDTH, HALF_WIDTH + C),
    box(casing, DOOR_X - 0.05, DOOR_X, HALF_HEIGHT, HALF_HEIGHT + C, -HALF_WIDTH, HALF_WIDTH),
  );

  // Lock: a brass plate and, inside it, the plug that turns with the key.
  const brass = material({ color: '#b8925a', metalness: 1, roughness: 0.32 });
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 64), brass);
  plate.rotation.z = Math.PI / 2;
  plate.position.set(-0.03, 0, HALF_WIDTH);
  leaf.add(plate);

  const plug = new THREE.Group();
  plug.position.set(-0.065, 0, HALF_WIDTH);
  const plugFace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.03, 48),
    material({ color: '#8f6f42', metalness: 1, roughness: 0.4 }),
  );
  plugFace.rotation.z = Math.PI / 2;
  // Keyway: the key's profile, from the top of the shaft to the deepest bit, as wide as the key.
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.76, KEY_DEPTH + 0.02),
    material({ color: '#05080d', roughness: 1 }),
  );
  slot.position.y = -0.24;
  plug.add(plugFace, slot);
  leaf.add(plug);

  // The key hangs from the keyhole: scaling `keyMount` shrinks it around the point where
  // it enters the lock, so it stays seated in the plug whatever its size.
  const keyMount = new THREE.Group();
  keyMount.position.set(0, 0, HALF_WIDTH);
  leaf.add(keyMount);
  // Keyhole space -> world origin, where the key is shown before it moves.
  const keyHolder = new THREE.Group();
  keyHolder.position.set(-DOOR_X, 0, 0);
  keyMount.add(keyHolder);

  return {
    group,
    pivot,
    plug,
    keyHolder,
    /** Key size, 1 = as formed from the particles. The keyway follows its profile. */
    setKeyScale(scale: number) {
      keyMount.scale.setScalar(scale);
      slot.scale.set(1, scale, scale);
      slot.position.y = -0.24 * scale;
    },
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
