import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLegacyFixture } from '../src/legacy-fixture.mjs';
import { serve } from '../src/server.mjs';
import { buildBlueprint, runSiteStudy } from '../src/site-study.mjs';

test('sample issue categories select matching fictional obstacles without copying content', () => {
  const crawl = { startUrl: 'https://archive.example.test/records/', pages: [{
    url: 'https://archive.example.test/records/item', fetch: { sha256: 'sample-hash' },
    issues: ['deep-wrapper-tree', 'javascript-only-link', 'missing-main', 'frame-missing-title', 'unknown-layout']
      .map(code => ({ code, count: 1 })),
  }] };
  const clusters = { clusters: [{ count: 1, commonFields: ['title', 'dateCreated'] }] };
  const { config, provenance } = buildBlueprint(crawl, clusters, { pageCount: 13 });
  for (const type of ['deep-wrapper-tree', 'javascript-only-link', 'missing-main', 'frame-missing-title']) assert(config.noise.types.includes(type));
  assert.deepEqual(provenance.unmappedIssueCodes, ['unknown-layout']);
  assert.equal(config.variation.amount, 70);
  assert.equal(config.site.name, 'Fictional Reference Archive');
  assert(!JSON.stringify(config).includes('archive.example.test'));
});

test('one-site study connects public inference to new source-first fiction without copying source values',async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'siteforge-study-'));
  t.after(async()=>rm(root,{recursive:true,force:true}));
  const fixture=join(root,'source');await createLegacyFixture(fixture);
  const server=await serve(fixture,{port:0});
  try{
    const out=join(root,'study');
    const {study}=await runSiteStudy(server.url,out,{maxPages:6,allowLocal:true,delayMs:0,maxTimeMs:30000,syntheticPages:13,contrast:false});
    assert(study.real.crawl.analyzed>0);assert(study.real.crawl.analyzed<=6);
    assert.equal(study.synthetic.identicalCanonicalData,true);
    for(const variant of study.synthetic.variants)assert.equal(variant.coverage,1);
    assert.equal(study.legacy.coverage,1);assert.equal(study.legacy.contrast.status,'not_requested');
    const blueprint=await readFile(join(out,'blueprint.yaml'),'utf8');
    assert(!blueprint.includes('Mara Vale'));assert(!blueprint.includes('The Wind at Harbor'));
    assert(!blueprint.includes('maxPerPage: 0'));
    const provenance=JSON.parse(await readFile(join(out,'blueprint-review.json'),'utf8'));
    assert.equal(provenance.requiresHumanReview,true);
    assert(provenance.sourceUrls.every(url=>new URL(url).origin===server.url));
    if(provenance.mappedNoiseTypes.length){
      const targeted=study.synthetic.variants.find(variant=>variant.level==='targeted');
      assert(targeted);
      assert.equal(targeted.canonicalSha256,study.synthetic.variants[0].canonicalSha256);
      assert(targeted.appliedNoiseTypes.every(type=>provenance.mappedNoiseTypes.includes(type)));
    }
    const highConfig=JSON.parse(await readFile(join(out,'synthetic','high','private','config.json'),'utf8'));
    assert.deepEqual(highConfig.noise.types, [...new Set(['extra-wrapper', 'class-churn', 'inline-style', 'reorder-fields', 'boilerplate', 'missing-field', 'label-variation', 'date-format', 'malformed-nesting', 'duplicate-id', 'missing-metadata', ...provenance.mappedNoiseTypes])]);
    const highTruth=JSON.parse(await readFile(join(out,'synthetic','high','private','answer-key.json'),'utf8'));
    assert(highTruth.pages.some(page=>page.noiseEvents.length>0));
    const report=await readFile(join(out,'report.html'),'utf8');
    assert(report.includes('predictions, not known answers'));assert(report.includes('not_requested'));
    await assert.rejects(runSiteStudy(server.url,out,{contrast:false}),/already exists/);
  }finally{await server.close();}
});
