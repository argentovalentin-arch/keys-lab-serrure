export interface Chapter {
  title: string;
  lead: string;
  /** Optional call to action shown under the lead (instead of the action, when it is available). */
  link?: { href: string; label: string };
  /** Optional button, e.g. to enter the Terrain epilogue; it replaces the link while available. */
  action?: string;
}

const FADE_MS = 280; // matches the .stage transition in style.css

/** Chapter title in the corner: fades out, swaps its text, fades back in. */
export class Stage {
  private readonly root = document.querySelector<HTMLElement>('#stage')!;
  private readonly title = document.querySelector<HTMLElement>('#stage-title')!;
  private readonly lead = document.querySelector<HTMLElement>('#stage-lead')!;
  private readonly link = document.querySelector<HTMLAnchorElement>('#stage-link')!;
  /** The chapter's action button; the caller listens to its clicks. */
  readonly action = document.querySelector<HTMLButtonElement>('#stage-action')!;
  private current = -1;
  private pending = 0;

  constructor(private readonly chapters: Chapter[], private readonly reducedMotion: boolean) {}

  show(next: number): void {
    if (next === this.current) return;
    const first = this.current === -1;
    this.current = next;
    window.clearTimeout(this.pending);

    const write = () => {
      const chapter = this.chapters[next];
      this.title.textContent = chapter.title;
      this.lead.textContent = chapter.lead;
      if (chapter.link) {
        this.link.href = chapter.link.href;
        this.link.textContent = chapter.link.label;
      }
      this.updateAction();
      this.root.classList.remove('is-hidden');
    };

    if (first || this.reducedMotion) {
      write();
      return;
    }
    this.root.classList.add('is-hidden');
    this.pending = window.setTimeout(write, FADE_MS);
  }

  private updateAction(): void {
    const chapter = this.current >= 0 ? this.chapters[this.current] : undefined;
    const label = chapter?.action;
    this.action.hidden = !label;
    if (label) this.action.textContent = label;
    // The link only shows where there is no action to take its place.
    this.link.hidden = !chapter?.link || !this.action.hidden;
  }
}
