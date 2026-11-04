import { Gestures, type Action } from './gestures.js';
import { textEdit, normalizeText } from './text.js';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pad = $('pad'), dialog = $<HTMLDialogElement>('settings'), sensitivity = $<HTMLInputElement>('sensitivity'), natural = $<HTMLInputElement>('natural');
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
function preferences() { $('sensitivity-value').textContent = `${Number(sensitivity.value).toFixed(1)}×`; save('sensitivity', sensitivity.value); save('natural', String(natural.checked)); for (const button of $('tracking-presets').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === Number(sensitivity.value))); }
preferences(); sensitivity.oninput = preferences; natural.onchange = preferences;
let socket: WebSocket | null = null, ready = false, paused = false, retry = 500, reconnect = 0, heartbeat = 0, lastPong = 0, connectionDeadline = 0;
let lastMotion = -Infinity, lastPing = 0;
let padTouches = 0, ignorePad = false;
const superPointers = new Set<number>();
let textTimer = 0, textQueue: ArrayBuffer[] = [], previousText = '', composing = false;
const modifiers = new Map<string, number>();
// Keyboard modifiers are armed locally; only a completed shortcut holds remote keys.
const shortcutModifiers = new Map<string, number>();
let hold = 0, frame = 0, pending: { type: 'move' | 'scroll'; dx: number; dy: number } | { type: 'zoom'; scale: number } | null = null;
function status(label: string, detail: string, online = false) { $('status').textContent = label; $('detail').textContent = detail; $('dot').classList.toggle('online', online); document.body.classList.toggle('connected', online && label !== 'Preview'); if (!online) $('hint').textContent = detail; }
function transmit(bytes: ArrayBuffer) {
  if (!ready || socket?.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 256) { socket.close(); return; }
  socket.send(bytes);
}
function send(code: number, dx?: number, dy?: number) {
  if (!ready || socket?.readyState !== WebSocket.OPEN) return;
  // Never queue stale gestures behind an overloaded connection; release via disconnect.
  if (socket.bufferedAmount > 256) { socket.close(); return; }
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
function action(a: Action) {
  if (a.type === 'zoomend') {
    flush(); send(16);
  } else if (a.type === 'move' || a.type === 'scroll' || a.type === 'zoom') {
    if (pending && pending.type !== a.type) flush();
    // Pinch carries an absolute scale: coalescing keeps the latest sample.
    if (a.type === 'zoom') pending = { type: 'zoom', scale: a.scale };
    else {
      const factor = a.type === 'move' ? Number(sensitivity.value) : scrollSpeed * (natural.checked ? -1 : 1);
      if (!pending || pending.type === 'zoom') pending = { type: a.type, dx: 0, dy: 0 };
      pending.dx += a.dx * factor; pending.dy += a.dy * factor;
    }
    if (!frame) { const delay = 8 - (performance.now() - lastMotion); if (delay <= 0) flush(); else frame = window.setTimeout(flush, delay); }
  } else { flush(); send(({ left: 3, right: 4, down: 5, up: 6, rightdown: 12, rightup: 13 } as Record<string, number>)[a.type]); }
  $('drag-state').hidden = a.type !== 'down' && !gestures.dragging;
}
const gestures = new Gestures(action, () => modifiers.has('super'));
function cancel() { stopText(); superPointers.clear(); padTouches = 0; ignorePad = false; clearTimeout(hold); clearTimeout(frame); frame = 0; pending = null; lastMotion = -Infinity; gestures.cancel(); send(7); modifiers.clear(); shortcutModifiers.clear(); updateModifiers(); pad.classList.remove('active'); $('drag-state').hidden = true; }
for (const type of ['touchstart', 'touchmove', 'touchend'] as const) {
  pad.addEventListener(type, (event: TouchEvent) => {
    // Touches retain their original target when sliding across zone boundaries.
    // Use all surface touches, including those starting on different child elements.
    if ((event.target as Element).closest('button')) return;
    event.preventDefault(); if (!ready) return;
    const points = Array.from(event.touches).filter(t => pad.contains(t.target as Node) && !(t.target as Element).closest('button')).map(t => ({ x: t.clientX, y: t.clientY }));
    if (type === 'touchstart') { nativeInput.blur(); resetTextContext(); }
    padTouches = points.length;
    if (ignorePad) { if (!padTouches) ignorePad = false; return; }
    gestures.update(points, performance.now()); pad.classList.toggle('active', points.length > 0);
    if (type !== 'touchmove') clearTimeout(hold);
    if (type === 'touchstart' && points.length === 1) hold = window.setTimeout(() => { gestures.hold(performance.now()); $('drag-state').hidden = !gestures.dragging; }, 400);
    $('drag-state').hidden = !gestures.dragging;
    $('drag-state').textContent = modifiers.has('super') ? (points.length === 2 ? 'Resizing window' : 'Moving window') : 'Dragging';
  }, { passive: false });
}
pad.addEventListener('touchcancel', cancel); pad.addEventListener('contextmenu', e => e.preventDefault());
function connect() {
  clearTimeout(reconnect);
  if (paused || document.hidden || socket) return;
  if (!key) { status('Pair your phone', 'Scan the QR code in the Ghostpad receiver terminal.'); $('hint').textContent = 'Scan your computer’s QR code to connect.'; return; }
  status('Connecting', 'Looking for your computer on this Wi-Fi network.');
  let ws: WebSocket;
  try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); }
  catch { status('Connection blocked', 'Safari could not open the local connection. Open the exact address from the receiver.'); $('reload').hidden = false; return; }
  socket = ws;
  connectionDeadline = window.setTimeout(() => {
    if (socket !== ws || ready) return;
    status('Connection timed out', 'The page loaded, but the computer did not finish connecting. Check that Ghostpad is still running.');
    $('reload').hidden = false;
    ws.close();
    finish();
  }, 7000);
  ws.onopen = () => { if (socket === ws) ws.send(key); else ws.close(); };
  ws.onmessage = e => {
    if (socket !== ws) return;
    if (e.data === 'pong') { lastPong = Date.now(); $('latency').textContent = `Wi-Fi round-trip: ${Math.round(performance.now() - lastPing)} ms`; return; }
    if (typeof e.data === 'string' && e.data.startsWith('ready:')) {
      clearTimeout(connectionDeadline); $('reload').hidden = true;
      ready = true; retry = 500; lastPong = Date.now();
      const preview = e.data === 'ready:preview';
      status(preview ? 'Preview' : 'Connected', preview ? 'Preview mode. Gestures connect, but do not move the computer’s cursor.' : `Connected locally · ${location.protocol === 'https:' ? 'encrypted' : 'unencrypted, trusted Wi-Fi only'}`, true);
      $('hint').textContent = preview ? 'Connected in preview. Cursor control is off.' : 'Your desktop, at your fingertips.';
      $('mode').textContent = preview ? 'PREVIEW · INPUT DISABLED' : 'LOCAL WI-FI · NO CLOUD';
      heartbeat = window.setInterval(() => { if (Date.now() - lastPong > 6000) ws.close(); else { lastPing = performance.now(); send(8); } }, 1500);
    } else if (e.data === 'unauthorized') {
      paused = true; key = ''; save('key', ''); status('Pair again', 'Pairing was revoked. Scan the receiver’s new QR code.'); ws.close();
    } else if (e.data === 'busy') { status('Computer busy', 'Another phone is connected. Disconnect it to use this phone.'); ws.close(); }
  };
  ws.onerror = () => ws.close();
  function finish() {
    if (socket !== ws) return;
    clearTimeout(connectionDeadline); ready = false; socket = null; clearInterval(heartbeat); cancel();
    if (!paused && !document.hidden) {
      if ($('status').textContent !== 'Computer busy') status('Reconnecting', 'Keep both devices on the same Wi-Fi. Reconnecting automatically.');
      reconnect = window.setTimeout(connect, retry + Math.random() * 200); retry = Math.min(8000, retry * 1.7);
    }
  }
  ws.onclose = finish;
}
function suspend() { cancel(); clearTimeout(reconnect); clearInterval(heartbeat); socket?.close(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else { if (socket?.readyState === WebSocket.CLOSED) socket = null; connect(); } });
window.addEventListener('pagehide', suspend); window.addEventListener('pageshow', connect); window.addEventListener('online', connect);
function closeSettings() { dialog.removeAttribute('open'); document.body.classList.toggle('settings-open', false); }
function closeKeyboard() { $('native-input').blur(); $('keyboard-panel').hidden = true; $('keyboard-toggle').setAttribute('aria-expanded', 'false'); document.body.classList.toggle('keyboard-open', false); cancel(); }
function openSettings() { closeKeyboard(); cancel(); dialog.setAttribute('open', ''); document.body.classList.toggle('settings-open', true); }
$('settings-open').onclick = openSettings;
$('settings-handle').onclick = () => { if (dialog.open) closeSettings(); else openSettings(); };
$('settings-close').onclick = closeSettings;
$('keyboard-close').onclick = closeKeyboard;
let handleStart = 0;
$('settings-handle').addEventListener('pointerdown', e => { handleStart = e.clientY; });
$('settings-handle').addEventListener('pointerup', e => { if (handleStart - e.clientY > 20) openSettings(); });
$('disconnect').onclick = () => { paused = !paused; $('disconnect').textContent = paused ? 'Reconnect' : 'Disconnect'; if (paused) { suspend(); status('Disconnected', 'Tap Reconnect when you’re ready.'); } else connect(); };
$('forget').onclick = () => { paused = true; suspend(); key = ''; save('key', ''); status('Pair your phone', 'Pairing forgotten on this phone. Scan a QR code to connect again.'); $('hint').textContent = 'Scan your computer’s QR code to connect.'; closeSettings(); };

function updateModifiers() {
  $('mod-super').setAttribute('aria-pressed', String(modifiers.has('super')));
  for (const name of ['super', 'ctrl', 'alt', 'shift']) $(name === 'super' ? 'key-super' : `mod-${name}`).setAttribute('aria-pressed', String(shortcutModifiers.has(name)));
  const names = Array.from(shortcutModifiers.keys(), name => name[0].toUpperCase() + name.slice(1));
  $('shortcut-help').textContent = names.length ? `${names.join(' + ')} · tap a key` : 'Tap modifiers, then a key. They clear after each shortcut.';
  document.body.classList.toggle('super-held', modifiers.has('super'));
  if (ready) $('hint').textContent = modifiers.has('super') ? 'Super held · 1 finger moves · 2 fingers resize' : 'Pinch to zoom · hold Super to move or resize windows.';
}
function toggleModifier(name: string, usage: number) {
  if (!ready || textQueue.length) return;
  keyboardMode(false); resetTextContext();
  gestures.cancel(); setSuper(false);
  if (shortcutModifiers.has(name)) shortcutModifiers.delete(name); else shortcutModifiers.set(name, usage);
  updateModifiers();
}
for (const [name, usage] of [['super', 227], ['ctrl', 224], ['alt', 226], ['shift', 225]] as const) {
  $(name === 'super' ? 'key-super' : `mod-${name}`).onclick = () => toggleModifier(name, usage);
}
function setSuper(down: boolean) {
  if (down && (!ready || textQueue.length)) return;
  if (down === modifiers.has('super')) return;
  if (down) { nativeInput.blur(); resetTextContext(); shortcutModifiers.clear(); }
  gestures.cancel();
  if (padTouches) ignorePad = true;
  keyEvent(down ? 9 : 10, 227);
  if (down) modifiers.set('super', 227); else modifiers.delete('super');
  updateModifiers();
}
const superButton = $('mod-super');
superButton.addEventListener('pointerdown', event => {
  event.preventDefault(); if (!ready || textQueue.length || (event.pointerType === 'mouse' && event.button !== 0)) return;
  superPointers.add(event.pointerId); superButton.setPointerCapture(event.pointerId); setSuper(true);
});
function releaseSuper(event: PointerEvent) { superPointers.delete(event.pointerId); if (!superPointers.size) setSuper(false); }
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) superButton.addEventListener(event, releaseSuper);
superButton.addEventListener('contextmenu', event => event.preventDefault());
superButton.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setSuper(true); } });
superButton.addEventListener('keyup', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setSuper(false); } });
superButton.addEventListener('blur', () => { if (!superPointers.size) setSuper(false); });
window.addEventListener('blur', cancel);
$('right-click').onclick = () => { if (ready) { nativeInput.blur(); resetTextContext(); gestures.cancel(); if (padTouches) ignorePad = true; clearTimeout(hold); flush(); send(4); } };
$('keyboard-toggle').onclick = () => {
  if (!$('keyboard-panel').hidden) { closeKeyboard(); return; }
  cancel(); closeSettings(); $('keyboard-panel').hidden = false;
  $('keyboard-toggle').setAttribute('aria-expanded', 'true'); document.body.classList.toggle('keyboard-open', true);
};
const nativeInput = $<HTMLTextAreaElement>('native-input');
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
  try {
    if (queueText(encodeText(previousText, nativeInput.value))) {
      previousText = normalizeText(nativeInput.value);
      $('typing-help').textContent = 'Typing into the focused computer window.';
    }
  } catch (error) { $('typing-help').textContent = (error as Error).message; }
}
nativeInput.addEventListener('focus', () => {
  // Plain typing must not accidentally become Super/Ctrl/Alt shortcuts.
  gestures.cancel(); flush(); send(7); modifiers.clear(); shortcutModifiers.clear(); superPointers.clear(); updateModifiers();
});
nativeInput.addEventListener('compositionstart', () => { composing = true; });
nativeInput.addEventListener('compositionend', () => { composing = false; nativeEdit(); });
nativeInput.addEventListener('input', nativeEdit);
// Backspace on an empty local buffer still deletes on the remote computer.
nativeInput.addEventListener('beforeinput', (event: InputEvent) => {
  if (!composing && event.inputType === 'deleteContentBackward' && !nativeInput.value && !previousText) {
    event.preventDefault(); queueText([new Uint8Array([11, 42]).buffer]);
  }
});
function keyboardMode(native: boolean) {
  $('native-panel').hidden = !native; $('keyboard').hidden = native;
  $('native-mode').setAttribute('aria-pressed', String(native)); $('grid-mode').setAttribute('aria-pressed', String(!native));
  if (native) nativeInput.focus(); else nativeInput.blur();
}
$('native-mode').onclick = () => keyboardMode(true);
$('grid-mode').onclick = () => keyboardMode(false);
function specialKey(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-key]');
  if (!button || !ready) return;
  if (shortcutModifiers.size && textQueue.length) return;
  nativeInput.blur(); gestures.cancel(); resetTextContext(); flush();
  const usage = Number(button.dataset.key);
  if (shortcutModifiers.size) {
    // Send the complete chord in this turn, with no timers that could leave a modifier held.
    const held = Array.from(shortcutModifiers.values());
    for (const modifier of held) keyEvent(9, modifier);
    keyEvent(11, usage);
    for (const modifier of held.reverse()) keyEvent(10, modifier);
    shortcutModifiers.clear(); updateModifiers();
  } else queueText([new Uint8Array([11, usage]).buffer]);
}
$('keyboard').addEventListener('click', specialKey);
$('special-keys').addEventListener('click', specialKey);
for (const id of ['tracking-presets', 'scroll-presets']) {
  $(id).addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-speed]'); if (!button) return;
    const speed = Number(button.dataset.speed);
    if (id === 'tracking-presets') { sensitivity.value = String(speed); preferences(); }
    else { scrollSpeed = speed; save('scrollSpeed', String(speed)); }
    for (const item of $(id).querySelectorAll<HTMLButtonElement>('button')) item.setAttribute('aria-pressed', String(item === button));
  });
}
// Fit the sheets above Safari's software keyboard without scrolling the touch surface away.
function fitViewport() {
  const height = window.visualViewport?.height;
  if (height) {
    document.querySelector('main')!.style.height = `${height}px`;
    document.body.classList.toggle('compact-keyboard', height < 500);
  }
}
window.visualViewport?.addEventListener('resize', fitViewport);
window.addEventListener('resize', fitViewport); fitViewport();

window.dispatchEvent(new Event('ghostpad-started'));
connect();
