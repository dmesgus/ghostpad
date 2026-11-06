import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputFlow } from '../web/flow.js';

function harness() {
 let now=0, id=0, failed=0;
 const timers=new Map(), sent=[];
 const clock={now:()=>now,later(fn,ms){timers.set(++id,{fn,at:now+ms});return id},clear(id){timers.delete(id)}};
 const link={bufferedAmount:0,send(bytes){sent.push({bytes,time:now});}};
 const flow=new InputFlow(link,clock,()=>failed++);
 function advance(to) {
  for(let guard=0;;guard++) {
   assert(guard<100000,'Timer must not spin');
   const due=[...timers].filter(([,t])=>t.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!due)break;timers.delete(due[0]);now=due[1].at;due[1].fn();
  }
  now=to;
 }
 return {flow,clock,link,sent,timers,advance,get failed(){return failed},ack(index){flow.acknowledge(sent[index].bytes.slice(0,3))}};
}
const command=(...b)=>new Uint8Array(b).buffer;
function move(x,y=0,op=1) {const b=new ArrayBuffer(9),v=new DataView(b);v.setUint8(0,op);v.setFloat32(1,x,true);v.setFloat32(5,y,true);return b;}
function pinch(scale) {const b=new ArrayBuffer(5),v=new DataView(b);v.setUint8(0,15);v.setFloat32(1,scale,true);return b;}
const codes=h=>h.sent.map(p=>new Uint8Array(p.bytes)[3]);
const total=h=>h.sent.filter(p=>new Uint8Array(p.bytes)[3]===1).reduce((s,p)=>s+new DataView(p.bytes).getFloat32(4,true),0);
function drain(h,from=0) {for(let i=from;i<h.sent.length;i++){h.advance(h.clock.now()+10);h.ack(i);}h.advance(h.clock.now()+100);}

test('healthy link preserves 250 Hz motion, distance, and zero idle polling',()=>{
 const h=harness();
 for(let i=0;i<250;i++){h.advance(i*4);h.flow.send(move(.25));h.advance(i*4+2);h.ack(i);}
 assert.equal(h.sent.length,250);assert.equal(total(h),62.5);assert.equal(h.timers.size,0);assert.equal(h.failed,0);
});
test('network stall bounds motion in flight even with zero bufferedAmount',()=>{
 const h=harness();
 for(let t=0;t<1000;t+=4){h.advance(t);h.flow.send(move(1));}
 assert.equal(h.sent.length,4);assert.equal(h.failed,0);
 h.advance(1000);drain(h);
 assert.equal(total(h),250);assert(h.sent.length<10);assert.equal(h.failed,0);assert.equal(h.timers.size,0);
});
test('controls have reserved capacity and preserve drag / pinch boundaries',()=>{
 const h=harness();h.flow.send(command(5));
 for(let i=0;i<10;i++){h.advance(i*4);h.flow.send(move(1));}
 h.flow.send(command(6));h.flow.send(command(3));
 assert.deepEqual(codes(h),[5,1,1,1,1,6,3]);assert.equal(total(h),10);
 drain(h);
 h.flow.send(pinch(1.2));h.flow.send(pinch(1.4));h.flow.send(pinch(1.8));h.flow.send(command(16));
 drain(h,7);
 const zoom=h.sent.filter(p=>new Uint8Array(p.bytes)[3]===15);
 assert(Math.abs(new DataView(zoom.at(-1).bytes).getFloat32(4,true)-1.8)<1e-6);
 assert.equal(codes(h).at(-1),16);
});
test('coalescing never silently clamps large movement or crosses a click',()=>{
 const h=harness();h.link.bufferedAmount=300;
 h.flow.send(move(1500));h.flow.send(move(1500));h.flow.send(command(3));h.flow.send(move(-10));
 h.advance(100);assert.equal(h.sent.length,0);assert.equal(h.failed,0);
 h.link.bufferedAmount=0;h.advance(108);drain(h);
 assert.deepEqual(codes(h),[1,1,3,1]);assert.equal(total(h),2990);
});
test('release discards unsent edits and motion without replay; stop cancels all timers',()=>{
 const h=harness();h.link.bufferedAmount=300;
 h.flow.send(command(9,227));h.flow.send(move(10));h.flow.send(command(14,120));h.flow.send(command(7));
 h.link.bufferedAmount=0;h.advance(8);assert.deepEqual(codes(h),[7]);h.flow.stop();
 h.flow.send(command(3));h.advance(5000);assert.equal(h.sent.length,1);assert.equal(h.timers.size,0);assert.equal(h.failed,0);
});
test('lost acknowledgements fail once after a bounded wait, never replaying queued input',()=>{
 const h=harness();h.flow.send(command(9,227));h.advance(1999);assert.equal(h.failed,0);
 h.advance(2000);assert.equal(h.failed,1);h.flow.send(move(1));h.ack(0);h.advance(10000);
 assert.equal(h.failed,1);assert.equal(h.sent.length,1);assert.equal(h.timers.size,0);
});
test('duplicate, malformed, and out-of-order acknowledgements cannot open the window',()=>{
 const h=harness();for(let i=0;i<20;i++){h.advance(i*4);h.flow.send(move(1));}
 h.ack(1);h.flow.acknowledge(command(17));h.flow.acknowledge(command(18,1,0));
 assert.equal(h.sent.length,4);h.ack(0);const count=h.sent.length;h.ack(0);assert.equal(h.sent.length,count);
 drain(h,1);assert.equal(total(h),20);
});
test('120-character text packets fit inside the WebSocket small-frame limit',()=>{
 const h=harness();h.flow.send(command(14,...Array(120).fill(97)));
 assert.equal(h.sent[0].bytes.byteLength,124);h.ack(0);assert.equal(h.timers.size,0);
});
test('sequence wraps safely after a long controller session',()=>{
 const h=harness();for(let i=0;i<65537;i++){h.flow.send(command(11,4));h.ack(i);}
 assert.equal(new DataView(h.sent[65535].bytes).getUint16(1,true),0);assert.equal(h.timers.size,0);
});
test('braking momentum drops only the unsent scroll tail',()=>{
 const h=harness();h.link.bufferedAmount=300;h.flow.send(move(10,0,2));h.flow.send(command(3));h.flow.send(move(20,0,2));
 h.flow.discardMotion(2);h.link.bufferedAmount=0;h.advance(8);drain(h);
 assert.deepEqual(codes(h),[2,3]);
});
test('delayed, bandwidth-limited delivery avoids seconds of catch-up after finger lift',()=>{
 const h=harness();let available=0,lastDelivery=0,delivered=0,ackDue=0,maxUnacked=0,unacked=0;
 h.link.send=bytes=>{
  h.sent.push({bytes,time:h.clock.now()});unacked++;maxUnacked=Math.max(maxUnacked,unacked);
  // Link services 50 packets/s, with 40ms one-way latency and occasional stalls.
  available=Math.max(available,h.clock.now())+20;
  if(h.sent.length%17===0)available+=100;
  const arrival=available+40;
  h.clock.later(()=>{delivered+=new DataView(bytes).getFloat32(4,true);lastDelivery=h.clock.now();},arrival-h.clock.now());
  ackDue=Math.max(ackDue,arrival+40);
  h.clock.later(()=>{unacked--;h.flow.acknowledge(bytes.slice(0,3));},ackDue-h.clock.now());
 };
 for(let t=0;t<3000;t+=4){h.advance(t);h.flow.send(move(1));}
 h.advance(4500);
 assert.equal(delivered,750);assert.equal(h.failed,0);assert(maxUnacked<=4);assert(lastDelivery<3500);
 const oldLastDelivery=750*20+40; // same link, even without its occasional stalls
 assert(oldLastDelivery-3000>12000);
 console.log(JSON.stringify({simulation:'50 packets/s, 80ms base RTT, intermittent 100ms stalls',samples:750,sent:h.sent.length,maxUnacked,catchUpMs:lastDelivery-2996,unpacedCatchUpMs:oldLastDelivery-2996}));
});
test('a recovered link returns gradually to fast pacing',()=>{
 const h=harness();h.flow.send(command(3));h.advance(200);h.ack(0);assert.equal(h.flow.interval,40);
 for(let i=1;i<=50;i++){h.flow.send(command(3));h.advance(h.clock.now()+2);h.ack(i);}
 assert.equal(h.flow.interval,4);assert.equal(h.timers.size,0);
});
test('a flooded unsent control queue is bounded and fails once',()=>{
 const h=harness();h.link.bufferedAmount=300;
 for(let i=0;i<1000;i++)h.flow.send(command(11,4));
 assert.equal(h.failed,1);assert.equal(h.sent.length,0);assert.equal(h.timers.size,0);
});
