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
 * out of the distance and is about to be passed as it fades. The stretches share out
 * the gaps between the landmarks' titles evenly, with clear room before and after each
 * title. On the summit the last one hangs over the start, far below, over a span of
 * seconds after the stop, while the visitor looks back.
 */
export interface Note {
  text: string;
  /** -1 left of the path, 1 right of it, 0 centred over its anchor. */
  side: -1 | 0 | 1;
}

/** What each ride note is about; the Terrain shows something in the scene for each (terrain.ts). */
export type NoteTopic = 'understand' | 'foundations' | 'levers' | 'measure';

interface RideNote extends Note {
  topic: NoteTopic;
  from: number;
  to: number;
}

// Landmarks at 60, 125, 195 (path.ts); their titles show from 11 before to 5 after
// (terrain.ts): free path 65..114 and 130..184. Two notes on each, sharing it evenly:
// the first right after the title, the last well before the next one. The ride stops at 203.
const RIDE: RideNote[] = [
  // Structurer → Activer: understand the situation, then lay clear foundations
  // (« Clarifier les fondations », the site's Structurer).
  { topic: 'understand', from: 66, to: 88, side: -1, text: 'Comprendre *avant* de proposer.' },
  { topic: 'foundations', from: 90, to: 112, side: 1, text: 'Clarifier les *fondations*.' },
  // Activer → Performer: the right levers, not all of them; then measuring to decide.
  { topic: 'levers', from: 131, to: 155, side: 1, text: 'Les *bons* leviers. Pas tous.' },
  { topic: 'measure', from: 157, to: 181, side: -1, text: 'Mesurer pour *décider*.' },
];

/** The stretch of path (guide distances) over which the note on a topic shows. */
export function noteStretch(topic: NoteTopic): { from: number; to: number } {
  const note = RIDE.find((n) => n.topic === topic)!;
  return { from: note.from, to: note.to };
}

/** How far past the end of its stretch a note stands. */
const NOTE_LEAD = 9;

/** On the summit, looking back down the climb: every result traced back to an action. */
const SUMMIT: Note & { afterStop: [number, number] } = {
  side: 0,
  afterStop: [2.6, 8.8], // still facing ahead, before the half-turn (terrain.ts, ACTIONS)
  text: 'Chaque résultat relié à *une action*.',
};

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
    const [from, to] = SUMMIT.afterStop;
    return sinceStop >= from && sinceStop < to ? { note: SUMMIT, at: null, t: (sinceStop - from) / (to - from) } : null;
  }
  for (const note of RIDE) {
    if (distance >= note.from && distance < note.to) {
      return { note, at: note.to + NOTE_LEAD, t: (distance - note.from) / (note.to - note.from) };
    }
  }
  return null;
}
