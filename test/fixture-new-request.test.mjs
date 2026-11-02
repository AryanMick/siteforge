import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateNewFixtureInput } from '../src/fixture-lab/new-request.mjs';
import { validateFixtureInput, sitePlan } from '../src/fixture-lab/config.mjs';
import { CATALOG_SETTINGS } from '../src/fixture-lab/case-catalog.mjs';
import { createPlanSnapshot, planDescriptor, loadPlanSnapshot } from '../src/fixture-lab/plans.mjs';
import { atomicJson, createJob, getJob, listJobs, jobDirectory } from '../src/fixture-lab/store.mjs';

const single = { ...CATALOG_SETTINGS, name: 'Fixed catalog', suite: 'catalog-case', siteCount: 1,
  caseId: 'case-0001', previewProtocol: 'http' };
const overrides = [
  { cmsProfile: 'wordpress' }, { builderProfile: 'elementor', cmsProfile: 'wordpress' },
  { linkMode: 'absolute' }, { randomness: 70 },
  { cmsProfile: 'none', builderProfile: 'none', linkMode: 'root-relative', randomness: 0 },
];

test('new fixed catalog requests reject ignored options, including explicit defaults', () => {
  for (const base of [single, { ...CATALOG_SETTINGS, name: 'Full catalog' }]) {
    assert.equal(validateNewFixtureInput(base).suite, base.suite);
    assert.equal(validateNewFixtureInput({ ...base, challenge: 'standard' }).challenge, 'standard');
    for (const extra of overrides) {
      const input = { ...base, ...extra };
      assert.doesNotThrow(() => validateFixtureInput(input), 'Historical parser remains compatible');
      assert.throws(() => validateNewFixtureInput(input), error => {
        assert.equal(error.name, 'ZodError');
        assert.deepEqual(error.issues.map(issue => issue.path[0]).sort(), Object.keys(extra).sort());
        assert(error.issues.every(issue => /fixed settings/.test(issue.message)));
        return true;
      });
    }
  }
});

test('custom requests retain their CMS, builder, links and variation settings', () => {
  const request = validateNewFixtureInput({ name: 'Custom', pagesPerSite: 8,
    cmsProfile: 'wordpress', builderProfile: 'elementor', linkMode: 'absolute', randomness: 70 });
  const plan = sitePlan(request, 0);
  assert.equal(plan.config.site.cmsProfile, 'wordpress');
  assert.equal(plan.config.site.builderProfile, 'elementor');
  assert.equal(plan.config.site.linkMode, 'absolute');
  assert.equal(plan.config.variation.amount, 70);
});

test('new random builders require a CMS that can resolve to WordPress', () => {
  for (const cmsProfile of [undefined, 'none', 'drupal']) {
    const input = { name: 'Random builder', pagesPerSite: 5, builderProfile: 'random',
      ...(cmsProfile === undefined ? {} : { cmsProfile }) };
    assert.doesNotThrow(() => validateFixtureInput(input), 'Historical parser remains compatible');
    assert.equal(sitePlan(input, 0).summary.builderProfile, 'none');
    assert.throws(() => validateNewFixtureInput(input), error => {
      assert.equal(error.name, 'ZodError');
      assert.equal(error.issues.length, 1);
      assert.deepEqual(error.issues[0].path, ['builderProfile']);
      assert.match(error.issues[0].message, /requires WordPress or a random CMS/);
      return true;
    });
  }
  for (const cmsProfile of ['wordpress', 'random']) {
    const request = validateNewFixtureInput({ name: 'Conditional builder', cmsProfile, builderProfile: 'random' });
    const plans = Array.from({ length: 64 }, (_, seed) => sitePlan({ ...request, seed }, 0));
    assert(plans.some(plan => plan.summary.builderProfile !== 'none'));
    assert(plans.every(plan => plan.summary.cmsProfile === 'wordpress' || plan.summary.builderProfile === 'none'));
  }
});

test('rejected new requests create no jobs and rejected fresh-seed overrides release their lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-new-request-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    await assert.rejects(createJob({ ...single, randomness: 70 }), /fixed settings/);
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(createJob({ name: 'Ignored builder', cmsProfile: 'drupal', builderProfile: 'random' }), /requires WordPress/);
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(createJob(single, { freshSeed: true,
      resolveSeed: seed => ({ ...single, seed, linkMode: 'absolute' }),
    }), /fixed settings/);
    assert.deepEqual(await readdir(root), [], 'No worker, job or stale generation lock');
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('historical catalog requests with ignored options remain readable with their saved snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-old-request-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    const config = validateFixtureInput({ ...single, cmsProfile: 'wordpress', builderProfile: 'elementor', linkMode: 'absolute', randomness: 70 });
    const snapshot = createPlanSnapshot(config);
    assert.equal(snapshot.sites[0].config.site.cmsProfile, undefined);
    const job = { id: '10000000-0000-4000-8000-000000000001', config, status: 'completed',
      createdAt: '2026-10-09T00:00:00Z', totalPages: 16, sites: [], planSnapshot: planDescriptor(snapshot) };
    const directory = jobDirectory(job.id);
    await mkdir(directory, { recursive: true });
    await atomicJson(join(directory, 'job.json'), job);
    await atomicJson(join(directory, 'plan.json'), snapshot);
    const before = await readFile(join(directory, 'job.json'));
    assert.deepEqual(await getJob(job.id), job);
    assert.deepEqual(await listJobs(), [job]);
    assert.deepEqual(await loadPlanSnapshot(job, directory), snapshot);
    assert.deepEqual(await readFile(join(directory, 'job.json')), before);
    await assert.rejects(createJob(config), /fixed settings/, 'Old artifacts are readable, not permission to generate ignored settings again');
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
