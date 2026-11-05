// Read-only UI audit against a mocked receiver; no changes to application behavior.
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { browserPage } from './support/browser-page.mjs';
const root = new URL('../', import.meta.url);
const out = new URL('artifacts/ui-controls-audit/', root);
await mkdir(out, {recursive:true});
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
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
  if(typeof data==='string')ws.send('ready:preview');else {packets.push([...data]);if(data[0]===8)ws.send('pong');}
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
 const record=async(name,fn)=>{if(process.argv.includes('--double-taps') && !name.startsWith('Double-tap:'))return;if(process.argv.includes('--follow-up') && !name.startsWith('Follow-up:'))return;await reset();try {const details=await fn();results.push({name,...details});} catch(error){results.push({name,auditFailure:error.message});} await writeFile(new URL(process.argv.includes('--double-taps')?'double-taps.json':process.argv.includes('--follow-up')?'follow-up.json':'results.json',out),JSON.stringify({errors,results},null,2)+'\n');console.log(name);};
 const tap=id=>page.locator('#'+id).tap();
 const visual=async(height,offsetTop=0)=>page.evaluate(({height,offsetTop})=>{
  Object.defineProperty(visualViewport,'height',{configurable:true,value:height});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:offsetTop});visualViewport.dispatchEvent(new Event('resize'));
 },{height,offsetTop});
 for(const opener of ['settings-open','settings-handle','keyboard-toggle']) await record(opener+' → close',async()=>{
  const before=await state();await tap(opener);const opened=await state();await tap(opener==='keyboard-toggle'?'keyboard-close':'settings-close');return {before,opened,closed:await state(),events:await page.evaluate(()=>auditEvents)};
 });
 await record('Phone keyboard reselected (touch and mouse)',async()=>{
  await tap('keyboard-toggle');await page.evaluate(()=>auditEvents=[]);await tap('native-mode');const touch=await page.evaluate(()=>auditEvents);await page.evaluate(()=>auditEvents=[]);await page.locator('#native-mode').click();return {touch,mouse:await page.evaluate(()=>auditEvents)};
 });
 await record('Phone → grid → phone → close',async()=>{
  await tap('keyboard-toggle');const native=await state();await tap('grid-mode');const grid=await state();await tap('native-mode');const phoneAgain=await state();await tap('keyboard-close');return {native,grid,phoneAgain,closed:await state()};
 });
 await record('Close while native keyboard viewport recovers',async()=>{
  await tap('keyboard-toggle');await visual(320,64);const typing=await state();await tap('keyboard-close');const closed=await state();await page.screenshot({path:new URL('close-short-viewport.png',out).pathname});const recovery=[];
  for(const height of [340,379,380,400,440,480,560,640,844]){await visual(height);recovery.push(await state());}return {typing,closed,recovery};
 });
 await record('Viewport thresholds while panel stays open',async()=>{
  await tap('keyboard-toggle');const native=[];for(const height of [440,400,381,380,379,378,360]){await visual(height);native.push(await state());}
  await tap('grid-mode');const grid=[];for(const height of [520,558,559,560,561,600]){await visual(height);grid.push(await state());}return {native,grid};
 });
 for(const method of ['tap','click'])await record('34px safe-area simulation: keyboard × '+method,async()=>{
  await page.addStyleTag({url:'http://ghostpad.test/audit.css'});await tap('keyboard-toggle');await visual(480);await page.evaluate(()=>auditEvents=[]);const before=await state();
  if(method==='tap')await tap('keyboard-close');else await page.locator('#keyboard-close').click({timeout:3000});
  return {before,after:await state(),events:await page.evaluate(()=>auditEvents)};
 });
 await record('34px safe-area simulation: press × and inspect movement',async()=>{
  await page.addStyleTag({url:'http://ghostpad.test/audit.css'});await tap('keyboard-toggle');await visual(480);const before=await state();const x=before.close.x+22,y=before.close.y+22;await page.mouse.move(x,y);await page.mouse.down();const down=await state();await page.mouse.up();return {before,down,after:await state(),events:await page.evaluate(()=>auditEvents)};
 });
 await record('Settings handle upward swipe',async()=>{
  const box=await page.locator('#settings-handle').boundingBox();const x=box.x+box.width/2,y=box.y+box.height-3;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-50,{steps:5});await page.mouse.up();return {after:await state(),events:await page.evaluate(()=>auditEvents)};
 });
 await record('Settings handle short swipe within hit target',async()=>{
  const box=await page.locator('#settings-handle').boundingBox();const x=box.x+box.width/2,y=box.y+box.height-2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-22,{steps:5});await page.mouse.up();return {after:await state(),events:await page.evaluate(()=>auditEvents)};
 });
 await record('Escape dismisses panels',async()=>{
  await tap('settings-open');await page.keyboard.press('Escape');const settings=await state();await tap('settings-close');await tap('keyboard-toggle');await page.keyboard.press('Escape');return {settings,keyboard:await state()};
 });
 await record('Keyboard opens from scrolled grid',async()=>{
  await tap('keyboard-toggle');await tap('grid-mode');await visual(320);await page.locator('#keyboard-panel .sheet-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);await tap('keyboard-close');await visual(844);await tap('keyboard-toggle');return {after:await state(),scrollTop:await page.locator('#keyboard-panel .sheet-scroll').evaluate(el=>el.scrollTop)};
 });
 await record('100 open/close cycles and rapid double taps',async()=>{
  const snapshots=await page.evaluate(()=>{
   const $=id=>document.getElementById(id);const failures=[];
   for(let i=0;i<100;i++){ $('keyboard-toggle').click();if($('keyboard-panel').hidden)failures.push(i+' open');$('keyboard-close').click();if(!$('keyboard-panel').hidden)failures.push(i+' close');$('settings-open').click();$('settings-close').click();}
   return {failures,animations:document.getAnimations().length,domElements:document.querySelectorAll('*').length};
  });
  const point=await page.locator('#keyboard-toggle').boundingBox();await page.touchscreen.tap(point.x+22,point.y+22);await page.touchscreen.tap(point.x+22,point.y+22);return {...snapshots,afterRepeatedOpenTap:await state()};
 });
 await record('Typing help after error then close and reopen',async()=>{
  await tap('keyboard-toggle');await page.locator('#native-input').fill('日本語');const error=await page.locator('#typing-help').textContent();await tap('keyboard-close');await tap('keyboard-toggle');return {error,reopenedHelp:await page.locator('#typing-help').textContent(),reopenedValue:await page.locator('#native-input').inputValue()};
 });
 for(const height of [220,240,320])await record('Follow-up: close at visible height '+height,async()=>{
  await tap('keyboard-toggle');await visual(height);await tap('keyboard-close');const closed=await state();await page.screenshot({path:new URL('close-'+height+'.png',out).pathname});return {closed};
 });
 await record('Follow-up: safe area second close tap',async()=>{
  await page.addStyleTag({url:'http://ghostpad.test/audit.css'});await tap('keyboard-toggle');await visual(480);await tap('keyboard-close');const first=await state();await page.screenshot({path:new URL('cross-first-tap.png',out).pathname});await tap('keyboard-close');return {first,second:await state()};
 });
 await record('Follow-up: safe area selecting grid',async()=>{
  await page.addStyleTag({url:'http://ghostpad.test/audit.css'});await tap('keyboard-toggle');await visual(480);await tap('grid-mode');return {after:await state(),gridSelected:await page.locator('#grid-mode').getAttribute('aria-pressed')};
 });
 await record('Follow-up: click settings handle while settings open',async()=>{
  await tap('settings-open');await tap('settings-handle');return {after:await state()};
 });
 await record('Follow-up: short swipe state order',async()=>{
  await page.evaluate(()=>{window.swipeState=[];for(const t of ['pointerup','click'])document.addEventListener(t,e=>swipeState.push({event:t,target:e.target.id,settings:document.getElementById('settings').open}));});
  const box=await page.locator('#settings-handle').boundingBox();const x=box.x+box.width/2,y=box.y+box.height-2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-22,{steps:5});await page.mouse.up();return {order:await page.evaluate(()=>swipeState),after:await state()};
 });
 await record('Follow-up: release cross after viewport changes',async()=>{
  await tap('keyboard-toggle');await visual(380);const before=await state();const cdp=await context.newCDPSession(page);const x=before.close.x+22,y=before.close.y+22;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});await visual(379);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});return {before,after:await state(),events:await page.evaluate(()=>auditEvents)};
 });
 for(const id of ['keyboard-toggle','keyboard-close'])await record('Double-tap: '+id,async()=>{
  if(id==='keyboard-close')await tap('keyboard-toggle');const b=await page.locator('#'+id).boundingBox();const from=packets.length;
  await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await page.waitForTimeout(60);return {after:await state(),packets:packets.slice(from).filter(p=>p[0]!==8),events:await page.evaluate(()=>auditEvents)};
 });
 await record('Close and reopen chooses mode',async()=>{
  await tap('keyboard-toggle');await tap('grid-mode');await tap('keyboard-close');await tap('keyboard-toggle');return {nativeSelected:await page.locator('#native-mode').getAttribute('aria-pressed'),after:await state()};
 });
 for(const [width,height] of [[320,568],[390,844],[430,932],[640,360],[320,220]])await record('Control fit '+width+'×'+height,async()=>{
  await page.setViewportSize({width,height});const output=[];
  for(const opener of ['settings-open','keyboard-toggle']){
   await tap(opener);output.push({mode:opener,state:await state()});if(opener==='keyboard-toggle'){await tap('grid-mode');output.push({mode:'grid',state:await state()});}await tap(opener==='settings-open'?'settings-close':'keyboard-close');
  }await page.setViewportSize({width:390,height:844});return {output};
 });
 await writeFile(new URL(process.argv.includes('--double-taps')?'double-taps.json':process.argv.includes('--follow-up')?'follow-up.json':'results.json',out),JSON.stringify({environment:'Chromium mobile emulation, mocked receiver; native keyboard viewport and 34px safe area simulated',errors,results},null,2)+'\n');
 console.log(JSON.stringify({errors,scenarios:results.length,report:new URL(process.argv.includes('--double-taps')?'double-taps.json':process.argv.includes('--follow-up')?'follow-up.json':'results.json',out).pathname}));
}finally{await browser.close();}
