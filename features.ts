import type {Snapshot,Game} from './forecast.ts';

const HOUR=3600000;
const clip=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const median=(xs:number[])=>{
  const a=[...xs].sort((x,y)=>x-y);
  return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : 0;
};
export interface Signals {growth:number;audience:number;burnout:number;trending:number;tenure:number}

/** Weighted daily slope, with a ridge and exposure weights for irregular reads. */
function slope(points:{hours:number;value:number;weight:number}[]):number {
  if(points.length<2) return 0;
  let sw=0,sx=0,sy=0,sxx=0,sxy=0;
  for(const p of points) {
    const x=p.hours/24,w=p.weight;
    sw+=w;sx+=w*x;sy+=w*p.value;sxx+=w*x*x;sxy+=w*x*p.value;
  }
  const span=points.at(-1)!.hours-points[0].hours;
  return clip((sxy-sx*sy/sw)/(sxx-sx*sx/sw+0.08),-2,2)*Math.min(1,span/12);
}

/** Signals use only the given prefix. Player growth is relative to the chart's
 * median audience to remove much of the shared daily activity cycle. */
export function marketSignals(history:Snapshot[],memory=36):Map<number,Signals> {
  const latest=history.at(-1)!, now=Date.parse(latest.at);
  const records=history.map((s,i)=>{
    const before=i ? Date.parse(s.at)-Date.parse(history[i-1].at) : 6*HOUR;
    const after=i+1<history.length ? Date.parse(history[i+1].at)-Date.parse(s.at) : before;
    const rows=new Map(s.up_and_coming.map(r=>[r.universe_id,r]));
    const activity=median(s.up_and_coming.filter(r=>typeof r.playing==='number'&&r.playing!>=0)
      .map(r=>Math.log(100+r.playing!)));
    return {at:Date.parse(s.at),rows,activity,exposure:clip((before+after)/(2*HOUR),0.5,12)};
  });
  const available=latest.up_and_coming.filter(r=>typeof r.playing==='number'&&r.playing!>=0);
  const xs=available.map(r=>Math.log(r.rank+0.5)),ys=available.map(r=>Math.log(r.playing!+100));
  const mx=xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length),my=ys.reduce((a,b)=>a+b,0)/Math.max(1,ys.length);
  let xx=1,xy=0;
  for(let i=0;i<xs.length;i++) {xx+=(xs[i]-mx)**2;xy+=(xs[i]-mx)*(ys[i]-my);}
  const b=xy/xx;
  const trend=(latest as Snapshot&{top_trending?:Game[]|null}).top_trending??[];
  const current=new Set(latest.up_and_coming.map(r=>r.universe_id));
  const trendOrder=trend.filter(r=>current.has(r.universe_id)).sort((a,b)=>a.rank-b.rank);
  const trendRanks=new Map(trendOrder.map((r,i)=>[r.universe_id,i+1]));
  const result=new Map<number,Signals>();
  for(const game of latest.up_and_coming) {
    const pts=records.filter(r=>(now-r.at)/HOUR<=memory).flatMap(r=>{
      const row=r.rows.get(game.universe_id);
      if(typeof row?.playing!=='number'||row.playing<0) return [];
      const hours=(r.at-now)/HOUR;
      return [{hours,value:Math.log(row.playing+100)-r.activity,
        weight:r.exposure*Math.exp(hours/(memory/2))}];
    });
    let held=0;
    if(game.rank<=3) {
      for(let i=records.length-1;i>=0;i--) {
        const rank=records[i].rows.get(game.universe_id)?.rank;
        if(rank===undefined||rank>3) break;
        held=(now-records[i].at)/HOUR;
      }
    }
    const first=records.find(r=>r.rows.has(game.universe_id))!;
    const age=(now-first.at)/HOUR;
    const audience=typeof game.playing==='number'&&game.playing>=0
      ? clip((Math.log(game.playing+100)-my-b*(Math.log(game.rank+0.5)-mx))/1.5,-2,2) : 0;
    const tr=trendRanks.get(game.universe_id);
    result.set(game.universe_id,{
      growth:slope(pts),audience,
      burnout:clip(held/48,0,2)/(game.rank**0.4),
      trending:tr===undefined ? 0 : clip(Math.log((game.rank+0.5)/(tr+0.5)),-2,2),
      tenure:clip(age/120,0,2),
    });
  }
  return result;
}
