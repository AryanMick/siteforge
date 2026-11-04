import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import { sitePlan, validateFixtureInput } from '../../src/fixture-lab/config.mjs';
import { validateConfig } from '../../src/site/config.mjs';
import { createModel } from '../../src/site/model.mjs';
import { buildTransportPlan } from '../../src/noise/transport.mjs';
import { CATALOG_SETTINGS, listCatalogCases } from '../../src/fixture-lab/case-catalog.mjs';
import { randomFixtureInput, randomRequestSchema } from '../../src/fixture-lab/random.mjs';
import { applyDataNoise } from '../../src/noise/noise.mjs';
import { validateAnswerKey } from '../../src/answers/answer-key.mjs';
import { generate } from '../../src/site/generator.mjs';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface FixtureWorld extends World {
  fixtureInput: Record<string, unknown>;
  fixturePlans: ReturnType<typeof sitePlan>[];
  fixtureModel: ReturnType<typeof createModel>;
  fixtureFailure?: unknown;
  transportPlan: { rules: { path: string }[] };
  answer: ReturnType<typeof createModel> & { transport: ReturnType<typeof buildTransportPlan> };
  source: ReturnType<typeof createModel>;
  config: ReturnType<typeof validateConfig>;
  answerDirectory: string;
  answerRoot: string;
}
Given('a random fixture request with seed {int}', function(this: FixtureWorld, seed: number) {
  this.fixtureInput = randomFixtureInput({ seed, pagesPerSite: 16 });
});
Given('a random fixture request with seed {int}, {int} pages and randomness {int}', function(this: FixtureWorld, seed: number, pagesPerSite: number, randomness: number) {
  this.fixtureInput = randomFixtureInput({ seed, pagesPerSite, randomness });
});
Given('a random fixture request with {int} pages', function(this: FixtureWorld, pagesPerSite: number) {
  this.fixtureInput = { seed: 0, pagesPerSite };
});
When('the random fixture request is validated', function(this: FixtureWorld) {
  try { randomRequestSchema.parse(this.fixtureInput); } catch (error) { this.fixtureFailure = error; }
});
Then('the source plan has randomness {int}', function(this: FixtureWorld, randomness: number) {
  assert.equal(validateConfig(this.fixturePlans[0].config).variation?.amount, randomness);
});
Then('its {int} source pages already define their clusters and fields', function(this: FixtureWorld, count: number) {
  const source = createModel(validateConfig(this.fixturePlans[0].config));
  assert.equal(source.pages.length, count);
  assert(source.pages.every(page => page.expectedCluster && page.fields.title && page.canonicalValues));
});
Given('a fixture request with scenario {string} and framework {string}', function(this: FixtureWorld, scenario: string, framework: string) {
  this.fixtureInput = { name: 'Legacy library', scenario, framework, siteCount: 1, pagesPerSite: 60, visualStyle: 'legacy', noise: 'high', optionalFields: true, seed: 48291 };
});
Given('its randomness is {int}', function(this: FixtureWorld, randomness: number) { this.fixtureInput.randomness = randomness; });
Given('a fixture request for {int} sites of {int} pages', function(this: FixtureWorld, siteCount: number, pagesPerSite: number) {
  this.fixtureInput = { name: 'Page budget', siteCount, pagesPerSite };
});
When('the generator resolves the first site plan twice', function(this: FixtureWorld) { this.fixturePlans = [sitePlan(this.fixtureInput, 0), sitePlan(this.fixtureInput, 0)]; });
Then('both plans contain the same source configuration', function(this: FixtureWorld) { assert.deepEqual(this.fixturePlans[0], this.fixturePlans[1]); });
Then('the planned site contains {int} pages', function(this: FixtureWorld, pages: number) { assert.equal(this.fixturePlans[0].config.site.pageCount, pages); });
Then('its noise families are restricted to {string}', function(this: FixtureWorld, families: string) { assert.deepEqual(this.fixturePlans[0].config.noise.types, families.split(',')); });
When('the fixture source model includes optional fields', function(this: FixtureWorld) { this.fixtureModel = createModel(validateConfig(sitePlan(this.fixtureInput, 0).config)); });
Then('book pages with and without their optional summary share one expected cluster', function(this: FixtureWorld) {
  const books = this.fixtureModel.pages.filter(page => page.contentType === 'book');
  assert(books.some(page => (page.fieldStates as Record<string, string>).summary === 'absent'));
  assert(books.some(page => (page.fieldStates as Record<string, string>).summary === 'present'));
  assert.deepEqual([...new Set(books.map(page => page.expectedCluster))], ['book']);
});
Then('book pages with and without their optional cover share one expected cluster', function(this: FixtureWorld) {
  const books = this.fixtureModel.pages.filter(page => page.contentType === 'book');
  assert(books.some(page => (page.fieldStates as Record<string, string>).coverImage === 'absent'));
  assert(books.some(page => (page.fieldStates as Record<string, string>).coverImage === 'present'));
  assert.deepEqual([...new Set(books.map(page => page.expectedCluster))], ['book']);
  for (const page of books as Array<typeof books[number] & { fieldSelectors: Record<string, string>; fields: Record<string, string>; fieldStates: Record<string, string> }>) {
    assert.equal(page.fieldSelectors.coverImage, 'img[data-field="coverImage"]');
    if (page.fieldStates.coverImage === 'present') assert.equal(page.image.src, page.fields.coverImage);
    else assert.equal(page.image, null);
  }
});
Then('book and author listings have different item clusters', function(this: FixtureWorld) {
  const listing = (type: string) => this.fixtureModel.pages.find(page => page.pageId.startsWith(`listing-${type}-`));
  const book = listing('book');
  const author = listing('author');
  assert(book && author);
  assert.notEqual(book.expectedCluster, author.expectedCluster);
  assert.deepEqual(this.fixtureModel.schemaDefinitions[book.expectedCluster].repeatedItemSchema.map((field: { name: string }) => field.name), ['author', 'summary', 'title']);
  assert.deepEqual(this.fixtureModel.schemaDefinitions[author.expectedCluster].repeatedItemSchema.map((field: { name: string }) => field.name), ['biography', 'name', 'title']);
});
Then('book listings retain one cluster when optional summaries are absent', function(this: FixtureWorld) {
  const listings = this.fixtureModel.pages.filter(page => page.pageId.startsWith('listing-book-'));
  const items = listings.flatMap(page => (page as typeof page & { repeatedItems?: { fields: Record<string, unknown> }[] }).repeatedItems ?? []);
  assert.equal(new Set(listings.map(page => page.expectedCluster)).size, 1);
  assert(items.some(item => Object.hasOwn(item.fields, 'summary')));
  assert(items.some(item => !Object.hasOwn(item.fields, 'summary')));
});
When('the fixture request is validated', function(this: FixtureWorld) { try { validateFixtureInput(this.fixtureInput); } catch (error) { this.fixtureFailure = error; } });
Then('the fixture request is rejected before generation', function(this: FixtureWorld) { assert(this.fixtureFailure instanceof Error); });
Given('its server response profile is {string}', function(this: FixtureWorld, profile: string) { this.fixtureInput.transport = profile; });
When('the generator plans transport before rendering', function(this: FixtureWorld) {
  const config = validateConfig(sitePlan(this.fixtureInput, 0).config);
  this.fixtureModel = createModel(config);
  this.transportPlan = buildTransportPlan(this.fixtureModel.pages, { profile: config.transport.profile, seed: config.seed });
});
Then('the private transport plan has {int} distinct detail paths', function(this: FixtureWorld, count: number) {
  assert.equal(this.transportPlan.rules.length, count);
  assert.equal(new Set(this.transportPlan.rules.map(rule => rule.path)).size, count);
  assert(this.transportPlan.rules.every(rule => this.fixtureModel.pages.some(page => page.kind === 'detail' && page.url === rule.path)));
});
Then('changing transport does not alter the canonical records', function(this: FixtureWorld) {
  const plain = validateConfig(sitePlan({ ...this.fixtureInput, transport: 'none' }, 0).config);
  assert.deepEqual(createModel(plain), this.fixtureModel);
});

Given('the full legacy and protocol case catalog', function(this: FixtureWorld) {
  this.fixtureInput = { ...CATALOG_SETTINGS, name: 'BDD catalog', seed: 48291 };
});
When('every catalog case is resolved into a fixture plan', function(this: FixtureWorld) {
  this.fixturePlans = listCatalogCases().map((_: unknown, index: number) => sitePlan(this.fixtureInput, index));
});
Then('there are {int} distinct configurations excluding names URLs and seeds', function(this: FixtureWorld, count: number) {
  const signatures = this.fixturePlans.map(plan => {
    const { seed: _seed, site, ...rest } = validateConfig(plan.config);
    const { id: _id, name: _name, baseUrl: _url, ...behavior } = site;
    return JSON.stringify({ ...rest, site: behavior });
  });
  assert.equal(signatures.length, count); assert.equal(new Set(signatures).size, count);
});
Then('{int} plans use HTTP and {int} use HTTPS', function(this: FixtureWorld, http: number, https: number) {
  assert.equal(this.fixturePlans.filter(plan => plan.config.previewProtocol === 'http').length, http);
  assert.equal(this.fixturePlans.filter(plan => plan.config.previewProtocol === 'https').length, https);
});
Then('the catalog defines {int} pages with answers from source records', function(this: FixtureWorld, count: number) {
  let pages = 0;
  for (const plan of this.fixturePlans) {
    const model = createModel(validateConfig(plan.config)); pages += model.pages.length;
    assert(model.pages.every(page => page.expectedCluster && Object.hasOwn(page.fields, 'title')));
  }
  assert.equal(pages, count);
});

Given('a {int}-page fixture with challenge {string}, noise {string}, scenario {string} and framework {string}', function(this: FixtureWorld, pages: number, challenge: string, noise: string, scenario: string, framework: string) {
  this.fixtureInput = { name: 'BDD harder source', pagesPerSite: pages, challenge, noise, scenario, framework, seed: 48291, optionalFields: true };
});
When('its private answer key is assembled from source', function(this: FixtureWorld) {
  this.config = validateConfig(sitePlan(this.fixtureInput, 0).config);
  this.source = createModel(this.config);
  this.answer = { ...this.source, pages: this.source.pages.map(page => applyDataNoise(page, this.source.site)), transport: buildTransportPlan(this.source.pages, { profile: this.config.transport.profile, seed: this.config.seed }) };
  validateAnswerKey(this.source, this.answer, this.config);
});
Then('the key has exactly {int} known pages with valid states and local relations', function(this: FixtureWorld, pages: number) {
  assert.equal(this.answer.pages.length, pages);
  assert.equal(new Set(this.answer.pages.map(page => page.url)).size, pages);
  const urls = new Set(this.answer.pages.map(page => page.url));
  for (const page of this.answer.pages) {
    assert(page.expectedCluster in this.answer.schemas);
    for (const [field, state] of Object.entries(page.fieldStates)) assert.equal(Object.hasOwn(page.fields, field), state === 'present');
    for (const relation of page.relationships as Array<{ targetUrl: string }>) assert(urls.has(relation.targetUrl));
  }
});
Then('its challenge intensity is {string}', function(this: FixtureWorld, intensity: string) {
  if (intensity === 'clean') {
    assert.equal(this.config.noise.probability, 0);
    assert(this.answer.pages.every(page => page.noiseEvents.length === 0));
  } else if (intensity === 'standard') assert.equal(this.config.noise.probability, 0.7);
  else {
    assert.equal(this.config.noise.probability, intensity === 'hard' ? 0.85 : 1);
    assert.equal(this.config.noise.severity, 3);
    assert(this.answer.pages.some(page => page.noiseEvents.length > 0));
  }
});
When('the answer key is corrupted with {string}', function(this: FixtureWorld, defect: string) {
  const answer = structuredClone(this.answer);
  if (defect === 'duplicate ID') answer.pages[1].pageId = answer.pages[0].pageId;
  if (defect === 'missing page') answer.pages.pop();
  if (defect === 'unknown cluster') answer.pages[1].expectedCluster = 'unknown';
  if (defect === 'invalid state') answer.pages[0].fieldStates.title = 'unknown';
  if (defect === 'stale relation') (answer.pages.find(page => page.relationships.length)!.relationships as Array<{ targetUrl: string }>)[0].targetUrl = '/missing/';
  if (defect === 'nonexistent field') (answer.pages.find(page => page.kind === 'detail')!.noiseEvents as Array<{ type: string; severity: number; preservesSemantics: boolean; field?: string }>).push({ type: 'missing-field', severity: 3, preservesSemantics: false, field: 'ghost' });
  if (defect === 'wrong image') answer.pages[0].image.src = '/assets/missing-42.png';
  this.answer = answer;
});
Then('answer key validation rejects the corruption', function(this: FixtureWorld) {
  assert.throws(() => validateAnswerKey(this.source, this.answer, this.config));
});
When('its private answer key is generated on disk', async function(this: FixtureWorld) {
  this.config = validateConfig(sitePlan(this.fixtureInput, 0).config);
  const root = await mkdtemp(join(tmpdir(), 'bdd-answer-key-'));
  this.answerRoot = root;
  this.answerDirectory = join(root, 'site');
  await generate(this.config, this.answerDirectory);
});
Then('both private answer filenames contain identical JSON', async function(this: FixtureWorld) {
  const key = await readFile(join(this.answerDirectory, 'private/answer-key.json'));
  assert.deepEqual(key, await readFile(join(this.answerDirectory, 'private/ground-truth.json')));
  assert.equal(JSON.parse(key.toString()).pages.length, 5);
});
Then('neither answer filename appears in the public website', async function(this: FixtureWorld) {
  const publicNames = await readdir(join(this.answerDirectory, 'public'));
  assert(!publicNames.includes('answer-key.json'));
  assert(!publicNames.includes('ground-truth.json'));
  await rm(this.answerRoot, { recursive: true, force: true });
});
Given('a random fixture with seed {int} and challenge {string}', function(this: FixtureWorld, seed: number, challenge: string) {
  this.fixtureInput = randomFixtureInput({ seed, challenge, pagesPerSite: 16, randomness: 100 });
});
Then('its selected challenge is {string}', function(this: FixtureWorld, challenge: string) {
  assert.equal((this.fixturePlans[0].config as { challenge?: string }).challenge, challenge);
});
