import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'parse5';
import { validateConfig } from '../src/site/config.mjs';
import { validateFixtureInput, sitePlan } from '../src/fixture-lab/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { validateAnswerKey } from '../src/answers/answer-key.mjs';
import { generate } from '../src/site/generator.mjs';
import { renderPage } from '../src/pages/renderers.mjs';
import { serve } from '../src/preview/server.mjs';
import { buildTransportPlan } from '../src/noise/transport.mjs';
import { textContent, walk } from '../src/site/util.mjs';

function varied(seed, pagesPerSite = 60) {
  const input = validateFixtureInput({ name: 'Varied crawl fixture', seed, pagesPerSite, randomness: 100,
    domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'high',
    challenge: 'extreme', scenario: 'baseline', optionalFields: true });
  return validateConfig(sitePlan(input, 0).config);
}

function attr(node, name) { return node.attrs?.find(item => item.name === name)?.value; }

test('seeded sites use four distinct shells and vary record templates and images', () => {
  const shells = new Set();
  let example;
  for (let seed = 0; seed < 64; seed++) {
    const model = createModel(varied(seed));
    shells.add(model.site.shell);
    example ??= model;
  }
  assert.deepEqual([...shells].sort(), ['archive', 'civic', 'directory', 'journal']);
  const details = example.pages.filter(page => page.kind === 'detail' && page.contentType !== 'information');
  assert(new Set(details.map(page => page.template)).size >= 4);
  assert(new Set(details.filter(page => page.image).map(page => page.image.src)).size >= 4);
  assert(details.every(page => page.expectedCluster in example.schemas));
  const listings = example.pages.filter(page => page.kind === 'listing');
  assert(listings.every(page => page.repeatedItems?.length > 0));
  assert(listings.some(page => page.repeatedItems.some(item => Object.keys(item.fields).length > 1)));
  assert.doesNotMatch(renderPage(example.site, listings[0]), /No additional details are available/);
});

test('varied listing truth follows declared item schemas across types and optional absence', () => {
  const config = validateConfig({ seed: 41, variation: { amount: 80 }, site: { id: 'listing-truth', pageCount: 80 }, contentTypes: [
    { name: 'book', label: 'Books', fields: [{ name: 'title', type: 'title' }, { name: 'author', type: 'person' }, { name: 'summary', type: 'text', optional: true }, { name: 'coverImage', type: 'image', optional: true }] },
    { name: 'author', label: 'Authors', fields: [{ name: 'title', type: 'title' }, { name: 'name', type: 'person' }, { name: 'biography', type: 'text' }] },
    { name: 'article', label: 'Articles', fields: [{ name: 'title', type: 'title' }, { name: 'publicationDate', type: 'date' }, { name: 'summary', type: 'text' }] },
    { name: 'feature', label: 'Features', fields: [{ name: 'title', type: 'title' }, { name: 'publicationDate', type: 'date' }, { name: 'summary', type: 'text' }] },
  ] });
  const source = createModel(config);
  const listings = source.pages.filter(page => page.kind === 'listing');
  const listing = type => listings.find(page => page.pageId.startsWith(`listing-${type}-`));
  assert.notEqual(listing('book').expectedCluster, listing('author').expectedCluster);
  assert.equal(listing('article').expectedCluster, listing('feature').expectedCluster);
  assert.deepEqual(source.schemaDefinitions[listing('book').expectedCluster].repeatedItemSchema, [
    { name: 'author', type: 'person', optional: false },
    { name: 'summary', type: 'text', optional: true },
    { name: 'title', type: 'title', optional: false },
  ]);
  const books = listings.filter(page => page.expectedCluster === listing('book').expectedCluster).flatMap(page => page.repeatedItems);
  assert(books.some(item => Object.hasOwn(item.fields, 'summary')));
  assert(books.some(item => !Object.hasOwn(item.fields, 'summary')));
  assert(books.every(item => !Object.hasOwn(item.fields, 'coverImage')));
  const answer = { ...source, pages: source.pages.map(page => structuredClone(page)), transport: buildTransportPlan(source.pages) };
  validateAnswerKey(source, answer, config);

  const extra = structuredClone(answer);
  const target = source.pages.find(page => page.pageId === books[0].pageId);
  assert(Object.hasOwn(target.fields, 'coverImage'));
  extra.pages.find(page => page.pageId === listing('book').pageId).repeatedItems[0].fields.coverImage = target.fields.coverImage;
  assert.throws(() => validateAnswerKey(source, extra, config), /Invalid answer key/);
  const wrongCluster = structuredClone(answer);
  wrongCluster.pages.find(page => page.pageId === listing('book').pageId).expectedCluster = listing('author').expectedCluster;
  assert.throws(() => validateAnswerKey(source, wrongCluster, config), /Invalid answer key/);
  const wrongSchema = structuredClone(answer);
  wrongSchema.schemaDefinitions[listing('book').expectedCluster].repeatedItemSchema[0].type = 'text';
  assert.throws(() => validateAnswerKey(source, wrongSchema, config), /Invalid answer key/);
  const missingVersion = structuredClone(answer);
  delete missingVersion.listingTruthVersion;
  assert.throws(() => validateAnswerKey(source, missingVersion, config), /listing truth version is missing/);
  const missingFromBoth = structuredClone(source);
  delete missingFromBoth.listingTruthVersion;
  assert.throws(() => validateAnswerKey(missingFromBoth, { ...missingFromBoth, transport: buildTransportPlan(source.pages) }, config), /listing truth version is missing/);
  const missingItems = structuredClone(source);
  delete missingItems.pages.find(page => page.pageId === listing('book').pageId).repeatedItems;
  assert.throws(() => validateAnswerKey(missingItems, { ...missingItems, transport: buildTransportPlan(source.pages) }, config), /has no repeated items/);

  const legacy = structuredClone(source);
  legacy.generatorVersion = '1.0.0';
  delete legacy.listingTruthVersion;
  for (const page of legacy.pages.filter(page => page.kind === 'listing')) page.expectedCluster = 'listing';
  for (const cluster of new Set(listings.map(page => page.expectedCluster))) {
    delete legacy.schemas[cluster];
    delete legacy.schemaDefinitions[cluster];
  }
  validateAnswerKey(legacy, { ...legacy, transport: buildTransportPlan(legacy.pages) }, config);
});

test('a varied legacy site is crawlable from home without leaking its answer key', async t => {
  const root = await mkdtemp(join(tmpdir(), 'site-variety-crawl-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const siteDir = join(root, 'site');
  await generate(varied(17, 60), siteDir);
  const answer = JSON.parse(await readFile(join(siteDir, 'private', 'answer-key.json'), 'utf8'));
  const source = JSON.parse(await readFile(join(siteDir, 'private', 'canonical.json'), 'utf8'));
  const config = validateConfig(JSON.parse(await readFile(join(siteDir, 'private', 'config.json'), 'utf8')));
  validateAnswerKey(source, answer, config);
  const damaged = structuredClone(answer);
  const listing = damaged.pages.find(page => page.kind === 'listing');
  listing.repeatedItems[0].fields.title = 'Incorrect repeated title';
  assert.throws(() => validateAnswerKey(source, damaged, config), /Invalid answer key/);
  const preview = await serve(siteDir, { port: 0, rebaseOrigin: true });
  t.after(() => preview.close());
  const known = new Set(answer.pages.map(page => page.url));
  const renderedListing = answer.pages.find(page => page.kind === 'listing');
  const listingDocument = parse(await (await fetch(new URL(renderedListing.url, preview.url))).text());
  const listingText = textContent(walk(listingDocument, node => attr(node, 'id') === 'content')[0]);
  for (const item of renderedListing.repeatedItems) for (const value of Object.values(item.fields)) assert(listingText.includes(String(value)));
  const visited = new Set();
  const queue = ['/'];
  let aliases = 0;
  while (queue.length) {
    const path = queue.shift();
    if (visited.has(path)) continue;
    visited.add(path);
    const response = await fetch(new URL(path, preview.url));
    assert.equal(response.status, 200, path);
    const document = parse(await response.text());
    const expected = answer.pages.find(page => page.url === path);
    assert.equal(walk(document, node => node.tagName === 'main').length, expected.noiseEvents.some(event => event.type === 'missing-main') ? 0 : 1);
    assert.equal(walk(document, node => attr(node, 'id') === 'content').length, 1);
    for (const anchor of walk(document, node => node.tagName === 'a' && attr(node, 'href'))) {
      const target = new URL(attr(anchor, 'href'), new URL(path, preview.url));
      if (target.origin !== preview.url || !known.has(target.pathname)) continue;
      if (target.search || target.hash) {
        aliases++;
        const aliasResponse = await fetch(target);
        assert.equal(aliasResponse.status, 200, target.href);
      }
      if (!visited.has(target.pathname)) queue.push(target.pathname);
    }
  }
  assert.equal(visited.size, 60);
  assert.deepEqual([...visited].sort(), [...known].sort());
  assert(aliases > 0, 'The crawl did not encounter an alternate URL');
  assert.equal((await fetch(`${preview.url}/private/answer-key.json`)).status, 404);
  assert.equal((await fetch(`${preview.url}/assets/site-variants.css`)).status, 200);
  for (let variant = 1; variant <= 4; variant++) assert.equal((await fetch(`${preview.url}/assets/collection-${variant}.png`)).status, 200);
});

test('zero variation retains the previous site shell and asset inventory', () => {
  const input = validateFixtureInput({ name: 'Stable fixture', seed: 17, pagesPerSite: 60, randomness: 0,
    domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'clean' });
  const model = createModel(validateConfig(sitePlan(input, 0).config));
  assert.equal(model.site.shell, undefined);
  assert(model.pages.filter(page => page.kind === 'detail' && page.image).every(page => page.image.src === '/assets/collection.png'));
  assert(model.pages.some(page => page.contentType === 'book' && page.fieldStates.coverImage === 'absent' && page.image === null));
  assert(model.pages.filter(page => page.kind === 'detail').every(page => /detail-[012]$/.test(page.template)));
  assert.match(renderPage(model.site, model.pages.find(page => page.kind === 'listing')), /No additional details are available/);
});
