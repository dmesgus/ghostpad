import { Gestures, type Action } from './gestures.js';
import { ScrollMomentum } from './scroll.js';
import { InputFlow } from './flow.js';
import { textEdit, normalizeText } from './text.js';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pad = $('pad'), dialog = $<HTMLDialogElement>('settings'), sensitivity = $<HTMLInputElement>('sensitivity'), natural = $<HTMLInputElement>('natural');
const main = document.querySelector('main')!, keyboardPanel = $('keyboard-panel'), bodyClasses = document.body.classList;
const scrollZone = $('scroll-zone');
const read = (key: string) => { try { return localStorage.getItem(`ghostpad.${key}`); } catch { return null; } };
const save = (key: string, value: string) => { try { localStorage.setItem(`ghostpad.${key}`, value); } catch { /* private mode still works in this tab */ } };
let key = new URLSearchParams(location.hash.slice(1)).get('key') || read('key') || '';
if (/^[a-f0-9]{64}$/.test(key)) save('key', key); else key = '';
if (location.hash) { try { history.replaceState(null, '', location.pathname); } catch { /* pairing still works if Safari disallows history changes */ } }
const storedSensitivity = Number(read('sensitivity') || 1.4);
sensitivity.value = String(Number.isFinite(storedSensitivity) ? Math.min(3, Math.max(.4, storedSensitivity)) : 1.4);
natural.checked = read('natural') !== 'false';
let scrollSpeed = Number(read('scrollSpeed') || 1);
if (![.6, 1, 1.6].includes(scrollSpeed)) scrollSpeed = 1;
let scrollSide = read('scrollSide') === 'left' ? 'left' : 'right';
function scrollSidePreference() {
  pad.classList.toggle('scroll-left', scrollSide === 'left');
  for (const button of $('scroll-side').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.side === scrollSide));
}
scrollSidePreference();
let pointerSpeed = Number(sensitivity.value);
function preferences() { pointerSpeed = Number(sensitivity.value); $('sensitivity-value').textContent = `${Number(sensitivity.value).toFixed(1)}×`; save('sensitivity', sensitivity.value); save('natural', String(natural.checked)); for (const button of $('tracking-presets').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === Number(sensitivity.value))); }
preferences(); sensitivity.oninput = preferences; natural.onchange = preferences;
let socket: WebSocket | null = null, ready = false, paused = false, retry = 500, reconnect = 0, heartbeat = 0, lastPong = 0, connectionDeadline = 0;
let closeConnection: ((retry?: boolean) => void) | null = null;
let lastMotion = -Infinity, lastPing: number | null = null;
let flow: InputFlow | null = null;
let padTouches = 0, ignorePad = false;
let scrollTouch: { id: number; x: number; y: number; moved: boolean } | null = null;
let rightTouch: Touch | null = null;
const superPointers = new Set<number>();
const padSuperPointers = new Set<number>();
let superOrigin: { x: number | null; y: number | null } = { x: null, y: null };
let lastSuperFill: { active: boolean; x: number | null; y: number | null } | null = null;
function updateSuperFill() {
  const active = modifiers.has('super') && (padSuperPointers.size > 0 || superKeys.has($('mod-super')));
  const detail = { active, ...superOrigin };
  if (lastSuperFill && detail.active === lastSuperFill.active && detail.x === lastSuperFill.x && detail.y === lastSuperFill.y) return;
  lastSuperFill = detail;
  window.dispatchEvent(new CustomEvent('ghostpad-super-fill', { detail }));
}
const superKeys = new Set<HTMLElement>();
let textTimer = 0, textQueue: ArrayBuffer[] = [], previousText = '', composing = false;
const modifiers = new Map<string, number>();
// Ctrl, Alt, and Shift apply to one shortcut; Super stays down while held.
const shortcutModifiers = new Map<string, number>();
const heldKeys = new Map<number | string, { button: HTMLButtonElement; usage: number; chord: number[] }>();
const heldUsages = new Map<number, number>();
let hold = 0, frame = 0, pending: { type: 'move' | 'scroll'; dx: number; dy: number } | { type: 'zoom'; scale: number } | null = null;
function status(label: string, detail: string, online = false) { $('status').textContent = label; $('detail').textContent = detail; $('dot').classList.toggle('online', online); bodyClasses.toggle('connected', online); if (!online) $('hint').textContent = detail; }
function transmit(bytes: ArrayBuffer) {
  if (!ready || socket?.readyState !== WebSocket.OPEN) return;
  if (flow) { flow.send(bytes); return; }
  if (socket.bufferedAmount > 256) { closeConnection?.(); return; }
  try { socket.send(bytes); } catch { closeConnection?.(); }
}
function send(code: number, dx?: number, dy?: number) {
  if (!ready || socket?.readyState !== WebSocket.OPEN) return;
  // Wide swipes or coalesced bursts can exceed one packet's range. Split the
  // vector proportionally instead of clipping distance or changing direction.
  if (dx !== undefined && (Math.abs(dx) > 2048 || Math.abs(dy!) > 2048)) {
    const parts = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy!)) / 2048);
    if (!Number.isFinite(parts)) return;
    for (let i = 0; i < parts; i++) send(code, dx / parts, dy! / parts);
    return;
  }
  const bytes = new ArrayBuffer(dx === undefined ? 1 : 9), view = new DataView(bytes);
  view.setUint8(0, code);
  if (dx !== undefined) { view.setFloat32(1, Math.max(-2048, Math.min(2048, dx)), true); view.setFloat32(5, Math.max(-2048, Math.min(2048, dy!)), true); }
  transmit(bytes);
}
function keyEvent(op: number, usage: number) { flush(); transmit(new Uint8Array([op, usage]).buffer); }
function flush() {
  clearTimeout(frame); frame = 0;
  if (pending) {
    lastMotion = performance.now();
    if (pending.type === 'zoom') {
      const bytes = new ArrayBuffer(5), view = new DataView(bytes);
      view.setUint8(0, 15); view.setFloat32(1, pending.scale, true); transmit(bytes);
    } else send(pending.type === 'move' ? 1 : 2, pending.dx, pending.dy);
    pending = null;
  }
}
function action(a: Action, coasting = false) {
  if (a.type === 'scroll' && !coasting) momentum.track(a.dx, a.dy, performance.now());
  if (a.type === 'zoomend') {
    flush(); send(16);
  } else if (a.type === 'move' || a.type === 'scroll' || a.type === 'zoom') {
    if (pending && pending.type !== a.type) flush();
    // Pinch carries an absolute scale: coalescing keeps the latest sample.
    if (a.type === 'zoom') pending = { type: 'zoom', scale: a.scale };
    else {
      const factor = a.type === 'move' ? pointerSpeed : scrollSpeed * (natural.checked ? -1 : 1);
      if (!pending || pending.type === 'zoom') pending = { type: a.type, dx: 0, dy: 0 };
      pending.dx += a.dx * factor; pending.dy += a.dy * factor;
    }
    // Cursor updates can follow 240 Hz touch sampling; scrolling stays at 125 Hz.
    // A busy event loop must not hold an overdue update behind its pending timer.
    const delay = (a.type === 'move' ? 4 : 8) - (performance.now() - lastMotion);
    if (delay <= 0) flush(); else if (!frame) frame = window.setTimeout(flush, Math.ceil(delay));
  } else { flush(); send(({ left: 3, right: 4, down: 5, up: 6, rightdown: 12, rightup: 13 } as Record<string, number>)[a.type]); }
  setDragging(a.type === 'down' || gestures.dragging);
}
const dragState = $('drag-state');
function setDragging(active: boolean) { if (dragState.hidden === active) dragState.hidden = !active; }
const gestures = new Gestures(action, () => modifiers.has('super'));
const momentum = new ScrollMomentum();
let momentumFrame = 0;
function stopMomentum() {
  flow?.discardMotion(2);
  // Discard any unsent coast delta before a new touch or shortcut takes control.
  if (momentumFrame && pending?.type === 'scroll') { clearTimeout(frame); frame = 0; pending = null; }
  cancelAnimationFrame(momentumFrame); momentumFrame = 0; momentum.reset();
}
function coast() {
  momentumFrame = 0;
  if (!ready || socket?.readyState !== WebSocket.OPEN) { stopMomentum(); return; }
  const delta = momentum.step(performance.now());
  if (!delta) return;
  action({ type: 'scroll', ...delta }, true);
  momentumFrame = requestAnimationFrame(coast);
}
function releaseScroll(time: number) {
  flush();
  if (!modifiers.has('super') && momentum.release(time)) momentumFrame = requestAnimationFrame(coast);
}
// Catch touches on every control, including a tap that only brakes the strip.
document.addEventListener('touchstart', stopMomentum, { capture: true, passive: true });
document.addEventListener('pointerdown', stopMomentum, true);
document.addEventListener('keydown', stopMomentum, true);
function resetScroll() { scrollTouch = null; scrollZone.classList.remove('active'); }
function moveStrip(touch: Touch) {
  if (!scrollTouch) return;
  const dx = touch.clientX - scrollTouch.x, dy = touch.clientY - scrollTouch.y;
  if ((dx || dy) && (scrollTouch.moved || Math.hypot(dx, dy) >= 6)) {
    action({ type: 'scroll', dx, dy });
    scrollTouch = { id: scrollTouch.id, x: touch.clientX, y: touch.clientY, moved: true };
  }
}
function cancel() { flow?.discardQueued(); rightTouch = null; stopMomentum(); stopText(); resetScroll(); superPointers.clear(); padSuperPointers.clear(); superKeys.clear(); padTouches = 0; ignorePad = false; clearTimeout(hold); clearTimeout(frame); frame = 0; pending = null; lastMotion = -Infinity; gestures.cancel(); releaseHeldKeys(); send(7); modifiers.clear(); shortcutModifiers.clear(); updateModifiers(); pad.classList.remove('active'); setDragging(false); }
for (const type of ['touchstart', 'touchmove', 'touchend'] as const) {
  pad.addEventListener(type, (event: TouchEvent) => {
    // Touches retain their original target when sliding across zone boundaries.
    // Use all surface touches, including those starting on different child elements.
    if ((event.target as Element).closest('button')) return;
    event.preventDefault(); if (!ready) return;
    const onSurface = (t: Touch) => pad.contains(t.target as Node) && !(t.target as Element).closest('button');
    const touches = Array.from(event.touches).filter(onSurface);
    const ended = type === 'touchend' ? Array.from(event.changedTouches).filter(onSurface) : [];
    const points = touches.map(t => ({ x: t.clientX, y: t.clientY }));
    const time = performance.now();
    if (type === 'touchstart') {
      if (!padTouches) { flush(); lastMotion = -Infinity; }
      momentum.begin(time); nativeInput.blur(); resetTextContext();
    }
    if (!padTouches && touches.length === 1 && (touches[0].target as Element).closest('#scroll-zone')) {
      // Keep the gesture in its starting zone, even if the finger slides out.
      gestures.cancel(); clearTimeout(hold);
      scrollTouch = { id: touches[0].identifier, x: touches[0].clientX, y: touches[0].clientY, moved: false };
      scrollZone.classList.toggle('active', true);
    }
    const previousCount = padTouches;
    padTouches = points.length;
    if (ignorePad) { resetScroll(); if (!padTouches) ignorePad = false; return; }
    if (scrollTouch) {
      const finalTouch = ended.find(t => t.identifier === scrollTouch!.id);
      if (finalTouch) moveStrip(finalTouch);
      if (touches.length !== 1 || touches[0].identifier !== scrollTouch.id) {
        if (!padTouches && type === 'touchend') releaseScroll(time); else { flush(); stopMomentum(); }
        resetScroll(); ignorePad = padTouches > 0;
      } else moveStrip(touches[0]);
      return;
    }
    // touchend carries the lifted fingers' final positions in changedTouches.
    // Deliver that last sample before ending a drag, scroll, or pinch.
    if (ended.length && touches.length + ended.length === previousCount) {
      gestures.update([...touches, ...ended].map(t => ({ x: t.clientX, y: t.clientY })), time);
    }
    gestures.update(points, time);
    if (!padTouches && type === 'touchend') releaseScroll(time);
    if (type !== 'touchmove') clearTimeout(hold);
    if (type === 'touchstart' && points.length === 1) hold = window.setTimeout(() => { gestures.hold(performance.now()); setDragging(gestures.dragging); }, 400);
    setDragging(gestures.dragging);
    const label = modifiers.has('super') ? (points.length === 2 ? 'Resizing window' : 'Moving window') : 'Dragging';
    if (dragState.textContent !== label) dragState.textContent = label;
  }, { passive: false });
}
pad.addEventListener('touchcancel', cancel); pad.addEventListener('contextmenu', e => e.preventDefault());
$('scroll-side').addEventListener('click', event => {
  const side = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-side]')?.dataset.side;
  if (side !== 'left' && side !== 'right') return;
  cancel(); scrollSide = side; save('scrollSide', side); scrollSidePreference();
});
function connect() {
  clearTimeout(reconnect);
  if (paused || document.hidden) return;
  if (socket && (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED)) closeConnection?.(false);
  if (socket) return;
  if (!key) { status('Pair your phone', 'Scan the QR code in the Ghostpad receiver terminal.'); $('hint').textContent = 'Scan your computer’s QR code to connect.'; return; }
  status('Connecting', 'Looking for your computer on this Wi-Fi network.');
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`, 'ghostpad.flow.v1');
    ws.binaryType = 'arraybuffer';
  }
  catch { status('Connection blocked', 'Safari could not open the local connection. Open the exact address from the receiver.'); $('reload').hidden = false; return; }
  socket = ws;
  closeConnection = close;
  connectionDeadline = window.setTimeout(() => {
    if (socket !== ws || ready) return;
    status('Connection timed out', 'The page loaded, but the computer did not finish connecting. Check that Ghostpad is still running.');
    $('reload').hidden = false;
    close();
  }, 7000);
  ws.onopen = () => {
    if (socket !== ws) { ws.close(); return; }
    try { ws.send(key); } catch { close(); }
  };
  ws.onmessage = e => {
    if (socket !== ws) return;
    if (e.data instanceof ArrayBuffer) { flow?.acknowledge(e.data); return; }
    if (e.data === 'pong') {
      lastPong = performance.now();
      if (lastPing !== null) {
        const ms = Math.round(performance.now() - lastPing);
        $('latency').textContent = `Wi-Fi round-trip: ${ms} ms${flow && flow.interval > 8 ? ' · adapting to a slower link' : ''}`;
        lastPing = null;
      }
      return;
    }
    if (typeof e.data === 'string' && e.data.startsWith('ready:')) {
      clearTimeout(connectionDeadline); $('reload').hidden = true;
      if (ready) return;
      ready = true; retry = 500; lastPong = performance.now(); lastPing = null;
      if (ws.protocol === 'ghostpad.flow.v1') flow = new InputFlow(ws, {
        now: () => performance.now(), later: (fn, ms) => window.setTimeout(fn, ms), clear: id => clearTimeout(id),
      }, () => close());
      const preview = e.data === 'ready:preview';
      status(preview ? 'Preview' : 'Connected', preview ? 'Preview mode. Gestures connect, but do not move the computer’s cursor.' : `Connected locally · ${location.protocol === 'https:' ? 'encrypted' : 'unencrypted, trusted Wi-Fi only'}`, true);
      $('hint').textContent = preview ? 'Connected in preview. Cursor control is off.' : 'Your desktop, at your fingertips.';
      heartbeat = window.setInterval(() => { if (performance.now() - lastPong > 6000) close(); else if (lastPing === null) { lastPing = performance.now(); send(8); } }, 1500);
    } else if (e.data === 'unauthorized') {
      paused = true; key = ''; save('key', ''); status('Pair again', 'Pairing was revoked. Scan the receiver’s new QR code.'); close();
    } else if (e.data === 'busy') { status('Computer busy', 'Another phone is connected. Disconnect it to use this phone.'); close(); }
  };
  ws.onerror = () => close();
  function close(shouldRetry = true) {
    // A suspended or broken browser connection may never dispatch onclose.
    // Retire it now; late events cannot affect its replacement.
    ws.close(); finish(shouldRetry);
  }
  function finish(shouldRetry = true) {
    if (socket !== ws) return;
    clearTimeout(connectionDeadline); flow?.stop(); flow = null; ready = false; socket = null; closeConnection = null; lastPing = null; clearInterval(heartbeat); cancel();
    if (shouldRetry && !paused && !document.hidden) {
      if ($('status').textContent !== 'Computer busy') status('Reconnecting', 'Keep both devices on the same Wi-Fi. Reconnecting automatically.');
      reconnect = window.setTimeout(connect, retry + Math.random() * 200); retry = Math.min(8000, retry * 1.7);
    }
  }
  ws.onclose = () => finish();
}
function suspend() { cancel(); closeConnection?.(false); clearTimeout(reconnect); clearInterval(heartbeat); }
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else connect(); });
window.addEventListener('pagehide', suspend); window.addEventListener('pageshow', connect); window.addEventListener('online', connect);
let settingsOpener: HTMLElement = $('settings-open');
let preferredNative = read('keyboardMode') !== 'grid';
function closeSettings(restore = true) {
  if (!dialog.open) return;
  dialog.removeAttribute('open'); bodyClasses.remove('settings-open');
  if (restore) settingsOpener.focus({ preventScroll: true });
}
function closeKeyboard(restore = true) {
  if (keyboardPanel.hidden) { cancel(); return; }
  // Dismiss the OS keyboard while its focused field still has a rendered box.
  // Hiding first can leave Safari's keyboard accessory and viewport stranded.
  nativeInput.blur(); cancel();
  keyboardPanel.hidden = true;
  $('keyboard-toggle').setAttribute('aria-expanded', 'false');
  bodyClasses.remove('keyboard-open');
  fitViewport();
  $('typing-help').textContent = typingHelp;
  if (restore) $('keyboard-toggle').focus({ preventScroll: true });
}
function openSettings(opener: HTMLElement = $('settings-open')) {
  settingsOpener = opener; closeKeyboard(false); cancel();
  dialog.setAttribute('open', ''); bodyClasses.add('settings-open');
  $('settings-close').focus({ preventScroll: true });
}
$('settings-open').onclick = () => openSettings();
$('settings-handle').onclick = () => { if (dialog.open) closeSettings(); else openSettings($('settings-handle')); };
$('settings-close').onclick = () => closeSettings();
$('keyboard-close').onclick = () => closeKeyboard();
// Capture the original control and preserve typing focus until activation. A viewport
// resize between press and release must not retarget the tap to another element.
let controlClick: { x: number; y: number } | null = null;
for (const id of ['keyboard-close', 'native-mode', 'grid-mode', 'settings-close', 'settings-handle']) {
  const button = $(id);
  let press: { id: number; x: number; y: number } | null = null;
  button.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    press = { id: event.pointerId, x: event.clientX, y: event.clientY };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointerup', event => {
    if (!press || press.id !== event.pointerId) return;
    const { x, y } = press; press = null;
    controlClick = { x: event.clientX, y: event.clientY };
    if (id === 'settings-handle' && y - event.clientY > 20) openSettings(button);
    else if (Math.hypot(x - event.clientX, y - event.clientY) < 12) button.click();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) button.addEventListener(type, () => { press = null; });
  button.addEventListener('click', event => { if (event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing) return;
  if (dialog.open) { event.preventDefault(); closeSettings(); }
  else if (!keyboardPanel.hidden) { event.preventDefault(); closeKeyboard(); }
});
// A rapid repeat tap where the opener used to be must not become remote input.
let openingTap: { x: number; y: number; until: number } | null = null;
const blockedPointers = new Set<number>(), blockedTouches = new Set<number>();
function nearOpening(x: number, y: number) {
  return openingTap && performance.now() < openingTap.until && Math.hypot(x - openingTap.x, y - openingTap.y) < 32;
}
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'click']) {
  document.addEventListener(type, event => {
    let block = false;
    if (type === 'pointerdown') controlClick = null;
    const remoteTarget = (event.target as Element | null)?.closest('#pad, #keyboard, #special-keys, #native-tools');
    if (type === 'click' && event instanceof MouseEvent && event.detail > 0) {
      block = !!controlClick && Math.hypot(event.clientX - controlClick.x, event.clientY - controlClick.y) < 20;
      controlClick = null;
      block ||= !!remoteTarget && !!nearOpening(event.clientX, event.clientY);
    } else if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
      if (type === 'pointerdown' && remoteTarget && nearOpening(event.clientX, event.clientY)) blockedPointers.add(event.pointerId);
      block = blockedPointers.has(event.pointerId);
      if (type === 'pointerup' || type === 'pointercancel') {
        blockedPointers.delete(event.pointerId);
        if (block) openingTap = { x: event.clientX, y: event.clientY, until: Math.max(openingTap?.until || 0, performance.now() + 50) };
      }
    } else if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
      for (const touch of Array.from(event.changedTouches)) {
        if (type === 'touchstart' && remoteTarget && nearOpening(touch.clientX, touch.clientY)) blockedTouches.add(touch.identifier);
        if (blockedTouches.has(touch.identifier)) block = true;
        if (type === 'touchend' || type === 'touchcancel') blockedTouches.delete(touch.identifier);
      }
    } else if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent && event.detail > 0) block = !!remoteTarget && !!nearOpening(event.clientX, event.clientY);
    if (block) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, passive: false });
}
$('disconnect').onclick = () => { paused = !paused; $('disconnect').textContent = paused ? 'Reconnect' : 'Disconnect'; if (paused) { suspend(); status('Disconnected', 'Tap Reconnect when you’re ready.'); } else connect(); };
$('forget').onclick = () => { paused = true; suspend(); key = ''; save('key', ''); status('Pair your phone', 'Pairing forgotten on this phone. Scan a QR code to connect again.'); $('hint').textContent = 'Scan your computer’s QR code to connect.'; closeSettings(); };

function updateModifiers() {
  for (const id of ['mod-super', 'key-super']) $(id).setAttribute('aria-pressed', String(modifiers.has('super')));
  for (const name of ['ctrl', 'alt', 'shift']) $(`mod-${name}`).setAttribute('aria-pressed', String(shortcutModifiers.has(name)));
  const names = Array.from(shortcutModifiers.keys(), name => name[0].toUpperCase() + name.slice(1));
  if (modifiers.has('super')) names.unshift('Super held');
  $('shortcut-help').textContent = names.length ? `${names.join(' + ')} · tap a key` : 'Hold Super; lift to release. Tap Shift, Ctrl or Alt for one shortcut.';
  bodyClasses.toggle('super-held', modifiers.has('super'));
  updateSuperFill();
  if (ready) $('hint').textContent = modifiers.has('super') ? 'Super held · 1 finger moves · 2 fingers resize' : 'Pinch to zoom · hold Super to move or resize windows.';
}
function toggleModifier(name: string, usage: number) {
  if (!ready || textQueue.length) return;
  keyboardMode(false); resetTextContext();
  gestures.cancel();
  if (shortcutModifiers.has(name)) shortcutModifiers.delete(name); else shortcutModifiers.set(name, usage);
  updateModifiers();
}
for (const [name, usage] of [['ctrl', 224], ['alt', 226], ['shift', 225]] as const) {
  $(`mod-${name}`).onclick = () => toggleModifier(name, usage);
}
function setSuper(down: boolean) {
  if (down && (!ready || textQueue.length)) return;
  if (down === modifiers.has('super')) return;
  stopMomentum();
  if (down) { nativeInput.blur(); resetTextContext(); }
  gestures.cancel();
  if (padTouches) { ignorePad = true; resetScroll(); }
  keyEvent(down ? 9 : 10, 227);
  if (down) modifiers.set('super', 227); else modifiers.delete('super');
  updateModifiers();
}
function releaseSuper() { if (!superPointers.size && !superKeys.size) setSuper(false); updateSuperFill(); }
for (const id of ['mod-super', 'key-super']) {
  const button = $(id);
  function prepareSuper() {
    if (id === 'key-super') keyboardMode(false); else shortcutModifiers.clear();
    setSuper(true); updateModifiers();
  }
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); if (!ready || textQueue.length || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (id === 'mod-super') {
      if (!padSuperPointers.size && !superKeys.has(button)) superOrigin = { x: event.clientX ?? null, y: event.clientY ?? null };
      padSuperPointers.add(event.pointerId);
    }
    superPointers.add(event.pointerId); button.setPointerCapture(event.pointerId); prepareSuper();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(event, event => {
    superPointers.delete(event.pointerId); padSuperPointers.delete(event.pointerId); releaseSuper();
  });
  button.addEventListener('contextmenu', event => event.preventDefault());
  button.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); if (!ready || textQueue.length || event.repeat) return;
      if (id === 'mod-super' && !padSuperPointers.size) superOrigin = { x: null, y: null };
      superKeys.add(button); prepareSuper();
    }
  });
  button.addEventListener('keyup', event => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); superKeys.delete(button); releaseSuper(); }
  });
  button.addEventListener('blur', () => { superKeys.delete(button); releaseSuper(); });
}
window.addEventListener('blur', () => { cancel(); if (viewportFocused) watchViewport(false); });
const rightClick = $('right-click');
rightClick.onclick = () => { if (ready) { nativeInput.blur(); resetTextContext(); gestures.cancel(); if (padTouches) ignorePad = true; clearTimeout(hold); flush(); send(4); } };
// Handle touch taps directly: browsers can suppress a compatibility click after
// a captured Super drag. Prevent the native click so each tap sends only once.
rightClick.addEventListener('touchstart', event => {
  event.preventDefault(); rightTouch = event.targetTouches.length === 1 ? event.targetTouches[0] : null;
}, { passive: false });
for (const type of ['touchmove', 'touchend'] as const) rightClick.addEventListener(type, event => {
  event.preventDefault();
  const touch = Array.from(event.changedTouches).find(t => t.identifier === rightTouch?.identifier);
  if (touch && rightTouch && Math.hypot(touch.clientX - rightTouch.clientX, touch.clientY - rightTouch.clientY) > 9) rightTouch = null;
  if (type === 'touchend') { if (touch && rightTouch) rightClick.click(); rightTouch = null; }
}, { passive: false });
$('keyboard-toggle').onclick = event => {
  if (event.detail > 0) openingTap = { x: event.clientX, y: event.clientY, until: performance.now() + 450 };
  if (!keyboardPanel.hidden) { closeKeyboard(); return; }
  cancel(); closeSettings(false); keyboardPanel.hidden = false;
  $('keyboard-toggle').setAttribute('aria-expanded', 'true'); bodyClasses.toggle('keyboard-open', true);
  $('typing-help').textContent = typingHelp;
  keyboardPanel.querySelector('.sheet-scroll')!.scrollTop = 0;
  keyboardMode(preferredNative);
  if (!preferredNative) $('grid-mode').focus({ preventScroll: true });
};
const typingHelp = $('typing-help').textContent;
const nativeInput = $<HTMLTextAreaElement>('native-input');
function focusNative() {
  if (document.activeElement === nativeInput) {
    if (viewportFocused) return;
    nativeInput.blur();
  }
  // Safari otherwise starts a second page scroll toward the field's old position.
  nativeInput.style.opacity = '0';
  nativeInput.focus({ preventScroll: true });
  requestAnimationFrame(() => { nativeInput.style.opacity = ''; });
}
function resetTextContext() { previousText = ''; nativeInput.value = ''; }
function stopText() { composing = false; clearTimeout(textTimer); textTimer = 0; textQueue = []; previousText = ''; $<HTMLTextAreaElement>('native-input').value = ''; }
function pumpText() {
  textTimer = 0;
  if (!ready) { stopText(); return; }
  const packet = textQueue.shift(); if (packet) transmit(packet);
  if (textQueue.length) textTimer = window.setTimeout(pumpText, 12);
}
function queueText(packets: ArrayBuffer[]) {
  if (!ready) { $('typing-help').textContent = 'Connect to your computer before typing.'; return false; }
  if (textQueue.length + packets.length > 1024) { $('typing-help').textContent = 'Please wait for the current text to finish sending.'; return false; }
  textQueue.push(...packets); if (!textTimer) pumpText(); return true;
}
function encodeText(previous: string, value: string) {
  const edit = textEdit(previous, normalizeText(value));
  const packets: ArrayBuffer[] = [];
  for (let i = 0; i < edit.backspaces; i++) packets.push(new Uint8Array([11, 42]).buffer);
  for (let i = 0; i < edit.text.length; i += 120) packets.push(new Uint8Array([14, ...Array.from(edit.text.slice(i, i + 120), c => c.charCodeAt(0))]).buffer);
  return packets;
}
function nativeEdit() {
  if (composing) return;
  releaseHeldKeys();
  try {
    if (queueText(encodeText(previousText, nativeInput.value))) {
      previousText = normalizeText(nativeInput.value);
      $('typing-help').textContent = 'Typing into the focused computer window.';
    }
  } catch (error) { $('typing-help').textContent = (error as Error).message; }
}
nativeInput.addEventListener('focus', () => {
  // Plain typing must not accidentally become Super/Ctrl/Alt shortcuts.
  gestures.cancel(); releaseHeldKeys(); flush(); send(7); modifiers.clear(); shortcutModifiers.clear(); superPointers.clear(); padSuperPointers.clear(); superKeys.clear(); updateModifiers();
  watchViewport(true);
});
nativeInput.addEventListener('blur', () => watchViewport(false));
// The OS can hide its keyboard without removing DOM focus from the textarea.
nativeInput.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' && (!viewportFocused || document.activeElement !== nativeInput)) {
    event.preventDefault(); focusNative();
  }
});
nativeInput.addEventListener('compositionstart', () => { composing = true; });
nativeInput.addEventListener('compositionend', () => { composing = false; nativeEdit(); });
nativeInput.addEventListener('input', nativeEdit);
// Backspace on an empty local buffer still deletes on the remote computer.
nativeInput.addEventListener('beforeinput', (event: InputEvent) => {
  if (!composing && event.inputType === 'deleteContentBackward' && !nativeInput.value && !previousText) {
    event.preventDefault(); releaseHeldKeys(); queueText([new Uint8Array([11, 42]).buffer]);
  }
});
function keyboardMode(native: boolean) {
  preferredNative = native; save('keyboardMode', native ? 'native' : 'grid');
  if ($('native-panel').hidden !== !native) releaseHeldKeys();
  if (!native) nativeInput.blur();
  $('native-panel').hidden = !native; $('keyboard').hidden = native;
  $('native-tools').hidden = !native; $('special-keys').hidden = native;
  bodyClasses.toggle('grid-mode', !native);
  $('native-mode').setAttribute('aria-pressed', String(native)); $('grid-mode').setAttribute('aria-pressed', String(!native));
  if (native) focusNative();
}
$('native-mode').onclick = () => keyboardMode(true);
$('grid-mode').onclick = () => keyboardMode(false);
// Reference counts keep overlapping fingers/chords from releasing one another.
function holdUsage(usage: number) {
  const count = heldUsages.get(usage) || 0;
  if (!count) keyEvent(9, usage);
  heldUsages.set(usage, count + 1);
}
function liftUsage(usage: number) {
  const count = heldUsages.get(usage) || 0;
  if (count > 1) heldUsages.set(usage, count - 1);
  else { heldUsages.delete(usage); keyEvent(10, usage); }
}
function beginKey(button: HTMLButtonElement, id: number | string) {
  if (!ready || composing || heldKeys.has(id)) return;
  if (textQueue.length) { $('typing-help').textContent = 'Please wait for the current text to finish sending.'; return; }
  if (!button.closest('#native-tools')) nativeInput.blur();
  gestures.cancel(); resetTextContext();
  const chord = Array.from(shortcutModifiers.values()), usage = Number(button.dataset.key);
  heldKeys.set(id, { button, usage, chord });
  for (const modifier of chord) holdUsage(modifier);
  holdUsage(usage); button.classList.toggle('held', true);
  shortcutModifiers.clear(); updateModifiers();
}
function endKey(id: number | string) {
  const key = heldKeys.get(id); if (!key) return;
  heldKeys.delete(id); liftUsage(key.usage);
  for (const modifier of key.chord.slice().reverse()) liftUsage(modifier);
  key.button.classList.toggle('held', Array.from(heldKeys.values()).some(k => k.button === key.button));
}
function releaseHeldKeys() { for (const id of heldKeys.keys()) endKey(id); }
function specialKey(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-key]');
  if (!button || !ready || composing) return;
  // Pointer holds already sent down/up. Detail zero remains an accessible click fallback.
  if (button.dataset.hold !== undefined && (event.detail > 0 || Array.from(heldKeys.values()).some(k => k.button === button))) return;
  const held = new Set(shortcutModifiers.values());
  if (button.dataset.shift === 'true') held.add(225);
  if (held.size && textQueue.length) return;
  // Accessory keys navigate the computer without closing the phone keyboard.
  if (!button.closest('#native-tools')) nativeInput.blur();
  gestures.cancel(); resetTextContext(); flush();
  const usage = Number(button.dataset.key);
  if (held.size) {
    // Send the complete chord in this turn, with no timers that could leave a modifier held.
    for (const modifier of held) holdUsage(modifier);
    keyEvent(11, usage);
    for (const modifier of Array.from(held).reverse()) liftUsage(modifier);
    shortcutModifiers.clear(); updateModifiers();
  } else queueText([new Uint8Array([11, usage]).buffer]);
}
// Browsers can omit clicks from a second finger while Super is held.
// Handle touch taps explicitly, suppressing the browser's duplicate click.
for (const id of ['keyboard', 'special-keys', 'native-tools']) {
  const area = $(id), taps = new Map<number, { button: HTMLButtonElement; x: number; y: number }>();
  area.addEventListener('click', specialKey);
  area.addEventListener('pointerdown', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-hold]');
    if (!button || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); button.setPointerCapture(event.pointerId); beginKey(button, event.pointerId);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    area.addEventListener(type, event => endKey(event.pointerId));
  }
  for (const type of ['keydown', 'keyup'] as const) area.addEventListener(type, event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-hold]');
    if (!button || ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    const id = `${button.dataset.key}:${event.key}`;
    if (type === 'keyup') endKey(id); else if (!event.repeat) beginKey(button, id);
  });
  area.addEventListener('focusout', event => {
    for (const [id, key] of heldKeys) if (typeof id === 'string' && key.button === event.target) endKey(id);
  });
  area.addEventListener('contextmenu', event => event.preventDefault());
  area.addEventListener('touchstart', event => {
    for (const touch of Array.from(event.changedTouches)) {
      const button = (touch.target as Element).closest<HTMLButtonElement>('button');
      if (button && button.id !== 'key-super' && button.dataset.hold === undefined) taps.set(touch.identifier, { button, x: touch.clientX, y: touch.clientY });
    }
  }, { passive: true });
  area.addEventListener('touchmove', event => {
    for (const touch of Array.from(event.changedTouches)) {
      const tap = taps.get(touch.identifier);
      if (tap && Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > 10) taps.delete(touch.identifier);
    }
  }, { passive: true });
  area.addEventListener('touchend', event => {
    if ((event.target as Element).closest('button')?.id === 'key-super') return;
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      const tap = taps.get(touch.identifier); taps.delete(touch.identifier);
      if (!tap) continue;
      const rect = tap.button.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX < rect.right && touch.clientY >= rect.top && touch.clientY < rect.bottom) tap.button.click();
    }
  }, { passive: false });
  area.addEventListener('touchcancel', () => { taps.clear(); releaseHeldKeys(); });
}
for (const id of ['tracking-presets', 'scroll-presets']) {
  $(id).addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-speed]'); if (!button) return;
    const speed = Number(button.dataset.speed);
    if (id === 'tracking-presets') { sensitivity.value = String(speed); preferences(); }
    else { scrollSpeed = speed; save('scrollSpeed', String(speed)); }
    for (const item of $(id).querySelectorAll<HTMLButtonElement>('button')) item.setAttribute('aria-pressed', String(item === button));
  });
}
// Keep the outer painting/clip bounds at full CSS height. Reserve the native
// keyboard's space with padding inside that frame; never shrink the root layer.
// Blur releases the inset immediately, including during delayed Safari events.
let viewportFrame = 0, viewportUntil = 0, viewportFocused = false;
let viewportFullHeight = 0, viewportHeight = 0;
let openingTimer = 0;
function stopOpening() {
  clearTimeout(openingTimer); openingTimer = 0;
  bodyClasses.remove('keyboard-opening');
  main.style.removeProperty('--opening-shift'); main.style.removeProperty('--opening-scale');
}
function scheduleViewport() {
  if (!viewportFrame && !document.hidden) viewportFrame = requestAnimationFrame(() => { viewportFrame = 0; fitViewport(); });
}
function watchViewport(focused: boolean) {
  if (focused && !viewportFocused) viewportFullHeight = main.getBoundingClientRect().height;
  viewportFocused = focused;
  cancelAnimationFrame(viewportFrame); viewportFrame = 0;
  if (!focused) window.scrollTo?.(0, 0);
  viewportUntil = focused && window.visualViewport ? performance.now() + 1000 : 0;
  fitViewport();
}
function fitViewport() {
  const viewport = window.visualViewport;
  const rect = main.getBoundingClientRect(), height = viewport?.height || window.innerHeight;
  const top = Math.max(0, viewport?.offsetTop || 0, (parseFloat(main.style.top) || 0) - rect.top);
  const fullHeight = rect.height;
  if (viewportFocused && Math.abs(viewportFullHeight - fullHeight) < 1 && height >= fullHeight - 1 && parseFloat(main.style.paddingBottom) > 80) {
    viewportFocused = false; window.scrollTo?.(0, 0);
  }
  viewportFullHeight = fullHeight;
  const focused = viewportFocused && !keyboardPanel.hidden;
  const watching = performance.now() < viewportUntil;
  if (focused) {
    const opening = fullHeight - height > 80 && (parseFloat(main.style.paddingBottom) || 0) <= 80;
    const before = opening ? pad.getBoundingClientRect().height : 0;
    const inset = `${Math.max(0, fullHeight - height)}px`;
    if (main.style.paddingBottom !== inset) main.style.paddingBottom = inset;
    if (viewportHeight !== height) {
      viewportHeight = height;
      main.style.setProperty('--view-height', `${height}px`);
    }
    if (main.style.top !== `${top}px`) main.style.top = `${top}px`;
    if (opening && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const shift = before - pad.getBoundingClientRect().height;
      if (shift > 48) {
        stopOpening();
        main.style.setProperty('--opening-shift', `${shift}px`);
        main.style.setProperty('--opening-scale', String(1 + shift / 32));
        bodyClasses.add('keyboard-opening');
        openingTimer = window.setTimeout(stopOpening, 340);
      }
    }
  } else {
    stopOpening();
    viewportUntil = 0; viewportHeight = 0;
    main.style.removeProperty('padding-bottom'); main.style.removeProperty('top'); main.style.removeProperty('--view-height');
  }
  if (focused && watching) scheduleViewport();
  bodyClasses.toggle('native-focused', focused);
}
// Resize may precede the actual metric change, even long after initial focus.
function viewportChanged() {
  if (viewportFocused) viewportUntil = performance.now() + 400;
  scheduleViewport();
}
window.visualViewport?.addEventListener('resize', viewportChanged);
window.visualViewport?.addEventListener('scroll', viewportChanged);
window.addEventListener('resize', viewportChanged);
window.addEventListener('scroll', viewportChanged);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopOpening(); cancelAnimationFrame(viewportFrame); viewportFrame = 0; }
  else watchViewport(document.activeElement === nativeInput);
});
fitViewport();

window.dispatchEvent(new Event('ghostpad-started'));
connect();
