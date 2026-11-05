// Decorative state changes only: no frame loop, pointer tracking, or framework.
(() => {
  const pad = document.getElementById('pad')!;
  const zone = document.getElementById('mod-super')!;
  const fill = document.querySelector<HTMLElement>('.super-fill')!;
  const orb = document.querySelector<HTMLElement>('.super-orb')!;
  let active = false;
  let origin: { x: number | null; y: number | null } = { x: null, y: null };
  const measure = () => {
    const rect = pad.getBoundingClientRect();
    const button = origin.x === null || origin.y === null ? zone.getBoundingClientRect() : null;
    const x = Math.max(0, Math.min(rect.width, (origin.x ?? button!.x + button!.width / 2) - rect.x));
    const y = Math.max(0, Math.min(rect.height, (origin.y ?? button!.y + button!.height / 2) - rect.y));
    const size = Math.ceil(2 * Math.max(Math.hypot(x, y), Math.hypot(rect.width - x, y), Math.hypot(x, rect.height - y), Math.hypot(rect.width - x, rect.height - y)));
    fill.style.width = fill.style.height = `${size}px`;
    fill.style.left = `${x}px`; fill.style.top = `${y}px`;
    fill.style.marginLeft = fill.style.marginTop = `${-size / 2}px`;
  };
  const observer = new ResizeObserver(() => { if (active) measure(); });
  window.addEventListener('ghostpad-super-fill', event => {
    const detail = (event as CustomEvent<{ active: boolean; x: number | null; y: number | null }>).detail;
    origin = detail;
    if (detail.active) measure();
    if (active === detail.active) return;
    active = detail.active;
    fill.dataset.active = String(active);
    orb.dataset.active = String(active);
    if (active) observer.observe(pad); else observer.disconnect();
  });
})();
