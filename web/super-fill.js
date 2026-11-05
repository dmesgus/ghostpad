"use strict";
(() => {
    const pad = document.getElementById('pad');
    const zone = document.getElementById('mod-super');
    const fill = document.querySelector('.super-fill');
    const orb = document.querySelector('.super-orb');
    let active = false;
    let origin = { x: null, y: null };
    const measure = () => {
        const rect = pad.getBoundingClientRect();
        const button = zone.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, (origin.x === null ? button.x + button.width / 2 : origin.x) - rect.x));
        const y = Math.max(0, Math.min(rect.height, (origin.y === null ? button.y + button.height / 2 : origin.y) - rect.y));
        const size = Math.ceil(2 * Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)));
        fill.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;margin:${-size / 2}px`;
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
