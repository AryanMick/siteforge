import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReferenceStudy } from '../src/crawl/reference-study.mjs';
import { scopeReason } from '../src/crawl/real-crawler.mjs';

const sourceMarker = '<source-secret>Live Source Name</source-secret>';
const config = {
  version: 1,
  seed: 1,
  site: {
    id: 'reference-fixture',
    name: 'Synthetic Civic Index',
    domain: 'government',
    framework: 'html',
    rendering: 'static',
    visualStyle: 'conventional',
    pageCount: 13,
    pageSize: 5,
    baseUrl: 'https://synthetic.invalid',
  },
  contentTypes: [
    {
      name: 'permit', label: 'Permits', weight: 1, fieldLayout: 'definition-list',
      fields: [{ name: 'title', type: 'title' }, { name: 'department', type: 'text' }, { name: 'deadline', type: 'date' }],
    },
    {
      name: 'meeting', label: 'Meetings', weight: 1, fieldLayout: 'table',
      fields: [{ name: 'title', type: 'title' }, { name: 'venue', type: 'place' }, { name: 'contact', type: 'person' }],
    },
  ],
  noise: { level: 'clean' },
  limits: { maxPages: 100 },
};

const manifest = {
  version: 1,
  references: [{
    id: 'civic-patterns',
    url: 'https://example.com/catalog/',
    pathPrefix: '/catalog',
    inspiration: [sourceMarker, 'Two visibly distinct record types'],
    config,
  }],
};

async function exists(path) {
  try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function readTree(directory) {
  const contents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) contents.push(await readTree(path));
    else if (entry.isFile()) contents.push(await readFile(path, 'utf8'));
  }
  return contents.join('\n');
}

test('offline reference study keeps private answers isolated and gates clean/cosmetic pairs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-reference-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const out = join(root, 'study');
  const { output, study } = await runReferenceStudy(manifest, out, { seeds: [48291], levels: ['clean', 'cosmetic'] });

  assert.equal(output, out);
  assert.equal(study.status, 'passed');
  assert.equal(study.mode, 'offline');
  assert.equal(study.references[0].source.status, 'not-sampled');
  assert.equal(study.references[0].seeds[0].identicalCanonicalData, true);
  assert.equal(study.gates.failures.length, 0);
  for (const variant of study.references[0].seeds[0].variants) {
    assert.equal(variant.metrics.coverage, 1);
    assert(variant.metrics.pairwiseF1 >= 0.95);
    assert(variant.metrics.fieldValueF1 >= 0.95);
    assert.equal(variant.gate.passed, true);
    const directory = join(out, variant.directory);
    assert(await exists(join(directory, 'private', 'ground-truth.json')));
    assert(await exists(join(directory, 'private', 'score', 'report.html')));
    assert(await exists(join(directory, 'effective-config.json')));
    assert(await exists(join(directory, 'provenance.json')));
    assert(!(await exists(join(directory, 'public', 'private'))));
    for (const name of await readdir(join(directory, 'public'))) assert.notEqual(name, 'ground-truth.json');
    assert(!((await readTree(join(directory, 'public'))).includes(sourceMarker)));
  }

  const provenance = JSON.parse(await readFile(join(out, 'references', 'civic-patterns', 'provenance.json'), 'utf8'));
  assert.equal(provenance.sampling.status, 'not-sampled');
  assert.equal(provenance.observationProvenance, null);
  assert(!(await exists(join(out, 'references', 'civic-patterns', 'private'))));
  assert(!(await exists(join(out, 'references', 'civic-patterns', 'crawl.json'))));
  assert(!(await exists(join(out, 'references', 'civic-patterns', 'source.html'))));
  const report = await readFile(join(out, 'report.html'), 'utf8');
  assert(report.includes('&lt;source-secret&gt;'));
  assert(!report.includes(sourceMarker));
  assert(report.includes('private/score/report.html'));
  assert(report.includes('references/civic-patterns/provenance.json'));
  await assert.rejects(runReferenceStudy(manifest, out, { seeds: [48291], levels: ['clean'] }), /already exists/);
});

test('manifest validation is strict and completes before creating output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-reference-invalid-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const invalidOut = join(root, 'invalid');
  const invalid = structuredClone(manifest);
  invalid.references.push({ ...structuredClone(invalid.references[0]), id: 'bad-private', url: 'https://user:password@example.org/private/' });
  await assert.rejects(runReferenceStudy(invalid, invalidOut, { seeds: [7], levels: ['clean'] }), /credentials|private path/);
  assert.equal(await exists(invalidOut), false);

  const oversizedOut = join(root, 'oversized');
  const oversized = structuredClone(manifest);
  oversized.references[0].config.site.pageCount = 101;
  oversized.references[0].config.limits.maxPages = 101;
  await assert.rejects(runReferenceStudy(oversized, oversizedOut, { seeds: [7], levels: ['clean'] }), /at most 100/);
  assert.equal(await exists(oversizedOut), false);

  const extraOut = join(root, 'extra');
  const extra = { ...structuredClone(manifest), unexpected: true };
  await assert.rejects(runReferenceStudy(extra, extraOut, { seeds: [7], levels: ['clean'] }), /unrecognized/i);
  assert.equal(await exists(extraOut), false);
  for (const path of ['/.hidden/', '/report.pdf']) {
    const invalidPath = structuredClone(manifest);
    invalidPath.references[0].url = `https://example.com${path}`;
    invalidPath.references[0].pathPrefix = '/';
    await assert.rejects(runReferenceStudy(invalidPath, join(root, 'scope-invalid')), /source scope rejected/);
    assert.equal(await exists(join(root, 'scope-invalid')), false);
  }
});

test('encoded literal percent prefixes are retained and decoded exactly once by crawl policy', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-encoded-prefix-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const encoded = structuredClone(manifest);
  encoded.references[0].url = 'https://example.com/catalog%25/';
  encoded.references[0].pathPrefix = '/catalog%25';
  const { study } = await runReferenceStudy(encoded, join(root, 'study'), { seeds: [7], levels: ['clean'] });
  const reference = study.references[0];
  assert.equal(reference.pathPrefix, '/catalog%25');
  assert.equal(scopeReason(new URL(reference.url), new URL(reference.url), { pathPrefix: reference.pathPrefix }), null);
});
