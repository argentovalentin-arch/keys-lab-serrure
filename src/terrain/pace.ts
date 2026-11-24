import * as THREE from 'three/webgpu';
import { ACTIVATE_AT, END_AT, PERFORM_AT, STRUCTURE_AT } from './path';
import { ACTIVATE_ACT, ENDING, LEVERS_END, LEVERS_FIRST_IMPULSE, STRUCTURE_ACT, TEMPO, type Act } from './timeline';

/**
 * The ride's rhythm, in one place: how fast the guide goes where, and where the eyes turn.
 *
 * Everything is tied to the guide's distance along the path (path.ts), never to a timer,
 * so the ride reads the same at any frame rate and replays exactly. Between sequences the
 * ride moves on at a lively pace; it slows as a landmark comes near, while a message is
 * read, while the levers are discovered and while the chart draws itself, then picks up
 * again. The slowing and the picking up are eased (and the speed itself follows them
 * smoothly, terrain.ts), so they are felt as a change of pace, never as a brake.
 */

/** Cruising speed between sequences, in units of path per second (a touch livelier at TEMPO, timeline.ts). */
export const SPEED = 6.4 * TEMPO;
/**
 * A pace that keeps its speed as it was set before TEMPO: the titles' stretches, the
 * levers' run and the arrival on the summit read exactly as they did.
 */
const kept = (pace: number) => pace / TEMPO;

interface Zone {
  /** What the slow stretch is for. */
  why: string;
  /** Guide distances it covers at its slowest, and how long it takes to slow down and pick up. */
  from: number;
  to: number;
  ease: number;
  /** Share of SPEED at its slowest. */
  pace: number;
}

/**
 * The crossing, before the path (guide distances, negative: the beach is at about -1.5).
 * The ride starts at sea, in the boat, looking back at the islands behind it (islands.ts);
 * the eyes turn to the shore along the coast; the boat crosses, slows as it comes in, comes
 * alongside the landing stage (coast.ts PIER) and stops; once it has settled, the visitor
 * steps onto the deck and walks it to the beach behind the guide's light.
 */
export const SEA = {
  /** Where the boat sets off: closer in than it was (-64), a shorter, more direct crossing. */
  start: -46,
  /**
   * The eyes on the islands, then turning to the shore: [still on them until, turned by].
   * Long enough to find them and take them in, then a turn of three to four seconds, eased
   * in and out.
   */
  turn: [-43.5, -36] as const,
  /** From here the ride slows for the approach (the boat then some ten units from its mooring). */
  approach: -18,
  /** The visitor's eye in the boat: this far behind the boat's middle (towards the stern). */
  eyeBehind: 1.25,
  /** Over how much of the boat's travel it brakes to a stop alongside. */
  brake: 1.6,
  /** Once moored, the visitor steps out onto the deck: over this stretch of the boat's (would-be) travel past its mooring. */
  stepOff: [1.8, 6.2] as const,
  /** Walking the deck to the beach and onto the land: the ride's pace for it. */
  ashore: [-3, 8] as const,
} as const;

/** An act of the narration (timeline.ts) as a slow stretch: its own steady speed. */
// Its slowing starts within the beat before it, so the act's first beat already runs at its speed.
const actZone = (why: string, act: Act, ease = 3): Zone => ({ why, from: act.from - 2, to: act.to, ease, pace: act.speed / SPEED });

export const ZONES: Zone[] = [
  { why: 'The sea: the horizon and the islands, behind the boat', from: SEA.start, to: SEA.turn[0], ease: 2, pace: 0.1 },
  { why: 'The eyes turn along the coast to the shore', from: SEA.turn[0], to: SEA.turn[1], ease: 2, pace: 0.36 },
  { why: 'The crossing', from: SEA.turn[1], to: SEA.approach, ease: 4, pace: 0.8 },
  { why: 'The approach: the boat slows, comes alongside the landing stage, stops, settles', from: SEA.approach, to: SEA.ashore[0], ease: 4, pace: 0.38 },
  { why: 'Ashore: along the landing stage, onto the beach, at a walk', from: SEA.ashore[0], to: SEA.ashore[1], ease: 3, pace: 0.82 },
  // Just past the beach: the walk ashore runs straight into it, the beacon charging as the
  // visitor comes up (a little later into the slow pace than before), the title read as it was.
  { why: 'Structurer: the beacon charges, the wave runs out, the title reads', from: STRUCTURE_AT - 10, to: STRUCTURE_AT + 2, ease: 5, pace: kept(0.34) },
  { why: 'Activer: the beacon charges, the title reads', from: ACTIVATE_AT - 13, to: ACTIVATE_AT + 2, ease: 6, pace: kept(0.34) },
  actZone('Les bons leviers: the note, then the levers rise', ACTIVATE_ACT),
  // Slowed from before its title, coming from the open stretch after the levers, so the title
  // reads as long as it did when the chart stood before it.
  { why: 'Performer: the ring, the title, the arrival', from: PERFORM_AT - 8, to: END_AT, ease: 8, pace: kept(0.55) },
];

const smooth = THREE.MathUtils.smoothstep;

/** 0..1 over [a, b], 1 until c, back to 0 at e: a plateau with eased sides. */
export const plateau = (d: number, a: number, b: number, c: number, e: number) => smooth(d, a, b) * (1 - smooth(d, c, e));

/**
 * A stretch of the ride whose speed changes beat by beat: picking up between two badges,
 * slowing as one comes, slow while it is read, picking up again. From one speed to the next
 * it eases over a little path either side of where they meet, never a jolt; it slows into
 * the stretch, and picks up out of it, as a zone does.
 */
type Stretch = { from: number; to: number; speed: number }[];
const BLEND = 0.6;
function stretchPace(order: Stretch, d: number, enter = 3, leave = 3): number {
  const first = order[0];
  const last = order[order.length - 1];
  if (d < first.from - 2 - enter || d > last.to + leave) return 1;
  let speed = first.speed;
  for (let k = 1; k < order.length; k++) speed = THREE.MathUtils.lerp(speed, order[k].speed, smooth(d, order[k].from - BLEND, order[k].from + BLEND));
  const into = smooth(d, first.from - 2 - enter, first.from - 2);
  const out = smooth(d, last.to, last.to + leave);
  return THREE.MathUtils.lerp(1, speed / SPEED, into * (1 - out));
}

/**
 * The levers' run, after « Activer » (network.ts, levers.ts): slowed for each lever, while
 * the impulse comes to it, it is thrown and its badge's hologram builds (from where it is
 * named, three units), then picking up to the next. A touch quicker than it was, on the whole.
 */
const LEVER_SLOW = 0.95;
const LEVER_FAST = 3.2;
/** From where a lever is named, how much of the way to the next the ride stays slow. */
const LEVER_HOLD = 4.8;
/** Once the levers have risen, on to the first; once the last is thrown, on up the path. */
const LEVER_APPROACH = 1.6;
const LEVER_LEAVE = 2;
let leverStretch: Stretch | null = null;
/** Laid out on first use (LEVERS is declared further down). */
const leverStretchOf = (): Stretch => (leverStretch ??= (() => {
  const chosen = LEVERS.row.filter((lever) => lever.chosen).map((lever) => lever.at);
  const order: Stretch = [{ from: LEVERS_FIRST_IMPULSE, to: chosen[0] - 5.5, speed: LEVER_APPROACH }];
  for (const at of chosen) {
    order.push({ from: at - 5.5, to: at - 5.5 + LEVER_HOLD, speed: LEVER_SLOW });
    order.push({ from: at - 5.5 + LEVER_HOLD, to: at + 0.5, speed: LEVER_FAST });
  }
  order.push({ from: chosen[chosen.length - 1] + 0.5, to: LEVERS_END, speed: LEVER_LEAVE });
  return order;
})());

/** Share of SPEED at this distance (1 between sequences). */
export function paceAt(distance: number): number {
  let pace = 1;
  for (const zone of ZONES) {
    const inside = plateau(distance, zone.from - zone.ease, zone.from, zone.to, zone.to + zone.ease);
    pace = Math.min(pace, 1 - (1 - zone.pace) * inside);
  }
  // « Structurer »'s act, badge by badge (timeline.ts), and the levers' run.
  pace = Math.min(pace, stretchPace(STRUCTURE_ACT.order, distance));
  pace = Math.min(pace, stretchPace(leverStretchOf(), distance, 1.5, 3));
  return pace;
}

/**
 * How quickly the ride's speed follows its pace (terrain.ts): over the stretches that
 * alternate, it answers within about half a second, so a short run between two badges is
 * felt; elsewhere it eases more slowly, as it always has.
 */
export function responseAt(distance: number): number {
  const alternating = Math.max(
    plateau(distance, STRUCTURE_ACT.from - 2, STRUCTURE_ACT.from, STRUCTURE_ACT.to - 4, STRUCTURE_ACT.to),
    plateau(distance, LEVERS_FIRST_IMPULSE - 1, LEVERS_FIRST_IMPULSE + 1, LEVERS_END - 2, LEVERS_END) * 0.7,
  );
  return THREE.MathUtils.lerp(1.2, 2.4, alternating);
}

/**
 * The levers' discovery (terrain.ts, network.ts): five chosen levers, thrown in turn by an
 * impulse that bounces from one to the next across the path, left, right, left, right, then
 * right again, the last two side by side: the sequence ends on that double beat, and the
 * energy is sent on up the path. Between them, levers left alone, set back: not all of them.
 * The eyes follow the impulse to each lever in turn (terrain.ts, LEVER_FOCUS).
 */
export const LEVERS = {
  /** Each lever: where it stands along the path, on which side, and whether it is thrown. */
  row: [
    { at: 138, side: 1, chosen: false },
    { at: 141, side: -1, chosen: true }, // Contenu
    { at: 144, side: -1, chosen: false },
    { at: 147, side: 1, chosen: true }, // Social media
    { at: 150, side: 1, chosen: false },
    { at: 153, side: -1, chosen: true }, // Influence
    { at: 156, side: -1, chosen: false },
    { at: 159, side: 1, chosen: true }, // Campagnes Ads
    { at: 162, side: -1, chosen: false },
    { at: 165, side: 1, chosen: true }, // CRM & fidélisation
    { at: 168, side: -1, chosen: false },
  ],
  /** When the eyes go to the levers: [turning, turned, back, ahead]. */
  look: [135, 138.5, 165, 169] as const,
  /** How far the gaze goes from the path ahead to the lever (share of the way). A glance, not a swing. */
  share: 0.4,
} as const;

/**
 * « Mesurer pour décider »'s chart, on the summit (monitor.ts): it stands ahead over the top,
 * in the middle of the view, once the ride has stopped. Its moments, in seconds after the
 * stop (timeline.ts, ENDING): frame and axes draw in with the note, the curve draws, it
 * stays, it goes.
 */
export const CHART = {
  /** How far ahead of the stop it stands, how high its foot is over the top, and its size on a portrait phone. */
  ahead: 15,
  lift: 4.3,
  narrowScale: 0.42,
  build: ENDING.measure.build,
  draw: ENDING.measure.draw,
  gone: ENDING.measure.gone,
} as const;

/**
 * How much the eyes leave the path ahead, at this distance, for the levers (share of the way
 * to them, terrain.ts). Eased in and out at both ends, so a turn starts and ends gently;
 * between the left and right levers it comes back to the path.
 */
export function lookWeights(distance: number) {
  return { levers: plateau(distance, ...LEVERS.look) * LEVERS.share };
}

/** When a chosen lever is thrown, the eyes are on it: the middle of its throw, before the guide reaches it. */
export const LEVER_FOCUS = 2.75;

/** A landmark's beacon: how charged it is (0..1) as the guide comes up to it. */
export const BEACON = {
  /** It charges from this far ahead of the guide to this far. */
  chargeFrom: 15,
  chargeTo: 6,
  /** The wave it releases once charged: how fast it runs out (per unit of guide travel), how far. */
  waveSpeed: 3.6,
  waveReach: 46,
} as const;

