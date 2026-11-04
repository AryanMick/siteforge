import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { listFiles } from '../../src/site/artifact-files.mjs';
import { validateAnswerKey } from '../../src/answers/answer-key.mjs';
import { validateConfig } from '../../src/site/config.mjs';
import { assertSavedSiteSummary, loadPlanSnapshot } from '../../src/fixture-lab/plans.mjs';
import { siteHostname } from '../../src/fixture-lab/gateway.mjs';
import { getJob, jobDirectory, siteDirectory, validUuid } from '../../src/fixture-lab/store.mjs';
import { hash } from '../../src/site/util.mjs';
import { hashFile, hashJson } from '../../src/site/json-artifacts.mjs';
import { answerSummary } from '../../src/fixture-lab/answer-inspection.mjs';
import { auditSiteHandoff, handoffDirectory } from '../../src/fixture-lab/handoff.mjs';

const jobId = validUuid(process.argv[2]);
const output = resolve(process.argv[3] ?? `outputs/job-audits/${jobId}.json`);
const started = performance.now();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ version: 1, jobId, status: 'running' }) + '\n');
let job;
let snapshot;
try {
  job = await getJob(jobId);
  assert(job, 'Fixture job not found');
  assert.equal(job.status, 'completed', 'Audit requires a completed fixture job');
  assert.equal(job.completedSites, job.config.siteCount, 'Completed-site count does not match the request');
  assert.equal(job.sites.length, job.config.siteCount, 'Saved site inventory does not match the request');
  assert.equal(job.totalPages, job.sites.reduce((total, site) => total + site.pageCount, 0), 'Saved site page total differs from the job');
  assert(job.totalPages <= 100000, 'Saved page total exceeds 100,000');
  assert.equal(new Set(job.sites.map(site => site.id)).size, job.sites.length, 'Site IDs are not unique');
  snapshot = await loadPlanSnapshot(job, jobDirectory(jobId));
  const expectedHosts = job.sites.map(site => `127.0.0.1 ${siteHostname(site.id)}`).join('\n') + '\n';
  let savedHosts;
  try { savedHosts = await readFile(join(jobDirectory(jobId), 'hosts.txt'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (savedHosts !== undefined) assert.equal(savedHosts, expectedHosts, 'Saved batch hosts mapping was changed');
  else assert(job.sites.every(site => site.handoff?.version === 1 && site.handoff.status === 'ready'), 'A legacy job is missing its saved hosts mapping');
} catch (error) {
  const evidence = { version: 1, jobId, status: 'failed', sitesAudited: 0, sitesPassed: 0, pagesVerified: 0,
    publicFilesVerified: 0, handoffFilesVerified: 0, plannedPages: job?.totalPages ?? null,
    durationMs: Math.round(performance.now() - started), failures: [{ id: jobId, message: String(error?.message ?? error) }], sites: [] };
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  throw error;
}

const sites = [];
const failures = [];
let fileCount = 0;
let pageCount = 0;
let handoffFileCount = 0;
for (let index = 0; index < job.sites.length; index++) {
  const summary = job.sites[index];
  try {
    const plan = snapshot?.sites[index];
    if (plan) {
      for (const [key, value] of Object.entries(plan.summary)) assert.deepEqual(summary[key], value, `Saved site ${key} differs from the plan snapshot`);
    }
    const root = siteDirectory(jobId, summary.id);
    const privateRoot = join(root, 'private');
    const publicRoot = join(root, 'public');
    const readJson = async name => JSON.parse(await readFile(join(privateRoot, name), 'utf8'));
    const rawConfig = await readJson('config.json');
    const source = await readJson('canonical.json');
    const answer = await readJson('answer-key.json');
    const metadata = await readJson('metadata.json');
    const manifest = await readJson('manifest.json');
    const files = await listFiles(publicRoot);
    const launcher = await readFile(join(root, 'index.html'), 'utf8');
    const config = validateConfig(rawConfig);
    if (plan) assert.deepEqual(rawConfig, plan.config, 'Saved config differs from the plan snapshot');
    assertSavedSiteSummary(summary, config, index, job.config);
    assert.equal(await hashFile(join(privateRoot, 'answer-key.json')), await hashFile(join(privateRoot, 'ground-truth.json')), 'Answer-key alias differs from the answer key');
    const truth = validateAnswerKey(source, answer, config);
    assert.equal(truth.pages.length, summary.pageCount, 'Answer page count differs from the job');
    assert.equal(metadata.pageCount, summary.pageCount, 'Metadata page count differs from the job');
    assert.equal(metadata.site.id, summary.id, 'Metadata site ID differs from the job');
    if (metadata.configuration) assert.deepEqual(metadata.configuration, rawConfig, 'Metadata configuration differs from saved configuration');
    if (metadata.coverage) {
      const counts = {}; let affectedPages = 0;
      for (const page of answer.pages) {
        if (page.noiseEvents.length) affectedPages++;
        for (const type of new Set(page.noiseEvents.map(event => event.type))) counts[type] = (counts[type] ?? 0) + 1;
      }
      assert.deepEqual(metadata.coverage, { counts, affectedPages }, 'Metadata coverage differs from generated answers');
    }
    assert.equal(metadata.answerSha256, hashJson(truth), 'Metadata answer digest is invalid');
    assert.equal(manifest.configurationSha256, hash(rawConfig), 'Config digest is invalid');
    assert.equal(manifest.canonicalSha256, hashJson(source.pages), 'Canonical digest is invalid');
    assert.equal(manifest.truthSha256, hashJson(truth), 'Answer digest is invalid');
    try {
      const inspection = await readJson('answer-index.json');
      assert.deepEqual(inspection, answerSummary(truth), 'Answer inspector index differs from the answer key');
      for (let offset = 0; offset < truth.pages.length; offset += 250) {
        const chunk = await readJson(`answer-pages/${offset / 250}.json`);
        assert.deepEqual(chunk, truth.pages.slice(offset, offset + 250), 'Answer inspector page chunk differs from the answer key');
      }
    } catch (error) {
      if (error.code !== 'ENOENT' || manifest.inspectionVersion) throw error;
      // Older jobs have no inspection sidecars. A partially missing new index is invalid.
      if (await readFile(join(privateRoot, 'answer-index.json')).then(() => true, failure => { if (failure.code === 'ENOENT') return false; throw failure; })) throw error;
    }
    assert.equal(manifest.pageCount, summary.pageCount, 'Manifest page count differs from the job');
    assert.deepEqual(files, Object.keys(manifest.artifactFiles).sort(), 'Public file inventory differs from the manifest');
    assert.equal(files.filter(file => file.endsWith('index.html')).length, summary.pageCount, 'Public HTML page inventory is incomplete');
    assert.match(launcher, /url=\.\/public\/index\.html/, 'Site launcher is missing');
    for (const file of files) {
      const bytes = await readFile(join(publicRoot, file));
      assert.equal(hash(bytes), manifest.artifactFiles[file], `Public file digest mismatch: ${file}`);
    }
    if (summary.handoff) {
      assert.equal(summary.handoff.version, 1, 'Unsupported handoff version');
      assert.equal(summary.handoff.status, 'ready', 'Evaluator handoff is not complete');
      assert.equal(summary.handoff.directory, handoffDirectory(jobId, summary.id), 'Evaluator handoff path differs from its owned folder');
      handoffFileCount += (await auditSiteHandoff(jobId, summary.id)).files;
    }
    pageCount += summary.pageCount;
    fileCount += files.length;
    sites.push({ id: summary.id, pages: summary.pageCount, publicFiles: files.length, status: 'passed' });
  } catch (error) {
    failures.push({ id: summary.id, message: String(error?.message ?? error) });
    sites.push({ id: summary.id, status: 'failed' });
  }
  if ((index + 1) % 25 === 0 || index + 1 === job.sites.length) console.log(`${index + 1}/${job.sites.length} sites audited`);
}

const evidence = {
  version: 1,
  jobId,
  status: failures.length === 0 && pageCount === job.totalPages ? 'passed' : 'failed',
  sitesAudited: sites.length,
  sitesPassed: sites.length - failures.length,
  pagesVerified: pageCount,
  publicFilesVerified: fileCount,
  handoffFilesVerified: handoffFileCount,
  plannedPages: job.totalPages,
  planProvenance: snapshot ? 'saved-plan-snapshot' : 'legacy-saved-config',
  durationMs: Math.round(performance.now() - started),
  failures,
  sites,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ ...evidence, sites: undefined }));
if (evidence.status !== 'passed') process.exitCode = 1;
