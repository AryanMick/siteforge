import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { parse } from 'parse5';
import { validateConfig } from '../src/site/config.mjs';
import { validateFixtureInput, sitePlan, FIXTURE_DOMAINS } from '../src/fixture-lab/config.mjs';
import { randomFixtureInput } from '../src/fixture-lab/random.mjs';
import { createModel } from '../src/site/model.mjs';
import { applyDataNoise, applyHtmlNoise } from '../src/noise/noise.mjs';
import { renderPage, finalizePage } from '../src/pages/renderers.mjs';
import { buildTransportPlan } from '../src/noise/transport.mjs';
import { validateAnswerKey } from '../src/answers/answer-key.mjs';
import { generate } from '../src/site/generator.mjs';
import { answerJson, downloadName, publicZip } from '../src/fixture-lab/archive.mjs';
import { walk } from '../src/site/util.mjs';

function built(input = {}) {
  const request = validateFixtureInput({ name: 'Harder behavior', pagesPerSite: 60, seed: 48291, domain: 'library', framework: 'html', noise: 'high', scenario: 'baseline', ...input });
  const config = validateConfig(sitePlan(request, 0).config);
  const source = createModel(config);
  const answer = { ...source, pages: source.pages.map(page => applyDataNoise(page, source.site)), transport: buildTransportPlan(source.pages, { profile: config.transport.profile, seed: config.seed }) };
  return { request, config, source, answer };
}

const triples = [
  ['extra-wrapper', 'nested-layout-table', 'obsolete-markup'],
  ['duplicate-heading', 'conflicting-metadata', 'missing-metadata'],
  ['missing-field', 'label-variation', 'reorder-fields'],
  ['missing-field', 'date-format', 'reorder-fields'],
  ['date-format', 'label-variation', 'duplicate-id'],
  ['boilerplate', 'hidden-boilerplate', 'comment-clutter'],
  ['broken-image', 'link-variants', 'duplicate-heading'],
  ['malformed-nesting', 'nested-layout-table', 'class-churn'],
  ['inline-style', 'extra-wrapper', 'obsolete-markup'],
  ['conflicting-metadata', 'duplicate-heading', 'boilerplate'],
  ['duplicate-id', 'reorder-fields', 'nested-layout-table'],
  ['missing-field', 'broken-image', 'hidden-boilerplate'],
  ['label-variation', 'date-format', 'inline-style'],
  ['link-variants', 'comment-clutter', 'malformed-nesting'],
  ['malformed-nesting', 'duplicate-heading', 'conflicting-metadata'],
  ['obsolete-markup', 'boilerplate', 'reorder-fields'],
];
for (const types of triples) test(`three-operator interaction: ${types.join(' + ')}`, () => {
  const base = built({ challenge: 'extreme', pagesPerSite: 80, optionalFields: true });
  const config = validateConfig({ ...base.config, noise: { level: 'custom', types, probability: 1, severity: 3, maxPerPage: 3 } });
  const source = createModel(config);
  const answer = { ...source, pages: source.pages.map(page => applyDataNoise(page, source.site)), transport: buildTransportPlan(source.pages, { seed: config.seed }) };
  validateAnswerKey(source, answer, config);
  const combined = answer.pages.find(page => types.every(type => page.noiseEvents.some(event => event.type === type)));
  assert(combined, `No page received all three eligible operators: ${types.join(', ')}`);
  const html = finalizePage(source.site, combined, applyHtmlNoise(renderPage(source.site, combined), combined, source.site));
  const dom = parse(html);
  assert(walk(dom, node => node.tagName === 'h1').length >= 1);
  assert(html.includes(combined.fields.title));
  if (types.includes('duplicate-heading')) assert(walk(dom, node => node.tagName === 'h1').length >= 2);
  if (types.includes('nested-layout-table')) assert(html.includes('layout-table-3'));
  if (types.includes('conflicting-metadata')) assert(html.includes('Untitled legacy catalog record'));
  if (types.includes('missing-field')) assert(combined.noiseEvents.some(event => event.type === 'missing-field' && combined.fieldStates[event.field] === 'absent'));
});

for (const domain of FIXTURE_DOMAINS) for (const pagesPerSite of [5, 200]) test(`${domain} ${pagesPerSite}-page challenge boundary keeps exact source inventory`, () => {
  const clean = pagesPerSite === 5;
  const fixture = built({ domain, pagesPerSite, challenge: 'extreme', noise: clean ? 'clean' : 'high', framework: pagesPerSite === 5 ? 'html' : 'react', previewProtocol: 'https', seed: 17 });
  assert.equal(fixture.source.pages.length, pagesPerSite);
  assert.equal(fixture.config.previewProtocol, 'https');
  assert.equal(fixture.config.challenge, 'extreme');
  validateAnswerKey(fixture.source, fixture.answer, fixture.config);
  assert.equal(new Set(fixture.answer.pages.map(page => page.url)).size, pagesPerSite);
  assert(fixture.answer.pages.every(page => page.expectedCluster in fixture.answer.schemas));
  if (clean) assert(fixture.answer.pages.every(page => page.noiseEvents.length === 0));
  else assert(fixture.answer.pages.some(page => page.noiseEvents.length > 0));
});

const corruptions = [
  ['duplicate page ID', answer => { answer.pages[1].pageId = answer.pages[0].pageId; }],
  ['duplicate URL', answer => { answer.pages[1].url = answer.pages[0].url; }],
  ['missing page', answer => { answer.pages.pop(); }],
  ['unknown cluster', answer => { answer.pages[1].expectedCluster = 'unknown'; }],
  ['lost canonical value', answer => { delete answer.pages.find(page => page.kind === 'detail').canonicalValues.title; }],
  ['invalid field state', answer => { answer.pages[0].fieldStates.title = 'unknown'; }],
  ['stale relation', answer => { answer.pages.find(page => page.relationships.length).relationships[0].targetUrl = '/missing/'; }],
  ['nonexistent event field', answer => { answer.pages.find(page => page.kind === 'detail').noiseEvents.push({ type: 'missing-field', severity: 3, preservesSemantics: false, field: 'ghost' }); }],
  ['unrecorded field value', answer => { answer.pages[0].fields.title = 'Wrong title'; }],
  ['unknown schema', answer => { answer.pages[1].contentType = 'unknown'; }],
  ['transport targets missing page', answer => { answer.transport.rules[0].path = '/missing/'; }],
  ['unrecorded broken image', answer => { answer.pages[0].image.src = '/assets/missing-42.png'; }],
];
for (const [name, change] of corruptions) test(`answer export rejects ${name}`, () => {
  const fixture = built({ challenge: 'extreme', transport: 'errors' });
  validateAnswerKey(fixture.source, fixture.answer, fixture.config);
  const damaged = structuredClone(fixture.answer);
  change(damaged);
  assert.throws(() => validateAnswerKey(fixture.source, damaged, fixture.config), /Invalid answer key|Invalid transport plan/);
});

test('absent and explicit standard challenge reproduce the same observable truth', () => {
  const old = built(); const standard = built({ challenge: 'standard' });
  assert.deepEqual(old.answer, standard.answer);
  assert.equal(Object.hasOwn(old.config, 'challenge'), false);
  assert.equal(standard.config.challenge, 'standard');
});
test('hard and extreme retain the same canonical records while increasing eligible events', () => {
  const standard = built({ challenge: 'standard' }); const hard = built({ challenge: 'hard' }); const extreme = built({ challenge: 'extreme' });
  assert.deepEqual(standard.source.pages.map(page => page.canonicalValues), hard.source.pages.map(page => page.canonicalValues));
  assert.deepEqual(hard.source.pages.map(page => page.canonicalValues), extreme.source.pages.map(page => page.canonicalValues));
  const count = fixture => fixture.answer.pages.reduce((sum, page) => sum + page.noiseEvents.length, 0);
  assert(count(standard) < count(hard)); assert(count(hard) <= count(extreme));
});
test('clean challenge remains zero even at extreme level', () => {
  const fixture = built({ noise: 'clean', challenge: 'extreme' });
  assert.equal(fixture.config.noise.probability, 0);
  assert.equal(fixture.config.noise.maxPerPage, 0);
  assert(fixture.answer.pages.every(page => page.noiseEvents.length === 0));
});
test('random zero content variation stays clean under extreme challenge', () => {
  const input = randomFixtureInput({ seed: 0, randomness: 0, pagesPerSite: 200, challenge: 'extreme' });
  const fixture = built(input);
  assert.equal(fixture.config.variation.amount, 0);
  assert.equal(fixture.config.noise.level, 'clean');
  assert(fixture.answer.pages.every(page => page.noiseEvents.length === 0));
});
test('same seed replays extreme HTTPS client answers exactly', () => {
  const input = { challenge: 'extreme', framework: 'angular', previewProtocol: 'https', pagesPerSite: 200, seed: 0, scenario: 'extraction-traps' };
  assert.deepEqual(built(input).answer, built(input).answer);
});
test('challenge does not create response faults without an explicit transport profile', () => {
  const fixture = built({ challenge: 'extreme' });
  assert.equal(fixture.answer.transport.profile, 'none');
  assert.deepEqual(fixture.answer.transport.rules, []);
});

test('new private answer bytes match legacy alias and omit both from public ZIP', async t => {
  const root = await mkdtemp(join(tmpdir(), 'answer-key-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = built({ challenge: 'extreme', pagesPerSite: 5 });
  const site = join(root, 'site'); await generate(fixture.config, site);
  const key = await readFile(join(site, 'private/answer-key.json'));
  assert.deepEqual(key, await readFile(join(site, 'private/ground-truth.json')));
  assert.deepEqual(await answerJson(site), key);
  const zip = new AdmZip(await publicZip(site));
  assert.equal(zip.getEntries().filter(entry => entry.entryName.endsWith('/index.html') || entry.entryName === 'index.html').length, 5);
  assert(zip.getEntries().every(entry => !/private|answer-key|ground-truth/.test(entry.entryName)));
});
test('answer download falls back to the legacy private name for a saved job', async t => {
  const root = await mkdtemp(join(tmpdir(), 'answer-fallback-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = built({ pagesPerSite: 5 });
  const site = join(root, 'site'); await generate(fixture.config, site);
  const legacy = await readFile(join(site, 'private/ground-truth.json'));
  await rm(join(site, 'private/answer-key.json'));
  assert.deepEqual(await answerJson(site), legacy);
});
test('download filename identifies the answer key without changing the public ZIP name', () => {
  const job = { name: 'My Test Set' }; const site = { id: 'site-001-library' };
  assert.equal(downloadName(job, site, 'answers'), 'my-test-set-site-001-library-answer-key.json');
  assert.equal(downloadName(job, site, 'public'), 'my-test-set-site-001-library-public.zip');
});
test('explicit hard/extreme catalog requests are rejected while standard retains fixed corpus', () => {
  for (const challenge of ['hard', 'extreme']) assert.throws(() => validateFixtureInput({ name: 'Catalog', suite: 'regression-1440', siteCount: 1440, pagesPerSite: 16, domain: 'mixed', framework: 'mixed', visualStyle: 'legacy', noise: 'mixed', fieldLayout: 'mixed', scenario: 'baseline', transport: 'none', previewProtocol: 'mixed', challenge }));
});
