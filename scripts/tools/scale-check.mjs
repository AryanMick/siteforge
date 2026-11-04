import { performance } from 'node:perf_hooks';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generate } from '../../src/site/generator.mjs';
import { DOMAINS, presetConfig } from '../../src/site/presets.mjs';
import { json } from '../../src/site/util.mjs';

const siteCount=Number(process.env.BENCH_SITES ?? 200);
const pagesPerSite=Number(process.env.BENCH_PAGES ?? 250);
if(!Number.isInteger(siteCount)||siteCount<1||siteCount>1000)throw new Error('BENCH_SITES must be 1..1000');
const out=resolve(process.env.BENCH_OUT ?? `outputs/scale-${Date.now()}`);
const started=performance.now(); let pages=0; const results=[];
for(let i=0;i<siteCount;i++){
  const c=presetConfig(DOMAINS[i%DOMAINS.length],i); c.site.pageCount=pagesPerSite;
  const result=await generate(c,join(out,c.site.id)); pages+=result.pageCount; results.push(result);
  if((i+1)%10===0) console.log(`${i+1}/${siteCount} sites, ${pages} pages, ${Math.round(performance.now()-started)}ms`);
}
const report={sites:siteCount,pages,frameworks:['html','react','angular'],durationMs:Math.round(performance.now()-started),peakRssBytes:process.resourceUsage().maxRSS*1024,node:process.version,platform:process.platform,architecture:process.arch,results};
await writeFile(join(out,'scale-report.json'),json(report));
console.log(json({...report,results:undefined,out}));
