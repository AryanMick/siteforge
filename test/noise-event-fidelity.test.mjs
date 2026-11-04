import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize } from 'parse5';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { applyDataNoise, applyHtmlNoise } from '../src/noise/noise.mjs';
import { renderPage } from '../src/render/renderers.mjs';

const FIELD_LIST_OPERATORS = ['nested-layout-table', 'obsolete-markup', 'deep-wrapper-tree'];

function fixture(fields, types, { variation = 0 } = {}) {
  const config = validateConfig({
    seed: 71,
    site: { id: 'noise-event-fidelity', pageCount: 8 },
    variation: { amount: variation },
    contentTypes: [{ name: 'record', label: 'Records', fields }],
    noise: { level: 'custom', probability: 1, severity: 2, maxPerPage: types.length, types },
  });
  return createModel(config);
}

function observedDom(site, page) {
  return serialize(parse(applyHtmlNoise(renderPage(site, page), page, site)));
}

function assertNoPhantomEvent(source, canonical, type) {
  const cleanDom = serialize(parse(renderPage(source.site, canonical)));
  const forced = structuredClone(canonical);
  forced.noiseEvents = [{ type, severity: 2, preservesSemantics: true }];
  assert.equal(observedDom(source.site, forced), cleanDom, `${type} unexpectedly changed ${canonical.pageId}`);
  const page = applyDataNoise(canonical, source.site);
  assert(!page.noiseEvents.some(event => event.type === type), `${type} was logged for ${canonical.pageId}`);
  assert.equal(observedDom(source.site, page), cleanDom);
}

test('field-list operators are absent where the renderer has no field list', () => {
  for (const type of FIELD_LIST_OPERATORS) {
    const richSource = fixture([
      { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
    ], [type], { variation: 80 });
    const listing = richSource.pages.find(page => page.kind === 'listing' && page.repeatedItems?.length);
    assert(listing.repeatedItems.some(item => Object.keys(item.fields).length > 1));
    assertNoPhantomEvent(richSource, listing, type);

    for (const fields of [
      [{ name: 'title', type: 'title' }],
      [{ name: 'title', type: 'title' }, { name: 'coverImage', type: 'image' }],
      [{ name: 'title', type: 'title' }, { name: 'note', type: 'text', optional: true, presenceProbability: 0 }],
    ]) {
      const source = fixture(fields, [type]);
      const detail = source.pages.find(page => page.kind === 'detail' && page.contentType === 'record');
      assertNoPhantomEvent(source, detail, type);
    }
  }
});

test('each field-list operator changes DOM when a visible scalar field exists', () => {
  for (const type of FIELD_LIST_OPERATORS) {
    const source = fixture([{ name: 'title', type: 'title' }, { name: 'author', type: 'person' }], [type]);
    const canonical = source.pages.find(page => page.kind === 'detail' && page.contentType === 'record');
    const page = applyDataNoise(canonical, source.site);
    assert.deepEqual(page.noiseEvents.map(event => event.type), [type]);
    assert.notEqual(observedDom(source.site, page), serialize(parse(renderPage(source.site, canonical))));
  }
});

test('missing-field removes the last field-list target and its wrapper events', () => {
  for (const type of FIELD_LIST_OPERATORS) {
    const source = fixture([{ name: 'title', type: 'title' }, { name: 'author', type: 'person' }],
      ['missing-field', type]);
    const canonical = source.pages.find(page => page.kind === 'detail' && page.contentType === 'record');
    const page = applyDataNoise(canonical, source.site);
    assert.deepEqual(page.noiseEvents.map(event => event.type), ['missing-field']);
    assert.equal(page.fieldStates.author, 'absent');
    assert.notEqual(observedDom(source.site, page), serialize(parse(renderPage(source.site, canonical))));
  }
});
