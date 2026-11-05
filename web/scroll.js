export class ScrollMomentum {
constructor() {
this.samples = [];
this.direction = { x: 0, y: 0 };
this.velocity = { x: 0, y: 0 };
this.time = 0;
}
reset() { this.samples = []; this.direction = { x: 0, y: 0 }; this.velocity = { x: 0, y: 0 }; }
begin(time) { this.reset(); this.samples.push({ time, x: 0, y: 0 }); }
track(dx, dy, time) {
const last = this.samples[this.samples.length - 1];
if (!last || (!dx && !dy))
return;
if (dx * this.direction.x + dy * this.direction.y < 0)
this.samples = [last];
this.direction = { x: dx, y: dy };
this.samples.push({ time, x: last.x + dx, y: last.y + dy });
while (this.samples.length > 2 && this.samples[0].time < time - 80)
this.samples.shift();
}
release(time) {
const first = this.samples[0], last = this.samples[this.samples.length - 1];
const count = this.samples.length;
this.samples = [];
this.velocity = { x: 0, y: 0 };
if (count < 2 || time - last.time > 80)
return false;
const duration = Math.max(8, last.time - first.time);
const fade = Math.exp(-Math.max(0, time - last.time) / 40);
let x = (last.x - first.x) / duration * fade, y = (last.y - first.y) / duration * fade;
const speed = Math.hypot(x, y);
if (speed < .15)
return false;
if (speed > 3) {
x *= 3 / speed;
y *= 3 / speed;
}
this.velocity = { x, y };
this.time = time;
return true;
}
step(time) {
const elapsed = time - this.time, speed = Math.hypot(this.velocity.x, this.velocity.y);
if (speed <= .015 || elapsed > 100 || elapsed < 0) {
this.reset();
return null;
}
const duration = Math.min(elapsed, 280 * Math.log(speed / .015));
const decay = Math.exp(-duration / 280), distance = 280 * (1 - decay);
const delta = { dx: this.velocity.x * distance, dy: this.velocity.y * distance };
this.velocity.x *= decay;
this.velocity.y *= decay;
this.time = time;
if (duration < elapsed)
this.velocity = { x: 0, y: 0 };
return delta;
}
}
