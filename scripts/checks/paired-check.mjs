import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../src/site/config.mjs';
import { generate } from '../../src/site/generator.mjs';
import { serve } from '../../src/preview/server.mjs';
import { crawl } from '../../src/crawl/crawler.mjs';
import { evaluate, writeReports } from '../../src/answers/evaluator.mjs';
import { json, escapeHtml } from '../../src/site/util.mjs';

const config=await loadConfig(process.argv[2]??'examples/library.yaml');
const out=resolve(process.argv[3]??`outputs/experiment-${Date.now()}`);
const scores=[]; const digests=[];
for(const level of ['clean','low','medium','high']){
  const c=structuredClone(config);c.noise={level};
  const directory=join(out,level);const generation=await generate(c,directory);digests.push(generation.canonicalSha256);
  const truth=JSON.parse(await readFile(join(directory,'private/ground-truth.json'),'utf8'));
  const server=await serve(directory,{port:0});
  try{
    for(const strategy of ['fields','structure']){
      const actual=await crawl(server.url,{mode:config.site.framework==='html'?'http':'browser',strategy,maxPages:config.site.pageCount,waitMs:700});
      for(const page of actual.pages) {const u=new URL(page.url);page.url=u.pathname+u.search;}
      await writeFile(join(directory,`private/${strategy}-actual.json`),json(actual));
      const report=evaluate(truth,actual);await writeReports(report,join(directory,'private',strategy));
      scores.push({noise:level,strategy,coverage:report.coverage.recall,pairwiseF1:report.clustering.allExpected.pairs.f1,ari:report.clustering.allExpected.adjustedRandIndex,fieldValueF1:report.fields.values?.f1??null,events:generation.noiseEvents});
      console.log(json(scores.at(-1)));
    }
  }finally{await server.close();}
}
assert.equal(new Set(digests).size,1,'Noise levels changed canonical content');
for(const row of scores){const baseline=scores.find(s=>s.strategy===row.strategy&&s.noise==='clean');row.deltaFromClean={pairwiseF1:row.pairwiseF1===null||baseline.pairwiseF1===null?null:row.pairwiseF1-baseline.pairwiseF1,fieldValueF1:row.fieldValueF1===null||baseline.fieldValueF1===null?null:row.fieldValueF1-baseline.fieldValueF1};}
await writeFile(join(out,'comparison.json'),json({canonicalSha256:digests[0],note:'Included public-only baseline, not Brad\'s product. All other settings held constant.',scores}));
const cell=v=>v===null?'Unavailable':typeof v==='number'?v.toFixed(4):escapeHtml(v);
const keys=['noise','strategy','coverage','pairwiseF1','ari','fieldValueF1','events'];
await writeFile(join(out,'comparison.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paired experiment</title><style>body{font:15px/1.5 system-ui;margin:32px;color:#20292d}table{border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #d7ddda;text-align:left}main{overflow:auto}h1{font-size:24px}</style><h1>Paired noise experiment</h1><p>Public-only demonstration baselines; identical source content across noise levels.</p><main><table><thead><tr>${keys.map(k=>`<th>${escapeHtml(k)}</th>`).join('')}</tr></thead><tbody>${scores.map(row=>`<tr>${keys.map(k=>`<td>${cell(row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></main></html>`);
console.log(`Matched comparison: ${out}/comparison.html`);
