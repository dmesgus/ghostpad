// Client integration with a controlled WebSocket peer. Real receiver tests are in integration.py.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { checkAppearance, checkAppearanceFallbacks } from './support/appearance.mjs';
import { browserPage } from './support/browser-page.mjs';
const root = new URL('../', import.meta.url);
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
try {
 const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const page = await context.newPage(), errors=[], packets=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.route('http://ghostpad.test/**', async route=>{
  const path=new URL(route.request().url()).pathname;
  const name=path==='/'?'index.html':path.slice(1);
  if (!['index.html','style.css','app.js','gestures.js','scroll.js','text.js','icon.svg'].includes(name)) return route.fulfill({status:404});
  if (name === 'index.html') {
   const {html,policy}=await browserPage(name=>readFile(new URL(`web/${name}`,root),'utf8'));
   return route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':policy}});
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
  window.decorativeFrames=0;
  const raf=window.requestAnimationFrame;
  window.requestAnimationFrame=callback=>{window.decorativeFrames++;return raf(callback);};
  HTMLCanvasElement.prototype.getContext=function(){throw Error('Canvas is not needed for Ghostpad');};
 });
 await page.goto(`http://ghostpad.test/#key=${'a'.repeat(64)}`);
 await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 await page.waitForSelector('#super-fill-root .origin-fill', {state:'attached'});
 const orb=page.locator('[data-slot="live-orb"]');
 const orbBox=await orb.boundingBox();
 const orbPoint=[orbBox.x+orbBox.width/2,orbBox.y+orbBox.height/2];
 assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y).id,orbPoint),'mod-super');
 assert.equal(await page.locator('canvas').count(),0);
 assert.equal(await orb.evaluate(el=>getComputedStyle(el.parentElement).mixBlendMode),'normal');
 const idleFrames=await page.evaluate(()=>window.decorativeFrames);
 await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>window.decorativeFrames),idleFrames,'Idle UI must schedule no animation frames');
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
 const assertThumbGeometry=async()=>{
  const result=await page.evaluate(()=>{
   const pad=document.querySelector('#pad').getBoundingClientRect();
   const zones=['mod-super','right-click'].map(id=>({id,box:document.getElementById(id).getBoundingClientRect()}));
   const hits=[];
   for(const {id,box} of zones) {
    for(const y of [.05,.15,.3,.45,.6,.75]) for(const x of [.08,.3,.55,.8,.96]) {
     const px=id==='mod-super'?box.left+x*box.width:box.right-x*box.width;
     const py=box.top+y*box.height;
     const boundary=y<.5?Math.sqrt(1-((y-.5)/.5)**2):1;
     hits.push({actual:document.elementFromPoint(px,py)?.id,expected:x<boundary?id:'pad',id,x,y,boundary});
    }
   }
   for(const y of [.05,.5,.9,.99]) for(const x of [.34,.5,.66])
    hits.push({actual:document.elementFromPoint(pad.left+x*pad.width,pad.top+y*pad.height)?.id,expected:'pad'});
   return {hits,pad:pad.toJSON(),zones:zones.map(({box})=>box.toJSON()),strip:document.querySelector('#scroll-zone').getBoundingClientRect().toJSON(),left:document.querySelector('#pad').classList.contains('scroll-left')};
  });
  for(const hit of result.hits) assert.equal(hit.actual,hit.expected,`Curved hit areas and the center tracking lane must match their geometry: ${JSON.stringify(hit)}`);
  for(const [index,zone] of result.zones.entries()) {
   assert(Math.abs(zone.width-Math.min(result.pad.width*(index===0?.32:.24),index===0?160:108))<1);
   assert(zone.height>=(index===0?68:56)&&zone.height<=(index===0?136:96));
  }
  assert(result.zones[1].height<result.zones[0].height,'Right-click must be shorter than Super');
  const adjacent=result.zones[result.left?0:1];
  assert(Math.abs(result.strip.bottom-adjacent.top)<.1,'Scroll strip must extend down to the corner on its own side');
  assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.id,[result.strip.x+result.strip.width/2,adjacent.top-4]),'scroll-zone','The lower end of the extended strip must accept scrolling');
 };
 // A precise correction must respond while the finger is down, with no click on lift.
 const preciseFrom=packets.length;
 await touch('touchStart',[[120,250]]);await touch('touchMove',[[125,250]]);await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(preciseFrom).filter(p=>p[0]!==8).map(p=>p[0]),[1],'Small corrections must respond before lifting');
 await page.waitForTimeout(420);await touch('touchEnd',[]);await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(preciseFrom).filter(p=>p[0]!==8).map(p=>p[0]),[1],'A small correction must not become a hold-drag');
 const jitterFrom=packets.length;
 await touch('touchStart',[[120,250]]);await touch('touchMove',[[121,251]]);await touch('touchEnd',[]);await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(jitterFrom).filter(p=>p[0]!==8).map(p=>p[0]),[3],'Landing jitter must stay a click without moving the cursor');
 await page.locator('#pad').dispatchEvent('touchcancel');
 // After the initial state change, ordinary pointer motion must not mutate UI.
 await touch('touchStart',[[120,250]]);await touch('touchMove',[[140,270]]);
 await page.evaluate(()=>{
  window.motionMutations=0;
  window.motionObserver=new MutationObserver(records=>window.motionMutations+=records.length);
  for(const id of ['pad','drag-state']) window.motionObserver.observe(document.getElementById(id),{attributes:true,childList:true,subtree:true,characterData:true});
 });
 await touch('touchMove',[[160,280]]);await touch('touchMove',[[180,290]]);
 assert.equal(await page.evaluate(()=>{window.motionObserver.disconnect();return window.motionMutations;}),0,'Steady motion must not mutate DOM');
 await touch('touchEnd',[]);
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
 assert(stripBox.width>=56&&stripBox.height>=100,'Scroll strip must be an accessible touch target');
 from=packets.length;
 await touch('touchStart',[[sx,sy]]);await touch('touchMove',[[sx,sy+40]]);await page.waitForTimeout(100);await touch('touchEnd',[]);await page.waitForTimeout(50);
 const stripPackets=packets.slice(from).filter(p=>p[0]!==8);
 assert.deepEqual(stripPackets.map(p=>p[0]),[2]);
 from=packets.length;
 await touch('touchStart',[[120,250],[190,250]]);await touch('touchMove',[[120,290],[190,290]]);await page.waitForTimeout(100);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(stripPackets,packets.slice(from).filter(p=>p[0]!==8),'Strip must match two-finger scrolling');
 from=packets.length;
 await touch('touchStart',[[sx,sy]]);await touch('touchEnd',[]);
 await touch('touchStart',[[sx,sy]]);await page.waitForTimeout(450);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[],'Strip taps and holds must not click');
 from=packets.length;
 await touch('touchStart',[[sx,sy]]);await touch('touchMove',[[sx-80,sy+40]]);await page.waitForTimeout(100);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).map(p=>p[0]),[2],'Leaving the strip must keep scrolling');
 from=packets.length;
 await touch('touchStart',[[sx-80,sy]]);await touch('touchMove',[[sx,sy+40]]);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).map(p=>p[0]),[1],'Crossing into the strip must keep moving the pointer');
 // Actual touch release must keep sending wheel movement; touching again brakes it.
 for(const strip of [true,false]) {
  const points=y=>strip?[[sx,y]]:[[120,y],[190,y]];
  from=packets.length;
  await touch('touchStart',points(250));
  for(const y of [270,290,310,330]){await page.waitForTimeout(16);await touch('touchMove',points(y));}
  await touch('touchEnd',[]);await page.waitForTimeout(50);
  const released=packets.length;
  await page.waitForTimeout(120);
  const coastPackets=packets.slice(released).filter(p=>p[0]!==8);
  assert(coastPackets.length>=2,`${strip?'Strip':'Two-finger'} flick must coast after lifting`);
  assert(packets.slice(from).filter(p=>p[0]!==8).every(p=>p[0]===2),'Scrolling must never generate clicks or pointer movement');
  assert(coastPackets.every(p=>new DataView(Uint8Array.from(p).buffer).getFloat32(5,true)<0),'Momentum must preserve natural scrolling direction');
  await touch('touchStart',[[sx,sy]]);await page.waitForTimeout(30);
  const stopped=packets.filter(p=>p[0]!==8).length,stoppedFrames=await page.evaluate(()=>window.decorativeFrames);
  await page.waitForTimeout(120);await touch('touchEnd',[]);await page.waitForTimeout(50);
  assert.equal(packets.filter(p=>p[0]!==8).length,stopped,'Touching the strip must stop momentum without clicking');
  assert.equal(await page.evaluate(()=>window.decorativeFrames),stoppedFrames,'Braking must stop scheduling momentum frames');
 }
 const padBox=await page.locator('#pad').boundingBox();
 for(const id of ['mod-super','right-click']) {
  const box=await page.locator(`#${id}`).boundingBox();
  assert(box.x>=padBox.x&&box.y>=padBox.y&&box.x+box.width<=padBox.x+padBox.width&&box.y+box.height<=padBox.y+padBox.height,'Thumb zone must be inside pad');
 }
 await assertThumbGeometry();
 // A touch starting in the old bottom band now tracks through either curve.
 for(const id of ['mod-super','right-click']) {
  await page.locator('#pad').dispatchEvent('touchcancel');
  const box=await page.locator(`#${id}`).boundingBox();
  const start=[padBox.x+padBox.width/2,padBox.y+padBox.height-80];
  const end=[box.x+box.width/2,start[1]];
  from=packets.length;
  await touch('touchStart',[start]);await touch('touchMove',[end]);await touch('touchEnd',[]);await page.waitForTimeout(30);
  const sent=packets.slice(from).filter(p=>p[0]!==8);
  assert(sent.length>0&&sent.every(p=>p[0]===1),'Crossing a corner boundary must keep tracking without clicks or modifiers');
  from=packets.length;
  const cutaway=[id==='mod-super'?box.x+box.width*.9:box.x+box.width*.1,box.y+box.height*.1];
  await touch('touchStart',[cutaway]);await touch('touchMove',[[cutaway[0],cutaway[1]-20]]);await touch('touchEnd',[]);await page.waitForTimeout(30);
  const cutawayPackets=packets.slice(from).filter(p=>p[0]!==8);
  assert(cutawayPackets.length>0&&cutawayPackets.every(p=>p[0]===1),'The area cut away by the curve must accept real tracking touches');
 }
 // The higher outer shoulder is usable; holding Super remains captured outside it.
 const shoulder=await page.locator('#mod-super').boundingBox();
 from=packets.length;
 await touch('touchStart',[[shoulder.x+12,shoulder.y+shoulder.height*.15]]);
 assert.equal(await page.locator('#mod-super').getAttribute('aria-pressed'),'true');
 await touch('touchMove',[[padBox.width/2,shoulder.y-30]]);
 assert.equal(await page.locator('#mod-super').getAttribute('aria-pressed'),'true');
 await touch('touchEnd',[]);await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,227],[10,227]]);
 assert.equal(await page.locator('#mod-super').getAttribute('aria-pressed'),'false');
 const rightShoulder=await page.locator('#right-click').boundingBox();
 from=packets.length;
 await touch('touchStart',[[rightShoulder.x+rightShoulder.width-12,rightShoulder.y+rightShoulder.height*.15]]);
 await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[4]],'The higher right shoulder must right-click once');
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
 assert(Math.abs(await page.locator('.super-fill').evaluate(el=>Number.parseFloat(el.style.left))-(superPoint[0]-padBox.x))<.001);
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
 assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'),'#000000');
 assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)','Browser canvas must match the held fill');
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
 assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'),'#e8e8e8');
 assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(232, 232, 232)','Cancellation must restore the browser canvas');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForTimeout(100);
 const stillFrames=await page.evaluate(()=>window.decorativeFrames);
 await page.waitForTimeout(120);
 assert.equal(await page.evaluate(()=>window.decorativeFrames),stillFrames,'Reduced motion must stop the orb animation loop');
 await touch('touchStart',[superPoint]);
 await waitForFill(1);
 await page.setViewportSize({width:420,height:844});
 await page.waitForFunction(()=>document.getElementById('pad').getBoundingClientRect().width===420);
 await page.waitForFunction(([x,y])=>Number.parseFloat(document.querySelector('.super-fill').style.width)>=2*Math.hypot(420-x,y),superPoint);
 await touch('touchEnd',[]);
 await waitForFill(0);
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('#keyboard-toggle').click();
 assert.equal(await page.locator('#native-input').evaluate(el=>document.activeElement===el),true,'Opening the keyboard must focus phone typing in one tap');
 await page.locator('#grid-mode').tap();
 // Hold keyboard Super with one finger, then use shortcut keys with another.
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
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).slice(-2),[[9,40],[10,40]]);
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
 await assertThumbGeometry();
 // Touch and mouse accessory keys must send once without taking focus from typing.
 for(const usage of [41,43,80,79,81,82,42,40,44]) {
  from=packets.length;
  await page.locator(`#native-tools button[data-key="${usage}"]`).tap();
  await page.waitForTimeout(30);
  assert.equal(await page.locator('#native-input').evaluate(el=>document.activeElement===el),true,'Accessory taps must keep the phone keyboard open');
  assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,usage],[10,usage]],'Accessory taps must send exactly one press and release');
 }
 from=packets.length;
 await page.locator('#native-input').fill('after navigation');await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[14,...Buffer.from('after navigation')]],'Navigation must start a fresh typing context');
 await page.locator('#native-tools button[data-key="40"]').click();
 assert.equal(await page.locator('#native-input').evaluate(el=>document.activeElement===el),true,'Mouse accessory clicks must also preserve focus');
 // Holds are real key-downs, including second-finger controls and captured drifts.
 for(const usage of [41,43,80,79,81,82,42,40,44]) {
  const point=await center(`#native-tools button[data-key="${usage}"]`);
  from=packets.length;await touch('touchStart',[point]);await page.waitForTimeout(550);
  assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,usage]],'The key must stay down until the finger lifts');
  assert.equal(await page.locator(`#native-tools button[data-key="${usage}"]`).evaluate(el=>el.classList.contains('held')),true);
  assert.equal(await page.locator('#native-input').evaluate(el=>document.activeElement===el),true,'Holding must preserve phone typing focus');
  await touch('touchEnd',[]);await page.waitForTimeout(30);
  assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,usage],[10,usage]],'A hold must release once, without a trailing click');
 }
 for(const ending of ['touchEnd','touchCancel']) {
  const point=await center('#native-tools button[data-key="42"]');from=packets.length;
  await touch('touchStart',[point]);await touch('touchMove',[[point[0],point[1]-90]]);await touch(ending,[]);await page.waitForTimeout(30);
  assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,42],[10,42]],'Lifting or canceling outside the button must release the captured key');
 }
 from=packets.length;
 const space=await center('#native-tools button[data-key="44"]'),arrow=await center('#native-tools button[data-key="79"]');
 await touch('touchStart',[space]);await touch('touchStart',[space,arrow]);await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,44],[9,79]]);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:arrow[0],y:arrow[1],id:1}]});await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).at(-1),[10,79]);
 assert.equal(await page.locator('#native-tools button[data-key="44"]').evaluate(el=>el.classList.contains('held')),true);
 await touch('touchEnd',[]);await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8).at(-1),[10,44]);
 // Mouse and keyboard activation follow the same hold lifecycle.
 const backspace=page.locator('#native-tools button[data-key="42"]');
 await backspace.hover();from=packets.length;await page.mouse.down();await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,42]]);await page.mouse.up();await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,42],[10,42]]);
 await backspace.focus();from=packets.length;await page.keyboard.down('Enter');await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,42]]);await page.keyboard.up('Enter');await page.waitForTimeout(30);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,42],[10,42]]);
 await page.locator('#native-input').focus();
 // Model the reduced visible area above a phone's software keyboard.
 for(const viewport of [{width:390,height:440},{width:390,height:320},{width:320,height:220},{width:640,height:240}]) {
  await resizeViewport(viewport);
  assert.equal(await fullyVisible('#native-tools button, #native-mode, #grid-mode, #keyboard-close, #native-input'),true,'Phone typing controls must stay above the software keyboard');
  assert.equal(await page.locator('#native-tools button').evaluateAll(buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();return r.width>=44&&r.height>=44})),true,'Typing controls must retain thumb-sized targets');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 await resizeViewport({width:390,height:320});
 await page.locator('#native-input').fill('Hello!');
 await page.screenshot({path:new URL('artifacts/keyboard-compact.png',root).pathname});
 // Safari changes its visual viewport without changing CSS media-query height.
 await resizeViewport({width:390,height:844});
 const visualViewport=async(height,offsetTop=0)=>page.evaluate(({height,offsetTop})=>{
  for(const [name,value] of Object.entries({height,offsetTop})) Object.defineProperty(window.visualViewport,name,{configurable:true,value});
  window.visualViewport.dispatchEvent(new Event('resize'));
  window.visualViewport.dispatchEvent(new Event('scroll'));
 },{height,offsetTop});
 for(const [height,offset] of [[480,0],[320,64],[220,110],[320,0],[480,0]]) {
  await visualViewport(height,offset);
  const main=await page.locator('main').boundingBox();
  assert.equal(main.y,offset,'The app must follow visual viewport panning');
  assert.equal(main.height,height,'The app must follow visual viewport height independently of innerHeight');
  assert.equal(await page.locator('#native-input').inputValue(),'Hello!','Viewport changes must not reset the text context');
  assert.equal(await page.locator('#native-tools button, #native-input, .keyboard-toolbar').evaluateAll(elements=>elements.every(el=>{const r=el.getBoundingClientRect(),v=visualViewport;return r.top>=v.offsetTop&&r.bottom<=v.offsetTop+v.height})),true,'Typing controls must fit within a panned visual viewport');
 }
 // A scroll-only viewport change also needs to move the app.
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:48});visualViewport.dispatchEvent(new Event('scroll'));});
 assert.equal((await page.locator('main').boundingBox()).y,48);
 await page.locator('#grid-mode').tap();
 await visualViewport(320,0);
 assert.equal(await fullyVisible('#special-keys button, #native-mode, #grid-mode, #keyboard-close'),true,'Grid modifiers must stay reachable while the OS keyboard closes');
 const modifierY=(await page.locator('#key-super').boundingBox()).y;
 await page.locator('#keyboard-panel .sheet-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 assert.equal((await page.locator('#key-super').boundingBox()).y,modifierY,'Scrolling the grid must keep modifiers anchored');
 await visualViewport(220,0);
 assert.equal(await page.locator('#special-keys button, #native-mode, #grid-mode, #keyboard-close').evaluateAll(elements=>elements.every(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height})),true,'Grid controls must also fit short landscape keyboard transitions');
 await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
 await resizeViewport({width:390,height:844});
 await page.locator('#keyboard-close').click();
 await page.locator('#keyboard-toggle').tap();
 assert.equal(await page.locator('#native-input').evaluate(el=>document.activeElement===el),true,'Reopening must return directly to phone typing');
 // Older browsers fall back to the window size when VisualViewport is missing.
 await page.evaluate(()=>{
  window.viewportDescriptor=Object.getOwnPropertyDescriptor(window,'visualViewport');
  Object.defineProperty(window,'visualViewport',{configurable:true,value:undefined});
 });
 await resizeViewport({width:320,height:440});
 assert.equal(await fullyVisible('#native-tools button, #native-mode, #grid-mode, #keyboard-close, #native-input'),true,'Window resize fallback must keep typing controls usable');
 await page.evaluate(()=>{Object.defineProperty(window,'visualViewport',window.viewportDescriptor);window.dispatchEvent(new Event('resize'));});
 await resizeViewport({width:390,height:844});
 await page.locator('#keyboard-close').tap();
 for(const viewport of [{width:320,height:568},{width:430,height:932},{width:640,height:360}]) {
  await resizeViewport(viewport);
  await assertThumbGeometry();
  from=packets.length;await page.locator('#mod-super').tap();await page.waitForTimeout(30);
  assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),[[9,227],[10,227]]);
 }
 await resizeViewport({width:390,height:844});
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
 await assertThumbGeometry();
 from=packets.length;
 await touch('touchStart',[[leftBox.x+22,250]]);await touch('touchMove',[[leftBox.x+22,290]]);await page.waitForTimeout(100);await touch('touchEnd',[]);await page.waitForTimeout(50);
 assert.deepEqual(packets.slice(from).filter(p=>p[0]!==8),stripPackets,'Left strip must scroll identically');
 await page.screenshot({path:new URL('artifacts/phone-scroll-left.png',root).pathname});
 await checkAppearance(page,root);
 await page.locator('#settings-open').click();await page.locator('#disconnect').click();
 assert.equal(await page.locator('#status').textContent(),'Disconnected');
 await page.locator('#disconnect').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 await page.locator('#forget').click();assert.equal(await page.evaluate(()=>localStorage.getItem('ghostpad.key')),'');
 await page.locator('#mod-super').tap();
 assert.equal(await fillActive(),'false','Unpaired touches must not activate the fill');
 await checkAppearanceFallbacks(page);
 assert.deepEqual(errors,[]);
 console.log('Browser client: pairing, gestures, settings, reconnect, and forgetting passed. Screenshots: artifacts/.');
} finally {await browser.close();}

if (process.argv.includes('--profile')) {
 const { profileBrowser } = await import('./performance.mjs');
 const index=process.argv.indexOf('--compare');
 const baseline=process.argv.indexOf('--baseline-assets');
 await profileBrowser(index>=0?process.argv[index+1]:undefined,baseline>=0?process.argv[baseline+1]:undefined);
}
