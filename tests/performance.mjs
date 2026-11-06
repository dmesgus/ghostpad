// Diagnostic microbenchmark, not a phone/network/end-to-end latency test.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { recordInput } from './support/receiver.mjs';
import { browserPage } from './support/browser-page.mjs';

const root=new URL('../',import.meta.url);
const percentile=(values,p)=>{
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted.length?Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))].toFixed(3)):null;
};
const distribution=values=>({samples:values.length,median:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99)});

export async function profileBrowser(compare,baselineAssets) {
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
 const sources=[{label:'working-tree',read:name=>readFile(new URL(`web/${name}`,root),'utf8')}];
 if(baselineAssets) sources.unshift({label:'baseline-assets',read:name=>readFile(resolve(baselineAssets,name),'utf8')});
 if(compare) {
  const revision=execFileSync('git',['rev-parse','--verify','--end-of-options',`${compare}^{commit}`],{cwd:root,encoding:'utf8'}).trim();
  sources.unshift({label:revision,read:name=>execFileSync('git',['show',`${revision}:web/${name}`],{cwd:root,encoding:'utf8',maxBuffer:5_000_000})});
 }
 for(const source of sources) source.page=await browserPage(source.read);
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const samples=[];
 try {
  // Alternate order so later runs don't always favor the same version.
  for(let round=0;round<3;round++) for(const source of (round%2?[...sources].reverse():sources)) {
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
   try {
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://ghostpad.test/**',route=>route.request().url().endsWith('/')?
     route.fulfill({contentType:'text/html',body:source.page.html,headers:{'Content-Security-Policy':source.page.policy}}):route.fulfill({status:204}));
    await page.routeWebSocket('**/ws',ws=>ws.onMessage(data=>{
     if(typeof data==='string') ws.send('ready:preview');
     else recordInput(ws,data);
    }));
    await page.addInitScript(()=>{
     window.profile={frames:0,startupMs:0,handlerMs:[],sendMs:[],firstPending:null,measuring:false};
     window.addEventListener('ghostpad-started',()=>window.profile.startupMs=performance.now());
     const raf=window.requestAnimationFrame;
     window.requestAnimationFrame=callback=>{window.profile.frames++;return raf(callback);};
     const add=EventTarget.prototype.addEventListener;
     EventTarget.prototype.addEventListener=function(type,listener,options){
      if(this instanceof HTMLElement&&this.id==='pad'&&type==='touchmove'&&typeof listener==='function') {
       const original=listener;
       listener=function(event){const start=performance.now();try{return original.call(this,event);}finally{if(window.profile.measuring)window.profile.handlerMs.push(performance.now()-start);}};
      }
      return add.call(this,type,listener,options);
     };
     const send=WebSocket.prototype.send;
     WebSocket.prototype.send=function(data){
      if(window.profile.measuring&&data instanceof ArrayBuffer&&(new Uint8Array(data)[0]===17?new Uint8Array(data)[3]:new Uint8Array(data)[0])===1&&window.profile.firstPending!==null){
       window.profile.sendMs.push(performance.now()-window.profile.firstPending);window.profile.firstPending=null;
      }
      return send.call(this,data);
     };
    });
    const cdp=await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    await page.goto(`http://ghostpad.test/#key=${'a'.repeat(64)}`);
    await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview'&&window.profile.startupMs>0);
    await page.waitForTimeout(600);
    const renderer=await page.evaluate(()=>{
     const canvas=document.querySelector('canvas');
     if(!canvas)return 'no canvas';
     const gl=canvas.getContext('webgl');
     if(!gl)return 'WebGL unavailable: CSS fallback';
     const info=gl.getExtension('WEBGL_debug_renderer_info');
     return info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    });
    const idleStart=await metrics(),frames=await page.evaluate(()=>window.profile.frames);
    await page.waitForTimeout(2000);
    const idleEnd=await metrics(),idleFrames=await page.evaluate(()=>window.profile.frames)-frames;
    await page.evaluate(async()=>{
     const pad=document.getElementById('pad');
     const point=(x,y)=>new Touch({identifier:1,target:pad,clientX:x,clientY:y});
     const touch=(type,points)=>pad.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:points,targetTouches:points,changedTouches:points}));
     window.profile.measuring=true;
     touch('touchstart',[point(120,250)]);
     for(let i=1;i<=160;i++){
      const x=120+(i%40)*2,y=250+Math.sin(i/10)*20;
      window.profile.firstPending ??= performance.now();
      pad.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,pointerType:'touch'}));
      touch('touchmove',[point(x,y)]);
      await new Promise(resolve=>setTimeout(resolve,4));
     }
     touch('touchend',[]);
     await new Promise(resolve=>setTimeout(resolve,30));
     window.profile.measuring=false;
    });
    const data=await page.evaluate(()=>window.profile);
    if(errors.length) throw Error(errors.join('\n'));
    const sample={source:source.label,round:round+1,pageBytes:Buffer.byteLength(source.page.html),renderer,
     startupToControllerMs:Number(data.startupMs.toFixed(3)),
     idleSeconds:Number((idleEnd.Timestamp-idleStart.Timestamp).toFixed(3)),idleRafRequests:idleFrames,
     idleRendererTaskMs:Number(((idleEnd.TaskDuration-idleStart.TaskDuration)*1000).toFixed(3)),
     syntheticTouchIntervalMs:4,synchronousTouchHandlerMs:distribution(data.handlerMs),syntheticMoveToSendMs:distribution(data.sendMs)};
    samples.push(sample);
    console.log(JSON.stringify(sample));
   } finally {await context.close();}
  }
  const report={browser:browser.version(),note:'Desktop Chromium, emulated phone viewport, local mocked WebSocket. No real network, uinput, monitor, battery, or phone latency is measured. WebGL may use software rendering. Startup includes test routing. Timing numbers are diagnostic, not guarantees.',samples};
  await mkdir(new URL('artifacts/',root),{recursive:true});
  const reportPath=baselineAssets?'artifacts/cursor-performance.json':'artifacts/performance.json';
  await writeFile(new URL(reportPath,root),JSON.stringify(report,null,2)+'\n');
  console.log(`Browser profile saved to ${reportPath}`);
 } finally {await browser.close();}
}
