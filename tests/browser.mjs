// Client integration with a controlled WebSocket peer. Real receiver tests are in integration.py.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox','--enable-unsafe-swiftshader']});
try {
 const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const page = await context.newPage(), errors=[], packets=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.route('http://ghostpad.test/**', async route=>{
  const path=new URL(route.request().url()).pathname;
  const name=path==='/'?'index.html':path.slice(1);
  if (!['index.html','style.css','app.js','gestures.js','text.js','icon.svg'].includes(name)) return route.fulfill({status:404});
  if (name === 'index.html') {
   const css=await readFile(new URL('web/style.css',root),'utf8'),boot=await readFile(new URL('web/boot.js',root),'utf8');
   const fill=await readFile(new URL('web/super-fill.js',root),'utf8');
   const gestures=(await readFile(new URL('web/gestures.js',root),'utf8')).replace('export class Gestures','class Gestures');
   const text=(await readFile(new URL('web/text.js',root),'utf8')).replaceAll('export function','function');
   const app=(await readFile(new URL('web/app.js',root),'utf8')).replace("import { Gestures } from './gestures.js';",'').replace("import { textEdit, normalizeText } from './text.js';",'');
   const script=`(function () {\n${gestures}\n${text}\n${app}\n})();`;
   const html=(await readFile(new URL('web/index.html',root),'utf8')).replace('<link rel="stylesheet" href="/style.css">',()=>`<style>${css}</style>`).replace('<script src="/super-fill.js"></script>','').replace('<script type="module" src="/app.js"></script>',()=>`<script>${boot}</script><script>${fill}</script><script>${script}</script>`);
   const hash=s=>createHash('sha256').update(s).digest('base64');
   return route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':`default-src 'self'; connect-src 'self' ws://ghostpad.test; style-src 'self' 'sha256-${hash(css)}'; script-src 'self' 'sha256-${hash(boot)}' 'sha256-${hash(script)}' 'sha256-${hash(fill)}'`}});
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
 await page.addInitScript(()=>{
  window.orbDraws=0;
  const draw=WebGLRenderingContext.prototype.drawArrays;
  WebGLRenderingContext.prototype.drawArrays=function(...args){window.orbDraws++;return draw.apply(this,args);};
 });
 await page.goto(`http://ghostpad.test/#key=${'a'.repeat(64)}`);
 await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 await page.waitForSelector('#super-fill-root .origin-fill', {state:'attached'});
 await page.waitForSelector('[data-slot="live-orb"][data-renderer="webgl"]');
 await page.waitForFunction(()=>window.orbDraws>1);
 const orb=page.locator('[data-slot="live-orb"]');
 const orbBox=await orb.boundingBox();
 const orbPoint=[orbBox.x+orbBox.width/2,orbBox.y+orbBox.height/2];
 assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y).id,orbPoint),'mod-super','Touching the orb must reach the original Super zone');
 assert.equal(await orb.evaluate(el=>getComputedStyle(el.parentElement).mixBlendMode),'difference');
 // A touch makes the gaze respond without moving the character or sending pad packets.
 await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointermove',{clientX:300,clientY:100})));
 await page.waitForFunction(()=>{
  const gl=document.querySelector('[data-slot="live-orb"] canvas').getContext('webgl');
  const program=gl.getParameter(gl.CURRENT_PROGRAM);
  return gl.getUniform(program,gl.getUniformLocation(program,'u_look'))[0]>.2;
 });
 assert.deepEqual(await orb.boundingBox(),orbBox,'Only the eyes should move');
 const fillActive=()=>page.locator('#super-fill-root .origin-fill').getAttribute('data-active');
 const waitForFill=scale=>page.waitForFunction(expected=>{
  const el=document.querySelector('#super-fill-root .origin-fill');
  const transform=getComputedStyle(el).transform;
  return Math.abs((transform==='none'?1:new DOMMatrixReadOnly(transform).a)-expected)<0.000001;
 },scale);
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
 let from=packets.length;
 await touch('touchStart',[[120,250]]);await touch('touchEnd',[]);
 await touch('touchStart',[[220,350]]);await touch('touchMove',[[250,370]]);
 assert.equal(await page.locator('#drag-state').evaluate(el=>el.hidden),false);
 await touch('touchMove',[[275,410]]);await touch('touchEnd',[]);await page.waitForTimeout(50);
 let dragPackets=packets.slice(from).filter(p=>p[0]!==8);
 assert.deepEqual(dragPackets.slice(0,2).map(p=>p[0]),[3,5],'Tap drag must press before moving');
 assert(dragPackets.slice(2,-1).length>0&&dragPackets.slice(2,-1).every(p=>p[0]===1),'Dragging must only move the held pointer');
 assert.equal(dragPackets.at(-1)[0],6,'Lifting must release without another click');
 assert.equal(await page.locator('#drag-state').isVisible(),false);
 // Apply the transmitted button/motion sequence to real selectable browser text.
 const desktop=await browser.newContext({viewport:{width:900,height:500}});
 const textPage=await desktop.newPage();
 await textPage.setContent('<p style="margin:40px;font:20px monospace;width:700px">Select these words by double tapping and dragging across the text.</p>');
 let mx=55,my=58,clickCount=0;
 await textPage.mouse.move(mx,my);
 for(const packet of dragPackets) {
  if(packet[0]===3)await textPage.mouse.click(mx,my,{clickCount:++clickCount});
  if(packet[0]===5)await textPage.mouse.down({clickCount:++clickCount});
  if(packet[0]===1) {
   const view=new DataView(Uint8Array.from(packet).buffer);
   mx+=view.getFloat32(1,true);my+=view.getFloat32(5,true);
   await textPage.mouse.move(mx,my);
  }
  if(packet[0]===6)await textPage.mouse.up({clickCount});
 }
 const selection=await textPage.evaluate(()=>getSelection().toString());
 assert(selection.includes('Select these words'),'Tap drag must extend text selection beyond the initial word');
 await textPage.mouse.move(800,400);
 assert.equal(await textPage.evaluate(()=>getSelection().toString()),selection,'Selection must remain after the finger lifts');
 await desktop.close();
 from=packets.length;
 await touch('touchStart',[[120,250]]);await touch('touchEnd',[]);
 await touch('touchStart',[[120,250]]);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).map(p=>p[0]),[3,3],'Double taps must still double-click');
 from=packets.length;
 await touch('touchStart',[[120,250],[220,250]]);
 await touch('touchMove',[[90,250],[250,250]]);
 await touch('touchEnd',[]);await page.waitForTimeout(50);
 let gesture=packets.slice(from).filter(p=>p[0]!==8);
 assert.deepEqual(gesture.map(p=>p[0]),[15,16]);
 assert(Math.abs(new DataView(Uint8Array.from(gesture[0]).buffer).getFloat32(1,true)-1.6)<1e-6,'Pinch-out must carry a continuous native scale');
 from=packets.length;
 await touch('touchStart',[[120,250],[220,250]]);
 await touch('touchMove',[[100,250],[240,250]]);
 await touch('touchMove',[[100,290],[240,290]]);
 await touch('touchMove',[[90,310],[250,310]]);
 await touch('touchEnd',[]);await page.waitForTimeout(50);
 gesture=packets.slice(from).filter(p=>p[0]!==8);
 assert(gesture.some(p=>p[0]===15),'Pinch updates missing');
 assert(gesture.every(p=>p[0]===15||p[0]===16),'Drifting during a pinch must not send scroll, pointer, or click packets');
 assert.equal(gesture.at(-1)[0],16);
 // The strip shares two-finger scroll deltas and keeps its starting gesture across boundaries.
 const stripBox=await page.locator('#scroll-zone').boundingBox();
 const sx=stripBox.x+stripBox.width/2,sy=stripBox.y+stripBox.height/2;
 assert.equal(await page.locator('#pad').evaluate(el=>el.classList.contains('scroll-left')),false,'Strip defaults to the right');
 assert(stripBox.width>=44&&stripBox.height>=100,'Scroll strip must be an accessible touch target');
 from=packets.length;
 await touch('touchStart',[[sx,sy]]);await touch('touchMove',[[sx,sy+40]]);await touch('touchEnd',[]);await page.waitForTimeout(50);
 const stripPackets=packets.slice(from).filter(p=>p[0]!==8);
 assert.deepEqual(stripPackets.map(p=>p[0]),[2]);
 from=packets.length;
 await touch('touchStart',[[120,250],[190,250]]);await touch('touchMove',[[120,290],[190,290]]);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(stripPackets,packets.slice(from).filter(p=>p[0]!==8),'Strip must match two-finger scrolling');
 from=packets.length;
 await touch('touchStart',[[sx,sy]]);await touch('touchEnd',[]);
 await touch('touchStart',[[sx,sy]]);await page.waitForTimeout(450);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[],'Strip taps and holds must not click');
 from=packets.length;
 await touch('touchStart',[[sx,sy]]);await touch('touchMove',[[sx-80,sy+40]]);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).map(p=>p[0]),[2],'Leaving the strip must keep scrolling');
 from=packets.length;
 await touch('touchStart',[[sx-80,sy]]);await touch('touchMove',[[sx,sy+40]]);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).map(p=>p[0]),[1],'Crossing into the strip must keep moving the pointer');
 const padBox=await page.locator('#pad').boundingBox();
 for(const id of ['mod-super','right-click']) {
  const box=await page.locator(`#${id}`).boundingBox();
  assert(box.x>=padBox.x&&box.y>=padBox.y&&box.x+box.width<=padBox.x+padBox.width&&box.y+box.height<=padBox.y+padBox.height,'Thumb zone must be inside pad');
  assert(box.width>=100&&box.height>=44,'Thumb zone must be easy to reach');
 }
 assert.equal(await page.locator('#right-click').getAttribute('aria-label'),'Right-click');
 assert.equal(await page.locator('#pad').innerText(),'','Pad must contain no visible labels');
 assert.equal(padBox.x,0,'Pad must meet the left screen edge');
 assert.equal(padBox.width,390,'Pad must use the full screen width');
 assert.equal(padBox.y,0,'Pad must meet the top screen edge');
 const assertBlankZones=async()=>assert.equal(await page.locator('#scroll-zone, .pad-zones, .pad-zone').evaluateAll(elements=>elements.every(el=>{
  const style=getComputedStyle(el);
  return style.backgroundColor==='rgba(0, 0, 0, 0)' && ['Top','Right','Bottom','Left'].every(side=>style[`border${side}Width`]==='0px');
 })),true,'Touch zones must remain invisible, including while held');
 await assertBlankZones();
 from=packets.length;
 await page.locator('#right-click').tap();await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[4]],'RC touch must not become a pad tap');
 assert.equal(await fillActive(),'false','Right-click must not activate the Super fill');
 const superBox=await page.locator('#mod-super').boundingBox();
 assert(orbBox.x>=superBox.x&&orbBox.y>=superBox.y&&orbBox.x+orbBox.width<=superBox.x+superBox.width&&orbBox.y+orbBox.height<=superBox.y+superBox.height,'Orb must stay within the Super zone');
 from=packets.length;
 await touch('touchStart',[orbPoint]);await waitForFill(1);
 assert.equal(await page.locator('.super-fill').evaluate(el=>Number.parseFloat(el.style.left)),orbPoint[0]);
 await page.screenshot({path:new URL('artifacts/orb-super.png',root).pathname});
 await touch('touchEnd',[]);await waitForFill(0);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,227],[10,227]],'Orb must preserve momentary Super without clicking');
 const superPoint=[superBox.x+superBox.width/2,superBox.y+superBox.height/2];
 await touch('touchStart',[superPoint]);
 await page.waitForFunction(()=>document.querySelector('.super-fill').dataset.active==='true');
 assert.equal(await page.locator('.super-fill').evaluate(el=>Number.parseFloat(el.style.left)),superPoint[0]-padBox.x);
 assert.equal(await page.locator('.super-fill').evaluate(el=>Number.parseFloat(el.style.top)),superPoint[1]-padBox.y);
 await page.waitForFunction(()=>{
  const el=document.querySelector('.super-fill');
  const scale=new DOMMatrixReadOnly(getComputedStyle(el).transform).a;
  return scale>0&&scale<0.99;
 });
 await page.screenshot({path:new URL('artifacts/super-fill-transition.png',root).pathname});
 await waitForFill(1);
 const fillDiameter=await page.locator('.super-fill').evaluate(el=>Number.parseFloat(el.style.width));
 assert(fillDiameter>=2*Math.hypot(padBox.width-superPoint[0],superPoint[1]),'Circle must cover the furthest pad corner');
 assert.equal(await page.locator('.super-fill').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
 assert.equal(await page.evaluate(()=>document.elementFromPoint(120,250).id),'pad','Fill must not intercept gestures');
 await page.screenshot({path:new URL('artifacts/super-fill.png',root).pathname});
 await assertBlankZones();
 await touch('touchStart',[superPoint,[120,250],[190,250]]);
 await touch('touchMove',[superPoint,[145,275],[215,275]]);
 await touch('touchEnd',[]);
 assert.equal(await page.locator('#mod-super').getAttribute('aria-pressed'),'false');
 await waitForFill(0);
 // Super is inside the pad but must never count as a scroll/resize finger.
 from=packets.length;
 await touch('touchStart',[superPoint]);
 await touch('touchStart',[superPoint,[120,250]]);
 await touch('touchMove',[superPoint,[150,280]]);
 await touch('touchEnd',[]);await page.waitForTimeout(50);
 gesture=packets.slice(from).filter(p=>p[0]!==8);
 assert.deepEqual(gesture.map(p=>p[0]),[9,5,1,6,10]);
 // Canceled touches, viewport changes, and reduced motion must not leave a stale fill.
 await touch('touchStart',[superPoint]);
 await waitForFill(1);
 await touch('touchCancel',[]);
 await waitForFill(0);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForTimeout(100);
 const stillFrames=await page.evaluate(()=>window.orbDraws);
 await page.waitForTimeout(120);
 assert.equal(await page.evaluate(()=>window.orbDraws),stillFrames,'Reduced motion must stop the orb animation loop');
 await touch('touchStart',[superPoint]);
 await waitForFill(1);
 await page.setViewportSize({width:420,height:844});
 await page.waitForFunction(()=>document.getElementById('pad').getBoundingClientRect().width===420);
 await page.waitForFunction(()=>Number.parseFloat(document.querySelector('.super-fill').style.width)>=2*Math.hypot(420-97.5,708));
 await touch('touchEnd',[]);
 await waitForFill(0);
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('#keyboard-toggle').click();
 // Hold keyboard Super with one finger, then use shortcut keys with another.
 await page.locator('#native-input').focus();
 const center=async selector=>{const b=await page.locator(selector).boundingBox();return [b.x+b.width/2,b.y+b.height/2];};
 const keySuperPoint=await center('#key-super');
 from=packets.length;
 await touch('touchStart',[keySuperPoint]);
 assert.equal(await page.locator('#keyboard').isVisible(),true,'Super should reveal the key grid');
 assert.equal(await page.locator('#native-input').evaluate(el=>document.activeElement===el),false);
 assert.equal(await page.locator('#key-super').getAttribute('aria-pressed'),'true');
 assert.equal(await fillActive(),'false','Keyboard Super must not activate the pad fill');
 const tapWhileHolding=async selector=>{
  const [x,y]=await center(selector);
  await touch('touchStart',[keySuperPoint,[x,y]]);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x,y,id:1}]});
 };
 await tapWhileHolding('#mod-shift');
 await tapWhileHolding('#keyboard button[data-key="32"]');await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,227],[9,225],[11,32],[10,225]]);
 assert.equal(await page.locator('#key-super').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#mod-shift').getAttribute('aria-pressed'),'false');
 await tapWhileHolding('#special-keys button[data-key="40"]');await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).at(-1),[11,40]);
 await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).at(-1),[10,227]);
 assert.equal(await page.locator('#key-super').getAttribute('aria-pressed'),'false');
 from=packets.length;
 await page.locator('#keyboard button[data-key="32"]').tap();await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[11,32]],'Next key must be unmodified');
 from=packets.length;
 const [keyX,keyY]=await center('#keyboard button[data-key="32"]');
 await touch('touchStart',[[keyX,keyY]]);
 await touch('touchMove',[[keyX,keyY+18]]);await touch('touchMove',[[keyX,keyY]]);
 await touch('touchEnd',[]);
 await touch('touchStart',[[keyX,keyY]]);await touch('touchCancel',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[],'Moving or canceling a key touch must not type');
 from=packets.length;
 await page.locator('#key-super').tap();await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,227],[10,227]],'A Super tap must release immediately');
 from=packets.length;
 await page.locator('#mod-ctrl').tap();await page.locator('#keyboard button[data-key="6"]').tap();await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,224],[11,6],[10,224]]);
 from=packets.length;
 await page.locator('#keyboard button[data-shift="true"]').tap();await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,225],[11,46],[10,225]],'Plus must type Shift+equals');
 from=packets.length;
 await page.locator('#mod-ctrl').tap();await page.locator('#keyboard button[data-shift="true"]').tap();await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,224],[9,225],[11,46],[10,225],[10,224]],'Ctrl+Plus must preserve the shortcut');
 await mkdir(new URL('artifacts/',root),{recursive:true});
 await page.screenshot({path:new URL('artifacts/keyboard-shortcuts.png',root).pathname});
 const resizeViewport=async viewport=>{
  await page.setViewportSize(viewport);
  await page.waitForFunction(()=>Math.abs(document.querySelector('main').getBoundingClientRect().height-innerHeight)<1);
 };
 const fullyVisible=async selector=>page.locator(selector).evaluateAll(elements=>elements.every(el=>{
  const r=el.getBoundingClientRect();
  return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&[r.top+2,r.y+r.height/2,r.bottom-2].every(y=>document.elementFromPoint(r.x+r.width/2,y)===el);
 }));
 // Small phones fit the entire grid without sacrificing the fixed controls.
 await resizeViewport({width:360,height:640});
 assert.equal(await fullyVisible('#keyboard button, #special-keys button, #native-mode, #grid-mode, #keyboard-close'),true,'Small phone keyboard controls must fit without scrolling');
 const modBox=await page.locator('#key-super').boundingBox();
 assert.equal(await page.locator('#key-super').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el}),true);
 assert(modBox.width>=44,'Super must remain a usable touch target');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:new URL('artifacts/keyboard-small.png',root).pathname});
 await resizeViewport({width:390,height:844});
 await touch('touchStart',[await center('#key-super')]);
 await page.locator('#native-mode').click();
 await touch('touchEnd',[]);
 assert.equal(await page.locator('#key-super').getAttribute('aria-pressed'),'false','Phone typing must release held Super');
 await page.waitForTimeout(100);
 assert(packets.some(p=>p[0]===9&&p[1]===227),'Super key-down missing');
 assert(packets.some(p=>p[0]===12),'Resize right-down missing');
 assert(packets.some(p=>p[0]===13),'Resize right-up missing');
 assert(packets.some(p=>p[0]===11&&p[1]===6),'Keyboard C tap missing');
 await page.locator('#native-mode').click();
 assert.equal(await page.locator('#native-input').evaluate(el=>document.activeElement===el),true);
 await page.locator('#native-input').fill('Hello!');
 await page.waitForTimeout(100);
 assert(packets.some(p=>p[0]===14),'Native text packet missing');
 await mkdir(new URL('artifacts/',root),{recursive:true});
 await page.screenshot({path:new URL('artifacts/keyboard.png',root).pathname});
 // Model the reduced visible area above a phone's software keyboard.
 for(const height of [440,320]) {
  await resizeViewport({width:390,height});
  assert.equal(await fullyVisible('#special-keys button, #native-mode, #grid-mode, #keyboard-close, #native-input'),true,'Phone typing controls must stay above the software keyboard');
 }
 await page.screenshot({path:new URL('artifacts/keyboard-compact.png',root).pathname});
 await resizeViewport({width:390,height:844});
 await page.locator('#keyboard-close').click();
 await mkdir(new URL('artifacts/',root),{recursive:true});
 await page.screenshot({path:new URL('artifacts/phone.png',root).pathname});
 await page.locator('#settings-open').click();
 assert.equal(await page.locator('#settings').evaluate(d=>d.open),true);
 await page.locator('#sensitivity').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('input'));});
 assert.equal(await page.locator('#sensitivity-value').textContent(),'2.0×');
 assert.equal(await page.locator('#scroll-side button[data-side="right"]').getAttribute('aria-pressed'),'true');
 await page.locator('#scroll-side button[data-side="left"]').tap();
 assert.equal(await page.evaluate(()=>localStorage.getItem('ghostpad.scrollSide')),'left');
 assert.equal(await page.locator('#scroll-side button[data-side="left"]').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:new URL('artifacts/settings.png',root).pathname});
 await page.locator('#settings-close').click();await page.reload();
 await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 assert.equal(await page.locator('#sensitivity').inputValue(),'2');
 assert.equal(await page.locator('#scroll-side button[data-side="left"]').getAttribute('aria-pressed'),'true','Side preference must survive reload');
 const leftBox=await page.locator('#scroll-zone').boundingBox(),reloadedPad=await page.locator('#pad').boundingBox();
 assert(Math.abs(leftBox.x-reloadedPad.x)<=2,'Strip must move to the left edge');
 from=packets.length;
 await touch('touchStart',[[leftBox.x+22,250]]);await touch('touchMove',[[leftBox.x+22,290]]);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),stripPackets,'Left strip must scroll identically');
 await page.screenshot({path:new URL('artifacts/phone-scroll-left.png',root).pathname});
 await page.locator('#settings-open').click();await page.locator('#disconnect').click();
 assert.equal(await page.locator('#status').textContent(),'Disconnected');
 await page.locator('#disconnect').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 await page.locator('#forget').click();assert.equal(await page.evaluate(()=>localStorage.getItem('ghostpad.key')),'');
 await page.locator('#mod-super').tap();
 assert.equal(await fillActive(),'false','Unpaired touches must not activate the fill');
 // Losing the GPU keeps a visible CSS face and the original Super control.
 await page.evaluate(()=>{
  const gl=document.querySelector('[data-slot="live-orb"] canvas').getContext('webgl');
  window.orbContext=gl.getExtension('WEBGL_lose_context');
  window.orbContext.loseContext();
 });
 await page.waitForSelector('[data-slot="live-orb"][data-renderer="fallback"]');
 assert.equal(await orb.locator('span').count(),2,'Fallback must retain both eyes');
 assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y).id,orbPoint),'mod-super');
 await page.evaluate(()=>window.orbContext.restoreContext());
 await page.waitForSelector('[data-slot="live-orb"][data-renderer="webgl"]');
 // A browser with no WebGL at all must also start and show the CSS fallback.
 await page.addInitScript(()=>{
  const getContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'?null:getContext.call(this,type,...args);};
 });
 await page.reload();
 await page.waitForSelector('[data-slot="live-orb"][data-renderer="fallback"]');
 assert.equal(await orb.locator('span').count(),2);
 assert.equal(await page.locator('#status').textContent(),'Pair your phone');
 assert.deepEqual(errors,[]);
 console.log('Browser client: pairing, gestures, settings, reconnect, and forgetting passed. Screenshots: artifacts/.');
} finally {await browser.close();}
