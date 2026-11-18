const get = (id) => document.getElementById(id);
const connection = get('connection');
const label = get('connection-label');
const qrArea = get('qr-area');
const qrMessage = get('qr-message');
const qrPlaceholder = get('qr-placeholder');
const qrImage = get('pairing-qr');
const copyButton = get('copy-link');
const stopButton = get('stop-open');
const feedback = get('copy-feedback');
const linkInput = get('pairing-link');
const guide = get('gesture-guide');
const stopDialog = get('stop-dialog');
const stopConfirm = get('stop-confirm');
const connectedView = get('connected-view');
const codeToggle = get('code-toggle');
const retryButton = get('check-again');
const addressToggle = get('address-toggle');
const storageKey = 'ghostpad.desktop.key';
const fragment = new URLSearchParams(location.hash.slice(1)).get('key');
let key = fragment || '';
let stopped = false;
let checking = false;
let timer;
let copyTimer;
let qrLoaded = false;
let qrLoading = false;
let qrUnavailable = false;
let state = 'loading';
let showCode = false;
let failures = 0;
let pollDelay = 2000;
let suspended = false;
let lanOrigin = '', advertisedOrigin = '', pairingOrigin = '', pairingLink = '';
let useIp = false, qrVersion = 0;
if (location.hash)
history.replaceState(null, '', location.pathname);
try {
if (key && /^[a-f0-9]{64}$/i.test(key))
sessionStorage.setItem(storageKey, key);
else if (!fragment)
key = sessionStorage.getItem(storageKey) || '';
}
catch (_a) { }
if (!/^[a-f0-9]{64}$/i.test(key))
key = '';
function updatePairing() {
const hasFallback = !!lanOrigin && lanOrigin !== advertisedOrigin;
if (!hasFallback)
useIp = false;
addressToggle.hidden = !hasFallback;
addressToggle.textContent = useIp ? 'Use local hostname' : 'Use IP address';
const target = useIp ? lanOrigin : advertisedOrigin;
if (target !== pairingOrigin) {
pairingOrigin = target;
pairingLink = key && target ? `${target}/#key=${key}` : '';
linkInput.value = pairingLink;
qrVersion++;
qrLoaded = qrLoading = qrUnavailable = false;
qrImage.hidden = true;
qrImage.removeAttribute('src');
get('manual-copy').hidden = true;
unavailable('Preparing your code…');
}
get('computer-address').textContent = target ? new URL(target).host : '—';
const ip = lanOrigin ? new URL(lanOrigin) : null;
get('firewall-command').textContent = ip
? `ghostpad-allow-phone --lan ${ip.hostname}${ip.port && ip.port !== '8765' ? ` --port ${ip.port}` : ''}`
: '';
get('firewall-setup').hidden = !ip || ip.hostname.startsWith('127.');
copyButton.disabled = !target;
}
function renderPairing() {
const connected = state === 'connected';
qrArea.hidden = connected && !showCode;
connectedView.hidden = !connected || showCode;
codeToggle.hidden = !connected;
codeToggle.textContent = showCode ? 'Hide pairing code' : 'Show pairing code';
codeToggle.setAttribute('aria-expanded', String(connected && showCode));
get('scan-caption').hidden = connected;
get('pairing-heading').textContent = connected ? 'You’re connected' : 'Scan to connect';
}
function status(next, message) {
if (next !== state)
showCode = false;
state = next;
connection.dataset.state = next;
label.textContent = message;
renderPairing();
}
function unavailable(message, retry = false) {
qrImage.hidden = true;
qrPlaceholder.hidden = false;
qrMessage.textContent = message;
retryButton.hidden = !retry;
qrArea.setAttribute('aria-busy', 'false');
}
async function request(path, method = 'GET', target = '') {
const abort = new AbortController();
const timeout = setTimeout(() => abort.abort(), 4500);
try {
const headers = new Headers({ Authorization: `Bearer ${key}` });
if (target)
headers.set('X-Ghostpad-Pairing-Origin', target);
return await fetch(`/api/desktop/${path}`, {
method, headers,
cache: 'no-store', credentials: 'omit', signal: abort.signal,
});
}
finally {
clearTimeout(timeout);
}
}
async function loadQr() {
if (qrLoaded || qrLoading || qrUnavailable || stopped || !pairingOrigin)
return;
qrLoading = true;
const version = qrVersion;
try {
const response = await request(useIp ? 'qr/ip' : 'qr', 'GET', pairingOrigin);
if (stopped || version !== qrVersion)
return;
if (response.ok) {
const svg = await response.text();
if (stopped || version !== qrVersion)
return;
qrImage.onload = () => {
if (stopped || version !== qrVersion)
return;
qrLoaded = true;
qrPlaceholder.hidden = true;
qrImage.hidden = false;
retryButton.hidden = true;
qrArea.setAttribute('aria-busy', 'false');
};
qrImage.onerror = () => {
if (!stopped && version === qrVersion)
unavailable('Your code couldn’t load. Copy the link below, or try again.', true);
};
qrImage.src = `data:image/svg+xml;base64,${btoa(svg)}`;
}
else if (response.status === 503) {
qrUnavailable = true;
unavailable('Copy the link below to connect. For a QR code, install qrencode on this computer and restart Ghostpad.');
}
else
throw Error('QR unavailable');
}
catch (_a) {
if (!stopped && version === qrVersion)
unavailable('Your code couldn’t load. Copy the link below, or try again.', true);
}
finally {
if (version === qrVersion)
qrLoading = false;
}
}
async function check() {
clearTimeout(timer);
if (!key || stopped || checking || document.hidden || suspended)
return;
if (!navigator.onLine) {
offline();
return;
}
checking = true;
try {
const response = await request('status');
if (stopped || !navigator.onLine)
return;
if (response.status === 403) {
stopped = true;
status('invalid', 'This pairing link no longer works');
unavailable('Open Ghostpad from your app launcher to get your current code.');
copyButton.disabled = stopButton.disabled = true;
return;
}
if (!response.ok)
throw Error('Receiver unavailable');
const data = await response.json();
if (stopped || !navigator.onLine)
return;
failures = 0;
pollDelay = data.connected ? 5000 : 2000;
const nextLan = (data.lanOrigin === undefined ? location.origin : data.lanOrigin) || '';
const nextOrigin = (data.pairingOrigin === undefined ? nextLan : data.pairingOrigin) || '';
if (nextLan !== lanOrigin || nextOrigin !== advertisedOrigin) {
lanOrigin = nextLan;
advertisedOrigin = nextOrigin;
updatePairing();
}
status(data.connected ? 'connected' : 'waiting', data.connected ? 'Your phone is connected' : lanOrigin ? 'Waiting for your phone' : 'Waiting for a private network');
copyButton.disabled = !pairingOrigin;
stopButton.disabled = false;
get('scan-caption').textContent = lanOrigin ? 'Open the link in Safari or Chrome.' : 'The pairing code will appear when the computer joins a private network.';
get('ready-heading').textContent = data.preview ? 'Just a test run' : 'You’re all set.';
get('ready-description').textContent = data.preview ? 'Your phone is connected. Cursor control is off in preview mode.' : 'Keep Ghostpad open on your phone while you use it.';
get('mode-note').hidden = !data.preview;
get('transport-label').textContent = data.secure ? 'ENCRYPTED · TLS' : 'LOCAL WI-FI';
get('security-note').textContent = data.secure ? 'This connection is encrypted with TLS.' : 'This connection uses unencrypted HTTP on your local network.';
if (!lanOrigin)
unavailable('Connect this computer to the same Wi-Fi or hotspot as your phone.');
else if (qrLoaded) {
qrImage.hidden = false;
qrPlaceholder.hidden = true;
retryButton.hidden = true;
}
void loadQr();
}
catch (_a) {
if (stopped || !navigator.onLine)
return;
failures++;
pollDelay = Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4));
status('unreachable', 'Can’t reach Ghostpad');
unavailable('Check that Ghostpad is running and this computer is on the same Wi-Fi as your phone.', true);
get('scan-caption').textContent = 'We’ll keep checking. Your pairing is saved.';
copyButton.disabled = stopButton.disabled = true;
}
finally {
checking = false;
if (!stopped && !document.hidden && !suspended && navigator.onLine)
timer = setTimeout(check, pollDelay);
}
}
function offline() {
clearTimeout(timer);
if (stopped || !key)
return;
status('offline', 'This computer is offline');
unavailable('Reconnect this computer to Wi-Fi. Ghostpad will check its pairing address when the connection returns.');
get('scan-caption').textContent = 'We’ll check again when you’re online.';
copyButton.disabled = stopButton.disabled = true;
}
codeToggle.addEventListener('click', () => {
showCode = !showCode;
renderPairing();
});
addressToggle.addEventListener('click', () => {
useIp = !useIp;
updatePairing();
void loadQr();
});
retryButton.addEventListener('click', async () => {
retryButton.disabled = true;
try {
if (state === 'unreachable') {
failures = 0;
await check();
}
else
await loadQr();
}
finally {
retryButton.disabled = false;
}
});
copyButton.addEventListener('click', async () => {
if (!pairingLink || stopped)
return;
clearTimeout(copyTimer);
let copied = false;
try {
await navigator.clipboard.writeText(pairingLink);
copied = true;
}
catch (_a) {
get('manual-copy').hidden = false;
linkInput.focus();
linkInput.select();
try {
copied = document.execCommand('copy');
}
catch (_b) { }
if (copied) {
get('manual-copy').hidden = true;
copyButton.focus();
}
}
get('copy-label').textContent = copied ? 'Link copied' : 'Select and copy the link';
feedback.textContent = copied ? 'Open the copied link on your phone.' : 'Press Ctrl+C or hold to copy the selected link.';
copyTimer = setTimeout(() => {
get('copy-label').textContent = 'Copy pairing link';
feedback.textContent = 'Send the link to your phone.';
}, 3000);
});
get('guide-open').addEventListener('click', () => guide.showModal());
get('guide-close').addEventListener('click', () => guide.close());
guide.addEventListener('close', () => get('guide-open').focus());
stopButton.addEventListener('click', () => stopDialog.showModal());
for (const id of ['stop-close', 'stop-cancel'])
get(id).addEventListener('click', () => stopDialog.close());
stopDialog.addEventListener('close', () => stopButton.focus());
for (const dialog of [guide, stopDialog])
dialog.addEventListener('click', event => {
if (event.target !== dialog)
return;
const box = dialog.getBoundingClientRect();
if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
dialog.close();
});
stopConfirm.addEventListener('click', async () => {
stopConfirm.disabled = true;
get('stop-error').hidden = true;
try {
const response = await request('stop', 'POST');
if (!response.ok)
throw Error('Stop failed');
stopped = true;
clearTimeout(timer);
status('stopped', 'Ghostpad is stopped');
unavailable('Open Ghostpad from the app launcher to connect again.');
get('scan-caption').textContent = 'You can close this tab.';
copyButton.disabled = stopButton.disabled = true;
get('manual-copy').hidden = true;
stopDialog.close();
}
catch (_a) {
get('stop-error').textContent = 'Couldn’t stop the receiver. Check your connection and try again.';
get('stop-error').hidden = false;
}
finally {
stopConfirm.disabled = false;
}
});
document.addEventListener('visibilitychange', () => {
clearTimeout(timer);
if (!document.hidden)
void check();
});
window.addEventListener('online', () => { failures = 0; void check(); });
window.addEventListener('offline', offline);
window.addEventListener('pagehide', () => { suspended = true; clearTimeout(timer); clearTimeout(copyTimer); });
window.addEventListener('pageshow', () => { suspended = false; void check(); });
if (key)
void check();
else {
status('unpaired', 'Open this page from Ghostpad');
unavailable('Launch Ghostpad from your app launcher, or start it with --desktop, to see your private code.');
}
export {};
