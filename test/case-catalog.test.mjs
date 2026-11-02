import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, LEGACY_NOISE_TYPES, NOISE_TYPES } from '../src/config.mjs';
import { generate } from '../src/generator.mjs';
import { sitePlan, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { createModel } from '../src/model.mjs';
import { applyDataNoise } from '../src/noise.mjs';
import { buildTransportPlan } from '../src/transport.mjs';
import { DOMAINS } from '../src/presets.mjs';
import { OBSTACLE_CATALOG, TRANSPORT_CATALOG } from '../src/fixture-lab/catalog.mjs';
import {
  ALL_CASE_PROFILES, CATALOG_SETTINGS, CATALOG_VERSION, CASE_PROFILES, CORE_CASE_COUNT, REAL_WORLD_PROFILES, TOTAL_CASE_COUNT,
  buildCatalogSiteConfig, getCatalogCase, listCatalogCases,
} from '../src/fixture-lab/case-catalog.mjs';

test('catalog exposes the exact deterministic 1,440-case matrix', () => {
  assert.equal(CATALOG_VERSION, 1);
  assert.deepEqual(CATALOG_SETTINGS, {
    siteCount: 1440, pagesPerSite: 16, domain: 'mixed', framework: 'mixed',
    visualStyle: 'legacy', noise: 'high', fieldLayout: 'mixed', optionalFields: true,
    scenario: 'baseline', transport: 'mixed', previewProtocol: 'mixed', suite: 'regression-1440',
  });

  const cases = listCatalogCases();
  assert.equal(cases.length, 1440);
  assert.equal(cases[0].id, 'case-0001');
  assert.equal(cases.at(-1).id, 'case-1440');
  assert.equal(new Set(cases.map(item => item.id)).size, 1440);
  assert.equal(new Set(cases.map(item => [item.domain, item.framework, item.fieldLayout, item.protocol, item.profile].join('|'))).size, 1440);
  assert.deepEqual(CASE_PROFILES.find(profile => profile.id === 'http-faults').types,
    OBSTACLE_CATALOG.filter(item => LEGACY_NOISE_TYPES.includes(item.id)).map(item => item.id));

  for (const domain of DOMAINS) assert.equal(listCatalogCases({ domain }).length, 144);
  for (const framework of ['html', 'react', 'angular']) assert.equal(listCatalogCases({ framework }).length, 480);
  for (const fieldLayout of ['definition-list', 'table', 'paragraphs', 'mixed']) assert.equal(listCatalogCases({ fieldLayout }).length, 360);
  for (const protocol of ['http', 'https']) assert.equal(listCatalogCases({ protocol }).length, 720);
  for (const profile of CASE_PROFILES) assert.equal(listCatalogCases({ profile: profile.id }).length, 240);
  assert.equal(listCatalogCases({ framework: ['react', 'angular'], protocol: 'https' }).length, 480);
});

test('catalog lookup and builder reject invalid input', () => {
  assert.throws(() => getCatalogCase('case-0000'), /Unknown catalog case/);
  assert.throws(() => listCatalogCases({ typo: 'library' }), /Unknown catalog filter/);
  assert.throws(() => buildCatalogSiteConfig('case-0001', { seed: -1 }), /unsigned 32-bit/);
  assert.throws(() => buildCatalogSiteConfig('case-0001', { pageCount: 11 }), /12 to 100000/);
});

test('every case builds a valid, unique behavior config with one optional field per type', () => {
  const signatures = new Set();
  for (const descriptor of listCatalogCases()) {
    const first = buildCatalogSiteConfig(descriptor.id);
    const second = buildCatalogSiteConfig(descriptor.id);
    assert.deepEqual(first, second);
    assert.equal(first.seed, 48291);
    assert.equal(first.previewProtocol, descriptor.protocol);
    assert.equal(new URL(first.site.baseUrl).protocol, `${descriptor.protocol}:`);
    assert.deepEqual(validateConfig(first), validateConfig(second));
    for (const contentType of first.contentTypes) {
      assert.equal(contentType.fieldLayout, descriptor.fieldLayout);
      const optional = contentType.fields.filter(field => field.optional);
      assert.equal(optional.length, 1);
      assert.notEqual(optional[0].name, 'title');
      assert.equal(optional[0].presenceProbability, 0.5);
    }

    const signature = structuredClone(first);
    delete signature.seed;
    delete signature.site.id;
    delete signature.site.name;
    delete signature.site.baseUrl;
    assert(!signatures.has(JSON.stringify(signature)), descriptor.id);
    signatures.add(JSON.stringify(signature));
  }
  assert.equal(signatures.size, 1440);
});

test('profile coverage is deterministic and every declared obstacle is exercised', () => {
  const declared = new Set(CASE_PROFILES.flatMap(profile => profile.types));
  assert.deepEqual([...declared].sort(), [...LEGACY_NOISE_TYPES].sort());
  const observed = new Set();

  for (const descriptor of listCatalogCases()) {
    const config = validateConfig(buildCatalogSiteConfig(descriptor.id));
    const canonical = createModel(config);
    const first = canonical.pages.map(page => applyDataNoise(page, canonical.site));
    const second = canonical.pages.map(page => applyDataNoise(page, canonical.site));
    assert.deepEqual(first, second);
    for (const page of first) for (const event of page.noiseEvents) observed.add(event.type);

    const transport = buildTransportPlan(canonical.pages, { profile: config.transport.profile, seed: config.seed });
    assert.deepEqual(transport, buildTransportPlan(canonical.pages, { profile: config.transport.profile, seed: config.seed }));
    if (descriptor.profile === 'http-faults') {
      assert.equal(transport.rules.length, 10);
      assert.deepEqual(transport.rules.map(rule => rule.type).sort(), TRANSPORT_CATALOG.map(item => item.id).sort());
    }
    else assert.equal(transport.rules.length, 0);
  }

  assert.deepEqual([...observed].sort(), [...declared].sort());
});

// 2026-11-02: real-world profiles appended as case-1441..case-3120 without moving the core IDs.
test('real-world profiles add 1,680 deterministic cases after the unchanged 1,440 core cases', () => {
  assert.equal(TOTAL_CASE_COUNT, 3120);
  assert.equal(CORE_CASE_COUNT, 1440);
  assert.equal(REAL_WORLD_PROFILES.length, 7);
  assert.deepEqual(ALL_CASE_PROFILES.map(item => item.id), [...CASE_PROFILES, ...REAL_WORLD_PROFILES].map(item => item.id));
  assert.equal(new Set(ALL_CASE_PROFILES.map(item => item.id)).size, ALL_CASE_PROFILES.length);

  const core = listCatalogCases();
  assert.equal(core.length, 1440);
  assert.deepEqual(listCatalogCases({ set: 'core' }), core);
  assert(core.every(item => item.set === 'core'));
  assert.deepEqual([core[0].id, core[0].profile, core.at(-1).id, core.at(-1).profile], ['case-0001', 'clean-control', 'case-1440', 'http-faults']);

  const added = listCatalogCases({ set: 'real-world' });
  assert.equal(added.length, 1680);
  assert.equal(added[0].id, 'case-1441');
  assert.equal(added.at(-1).id, 'case-3120');
  assert.deepEqual(added.map(item => item.id), Array.from({ length: 1680 }, (_, index) => `case-${String(1441 + index).padStart(4, '0')}`));
  const all = listCatalogCases({ set: 'all' });
  assert.equal(all.length, 3120);
  assert.equal(new Set(all.map(item => [item.domain, item.framework, item.fieldLayout, item.protocol, item.profile].join('|'))).size, 3120);
  for (const item of REAL_WORLD_PROFILES) assert.equal(listCatalogCases({ set: 'real-world', profile: item.id }).length, 240);
  assert.equal(listCatalogCases({ profile: 'word-paste' }).length, 0, 'the default list stays the regression-1440 suite');
  assert.equal(listCatalogCases({ id: 'case-3120' })[0].profile, 'aspnet-webforms');
  assert.equal(getCatalogCase('case-1441').profile, 'word-paste');
  assert.throws(() => listCatalogCases({ set: 'everything' }), /Unknown catalog set/);

  const single = validateFixtureInput({ ...CATALOG_SETTINGS, name: 'Real world', suite: 'catalog-case', siteCount: 1, caseId: 'case-2000', previewProtocol: getCatalogCase('case-2000').protocol });
  assert.equal(sitePlan(single, 0).id, 'case-2000');
});

test('every real-world profile is described, uses existing types and fires each eligible type', () => {
  const signatures = new Set();
  for (const item of REAL_WORLD_PROFILES) {
    assert.match(item.label, /\S/);
    assert(item.description.length > 80, item.id);
    assert(item.types.length >= 9, item.id);
    assert.equal(new Set(item.types).size, item.types.length, item.id);
    for (const type of item.types) assert(NOISE_TYPES.includes(type), `${item.id}: ${type}`);

    const observed = new Set();
    const declared = new Set();
    for (const descriptor of listCatalogCases({ set: 'real-world', profile: item.id })) {
      const raw = buildCatalogSiteConfig(descriptor.id);
      assert.deepEqual(raw, buildCatalogSiteConfig(descriptor.id));
      for (const [key, value] of Object.entries(item.site)) assert.equal(raw.site[key], value, `${descriptor.id}: ${key}`);
      const config = validateConfig(raw);
      for (const type of config.noise.types) declared.add(type);
      if (descriptor.framework !== 'html') assert(!config.noise.types.some(type => ['missing-main', 'uppercase-legacy-tags'].includes(type)), descriptor.id);
      else assert(!config.noise.types.includes('delayed-content'), descriptor.id);
      const canonical = createModel(config);
      for (const page of canonical.pages) for (const event of applyDataNoise(page, canonical.site).noiseEvents) observed.add(event.type);
      const transport = buildTransportPlan(canonical.pages, { profile: config.transport.profile, seed: config.seed });
      assert.equal(transport.rules.length > 0, item.transportProfile !== 'none', descriptor.id);

      const signature = structuredClone(raw);
      delete signature.seed; delete signature.site.id; delete signature.site.name; delete signature.site.baseUrl;
      assert(!signatures.has(JSON.stringify(signature)), descriptor.id);
      signatures.add(JSON.stringify(signature));
    }
    assert.deepEqual([...declared].sort(), [...item.types].sort(), item.id);
    assert.deepEqual([...observed].sort(), [...declared].sort(), item.id);
  }
  assert.equal(signatures.size, 1680);
});

test('one generated sample per real-world profile records every listed type in its answer key', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'case-catalog-real-world-'));
  try {
    for (const item of REAL_WORLD_PROFILES) {
      const descriptor = listCatalogCases({ set: 'real-world', profile: item.id, framework: 'html' })[0];
      const input = validateFixtureInput({ ...CATALOG_SETTINGS, name: 'Real world', suite: 'catalog-case', siteCount: 1, caseId: descriptor.id, previewProtocol: descriptor.protocol });
      const plan = sitePlan(input, 0);
      const directory = join(root, descriptor.id);
      await generate(plan.config, directory);
      const answer = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
      const seen = new Set(answer.pages.flatMap(page => (page.noiseEvents ?? []).map(event => event.type)));
      assert.deepEqual(plan.config.noise.types, item.types.filter(type => type !== 'delayed-content'), item.id);
      assert.deepEqual(plan.config.noise.types.filter(type => !seen.has(type)), [], `${item.id} (${descriptor.id})`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
