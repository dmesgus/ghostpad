import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const script = readFileSync(new URL('../web/gestures.js',import.meta.url),'utf8').replace('export class Gestures','class Gestures') + '\n' + readFileSync(new URL('../web/text.js',import.meta.url),'utf8').replaceAll('export function','function') + '\n' + readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace("import { Gestures } from './gestures.js';",'').replace("import { textEdit, normalizeText } from './text.js';",'');
function start({key='a'.repeat(64),blocked=false,historyBlocked=false}={}) {
 const elements=new Map(),timeouts=new Map(),stored=new Map(),sockets=[];let next=1;
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'',checked:false,hidden:['keyboard-panel','keyboard'].includes(id),open:false,setPointerCapture(){},closest(){return null},contains(){return true},focus(){this.handlers.focus?.()},blur(){},querySelectorAll(){return []},classList:{toggle(){},remove(){}},handlers:{},attrs:{},addEventListener(type,fn){this.handlers[type]=fn},setAttribute(name,value){this.attrs[name]=value;if(name==='open')this.open=true},removeAttribute(name){if(name==='open')this.open=false}});return elements.get(id)};
 class Socket { static OPEN=1;static CLOSED=3;readyState=0;bufferedAmount=0;sent=[];constructor(){if(blocked)throw Error('Blocked');sockets.push(this)}send(value){this.sent.push(value)}close(){this.readyState=3} }
 const window={setTimeout(fn){const id=next++;timeouts.set(id,fn);return id},setInterval(){return next++},addEventListener(){},dispatchEvent(){}};
 const context={document:{body:{classList:{toggle(){}}},hidden:false,getElementById:element,addEventListener(){}},window,localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},location:{hash:key?'#key='+key:'',pathname:'/',protocol:'http:',host:'192.168.1.42:8765'},history:{replaceState(){if(historyBlocked)throw Error('Unavailable')}},WebSocket:Socket,URLSearchParams,Event,performance:{now:()=>0},setTimeout:window.setTimeout,clearTimeout:id=>timeouts.delete(id),clearInterval(){},requestAnimationFrame(){return next++},cancelAnimationFrame(){}};
 runInNewContext(script,context);
 return {element,sockets,timeouts,stored};
}
test('page startup pairs and reaches ready with browser-shaped WebSocket events',()=>{const s=start();const ws=s.sockets[0];ws.readyState=1;ws.onopen();assert.equal(ws.sent[0],'a'.repeat(64));ws.onmessage({data:'ready:linux'});assert.equal(s.element('status').textContent,'Connected');assert.equal(s.timeouts.size,0);});
test('blocked WebSocket displays a visible error instead of throwing',()=>{const s=start({blocked:true});assert.equal(s.element('status').textContent,'Connection blocked');assert.match(s.element('hint').textContent,/Safari/);assert.equal(s.element('reload').hidden,false);});
test('hung upgrade times out and schedules retry even if browser never fires close',()=>{const s=start();const first=s.sockets[0];[...s.timeouts.values()][0]();assert.equal(first.readyState,3);assert.equal(s.element('status').textContent,'Reconnecting');const retry=[...s.timeouts.values()].at(-1);retry();assert.equal(s.sockets.length,2);first.onmessage({data:'ready:linux'});assert.notEqual(s.element('status').textContent,'Connected');});
test('Safari history restriction does not abort startup',()=>{const s=start({historyBlocked:true});assert.equal(s.sockets.length,1);});
test('missing pairing is visible on the touch surface',()=>{const s=start({key:''});assert.equal(s.sockets.length,0);assert.equal(s.element('status').textContent,'Pair your phone');assert.match(s.element('hint').textContent,/QR code/);});
test('settings open and close when native dialog support is missing',()=>{const s=start();s.element('settings-open').onclick();assert.equal(s.element('settings').open,true);s.element('settings-close').onclick();assert.equal(s.element('settings').open,false);});

function ready(s) {const ws=s.sockets[0];ws.readyState=1;ws.onopen();ws.onmessage({data:'ready:linux'});return ws;}
const packets=ws=>ws.sent.filter(v=>typeof v!=='string').map(v=>[...new Uint8Array(v)]);
function touch(s,type,points) {s.element('pad').handlers[type]({preventDefault(){},target:s.element('pad'),touches:points.map(([clientX,clientY])=>({clientX,clientY,target:s.element('pad')}))});}
test('Super hold then two-finger resize sends modifier before button and movement',()=>{const s=start(),ws=ready(s);s.element('mod-super').handlers.pointerdown({preventDefault(){},pointerId:1,pointerType:'touch'});touch(s,'touchstart',[[10,10],[30,10]]);touch(s,'touchmove',[[20,20],[40,20]]);touch(s,'touchend',[]);const p=packets(ws);assert.deepEqual(p.slice(0,2),[[9,227],[12]]);assert.equal(p[2][0],1);assert.deepEqual(p[3],[13]);assert.equal(s.element('mod-super').attrs['aria-pressed'],'true');s.element('mod-super').handlers.pointerup({pointerId:1});assert.deepEqual(packets(ws).at(-1),[10,227]);});
test('movement sends immediately and coalesces only rapid subsequent events',()=>{const s=start(),ws=ready(s);touch(s,'touchstart',[[0,0]]);touch(s,'touchmove',[[20,0]]);assert.equal(packets(ws).length,1);touch(s,'touchmove',[[30,0]]);touch(s,'touchmove',[[40,0]]);assert.equal(packets(ws).length,1);[...s.timeouts.values()].at(-1)();assert.equal(packets(ws).length,2);const b=new DataView(ws.sent.at(-1));assert.equal(b.getFloat32(1,true),28);});
const tapKey=(s,key,area='keyboard')=>s.element(area).handlers.click({target:{closest:()=>({dataset:{key:String(key)}})}});
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
test('Super and Shift combine for one workspace shortcut and can be disarmed',()=>{
 const s=start(),ws=ready(s);s.element('key-super').onclick();s.element('mod-shift').onclick();
 assert.deepEqual(packets(ws),[]);assert.equal(s.element('mod-super').attrs['aria-pressed'],'false');
 assert.equal(s.element('shortcut-help').textContent,'Super + Shift · tap a key');
 tapKey(s,32);assert.deepEqual(packets(ws),[[9,227],[9,225],[11,32],[10,225],[10,227]]);
 assert.equal(s.element('key-super').attrs['aria-pressed'],'false');assert.equal(s.element('mod-shift').attrs['aria-pressed'],'false');
 s.element('key-super').onclick();s.element('key-super').onclick();tapKey(s,40,'special-keys');
 assert.deepEqual(packets(ws).slice(5),[[11,40]]);
});
test('Super works with special keys as well as the letter grid',()=>{
 const s=start(),ws=ready(s);s.element('key-super').onclick();tapKey(s,40,'special-keys');
 assert.deepEqual(packets(ws),[[9,227],[11,40],[10,227]]);
});
for (const target of ['keyboard-close','settings-open','disconnect']) test(`${target} clears pending shortcuts`,()=>{
 const s=start(),ws=ready(s);s.element('key-super').onclick();s.element('mod-alt').onclick();s.element(target).onclick();
 assert.deepEqual(packets(ws).at(-1),[7]);
 assert.equal(s.element('key-super').attrs['aria-pressed'],'false');assert.equal(s.element('mod-alt').attrs['aria-pressed'],'false');
});
test('lost connection discards pending shortcuts before reconnecting',()=>{
 const s=start(),ws=ready(s);s.element('key-super').onclick();ws.readyState=3;ws.onclose();
 assert.equal(s.element('key-super').attrs['aria-pressed'],'false');assert.deepEqual(packets(ws),[]);
});
test('touchpad Super clears a pending keyboard shortcut and releases normally',()=>{
 const s=start(),ws=ready(s);s.element('key-super').onclick();s.element('mod-shift').onclick();
 const button=s.element('mod-super');button.handlers.pointerdown({preventDefault(){},pointerId:1,pointerType:'touch'});
 assert.equal(s.element('key-super').attrs['aria-pressed'],'false');assert.equal(s.element('mod-shift').attrs['aria-pressed'],'false');
 button.handlers.pointerup({pointerId:1});assert.deepEqual(packets(ws),[[9,227],[10,227]]);
});
test('three-finger tap never latches Super',()=>{const s=start(),ws=ready(s);touch(s,'touchstart',[[0,0],[20,0],[40,0]]);touch(s,'touchend',[]);assert.deepEqual(packets(ws),[]);});
test('Super release during resize releases the button before the modifier',()=>{const s=start(),ws=ready(s);const button=s.element('mod-super');button.handlers.pointerdown({preventDefault(){},pointerId:1});touch(s,'touchstart',[[0,0],[20,0]]);touch(s,'touchmove',[[10,10],[30,10]]);button.handlers.pointercancel({pointerId:1});assert.deepEqual(packets(ws).slice(-2),[[13],[10,227]]);touch(s,'touchmove',[[20,20],[40,20]]);touch(s,'touchend',[]);assert.deepEqual(packets(ws).slice(-2),[[13],[10,227]]);assert.equal(button.attrs['aria-pressed'],'false');});
test('native realtime typing sends text and local deletion sends Backspace',()=>{const s=start(),ws=ready(s),input=s.element('native-input');input.value='Hi!';input.handlers.input();assert.deepEqual(packets(ws).at(-1),[14,72,105,33]);input.value='Hi';input.handlers.input();assert.deepEqual(packets(ws).at(-1),[11,42]);});
test('native input rejects unsupported text without sending a partial word',()=>{const s=start(),ws=ready(s),input=s.element('native-input');input.value='Hello 日本';input.handlers.input();assert.deepEqual(packets(ws),[]);assert.match(s.element('typing-help').textContent,/US keyboard/);});
test('composition is sent once after commit',()=>{const s=start(),ws=ready(s),input=s.element('native-input');input.handlers.compositionstart();input.value='test';input.handlers.input();assert.deepEqual(packets(ws),[]);input.handlers.compositionend();input.handlers.input();assert.deepEqual(packets(ws),[[14,116,101,115,116]]);});
test('phone keyboard mode focuses the field and sends text immediately',()=>{const s=start(),ws=ready(s);s.element('native-mode').onclick();const input=s.element('native-input');input.value='Hello';input.handlers.input();assert.deepEqual(packets(ws).at(-1),[14,72,101,108,108,111]);});
test('native focus releases modifiers before plain typing',()=>{const s=start(),ws=ready(s);s.element('key-super').onclick();s.element('mod-ctrl').onclick();s.element('native-input').focus();assert.equal(s.element('key-super').attrs['aria-pressed'],'false');assert.deepEqual(packets(ws).at(-1),[7]);assert.equal(s.element('mod-ctrl').attrs['aria-pressed'],'false');});

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
