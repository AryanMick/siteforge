import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { generate, listFiles } from '../src/generator.mjs';
import { createModel } from '../src/model.mjs';
import { DOMAINS, PRESETS } from '../src/presets.mjs';
import { sitePlan, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { randomFixtureInput, randomRequestSchema } from '../src/fixture-lab/random.mjs';
import { hash } from '../src/util.mjs';

function assertInventory(model, domain, pageCount) {
  assert.equal(model.pages.length, pageCount, `${domain} ${pageCount}`);
  assert.equal(new Set(model.pages.map(page => page.pageId)).size, pageCount);
  assert.equal(new Set(model.pages.map(page => page.url)).size, pageCount);
  const urls = new Set(model.pages.map(page => page.url));
  const byUrl = new Map(model.pages.map(page => [page.url, page]));
  const reached = new Set(['/']);
  const queue = ['/'];

  for (const page of model.pages) {
    assert(model.schemas[page.expectedCluster], `${page.pageId} has an unknown expected cluster`);
    assert.deepEqual(page.fields, page.canonicalValues);
    for (const link of page.links) assert(urls.has(link.href), `${page.pageId} -> ${link.href}`);
    for (const relation of page.relationships) assert(urls.has(relation.targetUrl), `${page.pageId} -> ${relation.targetUrl}`);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const link of byUrl.get(queue[cursor]).links) {
      if (!reached.has(link.href)) { reached.add(link.href); queue.push(link.href); }
    }
  }
  assert.equal(reached.size, pageCount, `${domain} ${pageCount} reachable inventory`);
}

test('every 5..200 page count builds a complete source-first inventory for every domain', { timeout: 60000 }, () => {
  let checked = 0;
  for (const domain of DOMAINS) {
    for (let pageCount = 5; pageCount <= 200; pageCount++) {
      const plan = sitePlan({ name: 'Small matrix', domain, pagesPerSite: pageCount, seed: 7000 + pageCount, randomness: 50 }, 0);
      const config = validateConfig(plan.config);
      const names = new Set(config.contentTypes.map(type => type.name));
      assert.equal(config.contentTypes.length, Math.min(PRESETS[domain].types.length, Math.floor((pageCount - 1) / 2)));
      for (const type of config.contentTypes) if (type.relationTo) assert(names.has(type.relationTo));
      const model = createModel(config);
      for (const type of config.contentTypes) {
        assert(model.pages.some(page => page.kind === 'detail' && page.contentType === type.name));
        assert(model.pages.some(page => page.kind === 'listing' && page.pageId.startsWith(`listing-${type.name}-`)));
        assert.deepEqual(model.schemas[type.name], type.fields.map(field => field.name));
        assert(model.schemaDefinitions[type.name]);
      }
      assertInventory(model, domain, pageCount);
      checked++;
    }
  }
  assert.equal(checked, 1960);
});

test('selected small and large random sites generate exact HTML, truth and artifact inventories', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-small-random-'));
  try {
    for (const framework of ['html', 'react', 'angular']) {
      for (const pageCount of [5, 6, 7, 8, 9, 200]) {
        const input = randomFixtureInput({ seed: 91000 + pageCount, pagesPerSite: pageCount, framework, randomness: 50 });
        const config = validateConfig(sitePlan(input, 0).config);
        const output = join(root, `${framework}-${pageCount}`);
        const result = await generate(config, output);
        assert.equal(result.pageCount, pageCount);

        const publicFiles = await listFiles(join(output, 'public'));
        const htmlFiles = publicFiles.filter(file => file.endsWith('/index.html') || file === 'index.html');
        // Themed (non-legacy) sites also ship the shared media pool: 8 sector illustrations and 6 portraits.
        // Plus the behaviour script, the search index and 5 noindex utility pages (search, my list, sign-in, request, subscribe).
        const expectedArtifacts = pageCount + (framework === 'html' ? 4 : 5) + 5 + (config.site.visualStyle !== 'legacy' ? 14 : 0) + 7;
        assert.equal(htmlFiles.length, pageCount);
        assert.equal(publicFiles.length, expectedArtifacts);
        for (const asset of ['assets/site-variants.css', ...[1, 2, 3, 4].map(index => `assets/collection-${index}.png`)]) assert(publicFiles.includes(asset));

        const [canonical, truth, manifest, homeHtml] = await Promise.all([
          readFile(join(output, 'private', 'canonical.json'), 'utf8').then(JSON.parse),
          readFile(join(output, 'private', 'ground-truth.json'), 'utf8').then(JSON.parse),
          readFile(join(output, 'private', 'manifest.json'), 'utf8').then(JSON.parse),
          readFile(join(output, 'public', 'index.html'), 'utf8'),
        ]);
        assert.equal(canonical.pages.length, pageCount);
        assert.equal(truth.pages.length, pageCount);
        assert.equal(Object.keys(manifest.artifactFiles).length, expectedArtifacts);
        assert.equal(manifest.canonicalSha256, hash(canonical.pages));
        assert.equal(manifest.truthSha256, hash(truth));
        assert.match(homeHtml, /<!doctype html>/i);
        for (const secret of ['expectedCluster', 'canonicalValues', 'noiseEvents', 'ground-truth']) assert(!homeHtml.includes(secret));

        const canonicalById = new Map(canonical.pages.map(page => [page.pageId, page]));
        for (const page of truth.pages) {
          const source = canonicalById.get(page.pageId);
          assert(source);
          assert.deepEqual(page.canonicalValues, source.canonicalValues);
          assert.equal(page.expectedCluster, source.expectedCluster);
        }
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('randomness is bounded, replayable and intensity-aware without weakening clean noise', () => {
  assert.throws(() => randomRequestSchema.parse({ pagesPerSite: 4 }));
  assert.throws(() => randomRequestSchema.parse({ pagesPerSite: 100001 }));
  for (const randomness of [-1, 101, 1.5]) assert.throws(() => randomRequestSchema.parse({ randomness }));
  assert.doesNotThrow(() => validateFixtureInput({ name: 'Stored CLI job', pagesPerSite: 1000 }));
  const oldJob = validateFixtureInput({ name: 'Stored job' });
  assert(!Object.hasOwn(oldJob, 'randomness'));
  assert(!Object.hasOwn(sitePlan(oldJob, 0).config, 'variation'));

  const request = { seed: 123456, pagesPerSite: 37, framework: 'react', randomness: 50 };
  const firstInput = randomFixtureInput(request);
  const firstPlan = sitePlan(firstInput, 0);
  const firstModel = createModel(validateConfig(firstPlan.config));
  assert.deepEqual(firstInput, randomFixtureInput(request));
  assert.deepEqual(firstPlan, sitePlan(firstInput, 0));
  assert.deepEqual(firstModel, createModel(validateConfig(firstPlan.config)));
  const otherModel = createModel(validateConfig(sitePlan(randomFixtureInput({ ...request, seed: request.seed + 1 }), 0).config));
  assert.notDeepEqual(firstModel.pages, otherModel.pages);

  const allowed = {
    0: { noise: new Set(['clean']), scenario: new Set(['baseline']) },
    50: { noise: new Set(['low', 'medium']), scenario: new Set(['baseline', 'legacy-clutter', 'inconsistent-fields', 'extraction-traps']) },
    100: { noise: new Set(['medium', 'high']), scenario: new Set(['baseline', 'legacy-clutter', 'inconsistent-fields', 'extraction-traps', 'parser-stress']) },
  };
  for (const amount of [0, 50, 100]) {
    const domains = new Set();
    for (let seed = 0; seed < 128; seed++) {
      const input = randomFixtureInput({ seed, randomness: amount });
      domains.add(input.domain);
      assert(allowed[amount].noise.has(input.noise));
      assert(allowed[amount].scenario.has(input.scenario));
      assert.equal(input.randomness, amount);
    }
    assert.deepEqual(domains, new Set(DOMAINS));
  }

  const zeroA = createModel(validateConfig(sitePlan({ name: 'Zero', domain: 'library', pagesPerSite: 30, seed: 11, randomness: 0 }, 0).config));
  const zeroB = createModel(validateConfig(sitePlan({ name: 'Zero', domain: 'library', pagesPerSite: 30, seed: 12, randomness: 0 }, 0).config));
  const structure = model => model.pages.map(page => [page.pageId, page.kind, page.contentType, page.template, page.fieldLayout]);
  assert.deepEqual(structure(zeroA), structure(zeroB));
  assert.notDeepEqual(zeroA.pages.map(page => page.fields), zeroB.pages.map(page => page.fields));
  assert.equal(zeroA.site.noise.level, 'clean');
  assert.equal(zeroA.site.noise.probability, 0);
});

test('implicit presets fit small sites while explicit oversized schemas still fail', () => {
  const implicit = validateConfig({ site: { id: 'small-default', domain: 'library', pageCount: 5 } });
  assert.deepEqual(implicit.contentTypes.map(type => type.name), ['book', 'author']);
  assert.equal(implicit.contentTypes[0].relationTo, 'author');
  const explicit = { site: { id: 'small-explicit', domain: 'library', pageCount: 5 }, contentTypes: structuredClone(PRESETS.library.types) };
  assert.throws(() => validateConfig(explicit), /accommodate/);
  assert.throws(() => validateConfig({ site: { id: 'too-small', pageCount: 4 } }));
  assert.throws(() => validateConfig({ site: { id: 'bad-limit', pageCount: 5 }, limits: { maxPages: 4 } }));
});

test('variation preserves explicit never and always optional-field probabilities', () => {
  for (let seed = 0; seed < 32; seed++) {
    const config = validateConfig({
      seed,
      site: { id: 'presence-endpoints', pageCount: 30 },
      variation: { amount: 100 },
      contentTypes: [{
        name: 'record', label: 'Records', fields: [
          { name: 'title', type: 'title' },
          { name: 'never', optional: true, presenceProbability: 0 },
          { name: 'always', optional: true, presenceProbability: 1 },
        ],
      }],
    });
    const records = createModel(config).pages.filter(page => page.contentType === 'record');
    assert(records.length > 0);
    assert(records.every(page => !Object.hasOwn(page.fields, 'never')));
    assert(records.every(page => Object.hasOwn(page.fields, 'always')));
  }
});

test('the same seed varies presentation while preserving detail and repeated-item schemas', () => {
  const models = [0, 50, 100].map(randomness => createModel(validateConfig(sitePlan({
    name: 'Intensity comparison', domain: 'library', pagesPerSite: 120, seed: 11,
    randomness, fieldLayout: 'mixed', noise: 'clean',
  }, 0).config)));
  const structure = model => ({
    pageSize: model.site.pageSize,
    counts: Object.fromEntries([...new Set(model.pages.filter(page => page.kind === 'detail').map(page => page.contentType))]
      .map(type => [type, model.pages.filter(page => page.kind === 'detail' && page.contentType === type).length])),
    layouts: model.pages.filter(page => page.kind === 'detail').map(page => page.fieldLayout),
  });
  assert.notDeepEqual(structure(models[0]), structure(models[1]));
  assert.notDeepEqual(structure(models[1]), structure(models[2]));

  const records = models.map(model => model.pages.find(page => page.pageId === 'author-000001'));
  assert(records.every(Boolean));
  assert.equal(new Set(records.map(page => page.title)).size, 1);
  assert.equal(new Set(records.map(page => page.fields.biography)).size, 3);
  assert(records.every(page => page.fields.biography === page.canonicalValues.biography));

  const clusterMap = model => Object.fromEntries(model.pages.filter(page => page.kind === 'detail')
    .map(page => [page.contentType, page.expectedCluster]));
  assert.deepEqual(clusterMap(models[0]), clusterMap(models[1]));
  assert.deepEqual(clusterMap(models[1]), clusterMap(models[2]));
  const detailSchemas = model => Object.fromEntries(Object.keys(clusterMap(model))
    .map(type => [type, model.schemaDefinitions[type]]));
  assert.deepEqual(detailSchemas(models[0]), detailSchemas(models[2]));
  const listingSchemas = model => Object.fromEntries(Object.entries(model.schemaDefinitions)
    .filter(([, definition]) => definition.repeatedItemSchema));
  assert.deepEqual(listingSchemas(models[0]), {});
  assert(Object.keys(listingSchemas(models[1])).length > 0);
  assert.deepEqual(listingSchemas(models[1]), listingSchemas(models[2]));
  assert(models.every(model => model.site.noise.level === 'clean' && model.site.noise.probability === 0 && model.site.noise.maxPerPage === 0));
});
