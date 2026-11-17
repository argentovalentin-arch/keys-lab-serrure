import type Lenis from 'lenis';
import type * as THREE from 'three/webgpu';
import type { NoteView, TagView, Terrain } from '../terrain/terrain';
import type { Landmark } from '../terrain/path';
import { ICONS } from '../terrain/icons';

type Mode = 'story' | 'entering' | 'terrain' | 'leaving';

const VEIL_MS = 950; // a little over the .veil transition in style.css
const PUSH_SECONDS = 1.1;
const MESSAGE_MS = 5000;
const HINT_MS = 8000;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export interface EpilogueOptions {
  renderer: THREE.WebGPURenderer;
  lenis: Lenis;
  /** The « Entrer » button; focus returns to it on the way out. */
  trigger: HTMLButtonElement;
  /** Field particles for the Terrain, read when entering (the quality tier may have changed). */
  fieldCount: () => number;
}

/**
 * Entry into and exit from the Terrain epilogue. The scroll never leads there: only
 * the « Entrer » button does. While inside, Lenis is paused and the page cannot scroll;
 * leaving (button or Escape) puts the page back exactly where it was.
 */
export class Epilogue {
  private mode: Mode = 'story';
  private terrain: Terrain | null = null;
  private savedScroll = 0;
  private pushStart = 0;
  private timers: number[] = [];
  private readonly veil = document.querySelector<HTMLElement>('#veil')!;
  private readonly ui = document.querySelector<HTMLElement>('#terrain-ui')!;
  private readonly message = document.querySelector<HTMLElement>('#terrain-message')!;
  private readonly hint = document.querySelector<HTMLElement>('#terrain-hint')!;
  private readonly word = document.querySelector<HTMLElement>('#terrain-word')!;
  private readonly wordStep = document.querySelector<HTMLElement>('#terrain-word-step')!;
  private readonly wordLabel = document.querySelector<HTMLElement>('#terrain-word-label')!;
  private readonly wordName = document.querySelector<HTMLElement>('#terrain-word-name')!;
  private readonly note = document.querySelector<HTMLElement>('#terrain-note')!;
  private readonly tagLayer = document.querySelector<HTMLElement>('#terrain-tags')!;
  private readonly tagElements = new Map<string, { root: HTMLElement; thread: HTMLElement; label: HTMLElement }>();
  private noteText: string | null = null;
  private readonly close = document.querySelector<HTMLButtonElement>('#terrain-close')!;
  private readonly end = document.querySelector<HTMLElement>('#terrain-end')!;
  private readonly replay = document.querySelector<HTMLButtonElement>('#terrain-replay')!;
  private readonly back = document.querySelector<HTMLButtonElement>('#terrain-back')!;

  constructor(private readonly options: EpilogueOptions) {
    options.trigger.addEventListener('click', () => void this.enter());
    this.close.addEventListener('click', () => void this.leave());
    this.back.addEventListener('click', () => void this.leave());
    this.replay.addEventListener('click', () => {
      if (this.mode !== 'terrain') return;
      this.end.hidden = true;
      this.terrain?.restart();
      this.close.focus();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.mode === 'terrain') void this.leave();
    });
  }

  /** True while the Terrain draws the frame instead of the story. */
  get inTerrain(): boolean {
    return this.mode === 'terrain' || (this.mode === 'leaving' && this.terrain !== null);
  }

  /** 0..1 camera push into the doorway while the light comes up; 0 the rest of the time. */
  get push(): number {
    if (this.mode !== 'entering') return 0;
    const t = Math.min(1, (performance.now() - this.pushStart) / 1000 / PUSH_SECONDS);
    return t * t * (3 - 2 * t);
  }

  /** Runs and draws the Terrain for this frame. */
  frame(dt: number): void {
    this.terrain?.frame(dt);
    this.terrain?.render();
  }

  private async enter(): Promise<void> {
    if (this.mode !== 'story') return;
    this.mode = 'entering';
    this.savedScroll = window.scrollY;
    this.options.lenis.stop();
    document.documentElement.classList.add('is-terrain');
    this.pushStart = performance.now();
    this.veil.classList.remove('is-dark', 'is-slow');
    this.veil.classList.add('is-on');

    try {
      // The module and its shaders load while the light covers the screen.
      const [terrain] = await Promise.all([
        import('../terrain/terrain').then(({ createTerrain }) =>
          createTerrain({
            renderer: this.options.renderer,
            fieldCount: this.options.fieldCount(),
            surface: this.ui,
            onWord: (word) => this.showWord(word),
            onNote: (note) => this.showNote(note),
            onTags: (tags) => this.showTags(tags),
            onEnd: () => this.showChoices(),
          })),
        wait(VEIL_MS),
      ]);
      this.terrain = terrain;
      if (import.meta.env.DEV) Object.assign(window, { __terrain: terrain });
    } catch (error) {
      console.error('KEYS Lab: the Terrain could not start', error);
      this.restoreStory();
      return;
    }

    this.mode = 'terrain';
    this.ui.hidden = false;
    this.message.classList.remove('is-hidden');
    this.hint.classList.remove('is-hidden');
    this.close.focus();
    this.veil.classList.add('is-slow');
    this.veil.classList.remove('is-on');
    this.timers.push(
      window.setTimeout(() => this.message.classList.add('is-hidden'), MESSAGE_MS),
      window.setTimeout(() => this.hint.classList.add('is-hidden'), HINT_MS),
    );
  }

  private async leave(): Promise<void> {
    if (this.mode !== 'terrain') return;
    this.mode = 'leaving';
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
    this.veil.classList.remove('is-slow');
    this.veil.classList.add('is-dark', 'is-on');
    await wait(VEIL_MS);
    this.terrain?.dispose();
    this.terrain = null;
    this.restoreStory();
  }

  /**
   * A landmark's name, with what the stage is about over it, fades in; when it goes, it
   * fades out before the text is cleared.
   */
  private showWord(landmark: Landmark | null): void {
    if (landmark) {
      this.wordStep.textContent = `Étape ${String(landmark.step).padStart(2, '0')}`;
      this.wordLabel.textContent = landmark.label;
      // One span per letter, so the name can come in letter by letter (style.css), and the
      // full stop of the « keys. » wordmark in champagne.
      this.wordName.setAttribute('aria-label', landmark.word);
      this.wordName.replaceChildren(
        ...[...landmark.word].map((letter, i) => {
          const span = document.createElement('span');
          span.textContent = letter;
          span.style.setProperty('--i', String(i));
          span.setAttribute('aria-hidden', 'true');
          return span;
        }),
        Object.assign(document.createElement('span'), { className: 'terrain-ui__dot', textContent: '.', ariaHidden: 'true' }),
      );
      this.word.classList.remove('is-hidden');
      // The welcome message makes way if a landmark comes up while it still shows.
      this.message.classList.add('is-hidden');
    } else {
      this.word.classList.add('is-hidden');
    }
  }

  /**
   * The note of the moment, drawn where the Terrain places it in the scene (every frame):
   * its anchor's screen position, its scale and its fade all come from there.
   */
  private showNote(view: NoteView | null): void {
    if (!view) {
      this.note.style.opacity = '0';
      return;
    }
    if (view.note.text !== this.noteText) {
      this.noteText = view.note.text;
      this.note.replaceChildren(...noteNodes(view.note.text));
    }
    let x = ((view.x + 1) / 2) * window.innerWidth;
    const y = ((1 - view.y) / 2) * window.innerHeight;
    // In the bends the anchor can come near the edge: the text is kept whole on screen.
    const width = this.note.offsetWidth * view.scale;
    const margin = Math.min(48, window.innerWidth * 0.05);
    const [minX, maxX] = view.align === -1
      ? [margin + width, window.innerWidth - margin]
      : view.align === 1
        ? [margin, window.innerWidth - margin - width]
        : [margin + width / 2, window.innerWidth - margin - width / 2];
    x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
    // The text ends at the anchor (left of the path), starts there (right), or is centred on it.
    const shift = view.align === -1 ? '-100%' : view.align === 1 ? '0%' : '-50%';
    this.note.style.textAlign = view.align === -1 ? 'right' : view.align === 1 ? 'left' : 'center';
    this.note.style.transformOrigin = view.align === -1 ? 'right center' : view.align === 1 ? 'left center' : 'center';
    this.note.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${shift}, -50%) scale(${view.scale.toFixed(3)})`;
    this.note.style.opacity = view.opacity.toFixed(3);
  }

  /**
   * The labels in the scene, where the Terrain places them this frame: each one or two
   * icons in a small badge with a few words under it, over a dotted thread down to the
   * point it belongs to. A label pops in the first time it shows
   * (style.css) and goes when the Terrain stops listing it.
   */
  private showTags(views: TagView[]): void {
    const seen = new Set<string>();
    const w = window.innerWidth;
    const h = window.innerHeight;
    // What labels must stay clear of: the landmark's title and the note, when they show,
    // then the labels already placed this frame (screen boxes).
    type Box = { left: number; right: number; top: number; bottom: number };
    const placed: Box[] = [];
    const keepClear = (element: HTMLElement, shown: boolean) => {
      if (!shown) return;
      const r = element.getBoundingClientRect();
      if (r.width > 0) placed.push({ left: r.left - 12, right: r.right + 12, top: r.top - 10, bottom: r.bottom + 10 });
    };
    keepClear(this.wordName, !this.word.classList.contains('is-hidden'));
    keepClear(this.wordStep.parentElement!, !this.word.classList.contains('is-hidden'));
    keepClear(this.note, parseFloat(this.note.style.opacity || '0') > 0.05);
    // Nearest first (lowest on screen), so the farther ones are the ones moved up.
    const ordered = [...views].sort((p, q) => q.ly - p.ly);
    for (const view of ordered) {
      seen.add(view.id);
      let element = this.tagElements.get(view.id);
      if (!element) {
        const root = document.createElement('div');
        root.className = 'terrain-tag';
        const thread = document.createElement('span');
        thread.className = 'terrain-tag__thread';
        const label = document.createElement('span');
        label.className = 'terrain-tag__label';
        // Our own static SVG (icons.ts), never content from elsewhere.
        const badge = document.createElement('span');
        badge.className = 'terrain-tag__badge';
        badge.innerHTML = view.icons.map((name) => `<span class="terrain-tag__icon">${ICONS[name]}</span>`).join('');
        const caption = document.createElement('span');
        caption.className = 'terrain-tag__caption';
        caption.textContent = view.caption;
        label.append(badge, caption);
        root.append(thread, label);
        this.tagLayer.append(root);
        element = { root, thread, label };
        this.tagElements.set(view.id, element);
      }
      const gx = ((view.gx + 1) / 2) * w;
      const gy = ((1 - view.gy) / 2) * h;
      // The name is kept whole on screen; the thread still reaches its point.
      const half = element.label.offsetWidth / 2;
      const margin = 16;
      const lx = Math.min(Math.max(((view.lx + 1) / 2) * w, margin + half), w - margin - half);
      let ly = ((1 - view.ly) / 2) * h;
      // Nothing is covered: a label that would overlap the title, the note or another label
      // moves just clear of it, above or below, whichever is nearer and free (its thread
      // still reaches its point).
      const height = element.label.offsetHeight + 4;
      const hits = (y: number) => placed.find((r) => lx - half < r.right && lx + half > r.left && y - height < r.bottom && y > r.top);
      for (let pass = 0; pass < 6; pass++) {
        const hit = hits(ly);
        if (!hit) break;
        const above = hit.top - 2;
        const below = hit.bottom + height + 2;
        const candidates = [above, below]
          .filter((y) => y - height > 8 && y < h - 8)
          .sort((p, q) => Math.abs(p - ly) - Math.abs(q - ly));
        const free = candidates.find((y) => !hits(y));
        ly = free ?? candidates[0] ?? above;
      }
      placed.push({ left: lx - half - 4, right: lx + half + 4, top: ly - height, bottom: ly });
      element.root.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
      // Secondary to the note: never quite as bright.
      element.root.style.opacity = (view.opacity * 0.92).toFixed(3);
      // The thread runs from the label down to its point.
      const length = Math.hypot(gx - lx, gy - ly);
      const angle = Math.atan2(gy - ly, gx - lx);
      element.thread.style.width = `${length.toFixed(1)}px`;
      element.thread.style.transform = `rotate(${angle.toFixed(4)}rad)`;
    }
    for (const [id, element] of this.tagElements) {
      if (!seen.has(id)) {
        element.root.remove();
        this.tagElements.delete(id);
      }
    }
  }

  /** Once the curve has formed: the three closing choices, focus on the first. */
  private showChoices(): void {
    this.hint.classList.add('is-hidden');
    this.end.hidden = false;
    this.end.querySelector<HTMLElement>('a, button')?.focus();
  }

  private restoreStory(): void {
    this.ui.hidden = true;
    this.showNote(null);
    this.noteText = null;
    this.showTags([]);
    this.end.hidden = true;
    document.documentElement.classList.remove('is-terrain');
    window.scrollTo(0, this.savedScroll);
    this.options.lenis.start();
    this.options.lenis.scrollTo(this.savedScroll, { immediate: true, force: true });
    this.mode = 'story';
    this.veil.classList.remove('is-on');
    this.options.trigger.focus();
  }
}

/**
 * A note's text as nodes, in the brand's way: *one word* in italics, and the closing full
 * stop in champagne, as in the « keys. » wordmark. Built as nodes, never parsed as HTML.
 */
function noteNodes(text: string): Node[] {
  const nodes: Node[] = [];
  const body = text.endsWith('.') ? text.slice(0, -1) : text;
  body.split('*').forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      const em = document.createElement('em');
      em.textContent = part;
      nodes.push(em);
    } else {
      nodes.push(document.createTextNode(part));
    }
  });
  if (body !== text) {
    const dot = document.createElement('span');
    dot.className = 'terrain-ui__dot';
    dot.textContent = '.';
    nodes.push(dot);
  }
  return nodes;
}
