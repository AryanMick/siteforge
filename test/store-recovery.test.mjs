import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/site/generator.mjs';
import { sitePlan, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { listJobsWithDiagnostics, PREVIEW_LIFETIME_MS, previewRecord, previewSite } from '../src/fixture-lab/store.mjs';

test('unreadable jobs and expired preview metadata do not prevent new previews', async context => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-recovery-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  let previewPid;
  try {
    const id = randomUUID();
    const unreadableId = randomUUID();
    const config = validateFixtureInput({ name: 'Healthy', siteCount: 1, pagesPerSite: 5 });
    const plan = sitePlan(config, 0);
    const jobRoot = join(root, 'jobs', id);
    await mkdir(join(jobRoot, 'sites'), { recursive: true });
    await generate(plan.config, join(jobRoot, 'sites', plan.id));
    await writeFile(join(jobRoot, 'job.json'), JSON.stringify({ id, name: 'Healthy', status: 'completed', config, createdAt: new Date().toISOString(), completedSites: 1, totalPages: 5, sites: [plan.summary] }));
    await mkdir(join(root, 'jobs', unreadableId));
    await writeFile(join(root, 'jobs', unreadableId, 'job.json'), '');
    const { jobs, issues } = await listJobsWithDiagnostics();
    assert.deepEqual(jobs.map(job => job.id), [id]);
    assert.deepEqual(issues.map(issue => issue.id), [unreadableId]);
    assert.equal(await readFile(join(root, 'jobs', unreadableId, 'job.json'), 'utf8'), '');

    const previews = join(root, 'previews');
    await mkdir(previews);
    const stale = join(previews, `${unreadableId}--${plan.id}.json`);
    await writeFile(stale, '');
    assert.equal(await previewRecord(unreadableId, plan.id), null);
    const oldRecord = join(previews, `${randomUUID()}--${plan.id}.json`);
    const oldUrl = 'http://127.0.0.1:1/expired-preview';
    const oldData = JSON.stringify({ pid: process.pid, url: oldUrl, expiresAt: new Date(Date.now() + 60000).toISOString() });
    await writeFile(oldRecord, oldData);
    const oldTime = new Date(Date.now() - PREVIEW_LIFETIME_MS - 60000);
    await utimes(oldRecord, oldTime, oldTime);
    const realFetch = globalThis.fetch;
    let oldProbes = 0;
    context.mock.method(globalThis, 'fetch', async (url, options) => {
      if (String(url) === oldUrl) { oldProbes++; return new Response('', { status: 200 }); }
      return realFetch(url, options);
    });
    const preview = await previewSite(id, plan.id);
    assert.equal((await fetch(preview.url)).status, 200);
    previewPid = (await previewRecord(id, plan.id))?.pid;
    assert.equal(await readFile(stale, 'utf8'), '');
    assert.equal(oldProbes, 0, 'Metadata older than the maximum preview lifetime is never probed');
    assert.equal(await readFile(oldRecord, 'utf8'), oldData);
  } finally {
    if (previewPid) process.kill(previewPid, 'SIGTERM');
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
