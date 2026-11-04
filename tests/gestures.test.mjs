import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gestures } from '../web/gestures.js';
const p=(x=0,y=0)=>({x,y});
const setup=()=>{const events=[];return {g:new Gestures(e=>events.push(e)),events};};
test('one-finger tap clicks once',()=>{const {g,events}=setup();g.update([p()],0);g.update([],100);assert.deepEqual(events,[{type:'left'}]);});
test('two-finger tap survives staggered lifts without left click',()=>{const {g,events}=setup();g.update([p()],0);g.update([p(),p(20)],30);g.update([p(20)],100);g.update([],150);assert.deepEqual(events,[{type:'right'}]);});
test('movement suppresses tap',()=>{const {g,events}=setup();g.update([p()],0);g.update([p(30,10)],30);g.update([],50);assert.deepEqual(events,[{type:'move',dx:30,dy:10}]);});
test('scroll stops when a finger is lifted',()=>{const {g,events}=setup();g.update([p(),p(20)],0);g.update([p(0,30),p(20,30)],50);g.update([p(20,30)],80);g.update([p(20,50)],90);g.update([],100);assert.deepEqual(events,[{type:'scroll',dx:0,dy:30}]);});
test('hold and drag releases at end',()=>{const {g,events}=setup();g.update([p()],0);g.hold(400);g.update([p(30)],500);g.update([],600);assert.deepEqual(events,[{type:'down'},{type:'move',dx:30,dy:0},{type:'up'}]);});
test('cancellation releases drag without click',()=>{const {g,events}=setup();g.update([p()],0);g.hold(400);g.cancel();g.update([],500);assert.deepEqual(events,[{type:'down'},{type:'up'}]);});
test('second finger releases an active drag',()=>{const {g,events}=setup();g.update([p()],0);g.hold(400);g.update([p(),p(20)],450);g.update([],500);assert.deepEqual(events,[{type:'down'},{type:'up'}]);});
test('three-finger tap toggles Super without clicking',()=>{const {g,events}=setup();g.update([p(),p(20),p(30)],0);g.update([],100);assert.deepEqual(events,[{type:'super'}]);});
test('moving finger cannot initiate hold',()=>{const {g,events}=setup();g.update([p()],0);g.update([p(20)],100);g.hold(400);assert.equal(events.some(e=>e.type==='down'),false);});
test('slow press without hold does not click',()=>{const {g,events}=setup();g.update([p()],0);g.update([],500);assert.deepEqual(events,[]);});

test('Super one finger moves a window with ordered left drag',()=>{const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p()],0);g.update([p(20,10)],20);g.update([],50);assert.deepEqual(events,[{type:'down'},{type:'move',dx:20,dy:10},{type:'up'}]);});
test('Super two fingers resize with right drag, never scroll',()=>{const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p()],0);g.update([p(),p(20)],5);g.update([p(15,30),p(35,30)],20);g.update([p(35,30)],50);g.update([p(45,40)],60);g.update([],70);assert.deepEqual(events,[{type:'rightdown'},{type:'move',dx:15,dy:30},{type:'rightup'}]);});
test('cancel while resizing releases right button',()=>{const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p(),p(20)],0);g.update([p(15,30),p(35,30)],20);g.cancel();assert.equal(events.at(-1).type,'rightup');assert.equal(g.dragging,false);});
test('three-finger movement never toggles Super',()=>{const {g,events}=setup();g.update([p(),p(20),p(40)],0);g.update([p(0,30),p(20,30),p(40,30)],50);g.update([],100);assert.deepEqual(events,[]);});

test('tiny Super resize with staggered lifts does not right-click afterward',()=>{const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p(),p(20)],0);g.update([p(4),p(24)],20);g.update([p(24)],30);g.update([],40);assert.deepEqual(events.map(e=>e.type),['rightdown','move','rightup']);});
