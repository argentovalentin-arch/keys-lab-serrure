import type Lenis from 'lenis';
import type * as THREE from 'three/webgpu';
import type { NoteView, TagView, Terrain } from '../terrain/terrain';
import type { Landmark } from '../terrain/path';
import { ICONS } from '../terrain/icons';
import { HOLO, drawHologram, type Illustration } from './holograms';

type Mode = 'story' | 'entering' | 'terrain' | 'leaving';
/** A box on screen, in CSS pixels. */
type Box = { left: number; right: number; top: number; bottom: number };

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
  /** Told when the Terrain takes over the screen (true) and when the story is back (false). */
  onTerrainChange?: (inside: boolean) => void;
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
  private readonly tagElements = new Map<string, {
    root: HTMLElement; thread: HTMLElement; label: HTMLElement; width: number; height: number; clear: number; quiet: boolean; confirmed: boolean;
    holo: { wrap: HTMLElement; ctx: CanvasRenderingContext2D; kind: Illustration; ratio: number; scale: number } | null;
  }>();
  private noteText: string | null = null;
  // Sizes read from the page once, not every frame: reading layout right after moving
  // elements forces the browser to lay the page out again, several times a frame.
  private noteSize: { width: number; height: number } | null = null;
  private noteBox: Box | null = null;
  private wordBoxes: Box[] | null = null;
  private closeBox: Box | null = null;
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
    window.addEventListener('resize', () => {
      this.noteSize = null;
      this.wordBoxes = null;
      this.closeBox = null;
      for (const element of this.tagElements.values()) element.width = element.height = -1;
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
    this.options.onTerrainChange?.(true);

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
      this.wordBoxes = null;
      // The welcome message makes way if a landmark comes up while it still shows.
      this.message.classList.add('is-hidden');
    } else {
      this.word.classList.add('is-hidden');
      this.wordBoxes = null;
    }
  }

  /**
   * The note of the moment, drawn where the Terrain places it in the scene (every frame):
   * its anchor's screen position, its scale and its fade all come from there.
   */
  private showNote(view: NoteView | null): void {
    if (!view) {
      this.note.style.opacity = '0';
      this.noteBox = null;
      return;
    }
    if (view.note.text !== this.noteText) {
      this.noteText = view.note.text;
      this.note.replaceChildren(...noteNodes(view.note.text));
      this.noteSize = null;
    }
    if (!this.noteSize) this.noteSize = { width: this.note.offsetWidth, height: this.note.offsetHeight };
    let x = ((view.x + 1) / 2) * window.innerWidth;
    const y = ((1 - view.y) / 2) * window.innerHeight;
    // In the bends the anchor can come near the edge: the text is kept whole on screen.
    const width = this.noteSize.width * view.scale;
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
    // Where it stands on screen, for the labels to keep clear of (see showTags).
    const left = x - (view.align === -1 ? width : view.align === 1 ? 0 : width / 2);
    const height = this.noteSize.height * view.scale;
    this.noteBox = view.opacity > 0.01 ? { left: left - 12, right: left + width + 12, top: y - height / 2 - 10, bottom: y + height / 2 + 10 } : null;
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
    const placed: Box[] = [];
    if (views.length && !this.word.classList.contains('is-hidden')) {
      // The title stays put while it shows: measured once.
      this.wordBoxes ??= [this.wordName, this.wordStep.parentElement!].map((element) => {
        const r = element.getBoundingClientRect();
        return { left: r.left - 12, right: r.right + 12, top: r.top - 10, bottom: r.bottom + 10 };
      }).filter((box) => box.right - box.left > 24);
      placed.push(...this.wordBoxes);
    }
    if (this.noteBox) placed.push(this.noteBox);
    // Nor over the welcome message while it shows (on a phone it takes two lines).
    if (views.length && !this.message.classList.contains('is-hidden')) {
      const r = this.message.getBoundingClientRect();
      placed.push({ left: r.left - 12, right: r.right + 12, top: r.top - 10, bottom: r.bottom + 10 });
    }
    // Nor under « Quitter le Terrain » (on a phone the labels come up that far).
    if (views.length) {
      if (!this.closeBox) {
        const r = this.close.getBoundingClientRect();
        this.closeBox = { left: r.left - 8, right: r.right + 8, top: r.top - 8, bottom: r.bottom + 8 };
      }
      placed.push(this.closeBox);
    }
    // Nearest first (lowest on screen), so the farther ones are the ones moved up.
    const ordered = [...views].sort((p, q) => q.ly - p.ly);
    for (const view of ordered) {
      seen.add(view.id);
      let element = this.tagElements.get(view.id);
      if (!element) {
        const root = document.createElement('div');
        root.className = `terrain-tag terrain-tag--${view.kind}`;
        const thread = document.createElement('span');
        thread.className = 'terrain-tag__thread';
        const label = document.createElement('span');
        label.className = 'terrain-tag__label';
        if (view.kind === 'badge') {
          // Our own static SVG (icons.ts), never content from elsewhere. The scan line that
          // reveals the pictograms as the projection arrives (style.css).
          const badge = document.createElement('span');
          badge.className = 'terrain-tag__badge';
          badge.innerHTML = `<span class="terrain-tag__icons">${view.icons.map((name) => `<span class="terrain-tag__icon">${ICONS[name]}</span>`).join('')}</span><span class="terrain-tag__scan" aria-hidden="true"></span>`;
          label.append(badge);
        } else if (view.kind === 'step' && view.numeral) {
          // A step of the method: its numeral, set as on the brand's site.
          const numeral = document.createElement('span');
          numeral.className = 'terrain-tag__numeral';
          numeral.textContent = view.numeral;
          label.append(numeral);
        }
        // Its words, one span each, so they settle one after the other (style.css).
        const caption = document.createElement('span');
        caption.className = 'terrain-tag__caption';
        const words = document.createElement('span');
        words.className = 'terrain-tag__words';
        view.caption.split(' ').forEach((text, i) => {
          if (i > 0) words.append(' ');
          const word = document.createElement('span');
          word.className = 'terrain-tag__word';
          word.style.setProperty('--i', String(i));
          word.textContent = text;
          words.append(word);
        });
        caption.append(words);
        label.append(caption);
        root.append(thread, label);
        this.tagLayer.append(root);
        element = { root, thread, label, width: -1, height: -1, clear: 1, quiet: false, confirmed: false, holo: null };
        this.tagElements.set(view.id, element);
      }
      if (element.quiet !== view.quiet) {
        element.quiet = view.quiet;
        element.root.classList.toggle('is-quiet', view.quiet);
        element.width = -1;
      }
      if (element.confirmed !== view.confirmed) {
        element.confirmed = view.confirmed;
        element.root.classList.toggle('is-confirmed', view.confirmed);
      }
      // Its hologram, over the badge, while it is the one in focus (ui/holograms.ts): the
      // badge, its words and its drawing, one composition.
      if (view.holo && !element.holo) {
        const scale = window.innerWidth < 700 ? 0.72 : 1;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const wrap = document.createElement('span');
        wrap.className = 'terrain-tag__holo';
        wrap.setAttribute('aria-hidden', 'true');
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(HOLO.width * scale * ratio);
        canvas.height = Math.round(HOLO.height * scale * ratio);
        canvas.style.width = `${HOLO.width * scale}px`;
        canvas.style.height = `${HOLO.height * scale}px`;
        wrap.append(canvas);
        element.label.prepend(wrap);
        const ctx = canvas.getContext('2d');
        if (ctx) element.holo = { wrap, ctx, kind: view.holo.kind, ratio, scale };
        element.width = -1;
      } else if (!view.holo && element.holo) {
        element.holo.wrap.remove();
        element.holo = null;
        element.width = -1;
      }
      if (view.holo && element.holo) {
        const { wrap, ctx, kind, ratio, scale } = element.holo;
        drawHologram(ctx, kind, view.holo.t, performance.now() / 1000, ratio, scale);
        // Folding away: down into the badge it rose from.
        const fold = view.holo.fold;
        const eased = fold * fold * (3 - 2 * fold);
        wrap.style.transform = fold > 0 ? `scaleY(${(1 - eased).toFixed(3)})` : '';
        wrap.style.opacity = fold > 0 ? (1 - eased).toFixed(3) : '';
      }
      if (element.width < 0) {
        element.width = element.label.offsetWidth;
        element.height = element.label.offsetHeight;
      }
      const gx = ((view.gx + 1) / 2) * w;
      const gy = ((1 - view.gy) / 2) * h;
      // The name is kept whole on screen; the thread still reaches its point.
      const half = element.width / 2;
      const margin = 16;
      const lx = Math.min(Math.max(((view.lx + 1) / 2) * w, margin + half), w - margin - half);
      let ly = ((1 - view.ly) / 2) * h;
      // Nothing is covered: a label that would overlap the title, the note or another label
      // moves just clear of it, above or below, whichever is nearer and free (its thread
      // still reaches its point).
      const height = element.height + 4;
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
      // Where there is no free room at all (a crowded phone screen), the label steps back,
      // fading out until there is, rather than lying over a text.
      const blocked = Boolean(hits(ly));
      element.clear += ((blocked ? 0 : 1) - element.clear) * 0.18;
      if (!blocked) placed.push({ left: lx - half - 4, right: lx + half + 4, top: ly - height, bottom: ly });
      element.root.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
      // Secondary to the note: never quite as bright.
      element.root.style.opacity = (view.opacity * 0.92 * element.clear).toFixed(3);
      // The thread runs from the label down to its point. A badge's own projection (a line of
      // light in the scene, projection.ts) already joins them where the label stands in its
      // place: the thread only shows when the label had to move aside, to keep them joined.
      const length = Math.hypot(gx - lx, gy - ly);
      const angle = Math.atan2(gy - ly, gx - lx);
      element.thread.style.width = `${length.toFixed(1)}px`;
      element.thread.style.transform = `rotate(${angle.toFixed(4)}rad)`;
      if (view.kind === 'badge') {
        const moved = Math.hypot(lx - ((view.lx + 1) / 2) * w, ly - ((1 - view.ly) / 2) * h);
        element.thread.style.opacity = Math.min(1, Math.max(0, (moved - 4) / 16)).toFixed(2);
      }
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
    this.options.onTerrainChange?.(false);
    this.ui.hidden = true;
    this.showNote(null);
    this.noteText = null;
    this.wordBoxes = null;
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
