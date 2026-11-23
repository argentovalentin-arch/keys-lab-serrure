import { ACTIVATE_ACT, ENDING, STRUCTURE_ACT } from './timeline';

/**
 * A few short markers for the visitor, set in the scene beside the path between the
 * landmarks: what each of the three stages means at Keys Performance. Each one is taken
 * from the keysperformance.com home page; none promises a result, as the site does not.
 *
 * Text: plain words, with *one word* in italics (the brand's titles do the same), and a
 * full stop drawn in champagne, as in the « keys. » wordmark.
 *
 * During the ride a note shows while the guide covers its stretch of path (`from`..`to`),
 * standing on one side at a point a little ahead of the end of that stretch, so it comes
 * out of the distance and is about to be passed as it fades. The stretches come from the
 * narration (timeline.ts): each note alone, before what it introduces. On the summit the
 * last one stands over the top, ahead, over a span of seconds after the stop.
 */
export interface Note {
  text: string;
  /** -1 left of the path, 1 right of it, 0 centred over its anchor. */
  side: -1 | 0 | 1;
  /** On the summit: how high over the eye it stands (world units, terrain.ts). */
  over?: number;
}

/** What each ride note is about; the Terrain shows something in the scene for each (terrain.ts). */
export type NoteTopic = 'understand' | 'foundations' | 'levers';

interface RideNote extends Note {
  topic: NoteTopic;
  from: number;
  to: number;
}

const stretch = ([from, to]: [number, number]) => ({ from, to });

// Each note has its own beat in the narration (timeline.ts): alone on screen, between the
// title and the badges it introduces, and read before what it announces is shown in the
// scene (the ground examined, the paving, the levers, the chart). The ride slows over its
// stretch, so it reads in full.
const RIDE: RideNote[] = [
  // Structurer → Activer: understand the situation, then lay clear foundations
  // (« Clarifier les fondations », the site's Structurer).
  { topic: 'understand', ...stretch(STRUCTURE_ACT.beats.understandNote), side: -1, text: 'Comprendre *avant* de proposer.' },
  { topic: 'foundations', ...stretch(STRUCTURE_ACT.beats.foundationsNote), side: 1, text: 'Clarifier les *fondations*.' },
  // Activer → Performer: the right levers, not all of them, read before they rise and the
  // energy runs through them. Measuring to decide belongs to the summit (below).
  { topic: 'levers', ...stretch(ACTIVATE_ACT.beats.leversNote), side: 1, text: 'Les *bons* leviers. Pas tous.' },
];

/** The stretch of path (guide distances) over which the note on a topic shows. */
export function noteStretch(topic: NoteTopic): { from: number; to: number } {
  const note = RIDE.find((n) => n.topic === topic)!;
  return { from: note.from, to: note.to };
}

/** How far past the end of its stretch a note stands. */
const NOTE_LEAD = 9;

/**
 * On the summit, still facing ahead (timeline.ts, ENDING): measuring to decide, with its
 * chart; then every result traced back to an action, with its keys.
 */
const SUMMIT: (Note & { afterStop: [number, number] })[] = [
  // Over its chart, which stands up by the horizon (pace.ts, CHART.lift).
  { side: 0, afterStop: ENDING.measure.note, over: 5.7, text: 'Mesurer pour *décider*.' },
  { side: 0, afterStop: ENDING.note, text: 'Chaque résultat relié à *une action*.' },
];

export interface NoteState {
  note: Note;
  /** Where the note stands: a distance along the path, or null for the summit note (over the start). */
  at: number | null;
  /** 0..1 through the span it shows over. */
  t: number;
}

/**
 * The note to show, if any: from the distance along the path while riding, from the
 * seconds since the stop once on the summit (`sinceStop`, null while riding).
 */
export function noteAt(distance: number, sinceStop: number | null): NoteState | null {
  if (sinceStop !== null) {
    const note = SUMMIT.find(({ afterStop: [from, to] }) => sinceStop >= from && sinceStop < to);
    return note ? { note, at: null, t: (sinceStop - note.afterStop[0]) / (note.afterStop[1] - note.afterStop[0]) } : null;
  }
  for (const note of RIDE) {
    if (distance >= note.from && distance < note.to) {
      return { note, at: note.to + NOTE_LEAD, t: (distance - note.from) / (note.to - note.from) };
    }
  }
  return null;
}
