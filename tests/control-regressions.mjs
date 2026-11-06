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
 const visual=async(height,offsetTop=0)=>page.evaluate(({height,offsetTop})=>{
  Object.defineProperty(visualViewport,'height',{configurable:true,value:height});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:offsetTop});visualViewport.dispatchEvent(new Event('resize'));
 },{height,offsetTop});

 await record('Safe-area controls preserve focus until release',async()=>{
  await page.addStyleTag({url:'http://ghostpad.test/audit.css'});
  await tap('keyboard-toggle');await visual(480);
  for(const id of ['native-mode','grid-mode','keyboard-close']){
   if(id==='keyboard-close')await tap('native-mode');
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
 await record('Closing reserves panel space and keeps the dock in short viewports',async()=>{
  for(const height of [220,240,320]){
   await tap('keyboard-toggle');await tap('native-mode');await visual(height);
   const before=await state();await tap('keyboard-close');const closed=await state();
   assert.equal(closed.keyboard,false);assert(closed.dock.bottom<=height+.5);
   assert(Math.abs(closed.pad.height-before.pad.height)<2,'Closing should initially preserve pad height');
   for(const h of [height+20,380,480,844]){await visual(h);assert((await state()).dock.bottom<=h+.5);}
   await page.waitForTimeout(380);
   assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('keyboard-closing')),false);
  }
 });
 await record('Closing with safe areas and a resized layout viewport',async()=>{
  await page.addStyleTag({url:'http://ghostpad.test/audit.css'});
  await tap('keyboard-toggle');await tap('native-mode');
  await page.setViewportSize({width:390,height:320});
  await page.waitForFunction(()=>document.querySelector('main').getBoundingClientRect().height===visualViewport.height);
  const before=await state();await tap('keyboard-close');const closed=await state();
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('keyboard-closing')),true,JSON.stringify({before,closed,events:await page.evaluate(()=>auditEvents.slice(-15))}));
  assert(Math.abs(before.pad.height-closed.pad.height)<2);
  assert(closed.dock.bottom<=286.5,'Dock must stay above the 34px safe area');
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
