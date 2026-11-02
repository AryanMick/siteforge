import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.mjs';
import { createModel } from '../src/model.mjs';
import { applyDataNoise } from '../src/noise.mjs';
import { validateAnswerKey } from '../src/answer-key.mjs';
import { buildTransportPlan } from '../src/transport.mjs';

function fixture(layout, noise = { level: 'clean' }) {
  return validateConfig({ seed: 41, site: { id: `locations-${layout}`, pageCount: 12 },
    contentTypes: [{ name: 'record', label: 'Records', fieldLayout: layout, fields: [
      { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
      { name: 'publicationDate', type: 'date' }, { name: 'body', type: 'text', optional: true, presenceProbability: 0.5 },
      { name: 'coverImage', type: 'image', optional: true, presenceProbability: 0.5 },
    ] }], noise });
}

test('source and observed scalar locations are planned before rendering', () => {
  for (const layout of ['definition-list', 'table', 'paragraphs']) {
    const config = fixture(layout, { level: 'custom', probability: 1, severity: 3, maxPerPage: 4,
      types: ['reorder-fields', 'missing-field', 'label-variation', 'date-format'] });
    const source = createModel(config);
    assert.equal(source.fieldLocationVersion, 1);
    const home = source.pages.find(page => page.kind === 'home');
    assert.equal(home.fieldLocations.title.selector, '#content > .page-heading > h1');
    assert.equal(home.fieldLocations.summary.selector, '#content > .page-heading > p.lede');
    const answer = { ...source, pages: source.pages.map(page => applyDataNoise(page, source.site)),
      transport: buildTransportPlan(source.pages) };
    validateAnswerKey(source, answer, config);
    for (const page of answer.pages.filter(page => page.contentType === 'record')) {
      assert.deepEqual(Object.keys(page.fieldLocations), Object.keys(page.fieldStates));
      for (const [name, location] of Object.entries(page.fieldLocations)) {
        assert.equal(location.state, page.fieldStates[name]);
        if (location.state === 'absent') assert.equal(location.selector, undefined);
        else if (name === 'coverImage') assert.equal(location.read, 'urlPath');
        else if (layout === 'paragraphs' && name !== 'title') assert.deepEqual([location.read, location.precision], ['afterLabel', 'container']);
        else assert.deepEqual([location.read, location.precision], ['textContent', 'value']);
      }
    }
    const changedAnswer = structuredClone(answer);
    const detail = changedAnswer.pages.find(page => page.contentType === 'record');
    detail.fieldLocations.title.selector = '#content h1';
    assert.throws(() => validateAnswerKey(source, changedAnswer, config), /invalid observed field locations/);
    const changedSource = structuredClone(source);
    changedSource.pages.find(page => page.contentType === 'record').fieldLocations.title.selector = '#content h1';
    assert.throws(() => validateAnswerKey(changedSource, { ...changedSource, pages: changedSource.pages.map(page => applyDataNoise(page, changedSource.site)), transport: buildTransportPlan(changedSource.pages) }, config), /invalid source field locations/);
  }
});

test('1.0 and 1.1 saved answers without scalar locations remain valid', () => {
  const config = fixture('table');
  for (const version of ['1.0.0', '1.1.0']) {
    const source = createModel(config);
    source.generatorVersion = version;
    delete source.fieldLocationVersion;
    if (version === '1.0.0') delete source.listingTruthVersion;
    for (const page of source.pages) delete page.fieldLocations;
    const answer = { ...source, pages: source.pages.map(page => structuredClone(page)), transport: buildTransportPlan(source.pages) };
    validateAnswerKey(source, answer, config);
  }
  const current = createModel(config);
  delete current.fieldLocationVersion;
  assert.throws(() => validateAnswerKey(current, { ...current, transport: buildTransportPlan(current.pages) }, config), /field location version is missing/);
  const intact = createModel(config);
  const missingPageLocation = { ...intact, pages: intact.pages.map(page => structuredClone(page)), transport: buildTransportPlan(intact.pages) };
  delete missingPageLocation.pages.find(page => page.contentType === 'record').fieldLocations;
  assert.throws(() => validateAnswerKey(intact, missingPageLocation, config), /invalid observed field locations/);
  const missingAnswerMarker = { ...intact, transport: buildTransportPlan(intact.pages) };
  delete missingAnswerMarker.fieldLocationVersion;
  assert.throws(() => validateAnswerKey(intact, missingAnswerMarker, config), /field location version is missing/);
});
