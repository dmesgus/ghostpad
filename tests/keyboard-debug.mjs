import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {browserPage} from './support/browser-page.mjs';
import {recordInput} from './support/receiver.mjs';
const root=new URL('../',import.meta.url),samples=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route('http://ghostpad.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/keyboard-trace'){samples.push(url.search.slice(1));return route.fulfill({status:204,body:''});}
  if(url.pathname==='/keyboard-debug.js')return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('web/keyboard-debug.js',root),'utf8')});
  const {html,policy}=await browserPage(name=>readFile(new URL('web/'+name,root),'utf8'));
  return route.fulfill({contentType:'text/html',body:html.replace('</body>','<script src="/keyboard-debug.js"></script></body>'),headers:{'Content-Security-Policy':policy}});
 });
 await page.routeWebSocket('**/ws',ws=>ws.onMessage(data=>{if(typeof data==='string')ws.send('ready:preview');else recordInput(ws,data);}));
 await page.addInitScript(()=>localStorage.setItem('ghostpad.key','a'.repeat(64)));
 await page.goto('http://ghostpad.test/keyboard-debug?compare=1');
 await page.locator('#keyboard-toggle').tap();await page.locator('#native-input').fill('DO_NOT_RECORD_837650');
 await page.evaluate(()=>{
  Object.defineProperty(visualViewport,'height',{configurable:true,value:320});
  Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:64});
  visualViewport.dispatchEvent(new Event('resize'));
 });
 await page.waitForTimeout(600);await page.locator('#native-input').evaluate(el=>el.blur());await page.waitForTimeout(600);
 for(const label of ['A','B','C','D','Base']){
  const button=page.getByRole('button',{name:label,exact:true});await button.click();
  assert.equal(await button.getAttribute('aria-pressed'),'true');
  assert.equal((await page.locator('main').boundingBox()).height,844);
 }
 assert(samples.length>=2);assert.deepEqual(errors,[]);
 for(const sample of samples){assert.match(sample,/^[0-9,;.\-]+$/);for(const row of sample.split(';'))assert.equal(row.split(',').length,18);}
 assert(!samples.join('').includes('DO_NOT_RECORD_837650'));
 assert(samples.some(sample=>sample.split(';').some(row=>row.split(',')[3]==='320')));
 console.log('Keyboard diagnostics: numeric geometry/timing capture and CSP passed; typed text excluded.');
}finally{await browser.close();}
