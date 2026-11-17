// The desktop, QR, and phone share a real isolated preview receiver. No native input.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = new URL('../', import.meta.url).pathname;
const temporary = await mkdtemp(join(tmpdir(), 'ghostpad-desktop-'));
let receiver, browser;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const bin = join(temporary, 'bin');
  await mkdir(bin);
  // Capture browser launching without opening a window on the user's desktop.
  await writeFile(join(bin, 'xdg-open'), '#!/bin/sh\nprintf \'%s\' "$1" > "$GHOSTPAD_TEST_OPEN_URL"\n', {mode: 0o755});
  const env = {...process.env, XDG_CONFIG_HOME: temporary, PATH: `${bin}:${process.env.PATH}`, GHOSTPAD_TEST_OPEN_URL: join(temporary, 'opened-url')};
  const binary = join(root, 'target/debug/ghostpad');
  receiver = spawn(binary, ['--preview', '--desktop', '--address', '127.0.0.1', '--port', String(port)], {env, stdio: ['ignore', 'ignore', 'pipe']});
  let stderr = '';
  receiver.stderr.on('data', data => { stderr += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`${origin}/health`)).ok; } catch { /* Wait for startup. */ }
    if (ready) break;
    if (receiver.exitCode !== null) throw Error(`Receiver exited: ${stderr}`);
    await pause(30);
  }
  assert(ready, `Receiver failed to start: ${stderr}`);
  const key = await readFile(join(temporary, 'ghostpad/pairing-key'), 'utf8');
  const desktopUrl = `${origin}/desktop#key=${key}`;
  assert.equal(await readFile(env.GHOSTPAD_TEST_OPEN_URL, 'utf8'), desktopUrl);
  execFileSync(binary, ['--desktop', '--address', '127.0.0.1', '--port', String(port)], {env, timeout: 5000, stdio: 'pipe'});
  assert.equal(await readFile(env.GHOSTPAD_TEST_OPEN_URL, 'utf8'), desktopUrl);
  const headers = {Authorization: `Bearer ${key}`};
  for (const path of ['status', 'qr', 'stop']) assert.equal((await fetch(`${origin}/api/desktop/${path}`)).status, 403);
  assert.equal((await fetch(`${origin}/api/desktop/stop`, {method:'POST', headers})).status, 403);
  assert.equal((await fetch(`${origin}/api/desktop/stop`, {method:'POST', headers:{...headers, Origin:'https://evil.example'}})).status, 403);
  assert.equal((await fetch(`${origin}/api/desktop/stop`, {headers})).status, 404);
  const html = await (await fetch(`${origin}/desktop`)).text();
  assert(!html.includes(key), 'Public desktop shell must not contain the pairing key');

  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:1280, height:900}, colorScheme:'light', hasTouch:true});
  const page = await context.newPage(), errors = [], requests = [];
  let desktopSockets = 0;
  page.on('websocket', () => { desktopSockets++; });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => {
    window.desktopFrames = 0;
    const frame = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { window.desktopFrames++; return frame.call(window, callback); };
  });
  await page.goto(desktopUrl);
  await page.getByText('Waiting for your phone', {exact:true}).waitFor();
  await page.locator('#pairing-qr').waitFor({state:'visible'});
  assert.equal(new URL(page.url()).hash, '');
  assert(await page.locator('#mode-note').isVisible());
  assert.equal(await page.locator('#pairing-qr').evaluate(image => image.naturalWidth > 0), true);
  assert.equal((await (await fetch(`${origin}/api/desktop/status`, {headers})).json()).connected, false, 'Desktop must never take the controller lock');
  assert.equal(await page.locator('#super-demo, #intro-liquid').count(), 0);
  await mkdir(join(root, 'artifacts'), {recursive:true});
  await page.screenshot({path:join(root, 'artifacts/desktop-light.png'), fullPage:true, animations:'disabled'});
  // Read the actual displayed code with an independent QR decoder.
  const qrFile = join(temporary, 'qr.png');
  await page.locator('#pairing-qr').screenshot({path:qrFile});
  try {
    const decoded = execFileSync('zbarimg', ['--quiet', '--raw', qrFile], {stdio:['ignore','pipe','ignore']}).toString().trim();
    assert.equal(decoded, `${origin}/#key=${key}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('Independent QR decoding skipped: install zbarimg to enable it.');
  }
  await page.getByRole('button', {name:'Dark appearance', exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.screenshot({path:join(root, 'artifacts/desktop-dark.png'), fullPage:true, animations:'disabled'});
  await page.reload();
  await page.getByText('Waiting for your phone', {exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', {name:'Light appearance', exact:true}).click();
  await page.getByRole('button', {name:'Gesture guide'}).click();
  assert(await page.locator('#gesture-guide').isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'guide-open');
  await page.locator('#connection-help').evaluate(el => { el.open = true; });
  assert.match(await page.locator('#firewall-command').innerText(), new RegExp(`--port ${port}`));
  await page.locator('#connection-help').evaluate(el => { el.open = false; });
  // Exercise HTTP clipboard fallback even though localhost is a secure context.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {value:undefined});
    document.execCommand = () => false;
  });
  await page.locator('#copy-link').click();
  assert(await page.locator('#manual-copy').isVisible());
  assert.equal(await page.locator('#pairing-link').inputValue(), `${origin}/#key=${key}`);
  await page.evaluate(() => { document.execCommand = () => true; });
  await page.locator('#copy-link').click();
  assert.equal(await page.locator('#copy-label').innerText(), 'Link copied');
  assert.equal(await page.locator('#manual-copy').isVisible(), false);
  for (const width of [320, 390, 730, 900]) {
    await page.setViewportSize({width, height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No overflow at ${width}px`);
  }
  await page.setViewportSize({width:390, height:844});
  await page.screenshot({path:join(root, 'artifacts/desktop-mobile.png'), fullPage:true, animations:'disabled'});
  await page.setViewportSize({width:1280, height:900});
  const unpaired = await context.newPage();
  await unpaired.goto(`${origin}/desktop`);
  await unpaired.getByText('Open this page from Ghostpad', {exact:true}).waitFor();
  assert(await unpaired.locator('#copy-link').isDisabled());
  await unpaired.close();
  const invalid = await context.newPage();
  await invalid.goto(`${origin}/desktop#key=${'0'.repeat(64)}`);
  await invalid.getByText('This pairing link no longer works', {exact:true}).waitFor();
  assert(await invalid.locator('#copy-link').isDisabled());
  await invalid.close();
  const qrRetry = await context.newPage();
  await qrRetry.route('**/api/desktop/qr', route => route.abort());
  await qrRetry.goto(desktopUrl);
  await qrRetry.locator('#check-again').waitFor({state:'visible'});
  assert(await qrRetry.locator('#copy-link').isEnabled(), 'Copy remains available if only QR loading failed');
  await qrRetry.unroute('**/api/desktop/qr');
  await qrRetry.locator('#check-again').click();
  await qrRetry.locator('#pairing-qr').waitFor({state:'visible'});
  await qrRetry.close();
  const phone = await context.newPage();
  await phone.goto(`${origin}/#key=${key}`);
  await phone.locator('#status').filter({hasText:'Preview'}).waitFor();
  await page.bringToFront();
  await page.getByText('Your phone is connected', {exact:true}).waitFor();
  assert(await page.locator('#connected-view').isVisible());
  assert(await page.locator('#pairing-qr').isHidden(), 'Hide the private QR after connecting');
  assert.match(await page.locator('#connected-view').innerText(), /You can close this tab\./);
  await page.screenshot({path:join(root, 'artifacts/desktop-connected.png'), fullPage:true, animations:'disabled'});
  const connectedRequests = requests.filter(url => url.endsWith('/api/desktop/status')).length;
  await pause(2600);
  assert.equal(requests.filter(url => url.endsWith('/api/desktop/status')).length, connectedRequests, 'Connected view uses fewer status checks');
  await page.locator('#code-toggle').click();
  assert(await page.locator('#pairing-qr').isVisible());
  assert.equal(await page.locator('#code-toggle').getAttribute('aria-expanded'), 'true');
  await page.waitForResponse(response => response.url().endsWith('/api/desktop/status') && response.ok());
  assert(await page.locator('#pairing-qr').isVisible(), 'Polling must preserve the manually revealed code');
  await page.locator('#code-toggle').click();
  assert(await page.locator('#connected-view').isVisible());
  await phone.close();
  await page.getByText('Waiting for your phone', {exact:true}).waitFor();
  assert(await page.locator('#pairing-qr').isVisible(), 'The QR returns when the phone disconnects');
  assert(await page.locator('#code-toggle').isHidden());
  // Hidden tabs and offline computers do no status polling.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {value:true, configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pause(50);
  const hiddenRequests = requests.filter(url => url.endsWith('/api/desktop/status')).length;
  await pause(2200);
  assert.equal(requests.filter(url => url.endsWith('/api/desktop/status')).length, hiddenRequests);
  const resume = page.waitForResponse(response => response.url().endsWith('/api/desktop/status') && response.ok());
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await resume;
  await context.setOffline(true);
  await page.getByText('This computer is offline', {exact:true}).waitFor();
  const offlineRequests = requests.filter(url => url.endsWith('/api/desktop/status')).length;
  await pause(2200);
  assert.equal(requests.filter(url => url.endsWith('/api/desktop/status')).length, offlineRequests);
  await context.setOffline(false);
  await page.getByText('Waiting for your phone', {exact:true}).waitFor();
  // A temporary network failure recovers without losing the pairing credential.
  await page.route('**/api/desktop/status', route => route.abort());
  await page.getByText('Can’t reach Ghostpad', {exact:true}).waitFor();
  assert(await page.locator('#copy-link').isDisabled());
  assert(await page.locator('#check-again').isVisible());
  await page.screenshot({path:join(root, 'artifacts/desktop-reconnect.png'), fullPage:true, animations:'disabled'});
  await page.waitForRequest(request => request.url().endsWith('/api/desktop/status'));
  await pause(100);
  const failedRequests = requests.filter(url => url.endsWith('/api/desktop/status')).length;
  await pause(2300);
  assert.equal(requests.filter(url => url.endsWith('/api/desktop/status')).length, failedRequests, 'Repeated failures must back off');
  await page.unroute('**/api/desktop/status');
  await page.locator('#check-again').click();
  await page.getByText('Waiting for your phone', {exact:true}).waitFor();
  await page.locator('#pairing-qr').waitFor({state:'visible'});
  await page.locator('#stop-open').click();
  await page.locator('#stop-cancel').click();
  assert.equal((await fetch(`${origin}/health`)).ok, true);
  await page.locator('#stop-open').click();
  await page.locator('#stop-confirm').click();
  await page.getByText('Ghostpad is stopped', {exact:true}).waitFor();
  for (let i = 0; receiver.exitCode === null && i < 50; i++) await pause(20);
  assert.equal(receiver.exitCode, 0, 'Stop must exit the receiver');
  assert(await page.locator('#copy-link').isDisabled());
  assert(await page.locator('#pairing-qr').isHidden());
  assert.equal(await page.evaluate(() => window.desktopFrames), 0, 'Desktop must not run JavaScript animation frame loops');
  assert.equal(desktopSockets, 0, 'Desktop must never open an input WebSocket');
  assert.deepEqual(errors, []);
  assert(requests.every(url => url.startsWith(origin) || url.startsWith('data:')), 'Desktop must not fetch external resources');
  assert(!requests.some(url => url.includes(key)), 'Pairing key must never enter an HTTP URL');
  console.log('Desktop passed: QR decode, launch/relaunch, auth, ready screen, QR reveal/retry, themes, clipboard fallback, responsive layout, offline recovery, polling backoff, hidden/offline suspension, manual retry, zero JS animation frames, and stop.');
} finally {
  if (browser) await browser.close();
  if (receiver && receiver.exitCode === null) { receiver.kill('SIGTERM'); await once(receiver, 'exit'); }
  await rm(temporary, {recursive:true, force:true});
}
