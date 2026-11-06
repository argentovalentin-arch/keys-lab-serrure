export interface Chapter {
  title: string;
  lead: string;
  /** Optional call to action shown under the lead. */
  link?: { href: string; label: string };
}

const FADE_MS = 280; // matches the .stage transition in style.css

/** Chapter title in the corner: fades out, swaps its text, fades back in. */
export class Stage {
  private readonly root = document.querySelector<HTMLElement>('#stage')!;
  private readonly index = document.querySelector<HTMLElement>('#stage-index')!;
  private readonly title = document.querySelector<HTMLElement>('#stage-title')!;
  private readonly lead = document.querySelector<HTMLElement>('#stage-lead')!;
  private readonly link = document.querySelector<HTMLAnchorElement>('#stage-link')!;
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
      this.index.textContent = `${String(next + 1).padStart(2, '0')} / ${String(this.chapters.length).padStart(2, '0')}`;
      this.title.textContent = chapter.title;
      this.lead.textContent = chapter.lead;
      this.link.hidden = !chapter.link;
      if (chapter.link) {
        this.link.href = chapter.link.href;
        this.link.textContent = chapter.link.label;
      }
      this.root.classList.remove('is-hidden');
    };

    if (first || this.reducedMotion) {
      write();
      return;
    }
    this.root.classList.add('is-hidden');
    this.pending = window.setTimeout(write, FADE_MS);
  }
}
