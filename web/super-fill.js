"use strict";
// Decorative state changes only: no frame loop, pointer tracking, or framework.
(() => {
    const pad = document.getElementById('pad');
    const zone = document.getElementById('mod-super');
    const fill = document.querySelector('.super-fill');
    const orb = document.querySelector('.super-orb');
    let active = false;
    let origin = { x: null, y: null };
    const measure = () => {
        var _a, _b;
        const rect = pad.getBoundingClientRect();
        const button = origin.x === null || origin.y === null ? zone.getBoundingClientRect() : null;
        const x = Math.max(0, Math.min(rect.width, ((_a = origin.x) !== null && _a !== void 0 ? _a : button.x + button.width / 2) - rect.x));
        const y = Math.max(0, Math.min(rect.height, ((_b = origin.y) !== null && _b !== void 0 ? _b : button.y + button.height / 2) - rect.y));
        const size = Math.ceil(2 * Math.max(Math.hypot(x, y), Math.hypot(rect.width - x, y), Math.hypot(x, rect.height - y), Math.hypot(rect.width - x, rect.height - y)));
        fill.style.width = fill.style.height = `${size}px`;
        fill.style.left = `${x}px`;
        fill.style.top = `${y}px`;
        fill.style.marginLeft = fill.style.marginTop = `${-size / 2}px`;
    };
    const observer = new ResizeObserver(() => { if (active)
        measure(); });
    window.addEventListener('ghostpad-super-fill', event => {
        const detail = event.detail;
        origin = detail;
        if (detail.active)
            measure();
        if (active === detail.active)
            return;
        active = detail.active;
        fill.dataset.active = String(active);
        orb.dataset.active = String(active);
        if (active)
            observer.observe(pad);
        else
            observer.disconnect();
    });
})();
