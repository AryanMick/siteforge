import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sitePlan, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { generate } from '../src/generator.mjs';
import { serve } from '../src/server.mjs';
import { NOISE_TYPES, LEGACY_NOISE_TYPES, DEFAULT_NOISE_TYPES, validateConfig, loadConfig } from '../src/config.mjs';
import { OBSTACLE_CATALOG, TRANSPORT_CATALOG } from '../src/fixture-lab/catalog.mjs';
import { buildTransportPlan } from '../src/transport.mjs';

test('UI catalogs exactly match implemented conditions, without advertised placeholders', () => {
  assert.deepEqual(new Set(OBSTACLE_CATALOG.map(item => item.id)), new Set(NOISE_TYPES));
  const pages = Array.from({ length: 10 }, (_, index) => ({ kind: 'detail', url: `/records/${index}/` }));
  assert.deepEqual(new Set(TRANSPORT_CATALOG.map(item => item.id)), new Set(buildTransportPlan(pages, { profile: 'mixed' }).rules.map(item => item.type)));
});

test('expanded examples are explicit and preserve legacy implicit benchmark inputs', async () => {
  const example = await loadConfig(new URL('../examples/adversarial-library.yaml', import.meta.url));
  assert.deepEqual(new Set(example.noise.types), new Set(LEGACY_NOISE_TYPES.filter(type => type !== 'delayed-content')));
  assert.equal(example.transport.profile, 'mixed');
  assert(example.contentPool.some(value => value.includes('\u0301')));
  assert.deepEqual(validateConfig({ site: { id: 'backward-compatible' }, noise: { level: 'high' } }).noise.types, DEFAULT_NOISE_TYPES.filter(type => type !== 'delayed-content'));
});

test('adversarial request resolves separate HTML and transport settings without changing source records', async () => {
  const input = validateFixtureInput({ name: 'Adversarial library', scenario: 'extraction-traps', transport: 'mixed', noise: 'high', pagesPerSite: 60 });
  const plan = sitePlan(input, 0);
  assert.equal(plan.config.transport.profile, 'mixed');
  assert.equal(plan.summary.transport, 'mixed');
  assert(plan.config.noise.types.includes('conflicting-metadata'));
  assert(plan.config.noise.types.includes('hidden-boilerplate'));
  assert.deepEqual(plan, sitePlan(input, 0));
  const root = await mkdtemp(join(tmpdir(), 'siteforge-obstacles-'));
  let preview;
  try {
    await generate(plan.config, join(root, 'faults'));
    await generate({ ...plan.config, transport: { profile: 'none' } }, join(root, 'healthy'));
    const read = (directory, name) => readFile(join(root, directory, 'private', name), 'utf8').then(JSON.parse);
    const truth = await read('faults', 'ground-truth.json');
    const transport = await read('faults', 'transport.json');
    assert.deepEqual(truth.transport, transport);
    assert.deepEqual(await read('faults', 'canonical.json'), await read('healthy', 'canonical.json'));
    assert.deepEqual(truth.pages, (await read('healthy', 'ground-truth.json')).pages);
    assert.equal(new Set(transport.rules.map(rule => rule.type)).size, 10);
    const paths = new Set(truth.pages.filter(page => page.kind === 'detail').map(page => page.url));
    assert(transport.rules.every(rule => paths.has(rule.path)));
    preview = await serve(join(root, 'faults'), { port: 0, rebaseOrigin: true });
    assert.equal((await fetch(preview.url)).status, 200);
    for (const rule of transport.rules) {
      const response = await fetch(preview.url + rule.path, { redirect: 'manual' });
      assert.equal(response.status, rule.status, rule.type);
    }
    for (const path of ['/private/transport.json', '/transport.json', '/private/ground-truth.json']) {
      assert.equal((await fetch(preview.url + path)).status, 404);
    }
  } finally { await preview?.close(); await rm(root, { recursive: true, force: true }); }
});

test('transport configuration rejects unsupported profiles and defaults to ordinary HTTP', () => {
  assert.equal(validateFixtureInput({ name: 'Ordinary' }).transport, 'none');
  assert.throws(() => validateFixtureInput({ name: 'Invalid', transport: 'infinite-delay' }));
  assert.equal(sitePlan({ name: 'Clean' }, 0).config.transport.profile, 'none');
});
