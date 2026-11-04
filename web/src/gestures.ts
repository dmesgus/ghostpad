export type Point = { x: number; y: number };
export type Action = { type: 'move' | 'scroll'; dx: number; dy: number } | { type: 'zoom'; scale: number } | { type: 'left' | 'right' | 'down' | 'up' | 'rightdown' | 'rightup' | 'zoomend' };
/** Gesture state is independent of DOM, network, and OS input. */
export class Gestures {
  private count = 0;
  private max = 0;
  private travel = 0;
  private began = 0;
  private last: Point | null = null;
  private suppressed = false;
  private consumed = false;
  private windowMode = false;
  private windowButton: 'down' | 'rightdown' | null = null;
  private windowDelta = { x: 0, y: 0 };
  private twoMode: 'scroll' | 'zoom' | null = null;
  private twoStart: Point | null = null;
  private twoBegan = 0;
  private startDistance = 0;
  private lastDistance = 0;
  private lastTap: number | null = null;
  private tapDrag = false;
  private tapDelta = { x: 0, y: 0 };
  dragging = false;
  constructor(private emit: (action: Action) => void, private superHeld: () => boolean = () => false) {}
  reset() { this.count = this.max = this.travel = this.began = this.twoBegan = 0; this.last = null; this.suppressed = this.dragging = this.consumed = false; this.windowButton = null; this.windowDelta = { x: 0, y: 0 }; this.twoMode = null; this.twoStart = null; this.startDistance = this.lastDistance = 0; this.lastTap = null; this.tapDrag = false; this.tapDelta = { x: 0, y: 0 }; }
  private release() {
    if (this.twoMode === 'zoom') { this.emit({ type: 'zoomend' }); this.twoMode = null; }
    if (this.windowButton) this.emit({ type: this.windowButton === 'down' ? 'up' : 'rightup' });
    else if (this.dragging) this.emit({ type: 'up' });
    this.windowButton = null; this.dragging = false;
  }
  update(points: Point[], time: number) {
    const count = points.length;
    if (!this.count && count) {
      const tap = this.lastTap;
      this.reset(); this.began = time; this.windowMode = this.superHeld();
      // This is a relative touchpad: landing elsewhere does not move the cursor.
      // A second touch within 300 ms can continue the tap as a drag anywhere.
      this.tapDrag = !this.windowMode && count === 1 && tap !== null && time >= tap && time - tap <= 300;
    }
    // Preserve a short, deliberate swipe that ends during the decision window.
    if (count < 2 && this.count === 2 && !this.twoMode && !this.suppressed && !this.windowMode && this.twoStart && this.last) {
      const dx = this.last.x - this.twoStart.x, dy = this.last.y - this.twoStart.y;
      const pan = Math.hypot(dx, dy), spread = Math.abs(this.lastDistance - this.startDistance);
      if (pan >= 6 && pan > spread * 1.3) { this.consumed = true; this.emit({ type: 'scroll', dx, dy }); }
    }
    if (!count && this.count) {
      let tap = null;
      if (this.dragging || this.twoMode === 'zoom') this.release();
      else if (!this.consumed && time - this.began < 300 && (this.tapDrag || this.travel < 9) && this.max <= 2) {
        this.emit({ type: this.max === 2 ? 'right' : 'left' });
        if (this.max === 1 && !this.windowMode) tap = time;
      }
      this.reset(); this.lastTap = tap; return;
    }
    if (!count) return;
    const center = { x: points.reduce((a, p) => a + p.x, 0) / count, y: points.reduce((a, p) => a + p.y, 0) / count };
    const distance = count === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    if (this.twoMode === 'zoom' && count !== 2) this.release();
    if (count === 2 && this.count !== 2) { this.twoStart = center; this.twoBegan = time; this.startDistance = this.lastDistance = distance; this.twoMode = null; }
    this.max = Math.max(this.max, count);
    if (count < this.count || count > 2) this.suppressed = true;
    if (count !== 1) this.tapDrag = false;
    if (this.dragging && count !== this.count) { this.release(); this.suppressed = true; }
    if (count !== this.count) this.windowDelta = { x: 0, y: 0 };
    if (this.last && count === this.count) {
      const dx = center.x - this.last.x, dy = center.y - this.last.y;
      this.travel += Math.hypot(dx, dy);
      if (count === 2) this.travel += Math.abs(distance - this.lastDistance);
      if (!this.suppressed && count === 2 && !this.windowMode) {
        const totalX = center.x - this.twoStart!.x, totalY = center.y - this.twoStart!.y;
        const pan = Math.hypot(totalX, totalY), spread = Math.abs(distance - this.startDistance);
        const previousMode = this.twoMode;
        // Let a pinch reveal itself before a small initial slide locks in scrolling.
        // Large, clear swipes stay immediate; ambiguous diagonal motion stays undecided.
        if (!this.twoMode) {
          if (spread >= 6 && spread > pan * 1.3 && this.startDistance >= 10) this.twoMode = 'zoom';
          else if (pan >= 6 && pan > spread * 1.3 && (pan >= 12 || time - this.twoBegan >= 40)) this.twoMode = 'scroll';
        }
        if (this.twoMode) {
          this.consumed = true;
          if (this.twoMode === 'zoom') {
            if (!previousMode || distance !== this.lastDistance) this.emit({ type: 'zoom', scale: Math.max(.1, Math.min(6, distance / this.startDistance)) });
          } else if (dx || dy) this.emit({ type: 'scroll', dx: previousMode ? dx : totalX, dy: previousMode ? dy : totalY });
        }
      } else if (!this.suppressed && (dx || dy)) {
        if (this.windowMode) {
          if (!this.windowButton) {
            this.windowDelta.x += dx; this.windowDelta.y += dy;
            if (this.travel >= 3) {
              this.windowButton = count === 2 ? 'rightdown' : 'down'; this.dragging = this.consumed = true;
              this.emit({ type: this.windowButton });
              this.emit({ type: 'move', dx: this.windowDelta.x, dy: this.windowDelta.y });
            }
          } else this.emit({ type: 'move', dx, dy });
        } else if (this.tapDrag) {
          // Buffer slight jitter so double taps stay clicks and a staggered
          // two-finger gesture cannot accidentally press the left button.
          this.tapDelta.x += dx; this.tapDelta.y += dy;
          if (Math.hypot(this.tapDelta.x, this.tapDelta.y) >= 3) {
            this.tapDrag = false; this.dragging = this.consumed = true;
            this.emit({ type: 'down' });
            this.emit({ type: 'move', dx: this.tapDelta.x, dy: this.tapDelta.y });
          }
        } else this.emit({ type: count === 2 ? 'scroll' : 'move', dx, dy });
      }
    }
    this.last = center; this.lastDistance = distance; this.count = count;
  }
  hold(time: number) {
    if (!this.windowMode && this.count === 1 && this.max === 1 && (this.tapDrag || this.travel < 7) && !this.suppressed && !this.dragging && time - this.began >= 380) {
      this.tapDrag = false;
      this.dragging = this.consumed = true; this.emit({ type: 'down' });
      if (this.tapDelta.x || this.tapDelta.y) this.emit({ type: 'move', dx: this.tapDelta.x, dy: this.tapDelta.y });
    }
  }
  cancel() { this.release(); this.reset(); }
}
