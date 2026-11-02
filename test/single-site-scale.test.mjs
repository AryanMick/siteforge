import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { sitePlan, validateFixtureInput, totalPlannedPages } from '../src/fixture-lab/config.mjs';
import { randomFixtureInput } from '../src/fixture-lab/random.mjs';
import { generate } from '../src/generator.mjs';
import { createModel } from '../src/model.mjs';
import { validateConfig } from '../src/config.mjs';
import { jsonChunks, hashJson, writeJsonArtifact, hashFile } from '../src/json-artifacts.mjs';
import { hash } from '../src/util.mjs';
import { inspectAnswers, inspectionQuery } from '../src/fixture-lab/answer-inspection.mjs';
import { publicZipStream, answerStream } from '../src/fixture-lab/archive.mjs';

test('custom and random requests accept one 100,000-page site, but reject excess budgets', () => {
  const config = validateFixtureInput({ name: 'Full site', siteCount: 1, pagesPerSite: 100000 });
  assert.equal(sitePlan(config, 0).config.site.pageCount, 100000);
  assert.equal(totalPlannedPages(config), 100000);
  assert.equal(randomFixtureInput({ seed: 0, pagesPerSite: 100000 }).pagesPerSite, 100000);
  for (const pagesPerSite of [4, 100001, 5.5, Infinity]) {
    assert.throws(() => validateFixtureInput({ name: 'Invalid', pagesPerSite }));
    assert.throws(() => randomFixtureInput({ seed: 0, pagesPerSite }));
  }
  assert.throws(() => validateFixtureInput({ ...config, siteCount: 2 }), /100,000/);
});

test('incremental artifact JSON and hashes match standard JSON including Unicode and omissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'json-chunks-'));
  try {
    for (const value of [{ version: 1, skipped: undefined, pages: [{ title: '\u00e9\u4e2d\ud83d\udcda', absent: undefined }, { fields: ['x', null] }], end: true }, [1, undefined, null, { a: 'x' }]]) {
      assert.equal([...jsonChunks(value)].join(''), JSON.stringify(value));
      assert.equal(hashJson(value), hash(value));
      await writeJsonArtifact(join(root, 'value.json'), value);
      assert.equal(await readFile(join(root, 'value.json'), 'utf8'), JSON.stringify(value));
      assert.equal(await hashFile(join(root, 'value.json')), hashJson(value));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('answer inspection paginates across chunks, searches every page, and keeps full-site coverage', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'answer-pagination-'));
  try {
    const directory = join(root, 'site');
    const progress = [];
    await generate(sitePlan({ name: 'Paginated', pagesPerSite: 510, noise: 'low', randomness: 50 }, 0).config, directory, { onProgress: async item => progress.push(item) });
    const key = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
    const first = await inspectAnswers(directory, { offset: 245, limit: 25 });
    assert.deepEqual(first.pages, key.pages.slice(245, 270));
    assert.deepEqual(first.pagination, { total: 510, matched: 510, offset: 245, limit: 25 });
    assert.equal(first.coverage.affectedPages, key.pages.filter(page => page.noiseEvents.length).length);
    const last = key.pages.at(-1);
    const searched = await inspectAnswers(directory, { q: last.pageId });
    assert(searched.pages.some(page => page.pageId === last.pageId));
    assert.equal((await inspectAnswers(directory, { offset: 510 })).pages.length, 0);
    assert.equal((await inspectAnswers(directory, { q: 'no-such-answer' })).pagination.matched, 0);
    assert(progress.some(item => item.completedPages === 500));
    assert.equal(progress.at(-1).phase, 'verifying');
    const streamed = [];
    for await (const chunk of await answerStream(directory)) streamed.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(streamed)), key);
    const zipped = [];
    for await (const chunk of await publicZipStream(directory)) zipped.push(chunk);
    const zip = new AdmZip(Buffer.concat(zipped));
    assert.equal(zip.getEntries().filter(entry => entry.entryName.endsWith('index.html')).length, 510);
    assert(zip.getEntries().every(entry => !/private|answer-index|answer-pages|canonical\.json/.test(entry.entryName)));
    const cancelled = await publicZipStream(directory);
    await new Promise((accept, reject) => {
      cancelled.once('error', reject);
      cancelled.once('close', accept);
      cancelled.once('data', () => cancelled.destroy());
    });
    assert.equal(cancelled.destroyed, true);
    await rm(join(directory, 'private', 'answer-index.json'));
    assert.deepEqual((await inspectAnswers(directory, { offset: 245, limit: 25 })).pages, first.pages, 'old saved jobs retain inspection support');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('answer inspection rejects invalid pagination and unbounded queries', () => {
  for (const value of [{ offset: -1 }, { limit: 0 }, { limit: 101 }, { offset: 0.5 }, { offset: 100001 }, { q: 'x'.repeat(201) }, { path: '../private' }]) assert.throws(() => inspectionQuery.parse(value));
});

test('disabling optional variation retains cover values while explicit schemas can omit them', () => {
  const config = validateConfig(sitePlan({ name: 'Fixed presence', pagesPerSite: 60, optionalFields: false, randomness: 100 }, 0).config);
  assert(createModel(config).pages.filter(page => page.contentType === 'book').every(page => page.fieldStates.coverImage === 'present'));
  config.contentTypes.find(type => type.name === 'book').fields.find(field => field.name === 'coverImage').presenceProbability = 0;
  assert(createModel(config).pages.filter(page => page.contentType === 'book').every(page => page.fieldStates.coverImage === 'absent'));
});
