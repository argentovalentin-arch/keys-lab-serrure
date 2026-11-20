import * as THREE from 'three/webgpu';
import {
  abs, atan, attribute, clamp, color, cos, exp, float, fract, hash, instanceIndex, length, mix, mx_noise_float, pass, sin,
  cameraPosition, smoothstep, uint, uniform, uv, varying, vec2, vec3,
} from 'three/tsl';
import { topoTone } from './topography';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createSteering } from './steering';
import { createReward } from './reward';
import { createRelief } from './relief';
import { THROW_FROM, THROW_TO, createLevers } from './levers';
import { createNetwork } from './network';
import { createPavement } from './pavement';
import { noteAt, type Note } from './notes';
import { PILLARS, STEPS, createMonitor, stepAt } from './monitor';
import { createSummit } from './summit';
import { createSea } from './sea';
import { createBoat } from './boat';
import { ISLANDS_VIEW, createIslands } from './islands';
import { PIER, SEA_LEVEL } from './coast';
import { createPier } from './pier';
import { ACTIVATE_ACT, ENDING, STRUCTURE_ACT, TITLES } from './timeline';
import { createCrown } from './crown';
import { SLOTS, createProjections, graduatedRing, type ProjectionSlot } from './projection';
import type { Illustration } from '../ui/holograms';
import { BEACON, CHART, LEVERS, LEVER_FOCUS, SEA, SPEED, lookWeights, paceAt, plateau } from './pace';
import { SPRITE_GROWTH, coreColor, particleShape, twinkle } from '../world/sprite';
import type { IconName } from './icons';
import { BRAND, LAB } from '../core/brand';

/** A note as it stands on screen this frame (see notes.ts and placeNote). */
/** A label in the scene as it stands on screen this frame (see placeTags). */
export interface TagView {
  id: string;
  /** A badge with icons (the default); a step of the method (its numeral); a pillar's name alone. */
  kind: 'badge' | 'step' | 'pillar';
  icons: IconName[];
  caption: string;
  numeral?: string;
  /** Shown without its words for now (its numeral alone). */
  quiet: boolean;
  /** What it names is done (a lever thrown): its frame closes (style.css). */
  confirmed: boolean;
  /**
   * Its hologram (ui/holograms.ts), while it is the badge in focus: which drawing, seconds
   * since the badge came into focus, and how far it has folded away (0..1) once out of it.
   */
  holo?: { kind: Illustration; t: number; fold: number };
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

// The brand's colours and the Lab's night (core/brand.ts).
const NAVY = LAB.night;
const CREAM = LAB.dust;
const WARM = LAB.light;

const FIELD_WIDTH = 34;
const FIELD_DEPTH = 64;
/** How far the band reaches behind the guide, so the ground runs under the camera. */
const FIELD_BEHIND = 9;
// The light can be steered across the path, never off it.
const LATERAL_LIMIT = PATH_HALF - 0.35;
const CAMERA_BACK = 6.5;
const CAMERA_HEIGHT = 2.3;
const GUIDE_HEIGHT = 0.55;
const TRAIL_SAMPLE = 0.05; // seconds between kept trajectory points
const TRAIL_VISIBLE = 220; // most recent points drawn as the ribbon
const TRAIL_WIDTH = 0.018; // half-width at the guide; the ribbon tapers to a thread behind it
const FIREFLIES = 16;

// The ride's pace (where it slows, for what) and where the eyes turn: pace.ts.

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
// The row is laid out in pace.ts (LEVERS): read the note first, then the chosen ones on the
// left are thrown one after the other as the eyes turn to them, then those on the right.
// Each landmark is marked on the ground by a dial of light around the path.
const DIAL_RADIUS = 3.4;
const RUN_AHEAD = 2.4; // the light covers this much path per unit the guide travels
// « Performer »: the ring stands on the summit; past it, the lane opens out on the top.
const RING_RADIUS = 2.4;
/** The summit's crown (crown.ts): where it stands along the path, and the stretch it builds over. */
const CROWN_AT = END_AT + 21.5;
const CROWN_BUILD = [PERFORM_AT - 12, END_AT] as const;
/** How high over the crown's ground the key ring hangs (its apex, crown.ts: this + 1.6). */
const CROWN_TOP = 6;
const OPENS_OVER = 22;

// The ending, in seconds after the ride has stopped on the summit (timeline.ts, ENDING):
// 1. Arrival: the camera settles on the summit, facing ahead, « Performer » still showing.
const PAUSE = ENDING.pause;
// 2. Actions and results: still facing ahead, the note « Chaque résultat relié à une
//    action » (notes.ts), read alone; then its badges, each an action and what it produces.
const ACTIONS = ENDING.actions; // with the arcs to the keys, then the key ring (summit.ts)
// 3. The view back: a half-turn on the spot, to look down over the whole climb.
const TURN = ENDING.turn;
// The whole mountain (relief.ts) comes in just before the turn, laid over the same
// ground, so it is already there when the camera turns; the treadmill band only goes
// once the turn is done. Nothing is swapped in view.
const RELIEF_IN = ENDING.reliefIn;
const FIELD_OUT = ENDING.fieldOut;
// The light band ahead goes before the turn sweeps it across the view.
const FRONT_HORIZON_OUT = ENDING.frontHorizonOut;
// 4. The reveal: after a moment looking down, the eyes rise to the horizon, where the
//    curve draws itself; then the closing choices.
// The key ring, now in hand (summit.ts): taken at the end of the actions, held through the
// half-turn, then, a moment of its own while looking down over the climb, carried across
// from left to right, the keys swaying; lowered out of view before the eyes rise.
const RING_IN_HAND = ENDING.hand;
// The view back holds a little longer: the mountain, the sea at its foot, the islands.
const RING_SWAY = ENDING.ringSway;
const RING_LOWERED = ENDING.ringLowered;
const LOOK_UP = ENDING.lookUp;
const CURVE_DRAWN = ENDING.curveDrawn;
const CHOICES_AT = ENDING.choicesAt;
/** Pitch while looking back down the slope, then on the horizon (radians). */
// Low enough to see the path run down to the shore, high enough to keep the horizon and the
// islands in view (islands.ts).
const LOOK_DOWN_PITCH = -0.46;
const HORIZON_PITCH = -0.3; // low enough that the far half of the climb, deep below, stays in view under the curve
/** On the summit the eye stands a little higher, for the view. */
const SUMMIT_EYE = CAMERA_HEIGHT + 2.2;
/**
 * During the half-turn the eye also rises above the summit. Seen from just above the
 * ground, the whole slope lies in a thin band near the horizon; from higher up it spreads
 * down the view, the start far below, the bends in between, the top close under the eye.
 */
const TURN_RISE = 26;
/**
 * And it moves out over the edge of the flat top (negative: towards the start), so that,
 * looking down, the rim of the summit lies at the foot of the view and the whole climb
 * falls away from it, rather than being hidden behind the top's own shoulder.
 */
const TURN_BACK = -9;
/**
 * Looking back from the top, the mountain below deepens to this (its drop from the
 * summit multiplied, relief.ts), over the second half of the turn, once the ridden band
 * is out of sight: the start ends far down, the path descending to it in its bends.
 */
const DEPTH = 3;
/** Field of view: widened while looking down from the top (a stronger plunge), back for the curve. */
const FOV = 50;
const LOOK_DOWN_FOV = 64;
const DEEPEN = ENDING.deepen;

const smooth = THREE.MathUtils.smoothstep;

/**
 * The badges of a sequence come one at a time, once its note has been read and what it
 * announces has started (timeline.ts): each has its own beat in focus (its hologram builds
 * and holds, ui/holograms.ts), and the next comes as it ends; they all go together before
 * the next note. Over this stretch the ride is slow and steady (pace.ts); the eyes turn a
 * little to the badge in focus. The badges stand close to the path, drawn in over it.
 */
const BEATS = STRUCTURE_ACT.beats;
/** The i-th badge of a sequence: its beat in focus. */
const focusOf = (group: 'understand' | 'foundations', i: number): [number, number] => BEATS[`${group}-${i}`];
/** Where a sequence's badges go, together (its last beat). */
const groupOut = (group: 'understand' | 'foundations') => BEATS[`${group}Out`];
/** How far ahead of where it comes in a badge's point stands, and how far its card is drawn in over the path. */
const BADGE_AHEAD = 10;
const BADGE_CENTRING = 0.5;
/** How long a hologram takes to fold away (seconds). */
const HOLO_FOLD = 0.5;

// Notes (notes.ts): how far beside the path they stand, and how high; on narrow screens
// they stand over the path, a little higher. At the reference depth they show at base size.
const NOTE_BESIDE = 5;
/** On a phone, how far a label is drawn from its point towards the route's centre line. */
const LABEL_PULL = 0.6;
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
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(NAVY);
  // Far enough to see the whole climb back down from the summit, and the horizon beyond.
  // Far enough to see the islands on the horizon, from the boat and from the summit.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1700);

  const travel = uniform(0); // distance along the path; the guide sits at z = -travel
  /** Where the lens is focused (distance from the eye), and how much it shows (none on the summit). */
  const focusDistance = uniform(7);
  const focusAmount = uniform(1);
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

  // « Clarifier les fondations » (pavement.ts): where the paving front reaches the lane, its
  // particles gather and brighten (the matter at work); behind it, the pavers carry the
  // path and the lane's loose particles step back.
  const paveFront = uniform(-1000);
  const paved = smoothstep(paveFront, paveFront.sub(3), p).mul(lane).mul(float(1).sub(lit));
  const forming = exp(p.sub(paveFront).add(1.6).div(1.5).pow(2).negate()).mul(lane);

  // The band follows the route's bends (path.ts): fieldX is the offset from its centre line.
  const worldX = centerXNode(p).add(fieldX);
  // The climb: every particle sits on the mountain, so the band climbs with the route,
  // and away from it the ground falls off down the mountain's flanks.
  const groundHeight = groundNode(worldX, fieldZ);
  // The landmarks' beacons charging as the guide comes up (pace.ts, BEACON): the particles
  // around one brighten and rise a little, and once it is charged a wave of light runs out
  // from it over the ground and under the visitor.
  const beaconPower = [STRUCTURE_AT, ACTIVATE_AT].map((at) => ({ at, charge: uniform(0), wave: uniform(-1) }));
  const beaconTerms = beaconPower.map(({ at, charge, wave }) => {
    const away = vec2(worldX.sub(centerX(at)), fieldZ.add(at)).length();
    const front = away.sub(wave).div(2.2);
    const running = wave.greaterThan(0).select(float(1).sub(wave.div(BEACON.waveReach)), float(0));
    return { near: exp(away.div(6.5).pow(2).negate()).mul(charge), ring: exp(front.mul(front).negate()).mul(running) };
  });
  const beaconNear = beaconTerms[0].near.add(beaconTerms[1].near);
  const beaconRing = beaconTerms[0].ring.add(beaconTerms[1].ring);
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
  // Under the sea (sea.ts) the ground fades out; in the shallows its floor still shows,
  // dim and cool, rising towards the beach. Where the land comes out of the water, a band
  // of matter deposited by the waves: the shore.
  const underwater = smoothstep(SEA_LEVEL + 0.08, SEA_LEVEL - 0.1, groundHeight);
  const seabed = underwater.mul(smoothstep(1.2, 0.12, float(SEA_LEVEL).sub(groundHeight)));
  const beach = exp(groundHeight.sub(SEA_LEVEL + 0.18).div(0.28).pow(2).negate()).mul(float(1).sub(underwater));
  // The waterline itself: where the waves leave the sand wet, a fine bright line.
  const waterline = exp(groundHeight.sub(SEA_LEVEL + 0.05).div(0.11).pow(2).negate());
  // Where the paved path is not, the ground's own shape (topography.ts): how it faces the
  // light, its crests and hollows, read from its heights a little way round.
  const READ = 2.5;
  const east = groundNode(worldX.add(READ), fieldZ);
  const west = groundNode(worldX.sub(READ), fieldZ);
  const north = groundNode(worldX, fieldZ.sub(READ));
  const south = groundNode(worldX, fieldZ.add(READ));
  const groundNormal = vec3(west.sub(east).div(2 * READ), 1, north.sub(south).div(2 * READ)).normalize();
  const groundTone = topoTone(groundNormal, clamp(groundHeight.mul(4).sub(east).sub(west).sub(north).sub(south).mul(0.6), -1, 1));
  fieldMaterial.positionNode = vec3(worldX, swell.mul(float(1).sub(beach)).mul(float(1).sub(underwater)).add(groundHeight).add(beaconNear.mul(0.22)).add(beaconRing.mul(0.3)).add(forming.mul(0.12)), fieldZ);
  // Far: lost in the haze. Near: thinned out so the ground does not crowd the camera.
  const haze = smoothstep(FIELD_DEPTH - FIELD_BEHIND, (FIELD_DEPTH - FIELD_BEHIND) * 0.45, ahead);
  const near = smoothstep(-FIELD_BEHIND, -FIELD_BEHIND + 4, ahead);
  const crest = smoothstep(-0.1, 0.3, swell);
  // What warms the matter: the swell's crests a little, the lit stretches, the effects.
  const warmth = crest.mul(0.12).add(energy.mul(0.8)).add(opened.mul(0.3)).add(scan.mul(0.7))
    .add(beaconNear.mul(0.5)).add(beaconRing.mul(0.7)).add(forming.mul(0.6)).add(beach.mul(0.55)).min(1);
  // The sweep (« Comprendre avant de proposer ») lights the particles it passes, and swells them.
  // Points of light (sprite.ts): a whiter core in a faint halo, a slow shimmer off the lane.
  const shape = particleShape();
  const fieldSeed = hash(instanceIndex.add(uint(count * 2)));
  // The ground in its tone, the lane (the path's surface) in the light one, the floor of the
  // shallows cooled; then what the effects warm.
  const groundColour = mix(mix(mix(groundTone.colour, color(CREAM), lane.mul(0.75)), color(BRAND.navy60).mul(1.5), seabed), color(LAB.lightCore), waterline.mul(0.7));
  fieldMaterial.colorNode = coreColor(varying(mix(groundColour, color(WARM), warmth)), shape.core).mul(varying(float(1).add(scan.mul(2.2))));
  const disc = clamp(float(1).sub(length(uv().sub(0.5)).mul(2)), 0, 1);
  // The lane gathers the particles of a much wider band: only one column in three stays
  // once gathered, so it reads as rows of points rather than a blur.
  const laneKeep = mix(float(1), col.mod(3).lessThan(0.5).select(float(1), float(0)), gathered);
  const glow = float(1).add(lane.mul(0.25)).add(energy.mul(1.2)).add(arrival.mul(0.7)).add(contour.mul(0.9)).add(scan.mul(2.2))
    .add(beaconNear.mul(1)).add(beaconRing.mul(2.4)).add(forming.mul(0.9)).add(beach.mul(0.9)).add(waterline.mul(2.2))
    .mul(mix(groundTone.strength, float(1.15), lane)).mul(laneKeep);
  const fieldShimmer = mix(twinkle(time, fieldSeed, 0.3), 1, lane);
  // A lens's focus (a thin lens, worked out per particle: they write no depth, so a depth-of-
  // field pass could not see them): sharp where the eyes are (the guide, then the lever or
  // the chart they turn to, see focusDistance), softer and larger before it, a little
  // softer beyond. A softened point spreads its light: it grows and dims together.
  const fromEye = vec3(worldX, swell.add(groundHeight), fieldZ).sub(cameraPosition).length();
  const blur = clamp(focusDistance.sub(fromEye).div(focusDistance).mul(1.3)
    .add(fromEye.sub(focusDistance).div(focusDistance.mul(4)).max(0).mul(0.6)), 0, 1).mul(focusAmount);
  fieldMaterial.opacityNode = shape.alpha.mul(varying(float(0.62).mul(haze).mul(near).mul(glow).mul(fieldShimmer).min(1).mul(fieldShown)
    .mul(float(1).sub(paved.mul(0.45))).mul(float(1).sub(underwater).add(seabed.mul(0.32)))
    .div(blur.mul(2.2).add(1))));
  fieldMaterial.scaleNode = float(0.045).add(fieldSeed.pow(5).mul(0.08)).mul(scan.mul(1.3).add(1)).mul(SPRITE_GROWTH)
    .mul(blur.mul(1.5).add(1));
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
  // Thinner on a portrait phone, where the same band fills far more of the screen.
  const bandSharpness = uniform(9);
  const band = uv().y.sub(0.5).mul(bandSharpness);
  // « Performer »: past the crest, the horizon rises and brightens.
  const rise = uniform(0);
  horizonMaterial.colorNode = color(WARM).mul(rise.mul(0.35).add(0.55));
  const horizonShown = uniform(1);
  const horizonCalm = uniform(1);
  // A hairline of light on a faint haze, rather than a broad blurred band: the brand's
  // hairline, drawn in light at the far edge of the land.
  const hairline = exp(uv().y.sub(0.5).mul(170).pow(2).negate()).mul(0.9);
  horizonMaterial.opacityNode = exp(band.mul(band).negate()).mul(0.38).add(hairline)
    .mul(smoothstep(0, 0.25, uv().x)).mul(smoothstep(1, 0.75, uv().x))
    .mul(horizonShown).mul(horizonCalm);
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

  // The brand's graduated rule, as a ring flat on its plane: a hairline circle, fine ticks
  // all round and a longer one every sixth (projection.ts draws the same in points).
  const scanRingGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  // ---- Beacons for « Structurer » and « Activer »: a column of light on the path.
  // As the guide comes up to one it charges (pace.ts, BEACON): the column widens and burns
  // brighter, a halo opens at its foot, the ground around answers (the field, above).
  const beacons = [STRUCTURE_AT, ACTIVATE_AT].map((at, i) => {
    const fade = uniform(0);
    const { charge } = beaconPower[i];
    const across = uv().x.sub(0.5).mul(mix(10.5, 5.6, charge));
    const material = lightMaterial(
      exp(across.mul(across).negate()).mul(smoothstep(1, 0.1, uv().y)).mul(fade).mul(charge.mul(0.5).add(1)),
      1.7,
    );
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 12), material);
    mesh.position.set(centerX(at), 6 + heightAt(at), -at);
    scene.add(mesh);
    const haloMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const r = uv().sub(0.5).length().mul(2);
    haloMaterial.colorNode = color(WARM).mul(1.5);
    haloMaterial.opacityNode = exp(r.mul(r).mul(-5)).mul(smoothstep(1, 0.8, r)).mul(charge).mul(fade).mul(0.38);
    const halo = new THREE.Sprite(haloMaterial);
    halo.position.set(centerX(at), heightAt(at) + 1, -at);
    scene.add(halo);
    // Its activation, read as a scan (projection.ts, « l'épure lumineuse »): once charged,
    // two graduated rings of light rise up the column, one after the other, and fade at its top.
    const scans = [0, 1].map(() => {
      const shown = uniform(0);
      const material = lightMaterial(graduatedRing().mul(shown), 1.6);
      const ring = new THREE.Mesh(scanRingGeometry, material);
      ring.visible = false;
      scene.add(ring);
      return { ring, material, shown };
    });
    return { at, mesh, material, fade, charge, wave: beaconPower[i].wave, halo, haloMaterial, scans };
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
    // A beacon's charge (pace.ts, BEACON) is read on its dial: its dashes light up one after
    // the other from the near side round both ways, like the brand's graduated rule filling;
    // the others wait, faint. « Performer » has no beacon: its dial is lit whole.
    const power = beaconPower[i]?.charge;
    const fromNear = abs(fract(turn.sub(0.25).add(0.5)).sub(0.5)).mul(2);
    const lit = power ? smoothstep(fromNear, fromNear.add(0.04), power) : float(1);
    const glow = band(0.9, 26).mul(dashes).mul(mix(0.3, 1.3, lit)).add(band(0.66, 40).mul(0.45)).add(pulse.mul(0.6))
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
  // « Clarifier les fondations »: the path just structured is paved, from there up to
  // « Performer », ahead of the visitor (pavement.ts): the same matter, consolidated.
  // It starts once « Clarifier les fondations. » has been read (timeline.ts), a little ahead
  // of the guide, and runs on ahead.
  const pavingAt = BEATS.paving[0];
  const pavement = createPavement(scene, {
    startAt: pavingAt,
    from: pavingAt + 4,
    to: PERFORM_AT - 3,
    half: PATH_HALF,
  });
  // « Les bons leviers. Pas tous. »: levers beside the lane, the chosen ones thrown in turn (levers.ts).
  // They rise along the path once « Les bons leviers. Pas tous. » has been read (timeline.ts).
  const levers = createLevers(scene, {
    row: LEVERS.row, offset: PATH_HALF + 0.75, revealAt: ACTIVATE_ACT.beats.leversReveal,
  });
  // « Mesurer pour décider »: a chart of light standing in the land on the right, before the
  // summit, building and drawing itself once the note has been read (monitor.ts, pace.ts CHART).
  // The chosen levers linked by arcs of light as they are thrown (network.ts).
  const network = createNetwork(scene, { stops: levers.chosenPlaces(), throwFrom: THROW_FROM, throwTo: THROW_TO, time });
  const monitor = createMonitor(scene, { time });

  // ---- Labels popping up in the scene with each note (see TagView): pictograms and the
  // channels' marks (icons.ts) with a few words naming them, each on a dotted thread from
  // the point it belongs to. What they show follows keysperformance.com (home page and « Accompagnements »):
  // what is looked at first, the foundations Structurer clarifies, the levers Activer
  // deploys, what Performer measures.
  interface Tag {
    id: string;
    icons: IconName[];
    /** A few words naming what the icons show. */
    caption: string;
    ground: () => THREE.Vector3;
    lift: number;
    strength: (distance: number, sinceStop: number | null) => number;
    /** On a phone, how far the label is drawn towards the route's centre line (LABEL_PULL by default). */
    pull?: number;
    /** On a wider screen, how far the label is drawn in over the path (none by default). */
    centring?: number;
    /** On a phone, the camera depths over which it fades as the camera comes up to it ([4.5, 7] by default). */
    near?: [number, number];
    /** On a phone, how far off the screen's side its point may go while its card stays at the edge (1.05 by default). */
    edge?: number;
    kind?: TagView['kind'];
    numeral?: string;
    /** Whether it shows its numeral alone at this distance. */
    quiet?: (distance: number) => boolean;
    /** Guide distance from which what it names is done (a lever thrown): its label confirms it. */
    confirmAt?: number;
    /** Its hologram (ui/holograms.ts), and the stretch of the ride over which it is the badge in focus. */
    illustration?: Illustration;
    focus?: [number, number];
    /** Whether a line of light rises from its point to it (projection.ts); badges only. */
    projected?: boolean;
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
  /** Portrait phone screen this frame: the labels keep close to the route (see placeTags). */
  let narrowView = false;
  // « Comprendre avant de proposer »: look closely, what blocks, what already works; in
  // the swept ground, on either side.
  // Close to the route (whether its lane has formed yet or not), a little ahead.
  /** A badge of a sequence: in from its own beat, gone with the others over the sequence's last beat. */
  const inSequence = (appear: number, out: [number, number]) => (d: number, s: number | null) =>
    s !== null ? 0 : smooth(d, appear, appear + 0.8) * (1 - smooth(d, out[0], out[1]));
  ([['search', 'Votre situation', 'scan'], ['alert', 'Ce qui bloque', 'block'], ['check', 'Ce qui fonctionne', 'flow']] as [IconName, string, Illustration][]).forEach(([icon, caption, illustration], i) => {
    // One after the other, each with its own beat in focus (timeline.ts): it comes in, its
    // hologram builds and holds, then the next one comes; all three go together.
    const [appear, until] = focusOf('understand', i);
    const side = i % 2 ? 1 : -1;
    const place = besidePath(appear + BADGE_AHEAD, side * 3);
    // On a phone, right beside where the lane will run (it has not formed yet here), so
    // they read as marks along the route rather than out in the field.
    const close = besidePath(appear + BADGE_AHEAD, side * (PATH_HALF + 0.9));
    tags.push({
      id: `understand-${i}`, icons: [icon], caption, illustration, focus: [appear, until], projected: true, centring: BADGE_CENTRING,
      ground: () => (narrowView ? close : place), lift: 1.5 + (i % 2) * 0.25, strength: inSequence(appear, groupOut('understand')),
    });
  });
  // « Clarifier les fondations »: positioning and targets, priorities, journey, roadmap;
  // on the walls, as they build.
  ([['target', 'Positionnement', 'target'], ['priorities', 'Priorités', 'priorities'], ['route', 'Parcours', 'journey'], ['roadmap', 'Feuille de route', 'roadmap']] as [IconName, string, Illustration][]).forEach(([icon, caption, illustration], i) => {
    // At the edge of the path being paved, one after the other, each in focus in turn.
    const [appear, until] = focusOf('foundations', i);
    const place = besidePath(appear + BADGE_AHEAD, (i % 2 ? 1 : -1) * (PATH_HALF + 1));
    tags.push({
      id: `foundations-${i}`, icons: [icon], caption, illustration, focus: [appear, until], projected: true, centring: BADGE_CENTRING,
      ground: () => place, lift: 1.4 + (i % 2) * 0.25, strength: inSequence(appear, groupOut('foundations')),
    });
  });
  // « Les bons leviers. Pas tous. »: each chosen lever shown as it is thrown, with the
  // channels it stands for: content, social media, influence, paid acquisition, CRM.
  ([
    [['camera'], 'Contenu', 'content'],
    [['instagram', 'facebook'], 'Social media', 'social'],
    [['influence'], 'Influence', 'influence'],
    [['google', 'meta'], 'Campagnes Ads', 'funnel'],
    [['mail'], 'CRM & fidélisation', 'loop'],
  ] as [IconName[], string, Illustration][]).forEach(([icons, caption, illustration], i) => {
    const lever = levers.chosenPlaces()[i];
    const nextLever = levers.chosenPlaces()[i + 1];
    if (!lever) return;
    // Named as the impulse sets off towards it (network.ts), in focus until the next one is.
    const named = lever.at - THROW_FROM - 1.5;
    tags.push({
      // The eyes go to the lever as it is thrown (pace.ts): its label stays over it.
      // On a phone the eyes go most of the way to the lever: its label, high over it, stays
      // in view until the next is named, rather than going as the camera comes near.
      // On a phone, where only one side is in view at a time, it stays at the screen's edge
      // as the eyes leave for the next lever, until that one is named.
      id: `levers-${i}`, icons, caption, illustration, projected: true, pull: 0.4, centring: 0.3, near: [1.6, 2.8], edge: 1.7,
      ground: () => lever.place.clone().setY(lever.place.y + 1.05), lift: 0.8,
      focus: [named, nextLever ? nextLever.at - THROW_FROM - 1.5 : lever.at + 1.5],
      // Each goes once its lever has passed.
      strength: onRide(named, lever.at + 3),
      // Once thrown, its label confirms it (style.css).
      confirmAt: lever.at - THROW_TO,
    });
  });
  // « Mesurer pour décider »: on the monitor, the indicators set first (on its target
  // line), then the evolution followed, then what to strengthen.
  // The method chart (monitor.ts) names its pillars as they draw in, then each step as the
  // curve reaches it: its numeral, as on the site, and its name. On a phone, the steps
  // already passed keep their numeral only, so only the step being drawn is spelled out.
  PILLARS.forEach((caption, i) => {
    tags.push({
      id: `pillar-${i}`, kind: 'pillar', icons: [], caption, ground: () => monitor.pillarEnd(i), lift: 0, pull: 0,
      strength: (d, s) => onRide(CHART.build[0] + 0.8 + i * 0.5, CHART.gone[0] - 0.3)(d, s) * monitor.labelsShown,
    });
  });
  STEPS.forEach((step, i) => {
    tags.push({
      id: `step-${i}`, kind: 'step', numeral: step.numeral, icons: [], caption: step.name,
      ground: () => monitor.stepPoint(i), lift: 0.42, pull: 0,
      strength: (d, s) => onRide(monitor.distanceAt(stepAt(i)) - 0.2, CHART.gone[0] - 0.3)(d, s) * monitor.labelsShown,
      quiet: (d) => narrowView && i < STEPS.length - 1 && d > monitor.distanceAt(stepAt(i + 1)) - 0.2,
    });
  });
  /** Where the i-th action badge stands on the summit, ahead of the camera. */
  const summitBadgeGround = (i: number) => {
    const p = distance + 16;
    const x = centerX(p) + (i - 1) * 6;
    return new THREE.Vector3(x, groundAt(x, -p), -p);
  };
  /** When the i-th action badge has come in (seconds after the stop): once its note has been read (timeline.ts). */
  const summitBadgeAt = (i: number) => ENDING.badges[i];
  // On the summit, still facing ahead, with « Chaque résultat relié à une action »: each
  // badge an action and what it produces, as the site's « Activer » puts it (« de la
  // visibilité gagnée… », « une acquisition… », « une base client en propre »), standing
  // in a row over the top, one after the other.
  // Their hologram is their key: an arc rises from each to a key of light, which bears its
  // result (summit.ts); no other drawing beside them.
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
  // The summit's crown (crown.ts): it stands where the key ring will hang, just beyond the
  // top, and rises as the visitor climbs the last stretch.
  const crown = createCrown(scene, { time });
  crown.place(new THREE.Vector3(centerX(CROWN_AT), groundAt(centerX(CROWN_AT), -CROWN_AT), -CROWN_AT));
  const summitTop = new THREE.Vector3();
  const summitHere = new THREE.Vector3();
  // A badge is announced by its projection (projection.ts, « l'épure lumineuse »): a point of
  // light where the thing is, a line rising to the badge; then the badge itself comes in
  // (style.css), and, while it is the one in focus, its hologram over it (ui/holograms.ts).
  const projections = createProjections(scene);
  const projectedSince = new Map<string, number>();
  /** When each badge came into focus, and when it left it (elapsed seconds). */
  const focusSince = new Map<string, number>();
  const focusLeft = new Map<string, number>();
  const projectionSlots: ProjectionSlot[] = Array.from({ length: SLOTS }, () => ({
    ground: new THREE.Vector3(), top: new THREE.Vector3(), age: 0, fade: 0,
  }));
  const tagGround = new THREE.Vector3();
  const tagLabel = new THREE.Vector3();
  const tagLabelWorld = new THREE.Vector3();
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

  const relief = createRelief(scene, Math.round(fieldCount * 1.2));
  // The sea all round the mountain, the boat, the islands out to sea (sea.ts, boat.ts, islands.ts).
  const sea = createSea(scene, { time, near: Math.round(fieldCount * 0.36), far: Math.round(fieldCount * 0.95) });
  const boat = createBoat(scene);
  const pier = createPier(scene);
  const islands = createIslands(scene, { time, count: Math.round(fieldCount * 1.1) });
  const boatEye = new THREE.Vector3();
  let boatX = 0;
  let boatHeading = 0;
  const reward = createReward(scene);
  const steering = createSteering(surface, LATERAL_LIMIT);
  const look = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const chosenLevers = levers.chosenPlaces();
  const summitEye = new THREE.Vector3();
  const gaze = new THREE.Vector3();
  /** Seconds into the Terrain when the ride stopped; null while riding. */
  let endedAt: number | null = null;
  let endAnnounced = false;
  let curvePlaced = false;
  let elapsed = 0;
  let distance: number = SEA.start;
  let lateral = 0;
  /** The light's sideways offset as drawn: the visitor's steering, kept to the deck on the landing stage. */
  let steer = 0;
  let lateralSpeed = 0;
  let sampleClock = 0;
  let width = 0;
  let height = 0;
  let speed = 0;
  let word: string | null = null;
  let noteShown = false;
  const noteAnchor = new THREE.Vector3();
  const noteDepth = new THREE.Vector3();

  /** 0..1: on the landing stage's deck (coast.ts PIER), along the path. */
  const onDeck = (p: number) => smooth(p, -PIER.sea - 1, -PIER.sea + 0.5) * (1 - smooth(p, -PIER.land - 0.5, -PIER.land + 1.5));
  /** The height to walk at along the route: the ground, or the deck over the water (eased onto it from the sea). */
  const walkAt = (p: number) => {
    const ground = heightAt(p);
    if (p > -PIER.land + 0.5) return ground;
    const onto = smooth(p, -PIER.sea - 1.2, -PIER.sea + 0.2);
    return Math.max(ground, THREE.MathUtils.lerp(SEA_LEVEL + 0.15, PIER.deck, onto));
  };

  const placeTrail = () => {
    const recent = trajectory.slice(-TRAIL_VISIBLE);
    for (let i = 0; i < TRAIL_VISIBLE; i++) {
      // Unused slots collapse onto the oldest point, with no opacity.
      const point = recent[Math.max(0, i - (TRAIL_VISIBLE - recent.length))] ?? { x: steer, d: distance };
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
      trailPositions[v] = centerX(distance) + steer + (side ? TRAIL_WIDTH : -TRAIL_WIDTH);
      trailPositions[v + 1] = GUIDE_HEIGHT - 0.25 + groundAt(centerX(distance) + steer, -distance);
      trailPositions[v + 2] = -distance;
    }
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.trailFade.needsUpdate = true;
  };

  /**
   * The crossing (pace.ts, SEA): the visitor sits in the boat, which carries them over the
   * water. At first the eyes are on the islands behind the boat; they turn, along the coast,
   * to the shore and the mountain. Coming in, the ride slows; the boat is drawn onto its
   * line alongside the landing stage (coast.ts PIER), whose light marks where to come, brakes
   * and stops there; its rocking settles; the visitor steps out onto the deck and walks it to
   * the beach, behind the guide's light: the crossing is over, the land begins.
   */
  const lookDir = new THREE.Vector3();
  /** The boat's middle along the path, for where it would be if it still carried the eye: it brakes to a stop at its mooring. */
  const mooring = (at: number) => {
    const from = PIER.moor - SEA.brake;
    return at <= from ? at : PIER.moor - SEA.brake * Math.exp(-(at - from) / SEA.brake);
  };
  /** The boat's line: steered at sea, drawn alongside the landing stage as it comes in. */
  const boatLine = (at: number) => {
    const dock = smooth(at, PIER.moor - 15, PIER.moor - 2.5);
    return THREE.MathUtils.lerp(centerX(mooring(at)) + lateral * 0.55, PIER.side, dock);
  };
  function crossSea() {
    const at = distance - CAMERA_BACK + SEA.eyeBehind; // the boat's middle, if it still carried the eye
    const boatAt = mooring(at);
    // Moored: it hardly rocks any more, and leaves no wake.
    const moored = smooth(at, PIER.moor - 1.2, PIER.moor + 2.2);
    const aboard = 1 - smooth(at, PIER.moor + SEA.stepOff[0], PIER.moor + SEA.stepOff[1]);
    const onWater = 1 - smooth(distance, 8, 18);
    if (moored < 1) {
      boatX = boatLine(at);
      // Turned a little towards where it is going while it is drawn onto its line.
      boatHeading = Math.atan2(boatLine(at + 0.5) - boatLine(at - 0.5), 1) * 0.8 * (1 - moored);
    }
    // On a portrait phone the boat fills far more of the screen: a smaller lantern.
    // With reduced motion, the boat barely rides the swell: the eye in it hardly moves.
    const rocking = (reducedMotion ? 0.25 : 1) * (1 - 0.72 * moored);
    boat.place(boatX, -boatAt, boatHeading, elapsed, 0, SEA_LEVEL, narrowView ? 0.26 : 0.42, rocking);
    boat.setShown(endedAt === null ? smooth(distance, SEA.start - 1, SEA.start) * (1 - smooth(distance, 14, 18)) : 0);
    // The landing stage: its light calls while the boat comes in, then settles.
    if (endedAt === null) pier.update(1 - smooth(distance, 24, 32), 1 - 0.6 * moored);
    if (aboard > 0) {
      boat.eye(boatEye);
      camera.position.lerp(boatEye, aboard);
      // From the boat the eyes go a little higher: over the bow, to the shore and the mountain
      // (higher still on a portrait phone, so the bow does not take half the screen).
      look.y += (narrowView ? 2.7 : 1.6) * aboard;
    }
    // At first, looking back at the islands; then the eyes turn along the coast to the shore.
    const back = 1 - smooth(distance, SEA.turn[0], SEA.turn[1]);
    if (back > 0) {
      lookDir.copy(look).sub(camera.position);
      const aheadYaw = Math.atan2(lookDir.x, -lookDir.z);
      const aheadPitch = Math.atan2(lookDir.y, Math.hypot(lookDir.x, lookDir.z));
      lookDir.copy(ISLANDS_VIEW).sub(camera.position);
      let backYaw = Math.atan2(lookDir.x, -lookDir.z);
      // Turning by the right: past the coast and the Parata, to the mountain.
      if (backYaw > 0) backYaw -= Math.PI * 2;
      const e = back * back * (3 - 2 * back);
      const yaw = THREE.MathUtils.lerp(aheadYaw, backYaw, e);
      const pitch = THREE.MathUtils.lerp(aheadPitch, 0.01, e);
      look.copy(camera.position).add(lookDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(20));
    }
    // The sea, the mountain seen from it (the whole relief, beyond the ridden band), the islands.
    sea.update({
      shown: endedAt === null ? onWater : relief.shownAmount,
      near: endedAt === null ? onWater : 0,
      camera: camera.position,
      boat: { x: boatX, z: -boatAt, heading: boatHeading, speed: 1 - moored },
    });
    if (endedAt === null) {
      sea.setView({ level: SEA_LEVEL, swell: 1, glints: 1 });
      islands.update(onWater);
      relief.setCrossing(onWater, distance);
    }
  }

  const frame = (dt: number) => {
    elapsed += dt;
    // Portrait phone screens: the same light takes up far more of the screen there, and
    // overlaps the words. Beacons, horizon and glow are toned down, the gate comes later.
    const narrow = camera.aspect < 0.9;
    narrowView = narrow;
    const calm = narrow ? 0.55 : 1;
    // A little faster after each landmark, eased in; at the end, a glide to a stop.
    if (endedAt === null && distance >= END_AT) startReward();
    // The pace of the moment (pace.ts): lively between sequences, slow where there is to see and read.
    const cruise = endedAt === null ? SPEED * paceAt(distance) : 0;
    speed = THREE.MathUtils.damp(speed, cruise, endedAt === null ? 1.2 : 2.5, dt);
    distance += speed * dt;
    travel.value = distance;
    time.value = elapsed;

    // Beacons: out of the haze as they come; as the guide comes up to one it charges (pace.ts,
    // BEACON), the column burning brighter and wider over a halo, the ground around it lit;
    // once charged it sends a wave of light out over the ground, and the landmark's title
    // comes in (WORD). The guide passes through it as it fades.
    // Looking back from the summit, the landmarks show again, down the slope.
    const lookingBack = endedAt === null ? 0 : smooth(elapsed - endedAt, RELIEF_IN[0], RELIEF_IN[1]);
    for (const beacon of beacons) {
      const left = beacon.at - distance;
      beacon.fade.value = Math.max(
        smooth(left, -2, 4) * (1 - smooth(left, FIELD_DEPTH * 0.4, FIELD_DEPTH * 0.6)) * calm,
        lookingBack * 0.75,
      );
      const charge = endedAt === null
        ? (1 - smooth(left, BEACON.chargeTo, BEACON.chargeFrom)) * (1 - smooth(-left, 2, 10))
        : 0;
      beacon.charge.value = charge;
      const wave = (BEACON.chargeTo - left) * BEACON.waveSpeed;
      beacon.wave.value = endedAt === null && wave > 0 && wave < BEACON.waveReach ? wave : -1;
      beacon.halo.visible = charge > 0.001;
      beacon.halo.scale.setScalar(3 + charge * 3.5);
      // The activation scan: from the charge's wave, each ring rising over 5 units of path.
      beacon.scans.forEach((scan, k) => {
        const rise = endedAt === null ? THREE.MathUtils.clamp((wave - k * 1.4 * BEACON.waveSpeed) / (5 * BEACON.waveSpeed), 0, 1) : 0;
        // It rises only halfway up, faded before the landmark's title, which stands above.
        scan.shown.value = smooth(rise, 0, 0.06) * (1 - rise) ** 1.8 * beacon.fade.value * (k ? 0.6 : 1);
        scan.ring.visible = scan.shown.value > 0.002;
        if (!scan.ring.visible) return;
        scan.ring.position.set(centerX(beacon.at), heightAt(beacon.at) + 0.2 + rise * 5, -beacon.at);
        scan.ring.scale.setScalar(4.2 - rise * 1.6);
      });
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
    network.update(distance, lookingBack);
    pavement.update(distance);
    paveFront.value = pavement.front;
    monitor.update(distance, narrow);
    // The ground sweep while « Comprendre avant de proposer » shows, faded in and out with it.
    // After the note and its badges have come in.
    // Once « Comprendre avant de proposer. » has been read, through its badges (timeline.ts).
    scanAmount.value = smooth(distance, BEATS.scan[0] - 1, BEATS.scan[1]) * (1 - smooth(distance, BEATS.understandOut[0], BEATS.understandOut[1]));
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
    // Seen last, once the levers and the chart have been: the gate to the summit.
    const [ringNear, ringFar] = [FIELD_DEPTH * 0.12, FIELD_DEPTH * 0.22];
    // It waits for the chart (monitor.ts) to have been read: the chart, then the gate.
    ringFade.value = smooth(toRing, -1.5, 2) * (1 - smooth(toRing, ringNear, ringFar)) * (narrow ? 0.7 : 1) * (1 - monitor.shown);
    arrival.value = smooth(distance, PERFORM_AT - 1, PERFORM_AT + 0.5) * (1 - smooth(distance, PERFORM_AT + 1, PERFORM_AT + 16));
    // Arriving on the summit, the light swells once more.
    const arriving = endedAt === null ? 0 : Math.exp(-(((elapsed - endedAt - 0.6) / 0.7) ** 2));
    // The crown (crown.ts): built over the last stretch, completed and flaring on arrival,
    // then settled; it fades as the visitor turns round.
    const sinceStopNow = endedAt === null ? null : elapsed - endedAt;
    const crownFlare = sinceStopNow === null ? 0 : THREE.MathUtils.clamp((sinceStopNow - 0.15) / 1.6, 0, 1);
    crown.update({
      build: Math.max(smooth(distance, CROWN_BUILD[0], CROWN_BUILD[1]) * 0.86, sinceStopNow === null ? 0 : 0.86 + 0.14 * smooth(sinceStopNow, 0.2, 1.8)),
      flare: crownFlare > 0 && crownFlare < 1 ? crownFlare : 0,
      calm: sinceStopNow === null ? 0 : smooth(sinceStopNow, 1.8, 3.2),
      shown: sinceStopNow === null ? 1 : 1 - smooth(sinceStopNow, TURN[0] - 0.2, TURN[0] + 1.4),
    });
    // The light rises as the crown builds, peaks on arrival, then settles.
    const crownLight = smooth(distance, CROWN_BUILD[0], CROWN_BUILD[1]) * (sinceStopNow === null ? 1 : 1 - smooth(sinceStopNow, 1.8, 3.4));
    glowPass.strength.value = (0.6 + arrival.value * 0.9 + arriving * 0.4 + crownLight * 0.25) * (narrow ? 0.5 : 1);
    // At the summit the horizon's band steps back: the crown is what is looked at.
    // At sea and while landing, the band steps back too: it would lie across the shore and
    // the mountain's foot, just where the water meets the land.
    horizonCalm.value = (narrow ? 0.45 : 1) * (1 - 0.55 * smooth(distance, CROWN_BUILD[0], CROWN_BUILD[1]))
      * smooth(distance, 10, 30);
    bandSharpness.value = narrow ? 15 : 9;
    rise.value = smooth(distance, PERFORM_AT - 4, PERFORM_AT + 22);

    // One word at a time, over a stretch of path around its landmark.
    // Once the ride has stopped, the summit speaks for itself: no more words.
    // « Performer » stays while the camera settles on the summit, so the faster ride
    // does not cut it short; then the summit speaks for itself.
    // Each over its own stretch (timeline.ts, TITLES), alone: the last one stays until the
    // stop, then through the pause (below): no gap between.
    const showing = endedAt === null
      ? LANDMARKS.find((l) => distance >= TITLES[l.word][0] && distance < TITLES[l.word][1])
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

    // On the landing stage's narrow deck the light keeps to it.
    steer = lateral * (1 - 0.55 * onDeck(distance));
    sampleClock += dt;
    if (sampleClock >= TRAIL_SAMPLE && distance >= 0) {
      sampleClock = 0;
      trajectory.push({ x: steer, d: distance });
    }
    placeTrail();

    const guideX = centerX(distance) + steer;
    const bob = Math.sin(elapsed * 2.2) * 0.06;
    guide.position.set(guideX, GUIDE_HEIGHT + Math.max(groundAt(guideX, -distance), walkAt(distance)) + bob, -distance);
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
    // Over the last stretch the camera rises a little and the eyes lift to the crown ahead:
    // the summit is approached, its architecture seen growing, before arriving.
    const crane = smooth(distance, PERFORM_AT - 14, END_AT);
    const lift = plateau(distance, PERFORM_AT - 16, PERFORM_AT - 8, PERFORM_AT - 1, END_AT);
    // Over the water and along the landing stage, the height walked at is its deck's (walkAt).
    camera.position.set(centerX(behind) + steer * 0.55, CAMERA_HEIGHT + crane * 1.3 + walkAt(distance - CAMERA_BACK * 0.5), -behind);
    look.set(centerX(distance + 12) + steer * 0.8, 0.5 + walkAt(distance + 12) + lift * 2.6, -distance - 12);
    crossSea();

    // Where the eyes go (pace.ts, lookWeights): to each chosen lever as it is thrown, the
    // left ones then the right ones, back to the path in between; then to the chart. Each
    // glance eases in and out with the ride, which slows meanwhile.
    const glance = endedAt === null ? lookWeights(distance) : null;
    if (glance) {
      const motion = reducedMotion ? 0.4 : 1;
      if (glance.levers > 0) {
        focus.set(0, 0, 0);
        let total = 0;
        // On a portrait phone, where only one side is in view at a time, the eyes dwell on each
        // lever a little longer and cross over quicker, so its badge stays in view to be read.
        const spread = narrow ? 2.3 : 3.2;
        for (const lever of chosenLevers) {
          const weight = Math.exp(-(((distance - (lever.at - LEVER_FOCUS)) / spread) ** 2));
          focus.addScaledVector(lever.place, weight);
          total += weight;
        }
        // On a portrait phone the view is narrow: the eyes go most of the way to the lever.
        const share = Math.min(0.85, glance.levers * (narrow ? 1.6 : 1));
        if (total > 1e-4) look.lerp(focus.divideScalar(total).setY(focus.y + 0.9), share * motion);
      }
      if (glance.chart > 0) look.lerp(monitor.centre(), Math.min(0.9, glance.chart * (narrow ? 2.2 : 1)) * motion);
      // The badge in focus (« Comprendre », the foundations): the eyes turn a little to it,
      // easing in and out with its time in focus.
      for (const tag of tags) {
        if (!tag.focus || !tag.centring || tag.id.startsWith('levers')) continue;
        const [from, to] = tag.focus;
        const weight = smooth(distance, from, from + 1.5) * (1 - smooth(distance, to - 1, to + 0.5));
        if (weight <= 0) continue;
        const ground = tag.ground();
        focus.set(THREE.MathUtils.lerp(ground.x, centerX(-ground.z), tag.centring), ground.y + tag.lift, ground.z);
        look.lerp(focus, weight * (narrow ? 0.12 : 0.22) * motion);
      }
    }
    // The focus follows the eyes: on the guide, then pulled to what they turn to.
    const onGuide = camera.position.distanceTo(guide.position);
    const pulled = glance ? Math.min(1, (glance.levers + glance.chart) * 1.8) : 0;
    const focusTarget = THREE.MathUtils.lerp(onGuide, camera.position.distanceTo(look), pulled);
    focusDistance.value = THREE.MathUtils.damp(focusDistance.value, focusTarget, 3, dt);
    focusAmount.value = THREE.MathUtils.damp(focusAmount.value, endedAt === null ? 1 : 0, 1.5, dt);
    if (endedAt !== null) playEnding(elapsed - endedAt);
    camera.lookAt(look);
    if (endedAt !== null && elapsed - endedAt < ACTIONS[0]) {
      // Laid out where the ride came to rest (it glides a little after the stop).
      // Where the crown stands (crown.ts): the key ring hangs at its apex.
      summitTop.set(centerX(CROWN_AT), groundAt(centerX(CROWN_AT), -CROWN_AT) + CROWN_TOP, -CROWN_AT);
      summitHere.set(centerX(distance), heightAt(distance), -distance);
      summit.place(summitHere, [0, 1, 2].map(summitBadgeGround), summitTop);
    }
    summit.update(endedAt === null ? null : elapsed - endedAt, camera, ENDING.note[0], {
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
    const views: TagView[] = [];
    let slots = 0;
    camera.updateMatrixWorld();
    for (const tag of tags) {
      const strength = tag.strength(distance, sinceStop);
      const shown = strength >= 0.01 && placeTag(tag);
      if (!shown) {
        // Gone: next time it shows, it plays again from the start.
        projectedSince.delete(tag.id);
        focusSince.delete(tag.id);
        focusLeft.delete(tag.id);
        continue;
      }
      if (!projectedSince.has(tag.id)) projectedSince.set(tag.id, elapsed);
      const confirmed = tag.confirmAt !== undefined && distance >= tag.confirmAt;
      const kind = tag.kind ?? 'badge';
      // Its hologram, while it is the badge in focus; it folds away as the next one comes.
      let holo: TagView['holo'];
      let opacity = strength;
      // On a phone, a badge already passed goes as the camera comes up to it, rather than
      // sliding off the bottom of the narrow screen.
      if (narrowView && tag.focus) opacity *= smooth(-tagDepth.z, ...(tag.near ?? [4.5, 7]));
      if (tag.illustration && tag.focus) {
        const inFocus = distance >= tag.focus[0] && distance < tag.focus[1];
        if (inFocus && !focusSince.has(tag.id)) focusSince.set(tag.id, elapsed);
        if (inFocus) focusLeft.delete(tag.id);
        if (!inFocus && focusSince.has(tag.id) && !focusLeft.has(tag.id)) focusLeft.set(tag.id, elapsed);
        const since = focusSince.get(tag.id);
        const left = focusLeft.get(tag.id);
        // Above 0 from the very frame it leaves focus: it is folding (ui/epilogue.ts keeps it in place).
        const fold = left === undefined ? 0 : THREE.MathUtils.clamp((elapsed - left) / HOLO_FOLD, 0.001, 1);
        if (since !== undefined && fold < 1) holo = { kind: tag.illustration, t: elapsed - since, fold };
        // Once its time in focus is over, the badge steps back, quieter, for the next one.
        if (left !== undefined) opacity *= 1 - 0.38 * fold;
      }
      if (kind === 'badge' && tag.projected && slots < SLOTS) {
        // Its projection: from the point it belongs to, up to where its badge stands.
        const slot = projectionSlots[slots++];
        slot.ground.copy(tag.ground());
        slot.top.copy(tagLabelWorld);
        slot.age = elapsed - projectedSince.get(tag.id)!;
        slot.fade = strength;
      }
      views.push({
        id: tag.id, kind, icons: tag.icons, caption: tag.caption, numeral: tag.numeral,
        quiet: tag.quiet?.(distance) ?? false, gx: tagGround.x, gy: tagGround.y, lx: tagLabel.x, ly: tagLabel.y, opacity,
        confirmed, holo,
      });
    }
    projections.update(projectionSlots.slice(0, slots));
    if (views.length || tagsShown) onTags?.(views);
    tagsShown = views.length > 0;
  }

  /** Where a label and its point are this frame (world, then screen); false if not in view. */
  function placeTag(tag: Tag): boolean {
    tagGround.copy(tag.ground());
    tagLabel.copy(tagGround).setY(tagGround.y + tag.lift);
    // On a phone the label stands over the route rather than out to the side: drawn most of
    // the way towards the centre line at that point of the path (its line still reaches its
    // own point), so it follows the route's bends. On a wider screen the badges of a
    // sequence are drawn in over the path too, less: the path stays the centre of the view.
    const pull = narrowView ? tag.pull ?? LABEL_PULL : tag.centring ?? 0;
    if (pull > 0) tagLabel.x = THREE.MathUtils.lerp(tagLabel.x, centerX(-tagGround.z), pull);
    tagLabelWorld.copy(tagLabel);
    const depth = -tagDepth.copy(tagLabel).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth < 1) return false;
    tagGround.project(camera);
    tagLabel.project(camera);
    return Math.abs(tagLabel.x) <= (narrowView ? tag.edge ?? 1.05 : 1.05) && Math.abs(tagLabel.y) <= 1.05;
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
    summitEye.set(centerX(distance), heightAt(distance) + SUMMIT_EYE + TURN_RISE * turn, -distance + 2 - TURN_BACK * turn);
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
    // The sea at the mountain's foot and the islands on the horizon, deepened with it: the
    // same sea, the same islands as from the boat, from the top. They step back a little as
    // the eyes rise to the curve.
    const seaLevel = relief.deepen(SEA_LEVEL);
    sea.setView({ level: seaLevel, swell: 1 + 1.5 * smooth(since, DEEPEN[0], DEEPEN[1]), glints: 1 - up * 0.5 });
    islands.update(reliefIn * (1 - up * 0.45), seaLevel);
    pier.update(reliefIn * (1 - up * 0.45), 0.4, seaLevel);
    relief.faceStart(camera);
    // The landmarks down the slope go down with it.
    for (const beacon of beacons) beacon.mesh.position.y = 4.5 + relief.deepen(heightAt(beacon.at));
    levers.setHeight((y) => relief.deepen(y));
    // The walls go while the camera turns, before the ground deepens under them.
    pavement.setShown(1 - smooth(since, TURN[0], TURN[0] + 1.2));

    // The curve is laid out once the camera has stopped moving forward.
    if (!curvePlaced && since >= TURN[0]) {
      curvePlaced = true;
      // Laid out for where the eye will be once it has risen.
      summitEye.set(centerX(distance), heightAt(distance) + SUMMIT_EYE + TURN_RISE, -distance + 2 - TURN_BACK);
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
  // Most of the Terrain is hidden at the start (dials, levers, monitor, summit, curve…):
  // drawn for the first time mid-ride, each would stop the frame while its shaders are
  // built, the jolts felt along the way. So for this one warm-up, everything is drawn,
  // through the same passes as the ride, then put back as it was.
  frame(0);
  const warmed: { object: THREE.Object3D; visible: boolean; culled: boolean }[] = [];
  scene.traverse((object) => {
    // Not what has nothing to draw yet (the curve of the summit, laid out at the end).
    const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geometry && !(object as THREE.Sprite).isSprite && !geometry.getAttribute('position')) return;
    warmed.push({ object, visible: object.visible, culled: object.frustumCulled });
    object.visible = true;
    object.frustumCulled = false;
  });
  render();
  await Promise.race([
    renderer.compileAsync(scene, camera),
    new Promise((resolve) => window.setTimeout(resolve, 4000)),
  ]);
  for (const { object, visible, culled } of warmed) {
    object.visible = visible;
    object.frustumCulled = culled;
  }
  frame(0);
  render();

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
    /** Development only: the scene and camera, for tests that look at one element alone. */
    debugScene() {
      return import.meta.env.DEV ? { scene, camera, field } : null;
    },
    /** « Rejouer »: back to the start of the path, with a fresh trace. */
    restart() {
      elapsed = 0;
      distance = SEA.start;
      lateral = 0;
      steering.reset();
      speed = 0;
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
      boatX = 0;
      boatHeading = 0;
      steer = 0;
      camera.fov = FOV;
      camera.updateProjectionMatrix();
      for (const beacon of beacons) beacon.mesh.position.y = 4.5 + heightAt(beacon.at);
      levers.setHeight((y) => y);
      pavement.setShown(1);
      pavement.reset();
      word = null;
      onWord?.(null);
      noteShown = false;
      onNote?.(null);
      tagsShown = false;
      projectedSince.clear();
      focusSince.clear();
      focusLeft.clear();
      projections.update([]);
      onTags?.([]);
    },
    dispose() {
      steering.dispose();
      pipeline.dispose();
      reward.dispose();
      relief.dispose();
      levers.dispose();
      summit.dispose();
      projections.dispose();
      crown.dispose();
      sea.dispose();
      boat.dispose();
      pier.dispose();
      islands.dispose();
      pavement.dispose();
      monitor.dispose();
      network.dispose();
      for (const dial of dials) {
        dial.mesh.geometry.dispose();
        dial.material.dispose();
      }
      for (const object of [field, horizon, guide, trail, ring, ...beacons.map((b) => b.mesh)]) {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      }
      const materials = [
        fieldMaterial, horizonMaterial, guideMaterial, trailMaterial, ring.material,
        ...beacons.map((b) => b.material), ...beacons.map((b) => b.haloMaterial),
        ...beacons.flatMap((b) => b.scans.map((scan) => scan.material)),
      ];
      for (const material of materials) material.dispose();
      scanRingGeometry.dispose();
      onWord?.(null);
      onTags?.([]);
      onNote?.(null);
    },
  };
}

export type Terrain = Awaited<ReturnType<typeof createTerrain>>;
