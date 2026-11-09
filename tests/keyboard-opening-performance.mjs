import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {browserPage} from './support/browser-page.mjs';
import {recordInput} from './support/receiver.mjs';
const root=new URL('../',import.meta.url),runs=[];
const baseline=await readFile(process.argv[2]||'/tmp/ghostpad-padding-animation.html','utf8');
const current=(await browserPage(name=>readFile(new URL('web/'+name,root),'utf8'))).html;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try {
 for(const [version,html] of [['padding',baseline],['compositor',current],['compositor',current],['padding',baseline]]){
  const context=await browser.newContext({viewport:{width:390,height:695},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const hashes=tag=>[...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`,'g'))].map(match=>"'sha256-"+createHash('sha256').update(match[1]).digest('base64')+"'").join(' ');
  const policy=`default-src 'self';connect-src 'self' ws://ghostpad.test;script-src 'self' ${hashes('script')};style-src 'self' ${hashes('style')}`;
  await page.route('http://ghostpad.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':policy}}));
  await page.routeWebSocket('**/ws',ws=>ws.onMessage(data=>{if(typeof data==='string')ws.send('ready:preview');else recordInput(ws,data);}));
  await page.goto('http://ghostpad.test/#key='+'a'.repeat(64));
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
  await page.locator('#keyboard-toggle').tap();await page.waitForTimeout(220);
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
  const before=await metrics();
  await page.evaluate(async()=>{
   Object.defineProperty(visualViewport,'height',{configurable:true,value:392});
   visualViewport.dispatchEvent(new Event('resize'));await new Promise(resolve=>setTimeout(resolve,400));
  });
  const after=await metrics();
  const run={version,layouts:after.LayoutCount-before.LayoutCount,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000};
  runs.push(run);console.log(JSON.stringify(run));
  if(version==='compositor')assert(run.layouts<=5,'Opening must not relayout the controls on every animation frame');
  await context.close();
 }
 const report={environment:'Chromium mobile emulation, mocked receiver, 695px frame and 392px visual viewport; 400ms observation; native iOS animation and physical frame rate are not measured',runs};
 await writeFile(new URL('artifacts/keyboard-layout/opening-performance.json',root),JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();}
