export type Point = { x: number; y: number };
export type Action = { type: 'move' | 'scroll'; dx: number; dy: number } | { type: 'left' | 'right' | 'down' | 'up' | 'rightdown' | 'rightup' };
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
  dragging = false;
  constructor(private emit: (action: Action) => void, private superHeld: () => boolean = () => false) {}
  reset() { this.count = this.max = this.travel = this.began = 0; this.last = null; this.suppressed = this.dragging = this.consumed = false; this.windowButton = null; this.windowDelta = { x: 0, y: 0 }; }
  private release() {
    if (this.windowButton) this.emit({ type: this.windowButton === 'down' ? 'up' : 'rightup' });
    else if (this.dragging) this.emit({ type: 'up' });
    this.windowButton = null; this.dragging = false;
  }
  update(points: Point[], time: number) {
    const count = points.length;
    if (!this.count && count) { this.reset(); this.began = time; this.windowMode = this.superHeld(); }
    if (!count && this.count) {
      if (this.dragging) this.release();
      else if (!this.consumed && time - this.began < 300 && this.travel < 9 && this.max <= 2) this.emit({ type: this.max === 2 ? 'right' : 'left' });
      this.reset(); return;
    }
    if (!count) return;
    const center = { x: points.reduce((a, p) => a + p.x, 0) / count, y: points.reduce((a, p) => a + p.y, 0) / count };
    this.max = Math.max(this.max, count);
    if (count < this.count || count > 2) this.suppressed = true;
    if (this.dragging && count !== this.count) { this.release(); this.suppressed = true; }
    if (count !== this.count) this.windowDelta = { x: 0, y: 0 };
    if (this.last && count === this.count) {
      const dx = center.x - this.last.x, dy = center.y - this.last.y;
      this.travel += Math.hypot(dx, dy);
      if (!this.suppressed && (dx || dy)) {
        if (this.windowMode) {
          if (!this.windowButton) {
            this.windowDelta.x += dx; this.windowDelta.y += dy;
            if (this.travel >= 3) {
              this.windowButton = count === 2 ? 'rightdown' : 'down'; this.dragging = this.consumed = true;
              this.emit({ type: this.windowButton });
              this.emit({ type: 'move', dx: this.windowDelta.x, dy: this.windowDelta.y });
            }
          } else this.emit({ type: 'move', dx, dy });
        } else this.emit({ type: count === 2 ? 'scroll' : 'move', dx, dy });
      }
    }
    this.last = center; this.count = count;
  }
  hold(time: number) {
    if (!this.windowMode && this.count === 1 && this.max === 1 && this.travel < 7 && !this.suppressed && !this.dragging && time - this.began >= 380) {
      this.dragging = this.consumed = true; this.emit({ type: 'down' });
    }
  }
  cancel() { this.release(); this.reset(); }
}
