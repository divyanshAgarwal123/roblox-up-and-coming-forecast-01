import {cleanHistory, type Snapshot, type Task, type Forecast} from './forecast.ts';

const HOUR=3_600_000;
const clip=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export interface DynamicsConfig {
  momentum:number; memory:number; damping:number; noise:number;
  tail:number; newcomers:number; samples:number; offset:number;
}
export const DYNAMICS:DynamicsConfig={
  momentum:1,memory:18,damping:36,noise:1.1,
  tail:0.15,newcomers:1,samples:24000,offset:0.5,
};
interface Candidate {id:number;rank:number;velocity:number;age:number}
interface Arrival {hours:number;weight:number;mask:boolean[]}

// The seed never depends on game identifiers or wall time. A fixed sequence makes
// forecasts reproducible and preserves equivariance when opaque IDs are renamed.
function randomSource() {
  let state=0x53a97c21;
  const uniform=()=>{
    state=(state+0x6d2b79f5)>>>0;
    let t=Math.imul(state^(state>>>15),1|state);
    t^=t+Math.imul(t^(t>>>7),61|t);
    return (((t^(t>>>14))>>>0)+0.5)/4294967296;
  };
  const normal=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
  return {uniform,normal};
}

function velocity(history:Snapshot[],id:number,memory:number,offset:number):number {
  const now=Date.parse(history.at(-1)!.at);
  const observations=history.map(s=>({
    x:(Date.parse(s.at)-now)/HOUR,
    row:s.up_and_coming.find(r=>r.universe_id===id),
  })).filter(o=>o.row && o.x>=-memory);
  if(observations.length<2) return 0;
  let sw=0,sx=0,sy=0,sxx=0,sxy=0;
  for(const o of observations) {
    const w=Math.exp(o.x/memory), y=Math.log(o.row!.rank+offset);
    sw+=w;sx+=w*o.x;sy+=w*y;sxx+=w*o.x*o.x;sxy+=w*o.x*y;
  }
  const span=observations.at(-1)!.x-observations[0].x;
  // Short histories are shrunk rather than extrapolating a few minutes of motion.
  return clip((sxy-sx*sy/sw)/(sxx-sx*sx/sw+12)*24,-2,2)*Math.min(1,span/18);
}

function arrivalPatterns(history:Snapshot[]):Arrival[] {
  const end=Date.parse(history.at(-1)!.at);
  const patterns:Arrival[]=[];
  for(let i=0;i<history.length-1;i++) {
    const ids=new Set(history[i].up_and_coming.slice(0,100).map(r=>r.universe_id));
    const a=Date.parse(history[i].at);
    const before=i ? a-Date.parse(history[i-1].at) : 6*HOUR;
    for(let j=i+1;j<history.length;j++) {
      const b=Date.parse(history[j].at), hours=(b-a)/HOUR;
      if(hours<3 || hours>120) continue;
      const gap=b-Date.parse(history[j-1].at);
      const weight=Math.exp(-(end-b)/(120*HOUR))*clip(before/HOUR,1,12)*clip(gap/HOUR,1,12);
      const top=history[j].up_and_coming.slice(0,10);
      patterns.push({hours,weight,mask:top.map(r=>!ids.has(r.universe_id))});
    }
  }
  return patterns;
}

function choosePattern(patterns:Arrival[],hours:number,u:number):boolean[] {
  if(!patterns.length) return new Array(10).fill(false);
  const bandwidth=10+0.2*hours;
  const ws=patterns.map(p=>p.weight*Math.exp(-0.5*((p.hours-hours)/bandwidth)**2));
  let left=u*ws.reduce((a,b)=>a+b,0);
  for(let i=0;i<ws.length;i++) {
    left-=ws[i];
    if(left<=0) return patterns[i].mask;
  }
  return patterns.at(-1)!.mask;
}

/** Simulate joint rankings, so a game can occupy only one place in each draw. */
export function dynamicForecast(input:Snapshot[],task:Task,config:DynamicsConfig=DYNAMICS):Forecast {
  const history=cleanHistory(input,Date.parse(task.history_until));
  if(!history.length) throw new Error('No valid pre-cutoff history with at least ten games');
  const latest=history.at(-1)!, now=Date.parse(latest.at);
  const start=Math.max(0,(Date.parse(task.window.from)-now)/HOUR);
  const duration=(Date.parse(task.window.until)-Date.parse(task.window.from))/HOUR;
  if(task.places!==10 || !Number.isFinite(start) || !Number.isFinite(duration) || duration<=0)
    throw new Error('Invalid forecast task');
  const candidates:Candidate[]=latest.up_and_coming.slice(0,100).map(r=>({
    id:r.universe_id,rank:r.rank,velocity:velocity(history,r.universe_id,config.memory,config.offset),
    age:(now-Date.parse(history.find(s=>s.up_and_coming.some(x=>x.universe_id===r.universe_id))!.at))/HOUR,
  }));
  const rng=randomSource(), arrivals=arrivalPatterns(history);
  const counts=Array.from({length:10},()=>new Array(candidates.length).fill(0));
  // Twenty-four horizon bins amortize the historical arrival mixture calculation.
  const buckets=Array.from({length:24},(_,i)=>{
    const hours=start+duration*(i+0.5)/24;
    return Array.from({length:128},(_,j)=>choosePattern(arrivals,hours,(j+0.5)/128));
  });
  const total=Math.max(100,Math.floor(config.samples));
  for(let trial=0;trial<total;trial++) {
    const q=(trial+0.5)/total, hours=start+duration*q;
    const projected=config.damping*(1-Math.exp(-hours/config.damping))/24;
    const sigma=config.noise*Math.sqrt(Math.max(0.02,hours/24));
    const order=candidates.map((c,index)=>{
      const spread=rng.uniform()<config.tail ? 1.8 : 1;
      const z=rng.normal();
      return {index,value:Math.log(c.rank+config.offset)+config.momentum*c.velocity*projected+sigma*spread*z};
    }).sort((a,b)=>a.value-b.value || a.index-b.index);
    const mask=buckets[Math.min(23,Math.floor(q*24))][Math.floor(rng.uniform()*128)];
    let n=0;
    for(let place=0;place<10;place++) {
      const absent=mask[place] && rng.uniform()<config.newcomers;
      if(!absent && n<order.length) counts[place][order[n++].index]++;
    }
  }
  // A small diffuse reserve smooths finite simulation counts and admits releases
  // unseen even in the short historical arrival sample.
  const reserve=0.025, smooth=0.03;
  const probabilities:Forecast['probabilities']=[];
  for(let k=0;k<10;k++) {
    const prior=candidates.map(c=>1/(1+Math.abs(Math.log((c.rank+config.offset)/(k+1+config.offset))))**3);
    const norm=prior.reduce((a,b)=>a+b,0);
    for(let i=0;i<candidates.length;i++) {
      const p=(1-reserve)*((1-smooth)*counts[k][i]/total+smooth*prior[i]/norm);
      probabilities.push({universe_id:candidates[i].id,place:k+1,p});
    }
  }
  return finalize(probabilities);
}

export function finalize(rows:Forecast['probabilities']):Forecast {
  const totals=new Map<number,number>();
  for(const r of rows) totals.set(r.universe_id,(totals.get(r.universe_id)??0)+r.p);
  const probabilities=rows.map(r=>({...r,p:Math.floor(r.p/Math.max(1,totals.get(r.universe_id)??1)*1e10)/1e10}))
    .sort((a,b)=>a.place-b.place||a.universe_id-b.universe_id);
  const games=[...totals.keys()].map(id=>{
    const rs=probabilities.filter(r=>r.universe_id===id),total=rs.reduce((s,r)=>s+r.p,0);
    return {id,total,expected:rs.reduce((s,r)=>s+r.place*r.p,0)/Math.max(1e-12,total)};
  }).sort((a,b)=>b.total-a.total||a.id-b.id).slice(0,10)
    .sort((a,b)=>a.expected-b.expected||b.total-a.total||a.id-b.id);
  return {probabilities,top10:games.map(g=>g.id)};
}

/** Average recent and slower trends rather than trust one fitted time scale. */
export function forecast(input:Snapshot[],task:Task):Forecast {
  const configs=[
    {...DYNAMICS,memory:18,noise:0.8},
    {...DYNAMICS,memory:18,noise:1.1},
    {...DYNAMICS,memory:36,noise:1.1},
    {...DYNAMICS,memory:60,noise:1.1},
  ];
  const combined=new Map<string,Forecast['probabilities'][number]>();
  for(const config of configs) for(const row of dynamicForecast(input,task,config).probabilities) {
    const key=row.place+':'+row.universe_id, existing=combined.get(key)??{...row,p:0};
    existing.p+=row.p/configs.length;combined.set(key,existing);
  }
  return finalize([...combined.values()]);
}
