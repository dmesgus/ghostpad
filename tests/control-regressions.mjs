// Assertions for the control audit, using real touch events and a mocked receiver.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { recordInput } from './support/receiver.mjs';
import { browserPage } from './support/browser-page.mjs';
const root = new URL('../', import.meta.url);
const out = new URL('artifacts/control-regressions/', root);
await mkdir(out, {recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
const results = [], errors = [];
try {
 const packets=[];
 const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const page = await context.newPage();
 page.setDefaultTimeout(4000);
 page.on('pageerror', error=>errors.push(error.message));
 await page.route('http://ghostpad.test/**', async route=>{
  if (new URL(route.request().url()).pathname==='/audit.css') return route.fulfill({contentType:'text/css',body:'main { padding-bottom:34px; }'});
  if (new URL(route.request().url()).pathname==='/pan.css') return route.fulfill({contentType:'text/css',body:'main { transform:translateY(-303px); }'});
  const {html,policy}=await browserPage(name=>readFile(new URL('web/'+name,root),'utf8'));
  return route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':policy}});
 });
 await page.routeWebSocket('**/ws', ws=>ws.onMessage(data=>{
  if(typeof data==='string')ws.send('ready:preview');else {recordInput(ws,data,packets);}
 }));
 await page.addInitScript(()=>{
  window.auditEvents=[];
  for(const type of ['pointerdown','pointerup','click','focusin','focusout'])document.addEventListener(type,e=>{
   window.auditEvents.push({type,target:e.target.id||e.target.tagName,focus:document.activeElement.id||document.activeElement.tagName,time:performance.now()});
  },true);
 });
 let run=0;
 const reset=async()=>{await page.goto('http://ghostpad.test/?audit='+ ++run +'#key='+'a'.repeat(64));await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');};
 const state=()=>page.evaluate(()=>{
  const rect=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,display:getComputedStyle(e).display};};
  const dock=document.querySelector('.dock').getBoundingClientRect();
  return {focus:document.activeElement.id||document.activeElement.tagName,keyboard:!document.getElementById('keyboard-panel').hidden,settings:document.getElementById('settings').open,pad:rect('pad'),close:rect('keyboard-close'),dock:{top:dock.top,bottom:dock.bottom,height:dock.height},viewport:{height:visualViewport.height,top:visualViewport.offsetTop},animations:document.getAnimations().length};
 });
 const record=async(name,fn)=>{if(process.env.CONTROL_FILTER && !name.includes(process.env.CONTROL_FILTER))return;await reset();await fn();results.push(name);console.log('PASS '+name);};
 const tap=id=>page.locator('#'+id).tap();
 const availableHeight=()=>page.locator('main').evaluate(el=>el.getBoundingClientRect().height-parseFloat(getComputedStyle(el).paddingBottom));
 const settleOpening=()=>page.waitForFunction(()=>{
  return !document.body.classList.contains('keyboard-opening');
 });
 const visual=async(height,offsetTop=0,emit=true)=>{
  await page.evaluate(async({height,offsetTop,emit})=>{
   Object.defineProperty(visualViewport,'height',{configurable:true,value:height});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:offsetTop});
   if(emit)visualViewport.dispatchEvent(new Event('resize'));
   await new Promise(requestAnimationFrame);
  },{height,offsetTop,emit});
  await page.waitForFunction(height=>{
   if(!document.body.classList.contains('native-focused'))return true;
   const frame=document.querySelector('main'),r=frame.getBoundingClientRect();
   return !document.body.classList.contains('keyboard-opening')&&Math.abs(parseFloat(getComputedStyle(frame).paddingBottom)-Math.max(0,r.height-height))<.1;
  },height);
 };

 await record('Tapping the closed typing field focuses immediately and opens with continuous movement',async()=>{
  await page.setViewportSize({width:390,height:695});
  await tap('keyboard-toggle');await tap('native-mode');
  await page.locator('#native-input').evaluate(el=>el.blur());
  await visual(695);
  const press=await page.locator('#native-input').evaluate(el=>{
   const event=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch',isPrimary:true,button:0});
   const nativeDefault=el.dispatchEvent(event);
   return {nativeDefault,focused:document.activeElement===el};
  });
  assert.equal(press.nativeDefault,false,'The app must own the initial focus instead of letting Safari reveal the old field position');
  assert.equal(press.focused,true,'Keyboard focus must stay in the original touch gesture');
  const motion=await page.evaluate(async()=>{
   const frame=document.querySelector('main'),panel=document.getElementById('keyboard-panel'),read=()=>panel.getBoundingClientRect().top;
   Object.defineProperty(visualViewport,'height',{configurable:true,value:392});
   visualViewport.dispatchEvent(new Event('resize'));await new Promise(requestAnimationFrame);
   const animations=document.getAnimations().filter(animation=>['keyboard-slide','keyboard-fill'].includes(animation.animationName));
   const layoutAnimated=animations.some(animation=>animation.effect.getKeyframes().some(keyframe=>['height','paddingBottom','top','bottom','width'].some(property=>property in keyframe)));
   const first=read();await new Promise(resolve=>setTimeout(resolve,90));const middle=read();
   await new Promise(resolve=>setTimeout(resolve,280));
   return {first,middle,last:read(),height:frame.getBoundingClientRect().height,padding:parseFloat(getComputedStyle(frame).paddingBottom),opacity:getComputedStyle(document.getElementById('native-input')).opacity,panelOpacity:getComputedStyle(panel).opacity,animations:animations.length,layoutAnimated};
  });
  assert(motion.first>motion.last);assert(motion.middle<motion.first&&motion.middle>motion.last,'The panel must move with the keyboard instead of jumping in one frame');
  assert.equal(motion.padding,303);assert.equal(motion.height,695);assert.equal(motion.opacity,'1');
  assert.equal(motion.panelOpacity,'1','Finishing the slide must not restart the entry fade');
  assert.equal(motion.animations,3);assert.equal(motion.layoutAnimated,false,'Keyboard movement must animate only transforms');
  await page.locator('#native-input').evaluate(el=>el.blur());
  assert.equal(await availableHeight(),695,'Dismissing stays immediate');
  await page.setViewportSize({width:390,height:844});
 });

 await record('Native page panning is corrected before visualViewport offset catches up',async()=>{
  await page.setViewportSize({width:390,height:695});
  await tap('keyboard-toggle');await tap('native-mode');await visual(392);
  await page.waitForTimeout(1100);
  // Replay the iPhone trace: the frame moves -303px while offsetTop is still zero.
  const style=await page.addStyleTag({url:'http://ghostpad.test/pan.css'});
  await page.evaluate(async()=>{window.dispatchEvent(new Event('scroll'));await new Promise(requestAnimationFrame);});
  const frame=await page.locator('main').boundingBox();
  assert.equal(frame.y,0,'Native panning must not leave the controls offscreen until a later visual scroll event');
  assert.equal(frame.height,695);assert.equal(await availableHeight(),392);
  await style.evaluate(el=>el.remove());await page.locator('#native-input').evaluate(el=>el.blur());
  await page.setViewportSize({width:390,height:844});
 });

 await record('Safari keyboard transitions keep the outer frame full height',async()=>{
  await page.setViewportSize({width:390,height:695});
  await tap('keyboard-toggle');await tap('native-mode');
  await visual(392);
  assert.equal((await page.locator('main').boundingBox()).height,695,'The outer frame must never shrink to the keyboard viewport');
  assert.equal(await availableHeight(),392);
  assert.equal(await page.locator('main').evaluate(el=>el.style.height),'');
  const panel=await page.locator('#keyboard-panel').boundingBox();
  assert(Math.abs(panel.y+panel.height-392)<1,'Typing controls must still sit above the keyboard');
  await page.locator('#native-input').evaluate(el=>el.blur());
  assert.equal((await page.locator('main').boundingBox()).height,695);
  assert.equal(await availableHeight(),695,'Dismissal must release the inset while Safari still reports 392px');
  await page.setViewportSize({width:390,height:844});
 });
 await record('Phone keyboard dismissal catches viewport metrics updated after the resize event',async()=>{
  await tap('keyboard-toggle');await tap('native-mode');await visual(320,64);
  await page.locator('#native-input').fill('Keep typing');
  await page.waitForTimeout(1100);
  const dismissed=await page.evaluate(async()=>{
   // Safari can retain focus and dispatch resize before updating its metrics.
   visualViewport.dispatchEvent(new Event('resize'));
   await new Promise(requestAnimationFrame);
   Object.defineProperty(visualViewport,'height',{configurable:true,value:844});
   Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:0});
   await new Promise(requestAnimationFrame);
   const main=document.querySelector('main');
   return {height:main.getBoundingClientRect().height,top:main.getBoundingClientRect().y,override:main.style.height};
  });
  assert.equal(dismissed.height,844,'Dismissing native typing must restore the full panel without another browser event');
  assert.equal(dismissed.top,0);assert.equal(dismissed.override,'');
  assert.equal((await state()).keyboard,true,'The accessory panel stays open');
  assert.equal(await page.locator('#native-input').inputValue(),'Keep typing');
  assert.equal((await state()).focus,'native-input','The OS may have retained DOM focus');
  await tap('native-mode');await visual(320,64);
  assert.equal(await availableHeight(),320,'Reselecting Phone keyboard must restart native typing');
 });
 await record('Native keyboard dismissal through window blur restores the open panel immediately',async()=>{
  await tap('keyboard-toggle');await tap('native-mode');await visual(320,64);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal((await state()).keyboard,true);
  const main=await page.locator('main').boundingBox();
  assert.equal(main.height,844);assert.equal(main.y,0);
  assert.equal(await page.locator('main').evaluate(el=>el.style.height),'');
  // A hidden OS keyboard can leave the textarea focused. Tapping it must restart tracking.
  assert.equal((await state()).focus,'native-input');
  await visual(844);await tap('native-input');await visual(320,64);
  assert.equal(await availableHeight(),320);
 });
 await record('Dismissing the phone keyboard preserves its panel while releasing stale sizing',async()=>{
  await tap('keyboard-toggle');await tap('native-mode');await visual(320,64);
  await page.locator('#native-input').evaluate(el=>el.blur());
  const before=await page.locator('main').boundingBox();
  assert.equal(before.height,844);assert.equal(before.y,0);assert.equal((await state()).keyboard,true);
  for(const [height,top] of [[380,48],[640,24],[844,0]]){
   await visual(height,top);assert.equal((await page.locator('main').boundingBox()).height,844);
  }
  await tap('native-input');await visual(320,64);
  assert.equal((await state()).focus,'native-input');
  assert.equal(await availableHeight(),320);
 });

 await record('Closing immediately restores the full frame before Safari dismisses its keyboard',async()=>{
  await tap('keyboard-toggle');await visual(320,64);
  await tap('keyboard-close');
  let closed=await state();
  assert.equal(closed.keyboard,false);assert.equal(closed.focus,'keyboard-toggle');
  assert(Math.abs(closed.dock.bottom-844)<1,'The restored dock must immediately return to the full app height');
  assert.equal((await page.locator('main').boundingBox()).y,0,'A keyboard pan must not survive panel closure');
  await page.waitForTimeout(400);
  for(const [height,top] of [[380,48],[480,24],[640,0],[844,0]]){
   await visual(height,top,false);closed=await state();
   assert(Math.abs(closed.dock.bottom-844)<1,'Late keyboard measurements must not move the closed app');
  }
 });
 await record('Closing blurs typing before hiding its panel and clears stale viewport constraints',async()=>{
  await tap('keyboard-toggle');await visual(320,64);
  await page.evaluate(()=>{
   document.getElementById('native-input').addEventListener('blur',()=>{
    window.panelHiddenOnBlur=document.getElementById('keyboard-panel').hidden;
   },{once:true});
  });
  await tap('keyboard-close');
  assert.equal(await page.evaluate(()=>window.panelHiddenOnBlur),false,'Dismiss the native keyboard while its field is still rendered');
  const main=await page.locator('main').boundingBox();
  assert.equal(main.y,0);assert.equal(main.height,844,'Closing must not wait for a viewport recovery timeout');
  assert.equal(await page.locator('main').evaluate(el=>el.style.height),'','Return sizing to CSS after dismissal');
  await visual(320,64);
  assert.equal((await page.locator('main').boundingBox()).height,844,'Late keyboard events must not compress the closed app again');
 });
 await record('Switching to the grid dismisses typing before hiding the field',async()=>{
  await tap('keyboard-toggle');await visual(320,64);
  await page.evaluate(()=>{
   document.getElementById('native-input').addEventListener('blur',()=>{
    window.fieldHiddenOnBlur=document.getElementById('native-panel').hidden;
   },{once:true});
  });
  await tap('grid-mode');assert.equal(await page.evaluate(()=>window.fieldHiddenOnBlur),false);
  await tap('keyboard-close');assert(Math.abs((await state()).dock.bottom-844)<1);
  await visual(844);
  assert.equal(await page.locator('main').evaluate(el=>el.style.height),'');
 });
 await record('Rapid reopening preserves the new typing session through old viewport recovery',async()=>{
  await tap('keyboard-toggle');await tap('native-mode');await visual(320,64);
  await tap('keyboard-close');await tap('keyboard-toggle');
  await page.waitForTimeout(1200);
  const reopened=await state(),main=await page.locator('main').boundingBox();
  assert.equal(reopened.focus,'native-input');assert.equal(reopened.keyboard,true);
  assert.equal(main.height,844);assert.equal(main.y,64);assert.equal(await availableHeight(),320);
  await tap('keyboard-close');await tap('settings-open');await visual(844);
  assert.equal((await state()).settings,true);assert.equal((await page.locator('main').boundingBox()).height,844);
 });
 await record('Viewport updates coalesce into one frame and leave no idle polling',async()=>{
  await tap('keyboard-toggle');await tap('native-mode');
  const updates=await page.evaluate(async()=>{
   const records=[],main=document.querySelector('main'),observer=new MutationObserver(changes=>records.push(...changes));
   observer.observe(main,{attributes:true});
   for(let height=600;height>=320;height-=20){
    Object.defineProperty(visualViewport,'height',{configurable:true,value:height});
    visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'));
   }
   await Promise.resolve();const immediate=records.length;
   await new Promise(requestAnimationFrame);await Promise.resolve();observer.disconnect();
   return {immediate,total:records.length,height:main.getBoundingClientRect().height-parseFloat(main.style.paddingBottom)};
  });
  assert.equal(updates.immediate,0);assert(updates.total<=5,'One layout batch plus two compositor animation parameters');assert.equal(updates.height,320);
  await tap('keyboard-close');
  await page.evaluate(()=>{
   window.idleViewportFrames=0;const raf=window.requestAnimationFrame;
   window.requestAnimationFrame=fn=>{window.idleViewportFrames++;return raf(fn);};
  });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>window.idleViewportFrames),0);
  assert.equal((await page.locator('main').boundingBox()).height,844,'Closing must stop polling even while keyboard measurements remain stale');
  await visual(844);
 });
 await record('Reduced motion keeps panel controls stable without animations',async()=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await tap('keyboard-toggle');await tap('native-mode');await visual(320);
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  await tap('keyboard-close');assert(Math.abs((await state()).dock.bottom-844)<1);
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  await visual(844);await page.emulateMedia({reducedMotion:'no-preference'});
 });

 await record('Safe-area controls preserve focus until release',async()=>{
  await page.addStyleTag({url:'http://ghostpad.test/audit.css'});
  await tap('keyboard-toggle');await visual(480);
  for(const id of ['native-mode','grid-mode','keyboard-close']){
   if(id==='keyboard-close'){await tap('native-mode');await settleOpening();}
   const box=await page.locator('#'+id).boundingBox();
   await page.evaluate(()=>auditEvents=[]);
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   assert.equal((await state()).focus,'native-input');
   assert.deepEqual(await page.locator('#'+id).boundingBox(),box);
   await page.mouse.up();
   if(id==='native-mode')assert.equal((await page.evaluate(()=>auditEvents)).filter(e=>e.type==='focusout').length,0);
   if(id==='grid-mode'){
    assert.equal(await page.locator('#grid-mode').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('main').evaluate(el=>getComputedStyle(el).paddingBottom),'34px');
   }
  }
  assert.equal((await state()).keyboard,false);assert.equal((await state()).focus,'keyboard-toggle');
 });
 await record('Viewport thresholds are continuous in both modes',async()=>{
  await tap('keyboard-toggle');
  for(const mode of ['native-mode','grid-mode']){
   await tap(mode);
   for(const [a,b] of [[380,379],[559,560]]){
    await visual(a);const before=await state();await visual(b);const after=await state();
    assert(Math.abs(before.close.y-after.close.y)<=2);assert(Math.abs(before.pad.height-after.pad.height)<=2);
   }
  }
 });
 await record('Touch release closes original control after a viewport resize',async()=>{
  await tap('keyboard-toggle');await tap('native-mode');await visual(380);
  const b=await page.locator('#keyboard-close').boundingBox(),cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+22,y:b.y+22,id:0}]});
  await visual(320);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal((await state()).keyboard,false);
 });
 await record('Closing ignores keyboard-only viewport changes even from very short views',async()=>{
  for(const height of [220,240,320]){
   await tap('keyboard-toggle');await tap('native-mode');await visual(height);
   await tap('keyboard-close');const closed=await state();
   assert.equal(closed.keyboard,false);assert(Math.abs(closed.dock.bottom-844)<.5);
   for(const h of [height+20,380,480,844]){await visual(h);assert(Math.abs((await state()).dock.bottom-844)<.5);}
   assert.equal(await page.locator('main').evaluate(el=>getComputedStyle(el,'::after').content),'none');
  }
 });
 await record('Closing with safe areas and a resized layout viewport',async()=>{
  await page.addStyleTag({url:'http://ghostpad.test/audit.css'});
  await tap('keyboard-toggle');await tap('native-mode');
  await page.setViewportSize({width:390,height:320});
  await page.waitForFunction(()=>document.querySelector('main').getBoundingClientRect().height===visualViewport.height);
  await tap('keyboard-close');const closed=await state();
  assert.equal(closed.keyboard,false);
  assert(Math.abs(closed.dock.bottom-286)<.5,'Dock must stay directly above the 34px safe area');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(380);
 });
 await record('Touch swipes open settings once and canceled control presses do nothing',async()=>{
  const cdp=await context.newCDPSession(page);
  for(const distance of [22,50]){
   const b=await page.locator('#settings-handle').boundingBox(),x=b.x+b.width/2,y=b.y+b.height-2;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-distance,id:0}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.equal((await state()).settings,true);await tap('settings-close');
  }
  await tap('keyboard-toggle');
  const b=await page.locator('#keyboard-close').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+22,y:b.y+22,id:0}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  assert.equal((await state()).keyboard,true);
 });
 await record('Double tapping the opener sends no remote key or pointer input',async()=>{
  const b=await page.locator('#keyboard-toggle').boundingBox(),from=packets.length;
  await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
  await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
  await page.waitForTimeout(40);
  assert.deepEqual(packets.slice(from).filter(p=>![7,8].includes(p[0])),[]);
  assert.equal((await state()).keyboard,true);
  await page.waitForTimeout(460);
  const start=packets.length;await page.locator('#native-tools button[data-key="79"]').tap();await page.waitForTimeout(30);
  assert.deepEqual(packets.slice(start).filter(p=>p[0]!==8),[[9,79],[10,79]]);
 });
 await record('Handle swipes capture outside releases and suppress duplicate clicks',async()=>{
  for(const distance of [22,50]){
   const b=await page.locator('#settings-handle').boundingBox(),x=b.x+b.width/2,y=b.y+b.height-2;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-distance,{steps:5});await page.mouse.up();
   assert.equal((await state()).settings,true);await tap('settings-close');assert.equal((await state()).focus,'settings-handle');
  }
  await tap('settings-handle');assert.equal((await state()).settings,true);
  await tap('settings-handle');assert.equal((await state()).settings,false);
 });
 await record('Escape closes panels and restores their opener focus',async()=>{
  for(const id of ['settings-open','keyboard-toggle']){
   await tap(id);await page.keyboard.press('Escape');const after=await state();
   assert.equal(after.settings,false);assert.equal(after.keyboard,false);assert.equal(after.focus,id);
  }
 });
 await record('Reopening clears errors and retains mode, including reload',async()=>{
  await tap('keyboard-toggle');await tap('native-mode');
  const help=await page.locator('#typing-help').textContent();
  await page.locator('#native-input').fill('日本語');assert.notEqual(await page.locator('#typing-help').textContent(),help);
  await tap('keyboard-close');await tap('keyboard-toggle');
  assert.equal(await page.locator('#typing-help').textContent(),help);assert.equal(await page.locator('#native-input').inputValue(),'');
  await tap('grid-mode');await tap('keyboard-close');await tap('keyboard-toggle');
  assert.equal(await page.locator('#grid-mode').getAttribute('aria-pressed'),'true');
  await reset();await tap('keyboard-toggle');assert.equal(await page.locator('#grid-mode').getAttribute('aria-pressed'),'true');
 });
 assert.deepEqual(errors,[]);
 await writeFile(new URL('results.json',out),JSON.stringify({results,errors},null,2)+'\n');
}finally{await browser.close();}
