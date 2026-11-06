import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const script = readFileSync(new URL('../web/flow.js',import.meta.url),'utf8').replace('export class InputFlow','class InputFlow') + '\n' + readFileSync(new URL('../web/gestures.js',import.meta.url),'utf8').replace('export class Gestures','class Gestures') + '\n' + readFileSync(new URL('../web/text.js',import.meta.url),'utf8').replaceAll('export function','function') + '\n' + readFileSync(new URL('../web/scroll.js',import.meta.url),'utf8').replace('export class ScrollMomentum','class ScrollMomentum') + '\n' + readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace("import { Gestures } from './gestures.js';",'').replace("import { ScrollMomentum } from './scroll.js';",'').replace("import { InputFlow } from './flow.js';",'').replace("import { textEdit, normalizeText } from './text.js';",'');
function start({key='a'.repeat(64),blocked=false,historyBlocked=false,flow=false}={}) {
 const elements=new Map(),timeouts=new Map(),deadlines=new Map(),frames=new Map(),stored=new Map(),sockets=[],fillEvents=[],documentHandlers={},windowHandlers={};let next=1,now=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'',checked:false,hidden:['keyboard-panel','keyboard'].includes(id),open:false,setPointerCapture(){},click(){this.onclick?.({detail:0})},closest(){return null},contains(){return true},focus(){this.handlers.focus?.()},blur(){},querySelectorAll(){return []},getBoundingClientRect(){return {height:200}},style:{setProperty(){},removeProperty(){}},querySelector(){return element('sheet-scroll')},classList:{toggle(){},remove(){},add(){}},handlers:{},attrs:{},addEventListener(type,fn){this.handlers[type]=fn},setAttribute(name,value){this.attrs[name]=value;if(name==='open')this.open=true},removeAttribute(name){if(name==='open')this.open=false}});return elements.get(id)};
 class Socket { static OPEN=1;static CLOSED=3;readyState=0;bufferedAmount=0;sent=[];sentAt=[];protocol=flow?'ghostpad.flow.v1':'';constructor(){if(blocked)throw Error('Blocked');sockets.push(this)}send(value){this.sent.push(value);this.sentAt.push(now)}close(){this.readyState=3} }
 const window={setTimeout(fn,delay=0){const id=next++;timeouts.set(id,fn);deadlines.set(id,now+delay);return id},setInterval(){return next++},addEventListener(type,fn){windowHandlers[type]=fn},dispatchEvent(event){if(event.type==='ghostpad-super-fill')fillEvents.push(event.detail)}};
 const context={document:{body:{classList:{toggle(){},remove(){},add(){}}},querySelector:element,hidden:false,getElementById:element,addEventListener(type,fn){const previous=documentHandlers[type];documentHandlers[type]=(event={})=>{previous?.(event);fn(event)}}},window,localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},location:{hash:key?'#key='+key:'',pathname:'/',protocol:'http:',host:'192.168.1.42:8765'},history:{replaceState(){if(historyBlocked)throw Error('Unavailable')}},innerHeight:844,ArrayBuffer,WebSocket:Socket,URLSearchParams,Event,CustomEvent,performance:{now:()=>now},setTimeout:window.setTimeout,clearTimeout:id=>{timeouts.delete(id);deadlines.delete(id)},clearInterval(){},requestAnimationFrame(fn){const id=next++;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id)};
 runInNewContext(script,context);
 return {element,sockets,timeouts,frames,stored,fillEvents,document:context.document,documentHandlers,windowHandlers,setTime(time){now=time},advance(time){
  for(;;){const due=[...deadlines].filter(([,at])=>at<=time).sort((a,b)=>a[1]-b[1])[0];if(!due)break;
   const [id,at]=due,fn=timeouts.get(id);timeouts.delete(id);deadlines.delete(id);now=at;fn?.();}
  now=time;
 },frameAt(time){now=time;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(time))}};
}
test('page startup pairs and reaches ready with browser-shaped WebSocket events',()=>{const s=start();const ws=s.sockets[0];ws.readyState=1;ws.onopen();assert.equal(ws.sent[0],'a'.repeat(64));ws.onmessage({data:'ready:linux'});assert.equal(s.element('status').textContent,'Connected');assert.equal(s.timeouts.size,0);});
test('blocked WebSocket displays a visible error instead of throwing',()=>{const s=start({blocked:true});assert.equal(s.element('status').textContent,'Connection blocked');assert.match(s.element('hint').textContent,/Safari/);assert.equal(s.element('reload').hidden,false);});
test('hung upgrade times out and schedules retry even if browser never fires close',()=>{const s=start();const first=s.sockets[0];[...s.timeouts.values()][0]();assert.equal(first.readyState,3);assert.equal(s.element('status').textContent,'Reconnecting');const retry=[...s.timeouts.values()].at(-1);retry();assert.equal(s.sockets.length,2);first.onmessage({data:'ready:linux'});assert.notEqual(s.element('status').textContent,'Connected');});
test('Safari history restriction does not abort startup',()=>{const s=start({historyBlocked:true});assert.equal(s.sockets.length,1);});
test('missing pairing displays connection guidance',()=>{const s=start({key:''});assert.equal(s.sockets.length,0);assert.equal(s.element('status').textContent,'Pair your phone');assert.match(s.element('hint').textContent,/QR code/);});
test('settings open and close when native dialog support is missing',()=>{const s=start();s.element('settings-open').onclick();assert.equal(s.element('settings').open,true);s.element('settings-close').onclick();assert.equal(s.element('settings').open,false);});

function ready(s) {const ws=s.sockets[0];ws.readyState=1;ws.onopen();ws.onmessage({data:'ready:linux'});return ws;}
const packets=ws=>ws.sent.filter(v=>typeof v!=='string').map(v=>[...new Uint8Array(v)]);
function touch(s,type,points,ended=[]) {if(type==='touchstart')s.documentHandlers.touchstart();const point=([clientX,clientY],identifier)=>({identifier,clientX,clientY,target:s.element('pad')});s.element('pad').handlers[type]({preventDefault(){},target:s.element('pad'),touches:points.map(point),changedTouches:ended.map(point)});}
test('Super hold then two-finger resize sends modifier before button and movement',()=>{const s=start(),ws=ready(s);s.element('mod-super').handlers.pointerdown({preventDefault(){},pointerId:1,pointerType:'touch'});touch(s,'touchstart',[[10,10],[30,10]]);touch(s,'touchmove',[[20,20],[40,20]]);touch(s,'touchend',[]);const p=packets(ws);assert.deepEqual(p.slice(0,2),[[9,227],[12]]);assert.equal(p[2][0],1);assert.deepEqual(p[3],[13]);assert.equal(s.element('mod-super').attrs['aria-pressed'],'true');s.element('mod-super').handlers.pointerup({pointerId:1});assert.deepEqual(packets(ws).at(-1),[10,227]);});
test('movement sends immediately and coalesces only rapid subsequent events',()=>{const s=start(),ws=ready(s);touch(s,'touchstart',[[0,0]]);touch(s,'touchmove',[[20,0]]);assert.equal(packets(ws).length,1);touch(s,'touchmove',[[30,0]]);touch(s,'touchmove',[[40,0]]);assert.equal(packets(ws).length,1);[...s.timeouts.values()].at(-1)();assert.equal(packets(ws).length,2);const b=new DataView(ws.sent.at(-1));assert.equal(b.getFloat32(1,true),28);});
const motionTotal=(ws,opcode=1)=>packets(ws).filter(p=>p[0]===opcode).reduce((sum,p)=>{
 const view=new DataView(Uint8Array.from(p).buffer);return [sum[0]+view.getFloat32(1,true),sum[1]+view.getFloat32(5,true)];
},[0,0]);
test('cursor updates follow 60–240 Hz touch input without adding another frame of delay',()=>{
 for(const hz of [60,90,120,144,240]){
  const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);
  for(let i=1;i<=hz;i++){
   const time=i*1000/hz;s.advance(time);touch(s,'touchmove',[[100+i*3,100+i]]);
   assert.equal(packets(ws).length,i,`${hz} Hz sample ${i} must send immediately`);
   assert.equal(ws.sentAt.at(-1),time);
  }
  touch(s,'touchend',[]);assert(packets(ws).every(p=>p[0]===1));
  assert(Math.abs(motionTotal(ws)[0]-hz*3*1.4)<.001);
  const before=packets(ws).length;s.advance(1200);assert.equal(packets(ws).length,before);
  assert.equal(s.frames.size,0,'Cursor motion must not have an animation or inertia loop');
 }
});
test('very high sampling stays below the receiver rate limit and preserves distance',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);
 for(let i=1;i<=1000;i++){s.advance(i);touch(s,'touchmove',[[100+i*3,100]]);}
 assert(packets(ws).length>=240&&packets(ws).length<=251);
 const times=ws.sentAt.slice(1);for(let i=1;i<times.length;i++)assert(times[i]-times[i-1]>=4);
 touch(s,'touchend',[]);assert(Math.abs(motionTotal(ws)[0]-4200)<.001);assert.equal(s.timeouts.size,0);
});
test('new strokes start immediately and overdue timers cannot hold fresh movement',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);touch(s,'touchmove',[[110,100]]);
 s.setTime(1);touch(s,'touchmove',[[112,100]]);assert.equal(packets(ws).length,1);
 s.setTime(6);touch(s,'touchmove',[[114,100]]);assert.equal(packets(ws).length,2);
 assert.equal(s.timeouts.size,1,'Only the hold timer remains');
 touch(s,'touchend',[]);s.setTime(7);touch(s,'touchstart',[[200,100]]);touch(s,'touchmove',[[210,100]]);
 assert.equal(packets(ws).length,3);assert.equal(ws.sentAt.at(-1),7);touch(s,'touchend',[]);
 assert(packets(ws).every(p=>p[0]===1));assert.equal(s.timeouts.size,0);
});
test('small corrections and landing jitter remain distinct through the wire',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);touch(s,'touchmove',[[105,100]]);
 s.advance(450);touch(s,'touchend',[]);assert.deepEqual(packets(ws).map(p=>p[0]),[1]);
 touch(s,'touchstart',[[200,200]]);touch(s,'touchmove',[[201,201]]);touch(s,'touchend',[]);
 assert.deepEqual(packets(ws).map(p=>p[0]),[1,3]);
});
test('the last touchend position reaches the cursor before a drag releases',()=>{
 for(const drag of [false,true]){
  const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);
  if(drag)s.advance(400);
  touch(s,'touchmove',[[110,105]]);touch(s,'touchend',[],[[115,108]]);
  const total=motionTotal(ws);assert(Math.abs(total[0]-21)<1e-6);assert(Math.abs(total[1]-11.2)<1e-6);
  const codes=packets(ws).map(p=>p[0]);assert.deepEqual(codes,drag?[5,1,1,6]:[1,1]);
  assert.equal(s.timeouts.size,0);assert.equal(s.frames.size,0);
 }
});
test('movement reported only on touchend is preserved without an accidental click',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);touch(s,'touchend',[],[[105,100]]);
 assert.deepEqual(packets(ws).map(p=>p[0]),[1]);assert.equal(motionTotal(ws)[0],7);
});
test('a stale touchend after cancellation cannot replay final movement',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);touch(s,'touchmove',[[110,100]]);
 s.element('pad').handlers.touchcancel();const before=packets(ws).length;
 touch(s,'touchend',[],[[150,100]]);s.advance(500);assert.equal(packets(ws).length,before);
});
test('final pinch movement is sent before lifting native contacts',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100],[200,100]]);
 touch(s,'touchmove',[[90,100],[210,100]]);touch(s,'touchend',[],[[80,100],[220,100]]);
 assert.deepEqual(packets(ws).map(p=>p[0]),[15,15,16]);
 assert(Math.abs(new DataView(ws.sent.at(-2)).getFloat32(1,true)-1.4)<1e-6);
});
test('both scrolling surfaces preserve the final release position',()=>{
 for(const strip of [true,false]){
  const s=start(),ws=ready(s),send=strip?stripTouch:touch,points=y=>strip?[[350,y]]:[[100,y],[200,y]];
  send(s,'touchstart',points(100));s.advance(16);send(s,'touchmove',points(120));
  s.advance(32);send(s,'touchend',[],points(130));assert.equal(motionTotal(ws,2)[1],-30);
 }
});
const tapKey=(s,key,area='keyboard',shift=false)=>s.element(area).handlers.click({target:{closest:()=>({dataset:{key:String(key),shift:String(shift)},closest:selector=>selector==='#native-tools'&&area==='native-tools'})}});
test('tap drag flushes all selected-text motion before button release',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);touch(s,'touchend',[]);
 touch(s,'touchstart',[[100,100]]);touch(s,'touchmove',[[120,110]]);
 assert.equal(s.element('drag-state').hidden,false);
 touch(s,'touchmove',[[130,130]]);touch(s,'touchmove',[[140,150]]);touch(s,'touchend',[]);
 const p=packets(ws);assert.deepEqual(p.map(p=>p[0]),[3,5,1,1,6]);
 const motion=p.filter(p=>p[0]===1).map(p=>new DataView(Uint8Array.from(p).buffer));
 assert.equal(motion.reduce((sum,p)=>sum+p.getFloat32(1,true),0),56);
 assert.equal(motion.reduce((sum,p)=>sum+p.getFloat32(5,true),0),70);
 assert.equal(s.element('drag-state').hidden,true);assert.equal(s.timeouts.size,0);
});
test('touch cancellation releases tap drag and clears its pending follow-up',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);touch(s,'touchend',[]);
 touch(s,'touchstart',[[100,100]]);touch(s,'touchmove',[[120,100]]);
 s.element('pad').handlers.touchcancel();touch(s,'touchend',[]);
 assert.deepEqual(packets(ws).map(p=>p[0]),[3,5,1,6,7]);
 touch(s,'touchstart',[[100,100]]);touch(s,'touchmove',[[120,100]]);touch(s,'touchend',[]);
 assert.equal(packets(ws).at(-1)[0],1);assert.equal(s.element('drag-state').hidden,true);
});
test('keyboard modifiers apply once, without holding remote keys between taps',()=>{
 const s=start(),ws=ready(s);s.element('mod-ctrl').onclick();
 assert.deepEqual(packets(ws),[]);assert.equal(s.element('keyboard').hidden,false);
 tapKey(s,6);assert.deepEqual(packets(ws),[[9,224],[11,6],[10,224]]);
 assert.equal(s.element('mod-ctrl').attrs['aria-pressed'],'false');
 tapKey(s,6);assert.deepEqual(packets(ws).at(-1),[11,6]);
});
const holdSuper=(s,id='key-super',pointerId=1)=>s.element(id).handlers.pointerdown({preventDefault(){},pointerId,pointerType:'touch'});
const liftSuper=(s,id='key-super',pointerId=1)=>s.element(id).handlers.pointerup({pointerId});
test('keyboard Super stays held across shortcuts and releases on lift',()=>{
 const s=start(),ws=ready(s);holdSuper(s);s.element('mod-shift').onclick();
 assert.deepEqual(packets(ws),[[9,227]]);assert.equal(s.element('mod-super').attrs['aria-pressed'],'true');
 assert.equal(s.element('shortcut-help').textContent,'Super held + Shift · tap a key');
 tapKey(s,32);assert.deepEqual(packets(ws),[[9,227],[9,225],[11,32],[10,225]]);
 assert.equal(s.element('key-super').attrs['aria-pressed'],'true');assert.equal(s.element('mod-shift').attrs['aria-pressed'],'false');
 tapKey(s,40,'special-keys');assert.deepEqual(packets(ws).at(-1),[11,40]);
 liftSuper(s);assert.deepEqual(packets(ws).at(-1),[10,227]);
 assert.equal(s.element('key-super').attrs['aria-pressed'],'false');
 tapKey(s,6);assert.deepEqual(packets(ws).at(-1),[11,6]);
});
test('keyboard Super preserves modifiers selected before holding it',()=>{
 const s=start(),ws=ready(s);s.element('mod-ctrl').onclick();s.element('mod-alt').onclick();holdSuper(s);
 tapKey(s,40,'special-keys');liftSuper(s);
 assert.deepEqual(packets(ws),[[9,227],[9,224],[9,226],[11,40],[10,226],[10,224],[10,227]]);
});
for (const end of ['pointerup','pointercancel','lostpointercapture']) test(`keyboard Super releases on ${end} without a shortcut`,()=>{
 const s=start(),ws=ready(s);holdSuper(s);s.element('key-super').handlers[end]({pointerId:1});
 assert.deepEqual(packets(ws),[[9,227],[10,227]]);
 assert.equal(s.element('key-super').attrs['aria-pressed'],'false');
});
test('both Super controls share a hold until the last finger lifts',()=>{
 const s=start(),ws=ready(s);holdSuper(s);holdSuper(s,'mod-super',2);liftSuper(s);
 s.element('key-super').handlers.lostpointercapture({pointerId:1});
 assert.deepEqual(packets(ws),[[9,227]]);assert.equal(s.element('key-super').attrs['aria-pressed'],'true');
 liftSuper(s,'mod-super',2);assert.deepEqual(packets(ws),[[9,227],[10,227]]);
});
for (const key of [' ','Enter']) test(`keyboard Super supports holding ${JSON.stringify(key)} and releases on blur`,()=>{
 const s=start(),ws=ready(s),button=s.element('key-super');
 button.handlers.keydown({key,preventDefault(){}});button.handlers.keydown({key,repeat:true,preventDefault(){}});
 tapKey(s,40,'special-keys');button.handlers.keyup({key,preventDefault(){}});
 assert.deepEqual(packets(ws),[[9,227],[11,40],[10,227]]);
 button.handlers.keydown({key,preventDefault(){}});button.handlers.blur();
 assert.deepEqual(packets(ws).slice(-2),[[9,227],[10,227]]);
});
for (const target of ['keyboard-close','settings-open','disconnect']) test(`${target} releases held Super and clears pending shortcuts`,()=>{
 const s=start(),ws=ready(s);holdSuper(s);s.element('mod-alt').onclick();s.element(target).onclick({detail:0});
 assert.deepEqual(packets(ws).at(-1),[7]);
 assert.equal(s.element('key-super').attrs['aria-pressed'],'false');assert.equal(s.element('mod-alt').attrs['aria-pressed'],'false');
});
test('lost connection discards held Super and pending shortcuts before reconnecting',()=>{
 const s=start(),ws=ready(s);holdSuper(s);s.element('mod-alt').onclick();ws.readyState=3;ws.onclose();
 assert.equal(s.element('key-super').attrs['aria-pressed'],'false');assert.equal(s.element('mod-alt').attrs['aria-pressed'],'false');
 assert.deepEqual(packets(ws),[[9,227]]);
});
test('touchpad Super clears a pending keyboard shortcut and releases normally',()=>{
 const s=start(),ws=ready(s);s.element('mod-shift').onclick();holdSuper(s,'mod-super');
 assert.equal(s.element('key-super').attrs['aria-pressed'],'true');assert.equal(s.element('mod-shift').attrs['aria-pressed'],'false');
 liftSuper(s,'mod-super');assert.deepEqual(packets(ws),[[9,227],[10,227]]);
});
test('three-finger tap never latches Super',()=>{const s=start(),ws=ready(s);touch(s,'touchstart',[[0,0],[20,0],[40,0]]);touch(s,'touchend',[]);assert.deepEqual(packets(ws),[]);});
test('Super release during resize releases the button before the modifier',()=>{const s=start(),ws=ready(s);const button=s.element('mod-super');button.handlers.pointerdown({preventDefault(){},pointerId:1});touch(s,'touchstart',[[0,0],[20,0]]);touch(s,'touchmove',[[10,10],[30,10]]);button.handlers.pointercancel({pointerId:1});assert.deepEqual(packets(ws).slice(-2),[[13],[10,227]]);touch(s,'touchmove',[[20,20],[40,20]]);touch(s,'touchend',[]);assert.deepEqual(packets(ws).slice(-2),[[13],[10,227]]);assert.equal(button.attrs['aria-pressed'],'false');});
test('native realtime typing sends text and local deletion sends Backspace',()=>{const s=start(),ws=ready(s),input=s.element('native-input');input.value='Hi!';input.handlers.input();assert.deepEqual(packets(ws).at(-1),[14,72,105,33]);input.value='Hi';input.handlers.input();assert.deepEqual(packets(ws).at(-1),[11,42]);});
test('native input rejects unsupported text without sending a partial word',()=>{const s=start(),ws=ready(s),input=s.element('native-input');input.value='Hello 日本';input.handlers.input();assert.deepEqual(packets(ws),[]);assert.match(s.element('typing-help').textContent,/US keyboard/);});
test('composition is sent once after commit',()=>{const s=start(),ws=ready(s),input=s.element('native-input');input.handlers.compositionstart();input.value='test';input.handlers.input();assert.deepEqual(packets(ws),[]);input.handlers.compositionend();input.handlers.input();assert.deepEqual(packets(ws),[[14,116,101,115,116]]);});
test('accessory navigation waits for composition and does not erase the uncommitted input',()=>{
 const s=start(),ws=ready(s),input=s.element('native-input');
 input.handlers.compositionstart();input.value='test';input.handlers.input();tapKey(s,40,'native-tools');
 assert.deepEqual(packets(ws),[]);assert.equal(input.value,'test');
 input.handlers.compositionend();tapKey(s,40,'native-tools');
 assert.deepEqual(packets(ws),[[14,116,101,115,116],[11,40]]);
});
test('accessory navigation stays ordered after queued text and subsequent typing starts fresh',()=>{
 const s=start(),ws=ready(s),input=s.element('native-input');
 input.value='a'.repeat(240);input.handlers.input();tapKey(s,80,'native-tools');
 input.value='x';input.handlers.input();
 while(s.timeouts.size) {const [id,fn]=s.timeouts.entries().next().value;s.timeouts.delete(id);fn();}
 assert.deepEqual(packets(ws),[[14,...Array(120).fill(97)],[14,...Array(120).fill(97)],[11,80],[14,120]]);
});
test('phone keyboard mode focuses the field and sends text immediately',()=>{const s=start(),ws=ready(s);s.element('native-mode').onclick();const input=s.element('native-input');input.value='Hello';input.handlers.input();assert.deepEqual(packets(ws).at(-1),[14,72,101,108,108,111]);});
test('native focus releases modifiers before plain typing',()=>{const s=start(),ws=ready(s);holdSuper(s);s.element('mod-ctrl').onclick();s.element('native-input').focus();assert.equal(s.element('key-super').attrs['aria-pressed'],'false');assert.deepEqual(packets(ws).at(-1),[7]);assert.equal(s.element('mod-ctrl').attrs['aria-pressed'],'false');});

test('pinch sends absolute native scale and flushes its final sample before ending',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100],[200,100]]);
 touch(s,'touchmove',[[80,100],[220,100]]);touch(s,'touchmove',[[70,100],[230,100]]);touch(s,'touchend',[[230,100]]);touch(s,'touchend',[]);
 const p=packets(ws);assert.deepEqual(p.map(x=>x[0]),[15,15,16]);
 assert(Math.abs(new DataView(ws.sent[1]).getFloat32(1,true)-1.4)<1e-6);
 assert(Math.abs(new DataView(ws.sent[2]).getFloat32(1,true)-1.6)<1e-6);
});
test('armed keyboard modifiers do not modify touchpad gestures or natural scroll preference',()=>{
 const s=start(),ws=ready(s);s.element('mod-ctrl').onclick();s.element('natural').checked=false;
 touch(s,'touchstart',[[100,100],[200,100]]);touch(s,'touchmove',[[80,100],[220,100]]);touch(s,'touchend',[]);
 assert.deepEqual(packets(ws).map(x=>x[0]),[15,16]);assert(Math.abs(new DataView(ws.sent[1]).getFloat32(1,true)-1.4)<1e-6);
 assert.equal(s.element('mod-ctrl').attrs['aria-pressed'],'true');
});
test('canceled pinch ends native contacts without touching keyboard modifiers',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100],[200,100]]);touch(s,'touchmove',[[80,100],[220,100]]);
 s.element('pad').handlers.touchcancel();assert.deepEqual(packets(ws).slice(-2),[[16],[7]]);
});

test('RC interrupts an active surface gesture without a second tap',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100]]);s.element('right-click').onclick();
 touch(s,'touchmove',[[120,100]]);touch(s,'touchend',[]);assert.deepEqual(packets(ws),[[4]]);
});

test('initial pinch drift sends only native zoom packets, with no wheel scroll',()=>{
 const s=start(),ws=ready(s);touch(s,'touchstart',[[100,100],[200,100]]);
 touch(s,'touchmove',[[100,108],[200,108]]);assert.deepEqual(packets(ws),[]);
 touch(s,'touchmove',[[90,108],[210,108]]);touch(s,'touchmove',[[80,130],[220,130]]);touch(s,'touchend',[]);
 assert.deepEqual(packets(ws).map(p=>p[0]),[15,15,16]);
});

function stripTouch(s,type,points,ended=[]) {
 if(type==='touchstart')s.documentHandlers.touchstart();
 const target=s.element('scroll-zone');target.closest=selector=>selector==='#scroll-zone'?target:null;
 const point=([clientX,clientY],identifier)=>({identifier,clientX,clientY,target});
 s.element('pad').handlers[type]({preventDefault(){},target,touches:points.map(point),changedTouches:ended.map(point)});
}
test('one-finger strip scrolling matches two-finger scroll packets in both axes',()=>{
 const a=start(),aw=ready(a),b=start(),bw=ready(b);
 stripTouch(a,'touchstart',[[350,100]]);stripTouch(a,'touchmove',[[355,140]]);stripTouch(a,'touchend',[]);
 touch(b,'touchstart',[[100,100],[200,100]]);touch(b,'touchmove',[[105,140],[205,140]]);touch(b,'touchend',[]);
 assert.deepEqual(packets(aw),packets(bw));assert.deepEqual(packets(aw).map(p=>p[0]),[2]);
});
test('strip uses natural scrolling and scroll speed independently of pointer sensitivity',()=>{
 const s=start(),ws=ready(s);s.element('natural').checked=false;s.element('sensitivity').value='3';
 s.element('scroll-presets').handlers.click({target:{closest:()=>({dataset:{speed:'1.6'}})}});
 stripTouch(s,'touchstart',[[350,100]]);stripTouch(s,'touchmove',[[360,125]]);stripTouch(s,'touchend',[]);
 const p=new DataView(ws.sent.at(-1));assert.equal(p.getUint8(0),2);assert.equal(p.getFloat32(1,true),16);assert.equal(p.getFloat32(5,true),40);
});
test('tapping or holding the strip never clicks or begins a drag',()=>{
 const s=start(),ws=ready(s);stripTouch(s,'touchstart',[[350,100]]);stripTouch(s,'touchmove',[[350,103]]);
 assert.equal(s.timeouts.size,0);stripTouch(s,'touchend',[]);assert.deepEqual(packets(ws),[]);
});
test('strip flushes accumulated movement on lift without a trailing click',()=>{
 const s=start(),ws=ready(s);stripTouch(s,'touchstart',[[350,100]]);stripTouch(s,'touchmove',[[350,120]]);
 stripTouch(s,'touchmove',[[350,140]]);stripTouch(s,'touchmove',[[350,160]]);stripTouch(s,'touchend',[]);
 assert.deepEqual(packets(ws).map(p=>p[0]),[2,2]);assert.equal(new DataView(ws.sent.at(-1)).getFloat32(5,true),-40);
 assert.equal(s.timeouts.size,0);
});
test('adding a finger stops strip scrolling until all fingers lift',()=>{
 const s=start(),ws=ready(s);stripTouch(s,'touchstart',[[350,100]]);stripTouch(s,'touchmove',[[350,120]]);
 stripTouch(s,'touchstart',[[350,120],[350,160]]);stripTouch(s,'touchmove',[[350,140],[350,180]]);
 stripTouch(s,'touchend',[[350,140]]);stripTouch(s,'touchmove',[[350,160]]);stripTouch(s,'touchend',[]);
 assert.deepEqual(packets(ws).map(p=>p[0]),[2]);
 touch(s,'touchstart',[[100,100]]);touch(s,'touchend',[]);assert.deepEqual(packets(ws).at(-1),[3]);
});
test('canceled strip scrolling discards pending motion and releases input',()=>{
 const s=start(),ws=ready(s);stripTouch(s,'touchstart',[[350,100]]);stripTouch(s,'touchmove',[[350,120]]);stripTouch(s,'touchmove',[[350,140]]);
 s.element('pad').handlers.touchcancel();assert.deepEqual(packets(ws).map(p=>p[0]),[2,7]);assert.equal(s.timeouts.size,0);
});

function scrollFlick(s,strip=true,release=true) {
 const send=strip?stripTouch:touch,points=y=>strip?[[350,y]]:[[100,y],[200,y]];
 send(s,'touchstart',points(100));
 for(let time=16;time<=64;time+=16){s.setTime(time);send(s,'touchmove',points(100+time));}
 s.setTime(65);if(release)send(s,'touchend',[]);
}
test('strip and two-finger flicks send matching momentum after release and then stop',()=>{
 const a=start(),aw=ready(a),b=start(),bw=ready(b);scrollFlick(a);scrollFlick(b,false);
 const before=packets(aw).length;
 for(let time=81;time<2065;time+=16){a.frameAt(time);b.frameAt(time);}
 assert.deepEqual(packets(aw),packets(bw));assert(packets(aw).length>before+10);
 assert(packets(aw).every(p=>p[0]===2));assert.equal(a.frames.size,0);assert.equal(a.timeouts.size,0);
 const after=packets(aw).length;a.frameAt(3000);assert.equal(packets(aw).length,after);
});
test('momentum respects natural scrolling and speed, independently of pointer sensitivity',()=>{
 const a=start(),aw=ready(a),b=start(),bw=ready(b);
 b.element('natural').checked=false;b.element('sensitivity').value='3';b.element('sensitivity').oninput();
 b.element('scroll-presets').handlers.click({target:{closest:()=>({dataset:{speed:'1.6'}})}});
 scrollFlick(a);scrollFlick(b);a.frameAt(81);b.frameAt(81);
 const dy=ws=>new DataView(ws.sent.at(-1)).getFloat32(5,true);
 assert(Math.abs(dy(bw)/dy(aw)+1.6)<1e-6);
});
test('a new strip touch brakes queued momentum without a click',()=>{
 const s=start(),ws=ready(s);scrollFlick(s);s.frameAt(81);s.frameAt(85);
 assert.equal(s.timeouts.size,1,'A fast frame has an unsent scroll delta');
 const before=packets(ws).length;stripTouch(s,'touchstart',[[350,250]]);
 assert.equal(s.timeouts.size,0);assert.equal(s.frames.size,0);
 s.frameAt(101);stripTouch(s,'touchend',[]);s.frameAt(117);
 assert.equal(packets(ws).length,before);
});
for(const stop of ['touchcancel','settings','keyboard','disconnect','socket','pagehide','hidden','blur','pointerdown','keydown']) test(`${stop} cancels momentum without later scroll packets`,()=>{
 const s=start(),ws=ready(s);scrollFlick(s);s.frameAt(81);
 if(stop==='touchcancel')s.element('pad').handlers.touchcancel();
 else if(stop==='settings')s.element('settings-open').onclick();
 else if(stop==='keyboard')s.element('keyboard-toggle').onclick({detail:0});
 else if(stop==='disconnect')s.element('disconnect').onclick();
 else if(stop==='socket'){ws.readyState=3;ws.onclose();}
 else if(stop==='hidden'){s.document.hidden=true;s.documentHandlers.visibilitychange();}
 else if(stop==='pagehide'||stop==='blur')s.windowHandlers[stop]();
 else s.documentHandlers[stop]();
 assert.equal(s.frames.size,0);
 const before=packets(ws).length;s.frameAt(97);s.frameAt(113);assert.equal(packets(ws).length,before);
});
test('a stationary release and an interrupted strip gesture never launch momentum',()=>{
 for(const interrupted of [false,true]){
  const s=start(),ws=ready(s);scrollFlick(s,true,false);
  if(interrupted){stripTouch(s,'touchstart',[[350,164],[350,200]]);stripTouch(s,'touchend',[[350,164]]);}
  else s.setTime(200);
  stripTouch(s,'touchend',[]);const before=packets(ws).length;s.frameAt(216);
  assert.equal(s.frames.size,0);assert.equal(packets(ws).length,before);
 }
});
test('staggered two-finger release waits for both fingers before coasting',()=>{
 const s=start(),ws=ready(s);scrollFlick(s,false,false);
 touch(s,'touchend',[[200,164]]);assert.equal(s.frames.size,0);
 s.setTime(70);touch(s,'touchend',[]);assert.equal(s.frames.size,1);
 const before=packets(ws).length;s.frameAt(86);assert(packets(ws).length>before);
});
test('dedicated plus sends Shift and equals, then leaves equals unmodified',()=>{
 const s=start(),ws=ready(s);tapKey(s,46,'keyboard',true);tapKey(s,46);
 assert.deepEqual(packets(ws),[[9,225],[11,46],[10,225],[11,46]]);
});
test('plus combines with Ctrl and deduplicates an armed Shift',()=>{
 const s=start(),ws=ready(s);s.element('mod-ctrl').onclick();s.element('mod-shift').onclick();tapKey(s,46,'keyboard',true);
 assert.deepEqual(packets(ws),[[9,224],[9,225],[11,46],[10,225],[10,224]]);
 assert.equal(s.element('mod-shift').attrs['aria-pressed'],'false');assert.equal(s.element('mod-ctrl').attrs['aria-pressed'],'false');
});
test('plus preserves held Super until the finger lifts',()=>{
 const s=start(),ws=ready(s);holdSuper(s);tapKey(s,46,'keyboard',true);
 assert.deepEqual(packets(ws),[[9,227],[9,225],[11,46],[10,225]]);
 assert.equal(s.element('key-super').attrs['aria-pressed'],'true');liftSuper(s);assert.deepEqual(packets(ws).at(-1),[10,227]);
});

for (const end of ['pointerup','pointercancel','lostpointercapture']) test(`pad fill follows Super and clears on ${end}`,()=>{
 const s=start();ready(s);
 s.element('mod-super').handlers.pointerdown({preventDefault(){},pointerId:1,pointerType:'touch',clientX:50,clientY:700});
 assert.equal(s.fillEvents.at(-1).active,true);
 assert.equal(s.fillEvents.at(-1).x,50);assert.equal(s.fillEvents.at(-1).y,700);
 s.element('mod-super').handlers[end]({pointerId:1});
 assert.equal(s.fillEvents.at(-1).active,false);
});
test('keyboard Super alone never starts the pad fill, including after a pad hold',()=>{
 const s=start();ready(s);holdSuper(s);assert.equal(s.fillEvents.at(-1).active,false);
 holdSuper(s,'mod-super',2);assert.equal(s.fillEvents.at(-1).active,true);
 liftSuper(s,'mod-super',2);assert.equal(s.fillEvents.at(-1).active,false);
 assert.equal(s.element('key-super').attrs['aria-pressed'],'true');
});
for (const target of ['keyboard-toggle','settings-open','disconnect']) test(`${target} clears the pad fill`,()=>{
 const s=start();ready(s);holdSuper(s,'mod-super');s.element(target).onclick({detail:0});
 assert.equal(s.fillEvents.at(-1).active,false);
});
test('disconnect clears the pad fill without replaying it after reconnect',()=>{
 const s=start(),ws=ready(s);holdSuper(s,'mod-super');ws.readyState=3;ws.onclose();
 assert.equal(s.fillEvents.at(-1).active,false);
});

for (const source of ['slider','preset']) test(`${source} updates pointer speed before the next gesture`,()=>{
 const s=start(),ws=ready(s);
 if(source==='slider') {s.element('sensitivity').value='2';s.element('sensitivity').oninput();}
 else s.element('tracking-presets').handlers.click({target:{closest:()=>({dataset:{speed:'2'}})}});
 touch(s,'touchstart',[[100,100]]);touch(s,'touchmove',[[120,110]]);touch(s,'touchend',[]);
 const view=new DataView(ws.sent.find(p=>typeof p!=='string'&&new Uint8Array(p)[0]===1));
 assert.equal(view.getFloat32(1,true),40);assert.equal(view.getFloat32(5,true),20);
});

function heldKey(s, usage, area='native-tools') {
 const button={dataset:{key:String(usage),hold:''},classList:{toggle(){}},setPointerCapture(){},closest:selector=>selector==='#native-tools'?(area==='native-tools'?s.element(area):null):button};
 const event={target:button,preventDefault(){},pointerId:17,pointerType:'touch',button:0};
 return {button,event,send:(type,extra={})=>s.element(area).handlers[type]({...event,...extra})};
}
for(const usage of [40,41,42,43,44,74,76,79,80,81,82]) test(`key ${usage} presses immediately, stays held, and lifts exactly once`,()=>{
 const s=start(),ws=ready(s),key=heldKey(s,usage);
 key.send('pointerdown');assert.deepEqual(packets(ws),[[9,usage]]);
 s.advance(2000);assert.deepEqual(packets(ws),[[9,usage]],'Repeat belongs to the desktop, with no browser timer');
 key.send('pointerup');key.send('lostpointercapture');key.send('click',{detail:1});
 assert.deepEqual(packets(ws),[[9,usage],[10,usage]]);
 key.send('click',{detail:0});assert.deepEqual(packets(ws).at(-1),[11,usage],'Accessible click remains a single tap');
});
for(const end of ['pointercancel','lostpointercapture','touchcancel','keyboard-close','settings-open','disconnect','blur','hidden','pagehide','grid-mode']) test(`${end} releases a held essential key without replay`,()=>{
 const s=start(),ws=ready(s),key=heldKey(s,42);key.send('pointerdown');
 if(['pointercancel','lostpointercapture','touchcancel'].includes(end))key.send(end);
 else if(['blur','pagehide'].includes(end))s.windowHandlers[end]();
 else if(end==='hidden'){s.document.hidden=true;s.documentHandlers.visibilitychange();}
 else s.element(end).onclick();
 assert.deepEqual(packets(ws).slice(0,2),[[9,42],[10,42]]);
 const count=packets(ws).length;key.send('pointerup');s.advance(2000);assert.equal(packets(ws).length,count);
});
test('connection loss discards held keys and late lifts cannot reach the new session',()=>{
 const s=start(),ws=ready(s),key=heldKey(s,44);key.send('pointerdown');ws.readyState=3;ws.onclose();
 s.advance(1000);const next=s.sockets.at(-1);next.readyState=1;next.onopen();next.onmessage({data:'ready:linux'});
 key.send('pointerup');assert.deepEqual(packets(next),[]);
 key.send('pointerdown');key.send('pointerup');assert.deepEqual(packets(next),[[9,44],[10,44]]);
});
test('held arrows retain one-shot modifiers and coexist with Super and other shortcuts',()=>{
 const s=start(),ws=ready(s),key=heldKey(s,79,'special-keys');holdSuper(s);s.element('mod-shift').onclick();key.send('pointerdown');
 assert.deepEqual(packets(ws),[[9,227],[9,225],[9,79]]);
 tapKey(s,46,'keyboard',true);assert.deepEqual(packets(ws).slice(3),[[11,46]],'Plus must not lift the Shift held by the arrow');
 key.send('pointerup');assert.deepEqual(packets(ws).slice(-2),[[10,79],[10,225]]);liftSuper(s);assert.deepEqual(packets(ws).at(-1),[10,227]);
});
test('two fingers on the same key release only after the last finger lifts',()=>{
 const s=start(),ws=ready(s),key=heldKey(s,44);key.send('pointerdown');key.send('pointerdown',{pointerId:18});
 key.send('pointerup');assert.deepEqual(packets(ws),[[9,44]]);
 key.send('pointerup',{pointerId:18});assert.deepEqual(packets(ws),[[9,44],[10,44]]);
});
for(const activation of [' ','Enter']) test(`keyboard ${JSON.stringify(activation)} activation holds an essential key until keyup or focus loss`,()=>{
 const s=start(),ws=ready(s),key=heldKey(s,80);key.send('keydown',{key:activation});key.send('keydown',{key:activation,repeat:true});
 assert.deepEqual(packets(ws),[[9,80]]);key.send('keyup',{key:activation});assert.deepEqual(packets(ws).at(-1),[10,80]);
 key.send('keydown',{key:activation});key.send('focusout');assert.deepEqual(packets(ws).slice(-2),[[9,80],[10,80]]);
});
test('native typing releases an accessory hold before sending text or deleting an empty context',()=>{
 for(const empty of [false,true]){
  const s=start(),ws=ready(s),key=heldKey(s,80),input=s.element('native-input');key.send('pointerdown');
  if(empty)input.handlers.beforeinput({inputType:'deleteContentBackward',preventDefault(){}});
  else {input.value='x';input.handlers.input();}
  assert.deepEqual(packets(ws),[[9,80],[10,80],empty?[11,42]:[14,120]]);key.send('pointerup');assert.equal(packets(ws).length,3);
 }
});
test('composition and queued edits cannot be overtaken by held navigation',()=>{
 for(const composing of [false,true]){
  const s=start(),ws=ready(s),key=heldKey(s,80),input=s.element('native-input');
  if(composing)input.handlers.compositionstart();input.value='a'.repeat(240);input.handlers.input();
  key.send('pointerdown');key.send('pointerup');s.advance(100);
  assert(packets(ws).every(p=>p[0]===14));assert.equal(input.value,'a'.repeat(240));
  if(!composing)assert.match(s.element('typing-help').textContent,/wait/);
 }
});

function rightZoneTouch(s,type,points) {
 const touches=points.map(([clientX,clientY],identifier)=>({identifier,clientX,clientY}));
 let prevented=false;
 s.element('right-click').handlers[type]({targetTouches:touches,changedTouches:touches,preventDefault(){prevented=true;}});
 assert(prevented,'Native compatibility clicks must be suppressed');
}
test('right corner taps send once per lift without relying on native clicks',()=>{
 const s=start(),ws=ready(s);
 for(let i=0;i<2;i++) {rightZoneTouch(s,'touchstart',[[350,600]]);rightZoneTouch(s,'touchend',[[352,601]]);}
 assert.deepEqual(packets(ws),[[4],[4]]);
});
for(const mode of ['move','release','multitouch','cancel','blur']) test(`right corner ${mode} cannot produce an accidental click`,()=>{
 const s=start(),ws=ready(s);rightZoneTouch(s,'touchstart',[[350,600]]);
 if(mode==='move')rightZoneTouch(s,'touchmove',[[320,600]]);
 if(mode==='multitouch')rightZoneTouch(s,'touchstart',[[350,600],[355,650]]);
 if(mode==='cancel')s.element('pad').handlers.touchcancel();
 if(mode==='blur')s.windowHandlers.blur();
 rightZoneTouch(s,'touchend',[[mode==='release'?320:350,600]]);
 assert(!packets(ws).some(p=>p[0]===4));
});


test('negotiated flow bounds delayed touch input and delivers final drag motion before release',()=>{
 const s=start({flow:true}),ws=ready(s);
 touch(s,'touchstart',[[100,100]]);s.advance(400);
 for(let i=1;i<=40;i++){s.advance(400+i*4);touch(s,'touchmove',[[100+i,100]]);}
 touch(s,'touchend',[]);
 const p=packets(ws);assert(p.every(b=>b[0]===17));assert(p.length<=8);
 const inner=p.map(b=>b.slice(3));assert.equal(inner[0][0],5);assert.equal(inner.at(-1)[0],6);
 const total=inner.filter(b=>b[0]===1).reduce((n,b)=>n+new DataView(Uint8Array.from(b).buffer).getFloat32(1,true),0);
 assert(Math.abs(total-56)<.001);
 for(const bytes of ws.sent.slice(1))ws.onmessage({data:Uint8Array.from(new Uint8Array(bytes).slice(0,3)).buffer});
 assert.equal(s.timeouts.size,0);
});
test('flow timeout reconnects even when close never fires and does not replay input',()=>{
 const s=start({flow:true}),ws=ready(s);touch(s,'touchstart',[[100,100]]);touch(s,'touchmove',[[120,100]]);
 s.advance(2000);assert.equal(ws.readyState,3);assert.equal(s.element('status').textContent,'Reconnecting');
 s.advance(3000);const next=s.sockets.at(-1);assert.notEqual(next,ws);next.readyState=1;next.onopen();next.onmessage({data:'ready:linux'});
 touch(s,'touchend',[],[[200,100]]);assert.deepEqual(packets(next),[]);
});
