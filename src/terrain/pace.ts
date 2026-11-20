import * as THREE from 'three/webgpu';
import { ACTIVATE_AT, END_AT, PERFORM_AT, STRUCTURE_AT } from './path';
import { ACTIVATE_ACT, LEVERS_END, LEVERS_FIRST_IMPULSE, MEASURE_ACT, STRUCTURE_ACT, type Act } from './timeline';

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

/** Cruising speed between sequences, in units of path per second. */
export const SPEED = 6.4;

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
  start: -64,
  /** The eyes on the islands, then turning to the shore: [still on them until, turned by]. */
  turn: [-58.5, -47] as const,
  /** From here the ride slows for the approach (the boat then some twelve units from its mooring). */
  approach: -20,
  /** The visitor's eye in the boat: this far behind the boat's middle (towards the stern). */
  eyeBehind: 1.25,
  /** Over how much of the boat's travel it brakes to a stop alongside. */
  brake: 1.6,
  /** Once moored, the visitor steps out onto the deck: over this stretch of the boat's (would-be) travel past its mooring. */
  stepOff: [2.4, 7.4] as const,
  /** Walking the deck to the beach and onto the land: the ride's pace for it. */
  ashore: [-3, 8] as const,
} as const;

/** An act of the narration (timeline.ts) as a slow stretch: its own steady speed. */
// Its slowing starts within the beat before it, so the act's first beat already runs at its speed.
const actZone = (why: string, act: Act, ease = 3): Zone => ({ why, from: act.from - 2, to: act.to, ease, pace: act.speed / SPEED });

export const ZONES: Zone[] = [
  { why: 'The sea: the horizon and the islands, behind the boat', from: SEA.start, to: SEA.turn[0], ease: 2.5, pace: 0.09 },
  { why: 'The eyes turn along the coast to the shore', from: SEA.turn[0], to: SEA.turn[1], ease: 2, pace: 0.3 },
  { why: 'The crossing', from: SEA.turn[1], to: SEA.approach, ease: 4, pace: 0.72 },
  { why: 'The approach: the boat slows, comes alongside the landing stage, stops, settles', from: SEA.approach, to: SEA.ashore[0], ease: 5, pace: 0.3 },
  { why: 'Ashore: along the landing stage, onto the beach', from: SEA.ashore[0], to: SEA.ashore[1], ease: 3, pace: 0.36 },
  { why: 'Structurer: the beacon charges, the wave runs out, the title reads', from: STRUCTURE_AT - 14, to: STRUCTURE_AT + 2, ease: 6, pace: 0.34 },
  actZone('Comprendre, the ground examined, its badges; Clarifier les fondations, the paving, its badges', STRUCTURE_ACT),
  { why: 'Activer: the beacon charges, the title reads', from: ACTIVATE_AT - 13, to: ACTIVATE_AT + 2, ease: 6, pace: 0.34 },
  actZone('Les bons leviers: the note, then the levers rise', ACTIVATE_ACT),
  { why: 'The impulse bouncing from lever to lever, each with its badge', from: LEVERS_FIRST_IMPULSE, to: LEVERS_END, ease: 3, pace: 0.22 },
  actZone('Mesurer pour décider: the note, then the chart drawing itself', MEASURE_ACT),
  { why: 'Performer: the ring, the title, the arrival', from: PERFORM_AT - 6, to: END_AT, ease: 4, pace: 0.6 },
];

const smooth = THREE.MathUtils.smoothstep;

/** 0..1 over [a, b], 1 until c, back to 0 at e: a plateau with eased sides. */
export const plateau = (d: number, a: number, b: number, c: number, e: number) => smooth(d, a, b) * (1 - smooth(d, c, e));

/** Share of SPEED at this distance (1 between sequences). */
export function paceAt(distance: number): number {
  let pace = 1;
  for (const zone of ZONES) {
    const inside = plateau(distance, zone.from - zone.ease, zone.from, zone.to, zone.to + zone.ease);
    pace = Math.min(pace, 1 - (1 - zone.pace) * inside);
  }
  return pace;
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

/** « Mesurer pour décider »'s chart, on the right before the summit: the eyes go to it a little. */
const { chartBuild, chartDraw, chartGone } = MEASURE_ACT.beats;
export const CHART = {
  /** Where it stands along the path, and how far right of the lane (narrow screens: closer). */
  at: 193,
  offset: 6.4,
  narrowOffset: 2.6,
  /** Guide distances (timeline.ts): frame and axes draw in, the curve draws, it stays, it goes. */
  build: chartBuild,
  draw: chartDraw,
  gone: chartGone,
  look: [chartBuild[0] - 2, chartBuild[0] + 1.5, chartGone[0] - 0.5, chartGone[1] + 1.5] as [number, number, number, number],
  lookAmount: 0.62,
} as const;

/**
 * How much the eyes leave the path ahead, at this distance, for the levers and for the
 * chart (share of the way to them, terrain.ts). Eased in and out at both ends, so a turn
 * starts and ends gently; between the left and right levers it comes back to the path.
 */
export function lookWeights(distance: number) {
  return { levers: plateau(distance, ...LEVERS.look) * LEVERS.share, chart: plateau(distance, ...CHART.look) * CHART.lookAmount };
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

