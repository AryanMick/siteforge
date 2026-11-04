import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createProject,
  getRun,
  runDirectory,
  startRun,
  updateLabels,
  updateProject,
} from '../src/crawl/pagepilot/store.mjs';
import { recordsCsv } from '../src/crawl/pagepilot/export.mjs';

async function completedRun(projectId, runId) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const run = await getRun(projectId, runId);
    if (run?.status !== 'running') return run;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}

test('completed runs can be re-clustered from their saved evidence without losing settings, exclusions, labels, or CSV safety', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepilot-workflow-'));
  const previousDataDir = process.env.PAGEPILOT_DATA_DIR;
  process.env.PAGEPILOT_DATA_DIR = directory;
  try {
    const project = await createProject({ name: 'Workflow library', profile: 'library', pageCount: 24, seed: 48291 });
    const original = await completedRun(project.id, (await startRun(project.id)).id);
    assert.equal(original.status, 'completed', original.error);
    assert.equal(original.result.metrics.coverage, 1);
    assert.equal(original.result.pages.length, 24);
    const immutableOriginal = structuredClone(original);
    const foreignProject = await createProject({ name: 'Other project' });
    await assert.rejects(updateLabels(foreignProject.id, original.id, { labels: {} }), /Run not found/);
    await assert.rejects(startRun(project.id, { sourceRunId: original.id, threshold: 0.32, excludedUrls: ['/not-observed/'] }), /not present/);
    await assert.rejects(startRun(project.id, { sourceRunId: original.id, threshold: 0.32, excludedUrls: original.result.pages.map(page => page.url) }), /at least one/);

    const originalInput = JSON.parse(await readFile(join(runDirectory(original.id), 'input.json'), 'utf8'));
    const originalCrawl = JSON.parse(await readFile(join(runDirectory(original.id), 'artifacts', 'crawl.json'), 'utf8'));

    await updateProject(project.id, {
      name: 'Changed after crawl', profile: 'archive', pageCount: 30, noise: 'high', seed: 19,
      mode: 'synthetic', url: '', pathPrefix: '/', maxPages: 5, threshold: 0.32,
    });
    const reclustered = await completedRun(project.id, (await startRun(project.id, {
      sourceRunId: original.id, threshold: 0.61, excludedUrls: [],
    })).id);
    assert.equal(reclustered.status, 'completed', reclustered.error);
    assert.equal(reclustered.kind, 'recluster');
    assert.equal(reclustered.sourceRunId, original.id);
    assert.equal(reclustered.snapshotRunId, original.id);
    assert.deepEqual(reclustered.result.provenance, original.result.provenance);
    assert.equal(reclustered.result.provenance.noise, 'clean');
    assert.deepEqual(JSON.parse(await readFile(join(runDirectory(reclustered.id), 'input.json'), 'utf8')), { ...originalInput, threshold: 0.61 });
    assert.deepEqual(JSON.parse(await readFile(join(runDirectory(reclustered.id), 'artifacts', 'crawl.json'), 'utf8')), originalCrawl);
    assert.equal(reclustered.stages.find(stage => stage.id === 'prepare').status, 'skipped');
    assert.equal(reclustered.stages.find(stage => stage.id === 'crawl').status, 'skipped');

    const excludedUrl = original.result.pages.find(page => page.cluster !== 'excluded').url;
    const excluded = await completedRun(project.id, (await startRun(project.id, {
      sourceRunId: original.id, threshold: 0.61, excludedUrls: [excludedUrl],
    })).id);
    assert.equal(excluded.status, 'attention');
    assert(excluded.result.metrics.coverage < original.result.metrics.coverage);
    assert.equal(excluded.result.pages.find(page => page.url === excludedUrl).excluded, true);
    assert.equal(excluded.result.pages.find(page => page.url === excludedUrl).cluster, 'excluded');
    assert(excluded.result.warnings.some(warning => /excluded.*coverage/i.test(warning)));

    const restored = await completedRun(project.id, (await startRun(project.id, {
      sourceRunId: excluded.id, threshold: 0.61, excludedUrls: [],
    })).id);
    assert.equal(restored.status, 'completed', restored.error);
    assert.equal(restored.sourceRunId, excluded.id);
    assert.equal(restored.snapshotRunId, original.id);
    assert.equal(restored.result.metrics.coverage, original.result.metrics.coverage);
    assert.equal(restored.result.pages.find(page => page.url === excludedUrl).excluded, false);
    assert.notEqual(restored.result.pages.find(page => page.url === excludedUrl).cluster, 'excluded');

    const metricsBeforeLabel = structuredClone(restored.result.metrics);
    const clusterId = restored.result.clusters[0].id;
    const labeled = await updateLabels(project.id, restored.id, { labels: { [clusterId]: '  Books  ' } });
    assert.equal(labeled.result.labels[clusterId], 'Books');
    assert.deepEqual(labeled.result.metrics, metricsBeforeLabel);
    await assert.rejects(updateLabels(project.id, restored.id, { labels: { unknown: 'Nope' } }), /Unknown cluster ID/);
    await assert.rejects(updateLabels(project.id, restored.id, { labels: { [clusterId]: 'x'.repeat(81) } }));
    assert.equal((await getRun(project.id, restored.id)).result.labels[clusterId], 'Books');

    const csvRun = structuredClone(labeled);
    const csvPage = csvRun.result.pages[0];
    csvPage.fields.danger = '  =SUM(1,1)"\r\nnext';
    csvRun.result.labels[csvPage.cluster] = '=label "quoted"\r\nnext';
    const csv = recordsCsv(csvRun);
    assert.match(csv, /"'  =SUM\(1,1\)""\r\nnext"/);
    assert.match(csv, /"'=label ""quoted""\r\nnext"/);
    assert.match(csv, /"field:danger"/);
    assert.deepEqual(await getRun(project.id, original.id), immutableOriginal);
  } finally {
    if (previousDataDir === undefined) delete process.env.PAGEPILOT_DATA_DIR; else process.env.PAGEPILOT_DATA_DIR = previousDataDir;
    await rm(directory, { recursive: true, force: true });
  }
});
