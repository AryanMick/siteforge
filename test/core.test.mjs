import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, symlink, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { validateConfig, PROFILES } from '../src/site/config.mjs';
import { presetConfig, DOMAINS } from '../src/site/presets.mjs';
import { createModel } from '../src/site/model.mjs';
import { applyDataNoise, applyHtmlNoise } from '../src/noise/noise.mjs';
import { generate, listFiles } from '../src/site/generator.mjs';
import { serve } from '../src/preview/server.mjs';
import { crawl, extractPublicPage } from '../src/crawl/crawler.mjs';
import { renderPage } from '../src/render/renderers.mjs';
import { walk, textContent, hash } from '../src/site/util.mjs';

const execFileAsync = promisify(execFile);

function config(pages=50) { const c=presetConfig('library'); c.site.pageCount=pages; c.site.visualStyle='modern'; return validateConfig(c); }
test('config rejects unknown values, invalid relations, duplicate fields and invalid counts',()=>{
  for (const patch of [{ site:{...config().site,pageCount:1} },{site:{...config().site,framework:'fake'}},{noise:{level:'clean',probability:0.5}},{site:{...config().site,baseUrl:'https://example.com/path'}}]) assert.throws(()=>validateConfig({...config(),...patch}));
  const c=config(); c.contentTypes[0].relationTo='missing'; assert.throws(()=>validateConfig(c),/relation/);
  c.contentTypes[0].relationTo='author'; c.contentTypes[0].fields.push(c.contentTypes[0].fields[0]); assert.throws(()=>validateConfig(c),/Duplicate/);
  const duplicateLabel=config();duplicateLabel.contentTypes[0].label=duplicateLabel.contentTypes[1].label;assert.throws(()=>validateConfig(duplicateLabel),/unique URL/);
});
test('noise logs contain only eligible duplicate-ID transformations',()=>{
  const c=validateConfig({...config(),noise:{level:'custom',probability:1,maxPerPage:12,types:['duplicate-id','missing-field']}});
  const model=createModel(c);
  for(const p of model.pages.map(p=>applyDataNoise(p,model.site))){
    if(p.noiseEvents.some(e=>e.type==='duplicate-id'))assert(Object.keys(p.fields).filter(k=>k!=='title').length>=2);
    if(p.kind==='listing')assert(!p.noiseEvents.some(e=>e.type==='duplicate-id'));
  }
});
test('invalid crawl timing fails at boundary',async()=>{
  await assert.rejects(crawl('http://localhost',{waitMs:-1}),/waitMs/);
  await assert.rejects(crawl('http://localhost',{timeoutMs:0}),/timeoutMs/);
});
test('all domain presets have exact page counts and reachable links across boundary sizes',()=>{
  for (const domain of DOMAINS) for (const count of [12,13,26,99,100,101,500]) {
    const c=presetConfig(domain); c.site.pageCount=count; const model=createModel(validateConfig(c));
    assert.equal(model.pages.length,count);
    const urls=new Set(model.pages.map(p=>p.url));
    const byUrl=new Map(model.pages.map(p=>[p.url,p])); const reached=new Set(['/']); const queue=['/'];
    for(let i=0;i<queue.length;i++) for(const link of [...model.site.navigation,...byUrl.get(queue[i]).links]) { assert(urls.has(link.href),link.href); if(!reached.has(link.href)){reached.add(link.href);queue.push(link.href);} }
    assert.equal(reached.size,count,`${domain} ${count}`);
    for(const p of model.pages) for(const r of p.relationships) assert(urls.has(r.targetUrl));
  }
});
test('seeded canonical data remains unchanged by noise levels',()=>{
  const c=config(); const a=createModel(c); const b=createModel(validateConfig({...c,noise:{level:'high'}}));
  assert.deepEqual(a.pages,b.pages); assert.deepEqual(a.pages,createModel(c).pages);
  assert.notDeepEqual(a.pages,createModel({...c,seed:1}).pages);
  const dirty=a.pages.map(p=>applyDataNoise(p,b.site)); assert.deepEqual(a.pages,createModel(c).pages);
  assert(dirty.some(p=>p.noiseEvents.length));
  for(const p of dirty) for(const [k,state] of Object.entries(p.fieldStates)) if(state==='absent') {
    assert(!(k in p.fields));
    if(a.pages.find(source=>source.pageId===p.pageId).fieldStates[k]==='present') assert(k in p.canonicalValues);
  }
});
test('structural noise preserves expected field values through HTML parser recovery',()=>{
  const c=validateConfig({...config(),noise:{level:'custom',probability:1,maxPerPage:12,types:['extra-wrapper','class-churn','inline-style','reorder-fields','duplicate-id','malformed-nesting']}});
  const model=createModel(c);
  for(const canonical of model.pages){
    const p=applyDataNoise(canonical,model.site); const html=applyHtmlNoise(renderPage(model.site,p),p,model.site); const actual=extractPublicPage(html,p.url);
    const scalarFields = Object.fromEntries(Object.entries(p.fields).filter(([key])=>key!==p.image?.field));
    assert.deepEqual(actual.record.fields,scalarFields,p.url);
    if(p.image?.field) assert.match(html,new RegExp(`data-field="${p.image.field}"`),p.url);
  }
});
test('noise severity and selection are reproducible and profiles increase event volume',()=>{
  const counts=[];
  for(const level of ['clean','low','medium','high']){const model=createModel(validateConfig({...config(100),noise:{level}})); const pages=model.pages.map(p=>applyDataNoise(p,model.site)); assert.deepEqual(pages,model.pages.map(p=>applyDataNoise(p,model.site))); counts.push(pages.reduce((n,p)=>n+p.noiseEvents.length,0));}
  assert.equal(counts[0],0); assert(counts.every((n,i)=>i===0||n>=counts[i-1]));
});
test('generated clean and noisy files reproduce and private answers cannot be served',async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'siteforge-test-'));
  t.after(async()=>rm(root,{recursive:true,force:true}));
  const c=config(30);
  const a=await generate(c,join(root,'a')); const b=await generate(c,join(root,'b'));
  assert.equal(a.canonicalSha256,b.canonicalSha256);
  const ma=JSON.parse(await readFile(join(root,'a/private/manifest.json'))), mb=JSON.parse(await readFile(join(root,'b/private/manifest.json')));
  assert.deepEqual(ma,mb);
  await assert.rejects(generate(c,join(root,'a')),/already exists/);
  for(const file of await listFiles(join(root,'a/public'))) if(/\.(html|js|json)$/.test(file)){const s=await readFile(join(root,'a/public',file),'utf8');for(const term of ['expectedCluster','canonicalValues','noiseEvents','pageId','ground-truth'])assert(!s.includes(term),`${file} leaked ${term}`);}
  await symlink(join(root,'a/private/ground-truth.json'),join(root,'a/public/leaked.json'));
  const server=await serve(join(root,'a'),{port:0});
  try {
    assert.equal((await fetch(server.url)).status,200);
    for(const path of ['/private/ground-truth.json','/../private/ground-truth.json','/%2e%2e/private/ground-truth.json','/leaked.json']) assert.equal((await fetch(server.url+path)).status,404);
    const actual=await crawl(server.url,{maxPages:c.site.pageCount});
    assert.equal(actual.pages.length,c.site.pageCount); assert.equal(actual.crawl.failures.length,0); assert.equal(actual.crawl.truncated,false);
  } finally {await server.close();}
});
test('CLI run saves portable observations that evaluate identically after its server stops',async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'siteforge-cli-'));
  t.after(async()=>rm(root,{recursive:true,force:true}));
  const output=join(root,'run');
  const cli=fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const configFile=join(root,'config.json');
  await writeFile(configFile,JSON.stringify(config(30)));
  await execFileAsync(process.execPath,[cli,'run',configFile,'--out',output]);
  const actualPath=join(output,'private/baseline-actual.json');
  const actual=JSON.parse(await readFile(actualPath,'utf8'));
  assert(actual.pages.every(page=>page.url.startsWith('/')));
  const original=JSON.parse(await readFile(join(output,'private/report/report.json'),'utf8'));
  const reportDir=join(root,'rescored');
  await execFileAsync(process.execPath,[cli,'evaluate','--truth',join(output,'private/ground-truth.json'),'--actual',actualPath,'--out',reportDir]);
  const rescored=JSON.parse(await readFile(join(reportDir,'report.json'),'utf8'));
  assert.equal(rescored.coverage.recall,1);
  assert.deepEqual(rescored.coverage,original.coverage);
  assert.deepEqual(rescored.clustering,original.clustering);
  assert.deepEqual(rescored.fields,original.fields);
});
test('CLI batch and pair reject existing roots before writing and accept fresh roots',async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'siteforge-output-'));
  t.after(async()=>rm(root,{recursive:true,force:true}));
  const cli=fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const configFile=join(root,'config.json');
  const suiteFile=join(root,'suite.json');
  await writeFile(configFile,JSON.stringify(config(12)));
  await writeFile(suiteFile,JSON.stringify({version:1,siteCount:2,pagesPerSite:12}));
  for(const [command,input] of [['pair',configFile],['batch',suiteFile]]){
    const existing=join(root,`${command}-existing`);
    await mkdir(existing);await writeFile(join(existing,'keep.txt'),'unchanged');
    await assert.rejects(execFileAsync(process.execPath,[cli,command,input,'--out',existing]),/already exists/);
    assert.deepEqual(await readdir(existing),['keep.txt']);
    assert.equal(await readFile(join(existing,'keep.txt'),'utf8'),'unchanged');
    const fresh=join(root,`${command}-fresh`);
    await execFileAsync(process.execPath,[cli,command,input,'--out',fresh]);
    if(command==='batch'){
      const summary=JSON.parse(await readFile(join(fresh,'batch-summary.json'),'utf8'));
      assert.equal(summary.sites,2);assert.equal(summary.pages,24);
    }else{
      const clean=JSON.parse(await readFile(join(fresh,'clean/private/manifest.json'),'utf8'));
      const noisy=JSON.parse(await readFile(join(fresh,'noisy/private/manifest.json'),'utf8'));
      assert.equal(clean.canonicalSha256,noisy.canonicalSha256);
    }
  }
});
