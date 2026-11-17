/**
 * Sideways steering for the Terrain: the only control the visitor has.
 * - mouse: moving the pointer left or right of where it first was in the Terrain moves
 *   the target by as much (so wherever « Entrer » was clicked, the light starts centred);
 * - touch: horizontal drags move the target (the gesture never scrolls nor swipes back);
 * - keyboard: left and right arrows move it while held.
 * The target always stays within [-limit, limit] (the width of the path), and once the
 * visitor lets go it eases back to 0, the centre of the path.
 */
const RECENTRE_AFTER = 0.9; // seconds without input before the light drifts back to the centre
const RECENTRE_RATE = 1.4;
/** Share of the window's width that the pointer covers to go from the centre to a side. */
const MOUSE_REACH = 0.3;

export function createSteering(surface: HTMLElement, limit: number) {
  let target = 0;
  let keyDirection = 0;
  let touchX: number | null = null;
  /** Pointer x that stands for the centre of the path; set on the first move. */
  let mouseOrigin: number | null = null;
  let mouseX = 0;
  let idle = 0;
  const keys = new Set<string>();

  const clampTarget = (value: number) => Math.max(-limit, Math.min(limit, value));
  const mouseScale = () => (window.innerWidth * MOUSE_REACH) / limit; // pixels per unit

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      mouseX = e.clientX;
      if (mouseOrigin === null) mouseOrigin = e.clientX - target * mouseScale();
      const wanted = (e.clientX - mouseOrigin) / mouseScale();
      target = clampTarget(wanted);
      // Pushed past a side: the origin follows, so moving back steers back at once.
      if (wanted !== target) mouseOrigin = e.clientX - target * mouseScale();
      idle = 0;
    } else if (touchX !== null) {
      target = clampTarget(target + ((e.clientX - touchX) / window.innerWidth) * 2 * limit * 2);
      touchX = e.clientX;
      idle = 0;
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') touchX = e.clientX;
  };
  const onPointerUp = () => (touchX = null);
  // touch-action: none (style.css) stops scrolling; this also stops the edge swipe on some browsers.
  // Buttons keep their own touches, or they could no longer be tapped.
  const onTouchStart = (e: TouchEvent) => {
    if (!(e.target instanceof Element && e.target.closest('button'))) e.preventDefault();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    if (e.type === 'keydown') {
      keys.add(e.key);
      // Each press (and each key repeat) is also a step, so short taps steer too.
      target = clampTarget(target + (e.key === 'ArrowRight' ? 1 : -1) * limit * 0.2);
      idle = 0;
    } else {
      keys.delete(e.key);
    }
    keyDirection = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  };

  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerUp);
  surface.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  return {
    /** Advances the keyboard steering and the return to the centre; returns the target. */
    update(dt: number): number {
      if (keyDirection !== 0) {
        target = clampTarget(target + keyDirection * limit * 2 * dt);
        idle = 0;
      } else if (touchX === null) {
        idle += dt;
      }
      if (idle > RECENTRE_AFTER) {
        target *= Math.exp(-RECENTRE_RATE * dt);
        // The pointer has not moved: what it stands for moves with the light.
        if (mouseOrigin !== null) mouseOrigin = mouseX - target * mouseScale();
      }
      return target;
    },
    /** Back to the centre, the pointer's next position becoming the new reference. */
    reset() {
      target = 0;
      mouseOrigin = null;
      idle = 0;
    },
    dispose() {
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerUp);
      surface.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    },
  };
}
