import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { renderPage } from '../src/pages/renderers.mjs';
import { analyzePage } from '../src/crawl/page-analysis.mjs';
import { applyDataNoise, applyHtmlNoise } from '../src/noise/noise.mjs';
import { generate } from '../src/site/generator.mjs';
import { validateAnswerKey } from '../src/answers/answer-key.mjs';
import { buildTransportPlan } from '../src/noise/transport.mjs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const input = () => ({ seed: 41, site: { id: 'optional-demo', pageCount: 30 }, contentTypes: [{ name: 'record', label: 'Records', fieldLayout: 'mixed', fields: [{ name: 'title', type: 'title' }, { name: 'author', type: 'person' }, { name: 'publicationDate', type: 'date' }, { name: 'note', type: 'text', optional: true }] }] });

test('optional fields are source-first, repeatable, and independent of noise settings', () => {
  const config = validateConfig(input());
  const model = createModel(config);
  assert.deepEqual(model, createModel(config));
  const records = model.pages.filter(page => page.contentType === 'record');
  assert(records.some(page => Object.hasOwn(page.fields, 'note')));
  assert(records.some(page => !Object.hasOwn(page.fields, 'note')));
  assert.equal(new Set(records.map(page => page.expectedCluster)).size, 1);
  assert.deepEqual(model.schemaDefinitions.record.optional, ['note']);
  const dirty = input(); dirty.noise = { level: 'high' };
  assert.deepEqual(model.pages, createModel(validateConfig(dirty)).pages);
});

test('every mixed field layout renders the exact source values with cosmetic noise', () => {
  const config = input(); config.noise = { level: 'custom', probability: 1, maxPerPage: 4, types: ['extra-wrapper','class-churn','reorder-fields','duplicate-id'] };
  const model = createModel(validateConfig(config));
  const layouts = new Set();
  for (const original of model.pages.filter(page => page.contentType === 'record')) {
    const page = applyDataNoise(original, model.site);
    const html = applyHtmlNoise(renderPage(model.site, page), page, model.site);
    const observed = analyzePage(html, `https://fiction.test${page.url}`);
    assert.deepEqual(observed.fields, page.fields);
    layouts.add(page.fieldLayout);
    assert.equal((html.match(/id="content-value"/g) ?? []).length, 2);
  }
  assert.equal(layouts.size, 3);
});

test('different content labels with identical schemas share a structural answer cluster', () => {
  const config = input();
  config.contentTypes.push({ ...structuredClone(config.contentTypes[0]), name: 'feature', label: 'Features' });
  const model = createModel(validateConfig(config));
  assert.equal(new Set(model.pages.filter(page => ['record','feature'].includes(page.contentType)).map(page => page.expectedCluster)).size, 1);
});

test('invalid optional settings fail before generation', () => {
  const optionalTitle = input(); optionalTitle.contentTypes[0].fields[0].optional = true;
  assert.throws(() => validateConfig(optionalTitle), /title cannot be optional/);
  const probability = input(); probability.contentTypes[0].fields[1].presenceProbability = .5;
  assert.throws(() => validateConfig(probability), /requires an optional/);
  const multipleImages = input(); multipleImages.contentTypes[0].fields.push({ name: 'otherImage', type: 'image' }, { name: 'coverImage', type: 'image' });
  assert.throws(() => validateConfig(multipleImages), /supports one image field/);
});

test('optional book covers are seeded source fields with exact public selectors and local assets', async () => {
  const input = { seed: 41, variation: { amount: 80 }, site: { id: 'book-covers', pageCount: 30 }, contentTypes: [{ name: 'book', label: 'Books', fields: [
    { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
    { name: 'coverImage', type: 'image', optional: true },
  ] }] };
  const config = validateConfig(input);
  const source = createModel(config);
  assert.deepEqual(source, createModel(config));
  const books = source.pages.filter(page => page.contentType === 'book');
  assert(books.some(page => page.fieldStates.coverImage === 'present'));
  assert(books.some(page => page.fieldStates.coverImage === 'absent'));
  assert.equal(new Set(books.map(page => page.expectedCluster)).size, 1);
  const root = await mkdtemp(join(tmpdir(), 'siteforge-covers-'));
  try {
    const output = join(root, 'run');
    await generate(input, output);
    const answer = JSON.parse(await readFile(join(output, 'private', 'answer-key.json'), 'utf8'));
    assert.deepEqual(answer.schemaDefinitions.book.optional, ['coverImage']);
    for (const page of answer.pages.filter(page => page.contentType === 'book')) {
      const html = await readFile(join(output, 'public', page.url, 'index.html'), 'utf8');
      assert.equal(page.fieldSelectors.coverImage, 'img[data-field="coverImage"]');
      if (page.fieldStates.coverImage === 'present') {
        assert.equal(page.fields.coverImage, page.canonicalValues.coverImage);
        assert.equal(page.image.src, page.fields.coverImage);
        assert.match(html, new RegExp(`<img src="${page.fields.coverImage.replaceAll('.', '\\.') }"[^>]*data-field="coverImage"`));
        assert((await stat(join(output, 'public', page.fields.coverImage))).size > 100);
      } else {
        assert.equal(Object.hasOwn(page.fields, 'coverImage'), false);
        assert.equal(Object.hasOwn(page.canonicalValues, 'coverImage'), false);
        assert.equal(page.image, null);
        assert.doesNotMatch(html, /data-field="coverImage"/);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a broken cover updates the observed image field while retaining its source value', () => {
  const config = validateConfig({ seed: 41, site: { id: 'broken-cover', pageCount: 10 }, contentTypes: [{ name: 'book', label: 'Books', fields: [
    { name: 'title', type: 'title' }, { name: 'coverImage', type: 'image' },
  ] }], noise: { level: 'custom', probability: 1, severity: 2, maxPerPage: 1, types: ['broken-image'] } });
  const source = createModel(config);
  const page = source.pages.find(page => page.contentType === 'book');
  const observed = applyDataNoise(page, source.site);
  assert.equal(observed.noiseEvents[0].field, 'coverImage');
  assert.match(observed.fields.coverImage, /^\/assets\/missing-/);
  assert.equal(observed.image.src, observed.fields.coverImage);
  assert.equal(observed.canonicalValues.coverImage, page.fields.coverImage);
  assert.match(applyHtmlNoise(renderPage(source.site, observed), observed, source.site), /data-field="coverImage"/);
  validateAnswerKey(source, { ...source, pages: source.pages.map(page => applyDataNoise(page, source.site)), transport: buildTransportPlan(source.pages, { profile: config.transport.profile, seed: config.seed }) }, config);
});

test('image fields do not pretend to be scalar labels or a second reorderable field', () => {
  for (const fields of [[{ name: 'title', type: 'title' }, { name: 'coverImage', type: 'image' }],
    [{ name: 'title', type: 'title' }, { name: 'author', type: 'person' }, { name: 'coverImage', type: 'image' }]]) {
    const config = validateConfig({ seed: 41, site: { id: 'image-only', pageCount: 5 }, contentTypes: [{ name: 'book', label: 'Books', fields }],
      noise: { level: 'custom', probability: 1, maxPerPage: 5, types: ['label-variation', 'reorder-fields', 'duplicate-id', 'nested-layout-table', 'obsolete-markup'] } });
    const source = createModel(config);
    for (const original of source.pages.filter(page => page.contentType === 'book')) {
      const page = applyDataNoise(original, source.site);
      assert(!page.noiseEvents.some(event => ['reorder-fields', 'duplicate-id'].includes(event.type)));
      if (fields.length === 2) assert.equal(page.noiseEvents.length, 0);
      else {
        assert.equal(page.noiseEvents.find(event => event.type === 'label-variation').field, 'author');
        assert.notEqual(applyHtmlNoise(renderPage(source.site, page), page, source.site), renderPage(source.site, original));
      }
    }
  }
});
