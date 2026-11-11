/**
 * Rank Tide: analogue forecasts of chart movement, with uncertainty for new games.
 * Every fitted quantity comes from the input prefix. IDs are opaque identities.
 * No network, clock, external model, hardcoded game, or random number is used.
 */
export interface Game {
  rank:number; universe_id:number; playing?:number|null; name?:string;
}
export interface Snapshot {
  at:string; ok?:boolean; up_and_coming:Game[];
}
export interface Task {
  history_until:string;
  window:{from:string;until:string;slots:number;slot_minutes:number};
  places:number; output:string;
}
export interface Forecast {
  probabilities:{universe_id:number;place:number;p:number}[];
  top10:number[];
}
export interface Config {
  smoothing:number; momentum:number; halfLife:number; persistence:number;
}
export const DEFAULT:Config={smoothing:0.3,momentum:0.3,halfLife:120,persistence:0.2};
const HOUR=3_600_000;
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const finite=(n:unknown):n is number=>typeof n==='number' && Number.isFinite(n);
interface State {
  time:number; rows:Game[]; byId:Map<number,Game>;
  motion:Map<number,number>; growth:Map<number,number>; exposure:number;
}

/** Reject future rows, collapse duplicate timestamps and sort deterministically. */
export function cleanHistory(input:Snapshot[],until:number):Snapshot[] {
  const unique=new Map<number,Snapshot>();
  for (const s of input) {
    const t=Date.parse(s.at);
    if (!Number.isFinite(t) || t>=until || s.ok===false || !Array.isArray(s.up_and_coming)) continue;
    const ids=new Set<number>(), ranks=new Set<number>();
    const rows=s.up_and_coming.filter(r=>{
      if (!Number.isSafeInteger(r.universe_id) || r.universe_id<=0 || !Number.isInteger(r.rank)
          || r.rank<=0 || ids.has(r.universe_id) || ranks.has(r.rank)) return false;
      ids.add(r.universe_id);ranks.add(r.rank);return true;
    }).map(r=>({...r})).sort((a,b)=>a.rank-b.rank || a.universe_id-b.universe_id);
    if (rows.length>=10) unique.set(t,{...s,up_and_coming:rows});
  }
  const ordered=[...unique].sort((a,b)=>a[0]-b[0]).map(([,s])=>s);
  // Keep the chronological span, including the final read, while bounding runtime.
  if (ordered.length<=160) return ordered;
  return Array.from({length:160},(_,i)=>ordered[Math.floor(i*(ordered.length-1)/159)]);
}

function states(history:Snapshot[]):State[] {
  const out:State[]=[];
  for (const snapshot of history) {
    const time=Date.parse(snapshot.at)/HOUR, rows=snapshot.up_and_coming;
    const state:State={time,rows,byId:new Map(rows.map(r=>[r.universe_id,r])),motion:new Map(),growth:new Map(),exposure:1};
    // A 12-to-36 hour comparison reduces dependence on the recorder's cadence.
    const past=out.filter(s=>time-s.time>=8 && time-s.time<=40)
      .sort((a,b)=>Math.abs(time-a.time-24)-Math.abs(time-b.time-24))[0];
    for (const row of rows) {
      const before=past?.byId.get(row.universe_id);
      const days=past ? Math.max(0.33,(time-past.time)/24) : 1;
      const motion=before ? Math.log((before.rank+1)/(row.rank+1))/days : 0;
      state.motion.set(row.universe_id,clamp(motion,-1.5,1.5));
      const growth=before && finite(before.playing) && finite(row.playing)
        ? Math.log((row.playing+50)/(before.playing+50))/days : 0;
      state.growth.set(row.universe_id,clamp(growth,-2,2));
    }
    out.push(state);
  }
  // Approximate time represented by each observation. An hourly recorder must
  // not overwhelm a sparse archive merely because it samples more frequently.
  for (let i=0;i<out.length;i++) {
    const before=i>0 ? out[i].time-out[i-1].time : (out[1]?.time-out[0].time)||6;
    const after=i+1<out.length ? out[i+1].time-out[i].time : before;
    out[i].exposure=clamp((before+after)/2,1,12)/6;
  }
  return out;
}

interface Candidate {id:number;rank:number;motion:number;growth:number;missing:number}
function candidates(ss:State[]):Candidate[] {
  const latest=ss.at(-1)!;
  const found=new Map<number,Candidate>();
  for (const row of latest.rows.slice(0,90)) found.set(row.universe_id,{
    id:row.universe_id,rank:row.rank,motion:latest.motion.get(row.universe_id)??0,
    growth:latest.growth.get(row.universe_id)??0,missing:0,
  });
  // A recent disappearance need not be permanent; retain only former top-20 games.
  for (const s of [...ss].reverse()) {
    const age=latest.time-s.time;
    if (age>48 || found.size>=100) break;
    for (const row of s.rows.slice(0,20)) if (!found.has(row.universe_id) && found.size<100) {
      found.set(row.universe_id,{id:row.universe_id,rank:row.rank+15+age/3,motion:-0.5,growth:0,missing:age});
    }
  }
  return [...found.values()].sort((a,b)=>a.rank-b.rank || a.id-b.id);
}

/** Pair weights integrate the requested forecast interval rather than one horizon. */
function horizonWeight(dt:number,start:number,duration:number):number {
  let sum=0;
  for (let h=0;h<6;h++) {
    const target=start+duration*(h+0.5)/6;
    const bandwidth=10+target*0.2;
    sum+=Math.exp(-0.5*((dt-target)/bandwidth)**2)/bandwidth;
  }
  return sum/6;
}

function normalized(values:number[]):number[] {
  const sum=values.reduce((a,b)=>a+b,0);
  return sum>0 ? values.map(v=>v/sum) : values.map(()=>1/values.length);
}

function prior(cs:Candidate[],place:number,scale:number):number[] {
  return normalized(cs.map(c=>{
    const width=2+place*0.35+scale*0.035;
    const d=(c.rank-place)/width;
    const local=Math.exp(-0.5*d*d);
    const tail=0.08/(1+Math.abs(c.rank-place)/8);
    return (local+tail)*Math.exp(-c.missing/48);
  }));
}

/** Returns a calibrated mixture over known games; the leftover is newcomer mass. */
export function predict(input:Snapshot[],task:Task,config:Config=DEFAULT):Forecast {
  const until=Date.parse(task.history_until);
  const history=cleanHistory(input,until);
  if (!history.length) throw new Error('No valid pre-cutoff history with at least ten games');
  if (task.places!==10) throw new Error('This forecaster expects ten places');
  const ss=states(history), latest=ss.at(-1)!, cs=candidates(ss);
  const start=Math.max(0,Date.parse(task.window.from)/HOUR-latest.time);
  const duration=clamp((Date.parse(task.window.until)-Date.parse(task.window.from))/HOUR,1,168);
  if (!Number.isFinite(start) || !Number.isFinite(duration)) throw new Error('Invalid forecast window');
  const matrix=Array.from({length:10},()=>new Array(cs.length).fill(0));
  const unseen=new Array(10).fill(0), totals=new Array(10).fill(0);
  // One outcome per place per historical pair. Each contributes a probability
  // distribution across analogous CURRENT games, never an old game's identity.
  for (let i=0;i<ss.length-1;i++) for (let j=i+1;j<ss.length;j++) {
    const a=ss[i], b=ss[j], dt=b.time-a.time;
    if (dt<2 || dt>duration+start+48) continue;
    const weight=horizonWeight(dt,start,duration)*Math.exp(-(latest.time-b.time)/config.halfLife)*a.exposure*b.exposure;
    if (weight<1e-8) continue;
    for (let place=1;place<=10;place++) {
      const winner=b.rows.find(r=>r.rank===place);
      if (!winner) continue;
      totals[place-1]+=weight;
      const old=a.byId.get(winner.universe_id);
      if (!old || old.rank>90) { unseen[place-1]+=weight; continue; }
      const movement=a.motion.get(winner.universe_id)??0;
      const growth=a.growth.get(winner.universe_id)??0;
      const allocation=normalized(cs.map(c=>{
        const rankDistance=Math.log((c.rank+1)/(old.rank+1))/config.smoothing;
        const movementDistance=(c.motion-movement)/0.6;
        const growthDistance=(c.growth-growth)/1.2;
        return Math.exp(-0.5*rankDistance**2-config.momentum*(movementDistance**2+0.2*growthDistance**2)-c.missing/36)+1e-12;
      }));
      for (let n=0;n<cs.length;n++) matrix[place-1][n]+=weight*allocation[n];
    }
  }
  const probabilities:Forecast['probabilities']=[];
  const membership=new Map<number,number>();
  const projected:number[][]=[];
  for (let k=0;k<10;k++) {
    const recent=prior(cs,k+1,start+duration/2);
    const evidence=totals[k];
    // The pseudo-count keeps the small archive from treating novel games as impossible.
    const unknown=clamp((unseen[k]+0.14*0.1)/(evidence+0.1),0.035,0.45);
    const fitted=normalized(matrix[k]);
    const empiricalWeight=evidence/(evidence+0.08)*(1-config.persistence);
    const namedMass=1-unknown;
    const ps=recent.map((p,n)=>namedMass*(empiricalWeight*fitted[n]+(1-empiricalWeight)*p));
    projected.push(ps);
    for (let n=0;n<cs.length;n++) {
      const p=Math.floor(ps[n]*1e10)/1e10;
      if (p>0) probabilities.push({universe_id:cs[n].id,place:k+1,p});
      membership.set(cs[n].id,(membership.get(cs[n].id)??0)+p);
    }
  }
  // Select games by expected membership, then order by their conditional place.
  const selected=cs.map((c,n)=>({
    id:c.id,total:membership.get(c.id)??0,
    expected:projected.reduce((sum,p,k)=>sum+(k+1)*p[n],0)/Math.max(1e-12,membership.get(c.id)??0),
  })).sort((a,b)=>b.total-a.total || a.id-b.id).slice(0,10)
    .sort((a,b)=>a.expected-b.expected || b.total-a.total || a.id-b.id);
  return {probabilities,top10:selected.map(x=>x.id)};
}

/** Equal-weight model averaging avoids choosing a winner on three small folds. */
export function forecast(input:Snapshot[],task:Task):Forecast {
  const components=[
    predict(input,task,DEFAULT),
    predict(input,task,{smoothing:0.5,momentum:0,halfLife:120,persistence:0.2}),
    predict(input,task,{smoothing:0.35,momentum:0.2,halfLife:48,persistence:0.2}),
  ];
  const combined=new Map<string,{universe_id:number;place:number;p:number}>();
  for (const f of components) for (const r of f.probabilities) {
    const key=r.place+':'+r.universe_id;
    const row=combined.get(key)??{universe_id:r.universe_id,place:r.place,p:0};
    row.p+=r.p/components.length;combined.set(key,row);
  }
  // A game cannot hold two ranks at once. Excess mass is left to the unnamed
  // alternatives rather than assigned to some other known game without evidence.
  const membership=new Map<number,number>();
  for (const r of combined.values()) membership.set(r.universe_id,(membership.get(r.universe_id)??0)+r.p);
  const probabilities=[...combined.values()].map(r=>({
    ...r,p:Math.floor(r.p/Math.max(1,membership.get(r.universe_id)??1)*1e10)/1e10,
  })).sort((a,b)=>a.place-b.place || a.universe_id-b.universe_id);
  const games=[...membership.keys()].map(id=>{
    const rows=probabilities.filter(r=>r.universe_id===id);
    const total=rows.reduce((s,r)=>s+r.p,0);
    return {id,total,expected:rows.reduce((s,r)=>s+r.place*r.p,0)/Math.max(1e-12,total)};
  }).sort((a,b)=>b.total-a.total || a.id-b.id).slice(0,10)
    .sort((a,b)=>a.expected-b.expected || b.total-a.total || a.id-b.id);
  return {probabilities,top10:games.map(g=>g.id)};
}

export function score(forecast:Forecast,truth:Snapshot[]):{logScore:number;hits:number;agreement:number} {
  const table=Array.from({length:10},()=>new Map<number,number>());
  for (const r of forecast.probabilities) table[r.place-1].set(r.universe_id,r.p);
  let total=0,hits=0,agreement=0,reads=0;
  for (const snapshot of truth) {
    const chart=snapshot.up_and_coming.filter(r=>Number.isSafeInteger(r.universe_id));
    if (chart.length<10) continue;
    const ranked=[...chart].sort((a,b)=>a.rank-b.rank);
    for (let k=0;k<10;k++) {
      const map=table[k], id=ranked[k].universe_id;
      const left=Math.max(0,1-[...map.values()].reduce((a,b)=>a+b,0));
      const unknown=chart.filter(r=>!map.has(r.universe_id)).length;
      const p=map.get(id)??(unknown>0 ? left/unknown : 0);
      total+=Math.log(Math.max(0.0001,p));
      const predicted=forecast.top10.indexOf(id);
      if (predicted>=0) { hits++;agreement+=10-Math.abs(k-predicted); }
    }
    reads++;
  }
  if (!reads) throw new Error('No usable truth snapshots');
  return {logScore:total/reads,hits:hits/reads,agreement:agreement/reads};
}

export function persistence(history:Snapshot[]):Forecast {
  const rows=[...history.at(-1)!.up_and_coming].sort((a,b)=>a.rank-b.rank);
  const probabilities:Forecast['probabilities']=[];
  for (let k=0;k<10;k++) {
    probabilities.push({universe_id:rows[k].universe_id,place:k+1,p:0.5});
    if (k===0) probabilities.push({universe_id:rows[1].universe_id,place:1,p:0.3});
    else {
      probabilities.push({universe_id:rows[k-1].universe_id,place:k+1,p:0.15});
      if (rows[k+1]) probabilities.push({universe_id:rows[k+1].universe_id,place:k+1,p:0.15});
    }
  }
  return {probabilities,top10:rows.slice(0,10).map(r=>r.universe_id)};
}
