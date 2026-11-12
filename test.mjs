import test from 'node:test';
import assert from 'node:assert/strict';
import {score,cleanHistory} from './forecast.ts';
import {enhancedForecast as predict,dynamicForecast,DYNAMICS} from './dynamics.ts';
import {marketSignals} from './features.ts';
const H=3_600_000, epoch=Date.parse('2026-01-01T00:00:00Z');
const chart=(rotation=0)=>Array.from({length:25},(_,i)=>({rank:i+1,universe_id:1000+(i+rotation)%25,playing:10000-i*100}));
const history=Array.from({length:24},(_,i)=>({at:new Date(epoch+i*6*H).toISOString(),up_and_coming:chart(Math.floor(i/8))}));
const cutoff=epoch+144*H;
const task={history_until:new Date(cutoff).toISOString(),window:{from:new Date(cutoff).toISOString(),until:new Date(cutoff+72*H).toISOString(),slots:72,slot_minutes:60},places:10,output:'forecast.json'};

test('all place distributions obey the public output contract',()=>{
 const f=predict(history,task);
 assert.deepEqual(Object.keys(f),['probabilities','top10']);
 assert.equal(f.top10.length,10);assert.equal(new Set(f.top10).size,10);
 for(let k=1;k<=10;k++) {
  const rows=f.probabilities.filter(r=>r.place===k);
  assert.ok(rows.length<=100);assert.equal(rows.length,new Set(rows.map(r=>r.universe_id)).size);
  assert.ok(rows.reduce((s,r)=>s+r.p,0)<=1);
  assert.ok(rows.every(r=>Number.isSafeInteger(r.universe_id)&&Number.isFinite(r.p)&&r.p>=0&&r.p<=1));
 }
 const mass=new Map();
 for(const row of f.probabilities) mass.set(row.universe_id,(mass.get(row.universe_id)??0)+row.p);
 assert.ok([...mass.values()].every(p=>p<=1+1e-12));
});

test('forecast is deterministic and future rows cannot change it',()=>{
 const expected=JSON.stringify(predict(history,task));
 assert.equal(JSON.stringify(predict(history,task)),expected);
 const future={at:new Date(cutoff).toISOString(),up_and_coming:chart(15)};
 assert.equal(JSON.stringify(predict([...history,future],task)),expected);
});

test('game identifiers carry no predictive information',()=>{
 const shifted=history.map(s=>({...s,up_and_coming:s.up_and_coming.map(r=>({...r,universe_id:r.universe_id+1_000_000}))}));
 const a=predict(history,task),b=predict(shifted,task);
 assert.deepEqual(b.top10,a.top10.map(id=>id+1_000_000));
 assert.deepEqual(b.probabilities,a.probabilities.map(r=>({...r,universe_id:r.universe_id+1_000_000})));
});

test('scorer distributes unnamed probability only over unnamed chart games',()=>{
 const f={probabilities:[{universe_id:1000,place:1,p:0.5}],top10:chart().slice(0,10).map(r=>r.universe_id)};
 const result=score(f,[{at:new Date(epoch).toISOString(),up_and_coming:chart()}]);
 assert.ok(Math.abs(result.logScore-(Math.log(0.5)+9*Math.log(1/25)))<1e-10);
 assert.equal(result.hits,10);assert.equal(result.agreement,100);
});

test('missing history fails explicitly and a one-snapshot history has a forecast',()=>{
 assert.throws(()=>predict([],task),/No valid/);
 assert.equal(predict([history[0]],task).top10.length,10);
});

test('duplicate rows, bad dates and failed reads are sanitized',()=>{
 const input=[{at:'invalid',up_and_coming:chart()},{...history[0],ok:false},history[1],
              {...history[2],up_and_coming:[...chart(),chart()[0]]}];
 const clean=cleanHistory(input,cutoff);
 assert.equal(clean.length,2);assert.equal(clean[1].up_and_coming.length,25);
});

test('joint simulations move probability toward a rising game',()=>{
 const input=Array.from({length:8},(_,i)=>{
  const ids=Array.from({length:24},(_,k)=>1000+k);ids.splice(15-i*2,0,999);
  return {at:new Date(epoch+i*6*H).toISOString(),
   up_and_coming:ids.map((id,k)=>({rank:k+1,universe_id:id}))};
 });
 const ftask={...task,history_until:new Date(epoch+48*H).toISOString(),
  window:{from:new Date(epoch+48*H).toISOString(),until:new Date(epoch+72*H).toISOString()}};
 const moving=dynamicForecast(input,ftask,{...DYNAMICS,samples:5000,noise:0.5});
 const staticForecast=dynamicForecast(input,ftask,{...DYNAMICS,samples:5000,noise:0.5,momentum:0});
 const first=f=>f.probabilities.find(r=>r.universe_id===999&&r.place===1).p;
 assert.ok(first(moving)>first(staticForecast));
});

test('forecast horizons must be positive and finite',()=>{
 assert.throws(()=>predict(history,{...task,window:{from:task.window.from,until:task.window.from}}),/Invalid/);
 assert.throws(()=>predict(history,{...task,window:{from:'bad',until:task.window.until}}),/Invalid/);
});

test('relative player growth helps a flat-ranked breakout',()=>{
 const input=Array.from({length:8},(_,i)=>({
  at:new Date(epoch+i*6*H).toISOString(),
  up_and_coming:chart().map((r,k)=>({...r,playing:k===6?1000*Math.exp(i*0.3):1000})),
 }));
 const ftask={...task,history_until:new Date(epoch+48*H).toISOString(),
  window:{from:new Date(epoch+48*H).toISOString(),until:new Date(epoch+72*H).toISOString()}};
 const a=dynamicForecast(input,ftask,{...DYNAMICS,samples:5000,noise:0.5,growth:1});
 const b=dynamicForecast(input,ftask,{...DYNAMICS,samples:5000,noise:0.5,growth:0});
 const mass=f=>f.probabilities.filter(r=>r.universe_id===1006&&r.place<=3).reduce((s,r)=>s+r.p,0);
 assert.ok(mass(a)>mass(b));
});

test('auxiliary charts are ID-equivariant and missing player counts stay finite',()=>{
 const input=history.slice(-8).map(s=>({...s,
  top_trending:s.up_and_coming.slice(0,15).map((r,i)=>({...r,rank:15-i})),
  up_and_coming:s.up_and_coming.map((r,i)=>({...r,playing:i%3===0?null:r.playing})),
 }));
 const shifted=input.map(s=>({...s,
  up_and_coming:s.up_and_coming.map(r=>({...r,universe_id:r.universe_id+1000000})),
  top_trending:s.top_trending.map(r=>({...r,universe_id:r.universe_id+1000000})),
 }));
 const a=marketSignals(input),b=marketSignals(shifted);
 for(const [id,x] of a) {
  assert.deepEqual(b.get(id+1000000),x);
  assert.ok(Object.values(x).every(Number.isFinite));
 }
});
