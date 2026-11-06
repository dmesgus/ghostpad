// Receiver acknowledgements bound input in flight, including bytes the browser
// has already handed to TCP (which bufferedAmount cannot see).
type Packet = { bytes: ArrayBuffer; queued: number };
type Flight = { sequence: number; sent: number };
type Link = { bufferedAmount: number; send(bytes: ArrayBuffer): void };
type Clock = { now(): number; later(fn: () => void, ms: number): number; clear(id: number): void };
const motion = (bytes: ArrayBuffer) => [1, 2, 15].includes(new Uint8Array(bytes)[0]);

export class InputFlow {
  private queue: Packet[] = [];
  private flight: Flight[] = [];
  private sequence = 0;
  private timer = 0;
  private stopped = false;
  private lastMotion = -Infinity;
  private rtt = 0;
  private sampled = false;
  private readonly deadline = 2000;

  constructor(private link: Link, private clock: Clock, private failed: () => void) {}

  get interval() { return Math.max(4, Math.min(40, this.rtt / 4)); }
  get roundTrip() { return this.rtt; }

  send(bytes: ArrayBuffer) {
    if (this.stopped) return;
    const code = new Uint8Array(bytes)[0];
    // Release cancels unsent edits/gestures as well as remote held state.
    if (code === 7) this.queue = [];
    const tail = this.queue[this.queue.length - 1];
    if (tail && motion(bytes) && new Uint8Array(tail.bytes)[0] === code) {
      if (code === 15) tail.bytes = bytes; // absolute pinch scale
      else {
        const a = new DataView(tail.bytes), b = new DataView(bytes);
        const x = a.getFloat32(1, true) + b.getFloat32(1, true);
        const y = a.getFloat32(5, true) + b.getFloat32(5, true);
        if (Math.abs(x) <= 2048 && Math.abs(y) <= 2048) {
          a.setFloat32(1, x, true); a.setFloat32(5, y, true);
        } else this.queue.push({ bytes, queued: this.clock.now() });
      }
    } else this.queue.push({ bytes, queued: this.clock.now() });
    // A pathological input producer must not allocate an unbounded queue.
    if (this.queue.length > 128) { this.fail(); return; }
    this.pump();
  }

  acknowledge(bytes: ArrayBuffer) {
    if (this.stopped || bytes.byteLength !== 3) return;
    const view = new DataView(bytes);
    const first = this.flight[0];
    // WebSocket is ordered: only the next exact acknowledgement is valid.
    if (view.getUint8(0) !== 17 || !first || view.getUint16(1, true) !== first.sequence) return;
    this.flight.shift();
    const sample = Math.max(0, this.clock.now() - first.sent);
    // React quickly to deterioration, recover gradually without rate oscillation.
    this.rtt = !this.sampled || sample > this.rtt ? sample : this.rtt * .875 + sample * .125;
    this.sampled = true;
    this.pump();
  }

  discardMotion(code: number) {
    // Never cross a click/key/gesture boundary when stopping scroll momentum.
    while (this.queue.length && new Uint8Array(this.queue[this.queue.length - 1].bytes)[0] === code) this.queue.pop();
    this.pump();
  }

  discardQueued() { this.queue = []; }

  stop() {
    this.stopped = true; this.clock.clear(this.timer); this.timer = 0;
    this.queue = []; this.flight = [];
  }

  private fail() { this.stop(); this.failed(); }

  private pump = () => {
    this.clock.clear(this.timer); this.timer = 0;
    if (this.stopped) return;
    const now = this.clock.now();
    const oldest = Math.min(this.flight[0]?.sent ?? Infinity, this.queue[0]?.queued ?? Infinity);
    if (now - oldest >= this.deadline) { this.fail(); return; }
    let delay = Infinity;
    while (this.queue.length) {
      // Four normal packets, with four reserved slots for controls and the
      // motion preceding them. Releases cannot overtake the end of a drag.
      const barrier = this.queue.some(packet => !motion(packet.bytes));
      if (this.flight.length >= (barrier ? 8 : 4)) break;
      if (this.link.bufferedAmount > 256) { delay = 8; break; }
      const packet = this.queue[0];
      if (!barrier && motion(packet.bytes)) {
        delay = this.interval - (now - this.lastMotion);
        if (delay > 0) break;
      }
      this.queue.shift();
      const sequence = this.sequence = (this.sequence + 1) & 0xffff;
      const wrapped = new Uint8Array(packet.bytes.byteLength + 3);
      wrapped[0] = 17; new DataView(wrapped.buffer).setUint16(1, sequence, true);
      wrapped.set(new Uint8Array(packet.bytes), 3);
      this.flight.push({ sequence, sent: now });
      if (motion(packet.bytes)) this.lastMotion = now;
      try { this.link.send(wrapped.buffer); } catch { this.fail(); return; }
      delay = Infinity;
    }
    const nextOldest = Math.min(this.flight[0]?.sent ?? Infinity, this.queue[0]?.queued ?? Infinity);
    if (Number.isFinite(nextOldest)) {
      delay = Math.min(delay, nextOldest + this.deadline - now);
      this.timer = this.clock.later(this.pump, Math.max(1, Math.ceil(delay)));
    }
  };
}
