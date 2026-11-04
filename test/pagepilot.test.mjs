import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { validateProject, evaluationGate } from '../src/crawl/pagepilot/config.mjs';
import { runPipeline, resultStatus, crawlStageStatus } from '../src/crawl/pagepilot/pipeline.mjs';
import { createProject, listProjects, startRun, projectDetail, getRun, checkId, recoverActiveRun } from '../src/crawl/pagepilot/store.mjs';

test('project validation rejects unsupported settings and unsafe URL input', () => {
  assert.equal(validateProject({ name: ' Library ' }).name, 'Library');
  for (const extra of [{ name: '' }, { pageCount: 101 }, { pageCount: 11 }, { seed: -1 }, { maxPages: 501 }, { maxDepth: 11 }, { maxDurationMinutes: 31 }, { profile: 'custom' }, { noise: 'unknown' }, { command: 'anything' }, { pathPrefix: '/a/../b' }, { pathPrefix: '/%2eenv' }, { pathPrefix: '/bad%GG' }, { pathPrefix: '/a?b' }]) assert.throws(() => validateProject({ name: 'Test', ...extra }));
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com', 'http://127.0.0.1:4200', 'http://localhost', 'http://[::1]']) assert.throws(() => validateProject({ name: 'Test', mode: 'public', url }));
  assert.equal(validateProject({ name: 'Public', mode: 'public', url: 'https://example.com#part' }).url, 'https://example.com/');
});

test('gates never present unknown or incomplete results as successful accuracy', () => {
  assert.equal(evaluationGate({ coverage: null, pairwiseF1: null, fieldValueF1: null }, true).status, 'failed');
  assert.equal(evaluationGate({ coverage: 1, pairwiseF1: 1, fieldValueF1: 1 }, true).status, 'passed');
  assert.equal(evaluationGate({}, false).status, 'not_available');
  assert.equal(resultStatus({ metrics: { pages: 0 } }), 'failed');
  assert.equal(crawlStageStatus({ analyzed: 3, allEligibleAnalyzed: false }), 'attention');
  assert.equal(crawlStageStatus({ analyzed: 0, allEligibleAnalyzed: false }), 'failed');
  assert.equal(crawlStageStatus({ analyzed: 3, allEligibleAnalyzed: true }), 'passed');
  assert.equal(resultStatus({ metrics: { pages: 3 }, evaluation: { status: 'not_available' }, crawl: { allEligibleAnalyzed: false } }), 'attention');
});

test('each fictional profile runs the real pipeline with independent private answers', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagepilot-pipeline-'));
  try {
    for (const profile of ['library', 'archive', 'government']) {
      const events = [];
      const result = await runPipeline({ name: profile, profile, pageCount: 24 }, join(dir, profile), async event => { events.push(event); });
      assert.equal(result.metrics.pages, 24);
      assert.equal(result.metrics.coverage, 1);
      assert.equal(result.evaluation.status, 'passed', JSON.stringify(result.metrics));
      assert.equal(resultStatus(result), 'completed');
      assert(events.some(event => event.id === 'export' && event.status === 'passed'));
      assert(!JSON.stringify(result).includes('canonicalValues'));
      assert(!JSON.stringify(result).includes('expectedCluster'));
      assert(result.pages.every(page => page.url.startsWith('/')));
      assert(result.pages.every(page => page.fields && page.cluster));
      assert.equal(result.diagnostics.robots.status, 'loaded');
      assert.equal('text' in result.diagnostics.robots, false);
      assert.equal(result.diagnostics.requestedUrl, result.diagnostics.effectiveUrl);
    }
    const noisy = await runPipeline({ name: 'Noisy', profile: 'library', pageCount: 24, noise: 'high' }, join(dir, 'noisy'));
    const clean = JSON.parse(await readFile(join(dir, 'library/result.json'), 'utf8'));
    assert.equal(noisy.provenance.canonicalSha256, clean.provenance.canonicalSha256);
    assert(noisy.provenance.noiseEvents > 0);
    assert.equal(noisy.metrics.coverage, 1);
    assert.equal(resultStatus(noisy), 'attention');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saved crawl diagnostics survive pipeline processing without another network request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagepilot-diagnostics-'));
  try {
    const source = join(dir, 'source'); await mkdir(source);
    const url = 'https://archive.example/';
    const robots = { url: url + 'robots.txt', status: 'unavailable', code: 'CERT_HAS_EXPIRED', reason: 'Certificate expired' };
    await writeFile(join(source, 'crawl.json'), JSON.stringify({ startUrl: url, effectiveStartUrl: url, pages: [], urls: [{ url, state: 'unattempted', reason: 'robots_unavailable' }], robots, limitations: [], summary: { analyzed: 0, discovered: 1, allEligibleAnalyzed: false, stopReason: 'robots_unavailable', counts: { failed: 0, unattempted: 1 } } }));
    const result = await runPipeline({ name: 'Failed legacy site', mode: 'public', url }, join(dir, 'result'), async () => {}, { sourceDirectory: source });
    assert.deepEqual(result.diagnostics.robots, robots);
    assert.equal(result.diagnostics.effectiveUrl, url);
    assert.equal(resultStatus(result), 'failed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('public pipeline rejects private-network targets without any local fetch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagepilot-private-'));
  try { await assert.rejects(runPipeline({ name: 'Private', mode: 'public', url: 'http://192.168.1.1/' }, dir), /Private network/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('store persists runs, rejects duplicate starts, scopes exports and recovers dead workers', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagepilot-store-'));
  const previous = process.env.PAGEPILOT_DATA_DIR; process.env.PAGEPILOT_DATA_DIR = dir;
  try {
    assert.deepEqual(await listProjects(), []);
    const project = await createProject({ name: 'Stored library' });
    assert.equal(project.status, 'ready');
    const launches = await Promise.allSettled([startRun(project.id), startRun(project.id)]);
    assert.equal(launches.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(launches.filter(result => result.status === 'rejected').length, 1);
    const run = launches.find(result => result.status === 'fulfilled').value;
    let detail;
    for (let i = 0; i < 200; i++) {
      detail = await projectDetail(project.id);
      if (detail.project.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(detail.project.status, 'completed', JSON.stringify(detail));
    assert.equal(detail.runs[0].result.metrics.pages, 24);
    assert.equal((await listProjects())[0].metrics.coverage, 1);
    assert.equal(await getRun(randomUUID(), run.id), null);
    assert.throws(() => checkId('../secret'));
    assert.equal(await projectDetail(randomUUID()), null);
    const interrupted = { ...detail.runs[0], id: randomUUID(), status: 'running', result: null, finishedAt: null, startedAt: '2020-01-01T00:00:00Z' };
    await mkdir(join(dir, 'runs', interrupted.id));
    await writeFile(join(dir, 'runs', interrupted.id, 'run.json'), JSON.stringify(interrupted));
    await writeFile(join(dir, 'active.json'), JSON.stringify({ id: interrupted.id, pid: 99999999, startedAt: interrupted.startedAt }));
    await recoverActiveRun();
    assert.equal((await getRun(project.id, interrupted.id)).status, 'failed');
    assert.equal((await getRun(project.id, run.id)).status, 'completed');
    await writeFile(join(dir, 'runs', interrupted.id, 'run.json'), JSON.stringify(interrupted));
    await writeFile(join(dir, 'active.json'), JSON.stringify({ id: interrupted.id, pid: process.pid, startedAt: interrupted.startedAt }));
    await recoverActiveRun();
    assert.equal((await getRun(project.id, interrupted.id)).status, 'failed', 'old live/reused PIDs cannot keep the queue locked');
    const longRun = { ...interrupted, id: randomUUID(), startedAt: new Date().toISOString() };
    await mkdir(join(dir, 'runs', longRun.id));
    await writeFile(join(dir, 'runs', longRun.id, 'run.json'), JSON.stringify(longRun));
    await writeFile(join(dir, 'active.json'), JSON.stringify({ id: longRun.id, pid: process.pid, startedAt: longRun.startedAt, deadlineAt: new Date(Date.now() + 60000).toISOString() }));
    await recoverActiveRun();
    assert.equal((await getRun(project.id, longRun.id)).status, 'running', 'a live worker is retained until its configured deadline');
    await writeFile(join(dir, 'projects', `${project.id}.json`), '{bad');
    await assert.rejects(listProjects(), /preserved/);
  } finally {
    if (previous === undefined) delete process.env.PAGEPILOT_DATA_DIR; else process.env.PAGEPILOT_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
