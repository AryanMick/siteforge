import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateConfig, NOISE_TYPES } from '../src/config.mjs';
import { presetConfig } from '../src/presets.mjs';
import { generate } from '../src/generator.mjs';
import { serve } from '../src/server.mjs';
import { launchBrowser } from '../src/crawler.mjs';
import { label, json } from '../src/util.mjs';

const out=resolve(process.env.BROWSER_OUT ?? `outputs/browser-${Date.now()}`);
await mkdir(out,{recursive:true});
const browser=await launchBrowser(); const results=[];
try {
  for(const [i,framework] of ['html','react','angular'].entries()) for(const level of ['clean','high']){
    const c=presetConfig(['library','government','university'][i],i);
    c.site.framework=framework; c.site.pageCount=30; c.site.visualStyle=['modern','conventional','legacy'][i]; c.noise={level,types:NOISE_TYPES.filter(type=>type!=='delayed-content'||framework!=='html')};
    const directory=join(out,`${framework}-${level}`);
    const configured=validateConfig(c);
    for(const type of configured.contentTypes){type.fieldLayout='mixed';type.fields.at(-1).optional=true;}
    await generate(configured,directory);
    const truth=JSON.parse(await readFile(join(directory,'private/ground-truth.json'),'utf8'));
    const server=await serve(directory,{port:0}); const page=await browser.newPage(); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    try {
      const details=truth.pages.filter(p=>p.kind==='detail');
      const samples=[...new Set([truth.pages[0],...details.slice(0,3),details.find(p=>p.fieldStates.coverImage==='present'),details.find(p=>p.fieldStates.coverImage==='absent'),truth.pages.find(p=>p.kind==='listing')].filter(Boolean))];
      for(const record of samples){
        await page.goto(server.url+record.url,{waitUntil:'networkidle'});
        if(framework!=='html')await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
        assert.equal((await page.locator('h1').first().innerText()).trim(),record.fields.title);
        for(const [key,value] of Object.entries(record.fields)){
          if(key==='title')continue;
          if(key===record.image?.field){
            const image=page.locator(record.fieldSelectors[key]);
            assert.equal(await image.count(),1,`${framework}/${level}/${record.pageId}/${key} image count`);
            assert.equal(new URL(await image.getAttribute('src'),page.url()).pathname,value,`${framework}/${level}/${record.pageId}/${key} image URL`);
            continue;
          }
          const expectedLabel=record.fieldLabels?.[key]??label(key);
          const actual=await page.locator('#content').evaluate((main,wanted)=>{
            const normalize=text=>text.replace(/\s+/g,' ').trim();
            for(const dt of main.querySelectorAll('dt'))if(normalize(dt.textContent)===wanted)return normalize(dt.nextElementSibling?.textContent??'');
            for(const tr of main.querySelectorAll('tr'))if(normalize(tr.firstElementChild?.textContent??'')===wanted)return normalize(tr.lastElementChild?.textContent??'');
            for(const strong of main.querySelectorAll('p > strong'))if(normalize(strong.textContent).replace(/:$/,'')===wanted)return normalize(strong.parentElement.textContent.slice(strong.textContent.length));
            return null;
          },expectedLabel);
          assert.equal(actual,value.replace(/\s+/g,' ').trim(),`${framework}/${level}/${record.pageId}/${key}`);
        }
        for(const [key,state] of Object.entries(record.fieldStates))if(state==='absent'){
          if(record.fieldSelectors?.[key])assert.equal(await page.locator(record.fieldSelectors[key]).count(),0,`Absent image ${key} rendered`);
          const absent=record.canonicalValues[key];
          const text=await page.locator('#content').innerText();
          if(absent!==undefined)assert(!text.includes(absent),`Omitted ${key} still visible`);
        }
      }
      for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
        await page.setViewportSize(viewport);
        for(const [view,record] of [['home',truth.pages[0]],['detail',truth.pages.find(p=>p.kind==='detail')]]){
          await page.goto(server.url+record.url,{waitUntil:'networkidle'});
          if(framework!=='html')await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
          assert(await page.locator('#content').isVisible());
          assert.equal(await page.locator('main').count(),record.noiseEvents.some(event=>event.type==='missing-main')?0:1);
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${framework}/${level} horizontal overflow at ${viewport.width}`);
          const images=await page.locator('img').evaluateAll(nodes=>nodes.map(n=>({src:n.getAttribute('src'),width:n.naturalWidth,complete:n.complete})));
          const intentionallyBroken=record.noiseEvents.some(event=>event.type==='broken-image');
          const broken=images.filter(image=>/^\/assets\/missing-\d+\.png$/.test(image.src));
          assert.equal(broken.length,intentionallyBroken?1:0,'Image failure must match private truth');
          assert(broken.every(image=>image.width===0&&image.complete),'Broken image unexpectedly loaded');
          assert.equal(images.length,record.image?1:0,'Rendered image presence must match private truth');
          assert(images.filter(image=>!broken.includes(image)).every(image=>image.width>0&&image.complete),'Undeclared bitmap asset failed');
          assert.equal((await page.request.get(server.url+'/assets/collection.png')).status(),200,'Original bitmap must remain available');
          await page.screenshot({path:join(out,`${framework}-${level}-${view}-${viewport.width}.png`),fullPage:true});
        }
      }
      await page.goto(server.url,{waitUntil:'networkidle'});
      if(framework!=='html')await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
      await page.locator(`a[href="${truth.site.navigation[0].href}"]`).first().click();
      await page.waitForURL(`**${truth.site.navigation[0].href}`);
      assert.equal(new URL(page.url()).pathname,truth.site.navigation[0].href);
      assert.equal((await page.request.get(server.url+'/private/ground-truth.json')).status(),404);
      if(framework!=='html'){
        const disabled=await browser.newContext({javaScriptEnabled:false});const raw=await disabled.newPage();
        await raw.goto(server.url+truth.pages.find(p=>p.kind==='detail').url);
        assert.equal(await raw.locator('dl').count(),0,'Client content unexpectedly rendered without JS');await disabled.close();
      }
      assert.deepEqual(errors,[],`${framework} console errors`);
      const result={framework,noise:level,fieldLayouts:['definition-list','table','paragraphs'],optionalFields:true,viewports:[1440,390],sampledPages:samples.length,fieldTruthVerified:true,imageStatesMatchTruth:true,navigationWorks:true,privateTruthNotServed:true,errors};
      results.push(result); console.log(`${framework}/${level}: PASS`);
    } finally {await page.close();await server.close();}
  }
} finally {await browser.close();}
await writeFile(join(out,'browser-results.json'),json({results}));
console.log(`Browser evidence: ${out}`);
