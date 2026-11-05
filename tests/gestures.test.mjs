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
test('three-finger tap does not toggle a modifier',()=>{const {g,events}=setup();g.update([p(),p(20),p(30)],0);g.update([],100);assert.deepEqual(events,[]);});
test('moving finger cannot initiate hold',()=>{const {g,events}=setup();g.update([p()],0);g.update([p(20)],100);g.hold(400);assert.equal(events.some(e=>e.type==='down'),false);});
test('small cursor corrections never turn into a click or a hold-drag',()=>{
 for(const distance of [2,3,5,8])for(const hold of [false,true]){
  const {g,events}=setup();g.update([p()],0);g.update([p(distance)],50);
  if(hold)g.hold(400);g.update([],hold?450:100);
  assert.deepEqual(events,[{type:'move',dx:distance,dy:0}]);
 }
});
test('landing jitter keeps the cursor still and preserves an ordinary tap',()=>{
 const {g,events}=setup();g.update([p(100,100)],0);
 for(let i=0;i<12;i++)g.update([p(100+i%2,100+i%2)],10+i*10);
 g.update([],180);assert.deepEqual(events,[{type:'left'}]);
});
test('starting movement retains its full distance and then every fractional correction',()=>{
 const {g,events}=setup();g.update([p()],0);g.update([p(.5)],5);g.update([p(1)],10);
 assert.deepEqual(events,[]);g.update([p(2)],15);
 g.update([p(2.25,-.5)],20);g.update([p(2,-.25)],25);g.update([],30);
 assert.deepEqual(events,[{type:'move',dx:2,dy:0},{type:'move',dx:.25,dy:-.5},{type:'move',dx:-.25,dy:.25}]);
});
test('fast swipes start on the first movement and repeated strokes never drag',()=>{
 const {g,events}=setup();
 for(let i=0;i<3;i++){
  g.update([p(200,200)],i*40);g.update([p(230,220)],i*40+5);
  assert.equal(events.length,i+1);g.update([],i*40+10);
 }
 assert.deepEqual(events,Array.from({length:3},()=>({type:'move',dx:30,dy:20})));
});
test('a small correction does not arm tap-drag on the next stroke',()=>{
 const {g,events}=setup();g.update([p()],0);g.update([p(3)],20);g.update([],40);
 g.update([p(100)],60);g.update([p(110)],80);g.update([],100);
 assert.deepEqual(events,[{type:'move',dx:3,dy:0},{type:'move',dx:10,dy:0}]);
});
test('jitter while holding Super does not accidentally start moving a window',()=>{
 const events=[],g=new Gestures(e=>events.push(e),()=>true);g.update([p()],0);
 for(let i=0;i<10;i++)g.update([p(i%2)],10+i*10);
 assert.deepEqual(events,[]);g.update([p(10)],120);g.update([],150);
 assert.deepEqual(events,[{type:'down'},{type:'move',dx:10,dy:0},{type:'up'}]);
});
test('slow press without hold does not click',()=>{const {g,events}=setup();g.update([p()],0);g.update([],500);assert.deepEqual(events,[]);});

const firstTap=g=>{g.update([p(100,100)],0);g.update([],50);};
test('tap then drag presses before movement and releases without another click',()=>{
 const {g,events}=setup();firstTap(g);g.update([p(102,101)],150);
 g.update([p(122,111)],170);assert.equal(g.dragging,true);
 g.update([p(142,151)],190);g.update([],220);
 assert.deepEqual(events,[{type:'left'},{type:'down'},{type:'move',dx:20,dy:10},{type:'move',dx:20,dy:40},{type:'up'}]);
 assert.equal(g.dragging,false);
});
test('double and triple taps remain separate clicks despite slight jitter',()=>{
 const {g,events}=setup();firstTap(g);
 for(const time of [120,240]) {g.update([p(100,100)],time);g.update([p(101,101)],time+10);g.update([],time+50);}
 assert.deepEqual(events,[{type:'left'},{type:'left'},{type:'left'}]);
});
test('tap drag buffers jitter and retains the entire initial movement',()=>{
 const {g,events}=setup();firstTap(g);g.update([p(100,100)],100);g.update([p(101,101)],110);
 assert.deepEqual(events,[{type:'left'}]);g.update([p(103,104)],120);g.update([],150);
 assert.deepEqual(events,[{type:'left'},{type:'down'},{type:'move',dx:3,dy:4},{type:'up'}]);
});
test('late second touches move normally',()=>{
 for(const [point,time] of [[p(100,100),351],[p(200,200),351]]) {
  const {g,events}=setup();firstTap(g);g.update([point],time);g.update([p(point.x+20,point.y)],time+20);g.update([],time+50);
  assert.deepEqual(events,[{type:'left'},{type:'move',dx:20,dy:0}]);
 }
});
test('tap drag follows the cursor even when the second touch lands elsewhere on the pad',()=>{
 const {g,events}=setup();firstTap(g);g.update([p(220,300)],150);
 g.update([p(240,310)],170);g.update([],200);
 assert.deepEqual(events,[{type:'left'},{type:'down'},{type:'move',dx:20,dy:10},{type:'up'}]);
});
test('back-and-forth jitter on the second tap does not start a drag or lose the click',()=>{
 const {g,events}=setup();firstTap(g);g.update([p(100,100)],100);
 for(let i=0;i<12;i++)g.update([p(100+i%2,100)],110+i*5);
 g.update([],200);
 assert.deepEqual(events,[{type:'left'},{type:'left'}]);
});
test('second-touch jitter still permits holding or sliding to select',()=>{
 for(const hold of [false,true]) {
  const {g,events}=setup();firstTap(g);g.update([p(200,200)],100);
  for(let i=0;i<12;i++)g.update([p(200+i%2,200)],110+i*5);
  assert.deepEqual(events,[{type:'left'}]);
  if(hold)g.hold(500);
  g.update([p(220,200)],520);g.update([],550);
  assert.deepEqual(events.map(e=>e.type),hold?['left','down','move','move','up']:['left','down','move','up']);
  assert.equal(events.filter(e=>e.type==='move').reduce((sum,e)=>sum+e.dx,0),20);
 }
});
test('a second touch at the tap timeout boundary can drag',()=>{
 const {g,events}=setup();firstTap(g);g.update([p(100,100)],350);g.update([p(120,100)],370);g.update([],400);
 assert.deepEqual(events.map(e=>e.type),['left','down','move','up']);
});
test('cancel clears a pending tap and releases an active tap drag exactly once',()=>{
 for(const active of [false,true]) {
  const {g,events}=setup();firstTap(g);
  if(active) {g.update([p(100,100)],100);g.update([p(120,100)],120);}
  g.cancel();g.cancel();g.update([],130);g.update([p(100,100)],150);g.update([p(120,100)],170);g.update([],190);
  assert.deepEqual(events.map(e=>e.type),active?['left','down','move','up','move']:['left','move']);
 }
});
test('adding a finger releases tap drag and suppresses further motion and clicks',()=>{
 const {g,events}=setup();firstTap(g);g.update([p(100,100)],100);g.update([p(120,100)],120);
 g.update([p(120,100),p(160,100)],130);g.update([p(140,120),p(180,120)],150);
 g.update([p(180,120)],170);g.update([],190);
 assert.deepEqual(events.map(e=>e.type),['left','down','move','up']);
});
test('two-finger tap, scroll and pinch following a tap never start a left drag',()=>{
 for(const mode of ['tap','scroll','zoom']) {
  const {g,events}=setup();firstTap(g);g.update([p(100,100)],100);g.update([p(101,100)],110);
  g.update([p(101,100),p(201,100)],120);
  if(mode==='scroll') g.update([p(101,120),p(201,120)],140);
  if(mode==='zoom') g.update([p(81,100),p(221,100)],140);
  g.update([p(201,100)],160);g.update([],180);
  assert.deepEqual(events.map(e=>e.type),['left',...(mode==='tap'?['right']:mode==='scroll'?['scroll']:['zoom','zoomend'])]);
 }
});
test('intervening gestures and completed drags clear tap history',()=>{
 for(const mode of ['scroll','move','drag']) {
  const {g,events}=setup();firstTap(g);
  if(mode==='scroll') {g.update([p(100,100),p(200,100)],100);g.update([p(100,120),p(200,120)],120);}
  else {const time=mode==='move'?400:100;g.update([p(100,100)],time);g.update([p(220,100)],time+20);}
  g.update([],450);events.length=0;
  g.update([p(100,100)],470);g.update([p(120,100)],490);g.update([],510);
  assert.deepEqual(events,[{type:'move',dx:20,dy:0}]);
 }
});
test('holding the second touch starts one drag and retains buffered movement',()=>{
 const {g,events}=setup();firstTap(g);g.update([p(100,100)],100);g.update([p(101,101)],120);
 g.hold(500);g.hold(510);g.update([p(111,111)],520);g.update([],550);
 assert.deepEqual(events,[{type:'left'},{type:'down'},{type:'move',dx:1,dy:1},{type:'move',dx:10,dy:10},{type:'up'}]);
});
test('a tap under Super does not arm a regular drag afterward',()=>{
 let held=true;const events=[],g=new Gestures(e=>events.push(e),()=>held);firstTap(g);held=false;
 g.update([p(100,100)],100);g.update([p(120,100)],120);g.update([],150);
 assert.deepEqual(events,[{type:'left'},{type:'move',dx:20,dy:0}]);
});

test('Super one finger moves a window with ordered left drag',()=>{const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p()],0);g.update([p(20,10)],20);g.update([],50);assert.deepEqual(events,[{type:'down'},{type:'move',dx:20,dy:10},{type:'up'}]);});
test('Super two fingers resize with right drag, never scroll',()=>{const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p()],0);g.update([p(),p(20)],5);g.update([p(15,30),p(35,30)],20);g.update([p(35,30)],50);g.update([p(45,40)],60);g.update([],70);assert.deepEqual(events,[{type:'rightdown'},{type:'move',dx:15,dy:30},{type:'rightup'}]);});
test('cancel while resizing releases right button',()=>{const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p(),p(20)],0);g.update([p(15,30),p(35,30)],20);g.cancel();assert.equal(events.at(-1).type,'rightup');assert.equal(g.dragging,false);});
test('three-finger movement never toggles Super',()=>{const {g,events}=setup();g.update([p(),p(20),p(40)],0);g.update([p(0,30),p(20,30),p(40,30)],50);g.update([],100);assert.deepEqual(events,[]);});

test('tiny Super resize with staggered lifts does not right-click afterward',()=>{const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p(),p(20)],0);g.update([p(4),p(24)],20);g.update([p(24)],30);g.update([],40);assert.deepEqual(events.map(e=>e.type),['rightdown','move','rightup']);});

test('symmetric pinch zooms without scrolling or right-clicking',()=>{
 const {g,events}=setup();g.update([p(100,100),p(200,100)],0);
 g.update([p(80,100),p(220,100)],30);g.update([],80);
 assert.deepEqual(events.map(e=>e.type),['zoom','zoomend']);assert(events[0].scale>1);
});
test('pinch-in zooms out and staggered lift ends zoom immediately',()=>{
 const {g,events}=setup();g.update([p(100),p(200)],0);g.update([p(120),p(180)],20);
 g.update([p(180)],30);g.update([p(200)],40);g.update([],50);
 assert.deepEqual(events.map(e=>e.type),['zoom','zoomend']);assert(events[0].scale<1);
});
test('asymmetric pinch and direction reversal stay zoom gestures',()=>{
 const {g,events}=setup();g.update([p(100),p(200)],0);g.update([p(100),p(240)],20);
 g.update([p(100),p(210)],40);g.cancel();
 assert.deepEqual(events.map(e=>e.type),['zoom','zoom','zoomend']);assert(events[0].scale>1);assert(events[1].scale<events[0].scale);
});
test('two-finger jitter still permits a right-click',()=>{
 const {g,events}=setup();g.update([p(100),p(200)],0);g.update([p(99),p(201)],20);g.update([],100);
 assert.deepEqual(events,[{type:'right'}]);
});
test('scroll retains initial motion and does not become zoom mid-gesture',()=>{
 const {g,events}=setup();g.update([p(100),p(200)],0);g.update([p(100,3),p(200,3)],10);
 g.update([p(100,10),p(200,10)],50);g.update([p(80,20),p(220,20)],70);g.update([],90);
 assert.deepEqual(events,[{type:'scroll',dx:0,dy:10},{type:'scroll',dx:0,dy:10}]);
});
test('cancel and third finger release zoom without extra clicks',()=>{
 for(const third of [false,true]) {const {g,events}=setup();g.update([p(100),p(200)],0);g.update([p(80),p(220)],20);
 if(third) g.update([p(80),p(220),p(300)],30);else g.cancel();g.update([],40);
 assert.deepEqual(events.map(e=>e.type),['zoom','zoomend']);}
});
test('Super pinch movement remains window resizing',()=>{
 const events=[];const g=new Gestures(e=>events.push(e),()=>true);g.update([p(100),p(200)],0);
 g.update([p(100),p(240)],20);g.update([],40);assert.deepEqual(events.map(e=>e.type),['rightdown','move','rightup']);
});

test('small initial slide before a pinch does not leak scrolling',()=>{
 const {g,events}=setup();g.update([p(100,100),p(200,100)],0);
 g.update([p(100,108),p(200,108)],16);assert.deepEqual(events,[]);
 g.update([p(90,108),p(210,108)],32);g.update([p(80,108),p(220,108)],48);g.update([],70);
 assert.deepEqual(events,[{type:'zoom',scale:1.2},{type:'zoom',scale:1.4},{type:'zoomend'}]);
});
test('a finger drifting before the other starts pinching does not lock scrolling',()=>{
 const {g,events}=setup();g.update([p(100,100),p(200,100)],0);
 g.update([p(100,114),p(200,100)],16);assert.deepEqual(events,[]);
 g.update([p(90,114),p(210,100)],32);g.update([],70);
 assert.deepEqual(events.map(e=>e.type),['zoom','zoomend']);
});
test('ambiguous translation and spreading wait for clear intent',()=>{
 const {g,events}=setup();g.update([p(100,100),p(200,100)],0);
 g.update([p(95,110),p(205,110)],20);assert.deepEqual(events,[]);
 g.update([p(85,110),p(215,110)],40);g.update([],80);
 assert.deepEqual(events.map(e=>e.type),['zoom','zoomend']);
});
test('small scroll accumulates during the decision window without losing distance',()=>{
 const {g,events}=setup();g.update([p(100,100),p(200,100)],0);
 g.update([p(100,107),p(200,107)],16);g.update([p(100,110),p(200,110)],45);
 g.update([p(100,115),p(200,115)],60);g.update([],80);
 assert.deepEqual(events,[{type:'scroll',dx:0,dy:10},{type:'scroll',dx:0,dy:5}]);
});
test('fast clear scroll responds without waiting for the decision window',()=>{
 const {g,events}=setup();g.update([p(100,100),p(200,100)],0);g.update([p(100,120),p(200,120)],8);
 assert.deepEqual(events,[{type:'scroll',dx:0,dy:20}]);
});
test('brief scroll released inside the decision window is delivered once without clicking',()=>{
 for(const staggered of [false,true]) {const {g,events}=setup();g.update([p(100,100),p(200,100)],0);
 g.update([p(100,108),p(200,108)],10);if(staggered)g.update([p(200,108)],20);g.update([],25);
 assert.deepEqual(events,[{type:'scroll',dx:0,dy:8}]);}
});
test('cancellation drops undecided motion',()=>{
 const {g,events}=setup();g.update([p(100,100),p(200,100)],0);g.update([p(100,108),p(200,108)],10);g.cancel();g.update([],20);
 assert.deepEqual(events,[]);
});
test('pinch remains zoom-only when its center drifts and fingers lift separately',()=>{
 const {g,events}=setup();g.update([p(100,100),p(200,100)],0);g.update([p(90,100),p(210,100)],10);
 g.update([p(90,150),p(210,150)],30);g.update([p(80,170),p(220,170)],45);
 g.update([p(220,170)],60);g.update([p(220,200)],70);g.update([],80);
 assert.deepEqual(events,[{type:'zoom',scale:1.2},{type:'zoom',scale:1.4},{type:'zoomend'}]);
});
