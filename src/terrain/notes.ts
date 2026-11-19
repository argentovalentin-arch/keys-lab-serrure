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

// Landmarks at 60, 125, 195 (path.ts); their titles show from 7 before to 7 after
// (pace.ts, WORD): free path 68..117 and 133..187. Each note comes right after what
// introduces it, and the ride slows over its stretch (pace.ts), so it reads in full.
// The ride stops at 203.
const RIDE: RideNote[] = [
  // Structurer → Activer: understand the situation, then lay clear foundations
  // (« Clarifier les fondations », the site's Structurer), straight after.
  { topic: 'understand', from: 68, to: 86, side: -1, text: 'Comprendre *avant* de proposer.' },
  { topic: 'foundations', from: 88, to: 108, side: 1, text: 'Clarifier les *fondations*.' },
  // Activer → Performer: the right levers, not all of them, read before they are shown
  // (left, then right); then measuring to decide, read before the chart draws itself.
  { topic: 'levers', from: 133, to: 145, side: 1, text: 'Les *bons* leviers. Pas tous.' },
  { topic: 'measure', from: 170, to: 181, side: -1, text: 'Mesurer pour *décider*.' },
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
