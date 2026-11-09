"use strict";
(() => {
var _a, _b;
const frame = document.querySelector('main'), panel = document.getElementById('keyboard-panel');
const input = document.getElementById('native-input');
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;width:0;height:100dvh;visibility:hidden;pointer-events:none';
document.body.appendChild(probe);
let until = 0, timer = 0, rows = [], last = 0;
function flush() {
if (!rows.length)
return;
const data = rows.map(row => row.join(',')).join(';');
rows = [];
void fetch(`/keyboard-trace?${data}`, { cache: 'no-store', keepalive: true }).catch(() => { });
}
function sample(event) {
const v = window.visualViewport, m = frame.getBoundingClientRect(), p = panel.getBoundingClientRect(), field = input.getBoundingClientRect();
rows.push([
performance.now(), event, innerHeight, (v === null || v === void 0 ? void 0 : v.height) || innerHeight, (v === null || v === void 0 ? void 0 : v.offsetTop) || 0, scrollY,
m.top, m.height, document.getElementById('pad').getBoundingClientRect().height, p.top, p.height,
probe.getBoundingClientRect().height, document.documentElement.clientHeight,
Number(document.activeElement === input), Number(document.body.classList.contains('native-focused')),
field.top, field.bottom, outerHeight
].map(value => Math.round(value * 10) / 10));
if (rows.length >= 12)
flush();
}
function tick() {
timer = 0;
sample(0);
if (performance.now() < until)
timer = window.setTimeout(tick, 40);
else
flush();
}
function start(event) {
until = performance.now() + 8000;
sample(event);
if (!timer)
timer = window.setTimeout(tick, 40);
}
input.addEventListener('focus', () => start(1));
input.addEventListener('blur', () => start(2));
input.addEventListener('pointerdown', () => start(3));
(_a = window.visualViewport) === null || _a === void 0 ? void 0 : _a.addEventListener('resize', () => start(4));
(_b = window.visualViewport) === null || _b === void 0 ? void 0 : _b.addEventListener('scroll', () => start(5));
window.addEventListener('resize', () => start(6));
window.addEventListener('blur', () => start(7));
window.addEventListener('focus', () => start(8));
window.addEventListener('pagehide', () => { clearTimeout(timer); timer = 0; flush(); });
sample(9);
flush();
last = performance.now();
panel.addEventListener('pointerup', () => { if (performance.now() - last > 30) {
last = performance.now();
start(10);
} });
if (!new URLSearchParams(location.search).has('compare'))
return;
const tools = document.createElement('div');
tools.setAttribute('aria-label', 'Keyboard rendering comparison');
tools.style.cssText = 'position:fixed;top:max(8px,env(safe-area-inset-top));right:8px;z-index:2147483647;display:flex;gap:4px;padding:4px;background:var(--background);border:1px solid var(--border-strong);border-radius:12px';
for (const [index, label] of ['Base', 'A', 'B', 'C', 'D'].entries()) {
const button = document.createElement('button');
button.textContent = label;
button.style.cssText = 'width:44px;height:44px;border-radius:8px;background:var(--soft);font-size:13px';
button.setAttribute('aria-pressed', String(index === 0));
if (!index) {
button.style.background = 'var(--accent)';
button.style.color = 'var(--primary-foreground)';
}
button.onclick = () => {
for (const property of ['position', 'overflow', 'transform'])
frame.style.removeProperty(property);
for (const property of ['position', 'inset'])
document.body.style.removeProperty(property);
if (index)
frame.style.overflow = 'visible';
if (index === 2 || index === 3)
frame.style.position = 'absolute';
if (index === 2)
document.body.style.position = 'relative';
if (index === 3) {
document.body.style.position = 'fixed';
document.body.style.inset = '0';
}
if (index === 4)
frame.style.transform = 'translateZ(0)';
for (const sibling of tools.querySelectorAll('button')) {
const selected = sibling === button;
sibling.setAttribute('aria-pressed', String(selected));
sibling.style.background = selected ? 'var(--accent)' : 'var(--soft)';
sibling.style.color = selected ? 'var(--primary-foreground)' : 'var(--foreground)';
}
start(11 + index);
window.dispatchEvent(new Event('resize'));
};
tools.appendChild(button);
}
document.body.appendChild(tools);
})();
