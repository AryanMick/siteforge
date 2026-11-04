import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { randomFixtureInput } from '../src/fixture-lab/random.mjs';
import { sitePlan, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { applyDataNoise } from '../src/noise/noise.mjs';
import { applyHtmlNoise } from '../src/noise/noise.mjs';
import { renderPage, finalizePage } from '../src/pages/renderers.mjs';
import { parse } from 'parse5';
import { walk } from '../src/site/util.mjs';

const frameworks = ['html', 'react', 'angular'];
const cases = fc.record({
  pagesPerSite: fc.oneof(
    fc.integer({ min: 5, max: 24 }), fc.integer({ min: 5, max: 24 }),
    fc.integer({ min: 5, max: 24 }), fc.integer({ min: 5, max: 24 }),
    fc.integer({ min: 25, max: 200 }),
  ),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  randomness: fc.integer({ min: 0, max: 100 }),
  framework: fc.constantFrom(...frameworks),
  previewProtocol: fc.constantFrom('http', 'https'),
  challenge: fc.constantFrom('standard', 'hard', 'extreme'),
});

function sourceFor(request) {
  const input = randomFixtureInput(request);
  const config = validateConfig(sitePlan(input, 0).config);
  return { input, config, model: createModel(config) };
}

test('randomized source plans preserve inventory, answer contracts and replay', { timeout: 360000 }, t => {
  const seed = process.env.FC_SEED === undefined ? 20261001 : Number(process.env.FC_SEED);
  const path = process.env.FC_PATH;
  assert(Number.isSafeInteger(seed), 'FC_SEED must be an integer');
  const options = { numRuns: 1500, seed, ...(path === undefined ? {} : { path }) };
  t.diagnostic(`fast-check runs=${options.numRuns} seed=${seed}${path === undefined ? '' : ` path=${path}`}`);
  let inspectedMarkup = 0;
  let checked = 0;
  let replayed = 0;
  fc.assert(fc.property(cases, request => {
    checked++;
    const first = sourceFor(request);
    if (checked <= 60 || checked % 149 === 0) {
      assert.deepEqual(first, sourceFor(request));
      replayed++;
    }
    assert.equal(first.input.seed, request.seed);
    assert.equal(first.input.randomness, request.randomness);
    assert.equal(first.config.variation.amount, request.randomness);
    assert.equal(first.model.pages.length, request.pagesPerSite);
    assert.equal(first.model.site.framework, request.framework);
    assert.equal(first.config.challenge, request.challenge);
    assert.equal(first.config.previewProtocol, request.previewProtocol);
    if (first.config.noise.level !== 'clean') {
      if (request.challenge === 'hard') assert.deepEqual([first.config.noise.probability, first.config.noise.severity, first.config.noise.maxPerPage], [0.85, 3, Math.min(10, first.config.noise.types.length)]);
      if (request.challenge === 'extreme') assert.deepEqual([first.config.noise.probability, first.config.noise.severity, first.config.noise.maxPerPage], [1, 3, first.config.noise.types.length]);
    }

    const pages = first.model.pages;
    const urls = new Set(pages.map(page => page.url));
    assert.equal(urls.size, pages.length);
    assert(urls.has('/'));
    assert(pages.every(page => page.expectedCluster && page.fields.title && page.canonicalValues && page.fieldStates));
    for (const page of pages) {
      assert.equal(page.canonicalValues.title, page.fields.title);
      for (const [field, state] of Object.entries(page.fieldStates)) {
        assert(['present', 'absent'].includes(state));
        assert.equal(Object.hasOwn(page.fields, field), state === 'present');
      }
      for (const link of page.links) assert(urls.has(link.href), `${page.url} links to missing ${link.href}`);
      for (const relation of page.relationships) assert(urls.has(relation.targetUrl));
      const observed = applyDataNoise(page, first.model.site);
      assert.deepEqual(observed, applyDataNoise(page, first.model.site));
      assert.equal(observed.pageId, page.pageId);
      assert.equal(observed.url, page.url);
      assert.equal(observed.expectedCluster, page.expectedCluster);
      assert.deepEqual(observed.canonicalValues, page.canonicalValues);
      assert(observed.noiseEvents.every(event => first.config.noise.types.includes(event.type)));
      if (request.randomness === 0) assert.equal(observed.noiseEvents.length, 0);
      for (const [field, state] of Object.entries(observed.fieldStates)) {
        assert(['present', 'absent'].includes(state));
        assert.equal(Object.hasOwn(observed.fields, field), state === 'present');
      }
      for (const event of observed.noiseEvents) {
        if (event.type === 'missing-field') {
          assert.equal(observed.fieldStates[event.field], 'absent');
          assert(!Object.hasOwn(observed.fields, event.field));
          assert(Object.hasOwn(observed.canonicalValues, event.field));
        }
        if (event.type === 'date-format') assert.notEqual(observed.fields[event.field], observed.canonicalValues[event.field]);
        if (event.type === 'label-variation') assert(observed.fieldLabels?.[event.field]);
        if (event.type === 'broken-image') assert.match(observed.image.src, /^\/assets\/missing-/);
      }
    }
    if (inspectedMarkup < 45 && request.pagesPerSite >= 12) {
      const page = pages.find(item => item.kind === 'detail');
      const observed = applyDataNoise(page, first.model.site);
      const html = finalizePage(first.model.site, observed, applyHtmlNoise(renderPage(first.model.site, observed), observed, first.model.site));
      const document = parse(html);
      if (request.framework === 'html') {
        assert(walk(document, node => node.tagName === 'h1').length >= 1);
        assert(html.includes(observed.fields.title));
      }
      else {
        const payload = walk(document, node => node.tagName === 'script' && node.attrs?.some(attr => attr.name === 'id' && attr.value === 'page-data'))[0];
        assert(payload, 'client page must carry its source payload');
        assert(html.includes('application/json'));
        assert(JSON.parse(payload.childNodes[0].value)[0].includes(observed.fields.title));
      }
      inspectedMarkup++;
    }
  }), options);
  t.diagnostic(`checked=${checked} fullReplays=${replayed} inspectedMarkup=${inspectedMarkup}`);
});

test('random website bounds and zero variation are explicit', () => {
  for (const pagesPerSite of [5, 200]) {
    const { input, config, model } = sourceFor({ seed: 0, pagesPerSite, randomness: 0 });
    assert.equal(input.randomness, 0);
    assert.equal(config.noise.level, 'clean');
    assert.equal(model.pages.length, pagesPerSite);
    assert.equal(model.site.pageCount, pagesPerSite);
  }
  for (const bad of [4, 100001, 5.5]) assert.throws(() => randomFixtureInput({ seed: 0, pagesPerSite: bad }));
  for (const bad of [-1, 101, 0.5]) assert.throws(() => randomFixtureInput({ seed: 0, randomness: bad }));
});

test('maximum randomness changes observable source data and records applied noise', () => {
  let changedSource = 0;
  let appliedEvents = 0;
  for (let seed = 0; seed < 16; seed++) {
    const plain = sourceFor({ seed, pagesPerSite: 60, randomness: 0 });
    const varied = sourceFor({ seed, pagesPerSite: 60, randomness: 100 });
    const plainDetails = plain.model.pages.filter(page => page.kind === 'detail').map(page => [page.contentType, page.fieldLayout, page.fields]);
    const variedDetails = varied.model.pages.filter(page => page.kind === 'detail').map(page => [page.contentType, page.fieldLayout, page.fields]);
    if (JSON.stringify(plainDetails) !== JSON.stringify(variedDetails)) changedSource++;
    assert(plain.model.pages.every(page => applyDataNoise(page, plain.model.site).noiseEvents.length === 0));
    appliedEvents += varied.model.pages.reduce((count, page) => count + applyDataNoise(page, varied.model.site).noiseEvents.length, 0);
  }
  assert(changedSource >= 12, `Only ${changedSource} of 16 seeds changed source content`);
  assert(appliedEvents > 0, 'Maximum randomness applied no recorded obstacle in the sample');
});

test('manual markup noise remains independent of content randomness', () => {
  const input = validateFixtureInput({ name: 'Manual noise', pagesPerSite: 60, seed: 48291, randomness: 0, noise: 'high', scenario: 'legacy-clutter' });
  const config = validateConfig(sitePlan(input, 0).config);
  const model = createModel(config);
  assert.equal(config.variation.amount, 0);
  assert.equal(config.noise.level, 'high');
  assert(model.pages.some(page => applyDataNoise(page, model.site).noiseEvents.length > 0));
});
