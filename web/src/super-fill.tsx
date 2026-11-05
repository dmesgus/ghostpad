import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { OriginFill, getCoverDiameter } from '@/components/ui/origin-button';

type FillState = { active: boolean; x: number | null; y: number | null };

function SuperFill({ pad, zone }: { pad: HTMLElement; zone: HTMLElement }) {
  const [state, setState] = React.useState<FillState>({ active: false, x: null, y: null });
  const [bounds, setBounds] = React.useState({ x: 0, y: 0, size: 0 });
  React.useLayoutEffect(() => {
    const update = (event: Event) => setState((event as CustomEvent<FillState>).detail);
    window.addEventListener('ghostpad-super-fill', update);
    return () => window.removeEventListener('ghostpad-super-fill', update);
  }, []);
  React.useLayoutEffect(() => {
    // Keep the last origin on release so the fill recedes to the same point.
    if (!state.active) return;
    const measure = () => {
      const rect = pad.getBoundingClientRect(), zoneRect = zone.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, (state.x ?? zoneRect.x + zoneRect.width / 2) - rect.x));
      const y = Math.max(0, Math.min(rect.height, (state.y ?? zoneRect.y + zoneRect.height / 2) - rect.y));
      setBounds({ x, y, size: getCoverDiameter(rect.width, rect.height, x, y) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pad);
    return () => observer.disconnect();
  }, [state, pad, zone]);
  return <OriginFill active={state.active} size={bounds.size} x={bounds.x} y={bounds.y} className="super-fill" />;
}

const pad = document.getElementById('pad');
const zone = document.getElementById('mod-super');
const host = document.getElementById('super-fill-root');
if (pad && zone && host) {
  // Subscribe before the gesture controller starts accepting touches.
  flushSync(() => createRoot(host).render(<SuperFill pad={pad} zone={zone} />));
}
