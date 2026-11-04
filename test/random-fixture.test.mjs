import test from 'node:test';
import assert from 'node:assert/strict';
import { randomFixtureInput, randomRequestSchema } from '../src/fixture-lab/random.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';

test('random website requests are bounded and deterministic after saving the seed', () => {
  const variations = new Set();
  for (let seed = 0; seed < 128; seed++) {
    const input = randomFixtureInput({ seed });
    assert.deepEqual(input, randomFixtureInput({ seed }));
    assert.equal(input.siteCount, 1); assert.equal(input.framework, 'html'); assert.equal(input.transport, 'none');
    assert.equal(input.randomness, 50);
    const config = validateConfig(sitePlan(input, 0).config);
    const model = createModel(config);
    assert.equal(model.pages.length, 60);
    assert(model.pages.every(page => page.expectedCluster && page.fields.title));
    variations.add([input.domain, input.fieldLayout, input.scenario, input.noise].join('|'));
  }
  assert(variations.size > 80);
  for (const framework of ['html', 'react', 'angular']) {
    const input = randomFixtureInput({ seed: 0, framework, pagesPerSite: 16, previewProtocol: 'https' });
    assert.equal(input.seed, 0); assert.equal(input.previewProtocol, 'https');
    assert.equal(validateConfig(sitePlan(input, 0).config).site.pageCount, 16);
  }
  assert.throws(() => randomFixtureInput({}), /seed/);
  const randomCount = randomFixtureInput({ seed: 4, pagesPerSite: 0 });
  assert.equal(randomCount.pagesPerSite, 0);
  assert(validateConfig(sitePlan(randomCount, 0).config).site.pageCount >= 5);
  for (const bad of [{ seed: -1 }, { pagesPerSite: 4 }, { pagesPerSite: 100001 }, { randomness: -1 }, { randomness: 101 }, { sourceCode: 'run me' }, { framework: 'unknown' }]) assert.throws(() => randomRequestSchema.parse(bad));
});
