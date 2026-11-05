import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const script = readFileSync(new URL('../web/gestures.js',import.meta.url),'utf8').replace('export class Gestures','class Gestures') + '\n' + readFileSync(new URL('../web/text.js',import.meta.url),'utf8').replaceAll('export function','function') + '\n' + readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace("import { Gestures } from './gestures.js';",'').replace("import { textEdit, normalizeText } from './text.js';",'');
function start({key='a'.repeat(64),blocked=false,historyBlocked=false}={}) {
 const elements=new Map(),timeouts=new Map(),stored=new Map(),sockets=[],fillEvents=[];let next=1;
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'',checked:false,hidden:['keyboard-panel','keyboard'].includes(id),open:false,setPointerCapture(){},closest(){return null},contains(){return true},focus(){this.handlers.focus?.()},blur(){},querySelectorAll(){return []},classList:{toggle(){},remove(){}},handlers:{},attrs:{},addEventListener(type,fn){this.handlers[type]=fn},setAttribute(name,value){this.attrs[name]=value;if(name==='open')this.open=true},removeAttribute(name){if(name==='open')this.open=false}});return elements.get(id)};
 class Socket { static OPEN=1;static CLOSED=3;readyState=0;bufferedAmount=0;sent=[];constructor(){if(blocked)throw Error('Blocked');sockets.push(this)}send(value){this.sent.push(value)}close(){this.readyState=3} }
 const window={setTimeout(fn){const id=next++;timeouts.set(id,fn);return id},setInterval(){return next++},addEventListener(){},dispatchEvent(event){if(event.type==='ghostpad-super-fill')fillEvents.push(event.detail)}};
 const context={document:{body:{classList:{toggle(){}}},hidden:false,getElementById:element,addEventListener(){}},window,localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},location:{hash:key?'#key='+key:'',pathname:'/',protocol:'http:',host:'192.168.1.42:8765'},history:{replaceState(){if(historyBlocked)throw Error('Unavailable')}},WebSocket:Socket,URLSearchParams,Event,CustomEvent,performance:{now:()=>0},setTimeout:window.setTimeout,clearTimeout:id=>timeouts.delete(id),clearInterval(){},requestAnimationFrame(){return next++},cancelAnimationFrame(){}};
 runInNewContext(script,context);
 return {element,sockets,timeouts,stored,fillEvents};
}
test('page startup pairs and reaches ready with browser-shaped WebSocket events',()=>{const s=start();const ws=s.sockets[0];ws.readyState=1;ws.onopen();assert.equal(ws.sent[0],'a'.repeat(64));ws.onmessage({data:'ready:linux'});assert.equal(s.element('status').textContent,'Connected');assert.equal(s.timeouts.size,0);});
test('blocked WebSocket displays a visible error instead of throwing',()=>{const s=start({blocked:true});assert.equal(s.element('status').textContent,'Connection blocked');assert.match(s.element('hint').textContent,/Safari/);assert.equal(s.element('reload').hidden,false);});
test('hung upgrade times out and schedules retry even if browser never fires close',()=>{const s=start();const first=s.sockets[0];[...s.timeouts.values()][0]();assert.equal(first.readyState,3);assert.equal(s.element('status').textContent,'Reconnecting');const retry=[...s.timeouts.values()].at(-1);retry();assert.equal(s.sockets.length,2);first.onmessage({data:'ready:linux'});assert.notEqual(s.element('status').textContent,'Connected');});
test('Safari history restriction does not abort startup',()=>{const s=start({historyBlocked:true});assert.equal(s.sockets.length,1);});
test('missing pairing displays connection guidance',()=>{const s=start({key:''});assert.equal(s.sockets.length,0);assert.equal(s.element('status').textContent,'Pair your phone');assert.match(s.element('hint').textContent,/QR code/);});
test('settings open and close when native dialog support is missing',()=>{const s=start();s.element('settings-open').onclick();assert.equal(s.element('settings').open,true);s.element('settings-close').onclick();assert.equal(s.element('settings').open,false);});

function ready(s) {const ws=s.sockets[0];ws.readyState=1;ws.onopen();ws.onmessage({data:'ready:linux'});return ws;}
const packets=ws=>ws.sent.filter(v=>typeof v!=='string').map(v=>[...new Uint8Array(v)]);
function touch(s,type,points) {s.element('pad').handlers[type]({preventDefault(){},target:s.element('pad'),touches:points.map(([clientX,clientY])=>({clientX,clientY,target:s.element('pad')}))});}
test('Super hold then two-finger resize sends modifier before button and movement',()=>{const s=start(),ws=ready(s);s.element('mod-super').handlers.pointerdown({preventDefault(){},pointerId:1,pointerType:'touch'});touch(s,'touchstart',[[10,10],[30,10]]);touch(s,'touchmove',[[20,20],[40,20]]);touch(s,'touchend',[]);const p=packets(ws);assert.deepEqual(p.slice(0,2),[[9,227],[12]]);assert.equal(p[2][0],1);assert.deepEqual(p[3],[13]);assert.equal(s.element('mod-super').attrs['aria-pressed'],'true');s.element('mod-super').handlers.pointerup({pointerId:1});assert.deepEqual(packets(ws).at(-1),[10,227]);});
test('movement sends immediately and coalesces only rapid subsequent events',()=>{const s=start(),ws=ready(s);touch(s,'touchstart',[[0,0]]);touch(s,'touchmove',[[20,0]]);assert.equal(packets(ws).length,1);touch(s,'touchmove',[[30,0]]);touch(s,'touchmove',[[40,0]]);assert.equal(packets(ws).length,1);[...s.timeouts.values()].at(-1)();assert.equal(packets(ws).length,2);const b=new DataView(ws.sent.at(-1));assert.equal(b.getFloat32(1,true),28);});
const tapKey=(s,key,area='keyboard',shift=false)=>s.element(area).handlers.click({target:{closest:()=>({dataset:{key:String(key),shift:String(shift)}})}});
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
 const s=start(),ws=ready(s);holdSuper(s);s.element('mod-alt').onclick();s.element(target).onclick();
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

function stripTouch(s,type,points) {
 const target=s.element('scroll-zone');target.closest=selector=>selector==='#scroll-zone'?target:null;
 s.element('pad').handlers[type]({preventDefault(){},target,touches:points.map(([clientX,clientY],identifier)=>({identifier,clientX,clientY,target}))});
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
 const s=start();ready(s);holdSuper(s,'mod-super');s.element(target).onclick();
 assert.equal(s.fillEvents.at(-1).active,false);
});
test('disconnect clears the pad fill without replaying it after reconnect',()=>{
 const s=start(),ws=ready(s);holdSuper(s,'mod-super');ws.readyState=3;ws.onclose();
 assert.equal(s.fillEvents.at(-1).active,false);
});
