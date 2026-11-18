// Real HTTP/WebSocket receiver with Android and iPhone profiles in Chromium.
// This covers the shared web client; physical Safari/Android testing is separate.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, devices } from 'playwright-core';

const root = new URL('../', import.meta.url);
const address = process.env.GHOSTPAD_TEST_ADDRESS || '127.0.0.1';
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, address, () => {
    const port = server.address().port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});
const origin = `http://${address}:${port}`;
const config = await mkdtemp(join(tmpdir(), 'ghostpad-mobile-'));
const receiver = spawn(new URL('target/debug/ghostpad', root).pathname,
  ['--preview', '--address', address, '--port', String(port)],
  { env: { ...process.env, XDG_CONFIG_HOME: config }, stdio: ['ignore', 'ignore', 'pipe'] });
let failure = '', browser;
receiver.stderr.on('data', chunk => { failure += chunk; });
receiver.on('error', error => { failure += error.message; });
try {
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(200) });
      if (await response.text() === 'ghostpad/1') { healthy = true; break; }
    } catch { /* Wait for the isolated receiver to bind. */ }
    if (receiver.exitCode !== null) break;
    await delay(30);
  }
  assert(healthy, `Preview receiver did not start: ${failure}`);
  const key = await readFile(join(config, 'ghostpad/pairing-key'), 'utf8');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  for (const profile of ['Pixel 7', 'iPhone 13']) {
    const { defaultBrowserType, ...device } = devices[profile];
    const context = await browser.newContext(device);
    try {
      const page = await context.newPage(), packets = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
        if (typeof payload === 'string') return;
        packets.push([...(payload[0] === 17 ? payload.subarray(3) : payload)]);
      }));
      await page.goto(`${origin}/#key=${key}`);
      await page.waitForFunction(() => document.getElementById('status').textContent === 'Preview');
      assert.equal(new URL(page.url()).hash, '', 'Pairing credentials must leave the address bar');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const cdp = await context.newCDPSession(page);
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
        type, touchPoints: points.map(([x, y], id) => ({ x, y, id }))
      });
      await touch('touchStart', [[120, 200]]); await touch('touchMove', [[150, 210]]); await touch('touchEnd', []);
      await page.locator('#pad').dispatchEvent('touchcancel');
      await touch('touchStart', [[120, 200]]); await touch('touchEnd', []);
      await page.locator('#pad').dispatchEvent('touchcancel');
      await touch('touchStart', [[120, 200], [180, 200]]);
      await touch('touchMove', [[120, 250], [180, 250]]); await touch('touchEnd', []);
      await page.locator('#pad').dispatchEvent('touchcancel');
      await touch('touchStart', [[120, 200], [180, 200]]);
      await touch('touchMove', [[95, 200], [205, 200]]); await touch('touchEnd', []);
      await page.locator('#keyboard-toggle').tap();
      await page.locator('#native-input').fill('Android and iPhone');
      await page.locator('#native-tools button[data-key="82"]').tap();
      await page.locator('#grid-mode').tap();
      await page.locator('#keyboard button[data-key="4"]').tap();
      await page.locator('#keyboard-close').tap();
      const codes = [1, 2, 3, 9, 10, 11, 14, 15, 16];
      for (let i = 0; i < 50 && codes.some(code => !packets.some(packet => packet[0] === code)); i++) await delay(20);
      for (const code of codes) assert(packets.some(packet => packet[0] === code), `${profile}: missing input opcode ${code}`);
      await page.locator('#settings-open').tap();
      await page.locator('#scroll-side button[data-side="left"]').tap();
      await page.locator('#settings-close').tap();
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status').textContent === 'Preview');
      assert.equal(await page.locator('#pad').evaluate(el => el.classList.contains('scroll-left')), true);
      // A second phone can take over without touching the active controller.
      const second = await context.newPage();
      await second.goto(`${origin}/#key=${key}`);
      await second.waitForFunction(() => document.getElementById('status').textContent === 'Computer busy');
      await second.getByRole('button', {name:'Use this phone'}).tap();
      await second.waitForFunction(() => document.getElementById('status').textContent === 'Preview');
      await page.getByRole('button', {name:'Use this phone'}).waitFor();
      await second.locator('#settings-open').tap();
      await second.locator('#disconnect').tap();
      assert.equal(await page.locator('#status').textContent(), 'Computer busy', 'The displaced tab should wait for an explicit tap');
      await page.getByRole('button', {name:'Use this phone'}).tap();
      await page.waitForFunction(() => document.getElementById('status').textContent === 'Preview');
      assert.deepEqual(errors, []);
      console.log(`PASS ${profile}: HTTP pairing, gestures, keyboard, saved pairing, controller handoff`);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  receiver.kill('SIGTERM');
  if (receiver.exitCode === null && receiver.signalCode === null)
    await new Promise(resolve => receiver.once('exit', resolve));
  await rm(config, { recursive: true, force: true });
}
