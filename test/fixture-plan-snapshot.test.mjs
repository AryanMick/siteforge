import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FRAMEWORKS, sitePlan } from '../src/fixture-lab/config.mjs';
import { CATALOG_SETTINGS } from '../src/fixture-lab/case-catalog.mjs';
import { assertSavedSiteSummary } from '../src/fixture-lab/plans.mjs';
import { PRESETS } from '../src/site/presets.mjs';
import { createJob, getJob, jobDirectory, siteDirectory } from '../src/fixture-lab/store.mjs';
import { hash } from '../src/site/util.mjs';

const node = process.execPath;
const cwd = resolve('.');

test('saved plans survive choice and preset drift; audit rejects altered provenance', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-plans-'));
  const previousRoot = process.env.FIXTURE_LAB_DATA_DIR;
  const previousOptions = process.env.NODE_OPTIONS;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    const request = { name: 'Historical', seed: 2, framework: 'random', domain: 'library', pagesPerSite: 5 };
    const baseline = sitePlan(request, 0);
    assert.equal(baseline.config.site.framework, 'react');
    FRAMEWORKS.unshift('html');
    let changed;
    try { changed = sitePlan(request, 0); }
    finally { FRAMEWORKS.shift(); }
    assert.equal(changed.config.site.framework, 'html');
    // Section labels are now chosen per site, so drift is exercised through another preset property.
    const oldWeight = PRESETS.library.types[0].weight;
    PRESETS.library.types[0].weight = 7;
    try { assert.notDeepEqual(sitePlan(request, 0).config, baseline.config); }
    finally { PRESETS.library.types[0].weight = oldWeight; }

    const preload = join(root, 'changed-choices.mjs');
    await writeFile(preload, `import { FRAMEWORKS } from ${JSON.stringify(pathToFileURL(join(cwd, 'src/fixture-lab/config.mjs')).href)};\nimport { PRESETS } from ${JSON.stringify(pathToFileURL(join(cwd, 'src/site/presets.mjs')).href)};\nFRAMEWORKS.unshift('html');\nPRESETS.library.types[0].weight = 7;\n`);
    process.env.NODE_OPTIONS = `--import=${preload}`;
    const started = await createJob(request);
    let job;
    const deadline = Date.now() + 20000;
    do {
      job = await getJob(started.id);
      if (job.status !== 'running') break;
      await new Promise(accept => setTimeout(accept, 100));
    } while (Date.now() < deadline);
    assert.equal(job.status, 'completed', job.error);
    assert.equal(job.sites[0].framework, 'react');
    const directory = jobDirectory(job.id);
    const path = join(directory, 'plan.json');
    const originalPlan = await readFile(path);
    const originalJob = await readFile(join(directory, 'job.json'));
    const siteRoot = siteDirectory(job.id, job.sites[0].id);
    const savedConfig = JSON.parse(await readFile(join(siteRoot, 'private', 'config.json'), 'utf8'));
    assert.equal(savedConfig.site.framework, 'react');
    assert.equal(savedConfig.contentTypes[0].weight, oldWeight);
    assert(!(await readdir(join(siteRoot, 'public'))).includes('plan.json'));
    const evidencePath = join(root, 'audit.json');
    const runAudit = () => execFileSync(node, ['scripts/tools/audit-fixture-job.mjs', job.id, evidencePath], { cwd, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    runAudit();
    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).planProvenance, 'saved-plan-snapshot');

    const changedSummary = JSON.parse(originalJob);
    changedSummary.sites[0].framework = 'html';
    await writeFile(join(directory, 'job.json'), JSON.stringify(changedSummary));
    assert.throws(runAudit);
    assert.match(JSON.parse(await readFile(evidencePath, 'utf8')).failures[0].message, /differs from the plan snapshot/);
    await writeFile(join(directory, 'job.json'), originalJob);
    const configPath = join(siteRoot, 'private', 'config.json');
    const originalConfig = await readFile(configPath);
    const changedConfig = JSON.parse(originalConfig);
    changedConfig.site.name = 'Tampered';
    await writeFile(configPath, JSON.stringify(changedConfig));
    assert.throws(runAudit);
    assert.match(JSON.parse(await readFile(evidencePath, 'utf8')).failures[0].message, /differs from the plan snapshot/);
    await writeFile(configPath, originalConfig);
    runAudit();
    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).status, 'passed');

    const snapshot = JSON.parse(originalPlan);
    snapshot.sites[0].config.site.framework = 'html';
    await writeFile(path, JSON.stringify(snapshot));
    assert.throws(runAudit, error => String(error.stderr).includes('Saved plan snapshot digest mismatch'));
    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).status, 'failed');
    await writeFile(path, originalPlan);
    await rm(path);
    assert.throws(runAudit, error => String(error.stderr).includes('Saved plan snapshot is missing'));
    await writeFile(path, originalPlan);
    const changedJob = JSON.parse(originalJob);
    changedJob.planSnapshot.version = 99;
    await writeFile(join(directory, 'job.json'), JSON.stringify(changedJob));
    assert.throws(runAudit, error => String(error.stderr).includes('Unsupported plan descriptor version'));
    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).status, 'failed');
    await writeFile(join(directory, 'job.json'), originalJob);
    const futureSnapshot = JSON.parse(originalPlan);
    futureSnapshot.version = 99;
    await writeFile(path, JSON.stringify(futureSnapshot));
    changedJob.planSnapshot = { version: 1, sha256: hash(futureSnapshot) };
    await writeFile(join(directory, 'job.json'), JSON.stringify(changedJob));
    assert.throws(runAudit, error => String(error.stderr).includes('Unsupported plan snapshot version'));
    await writeFile(path, originalPlan);
    changedJob.planSnapshot = undefined;
    await writeFile(join(directory, 'job.json'), JSON.stringify(changedJob));
    assert.throws(runAudit, error => String(error.stderr).includes('no job descriptor'));
    await rm(path);
    runAudit();
    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).planProvenance, 'legacy-saved-config');

    const changedRequest = JSON.parse(await readFile(join(directory, 'job.json'), 'utf8'));
    changedRequest.config.framework = 'html';
    await writeFile(join(directory, 'job.json'), JSON.stringify(changedRequest));
    assert.throws(runAudit);
    assert.match(JSON.parse(await readFile(evidencePath, 'utf8')).failures[0].message, /framework differs from the fixed request/);
    await writeFile(join(directory, 'job.json'), JSON.stringify(changedJob));

    const legacyJob = JSON.parse(await readFile(join(directory, 'job.json'), 'utf8'));
    legacyJob.sites[0].seed++;
    await writeFile(join(directory, 'job.json'), JSON.stringify(legacyJob));
    assert.throws(runAudit);
    assert.match(JSON.parse(await readFile(evidencePath, 'utf8')).failures[0].message, /seed differs from its config/);
    await writeFile(join(directory, 'job.json'), JSON.stringify(changedJob));
    changedConfig.site.name = 'Tampered';
    await writeFile(configPath, JSON.stringify(changedConfig));
    assert.throws(runAudit);
    assert.match(JSON.parse(await readFile(evidencePath, 'utf8')).failures[0].message, /Saved site name differs|Config digest is invalid/);
    await writeFile(configPath, originalConfig);
    const hashChangedConfig = JSON.parse(originalConfig);
    hashChangedConfig.contentTypes[0].label = 'Changed valid label';
    const metadataPath = join(siteRoot, 'private', 'metadata.json');
    const originalMetadata = await readFile(metadataPath);
    const changedMetadata = JSON.parse(originalMetadata);
    changedMetadata.configuration = hashChangedConfig;
    await writeFile(configPath, JSON.stringify(hashChangedConfig));
    await writeFile(metadataPath, JSON.stringify(changedMetadata));
    assert.throws(runAudit);
    assert.match(JSON.parse(await readFile(evidencePath, 'utf8')).failures[0].message, /Config digest is invalid/);
    await writeFile(configPath, originalConfig);
    await writeFile(metadataPath, originalMetadata);
    runAudit();
    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).status, 'passed');
    const pageJob = JSON.parse(await readFile(join(directory, 'job.json'), 'utf8'));
    pageJob.totalPages++;
    await writeFile(join(directory, 'job.json'), JSON.stringify(pageJob));
    assert.throws(runAudit, error => String(error.stderr).includes('Saved site page total differs from the job'));
    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).status, 'failed');
  } finally {
    if (previousRoot === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previousRoot;
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousOptions;
    await rm(root, { recursive: true, force: true });
  }
});

test('catalog display labels may differ from saved generated site names', () => {
  const request = { ...CATALOG_SETTINGS, suite: 'catalog-case', siteCount: 1, caseId: 'case-0001', previewProtocol: 'http', name: 'Catalog' };
  const plan = sitePlan(request, 0);
  assert.notEqual(plan.summary.name, plan.config.site.name);
  assert.doesNotThrow(() => assertSavedSiteSummary(plan.summary, plan.config, 0, request));
});

test('legacy random-size sites retain historical counts within the saved bounds', () => {
  const request = { name: 'Random count', seed: 2, framework: 'random', domain: 'library', pagesPerSite: 0 };
  const plan = sitePlan({ ...request, pagesPerSite: 5 }, 0);
  assert.doesNotThrow(() => assertSavedSiteSummary(plan.summary, plan.config, 0, request));
  const summary = { ...plan.summary, pageCount: 201 };
  const config = { ...plan.config, site: { ...plan.config.site, pageCount: 201 } };
  assert.throws(() => assertSavedSiteSummary(summary, config, 0, request), /outside 5\.\.200/);
});

test('legacy literal mixed modes and recorded scenario settings remain binding', () => {
  const request = { name: 'Literal modes', seed: 31, domain: 'library', framework: 'html', pagesPerSite: 5,
    linkMode: 'relative', fieldLayout: 'table', transport: 'none', scenario: 'baseline', optionalFields: true };
  const plan = sitePlan(request, 0);
  assert.doesNotThrow(() => assertSavedSiteSummary(plan.summary, plan.config, 0, request));
  assert.throws(() => assertSavedSiteSummary(plan.summary, plan.config, 0, { ...request, linkMode: 'mixed' }), /linkMode differs from the fixed request/);
  assert.throws(() => assertSavedSiteSummary(plan.summary, plan.config, 0, { ...request, fieldLayout: 'mixed' }), /field layout differs from the fixed request/);
  assert.throws(() => assertSavedSiteSummary(plan.summary, plan.config, 0, { ...request, transport: 'mixed' }), /transport differs from the fixed request/);
  assert.throws(() => assertSavedSiteSummary(plan.summary, plan.config, 0, { ...request, scenario: 'parser-stress' }), /scenario differs from the fixed request/);
  assert.throws(() => assertSavedSiteSummary(plan.summary, plan.config, 0, { ...request, optionalFields: false }), /optional fields differ from the fixed request/);
});
