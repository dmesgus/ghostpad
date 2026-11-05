"use strict";
(() => {
const root = document.documentElement;
const normalize = (value) => value === 'light' || value === 'dark' ? value : 'system';
let preference = 'system';
try {
preference = normalize(localStorage.getItem('ghostpad.appearance'));
}
catch (_a) { }
const media = window.matchMedia('(prefers-color-scheme: dark)');
function apply() {
const dark = preference === 'dark' || (preference === 'system' && media.matches);
root.dataset.theme = dark ? 'dark' : 'light';
document.querySelector('meta[name="theme-color"]').content = root.dataset.superFill === 'true' ? '#000000' : dark ? '#292929' : '#e8e8e8';
document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content = dark ? 'black' : 'default';
for (const button of document.querySelectorAll('#appearance button')) {
button.setAttribute('aria-pressed', String(button.dataset.theme === preference));
}
}
apply();
window.addEventListener('ghostpad-super-fill', event => {
root.dataset.superFill = String(event.detail.active);
apply();
});
media.addEventListener('change', apply);
window.addEventListener('storage', event => {
if (event.key === 'ghostpad.appearance' || event.key === null) {
preference = normalize(event.newValue);
apply();
}
});
document.addEventListener('DOMContentLoaded', () => {
for (const button of document.querySelectorAll('#appearance button')) {
button.addEventListener('click', () => {
preference = normalize(button.dataset.theme || null);
try {
localStorage.setItem('ghostpad.appearance', preference);
}
catch (_a) { }
apply();
});
}
apply();
});
})();
