import * as THREE from 'three/webgpu';
import {
  atan, attribute, clamp, color, cos, exp, float, hash, instanceIndex, length, mix, mx_noise_float, pass, sin,
  smoothstep, uint, uniform, uv, vec3,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createSteering } from './steering';
import { createReward } from './reward';
import { createRelief } from './relief';
import { THROW_FROM, createLevers } from './levers';
import { createWalls } from './walls';
import { noteAt, noteStretch, type Note, type NoteTopic } from './notes';
import { MONITOR_MARKS, createMonitor } from './monitor';
import { createSummit } from './summit';
import type { IconName } from './icons';

/** A note as it stands on screen this frame (see notes.ts and placeNote). */
/** A label in the scene as it stands on screen this frame (see placeTags). */
export interface TagView {
  id: string;
  icons: IconName[];
  caption: string;
  /** Screen positions (-1..1, y up) of the point it is attached to, and of the label itself. */
  gx: number;
  gy: number;
  lx: number;
  ly: number;
  opacity: number;
}

export interface NoteView {
  note: Note;
  /** Screen position of its anchor, -1..1 both ways (y up), as three.js projects it. */
  x: number;
  y: number;
  /** -1: the text ends at the anchor (left of the path); 1: starts there; 0: centred on it. */
  align: -1 | 0 | 1;
  /** Size relative to the base, from the note's depth. */
  scale: number;
  opacity: number;
}
import {
  ACTIVATE_AT, CONTOUR_STEP, END_AT, LANDMARKS, PATH_HALF, PERFORM_AT, STRUCTURE_AT, centerX,
  centerXNode, groundAt, groundNode, heightAt, type Landmark, type TrajectoryPoint,
} from './path';

export type { TrajectoryPoint } from './path';

/**
 * « Le Terrain », the optional epilogue after « Performer ». Loaded on demand
 * (dynamic import) when the visitor presses « Entrer »; it renders its own scene
 * with the story's renderer until the visitor leaves.
 *
 * The camera rides a straight path (-z) behind a glowing guide the visitor steers
 * sideways. The field is a fixed band of particles that recycles under the camera
 * (a treadmill), faded out by distance: there is no world beyond what is visible.
 * Every point of the guide's trajectory is kept, for the reward.
 *
 * Everything that tells the visitor where they are during the ride is tied to the
 * position along the path (a distance, `p` below), never to a timer. The path climbs
 * a ridge from a valley to a summit at « Performer » (path.ts), its sides falling away
 * more and more; it forms as the first landmark comes near and stays laid behind;
 * « Activer » throws levers as they are passed and sends light running ahead, up the
 * slope; « Performer » is the summit, crossed through a ring of light.
 *
 * At the top the ride stops and the ending plays on its own clock, as nothing moves
 * any more: a pause, a half-turn on the spot to look back down over the whole climb
 * (relief.ts), then the eyes rise to the horizon, where the visitor's curve is drawn.
 */

const NAVY = '#0e1726';
const CREAM = '#f4ecdc';
const WARM = '#ffd9a0';

const FIELD_WIDTH = 34;
const FIELD_DEPTH = 64;
/** How far the band reaches behind the guide, so the ground runs under the camera. */
const FIELD_BEHIND = 9;
const SPEED = 7.2; // units per second along the path
// The light can be steered across the path, never off it.
const LATERAL_LIMIT = PATH_HALF - 0.35;
const CAMERA_BACK = 6.5;
const CAMERA_HEIGHT = 2.3;
const GUIDE_HEIGHT = 0.55;
const TRAIL_SAMPLE = 0.05; // seconds between kept trajectory points
const TRAIL_VISIBLE = 220; // most recent points drawn as the ribbon
const TRAIL_WIDTH = 0.018; // half-width at the guide; the ribbon tapers to a thread behind it
const FIREFLIES = 16;

/**
 * Cruising speed on each stretch, as a share of SPEED: before « Structurer », then up to
 * « Activer », then up to « Performer », then the glide on the summit. A little slower over
 * the two stretches between landmarks, where two notes each are read and illustrated in
 * the scene (labels popping up, walls, levers, the monitor).
 */
const STRETCH_SPEED = [1, 0.76, 0.76, 1.24];
/** A landmark's word shows over this stretch of path around it. */
const WORD_BEFORE = 11;
const WORD_AFTER = 5;

const PATH_GATHER = 7; // particles within this distance of the line are drawn into the lane
// « Structurer »: until the visitor nears the landmark the ground is loose particles,
// with no path in it. Over this stretch of their own progress around it, the lane
// forms, from under the light out to the far edge of the field, and stays formed.
const STRUCTURE_FROM = STRUCTURE_AT - 10;
const STRUCTURE_TO = STRUCTURE_AT + 8;
const STRUCTURE_EDGE = 8; // softness of the forming front
// « Activer »: light runs along the lane from the landmark, faster than the guide, towards
// « Performer »; on the way, levers stand on either side of the lane, one after the other,
// and only the right ones are thrown as the guide reaches them (« Les bons leviers. Pas
// tous. », notes.ts, shows over the same stretch).
// Over the stretch of the note on levers (notes.ts): the first chosen one thrown just
// after the note comes in, the last one just as it goes.
const LEVER_STRETCH = noteStretch('levers');
// Chosen levers are thrown a little before the guide reaches them (levers.ts), so the
// row starts a little into the stretch and runs a little past it.
const LEVER_FROM = LEVER_STRETCH.from + 17;
const LEVER_SPACING = (LEVER_STRETCH.to + 8 - LEVER_FROM) / (14 - 1);
const LEVER_THROWN = [false, true, false, false, true, false, true, false, false, true, false, true, false, false];
// Each landmark is marked on the ground by a dial of light around the path.
const DIAL_RADIUS = 3.4;
const RUN_AHEAD = 2.4; // the light covers this much path per unit the guide travels
// « Performer »: the ring stands on the summit; past it, the lane opens out on the top.
const RING_RADIUS = 2.4;
const OPENS_OVER = 22;

// The ending, in seconds after the ride has stopped on the summit, in four distinct times:
// 1. Arrival: the camera settles on the summit, facing ahead, « Performer » still showing.
const PAUSE = [0, 2.4];
// 2. Actions and results: still facing ahead, the note « Chaque résultat relié à une
//    action » (notes.ts) with its badges, each an action and what it produces.
const ACTIONS = [2.6, 8.8]; // with the arcs to the keys, then the key ring (summit.ts)
// 3. The view back: a half-turn on the spot, to look down over the whole climb.
const TURN = [10, 13.6];
// The whole mountain (relief.ts) comes in just before the turn, laid over the same
// ground, so it is already there when the camera turns; the treadmill band only goes
// once the turn is done. Nothing is swapped in view.
const RELIEF_IN = [8.6, 10];
const FIELD_OUT = [13.2, 14.2];
// The light band ahead goes before the turn sweeps it across the view.
const FRONT_HORIZON_OUT = [9.4, 10.4];
// 4. The reveal: after a moment looking down, the eyes rise to the horizon, where the
//    curve draws itself; then the closing choices.
// The key ring, now in hand (summit.ts): taken at the end of the actions, held through the
// half-turn, then, a moment of its own while looking down over the climb, carried across
// from left to right, the keys swaying; lowered out of view before the eyes rise.
const RING_IN_HAND = 8.6;
const RING_SWAY: [number, number] = [14.4, 16.8];
const RING_LOWERED: [number, number] = [17, 17.8];
const LOOK_UP = [17.8, 20];
const CURVE_DRAWN = [18.4, 21.4];
const CHOICES_AT = 21.7;
/** Pitch while looking back down the slope, then on the horizon (radians). */
const LOOK_DOWN_PITCH = -0.47;
const HORIZON_PITCH = -0.3; // low enough that the far half of the climb, deep below, stays in view under the curve
/** On the summit the eye stands a little higher, for the view. */
const SUMMIT_EYE = CAMERA_HEIGHT + 2.2;
/**
 * During the half-turn the eye also rises above the summit. Seen from just above the
 * ground, the whole slope lies in a thin band near the horizon; from higher up it spreads
 * down the view, the start far below, the bends in between, the top close under the eye.
 */
const TURN_RISE = 24;
/**
 * Looking back from the top, the mountain below deepens to this (its drop from the
 * summit multiplied, relief.ts), over the second half of the turn, once the ridden band
 * is out of sight: the start ends far down, the path descending to it in its bends.
 */
const DEPTH = 2.3;
/** Field of view: widened while looking down from the top (a stronger plunge), back for the curve. */
const FOV = 50;
const LOOK_DOWN_FOV = 64;
const DEEPEN = [11.2, 14.2];

const smooth = THREE.MathUtils.smoothstep;

/**
 * Every stretch between landmarks reads in the same order (notes.ts): the landmark's title,
 * then the note alone, then its badges (from BADGES_AT of the note's stretch), then what
 * illustrates it in the scene (from SCENE_AT). The note is always read first.
 */
const BADGES_AT = 0.3;
const SCENE_AT = 0.42;
/** The guide distance at a share of a note's stretch. */
const along = (topic: NoteTopic, share: number) => {
  const { from, to } = noteStretch(topic);
  return from + (to - from) * share;
};

/** 0..1: how far a ride note is shown at this distance (its fades included), for what illustrates it. */
const noteEnvelope = (topic: NoteTopic, distance: number) => {
  const { from, to } = noteStretch(topic);
  if (distance < from || distance >= to) return 0;
  const t = (distance - from) / (to - from);
  return smooth(t, 0, 0.16) * (1 - smooth(t, 0.84, 1));
};

// Notes (notes.ts): how far beside the path they stand, and how high; on narrow screens
// they stand over the path, a little higher. At the reference depth they show at base size.
const NOTE_BESIDE = 5;
const NOTE_HEIGHT = 2.6;
const NOTE_OVER = 4.2;
const NOTE_REFERENCE_DEPTH = 20;

export interface TerrainOptions {
  renderer: THREE.WebGPURenderer;
  /** Particles in the field, from the quality tier. */
  fieldCount: number;
  /** Element that receives the steering gestures (pointer, touch). */
  surface: HTMLElement;
  /** Called with a landmark's word as it comes up, and with null once it has gone. */
  onWord?: (landmark: Landmark | null) => void;
  /** Called with a note for the side of the path as it comes up (notes.ts), and with null once it has gone. */
  onNote?: (view: NoteView | null) => void;
  /** Called every frame with the labels to show in the scene (possibly none). */
  onTags?: (views: TagView[]) => void;
  /** Called once the growth curve has formed: time to offer the closing choices. */
  onEnd?: () => void;
}

export async function createTerrain({ renderer, fieldCount, surface, onWord, onNote, onTags, onEnd }: TerrainOptions) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(NAVY);
  // Far enough to see the whole climb back down from the summit, and the horizon beyond.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 700);

  const travel = uniform(0); // distance along the path; the guide sits at z = -travel
  const time = uniform(0);
  /** How far along the path the light set off by « Activer » has run. */
  const runFront = uniform(-1000);
  /** Brief swell of light while crossing « Performer ». */
  const arrival = uniform(0);
  /** The treadmill band gives way to the fixed relief (relief.ts) when turning round at the top. */
  const fieldShown = uniform(1);

  // ---- Field: a band of particles, laid on a jittered grid, recycled as the path goes by.
  const cols = Math.max(8, Math.round(Math.sqrt((fieldCount * FIELD_WIDTH) / FIELD_DEPTH)));
  const rows = Math.max(8, Math.floor(fieldCount / cols));
  const count = cols * rows;
  const col = instanceIndex.mod(uint(cols)).toFloat();
  const row = instanceIndex.div(uint(cols)).toFloat();
  // Distance ahead of the guide: shrinks as the path goes on, wraps from just behind
  // the camera back to the far edge, where the haze hides the jump.
  const aheadOf = (fieldRow: THREE.Node<'float'>) =>
    float(1).sub(fieldRow.div(rows).mul(FIELD_DEPTH).add(travel).div(FIELD_DEPTH).fract()).mul(FIELD_DEPTH).sub(FIELD_BEHIND);
  const looseX = col.add(hash(instanceIndex).sub(0.5).mul(0.8)).div(cols).sub(0.5).mul(FIELD_WIDTH);
  const ahead = aheadOf(row.add(hash(instanceIndex.add(uint(count))).mul(0.9)));
  const looseZ = travel.negate().sub(ahead);
  /** This particle's distance along the path. */
  const p = looseZ.negate();

  // The lane: it forms as the visitor reaches « Structurer », behind a front that runs
  // from the light out to the horizon (set each frame from their progress, see
  // structureFront); behind the visitor it stays. Past « Performer » it opens out.
  const structureFront = uniform(-1000);
  const formed = smoothstep(structureFront, structureFront.sub(STRUCTURE_EDGE), p);
  const opened = smoothstep(PERFORM_AT, PERFORM_AT + OPENS_OVER, p);
  const gridX = col.add(0.5).div(cols).sub(0.5).mul(FIELD_WIDTH);
  const nearLine = smoothstep(PATH_GATHER, PATH_GATHER * 0.4, gridX.abs());
  const ordered = formed.mul(smoothstep(PATH_GATHER + 3, PATH_GATHER, gridX.abs()));
  const placedX = mix(looseX, gridX, ordered);
  const gathered = formed.mul(nearLine).mul(float(1).sub(opened));
  const fieldX = placedX.mul(mix(1, PATH_HALF / PATH_GATHER, gathered));
  const gridZ = travel.negate().sub(aheadOf(row.add(0.45)));
  const fieldZ = mix(looseZ, gridZ, ordered);
  /** 1 on the lane itself. */
  const lane = formed.mul(smoothstep(PATH_HALF + 0.4, PATH_HALF - 0.2, fieldX.abs()));

  // « Comprendre avant de proposer » (notes.ts): while it shows, light sweeps over the
  // ground on both sides of the path, out ahead, again and again: the terrain examined
  // before anything is built on it.
  const scanAmount = uniform(0);
  const scanAt = uniform(-1000);
  const scanBand = p.sub(scanAt).div(1.4);
  const scan = exp(scanBand.mul(scanBand).negate())
    .mul(smoothstep(PATH_HALF + 0.4, PATH_HALF + 1.2, fieldX.abs())).mul(smoothstep(17.5, 12, fieldX.abs()))
    .mul(scanAmount);

  // « Activer »: the light running along the lane, with pulses that travel forward.
  const lit = lane.mul(smoothstep(ACTIVATE_AT - 1, ACTIVATE_AT + 1, p)).mul(smoothstep(runFront.add(3), runFront.sub(1), p));
  const pulses = sin(p.mul(0.9).sub(time.mul(7))).mul(0.5).add(0.5).pow(3);
  const energy = lit.mul(pulses.mul(0.7).add(0.3));

  // The band follows the route's bends (path.ts): fieldX is the offset from its centre line.
  const worldX = centerXNode(p).add(fieldX);
  // The climb: every particle sits on the mountain, so the band climbs with the route,
  // and away from it the ground falls off down the mountain's flanks.
  const groundHeight = groundNode(worldX, fieldZ);
  // Contour lines: a little brighter every CONTOUR_STEP of height, as on a relief map,
  // the same lines that draw the mountain when seen from the top (relief.ts).
  const contour = smoothstep(0.78, 1, groundHeight.div(CONTOUR_STEP).fract())
    .mul(float(1).sub(lane));
  // Gentle swell, from world coordinates, so recycled particles land on the same wave.
  // It settles where the field is ordered.
  const swell = sin(worldX.mul(0.32).add(time.mul(0.7))).mul(cos(fieldZ.mul(0.21).add(time.mul(0.45)))).mul(0.22)
    .add(mx_noise_float(vec3(worldX.mul(0.18), fieldZ.mul(0.18), time.mul(0.12))).mul(0.16))
    .mul(float(1).sub(ordered.mul(0.85)));
  const fieldMaterial = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  fieldMaterial.positionNode = vec3(worldX, swell.add(groundHeight), fieldZ);
  // Far: lost in the haze. Near: thinned out so the ground does not crowd the camera.
  const haze = smoothstep(FIELD_DEPTH - FIELD_BEHIND, (FIELD_DEPTH - FIELD_BEHIND) * 0.45, ahead);
  const near = smoothstep(-FIELD_BEHIND, -FIELD_BEHIND + 4, ahead);
  const crest = smoothstep(-0.1, 0.3, swell);
  // The lane reads a touch warmer than the field; lit stretches and the crest glow.
  const warmth = crest.mul(0.35).add(lane.mul(0.25)).add(energy.mul(0.8)).add(opened.mul(0.3)).add(scan.mul(0.7)).min(1);
  // The sweep (« Comprendre avant de proposer ») lights the particles it passes, and swells them.
  fieldMaterial.colorNode = mix(color(CREAM), color(WARM), warmth).mul(float(1).add(scan.mul(2.2)));
  const disc = clamp(float(1).sub(length(uv().sub(0.5)).mul(2)), 0, 1);
  const glow = float(1).add(lane.mul(0.25)).add(energy.mul(1.2)).add(arrival.mul(0.7)).add(contour.mul(0.9)).add(scan.mul(2.2));
  fieldMaterial.opacityNode = disc.mul(disc).mul(0.6).mul(haze).mul(near).mul(glow).min(1).mul(fieldShown);
  fieldMaterial.scaleNode = float(0.045).add(hash(instanceIndex.add(uint(count * 2))).pow(5).mul(0.08)).mul(scan.mul(1.3).add(1));
  const field = new THREE.Sprite(fieldMaterial);
  field.count = count;
  field.frustumCulled = false;
  scene.add(field);

  // ---- Horizon: a soft band of light low in the sky, always at the far edge of the field.
  const horizonMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const band = uv().y.sub(0.5).mul(9);
  // « Performer »: past the crest, the horizon rises and brightens.
  const rise = uniform(0);
  horizonMaterial.colorNode = color(WARM).mul(rise.mul(0.35).add(0.55));
  const horizonShown = uniform(1);
  horizonMaterial.opacityNode = exp(band.mul(band).negate()).mul(smoothstep(0, 0.25, uv().x)).mul(smoothstep(1, 0.75, uv().x))
    .mul(horizonShown);
  const horizon = new THREE.Mesh(new THREE.PlaneGeometry(260, 24), horizonMaterial);
  scene.add(horizon);

  // Soft additive light, for the beacons, levers and ring.
  const lightMaterial = (opacity: THREE.Node<'float'>, strength: THREE.Node<'float'> | number = 1.3) => {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    material.colorNode = color(WARM).mul(strength);
    material.opacityNode = opacity;
    return material;
  };

  // ---- Beacons for « Structurer » and « Activer »: a column of light on the path.
  const beacons = [STRUCTURE_AT, ACTIVATE_AT].map((at) => {
    const fade = uniform(0);
    const across = uv().x.sub(0.5).mul(6);
    const material = lightMaterial(exp(across.mul(across).negate()).mul(smoothstep(1, 0.1, uv().y)).mul(fade), 1.7);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 12), material);
    mesh.position.set(centerX(at), 6 + heightAt(at), -at);
    scene.add(mesh);
    return { at, mesh, material, fade };
  });

  // ---- A dial on the ground at each landmark: a dashed ring of light that turns slowly,
  // an inner ring, and pulses running out from the path, laid flat on the slope. It shows
  // the landmark coming from afar, and flares as the guide crosses it.
  const dials = LANDMARKS.map(({ at }, i) => {
    const fade = uniform(0);
    const cross = uniform(0);
    const centre = uv().sub(0.5);
    const r = centre.length().mul(2);
    const turn = atan(centre.y, centre.x).div(Math.PI * 2).add(0.5);
    const dashes = smoothstep(0.5, 0.4, turn.mul(36).add(time.mul(i % 2 ? -0.12 : 0.12)).fract());
    const band = (radius: THREE.Node<'float'> | number, width: number) => exp(r.sub(radius).mul(width).pow(2).negate());
    const wave = time.mul(0.45).fract();
    const pulse = band(wave, 16).mul(float(1).sub(wave));
    const glow = band(0.9, 26).mul(dashes).add(band(0.66, 40).mul(0.45)).add(pulse.mul(0.6))
      .mul(r.lessThan(1).select(float(1), float(0)));
    const material = lightMaterial(glow.mul(fade).mul(cross.mul(1.6).add(1)), 1.5);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(DIAL_RADIUS * 2, DIAL_RADIUS * 2), material);
    // Flat on the slope: the ground's normal at the landmark, from its height around it.
    const x = centerX(at);
    const z = -at;
    const normal = new THREE.Vector3(
      groundAt(x - 0.5, z) - groundAt(x + 0.5, z),
      1,
      groundAt(x, z - 0.5) - groundAt(x, z + 0.5),
    ).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.position.set(x, groundAt(x, z), z).addScaledVector(normal, 0.14);
    scene.add(mesh);
    return { at, mesh, material, fade, cross };
  });

  // ---- Each note on the way is shown in the scene as well, as it comes in (notes.ts):
  // « Clarifier les fondations »: foundation walls along the path, built from there up to
  // « Performer » as the visitor climbs (walls.ts), left open around « Activer »'s dial.
  const foundations = noteStretch('foundations');
  const walls = createWalls(scene, {
    startAt: along('foundations', SCENE_AT),
    from: along('foundations', SCENE_AT) + 12,
    to: PERFORM_AT - DIAL_RADIUS - 1.2,
    gaps: [[ACTIVATE_AT - DIAL_RADIUS - 1.2, ACTIVATE_AT + DIAL_RADIUS + 1.2]],
    offset: PATH_HALF + 1.5,
  });
  // « Les bons leviers. Pas tous. »: levers beside the lane, the chosen ones thrown in turn (levers.ts).
  const levers = createLevers(scene, {
    from: LEVER_FROM, spacing: LEVER_SPACING, chosen: LEVER_THROWN, offset: PATH_HALF + 0.75,
  });
  // « Mesurer pour décider »: a monitoring screen in particles beside the path, its curve
  // tracing itself while the note shows (monitor.ts); across from the note, outside the walls.
  const measure = noteStretch('measure');
  const monitor = createMonitor(scene, {
    lead: 13, side: 1, offset: PATH_HALF + 4.2, from: measure.from, to: measure.to,
  });

  // ---- Labels popping up in the scene with each note (see TagView): pictograms and the
  // channels' marks (icons.ts) with a few words naming them, each on a dotted thread from
  // the point it belongs to. What they show follows keysperformance.com (home page and « Accompagnements »):
  // what is looked at first, the foundations Structurer clarifies, the levers Activer
  // deploys, what Performer measures.
  interface Tag {
    id: string;
    /** Marked in the scene too: a ring of light on the ground where it stands, after the badge. */
    marker?: boolean;
    icons: IconName[];
    /** A few words naming what the icons show. */
    caption: string;
    ground: () => THREE.Vector3;
    lift: number;
    strength: (distance: number, sinceStop: number | null) => number;
  }
  /** Shown from `appear` (popping in) until `end` along the ride. */
  const onRide = (appear: number, end: number) => (d: number, s: number | null) =>
    s !== null ? 0 : smooth(d, appear, appear + 0.8) * (1 - smooth(d, end - 1.5, end));
  /** A point on the ground beside the route, at distance p, `lateral` from its centre line. */
  const besidePath = (p: number, lateral: number) => {
    const x = centerX(p) + lateral;
    return new THREE.Vector3(x, groundAt(x, -p), -p);
  };
  const tags: Tag[] = [];
  // « Comprendre avant de proposer »: look closely, what blocks, what already works; in
  // the swept ground, on either side.
  const understand = noteStretch('understand');
  // Close to the route (whether its lane has formed yet or not), a little ahead.
  ([['search', 'Votre situation'], ['alert', 'Ce qui bloque'], ['check', 'Ce qui fonctionne']] as [IconName, string][]).forEach(([icon, caption], i) => {
    const appear = along('understand', BADGES_AT) + i * 3.4;
    const place = besidePath(appear + 12, (i % 2 ? 1 : -1) * 4.4);
    tags.push({ id: `understand-${i}`, marker: true, icons: [icon], caption, ground: () => place, lift: 1.3, strength: onRide(appear, understand.to + 1) });
  });
  // « Clarifier les fondations »: positioning and targets, priorities, journey, roadmap;
  // on the walls, as they build.
  ([['target', 'Positionnement'], ['priorities', 'Priorités'], ['route', 'Parcours'], ['roadmap', 'Feuille de route']] as [IconName, string][]).forEach(([icon, caption], i) => {
    const appear = along('foundations', BADGES_AT) + i * 3.2;
    const place = besidePath(appear + 13, (i % 2 ? 1 : -1) * (PATH_HALF + 1.5));
    // Heights staggered, so two on the same side, seen from afar, never overlap.
    tags.push({ id: `foundations-${i}`, marker: true, icons: [icon], caption, ground: () => place.clone().setY(place.y + 0.66), lift: 1 + (i >> 1) * 0.9, strength: onRide(appear, foundations.to + 1) });
  });
  // « Les bons leviers. Pas tous. »: each chosen lever shown as it is thrown, with the
  // channels it stands for: content, social media, influence, paid acquisition, CRM.
  ([
    [['camera'], 'Contenu'],
    [['instagram', 'facebook'], 'Social media'],
    [['influence'], 'Influence'],
    [['google', 'meta'], 'Campagnes Ads'],
    [['mail'], 'CRM & fidélisation'],
  ] as [IconName[], string][]).forEach(([icons, caption], i) => {
    const lever = levers.chosenPlaces()[i];
    if (!lever) return;
    tags.push({
      id: `levers-${i}`, icons, caption, ground: () => lever.place.clone().setY(lever.place.y + 1.05), lift: 0.8 + (i % 3) * 0.8,
      // Named just before it is thrown. The last one (CRM) is still in view when « Mesurer
      // pour décider » comes in: it goes, smoothly, just before, rather than being pushed
      // aside by the note while it fades.
      strength: onRide(lever.at - THROW_FROM - 1.5, caption === 'CRM & fidélisation' ? measure.from : LEVER_STRETCH.to + 5),
    });
  });
  // « Mesurer pour décider »: on the monitor, the indicators set first (on its target
  // line), then the evolution followed, then what to strengthen.
  tags.push({
    id: 'measure-target', icons: ['gauge'], caption: 'Indicateurs', ground: () => monitor.targetEnd(), lift: 0.4,
    strength: (d, s) => onRide(along('measure', BADGES_AT), measure.to + 2)(d, s) * Math.min(1, monitor.shown * 1.5),
  });
  ([['eye', 'Suivi', MONITOR_MARKS[1]], ['trend', 'Renforcer', MONITOR_MARKS[3]]] as [IconName, string, number][]).forEach(([icon, caption, t], i) => {
    tags.push({
      id: `measure-${i}`, icons: [icon], caption, ground: () => monitor.curvePoint(t), lift: 0.55,
      strength: (d, s) => onRide(monitor.distanceAt(t), measure.to + 2)(d, s) * monitor.shown,
    });
  });
  /** Where the i-th action badge stands on the summit, ahead of the camera. */
  const summitBadgeGround = (i: number) => {
    const p = distance + 16;
    const x = centerX(p) + (i - 1) * 6;
    return new THREE.Vector3(x, groundAt(x, -p), -p);
  };
  /** When the i-th action badge has come in (seconds after the stop). */
  const summitBadgeAt = (i: number) => ACTIONS[0] + 1.2 + i * 0.7;
  // On the summit, still facing ahead, with « Chaque résultat relié à une action »: each
  // badge an action and what it produces, as the site's « Activer » puts it (« de la
  // visibilité gagnée… », « une acquisition… », « une base client en propre »), standing
  // in a row over the top, one after the other.
  ([
    [['camera', 'arrow', 'eye'], 'Contenu → Visibilité'],
    [['google', 'meta', 'arrow', 'trend'], 'Campagnes Ads → Acquisition'],
    [['mail', 'arrow', 'users'], 'CRM → Base client'],
  ] as [IconName[], string][]).forEach(([icons, caption], i) => {
    tags.push({
      id: `summit-${i}`, icons, caption,
      ground: () => summitBadgeGround(i),
      lift: 2.2,
      strength: (_d, s) => (s === null ? 0
        : smooth(s, summitBadgeAt(i) - 0.25, summitBadgeAt(i) + 0.25) * (1 - smooth(s, ACTIONS[1] - 0.5, ACTIONS[1]))),
    });
  });
  // The arrival's wave and column, and the arcs from each action badge to the result (summit.ts).
  const summit = createSummit(scene, { badgesAt: [0, 1, 2].map(summitBadgeAt) });
  const summitTop = new THREE.Vector3();
  const summitHere = new THREE.Vector3();
  // Rings of light on the ground under the badges that stand on the terrain (what is
  // examined, the foundations laid): each comes in just after its badge, a ring with a pulse
  // running out of it, so the badge is anchored in the scene.
  const markerGeometry = new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2);
  const markers = tags.filter((tag) => tag.marker).map((tag) => {
    const fade = uniform(0);
    const r = uv().sub(0.5).length().mul(2);
    const ring = (radius: THREE.Node<'float'> | number, width: number) => exp(r.sub(radius).mul(width).pow(2).negate());
    const wave = time.mul(0.7).fract();
    const glow = ring(0.42, 22).add(ring(wave, 14).mul(float(1).sub(wave)).mul(0.7)).add(ring(0, 9).mul(0.8))
      .mul(r.lessThan(1).select(float(1), float(0)));
    const material = lightMaterial(glow.mul(fade), 1.4);
    const mesh = new THREE.Mesh(markerGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    return { tag, mesh, material, fade };
  });
  const tagGround = new THREE.Vector3();
  const tagLabel = new THREE.Vector3();
  const tagDepth = new THREE.Vector3();
  let tagsShown = false;

  // ---- « Performer »: a ring of light standing on the crest, crossed by the camera.
  const ringFade = uniform(0);
  const ringRadius = uv().sub(0.5).length().mul(2); // 0 centre .. 1 edge of the plane
  const ringBand = ringRadius.sub(0.92).mul(30);
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(RING_RADIUS * 2.2, RING_RADIUS * 2.2),
    lightMaterial(exp(ringBand.mul(ringBand).negate()).mul(ringFade), 1.6),
  );
  ring.position.set(0, heightAt(PERFORM_AT) + CAMERA_HEIGHT - 0.3, -PERFORM_AT);
  scene.add(ring);

  // ---- Guide: the light the visitor steers.
  const guideMaterial = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  guideMaterial.colorNode = color(WARM).mul(1.6);
  guideMaterial.opacityNode = disc.pow(1.6);
  const guide = new THREE.Sprite(guideMaterial);
  guide.scale.setScalar(0.55);
  scene.add(guide);

  // ---- Trail: a ribbon over the most recent trajectory points, brighter while steering.
  const trajectory: TrajectoryPoint[] = [];
  const trailPositions = new Float32Array(TRAIL_VISIBLE * 2 * 3);
  const trailFade = new Float32Array(TRAIL_VISIBLE * 2);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setAttribute('trailFade', new THREE.BufferAttribute(trailFade, 1).setUsage(THREE.DynamicDrawUsage));
  // -1 on one edge of the ribbon, +1 on the other: interpolated across, it gives a soft
  // falloff from a bright centre line to transparent edges.
  const trailSide = new Float32Array(TRAIL_VISIBLE * 2);
  for (let i = 0; i < TRAIL_VISIBLE; i++) trailSide.set([-1, 1], i * 2);
  trailGeometry.setAttribute('trailSide', new THREE.BufferAttribute(trailSide, 1));
  const trailIndex: number[] = [];
  for (let i = 0; i < TRAIL_VISIBLE - 1; i++) {
    const a = i * 2;
    trailIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeometry.setIndex(trailIndex);
  const trailGlow = uniform(0);
  /** The trail and guide give way to the curve at the end. */
  const trailShown = uniform(1);
  const trailMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  trailMaterial.colorNode = color(WARM).mul(trailGlow.mul(0.8).add(0.5));
  const edge = float(1).sub(attribute('trailSide', 'float').abs());
  trailMaterial.opacityNode = attribute('trailFade', 'float').mul(edge.mul(edge)).mul(trailShown);
  const trail = new THREE.Mesh(trailGeometry, trailMaterial);
  trail.frustumCulled = false;
  scene.add(trail);

  // ---- Fireflies: the last of the door's light, leaving for the horizon as the scene appears.
  const fireflies = Array.from({ length: FIREFLIES }, (_, i) => {
    const sprite = new THREE.Sprite(guideMaterial);
    const seed = (i * 0.618034) % 1;
    return {
      sprite,
      from: new THREE.Vector3((seed - 0.5) * 3, 0.6 + ((i * 0.37) % 1) * 1.6, 0),
      drift: new THREE.Vector3((seed - 0.5) * 14, 2 + ((i * 0.53) % 1) * 4, -FIELD_DEPTH * (0.55 + ((i * 0.29) % 1) * 0.35)),
      delay: ((i * 0.41) % 1) * 1.2,
      size: 0.12 + ((i * 0.73) % 1) * 0.12,
    };
  });
  for (const f of fireflies) scene.add(f.sprite);

  // ---- Rendering, with a soft bloom for the light (the Terrain only runs on capable tiers).
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const glowPass = bloom(sceneColor, 0.6, 0.5, 0.6);
  const pipeline = new THREE.RenderPipeline(renderer, sceneColor.add(glowPass));

  const relief = createRelief(scene, Math.round(fieldCount * 0.7));
  const reward = createReward(scene);
  const steering = createSteering(surface, LATERAL_LIMIT);
  const look = new THREE.Vector3();
  const summitEye = new THREE.Vector3();
  const gaze = new THREE.Vector3();
  /** Seconds into the Terrain when the ride stopped; null while riding. */
  let endedAt: number | null = null;
  let endAnnounced = false;
  let curvePlaced = false;
  let elapsed = 0;
  let distance = 0;
  let lateral = 0;
  let lateralSpeed = 0;
  let sampleClock = 0;
  let width = 0;
  let height = 0;
  let speed = SPEED;
  let word: string | null = null;
  let noteShown = false;
  const noteAnchor = new THREE.Vector3();
  const noteDepth = new THREE.Vector3();

  const placeTrail = () => {
    const recent = trajectory.slice(-TRAIL_VISIBLE);
    for (let i = 0; i < TRAIL_VISIBLE; i++) {
      // Unused slots collapse onto the oldest point, with no opacity.
      const point = recent[Math.max(0, i - (TRAIL_VISIBLE - recent.length))] ?? { x: lateral, d: distance };
      const used = i >= TRAIL_VISIBLE - recent.length;
      const age = (TRAIL_VISIBLE - 1 - i) / (TRAIL_VISIBLE - 1);
      const fade = used ? (1 - age) ** 2 * 0.9 : 0;
      for (let side = 0; side < 2; side++) {
        const v = (i * 2 + side) * 3;
        const x = centerX(point.d) + point.x;
        trailPositions[v] = x + (side ? TRAIL_WIDTH : -TRAIL_WIDTH) * (1 - age * 0.85);
        trailPositions[v + 1] = GUIDE_HEIGHT - 0.25 + groundAt(x, -point.d);
        trailPositions[v + 2] = -point.d;
        trailFade[i * 2 + side] = fade;
      }
    }
    // The newest point follows the guide itself, so the ribbon stays attached to it.
    for (let side = 0; side < 2; side++) {
      const v = ((TRAIL_VISIBLE - 1) * 2 + side) * 3;
      trailPositions[v] = centerX(distance) + lateral + (side ? TRAIL_WIDTH : -TRAIL_WIDTH);
      trailPositions[v + 1] = GUIDE_HEIGHT - 0.25 + groundAt(centerX(distance) + lateral, -distance);
      trailPositions[v + 2] = -distance;
    }
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.trailFade.needsUpdate = true;
  };

  const frame = (dt: number) => {
    elapsed += dt;
    // A little faster after each landmark, eased in; at the end, a glide to a stop.
    const passed = LANDMARKS.filter((landmark) => distance >= landmark.at).length;
    if (endedAt === null && distance >= END_AT) startReward();
    const cruise = endedAt === null ? SPEED * STRETCH_SPEED[passed] : 0;
    speed = THREE.MathUtils.damp(speed, cruise, endedAt === null ? 1.2 : 2.5, dt);
    distance += speed * dt;
    travel.value = distance;
    time.value = elapsed;

    // Beacons: out of the haze as they come, thinning out on the last stretch so the
    // guide passes through where they stood, and not so early that they cross the
    // previous landmark's word.
    // Looking back from the summit, the landmarks show again, down the slope.
    const lookingBack = endedAt === null ? 0 : smooth(elapsed - endedAt, RELIEF_IN[0], RELIEF_IN[1]);
    for (const beacon of beacons) {
      const left = beacon.at - distance;
      beacon.fade.value = Math.max(
        smooth(left, 3, 14) * (1 - smooth(left, FIELD_DEPTH * 0.4, FIELD_DEPTH * 0.6)),
        lookingBack * 0.75,
      );
    }
    // Dials: from afar, until just past; a flare as the guide crosses. Not in the view back.
    for (const dial of dials) {
      const left = dial.at - distance;
      dial.fade.value = smooth(left, -9, -2) * (1 - smooth(left, 42, 56)) * (1 - lookingBack);
      dial.cross.value = Math.exp(-((left / 3) ** 2));
      dial.mesh.visible = dial.fade.value > 0.001;
    }
    // Levers: seen from a little way off; only the chosen ones are thrown, as the guide reaches them.
    levers.update(distance, lookingBack);
    walls.update(distance);
    monitor.update(distance);
    // The ground sweep while « Comprendre avant de proposer » shows, faded in and out with it.
    // After the note and its badges have come in.
    scanAmount.value = noteEnvelope('understand', distance) * smooth(distance, along('understand', SCENE_AT), along('understand', SCENE_AT) + 2);
    scanAt.value = distance + 5 + ((elapsed * 0.6) % 1) * 26;
    // « Structurer »: the lane's forming front, tied to the visitor's progress. Before the
    // landmark it stays behind the camera (nothing formed); over STRUCTURE_FROM..TO it
    // sweeps out past the far edge of the field, where it then stays.
    const structuring = smooth(distance, STRUCTURE_FROM, STRUCTURE_TO);
    structureFront.value = distance - FIELD_BEHIND - 2 + structuring * (FIELD_DEPTH + STRUCTURE_EDGE + 4);
    // The light set off at « Activer » runs ahead of the guide, up the slope.
    runFront.value = distance < ACTIVATE_AT ? -1000 : ACTIVATE_AT + (distance - ACTIVATE_AT) * RUN_AHEAD;
    // « Performer »: the ring shows from afar and fades as it is crossed; a swell of
    // light on crossing; then the horizon rises.
    const toRing = PERFORM_AT - distance;
    ringFade.value = smooth(toRing, -1.5, 2) * (1 - smooth(toRing, FIELD_DEPTH * 0.45, FIELD_DEPTH * 0.65));
    arrival.value = smooth(distance, PERFORM_AT - 1, PERFORM_AT + 0.5) * (1 - smooth(distance, PERFORM_AT + 1, PERFORM_AT + 16));
    // Arriving on the summit, the light swells once more.
    const arriving = endedAt === null ? 0 : Math.exp(-(((elapsed - endedAt - 0.6) / 0.7) ** 2));
    glowPass.strength.value = 0.6 + arrival.value * 0.9 + arriving * 0.4;
    rise.value = smooth(distance, PERFORM_AT - 4, PERFORM_AT + 22);

    // One word at a time, over a stretch of path around its landmark.
    // Once the ride has stopped, the summit speaks for itself: no more words.
    // « Performer » stays while the camera settles on the summit, so the faster ride
    // does not cut it short; then the summit speaks for itself.
    const showing = endedAt === null
      ? LANDMARKS.find((l, i) => distance >= l.at - WORD_BEFORE
        // The last one stays until the stop, then through the pause (below): no gap between.
        && (distance < l.at + WORD_AFTER || i === LANDMARKS.length - 1))
      : elapsed - endedAt < PAUSE[1] ? LANDMARKS[LANDMARKS.length - 1] : undefined;
    const next = showing?.word ?? null;
    if (next !== word) {
      word = next;
      onWord?.(showing ?? null);
    }

    const target = steering.update(dt);
    const before = lateral;
    lateral = THREE.MathUtils.damp(lateral, target, 4, dt);
    lateralSpeed = THREE.MathUtils.damp(lateralSpeed, Math.abs(lateral - before) / Math.max(dt, 1e-4), 6, dt);
    trailGlow.value = Math.min(1, lateralSpeed / 2.5);

    sampleClock += dt;
    if (sampleClock >= TRAIL_SAMPLE) {
      sampleClock = 0;
      trajectory.push({ x: lateral, d: distance });
    }
    placeTrail();

    const guideX = centerX(distance) + lateral;
    const bob = Math.sin(elapsed * 2.2) * 0.06;
    guide.position.set(guideX, GUIDE_HEIGHT + groundAt(guideX, -distance) + bob, -distance);
    horizon.position.set(
      centerX(distance) + lateral * 0.3,
      1.2 + heightAt(distance) + rise.value * 2.2,
      -distance - FIELD_DEPTH + FIELD_BEHIND - 2,
    );

    for (const f of fireflies) {
      const t = THREE.MathUtils.clamp((elapsed - f.delay) / 4.5, 0, 1);
      const eased = 1 - (1 - t) ** 2;
      f.sprite.visible = t < 1;
      f.sprite.position.copy(f.from).addScaledVector(f.drift, eased);
      f.sprite.position.x += centerX(distance);
      f.sprite.position.z += -distance;
      f.sprite.scale.setScalar(f.size * (1 - t * 0.6) * Math.min(1, t * 6 + 0.2));
    }

    // The camera follows the guide from behind and above, easing into its sideways
    // moves; on the slope it looks up the ground ahead, then levels out at the crest.
    // Through the bends it stays on the route, behind the guide, and looks along it.
    const behind = distance - CAMERA_BACK;
    camera.position.set(centerX(behind) + lateral * 0.55, CAMERA_HEIGHT + heightAt(distance - CAMERA_BACK * 0.5), -behind);
    look.set(centerX(distance + 12) + lateral * 0.8, 0.5 + heightAt(distance + 12), -distance - 12);

    if (endedAt !== null) playEnding(elapsed - endedAt);
    camera.lookAt(look);
    if (endedAt !== null && elapsed - endedAt < ACTIONS[0]) {
      // Laid out where the ride came to rest (it glides a little after the stop).
      const p = distance + 20;
      summitTop.set(centerX(p), groundAt(centerX(p), -p) + 9, -p);
      summitHere.set(centerX(distance), heightAt(distance), -distance);
      summit.place(summitHere, [0, 1, 2].map(summitBadgeGround), summitTop);
    }
    summit.update(endedAt === null ? null : elapsed - endedAt, camera, ACTIONS[0], {
      hand: RING_IN_HAND, sway: RING_SWAY, lower: RING_LOWERED,
    });
    placeNote();
    placeTags();
  };

  /**
   * The note of the moment, if any, set in the scene: it stands at a point beside the
   * path (or over the start, on the summit), and is drawn where that point is on screen,
   * a little larger as it comes closer, so it travels with the ground rather than sitting
   * on the screen. It fades in from the distance and out before it is passed.
   */
  /** The labels of the moment, where their points are on screen this frame. */
  function placeTags() {
    const sinceStop = endedAt === null ? null : elapsed - endedAt;
    // The rings come a moment after their badges (as if the badge drew them).
    for (const marker of markers) {
      marker.fade.value = marker.tag.strength(distance - 1.8, sinceStop);
      marker.mesh.visible = marker.fade.value > 0.01;
      if (marker.mesh.visible) marker.mesh.position.copy(marker.tag.ground()).setY(marker.tag.ground().y + 0.06);
    }
    const views: TagView[] = [];
    camera.updateMatrixWorld();
    for (const tag of tags) {
      const opacity = tag.strength(distance, sinceStop);
      if (opacity < 0.01) continue;
      tagGround.copy(tag.ground());
      tagLabel.copy(tagGround).setY(tagGround.y + tag.lift);
      const depth = -tagDepth.copy(tagLabel).applyMatrix4(camera.matrixWorldInverse).z;
      if (depth < 1) continue;
      tagGround.project(camera);
      tagLabel.project(camera);
      if (Math.abs(tagLabel.x) > 1.05 || Math.abs(tagLabel.y) > 1.05) continue;
      views.push({ id: tag.id, icons: tag.icons, caption: tag.caption, gx: tagGround.x, gy: tagGround.y, lx: tagLabel.x, ly: tagLabel.y, opacity });
    }
    if (views.length || tagsShown) onTags?.(views);
    tagsShown = views.length > 0;
  }

  function placeNote() {
    const state = noteAt(distance, endedAt === null ? null : elapsed - endedAt);
    if (!state) {
      if (noteShown) onNote?.(null);
      noteShown = false;
      return;
    }
    const { note, at, t } = state;
    // Portrait screens have no room beside the path: the note stands over it instead.
    const narrow = camera.aspect < 0.9;
    const side = narrow ? 0 : note.side;
    if (at === null) {
      // On the summit: over the start, far below, as it is when looking back.
      // On the summit, before the turn: over the top, ahead of the camera.
      noteAnchor.set(centerX(distance + 18), heightAt(distance) + SUMMIT_EYE + 3.2, -distance - 18);
    } else {
      noteAnchor.set(centerX(at) + side * NOTE_BESIDE, heightAt(at) + (side === 0 ? NOTE_OVER : NOTE_HEIGHT), -at);
    }
    camera.updateMatrixWorld();
    const depth = noteDepth.copy(noteAnchor).applyMatrix4(camera.matrixWorldInverse).z * -1;
    noteAnchor.project(camera);
    if (depth <= 0.5) {
      if (noteShown) onNote?.(null);
      noteShown = false;
      return;
    }
    // Grows as it nears, but much less than in true perspective, so it stays easy to read.
    const scale = THREE.MathUtils.clamp(Math.sqrt(NOTE_REFERENCE_DEPTH / depth), 0.8, 1.2);
    // It comes in and goes over the first and last sixth of its stretch.
    const opacity = smooth(t, 0, 0.16) * (1 - smooth(t, 0.84, 1));
    noteShown = true;
    onNote?.({ note, x: noteAnchor.x, y: noteAnchor.y, align: side === 0 ? 0 : side === -1 ? -1 : 1, scale, opacity });
  }

  /** Direction of a gaze turned by `yaw` from the path's heading (-z), tilted by `pitch`. */
  const gazeFrom = (yaw: number, pitch: number) =>
    gaze.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

  /**
   * The ending, `since` seconds after the stop: settle on the summit, turn round on the
   * spot and look down over the whole climb, then raise the eyes to the horizon, where
   * the curve draws itself.
   */
  function playEnding(since: number) {
    const settle = smooth(since, PAUSE[0], PAUSE[1]);
    const turn = smooth(since, TURN[0], TURN[1]);
    const up = smooth(since, LOOK_UP[0], LOOK_UP[1]);

    // The eye moves up behind the guide's last position, then rises as it turns.
    summitEye.set(centerX(distance), heightAt(distance) + SUMMIT_EYE + TURN_RISE * turn, -distance + 2);
    camera.position.lerp(summitEye, settle);
    let pitch = THREE.MathUtils.lerp(-0.1, 0, settle);
    pitch = THREE.MathUtils.lerp(pitch, LOOK_DOWN_PITCH, turn);
    pitch = THREE.MathUtils.lerp(pitch, HORIZON_PITCH, up);
    const target = gazeFrom(Math.PI * turn, pitch).multiplyScalar(20).add(camera.position);
    look.lerp(target, settle);
    const fov = FOV + (LOOK_DOWN_FOV - FOV) * smooth(since, DEEPEN[0], DEEPEN[1]) * (1 - up);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // The guide and its trail make way; the treadmill band gives way to the whole relief.
    trailShown.value = 1 - settle;
    guide.scale.setScalar(0.55 * (1 - settle * 0.85));
    const reliefIn = smooth(since, RELIEF_IN[0], RELIEF_IN[1]);
    fieldShown.value = 1 - smooth(since, FIELD_OUT[0], FIELD_OUT[1]);
    horizonShown.value = 1 - smooth(since, FRONT_HORIZON_OUT[0], FRONT_HORIZON_OUT[1]);
    relief.setShown(reliefIn);
    relief.setDepth(1 + (DEPTH - 1) * smooth(since, DEEPEN[0], DEEPEN[1]));
    relief.setPlainShown(1 - up * 0.85);
    relief.faceStart(camera);
    // The landmarks down the slope go down with it.
    for (const beacon of beacons) beacon.mesh.position.y = 4.5 + relief.deepen(heightAt(beacon.at));
    levers.setHeight((y) => relief.deepen(y));
    // The walls go while the camera turns, before the ground deepens under them.
    walls.setShown(1 - smooth(since, TURN[0], TURN[0] + 1.2));

    // The curve is laid out once the camera has stopped moving forward.
    if (!curvePlaced && since >= TURN[0]) {
      curvePlaced = true;
      // Laid out for where the eye will be once it has risen.
      summitEye.set(centerX(distance), heightAt(distance) + SUMMIT_EYE + TURN_RISE, -distance + 2);
      reward.start({
        trajectory, end: distance, eye: summitEye, pitch: HORIZON_PITCH, fov: FOV, aspect: camera.aspect,
      });
    }
    if (curvePlaced) {
      // The chart's axes come as the eyes rise, just before the curve is drawn on them.
      reward.showFrame(up);
      reward.update(smooth(since, CURVE_DRAWN[0], CURVE_DRAWN[1]));
    }
    if (!endAnnounced && since >= CHOICES_AT) {
      endAnnounced = true;
      onEnd?.();
    }
  }

  /** The ride is over: the visitor's line is laid along the ridge for the view back. */
  function startReward() {
    endedAt = elapsed;
    relief.setJourney(trajectory, END_AT, 0.16);
  }

  const render = () => {
    const canvas = renderer.domElement;
    if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    }
    pipeline.render();
  };

  // Settle positions, then compile everything while the light still covers the screen.
  frame(0);
  render();
  await Promise.race([
    renderer.compileAsync(scene, camera),
    new Promise((resolve) => window.setTimeout(resolve, 4000)),
  ]);

  return {
    frame,
    render,
    /** Every point of the visitor's path so far (kept for the reward). */
    trajectory,
    /** Development only: jump along the path, to check a landmark without riding there. */
    seek(to: number) {
      if (import.meta.env.DEV) distance = to;
    },
    /** Development only: where the ride stands, and how far into the ending. */
    debugState() {
      if (!import.meta.env.DEV) return null;
      // Screen x (0..1) of the guide and of the route's centre line at the guide's distance.
      const onScreen = (v: THREE.Vector3) => (v.project(camera).x + 1) / 2;
      const guideX = onScreen(guide.position.clone());
      const centreX = onScreen(new THREE.Vector3(centerX(distance), guide.position.y, -distance));
      return { distance, ending: endedAt === null ? null : elapsed - endedAt, lateral, guideX, centreX };
    },
    /** « Rejouer »: back to the start of the path, with a fresh trace. */
    restart() {
      elapsed = 0;
      distance = 0;
      lateral = 0;
      steering.reset();
      speed = SPEED;
      sampleClock = 0;
      trajectory.length = 0;
      endedAt = null;
      endAnnounced = false;
      curvePlaced = false;
      trailShown.value = 1;
      fieldShown.value = 1;
      horizonShown.value = 1;
      guide.scale.setScalar(0.55);
      relief.reset();
      reward.reset();
      camera.fov = FOV;
      camera.updateProjectionMatrix();
      for (const beacon of beacons) beacon.mesh.position.y = 4.5 + heightAt(beacon.at);
      levers.setHeight((y) => y);
      walls.setShown(1);
      word = null;
      onWord?.(null);
      noteShown = false;
      onNote?.(null);
      tagsShown = false;
      onTags?.([]);
    },
    dispose() {
      steering.dispose();
      pipeline.dispose();
      reward.dispose();
      relief.dispose();
      levers.dispose();
      summit.dispose();
      markerGeometry.dispose();
      markers.forEach((marker) => marker.material.dispose());
      walls.dispose();
      monitor.dispose();
      for (const dial of dials) {
        dial.mesh.geometry.dispose();
        dial.material.dispose();
      }
      for (const object of [field, horizon, guide, trail, ring, ...beacons.map((b) => b.mesh)]) {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      }
      const materials = [
        fieldMaterial, horizonMaterial, guideMaterial, trailMaterial, ring.material,
        ...beacons.map((b) => b.material),
      ];
      for (const material of materials) material.dispose();
      onWord?.(null);
      onTags?.([]);
      onNote?.(null);
    },
  };
}

export type Terrain = Awaited<ReturnType<typeof createTerrain>>;
