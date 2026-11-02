import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { stringify } from 'yaml';
import { crawlSite } from './real-crawler.mjs';
import { clusterPages } from './page-clusters.mjs';
import { createLegacyFixture } from './legacy-fixture.mjs';
import { auditLocalContrast } from './contrast-audit.mjs';
import { DEFAULT_NOISE_TYPES, validateConfig } from './config.mjs';
import { generate } from './generator.mjs';
import { serve } from './server.mjs';
import { evaluate, writeReports } from './evaluator.mjs';
import { hash, json, escapeHtml } from './util.mjs';

export const ISSUE_TO_NOISE = Object.freeze({
  'deep-wrapper-tree': 'deep-wrapper-tree',
  'duplicate-id': 'duplicate-id',
  'frame-missing-title': 'frame-missing-title',
  'html-parse-error': 'malformed-nesting',
  'image-missing-alt': 'image-missing-alt',
  'inline-style': 'inline-style',
  'javascript-only-link': 'javascript-only-link',
  'legacy-color-attribute': 'legacy-color-attribute',
  'legacy-font': 'obsolete-markup',
  'missing-doctype': 'legacy-document',
  'missing-lang': 'legacy-document',
  'missing-main': 'missing-main',
  'onclick-navigation-signal': 'onclick-navigation',
});

export function buildBlueprint(crawl,clusters,{pageCount=30,seed=48291}={}){
  if(!crawl.pages.length)throw new Error('Cannot infer a blueprint without analyzed pages');
  const issueCounts={};
  for(const page of crawl.pages)for(const issue of page.issues??[])issueCounts[issue.code]=(issueCounts[issue.code]??0)+issue.count;
  const contentTypes=clusters.clusters.slice(0,6).map((cluster,index)=>{
    const names=[...new Set((cluster.commonFields??[]).map(f=>typeof f==='string'?f:f.name).filter(Boolean))]
      .filter(name=>/^[A-Za-z][A-Za-z0-9_]{0,48}$/.test(name)&&!['title','constructor','prototype','__proto__'].includes(name)).slice(0,12);
    return {name:`pattern${index+1}`,label:`Pattern ${index+1}`,weight:Math.max(1,Math.min(100,cluster.count)),fields:[{name:'title',type:'title'},...(names.length?names:['summary']).map(name=>({name,type:/date|deadline/i.test(name)?'date':'text'}))]};
  });
  const oldIndicators=Object.keys(issueCounts).some(code=>/legacy|obsolete|table.layout|presentational/i.test(code));
  const mappedNoiseTypes=[...new Set(Object.keys(issueCounts).map(code=>ISSUE_TO_NOISE[code]).filter(Boolean))];
  const noiseTypes=[...new Set([...DEFAULT_NOISE_TYPES.filter(type=>type!=='delayed-content'),...mappedNoiseTypes])];
  const config=validateConfig({version:1,seed,site:{id:'reference-inspired',name:'Fictional Reference Archive',domain:'library',framework:'html',visualStyle:oldIndicators?'legacy':'conventional',pageCount},contentTypes,variation:{amount:70},noise:{level:'clean',types:noiseTypes}});
  return {config,provenance:{sourceOrigin:new URL(crawl.startUrl).origin,sourceUrls:crawl.pages.map(p=>p.url),sourceHashes:crawl.pages.map(p=>({url:p.url,sha256:p.fetch.sha256})),inferredClusterCount:clusters.clusters.length,retainedSyntheticTypes:contentTypes.length,issueCounts,mappedNoiseTypes,unmappedIssueCodes:Object.keys(issueCounts).filter(code=>!ISSUE_TO_NOISE[code]),requiresHumanReview:true,
    note:'Only inferred field names, relative pattern frequencies and broad visual-era indicators inform this draft. No real prose, people, branding, or HTML is copied. Real cluster assignments are not ground truth; synthetic pattern labels become construction-time truth for the new fictional corpus. Mapped noise operators are test settings, not a replay or measured prevalence of the observed defects.'}};
}

export async function analyzeLocal(directory,{threshold=0.32,maxPages=100}={}){
  const server=await serve(directory,{port:0});
  try{
    const observed=await crawlSite(server.url,{allowLocal:true,delayMs:0,maxPages,maxDepth:10,maxTimeMs:60000,maxDiscovered:1500,maxTotalBytes:20000000});
    const clustered=clusterPages(observed.pages,{threshold});
    const predictions={version:1,pages:clustered.pages.map(page=>({...page,url:new URL(page.url).pathname+new URL(page.url).search}))};
    const truth=JSON.parse(await readFile(join(directory,'private/ground-truth.json'),'utf8'));
    const report=evaluate(truth,predictions);
    await writeFile(join(directory,'private/crawl.json'),json(observed));
    await writeFile(join(directory,'private/predictions.json'),json(predictions));
    await writeFile(join(directory,'private/clusters.json'),json(clustered));
    await writeReports(report,join(directory,'private/score'));
    return {crawl:observed.summary,clusterCount:clustered.clusters.length,coverage:report.coverage.recall,pairwiseF1:report.clustering.allExpected.pairs.f1,adjustedRandIndex:report.clustering.allExpected.adjustedRandIndex,fieldValueF1:report.fields.values?.f1??null};
  }finally{await server.close();}
}

export async function runSiteStudy(url,out,options={}){
  const {threshold=0.32,syntheticPages=30,contrast=true,localExample=true,...crawlOptions}=options;
  if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw new Error('threshold must be in [0,1]');
  if(!Number.isInteger(syntheticPages)||syntheticPages<13||syntheticPages>100)throw new Error('Study syntheticPages must be 13..100; use the generator for larger runs');
  const output=resolve(out);await mkdir(dirname(output),{recursive:true});
  try{await mkdir(output);}catch(error){if(error.code==='EEXIST')throw new Error(`Output already exists: ${output}`);throw error;}
  const started=Date.now();
  try{
    console.log(`Crawling one site: ${url}`);
    const crawl=await crawlSite(url,crawlOptions);
    const clusters=clusterPages(crawl.pages,{threshold});
    await writeFile(join(output,'crawl.json'),json(crawl));
    await writeFile(join(output,'clusters.json'),json(clusters));
    await writeFile(join(output,'predictions.json'),json({version:1,pages:clusters.pages}));
    console.log(`Observed ${crawl.pages.length} pages; inferred ${clusters.clusters.length} clusters.`);
    const study={version:1,url,threshold,real:{crawl:crawl.summary,robots:crawl.robots.status,clusters:clusters.clusters,issues:[]},synthetic:null,legacy:null,
      warning:'Real-site clusters are predictions, not known answers. Scores below apply only to separately constructed fictional pages.'};
    const counts={};for(const page of crawl.pages)for(const issue of page.issues??[])counts[issue.code]=(counts[issue.code]??0)+issue.count;
    study.real.issues=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([code,count])=>({code,count}));
    if(crawl.pages.length){
      const blueprint=buildBlueprint(crawl,clusters,{pageCount:syntheticPages});
      const editableBlueprint=structuredClone(blueprint.config);
      editableBlueprint.noise={level:'clean',types:blueprint.config.noise.types};
      await writeFile(join(output,'blueprint.yaml'),stringify(editableBlueprint));
      await writeFile(join(output,'blueprint-review.json'),json(blueprint.provenance));
      const variants=[];
      const levels=blueprint.provenance.mappedNoiseTypes.length?['clean','high','targeted']:['clean','high'];
      for(const level of levels){
        const config=structuredClone(blueprint.config);
        config.noise=level==='targeted'
          ? {level:'custom',probability:1,severity:2,maxPerPage:blueprint.provenance.mappedNoiseTypes.length,types:blueprint.provenance.mappedNoiseTypes}
          : {level,types:blueprint.config.noise.types};
        const directory=join(output,'synthetic',level);
        const generated=await generate(config,directory);const scored=await analyzeLocal(directory,{threshold,maxPages:syntheticPages});
        const truth=JSON.parse(await readFile(join(directory,'private','answer-key.json'),'utf8'));
        const appliedNoiseTypes=[...new Set(truth.pages.flatMap(page=>page.noiseEvents.map(event=>event.type)))].sort();
        variants.push({level,canonicalSha256:generated.canonicalSha256,events:generated.noiseEvents,appliedNoiseTypes,unappliedConfiguredTypes:config.noise.types.filter(type=>!appliedNoiseTypes.includes(type)),...scored});
        console.log(`Fictional ${level}: coverage=${scored.coverage}, cluster F1=${scored.pairwiseF1}`);
      }
      if(variants.some(variant=>variant.canonicalSha256!==variants[0].canonicalSha256))throw new Error('Canonical data changed across the fictional variants');
      study.synthetic={pagesPerVariant:syntheticPages,identicalCanonicalData:true,variants};
    }
    if(localExample){
      const directory=join(output,'legacy');await createLegacyFixture(directory);
      const scored=await analyzeLocal(directory,{threshold,maxPages:30});
      study.legacy={...scored,contrast:{status:'not_requested'}};
      if(contrast){
        const server=await serve(directory,{port:0});
        try{study.legacy.contrast=await auditLocalContrast(server.url,['/books/clean/','/books/legacy/'],{outDir:join(output,'screenshots')});}
        finally{await server.close();}
        await writeFile(join(directory,'private/contrast.json'),json(study.legacy.contrast));
      }
      console.log(`Legacy fixture: coverage=${scored.coverage}, cluster F1=${scored.pairwiseF1}; contrast=${study.legacy.contrast.status}`);
    }
    study.status=crawl.pages.length?'completed_with_diagnostics':'failed';
    study.durationMs=Date.now()-started;study.crawlSha256=hash(crawl);
    await writeFile(join(output,'study.json'),json(study));
    await writeFile(join(output,'report.html'),renderStudyReport(study));
    console.log(`Report: ${join(output,'report.html')}`);return {output,study};
  }catch(error){await writeFile(join(output,'failure.json'),json({status:'failed',message:error.message}));throw error;}
}

function renderStudyReport(study){
  const esc=escapeHtml;
  const value=v=>v===null||v===undefined?'Unavailable':typeof v==='number'?v.toFixed(4):esc(String(v));
  const table=(headers,rows)=>`<div class="table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const clusters=table(['Cluster','Pages','Common fields','Example URLs'],study.real.clusters.map(c=>[esc(c.suggestedName??c.id),c.count,esc(JSON.stringify(c.commonFields??[])),c.urls.slice(0,3).map(url=>`<a href="${esc(url)}" rel="noreferrer">${esc(url)}</a>`).join('<br>')]));
  const synthetic=study.synthetic?table(['Variant','Pages observed','Noise events','Applied types','Not applied','Coverage','Pairwise F1','ARI','Value F1'],study.synthetic.variants.map(v=>[esc(v.level),v.crawl.analyzed,v.events,esc(v.appliedNoiseTypes.join(', ')||'None'),esc(v.unappliedConfiguredTypes.join(', ')||'None'),value(v.coverage),value(v.pairwiseF1),value(v.adjustedRandIndex),value(v.fieldValueF1)])):'<p>No fictional corpus was built because no source pages were analyzed.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One-site crawl study</title><style>body{font:15px/1.6 system-ui;color:#20282b;background:#fff;margin:0}main{max-width:1150px;margin:auto;padding:28px}h1{font-size:28px}h2{font-size:21px;margin-top:32px}a{color:#087267;overflow-wrap:anywhere}.table{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #d8dfdf;vertical-align:top;overflow-wrap:anywhere}th{background:#eef3f2}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.notice{border-left:4px solid #a8453c;padding-left:14px}</style></head><body><main><h1>One-site crawl study</h1><p><a href="${esc(study.url)}">${esc(study.url)}</a></p><p class="notice">${esc(study.warning)}</p><h2>1. Actual public crawl</h2><p>${study.real.crawl.analyzed} pages analyzed; ${study.real.clusters.length} inferred clusters; robots policy: ${esc(study.real.robots)}. ${study.real.crawl.counts.failed} failed, ${study.real.crawl.counts.skipped} skipped, ${study.real.crawl.counts.unattempted} unattempted.</p><p>Bounded sample, not a full-site crawl. HTTP mode does not execute JavaScript or measure live-site color contrast.</p>${clusters}<h2>2. Old-HTML indicators observed</h2>${table(['Indicator','Occurrences'],study.real.issues.map(i=>[esc(i.code),i.count]))}<p>Indicators are not a full accessibility audit. Full URL outcomes and fetch diagnostics are in crawl.json.</p><h2>3. Fictional clean/noisy pair</h2>${synthetic}<p>The pair has the same canonical source data. Its answer key was recorded during construction. A predicted pattern from the live site is only inspiration, not proof of the live site's true semantic type.</p><h2>4. Controlled legacy example</h2>${study.legacy?`<p>Coverage ${value(study.legacy.coverage)}; cluster pairwise F1 ${value(study.legacy.pairwiseF1)}. Contrast audit: ${esc(study.legacy.contrast.status)}.</p><details><summary>Rendered contrast results</summary><pre>${esc(JSON.stringify(study.legacy.contrast,null,2))}</pre></details>`:'<p>Not requested.</p>'}<h2>Files</h2><p><a href="study.json">Summary JSON</a> · <a href="crawl.json">Crawl and URL decisions</a> · <a href="clusters.json">Cluster evidence</a> · <a href="blueprint.yaml">Draft synthetic configuration</a></p></main></body></html>`;
}
