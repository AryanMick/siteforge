import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Given, Then, When, type World } from '@cucumber/cucumber';
import { validateConfig } from '../../src/site/config.mjs';
import { presetConfig } from '../../src/site/presets.mjs';
import { createModel } from '../../src/site/model.mjs';
import { applyDataNoise } from '../../src/noise/noise.mjs';
import { generate } from '../../src/site/generator.mjs';
import { serve } from '../../src/preview/server.mjs';

interface GenerationWorld extends World {
  libraryConfig: ReturnType<typeof validateConfig>;
  canonical: ReturnType<typeof createModel>;
  noisy: ReturnType<typeof createModel>;
  changed: ReturnType<typeof applyDataNoise>[];
  fixtureRoot?: string;
  fixtureDirectory?: string;
  fixtureServer?: Awaited<ReturnType<typeof serve>>;
  configurationError?: unknown;
}

Given('a fictional library configured for {int} pages with seed {int}', function(this: GenerationWorld, count: number, seed: number) {
  const input = presetConfig('library');
  input.site.pageCount = count;
  input.seed = seed;
  this.libraryConfig = validateConfig(input);
});

When('the canonical model is constructed without rendering or crawling', function(this: GenerationWorld) {
  this.canonical = createModel(this.libraryConfig);
});
Then('its private inventory contains exactly {int} unique pages', function(this: GenerationWorld, count: number) {
  assert.equal(this.canonical.pages.length, count);
  assert.equal(new Set(this.canonical.pages.map(page => page.url)).size, count);
  assert.equal(new Set(this.canonical.pages.map(page => page.pageId)).size, count);
});
Then('every inventory page already has an expected cluster and source fields', function(this: GenerationWorld) {
  for (const page of this.canonical.pages) {
    assert.ok(page.expectedCluster);
    assert.ok(Object.keys(page.canonicalValues).length > 0);
  }
});
When('clean and high-noise models are constructed from the same seed', function(this: GenerationWorld) {
  this.canonical = createModel(this.libraryConfig);
  this.noisy = createModel(validateConfig({ ...this.libraryConfig, noise: { level: 'high' } }));
});
Then('their canonical records and expected clusters are identical', function(this: GenerationWorld) {
  assert.deepEqual(this.canonical.pages, this.noisy.pages);
  assert.deepEqual(this.canonical.pages, createModel(this.libraryConfig).pages);
});
Then('only the noisy rendering model records intentional mutations', function(this: GenerationWorld) {
  const events = (model: ReturnType<typeof createModel>) => model.pages.flatMap(page => applyDataNoise(page, model.site).noiseEvents);
  assert.equal(events(this.canonical).length, 0);
  assert.ok(events(this.noisy).length > 0);
});
When('a missing-field mutation is applied to its records', function(this: GenerationWorld) {
  this.canonical = createModel(validateConfig({ ...this.libraryConfig, noise: { level: 'custom', probability: 1, maxPerPage: 1, types: ['missing-field'] } }));
  this.changed = this.canonical.pages.map(page => applyDataNoise(page, this.canonical.site));
});
Then('removed values remain in private canonical records but not observable fields', function(this: GenerationWorld) {
  let removed = 0;
  for (const page of this.changed) for (const [field, state] of Object.entries(page.fieldStates)) {
    if (state !== 'absent') continue;
    assert.ok(!Object.hasOwn(page.fields, field));
    if (!page.noiseEvents.some((event: { type: string; field?: string }) => event.type === 'missing-field' && event.field === field)) {
      assert.ok(!Object.hasOwn(page.canonicalValues, field), 'Optional source absence is not a removed value');
      continue;
    }
    removed++;
    assert.ok(Object.hasOwn(page.canonicalValues, field));
    assert.ok(!Object.hasOwn(page.fields, field));
  }
  assert.ok(removed > 0);
});
When('the library is generated and served locally', { timeout: 20000 }, async function(this: GenerationWorld) {
  this.fixtureRoot = await mkdtemp(join(tmpdir(), 'siteforge-bdd-'));
  this.fixtureDirectory = join(this.fixtureRoot, 'site');
  await generate(this.libraryConfig, this.fixtureDirectory);
  this.fixtureServer = await serve(this.fixtureDirectory, { port: 0 });
});
Then('its public home page is available', async function(this: GenerationWorld) {
  assert.equal((await fetch(this.fixtureServer!.url)).status, 200);
});
Then('its private answer key returns not found', async function(this: GenerationWorld) {
  const response = await fetch(`${this.fixtureServer!.url}/private/ground-truth.json`);
  assert.equal(response.status, 404);
});
Then('generating into that completed output again is rejected', async function(this: GenerationWorld) {
  await assert.rejects(generate(this.libraryConfig, this.fixtureDirectory!), /already exists/);
});
When('the requested framework is not HTML React or Angular', function(this: GenerationWorld) {
  try { validateConfig({ ...this.libraryConfig, site: { ...this.libraryConfig.site, framework: 'unrecognized' } }); }
  catch (error) { this.configurationError = error; }
});
Then('configuration validation rejects the request', function(this: GenerationWorld) {
  assert.ok(this.configurationError instanceof Error);
  assert.match(this.configurationError.message, /framework/);
});
After(async function(this: GenerationWorld) {
  await this.fixtureServer?.close();
  if (this.fixtureRoot) await rm(this.fixtureRoot, { recursive: true, force: true });
});
