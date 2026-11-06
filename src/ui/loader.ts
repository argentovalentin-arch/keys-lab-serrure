/** Lets the browser paint the loader between heavy synchronous steps. */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    // rAF alone stalls in background tabs; the timeout keeps loading moving.
    const done = () => resolve();
    requestAnimationFrame(done);
    window.setTimeout(done, 50);
  });

/** Loading screen that reports the real preparation steps of the scene. */
export class Loader {
  private readonly root = document.querySelector<HTMLElement>('#loader')!;
  private readonly label = document.querySelector<HTMLElement>('#loader-step')!;
  private readonly bar = document.querySelector<HTMLElement>('#loader-bar')!;

  constructor(private readonly reducedMotion: boolean) {}

  async step(label: string, fraction: number): Promise<void> {
    this.label.textContent = label;
    this.bar.style.transform = `scaleX(${fraction})`;
    await nextPaint();
  }

  /** Wipes the loader away upwards (or removes it at once with reduced motion). */
  finish(): Promise<void> {
    this.bar.style.transform = 'scaleX(1)';
    if (this.reducedMotion) {
      this.hide();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.root.classList.add('is-leaving');
      // The wipe lasts 1.1 s (see style.css); the timeout is the safety net if transitionend never fires.
      window.setTimeout(() => {
        this.hide();
        resolve();
      }, 1300);
    });
  }

  hide(): void {
    this.root.classList.add('is-done');
  }
}
