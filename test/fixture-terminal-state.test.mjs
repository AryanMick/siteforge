import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { validateFixtureInput, totalPlannedPages } from '../src/fixture-lab/config.mjs';
import { createPlanSnapshot, planDescriptor } from '../src/fixture-lab/plans.mjs';

async function waitForFile(path) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { await access(path); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

for (const failure of [false, true]) test(`worker publishes ${failure ? 'failure' : 'completion'} only after releasing its batch lock`, { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-terminal-state-'));
  const id = '22222222-2222-4222-8222-222222222222';
  const directory = join(root, 'jobs', id);
  const lock = join(root, 'active.lock');
  const gate = join(root, 'gate');
  const config = validateFixtureInput({ name: 'Terminal state', pagesPerSite: 5, noise: 'clean' });
  const snapshot = createPlanSnapshot(config);
  const job = { id, name: config.name, status: 'running', config, createdAt: new Date().toISOString(),
    completedSites: 0, sites: [], totalPages: totalPlannedPages(config), planSnapshot: planDescriptor(snapshot) };
  await mkdir(directory, { recursive: true });
  await mkdir(lock);
  await mkdir(gate);
  await writeFile(join(directory, 'job.json'), JSON.stringify(job));
  if (!failure) await writeFile(join(directory, 'plan.json'), JSON.stringify(snapshot));
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ id, pid: process.pid, phase: 'preparing', createdAt: job.createdAt }));
  const child = spawn(process.execPath, ['--import', pathToFileURL(resolve('test/helpers/hold-batch-release.mjs')).href,
    process.env.SITEFORGE_TEST_WORKER || 'scripts/fixture-worker.mjs', id], { cwd: process.cwd(), env: { ...process.env,
      FIXTURE_LAB_DATA_DIR: root, SITEFORGE_TEST_RELEASE_GATE: gate }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => accept({ code, signal }));
  });
  try {
    await Promise.race([waitForFile(join(gate, 'waiting')), exited.then(result => {
      throw new Error(`Worker exited before reaching release gate: ${JSON.stringify(result)} ${errors}`);
    })]);
    const duringRelease = JSON.parse(await readFile(join(directory, 'job.json'), 'utf8'));
    assert.equal(duringRelease.status, 'running', 'Terminal status must not race ahead of lock release');
    assert.equal(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')).id, id);
    await writeFile(join(gate, 'release'), 'continue');
    const outcome = await exited;
    assert.equal(outcome.code, failure ? 1 : 0, errors);
    const finished = JSON.parse(await readFile(join(directory, 'job.json'), 'utf8'));
    assert.equal(finished.status, failure ? 'failed' : 'completed');
    assert(finished.finishedAt);
    await assert.rejects(access(lock), { code: 'ENOENT' });
    // A new request can acquire the exact same lock immediately after terminal publication.
    await mkdir(lock);
  } finally {
    await writeFile(join(gate, 'release'), 'cleanup');
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
