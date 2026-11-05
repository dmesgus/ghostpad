import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScrollMomentum } from '../web/scroll.js';

function flick(dx=0,dy=16) {
 const scroll=new ScrollMomentum();scroll.begin(0);
 for(let time=16;time<=64;time+=16) scroll.track(dx,dy,time);
 return scroll;
}
function distance(scroll,interval) {
 assert.equal(scroll.release(64),true);
 let x=0,y=0,previous=Infinity,frames=0;
 for(let time=64+interval;time<3064;time+=interval) {
  const delta=scroll.step(time);
  if(!delta)return {x,y,frames};
  const length=Math.hypot(delta.dx,delta.dy);
  assert(length<=previous+1e-9,'Coasting must decelerate');previous=length;
  x+=delta.dx;y+=delta.dy;frames++;
 }
 assert.fail('Momentum must come to rest');
}
test('a flick coasts smoothly to rest without reversing',()=>{
 const {x,y,frames}=distance(flick(),16);
 assert.equal(x,0);assert(y>200&&y<300);assert(frames>10);
});
test('coast distance is independent of 30/60/120 Hz rendering',()=>{
 const runs=[1000/30,1000/60,1000/120].map(interval=>distance(flick(12,-16),interval));
 for(const run of runs){assert(Math.abs(run.x-runs[0].x)<1e-6);assert(Math.abs(run.y-runs[0].y)<1e-6);}
 assert(runs[0].x>0&&runs[0].y<0);
});
test('slow movement, a tap, and holding still before release do not coast',()=>{
 const slow=flick(0,1);assert.equal(slow.release(64),false);
 const tap=new ScrollMomentum();tap.begin(0);assert.equal(tap.release(30),false);
 const paused=flick();assert.equal(paused.release(164),false);
 assert.equal(paused.step(180),null);
});
test('a shorter pause reduces the coast',()=>{
 const fast=flick(),paused=flick();fast.release(64);paused.release(104);
 assert(paused.step(120).dy<fast.step(80).dy/2);
});
test('reversing a flick uses the new direction',()=>{
 const scroll=flick();scroll.track(0,-16,80);assert.equal(scroll.release(80),true);
 assert(scroll.step(96).dy<0);
});
test('recent speed wins over an earlier hold or slow movement',()=>{
 const scroll=new ScrollMomentum();scroll.begin(0);
 scroll.track(0,1,1000);scroll.track(0,16,1016);scroll.track(0,16,1032);
 assert.equal(scroll.release(1032),true);assert(scroll.step(1048).dy>10);
});
test('faster flicks travel farther but extreme samples stay bounded',()=>{
 assert(distance(flick(0,32),16).y>distance(flick(0,8),16).y*3);
 const extreme=distance(flick(10000,-10000),16);
 assert(Math.hypot(extreme.x,extreme.y)<840);
});
test('reset and a new touch cancel previous momentum without replay',()=>{
 const scroll=flick();scroll.release(64);scroll.reset();assert.equal(scroll.step(80),null);
 assert.equal(scroll.release(80),false);
 const next=flick();next.release(64);next.begin(80);assert.equal(next.step(96),null);
});
test('a stalled frame drops the coast instead of catching up',()=>{
 const scroll=flick();scroll.release(64);assert.equal(scroll.step(300),null);assert.equal(scroll.step(316),null);
});
