import * as THREE from 'three/webgpu';
import {
  abs, color, exp, float, instancedBufferAttribute, mix, normalView, positionLocal, pow, smoothstep, uniform, uv, vec2,
} from 'three/tsl';
import { buildKeyGeometry } from '../world/keyMesh';
import { MEDALLION, OFFSET_X, bowHangPoint } from '../world/shapes';
import { graduatedRing } from './projection';
import { BRAND, LAB } from '../core/brand';

const WARM = LAB.light;
const ARC_POINTS = 80;

const smooth = THREE.MathUtils.smoothstep;

export interface SummitTiming {
  /**
   * When each key's arc sets off from its action (seconds after the stop), in order: with
   * the summit's note, one event (timeline.ts, ENDING); and when the keys, all formed,
   * gather on their ring.
   */
  keysAt: number[];
  gatherAt: number;
  /** When the thread linking the three actions draws itself, before any key forms. */
  linkAt: [number, number];
}

/**
 * The arrival on the summit and its note, « Chaque résultat relié à une action »:
 * - arriving: a wave of light runs out over the top from where the ride stopped, and a
 *   column of light rises ahead, where the key ring will hang, the climb's end marked like
 *   its landmarks; it settles to a thread of light before the note comes in;
 * - once the three actions have been shown, a thread of light links them, from the outer two
 *   in to the middle: three parts of one whole;
 * - then, with the note, from each action an arc of particles goes to a key of light, in the
 *   « k. » design of the key that opened the door: each action gives its key;
 * - once all are there, the keys gather on a ring that is the brand's graduated rule, at
 *   the crown's apex (crown.ts): every action held together.
 */
export function createSummit(scene: THREE.Scene, { keysAt, gatherAt, linkAt }: SummitTiming) {
  const since = uniform(-1);
  const gone = uniform(1); // 1 until the turn, then fading out

  // ---- The wave over the top, and the column of light on the summit.
  const waveRadius = uniform(0);
  const waveFade = uniform(0);
  const flat = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const additive = () => new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const waveMaterial = additive();
  const r = uv().sub(0.5).length().mul(2);
  const band = r.sub(0.96).mul(40);
  waveMaterial.colorNode = color(WARM).mul(1.6);
  waveMaterial.opacityNode = exp(band.mul(band).negate()).add(smoothstep(0.96, 0.4, r).mul(0.06)).mul(waveFade);
  const wave = new THREE.Mesh(flat, waveMaterial);
  wave.visible = false;
  scene.add(wave);

  const beamFade = uniform(0);
  const beamMaterial = additive();
  const across = uv().x.sub(0.5).mul(5);
  beamMaterial.colorNode = color(WARM).mul(1.2);
  beamMaterial.opacityNode = exp(across.mul(across).negate()).mul(smoothstep(1, 0.05, uv().y)).mul(beamFade);
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 40), beamMaterial);
  beam.visible = false;
  scene.add(beam);

  // ---- Arcs of particles from each action up to its key.
  const arcCount = keysAt.length;
  const positions = new THREE.InstancedBufferAttribute(new Float32Array(arcCount * ARC_POINTS * 3), 3);
  const params = new THREE.InstancedBufferAttribute(new Float32Array(arcCount * ARC_POINTS * 2), 2);
  const arcStarts = keysAt;
  const ARC_DRAW = 0.9;
  for (let a = 0; a < arcCount; a++) {
    for (let k = 0; k < ARC_POINTS; k++) params.setXY(a * ARC_POINTS + k, k / (ARC_POINTS - 1), arcStarts[a]);
  }
  const arcPoint = instancedBufferAttribute(positions);
  const arcParam = instancedBufferAttribute(params, 'vec2') as unknown as THREE.Node<'vec2'>;
  const along = arcParam.x;
  const drawn = since.sub(arcParam.y).div(ARC_DRAW).clamp(0, 1);
  const visible = smoothstep(drawn.add(0.02), drawn.sub(0.02), along).mul(since.greaterThan(arcParam.y).select(float(1), float(0)));
  const head = exp(along.sub(drawn).abs().mul(-30)).mul(drawn.lessThan(1).select(float(1), float(0)));
  const arcMaterial = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const point = float(1).sub(uv().sub(0.5).length().mul(2)).clamp(0, 1);
  arcMaterial.positionNode = arcPoint;
  arcMaterial.colorNode = color(WARM).mul(float(1.1).add(head.mul(1.4)));
  arcMaterial.opacityNode = point.mul(point).mul(visible.mul(0.75).add(head.mul(0.8))).mul(gone);
  arcMaterial.scaleNode = float(0.16).add(head.mul(0.22));
  const arcs = new THREE.Sprite(arcMaterial);
  arcs.count = arcCount * ARC_POINTS;
  arcs.frustumCulled = false;
  arcs.visible = false;
  scene.add(arcs);

  // ---- The thread linking the three actions: points of light along a gentle curve through
  // the three badges, drawn from the outer two in to the middle, a pulse then running out
  // from the middle to each; it stays, faint, while the keys form from them.
  const LINK_POINTS = 120;
  const linkPositions = new THREE.InstancedBufferAttribute(new Float32Array(LINK_POINTS * 3), 3);
  const linkParams = new THREE.InstancedBufferAttribute(new Float32Array(LINK_POINTS), 1);
  for (let k = 0; k < LINK_POINTS; k++) linkParams.setX(k, k / (LINK_POINTS - 1));
  const linkPoint = instancedBufferAttribute(linkPositions);
  const linkU = instancedBufferAttribute(linkParams, 'float') as unknown as THREE.Node<'float'>;
  const linkDraw = uniform(0);
  const linkPulse = uniform(-1);
  const linkFade = uniform(0);
  // From each end in: a point is drawn once the draw has reached it from its nearer end.
  const fromEnd = float(0.5).sub(abs(linkU.sub(0.5)));
  const linkShown = smoothstep(fromEnd.sub(0.02), fromEnd, linkDraw.mul(0.5));
  const linkHead = exp(fromEnd.sub(linkDraw.mul(0.5)).abs().mul(-60)).mul(linkDraw.lessThan(1).select(float(1), float(0)));
  const pulse = exp(abs(linkU.sub(0.5)).sub(linkPulse.mul(0.5)).abs().mul(-40)).mul(linkPulse.greaterThan(0).select(float(1), float(0)));
  const linkMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const linkDot = float(1).sub(uv().sub(0.5).length().mul(2)).clamp(0, 1);
  linkMaterial.positionNode = linkPoint;
  linkMaterial.colorNode = color(WARM).mul(float(1).add(linkHead.add(pulse).mul(1.2)));
  linkMaterial.opacityNode = linkDot.mul(linkDot).mul(linkShown.mul(0.55).add(linkHead.mul(0.8)).add(pulse.mul(0.9))).mul(linkFade);
  linkMaterial.scaleNode = float(0.1).add(linkHead.add(pulse).mul(0.12));
  const link = new THREE.Sprite(linkMaterial);
  link.count = LINK_POINTS;
  link.frustumCulled = false;
  link.visible = false;
  scene.add(link);
  const linkCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const linkAt3 = new THREE.Vector3();

  // ---- The key ring, made of the Lab's own light (« l'épure lumineuse »): one key per
  // action, in the « k. » design of the key that opened the door (shapes.ts, keyMesh.ts),
  // drawn as light through glass: its edges champagne, its faces barely there. Each key forms
  // where its arc arrives, from there out to its tip and its bow, as the door's key formed
  // out of the particles. Once all are there they hang together on a ring that is the
  // brand's graduated rule: the actions held together, each key still tied by its arc to the
  // action it came from until the ring is taken. Then the ring comes to the visitor, as if now in their
  // hand: it stays with them through the half-turn, the keys swinging from it, then is
  // carried across, left to right, the keys swaying and settling, before it is lowered out
  // of view for the curve.
  const keyGeometry = buildKeyGeometry();
  const KEY_SCALE = 0.62;
  // Where a key hangs: in the crotch of the « k »'s branches (centred key space).
  const hangPoint = new THREE.Vector3(bowHangPoint().x, bowHangPoint().y, 0);
  const keyCentre = new THREE.Vector3(0.4, 0, 0); // about where its weight is, along the shaft
  // At rest, a key hangs with its weight (along the shaft, around keyCentre) under that point.
  const toWeight = keyCentre.clone().sub(hangPoint);
  const REST = -Math.PI / 2 - Math.atan2(toWeight.y, toWeight.x);
  const held = uniform(1); // 1 until the ring is lowered out of view
  const inHand = uniform(0); // 0 at the top, 1 once taken in hand
  /**
   * Light through glass: bright where the surface turns away from the eye (its edges and
   * bevels), faint where it faces it. `reveal` (0..1), if given, draws the key from its
   * middle (where its arc arrives) out to both ends, a bright front running ahead.
   */
  const lightGlass = (glow: THREE.Node<'float'>, fade: THREE.Node<'float'>, reveal?: THREE.Node<'float'>) => {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const rim = pow(float(1).sub(normalView.z.abs()), 2.2);
    let shown: THREE.Node<'float'> = float(1);
    let front: THREE.Node<'float'> = float(0);
    if (reveal) {
      // Out to its farthest point: the back of the medallion, 3.15 from the middle.
      const away = abs(positionLocal.x.sub(keyCentre.x));
      const reach = reveal.mul(3.3);
      shown = smoothstep(reach.add(0.06), reach.sub(0.06), away);
      front = exp(away.sub(reach).div(0.08).pow(2).negate()).mul(float(1).sub(smoothstep(0.9, 1, reveal)));
    }
    // The medallion with the brand's « k. » on the key's bow: many edges close together, it
    // burned and bloomed. Its light is kept lower, so the mark reads finely, not as a glare.
    const emblem = reveal
      ? smoothstep(MEDALLION.outer + 0.15, MEDALLION.outer - 0.1, vec2(positionLocal.x.sub(MEDALLION.cx + OFFSET_X), positionLocal.y).length())
      : float(0);
    const calm = mix(float(1), float(0.42), emblem);
    // Fainter in hand, close to the eye, where several keys overlap.
    material.colorNode = color(BRAND.champagne).mul(rim.mul(1.25).add(0.07).add(front.mul(1.6)).mul(calm))
      .add(color(LAB.lightCore).mul(glow.mul(0.5).mul(mix(float(1), float(0.25), emblem)))).mul(float(1).sub(inHand.mul(0.3)));
    material.opacityNode = fade.mul(held).mul(shown.max(front));
    return material;
  };
  const gather = Math.max(gatherAt, arcStarts[arcStarts.length - 1] + ARC_DRAW + 0.2);
  const GATHER_OVER = 0.85;
  const RING_RADIUS = 0.8;

  /** Everything on the ring moves with it: at the top first, then in the visitor's hand. */
  const bunch = new THREE.Group();
  bunch.visible = false;
  scene.add(bunch);
  const keys = keysAt.map((_, i) => {
    const fade = uniform(0);
    const glow = uniform(0);
    const reveal = uniform(0);
    const material = lightGlass(glow, fade, reveal);
    const mesh = new THREE.Mesh(keyGeometry, material);
    mesh.scale.setScalar(KEY_SCALE);
    mesh.position.copy(hangPoint).multiplyScalar(-KEY_SCALE);
    // The key hangs from `pivot`: a point of the ring once gathered.
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.add(mesh);
    pivot.visible = false;
    bunch.add(pivot);
    // Threaded at different points of the ring's lower half, each turned a little its own
    // way, as keys on a ring are, not lined up flat.
    const along = (i - 1) * 0.62;
    return {
      pivot, material, fade, glow, reveal, along, turn: [-0.45, 0.2, 0.6][i] ?? 0,
      // A little apart in depth along the ring's wire, so they never pass through each other.
      spread: new THREE.Vector3(), hang: new THREE.Vector3(Math.sin(along) * RING_RADIUS, -Math.cos(along) * RING_RADIUS, (i - 1) * 0.16),
      swing: 0, swingSpeed: 0,
    };
  });
  // The ring: a fine ring of the same light, and round it the brand's graduated rule.
  const ringFade = uniform(0);
  const ringMaterial = lightGlass(float(0.15), ringFade);
  const ringGeometry = new THREE.TorusGeometry(RING_RADIUS, 0.03, 12, 96);
  const ring = new THREE.Group();
  const ringWire = new THREE.Mesh(ringGeometry, ringMaterial);
  const ruleMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  ruleMaterial.colorNode = color(BRAND.champagne).mul(1.3);
  ruleMaterial.opacityNode = graduatedRing().mul(ringFade).mul(held).mul(0.85);
  // The rule's hairline sits at 0.97 of the plane's half-size: on the wire, its ticks inside.
  const rule = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ruleMaterial);
  rule.scale.setScalar((RING_RADIUS * 2.36) / 0.97);
  ring.add(ringWire, rule);
  ring.visible = false;
  bunch.add(ring);

  // In the hand: where the ring sits in front of the camera (camera space), how big.
  const HAND = new THREE.Vector3(0, -0.55, -3.4);
  const HAND_SCALE = 0.27;
  const HAND_SWAY = 1.15; // carried from this far left to as far right
  const ringCentre = new THREE.Vector3();
  const atTop = new THREE.Quaternion();
  const handPos = new THREE.Vector3();
  const handQuat = new THREE.Quaternion();
  let lastHandX = 0;
  let lastHandSpeed = 0;
  let lastYaw: number | null = null;
  let lastSince = -1;

  const control = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const arcFrom = keysAt.map(() => new THREE.Vector3());
  /** Arc `a`, from its action badge's point to `end`: rising first, then bending over into it. */
  const drawArc = (a: number, end: THREE.Vector3) => {
    const from = arcFrom[a];
    control.lerpVectors(from, end, 0.35).setY(Math.max(from.y, end.y) + 2.5);
    for (let k = 0; k < ARC_POINTS; k++) {
      const t = k / (ARC_POINTS - 1);
      const u = 1 - t;
      positions.setXYZ(
        a * ARC_POINTS + k,
        u * u * from.x + 2 * u * t * control.x + t * t * end.x,
        u * u * from.y + 2 * u * t * control.y + t * t * end.y,
        u * u * from.z + 2 * u * t * control.z + t * t * end.z,
      );
    }
  };
  const keyMiddle = new THREE.Vector3();
  /** A damped pendulum (length about a key's), driven by the sideways acceleration of what holds it. */
  const pendulum = (angle: number, speed: number, push: number, dt: number) => {
    const accel = -9 * Math.sin(angle) - 1.6 * speed - push * Math.cos(angle);
    const nextSpeed = speed + accel * dt;
    return [angle + nextSpeed * dt, nextSpeed];
  };

  return {
    /**
     * Lays it all out once the ride has stopped: the wave from where it stopped, the column
     * and the ring at `top`, the arcs from each action badge's point on the ground
     * (`starts`, in order) to its key, spread in a row under the ring.
     */
    place(summit: THREE.Vector3, starts: THREE.Vector3[], top: THREE.Vector3, spread = 4) {
      wave.position.copy(summit).setY(summit.y + 0.1);
      // The column stands where the ring will hang, from the ground up.
      beam.position.copy(top).setY(top.y - 9 + 20);
      ringCentre.copy(top).setY(top.y + 1.6);
      starts.forEach((from, a) => {
        // Spread in a row, each under its own action (relative to the ring's centre).
        keys[a].spread.set((a - 1) * spread, (a === 1 ? -0.4 : -1.1) - 1.6, 0);
        arcFrom[a].copy(from);
        drawArc(a, offset.copy(keys[a].spread).add(ringCentre));
      });
      positions.needsUpdate = true;
      // The thread through the three actions, sagging a little between them.
      if (starts.length === 3) {
        linkCurve.points[0].copy(starts[0]);
        linkCurve.points[1].copy(starts[1]).setY(starts[1].y - 0.35);
        linkCurve.points[2].copy(starts[2]);
        for (let k = 0; k < LINK_POINTS; k++) {
          linkCurve.getPoint(k / (LINK_POINTS - 1), linkAt3);
          linkPositions.setXYZ(k, linkAt3.x, linkAt3.y, linkAt3.z);
        }
        linkPositions.needsUpdate = true;
      }
    },
    /**
     * Seconds since the stop (null while riding), the camera (the column faces it, the ring
     * goes to it), and the timing of the moments it moves through.
     */
    update(
      sinceStop: number | null,
      camera: THREE.Camera,
      noteAt: number,
      moments: { hand: number; sway: [number, number]; lower: [number, number] },
    ) {
      const on = sinceStop !== null;
      const s = sinceStop ?? -1;
      const dt = on && lastSince >= 0 ? Math.min(Math.max(s - lastSince, 0), 0.05) : 0;
      lastSince = on ? s : -1;
      since.value = s;
      // The arcs, the column and the wave go as the ring is taken in hand.
      gone.value = 1 - smooth(s, moments.hand - 0.2, moments.hand + 0.6);
      held.value = 1 - smooth(s, moments.lower[0], moments.lower[1]);
      // Arrival: the wave runs out over 1.8 s; the column rises, then thins out.
      const w = smooth(s, 0, 1.8);
      waveRadius.value = 3 + 46 * (1 - (1 - w) ** 2);
      wave.scale.setScalar(waveRadius.value);
      waveFade.value = on ? (1 - w) * smooth(s, 0, 0.15) : 0;
      // On a portrait phone the column takes a much larger share of the screen: fainter.
      const beamCalm = ((camera as THREE.PerspectiveCamera).aspect ?? 1) < 0.9 ? 0.35 : 1;
      beamFade.value = on ? smooth(s, 0.1, 0.8) * (1 - 0.8 * smooth(s, 1.4, noteAt)) * gone.value * beamCalm : 0;
      beam.rotation.y = Math.atan2(camera.position.x - beam.position.x, camera.position.z - beam.position.z);

      // Where the ring is: at the top, then taken in hand (camera space), carried across, lowered.
      const take = smooth(s, moments.hand, moments.hand + 1.3);
      const across = smooth(s, moments.sway[0], moments.sway[1]);
      // On a narrow (portrait) screen the hand carries it less far, so it stays in view.
      const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 50);
      const halfWidth = Math.tan(fov / 2) * -HAND.z * ((camera as THREE.PerspectiveCamera).aspect ?? 1);
      // And held a little smaller, so the hanging keys are not cut by the screen's edges.
      // Landscape screens (computers) keep the movement as it was designed.
      const aspect = (camera as THREE.PerspectiveCamera).aspect ?? 1;
      const sway = aspect >= 1 ? HAND_SWAY : Math.min(HAND_SWAY, halfWidth * 0.3);
      const handScale = HAND_SCALE * Math.min(1, 0.5 + 0.5 * aspect);
      const handX = THREE.MathUtils.lerp(-sway, sway, across);
      const lift = Math.sin(across * Math.PI) * 0.18; // carried in a slight arc
      const lowered = smooth(s, moments.lower[0], moments.lower[1]);
      camera.updateMatrixWorld();
      handPos.set(THREE.MathUtils.lerp(0, -sway, take) + (across > 0 ? handX + sway : 0), HAND.y + lift - lowered * 1.6, HAND.z);
      camera.localToWorld(handPos);
      camera.getWorldQuaternion(handQuat);
      bunch.position.lerpVectors(ringCentre, handPos, take);
      bunch.quaternion.slerpQuaternions(atTop, handQuat, take);
      bunch.scale.setScalar(THREE.MathUtils.lerp(1, handScale, take));
      inHand.value = take;
      // What drives the keys' swing: the hand's sideways acceleration, and the camera turning.
      const handSpeed = dt > 0 ? (handX - lastHandX) / dt : 0;
      const handAccel = dt > 0 ? (handSpeed - lastHandSpeed) / dt : 0;
      lastHandX = handX;
      lastHandSpeed = handSpeed;
      const yaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]);
      let yawRate = 0;
      if (lastYaw !== null && dt > 0) {
        let delta = yaw - lastYaw;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        yawRate = delta / dt;
      }
      lastYaw = on ? yaw : null;
      const push = take >= 1 ? handAccel * 0.55 - yawRate * 2.2 : 0;

      // Each key: appears as its arc arrives (a small swell), then goes to hang on the ring.
      const together = smooth(s, gather, gather + GATHER_OVER);
      keys.forEach((key, i) => {
        const arrive = arcStarts[i] + ARC_DRAW;
        key.fade.value = on ? smooth(s, arrive - 0.15, arrive + 0.05) : 0;
        key.reveal.value = on ? THREE.MathUtils.clamp((s - arrive + 0.1) / 0.7, 0, 1) : 0;
        key.glow.value = Math.exp(-(((s - arrive - 0.5) / 0.35) ** 2)) * 0.8 + together * 0.1;
        const pop = 1 + 0.08 * Math.exp(-(((s - arrive - 0.6) / 0.2) ** 2));
        // In the row the key's middle sits at its spot; on the ring, its hang point does.
        offset.copy(hangPoint).sub(keyCentre).multiplyScalar(KEY_SCALE * pop).add(key.spread);
        key.pivot.position.lerpVectors(offset, key.hang, together);
        key.pivot.scale.setScalar(pop);
        if (together >= 1 && dt > 0) [key.swing, key.swingSpeed] = pendulum(key.swing, key.swingSpeed, push * (1 + i * 0.12), dt);
        if (!on) key.swing = key.swingSpeed = 0;
        key.pivot.rotation.z = THREE.MathUtils.lerp(0, REST + key.along * 0.6, together) + key.swing;
        key.pivot.rotation.y = key.turn * together;
        key.pivot.visible = on && key.fade.value > 0.001 && held.value > 0.001;
        // Its arc stays on it as it goes to the ring: each action still linked to its key.
        if (together > 0 && gone.value > 0.001) {
          bunch.updateMatrixWorld();
          drawArc(i, key.pivot.children[0].localToWorld(keyMiddle.copy(keyCentre)));
        }
      });
      if (together > 0 && gone.value > 0.001) positions.needsUpdate = true;

      ringFade.value = on ? smooth(s, gather - 0.4, gather + 0.2) : 0;
      ring.visible = ringFade.value > 0.001;
      bunch.visible = on && held.value > 0.001 && keys.some((k) => k.fade.value > 0.001);
      // The thread: drawn in over its moment, a pulse out from the middle once it is whole;
      // it goes with the arcs, as the ring is taken in hand.
      linkDraw.value = on ? smooth(s, linkAt[0], linkAt[0] + (linkAt[1] - linkAt[0]) * 0.6) : 0;
      const pulsing = on ? (s - (linkAt[0] + (linkAt[1] - linkAt[0]) * 0.6)) / ((linkAt[1] - linkAt[0]) * 0.4) : -1;
      linkPulse.value = pulsing > 0 && pulsing < 1 ? pulsing : -1;
      linkFade.value = on ? smooth(s, linkAt[0] - 0.1, linkAt[0] + 0.2) * (1 - 0.6 * smooth(s, linkAt[1], linkAt[1] + 1)) * gone.value : 0;
      link.visible = linkFade.value > 0.001;
      wave.visible = waveFade.value > 0.001;
      beam.visible = beamFade.value > 0.001;
      arcs.visible = on && s > arcStarts[0] && gone.value > 0.001;
    },
    dispose() {
      flat.dispose();
      beam.geometry.dispose();
      keyGeometry.dispose();
      ringGeometry.dispose();
      rule.geometry.dispose();
      const materials = [
        waveMaterial, beamMaterial, arcMaterial, linkMaterial, ringMaterial, ruleMaterial, ...keys.map((k) => k.material),
      ];
      for (const material of materials) material.dispose();
    },
  };
}
