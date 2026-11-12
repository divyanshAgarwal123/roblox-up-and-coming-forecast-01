import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {forecast as previous,score,persistence} from './forecast.ts';
import {forecast as v2,enhancedForecast as forecast} from './dynamics.ts';
const input=process.argv[2]??process.env.MAKEFUN_INPUT_DIR??'/input';
const history=readFileSync(join(input,'history.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
const H=3600000,first=Date.parse(history[0].at),last=Date.parse(history.at(-1).at),results=[];
for(let cutoff=first+48*H;cutoff+72*H<=last;cutoff+=12*H) {
 const train=history.filter(s=>Date.parse(s.at)<cutoff);
 const truth=history.filter(s=>Date.parse(s.at)>=cutoff&&Date.parse(s.at)<cutoff+72*H);
 const task={history_until:new Date(cutoff).toISOString(),window:{from:new Date(cutoff).toISOString(),until:new Date(cutoff+72*H).toISOString()},places:10,output:'forecast.json'};
 const scores={
  persistence:score(persistence(train),truth),
  previous:score(previous(train,task),truth),
  v2:score(v2(train,task),truth),
  revised:score(forecast(train,task),truth),
 };
 results.push({cutoff:task.history_until,training_reads:train.length,test_reads:truth.length,scores});
}
const summary=Object.fromEntries(['persistence','previous','v2','revised'].map(name=>[
 name,{mean:results.reduce((s,r)=>s+r.scores[name].logScore,0)/results.length},
]));
console.log(JSON.stringify({results,summary,limitation:'Overlapping development windows, not an independent holdout or official practice grade.'},null,2));
