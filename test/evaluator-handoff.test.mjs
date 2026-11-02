import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handoffDirectory, publishSiteHandoff } from '../src/fixture-lab/handoff.mjs';
import { createJob, getJob, jobDirectory, siteDirectory, ownedSite } from '../src/fixture-lab/store.mjs';
import { sitePlan, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { createPlanSnapshot, planDescriptor, planPath } from '../src/fixture-lab/plans.mjs';
import { answerStream, publicZipStream } from '../src/fixture-lab/archive.mjs';
import { serve } from '../src/server.mjs';
import { listFiles } from '../src/artifact-files.mjs';

async function withRoot(run) {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-handoff-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  try { await run(); }
  finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function finished(id) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const job = await getJob(id);
    if (job?.status !== 'running') return job;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error('Fixture handoff did not finish');
}

test('worker publishes a private evaluator folder without linking back to runtime truth', { timeout: 45000 }, () => withRoot(async () => {
  const started = await createJob({ name: 'Evaluator handoff', siteCount: 1, pagesPerSite: 5, seed: 19 });
  const job = await finished(started.id);
  assert.equal(job.status, 'completed', job.error);
  const site = job.sites[0];
  const hostname = `${site.id}.siteforge.test`;
  const source = siteDirectory(job.id, site.id);
  const handoff = handoffDirectory(job.id, site.id);
  assert.deepEqual(site.handoff, { version: 1, status: 'ready', directory: handoff });
  assert.equal(handoff, join(jobDirectory(job.id), 'handoff', hostname));
  const publicNames = await listFiles(join(source, 'public'));
  assert.deepEqual(await listFiles(handoff), ['answer-key.json', 'index.html', 'metadata.json', ...publicNames.map(name => `website/${name}`)].sort());
  assert.match(await readFile(join(handoff, 'index.html'), 'utf8'), /\.\/website\/index\.html/);
  assert.deepEqual(await readFile(join(handoff, 'answer-key.json')), await readFile(join(source, 'private', 'answer-key.json')));
  assert.deepEqual(await readFile(join(handoff, 'metadata.json')), await readFile(join(source, 'private', 'metadata.json')));
  assert.deepEqual(await readFile(join(handoff, 'website', 'index.html')), await readFile(join(source, 'public', 'index.html')));
  assert.notEqual((await stat(join(handoff, 'answer-key.json'))).ino, (await stat(join(source, 'private', 'answer-key.json'))).ino);
  await writeFile(join(handoff, 'answer-key.json'), 'edited export');
  await writeFile(join(handoff, 'website', 'index.html'), 'edited website');
  assert.equal(JSON.parse(await readFile(join(source, 'private', 'answer-key.json'), 'utf8')).pages.length, 5);
  assert.notEqual(await readFile(join(source, 'public', 'index.html'), 'utf8'), 'edited website');
  await assert.rejects(publishSiteHandoff(job.id, site.id), /already exists/);
  assert.equal(await readFile(join(handoff, 'answer-key.json'), 'utf8'), 'edited export');
}));

test('handoff rejects unsafe source entries and preserves partial runtime output', () => withRoot(async () => {
  const id = randomUUID();
  const siteId = 'site-0-library';
  const source = siteDirectory(id, siteId);
  await mkdir(join(source, 'public'), { recursive: true });
  await mkdir(join(source, 'private'));
  await writeFile(join(source, 'public', 'index.html'), '<h1>Source</h1>');
  await writeFile(join(source, 'private', 'answer-key.json'), '{"pages":[]}');
  await writeFile(join(source, 'private', 'metadata.json'), '{"pageCount":0}');
  await symlink(join(source, 'private', 'answer-key.json'), join(source, 'public', 'leak.json'));
  await assert.rejects(publishSiteHandoff(id, siteId), /symlinks/);
  assert.equal(await readFile(join(source, 'public', 'index.html'), 'utf8'), '<h1>Source</h1>');
  assert.equal((await readdir(join(jobDirectory(id), 'handoff'))).length, 0);
  await assert.rejects(publishSiteHandoff(id, '../escape'), /Invalid site ID/);
  await rm(join(source, 'public', 'leak.json'));
  await rm(join(source, 'private', 'answer-key.json'));
  await symlink(join(source, 'public', 'index.html'), join(source, 'private', 'answer-key.json'));
  await assert.rejects(publishSiteHandoff(id, siteId), /regular file/);
  await rm(join(source, 'private', 'answer-key.json'));
  await writeFile(join(source, 'private', 'answer-key.json'), '{"pages":[]}');
  await writeFile(join(source, 'public', 'unsafe\\name.html'), '<h1>Unsafe</h1>');
  await assert.rejects(publishSiteHandoff(id, siteId), /unsafe website file name/);
  await rm(join(source, 'public', 'unsafe\\name.html'));
  await rm(join(source, 'private', 'metadata.json'));
  await assert.rejects(publishSiteHandoff(id, siteId), /ENOENT/);
  assert.equal((await readdir(join(jobDirectory(id), 'handoff'))).length, 0);
}));

test('completed source remains accessible when evaluator-folder publishing fails', { timeout: 45000 }, () => withRoot(async () => {
  const id = randomUUID();
  const config = validateFixtureInput({ name: 'Preserved source', siteCount: 1, pagesPerSite: 5, seed: 29 });
  const plan = sitePlan(config, 0);
  const snapshot = createPlanSnapshot(config);
  await mkdir(jobDirectory(id), { recursive: true });
  await mkdir(join(process.env.FIXTURE_LAB_DATA_DIR, 'active.lock'));
  await writeFile(join(process.env.FIXTURE_LAB_DATA_DIR, 'active.lock', 'owner.json'), JSON.stringify({ id, pid: process.pid }));
  await writeFile(planPath(jobDirectory(id)), JSON.stringify(snapshot));
  await writeFile(join(jobDirectory(id), 'job.json'), JSON.stringify({ id, name: config.name, status: 'running', config, planSnapshot: planDescriptor(snapshot), completedSites: 0, totalPages: 5, sites: [] }));
  await writeFile(join(jobDirectory(id), 'handoff'), 'Existing output must not be overwritten');
  assert.throws(() => execFileSync(process.execPath, ['scripts/fixture-worker.mjs', id], { env: process.env, stdio: 'pipe', timeout: 30000 }));
  const job = await getJob(id);
  assert.equal(job.status, 'failed');
  assert.equal(job.completedSites, 1);
  assert.equal(job.sites[0].handoff.status, 'failed');
  const owned = await ownedSite(id, plan.id);
  const answer = await answerStream(owned.directory);
  const chunks = [];
  for await (const chunk of answer) chunks.push(chunk);
  assert.equal(JSON.parse(Buffer.concat(chunks).toString()).pages.length, 5);
  let zipBytes = 0;
  for await (const chunk of await publicZipStream(owned.directory)) zipBytes += chunk.length;
  assert(zipBytes > 100);
  const preview = await serve(owned.directory, { port: 0 });
  try { assert.equal((await fetch(preview.url)).status, 200); }
  finally { await preview.close(); }
  assert.equal(await readFile(join(jobDirectory(id), 'handoff'), 'utf8'), 'Existing output must not be overwritten');
}));
