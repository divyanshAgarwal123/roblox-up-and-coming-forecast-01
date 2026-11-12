import type {Snapshot} from './forecast.ts';
import {marketSignals} from './features.ts';
const HOUR=3600000;
const clip=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));

function vectors(history:Snapshot[]):Map<number,number[]> {
  const last=history.at(-1)!,now=Date.parse(last.at),signals=marketSignals(history);
  const previous=(hours:number)=>history.slice(0,-1)
    .filter(s=>(now-Date.parse(s.at))/HOUR>=6)
    .sort((a,b)=>Math.abs((now-Date.parse(a.at))/HOUR-hours)-Math.abs((now-Date.parse(b.at))/HOUR-hours))[0];
  const short=previous(24),long=previous(60);
  const map=(s:Snapshot|undefined)=>new Map((s?.up_and_coming??[]).map(r=>[r.universe_id,r]));
  const sm=map(short),lm=map(long);
  const result=new Map<number,number[]>();
  for(const row of last.up_and_coming) {
    const motion=(s:Snapshot|undefined,m:typeof sm)=>{
      const before=m.get(row.universe_id);
      return before&&s ? clip(Math.log((row.rank+0.5)/(before.rank+0.5))*24/
        Math.max(8,(now-Date.parse(s.at))/HOUR),-2,2) : 0;
    };
    const v=motion(short,sm),slow=motion(long,lm),s=signals.get(row.universe_id)!;
    result.set(row.universe_id,[1,Math.log(row.rank+0.5)/3,v,slow,s.growth,s.audience,
      s.burnout,s.trending,s.tenure,clip(v-slow,-2,2)]);
  }
  return result;
}

function solve(matrix:number[][],rhs:number[]):number[] {
  const a=matrix.map((row,i)=>[...row,rhs[i]]),n=rhs.length;
  for(let k=0;k<n;k++) {
    let pivot=k;
    for(let i=k+1;i<n;i++) if(Math.abs(a[i][k])>Math.abs(a[pivot][k])) pivot=i;
    [a[k],a[pivot]]=[a[pivot],a[k]];
    if(Math.abs(a[k][k])<1e-12) return new Array(n).fill(0);
    const scale=a[k][k];for(let j=k;j<=n;j++) a[k][j]/=scale;
    for(let i=0;i<n;i++) if(i!==k) {
      const factor=a[i][k];for(let j=k;j<=n;j++) a[i][j]-=factor*a[k][j];
    }
  }
  return a.map(row=>row[n]);
}

/** Fit drift only to origin/outcome pairs within the supplied historical prefix.
 * Regularization is proportional to total sample weight, not recorder frequency. */
export function fittedDrift(history:Snapshot[],ridge=0.08):{drifts:Map<number,number>;coefficients:number[]} {
  const n=10,xx=Array.from({length:n},()=>new Array(n).fill(0)),xy=new Array(n).fill(0);
  const end=Date.parse(history.at(-1)!.at),cache=history.map((_,i)=>vectors(history.slice(0,i+1)));
  const maps=history.map(s=>new Map(s.up_and_coming.map(r=>[r.universe_id,r])));
  let weightSum=0;
  for(let i=2;i<history.length-1;i++) {
    const origin=history[i],at=Date.parse(origin.at);
    const aGap=clip((at-Date.parse(history[i-1].at))/HOUR,1,12);
    for(let j=i+1;j<history.length;j++) {
      const bt=Date.parse(history[j].at),h=(bt-at)/HOUR;
      if(h<12||h>96) continue;
      const exposure=aGap*clip((bt-Date.parse(history[j-1].at))/HOUR,1,12);
      const pairWeight=exposure*Math.exp(-(end-bt)/(120*HOUR))*Math.exp(-0.5*((h-42)/30)**2);
      const projected=1.5*(1-Math.exp(-h/36));
      for(const row of origin.up_and_coming.slice(0,70)) {
        const x=cache[i].get(row.universe_id)!;
        const after=maps[j].get(row.universe_id)?.rank??130;
        const y=clip(Math.log((after+0.5)/(row.rank+0.5))/projected,-3,3);
        const weight=pairWeight/Math.sqrt(row.rank+2);
        weightSum+=weight;
        for(let u=0;u<n;u++) {
          xy[u]+=weight*x[u]*y;
          for(let v=0;v<=u;v++) xx[u][v]+=weight*x[u]*x[v];
        }
      }
    }
  }
  for(let u=0;u<n;u++) {
    for(let v=0;v<u;v++) xx[v][u]=xx[u][v];
    xx[u][u]+=Math.max(1,weightSum)*ridge*(u===0?0.1:1);
  }
  const coefficients=solve(xx,xy),drifts=new Map<number,number>();
  for(const [id,x] of cache.at(-1)!) drifts.set(id,clip(x.reduce((s,v,i)=>s+v*coefficients[i],0),-2,2));
  return {drifts,coefficients};
}
