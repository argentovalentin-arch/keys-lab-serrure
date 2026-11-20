import { ACTIVATE_AT, PERFORM_AT, STRUCTURE_AT } from './path';

/**
 * The ride's narration, in one place: in what order the titles, the notes, the effects
 * they announce and the badges with their holograms come, and how long each one has.
 *
 * The rules it follows:
 * - one text at a time: a landmark's title, a note and a badge never share the screen; a
 *   group of badges has gone before the next note comes, and the next title after that;
 * - a note that announces something shown in the scene (the ground examined, the paving
 *   laid, the levers, the chart) is read before that thing starts: the note, its time to be
 *   read, then the effect, then the badges that go with it;
 * - each badge has its own time in focus, its hologram built and then held to be read,
 *   before the next one comes.
 *
 * Everything is still tied to the guide's distance along the path (path.ts), never to a
 * timer, so the ride replays exactly at any frame rate. What is written here in seconds
 * is turned into distances: each act lays its beats end to end over the stretch of path
 * it has, and the ride crosses that stretch at the one steady speed that gives every beat
 * its seconds (pace.ts slows the ride to it, eased in and out).
 */

interface Beat {
  id: string;
  seconds: number;
}

export interface Act {
  /** The stretch of path the act covers, and the guide's speed over it (units per second). */
  from: number;
  to: number;
  speed: number;
  /** Each beat's stretch of path [from, to]. */
  beats: Record<string, [number, number]>;
}

/** Lays an act's beats end to end over [from, to], at the speed that gives each its seconds. */
function lay(from: number, to: number, beats: Beat[]): Act {
  const total = beats.reduce((sum, beat) => sum + beat.seconds, 0);
  const speed = (to - from) / total;
  const laid: Record<string, [number, number]> = {};
  let at = from;
  for (const beat of beats) {
    laid[beat.id] = [at, at + beat.seconds * speed];
    at += beat.seconds * speed;
  }
  return { from, to, speed, beats: laid };
}

/** How long a note shows (its fades included: the first and last sixth, notes.ts). */
const NOTE = 4.4;
/** A badge in focus: its hologram builds (about two seconds, ui/holograms.ts), then holds. */
const UNDERSTAND_BADGE = 5.8;
const FOUNDATIONS_BADGE = 5;
/** A group of badges going together, before the next note. */
const OUT = 1;

/**
 * The landmarks' titles (path.ts LANDMARKS): from as the beacon releases its wave (pace.ts,
 * BEACON) until just past the landmark, read while the ride slows through the beacon.
 * « Performer », the last, stays until the stop (terrain.ts).
 */
export const TITLES: Record<'Structurer' | 'Activer' | 'Performer', [number, number]> = {
  Structurer: [STRUCTURE_AT - 7, STRUCTURE_AT + 2],
  Activer: [ACTIVATE_AT - 7, ACTIVATE_AT + 2],
  Performer: [PERFORM_AT - 7, Infinity],
};

/**
 * « Structurer », from its title to « Activer »'s: « Comprendre avant de proposer. », then
 * the ground examined on both sides of the path, then the three things looked at first,
 * one badge at a time; they go together. Then « Clarifier les fondations. », then the
 * paving of the path starting under the visitor's eyes, then the four foundations, one at
 * a time; they go before « Activer »'s title.
 */
export const STRUCTURE_ACT = lay(TITLES.Structurer[1], TITLES.Activer[0], [
  { id: 'understandNote', seconds: NOTE },
  { id: 'scan', seconds: 1 },
  ...[0, 1, 2].map((i) => ({ id: `understand-${i}`, seconds: UNDERSTAND_BADGE })),
  { id: 'understandOut', seconds: OUT },
  { id: 'foundationsNote', seconds: NOTE },
  { id: 'paving', seconds: 2.6 },
  ...[0, 1, 2, 3].map((i) => ({ id: `foundations-${i}`, seconds: FOUNDATIONS_BADGE })),
  { id: 'foundationsOut', seconds: OUT },
]);

/**
 * « Activer », from its title to the first impulse (network.ts): « Les bons leviers. Pas
 * tous. », then the levers rising along the path (levers.ts), then the energy sets off.
 * The impulse's run from lever to lever, each named as it is reached, follows (pace.ts
 * LEVERS): it is laid out on the levers' own places.
 */
export const LEVERS_FIRST_IMPULSE = 134;
export const ACTIVATE_ACT = lay(TITLES.Activer[1], LEVERS_FIRST_IMPULSE, [
  { id: 'leversNote', seconds: NOTE },
  { id: 'leversReveal', seconds: 1.6 },
]);
/** Where the impulse's run ends, its last lever named and gone. */
export const LEVERS_END = 169;

/**
 * « Mesurer pour décider. », then the chart building, drawing its curve step by step,
 * held to be read, gone before « Performer »'s title.
 */
export const MEASURE_ACT = lay(LEVERS_END, TITLES.Performer[0], [
  { id: 'measureNote', seconds: NOTE },
  { id: 'chartBuild', seconds: 1.4 },
  { id: 'chartDraw', seconds: 4.4 },
  { id: 'chartHold', seconds: 3.4 },
  { id: 'chartGone', seconds: 1.2 },
]);

/**
 * The ending, in seconds after the ride has stopped on the summit (terrain.ts):
 * 1. arrival: the camera settles, « Performer » still showing;
 * 2. « Chaque résultat relié à une action. », read alone; then its three badges, one after
 *    the other, each an action and what it produces, with the arcs to the keys (summit.ts);
 * 3. the key ring taken in hand, the half-turn to look down over the whole climb, the sea and
 *    the islands;
 * 4. the eyes rise to the horizon, the curve draws itself, the closing choices.
 */
const ENDING_NOTE: [number, number] = [2.4, 5.8];
/** The three badges come in at these times, and stay until the actions end. */
const ENDING_BADGES = [6, 7.25, 8.5];
const ACTIONS_END = 11.8;
/** Everything from the key ring on moves together, after the actions. */
const AFTER = ACTIONS_END - 8.8;
export const ENDING = {
  pause: [0, 2.4] as [number, number],
  note: ENDING_NOTE,
  badges: ENDING_BADGES,
  actions: [ENDING_NOTE[1], ACTIONS_END] as [number, number],
  hand: ACTIONS_END - 0.2,
  reliefIn: [8.6 + AFTER, 10 + AFTER] as [number, number],
  frontHorizonOut: [9.4 + AFTER, 10.4 + AFTER] as [number, number],
  turn: [10 + AFTER, 13.6 + AFTER] as [number, number],
  deepen: [11.2 + AFTER, 14.2 + AFTER] as [number, number],
  fieldOut: [13.2 + AFTER, 14.2 + AFTER] as [number, number],
  ringSway: [14.8 + AFTER, 17.6 + AFTER] as [number, number],
  ringLowered: [19 + AFTER, 19.8 + AFTER] as [number, number],
  lookUp: [19.8 + AFTER, 22 + AFTER] as [number, number],
  curveDrawn: [20.4 + AFTER, 23.4 + AFTER] as [number, number],
  choicesAt: 23.7 + AFTER,
};

/** Every text of the ride with its stretch, in order (for the checks below and for tests). */
export function narration(): { what: string; from: number; to: number }[] {
  const { beats: s } = STRUCTURE_ACT;
  return [
    { what: 'title Structurer', from: TITLES.Structurer[0], to: TITLES.Structurer[1] },
    { what: 'note understand', from: s.understandNote[0], to: s.understandNote[1] },
    { what: 'badges understand', from: s['understand-0'][0], to: s.understandOut[1] },
    { what: 'note foundations', from: s.foundationsNote[0], to: s.foundationsNote[1] },
    { what: 'badges foundations', from: s['foundations-0'][0], to: s.foundationsOut[1] },
    { what: 'title Activer', from: TITLES.Activer[0], to: TITLES.Activer[1] },
    { what: 'note levers', from: ACTIVATE_ACT.beats.leversNote[0], to: ACTIVATE_ACT.beats.leversNote[1] },
    { what: 'note measure', from: MEASURE_ACT.beats.measureNote[0], to: MEASURE_ACT.beats.measureNote[1] },
    { what: 'title Performer', from: TITLES.Performer[0], to: TITLES.Performer[1] },
  ];
}

// In development, a text that would share the screen with the next one is reported at once.
if (import.meta.env.DEV) {
  const texts = narration();
  for (let i = 1; i < texts.length; i++) {
    if (texts[i].from < texts[i - 1].to - 1e-6) console.warn('KEYS Lab timeline: overlap', texts[i - 1].what, '/', texts[i].what);
  }
}
