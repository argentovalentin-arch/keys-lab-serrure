import * as THREE from 'three/webgpu';
import { ACTIVATE_AT, END_AT, PERFORM_AT, STRUCTURE_AT } from './path';

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

export const ZONES: Zone[] = [
  { why: 'Structurer: the beacon charges, the wave runs out, the title reads', from: STRUCTURE_AT - 14, to: STRUCTURE_AT + 7, ease: 6, pace: 0.42 },
  { why: 'Comprendre, then Clarifier les fondations: two notes, their badges one at a time from just past the beacon, the paving', from: STRUCTURE_AT + 1, to: 118, ease: 4, pace: 0.26 },
  { why: 'Activer: the beacon charges, the title reads', from: ACTIVATE_AT - 13, to: ACTIVATE_AT + 7, ease: 6, pace: 0.42 },
  { why: 'The levers: the note, then the left ones, then the right ones', from: ACTIVATE_AT + 8, to: 169, ease: 4, pace: 0.32 },
  { why: 'Mesurer pour décider: the note, then the chart drawing itself', from: 170, to: 188, ease: 4, pace: 0.3 },
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
 * The levers' discovery (terrain.ts): a few levers on the left of the lane, then a few on the
 * right, well apart; only three are thrown, the three actions the summit links to a result
 * (Contenu, Campagnes Ads, CRM: see the summit's badges in terrain.ts), so the levers the
 * visitor sees thrown are the keys they are given at the top. The eyes go to the left ones
 * first, to each chosen lever as it is thrown, come back to the path, then go to the right.
 */
export const LEVERS = {
  /** Each lever: where it stands along the path, on which side, and whether it is thrown. */
  row: [
    { at: 141, side: -1, chosen: false },
    { at: 146, side: -1, chosen: true }, // Contenu
    { at: 150.5, side: -1, chosen: false },
    { at: 155, side: 1, chosen: false },
    { at: 159, side: 1, chosen: true }, // Campagnes Ads
    { at: 163.5, side: 1, chosen: false },
    { at: 167, side: 1, chosen: true }, // CRM & fidélisation
  ],
  /** When the eyes are on the left ones, then on the right ones: [turning, turned, back, ahead]. */
  lookLeft: [139, 142, 148.5, 151.5] as const,
  lookRight: [151.5, 154.5, 165.5, 169] as const,
  /** How far the gaze goes from the path ahead to the lever (share of the way). A glance, not a swing. */
  look: 0.5,
} as const;

/** « Mesurer pour décider »'s chart, on the right before the summit: the eyes go to it a little. */
export const CHART = {
  /** Where it stands along the path, and how far right of the lane (narrow screens: closer). */
  at: 193,
  offset: 6.4,
  narrowOffset: 2.6,
  /** Guide distances: frame and axes draw in, the curve draws, it stays, it goes. */
  build: [172, 174.5] as const,
  draw: [174.5, 181.5] as const,
  gone: [189.5, 192] as const,
  look: [172.5, 176.5, 188.5, 191.5] as const,
  lookAmount: 0.62,
} as const;

/**
 * How much the eyes leave the path ahead, at this distance, for the levers and for the
 * chart (share of the way to them, terrain.ts). Eased in and out at both ends, so a turn
 * starts and ends gently; between the left and right levers it comes back to the path.
 */
export function lookWeights(distance: number) {
  const levers = Math.max(plateau(distance, ...LEVERS.lookLeft), plateau(distance, ...LEVERS.lookRight));
  return { levers: levers * LEVERS.look, chart: plateau(distance, ...CHART.look) * CHART.lookAmount };
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

/** How long a landmark's title shows around it (guide distances before and after it). */
export const WORD = { before: 7, after: 7 } as const;
