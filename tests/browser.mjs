// Client integration with a controlled WebSocket peer. Real receiver tests are in integration.py.
import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
try {
 const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const page = await context.newPage(), errors=[], packets=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.route('http://ghostpad.test/**', async route=>{
  const path=new URL(route.request().url()).pathname;
  const name=path==='/'?'index.html':path.slice(1);
  if (!['index.html','style.css','app.js','gestures.js','icon.svg'].includes(name)) return route.fulfill({status:404});
  if (name === 'index.html') {
   const css=await readFile(new URL('web/style.css',root),'utf8'),boot=await readFile(new URL('web/boot.js',root),'utf8');
   const gestures=(await readFile(new URL('web/gestures.js',root),'utf8')).replace('export class Gestures','class Gestures');
   const app=(await readFile(new URL('web/app.js',root),'utf8')).replace("import { Gestures } from './gestures.js';",'');
   const script=`(function () {\n${gestures}\n${app}\n})();`;
   const html=(await readFile(new URL('web/index.html',root),'utf8')).replace('<link rel="stylesheet" href="/style.css">',`<style>${css}</style>`).replace('<script type="module" src="/app.js"></script>',`<script>${boot}</script><script>${script}</script>`);
   const hash=s=>createHash('sha256').update(s).digest('base64');
   return route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':`default-src 'self'; connect-src 'self' ws://ghostpad.test; style-src 'self' 'sha256-${hash(css)}'; script-src 'self' 'sha256-${hash(boot)}' 'sha256-${hash(script)}'`}});
  }
  const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html';
  await route.fulfill({contentType:type,body:await readFile(new URL(`web/${name}`,root))});
 });
 await page.routeWebSocket('**/ws', ws=>{
  ws.onMessage(data=>{
   if (typeof data==='string') {assert.equal(data,'a'.repeat(64));ws.send('ready:preview');}
   else {packets.push([...data]);if(data[0]===8)ws.send('pong');}
  });
 });
 await page.goto(`http://ghostpad.test/#key=${'a'.repeat(64)}`);
 await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 assert.equal(new URL(page.url()).hash,'');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const cdp=await context.newCDPSession(page);
 const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],id)=>({x,y,id}))});
 await touch('touchStart',[[120,250]]);await touch('touchEnd',[]);
 await touch('touchStart',[[120,250],[190,250]]);await touch('touchEnd',[]);
 await touch('touchStart',[[120,250]]);await touch('touchMove',[[155,275]]);await touch('touchEnd',[]);
 await touch('touchStart',[[120,250],[190,250]]);await touch('touchMove',[[120,290],[190,290]]);await touch('touchEnd',[]);
 await touch('touchStart',[[120,250]]);await page.waitForTimeout(450);await touch('touchMove',[[150,260]]);await touch('touchEnd',[]);
 await page.waitForTimeout(100);
 for(const opcode of [1,2,3,4,5,6])assert(packets.some(p=>p[0]===opcode),`Missing opcode ${opcode}`);
 await page.locator('#mod-super').click();
 await touch('touchStart',[[120,250],[190,250]]);await touch('touchMove',[[145,275],[215,275]]);await touch('touchEnd',[]);
 await page.locator('#mod-super').click();
 await page.locator('#keyboard-toggle').click();
 await page.locator('#mod-ctrl').click();await page.locator('button[data-key="6"]').click();await page.locator('#mod-ctrl').click();
 await page.waitForTimeout(100);
 assert(packets.some(p=>p[0]===9&&p[1]===227),'Super key-down missing');
 assert(packets.some(p=>p[0]===12),'Resize right-down missing');
 assert(packets.some(p=>p[0]===13),'Resize right-up missing');
 assert(packets.some(p=>p[0]===11&&p[1]===6),'Keyboard C tap missing');
 await page.locator('#keyboard-toggle').click();
 await mkdir(new URL('artifacts/',root),{recursive:true});
 await page.screenshot({path:new URL('artifacts/phone.png',root).pathname});
 await page.locator('#settings-open').click();
 assert.equal(await page.locator('#settings').evaluate(d=>d.open),true);
 await page.locator('#sensitivity').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('input'));});
 assert.equal(await page.locator('#sensitivity-value').textContent(),'2.0×');
 await page.screenshot({path:new URL('artifacts/settings.png',root).pathname});
 await page.locator('#settings-close').click();await page.reload();
 await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 assert.equal(await page.locator('#sensitivity').inputValue(),'2');
 await page.locator('#settings-open').click();await page.locator('#disconnect').click();
 assert.equal(await page.locator('#status').textContent(),'Disconnected');
 await page.locator('#disconnect').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 await page.locator('#forget').click();assert.equal(await page.evaluate(()=>localStorage.getItem('ghostpad.key')),'');
 assert.deepEqual(errors,[]);
 console.log('Browser client: pairing, gestures, settings, reconnect, and forgetting passed. Screenshots: artifacts/.');
} finally {await browser.close();}
