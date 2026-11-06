const motion = (bytes) => [1, 2, 15].includes(new Uint8Array(bytes)[0]);
export class InputFlow {
constructor(link, clock, failed) {
this.link = link;
this.clock = clock;
this.failed = failed;
this.queue = [];
this.flight = [];
this.sequence = 0;
this.timer = 0;
this.stopped = false;
this.lastMotion = -Infinity;
this.rtt = 0;
this.sampled = false;
this.deadline = 2000;
this.pump = () => {
var _a, _b, _c, _d;
var _e, _f, _g, _h;
this.clock.clear(this.timer);
this.timer = 0;
if (this.stopped)
return;
const now = this.clock.now();
const oldest = Math.min((_e = (_a = this.flight[0]) === null || _a === void 0 ? void 0 : _a.sent) !== null && _e !== void 0 ? _e : Infinity, (_f = (_b = this.queue[0]) === null || _b === void 0 ? void 0 : _b.queued) !== null && _f !== void 0 ? _f : Infinity);
if (now - oldest >= this.deadline) {
this.fail();
return;
}
let delay = Infinity;
while (this.queue.length) {
const barrier = this.queue.some(packet => !motion(packet.bytes));
if (this.flight.length >= (barrier ? 8 : 4))
break;
if (this.link.bufferedAmount > 256) {
delay = 8;
break;
}
const packet = this.queue[0];
if (!barrier && motion(packet.bytes)) {
delay = this.interval - (now - this.lastMotion);
if (delay > 0)
break;
}
this.queue.shift();
const sequence = this.sequence = (this.sequence + 1) & 0xffff;
const wrapped = new Uint8Array(packet.bytes.byteLength + 3);
wrapped[0] = 17;
new DataView(wrapped.buffer).setUint16(1, sequence, true);
wrapped.set(new Uint8Array(packet.bytes), 3);
this.flight.push({ sequence, sent: now });
if (motion(packet.bytes))
this.lastMotion = now;
try {
this.link.send(wrapped.buffer);
}
catch (_j) {
this.fail();
return;
}
delay = Infinity;
}
const nextOldest = Math.min((_g = (_c = this.flight[0]) === null || _c === void 0 ? void 0 : _c.sent) !== null && _g !== void 0 ? _g : Infinity, (_h = (_d = this.queue[0]) === null || _d === void 0 ? void 0 : _d.queued) !== null && _h !== void 0 ? _h : Infinity);
if (Number.isFinite(nextOldest)) {
delay = Math.min(delay, nextOldest + this.deadline - now);
this.timer = this.clock.later(this.pump, Math.max(1, Math.ceil(delay)));
}
};
}
get interval() { return Math.max(4, Math.min(40, this.rtt / 4)); }
get roundTrip() { return this.rtt; }
send(bytes) {
if (this.stopped)
return;
const code = new Uint8Array(bytes)[0];
if (code === 7)
this.queue = [];
const tail = this.queue[this.queue.length - 1];
if (tail && motion(bytes) && new Uint8Array(tail.bytes)[0] === code) {
if (code === 15)
tail.bytes = bytes;
else {
const a = new DataView(tail.bytes), b = new DataView(bytes);
const x = a.getFloat32(1, true) + b.getFloat32(1, true);
const y = a.getFloat32(5, true) + b.getFloat32(5, true);
if (Math.abs(x) <= 2048 && Math.abs(y) <= 2048) {
a.setFloat32(1, x, true);
a.setFloat32(5, y, true);
}
else
this.queue.push({ bytes, queued: this.clock.now() });
}
}
else
this.queue.push({ bytes, queued: this.clock.now() });
if (this.queue.length > 128) {
this.fail();
return;
}
this.pump();
}
acknowledge(bytes) {
if (this.stopped || bytes.byteLength !== 3)
return;
const view = new DataView(bytes);
const first = this.flight[0];
if (view.getUint8(0) !== 17 || !first || view.getUint16(1, true) !== first.sequence)
return;
this.flight.shift();
const sample = Math.max(0, this.clock.now() - first.sent);
this.rtt = !this.sampled || sample > this.rtt ? sample : this.rtt * .875 + sample * .125;
this.sampled = true;
this.pump();
}
discardMotion(code) {
while (this.queue.length && new Uint8Array(this.queue[this.queue.length - 1].bytes)[0] === code)
this.queue.pop();
this.pump();
}
discardQueued() { this.queue = []; }
stop() {
this.stopped = true;
this.clock.clear(this.timer);
this.timer = 0;
this.queue = [];
this.flight = [];
}
fail() { this.stop(); this.failed(); }
}
