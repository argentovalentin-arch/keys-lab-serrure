import { ACTIVATE_AT, PERFORM_AT, STRUCTURE_AT } from './path';
import { HOLO_BUILD, HOLO_DELAY, type Illustration } from '../ui/holograms';

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
  /** How fast the ride goes over it, relative to the act's reading speed (1); a stretch between two badges goes faster. */
  rate?: number;
}

export interface Act {
  /** The stretch of path the act covers, and the guide's reading speed over it (units per second). */
  from: number;
  to: number;
  speed: number;
  /** Each beat's stretch of path [from, to]. */
  beats: Record<string, [number, number]>;
  /** The beats in order, each with its own speed (units per second): pace.ts eases from one to the next. */
  order: { id: string; from: number; to: number; speed: number }[];
}

/**
 * The ride's overall tempo: every act's beats are this much shorter than written, and the
 * cruising speed this much higher (pace.ts). A touch livelier than the reading pace set
 * first, without touching the titles, the levers' run or the holograms' own build.
 */
export const TEMPO = 1.04;

/**
 * Lays an act's beats end to end over [from, to]: each beat gets its seconds (at TEMPO), at
 * the act's reading speed times its own rate; the reading speed is the one that makes them
 * all fit the act's stretch of path.
 */
function lay(from: number, to: number, beats: Beat[]): Act {
  const weighted = beats.reduce((sum, beat) => sum + beat.seconds * (beat.rate ?? 1), 0) / TEMPO;
  const speed = (to - from) / weighted;
  const laid: Record<string, [number, number]> = {};
  const order: Act['order'] = [];
  let at = from;
  for (const beat of beats) {
    const beatSpeed = speed * (beat.rate ?? 1);
    const length = (beat.seconds / TEMPO) * beatSpeed;
    laid[beat.id] = [at, at + length];
    order.push({ id: beat.id, from: at, to: at + length, speed: beatSpeed });
    at += length;
  }
  return { from, to, speed, beats: laid, order };
}

/** How long a note shows (its fades included: the first and last sixth, notes.ts). */
const NOTE = 4.4;
/**
 * A badge in focus, the ride slowed for it: its hologram's own presentation (it starts after
 * HOLO_DELAY, builds over HOLO_BUILD, ui/holograms.ts), then held long enough to be read.
 */
const READ = 2.4;
const observe = (kind: Illustration) => HOLO_DELAY + 0.25 + HOLO_BUILD[kind] + READ;
/** Between two badges the ride picks up: this long, this much faster than while reading. */
const TRAVEL = 0.9;
const TRAVEL_RATE = 3.2;
/** A group of badges going together, before the next note. */
const OUT = 0.6;

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
 * the ground examined on both sides of the path, then the three things looked at first;
 * they go together. Then « Clarifier les fondations. », the paving of the path starting
 * half a second after it comes in, then the four foundations; they go, and the ride moves
 * on, picking up, to « Activer ».
 *
 * The ride alternates: between two badges it picks up, as a badge comes it slows down, and
 * it stays slow while the badge's hologram builds and is read; then it picks up again.
 */
const UNDERSTAND: Illustration[] = ['scan', 'block', 'flow'];
const FOUNDATIONS: Illustration[] = ['target', 'priorities', 'journey', 'roadmap'];
export const STRUCTURE_ACT = lay(TITLES.Structurer[1], TITLES.Activer[0], [
  { id: 'understandNote', seconds: NOTE },
  { id: 'scan', seconds: 0.6, rate: 1.4 },
  // The ground examined is the way into the first of them: no run before it.
  ...UNDERSTAND.flatMap((kind, i) => [
    ...(i > 0 ? [{ id: `understandTravel-${i}`, seconds: TRAVEL, rate: TRAVEL_RATE }] : []),
    // The last of a group has no run after it to be read through: it holds that much longer.
    { id: `understand-${i}`, seconds: observe(kind) + (i === UNDERSTAND.length - 1 ? TRAVEL : 0) },
  ]),
  { id: 'understandOut', seconds: OUT, rate: 2 },
  { id: 'foundationsNote', seconds: NOTE },
  ...FOUNDATIONS.flatMap((kind, i) => [
    { id: `foundationsTravel-${i}`, seconds: TRAVEL, rate: TRAVEL_RATE },
    { id: `foundations-${i}`, seconds: observe(kind) + (i === FOUNDATIONS.length - 1 ? TRAVEL : 0) },
  ]),
  { id: 'foundationsOut', seconds: OUT, rate: 2 },
  // Then on to « Activer », at a livelier pace: room between the two stages.
  { id: 'onward', seconds: 2.8, rate: TRAVEL_RATE },
]);
/**
 * The paving of the path sets off as « Clarifier les fondations. » comes in (its fade-in makes
 * it visible a moment after its stretch starts): the lane's matter gathers, and the first
 * pavers form half a second later (pavement.ts, FIRST_FORMS).
 */
export const PAVING_AT = (() => {
  const note = STRUCTURE_ACT.order.find((b) => b.id === 'foundationsNote')!;
  return note.from + note.speed * 0.25;
})();

/**
 * « Activer », from its title to the first impulse (network.ts): « Les bons leviers. Pas
 * tous. », then the levers rising along the path (levers.ts), then the energy sets off.
 * The impulse's run from lever to lever, each named as it is reached, follows (pace.ts
 * LEVERS): it is laid out on the levers' own places.
 */
export const LEVERS_FIRST_IMPULSE = 134;
export const ACTIVATE_ACT = lay(TITLES.Activer[1], LEVERS_FIRST_IMPULSE, [
  { id: 'leversNote', seconds: NOTE },
  { id: 'leversReveal', seconds: 1.2 },
]);
/** Where the impulse's run ends, its last lever named and gone. */
export const LEVERS_END = 169;

/**
 * The summit's closing scene, in seconds after the ride has stopped (terrain.ts). One scene,
 * its beats laid end to end, each starting once the one before has done its work:
 * 1. arrival: the camera settles on the top, « Performer » still showing;
 * 2. « Mesurer pour décider. » and its chart (monitor.ts), one event: the note comes in as the
 *    chart's frame and pillars draw in; its curve draws through the method's six steps while
 *    the note is read; it holds; it draws back into its source as the note goes;
 * 3. the three actions, one at a time: each badge with its own hologram, in focus until the
 *    next comes (ui/holograms.ts: « reach », « acquire », « owned »);
 * 4. once all three have been shown, a thread of light links them (summit.ts): three parts
 *    of one whole;
 * 5. then each action gives its key: from each badge an arc goes down to where its key
 *    forms, with « Chaque résultat relié à une action. » (one event, as before);
 * 6. the keys, all formed, gather on their ring: the key ring; the note goes as it closes;
 * 7. the ring taken in hand, the half-turn to look down over the whole climb, the sea and
 *    the islands; the eyes rise to the horizon, the curve draws itself, the closing choices.
 */
const MEASURE = {
  note: [2.6, 9.6] as [number, number],
  build: [2.6, 3.8] as [number, number],
  draw: [3.6, 7.2] as [number, number],
  gone: [9.0, 9.9] as [number, number],
};
/** Each action badge comes in, its hologram in focus until the next one comes. */
const ENDING_BADGES = [10.1, 14.7, 19.3];
const HOLO_SPAN = 4.6;
/** The thread linking the three actions, once the last one has been read. */
const LINK: [number, number] = [ENDING_BADGES[2] + HOLO_SPAN + 0.1, ENDING_BADGES[2] + HOLO_SPAN + 1.3];
/** Then the keys: each arc sets off from its action, a fifth of a second apart, with the note. */
const KEYS_AT = [LINK[1] + 0.1, LINK[1] + 0.3, LINK[1] + 0.5];
const ENDING_NOTE: [number, number] = [KEYS_AT[0], KEYS_AT[0] + 3.6];
const GATHER = KEYS_AT[0] + 1.6;
/** The actions go as the ring is taken in hand. */
const ACTIONS_END = ENDING_NOTE[1] + 0.2;
/** Everything from the key ring in hand on moves together, after the actions. */
const AFTER = ACTIONS_END - 8.8;
export const ENDING = {
  pause: [0, 2.4] as [number, number],
  /** « Mesurer pour décider. » and its chart (pace.ts CHART). */
  measure: MEASURE,
  badges: ENDING_BADGES,
  /** Each action's hologram in focus: [from, to]. */
  holos: ENDING_BADGES.map((at) => [at, at + HOLO_SPAN] as [number, number]),
  link: LINK,
  note: ENDING_NOTE,
  /** When each key's arc sets off, and when the keys gather on the ring (summit.ts). */
  keys: KEYS_AT,
  gather: GATHER,
  actions: [ENDING_BADGES[0], ACTIONS_END] as [number, number],
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
