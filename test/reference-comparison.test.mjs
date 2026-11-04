import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareReferenceDirectory, summarizeReference } from '../scripts/tools/reference-comparison.mjs';

test('comparison keeps counts and unknown gaps without treating samples as ground truth', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reference-comparison-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const crawl = {
    startUrl: 'https://sample.example.test/archive/',
    robots: { status: 'loaded' },
    summary: { discovered: 20, counts: { failed: 1, unattempted: 12 }, stopReason: 'page_budget' },
    urls: [{ state: 'failed', message: 'Timed out' }],
    pages: [{ stats: { linkCount: 10, maxDepth: 40, fieldCount: 3, imageCount: 2 }, records: [],
      issues: [{ code: 'deep-wrapper-tree', count: 2 }, { code: 'unmodeled-layout', count: 1 }] },
    { stats: { linkCount: 4, maxDepth: 7, fieldCount: 5, imageCount: 1 }, records: [{ fields: { title: 'Sample' } }],
      issues: [{ code: 'deep-wrapper-tree', count: 1 }] }],
  };
  const summary = summarizeReference('sample', crawl);
  assert.equal(summary.averageLinks, 7);
  assert.equal(summary.maximumDepth, 40);
  assert.equal(summary.repeatedRecordsDetected, 1);
  assert.deepEqual(summary.issues[0], { code: 'deep-wrapper-tree', count: 3, fictionalOperator: 'deep-wrapper-tree' });
  assert.deepEqual(summary.unmappedIssues, ['unmodeled-layout']);
  assert.equal(summary.failure, 'Timed out');
  await mkdir(join(root, 'sample'));
  await writeFile(join(root, 'sample', 'crawl.json'), JSON.stringify(crawl));
  const comparison = await compareReferenceDirectory(root);
  assert.equal(comparison.sampleCount, 1);
  assert.equal(comparison.analyzedPages, 2);
  assert.equal(comparison.observedIssueTypes, 2);
  assert.equal(comparison.mappedIssueTypes, 1);
  assert.match(comparison.warning, /not known answers/);
});
