import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {forecast as makeForecast,type Snapshot,type Task} from './forecast.ts';

const input=process.env.MAKEFUN_INPUT_DIR??'/input';
const output=process.env.MAKEFUN_OUTPUT_DIR??'/output';
const task=JSON.parse(readFileSync(join(input,'task.json'),'utf8')) as Task;
const history=readFileSync(join(input,'history.ndjson'),'utf8').split('\n')
  .filter(line=>line.trim()!=='').map(line=>JSON.parse(line) as Snapshot);
if (task.output!=='forecast.json') throw new Error('Unexpected forecast output file');
const forecast=makeForecast(history,task);
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'forecast.json'),JSON.stringify(forecast)+'\n');
