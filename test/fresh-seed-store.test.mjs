import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { createJob, getJob, recoverActiveBatch, releaseBatch } from '../src/fixture-lab/store.mjs';

test('fresh seed allocation retains a live lock past the recovery grace period', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-seed-store-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    const heldId = randomUUID();
    const lock = join(root, 'active.lock');
    await mkdir(lock);
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ id: heldId, pid: process.pid, phase: 'preparing', createdAt: new Date(Date.now() - 30000).toISOString() }));
    assert.equal((await recoverActiveBatch()).id, heldId);
    await assert.rejects(createJob({ name: 'Blocked', pagesPerSite: 12 }, { freshSeed: true }), /already running/);
    const heldDirectory = join(root, 'jobs', heldId);
    await mkdir(heldDirectory, { recursive: true });
    await writeFile(join(heldDirectory, 'job.json'), JSON.stringify({
      id: heldId, status: 'running', createdAt: new Date(Date.now() - 30000).toISOString(),
      config: validateFixtureInput({ name: 'Stopped worker', pagesPerSite: 12 }),
    }));
    assert.equal((await getJob(heldId)).status, 'running');
    assert.equal((await recoverActiveBatch()).id, heldId);
    await writeFile(join(heldDirectory, 'worker.json'), JSON.stringify({ pid: 2147483647 }));
    assert.equal(await recoverActiveBatch(), null);
    assert.equal((await getJob(heldId)).status, 'failed');

    const pendingId = randomUUID();
    const pendingDirectory = join(root, 'jobs', pendingId);
    await mkdir(lock);
    await mkdir(pendingDirectory, { recursive: true });
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ id: pendingId, pid: 2147483647, phase: 'preparing', createdAt: new Date(Date.now() - 30000).toISOString() }));
    await writeFile(join(pendingDirectory, 'job.json'), JSON.stringify({
      id: pendingId, status: 'running', createdAt: new Date(Date.now() - 30000).toISOString(),
      config: validateFixtureInput({ name: 'Worker claiming lock', pagesPerSite: 12 }),
    }));
    await writeFile(join(pendingDirectory, 'worker.json'), JSON.stringify({ pid: process.pid }));
    assert.equal((await recoverActiveBatch()).id, pendingId);
    assert.equal((await getJob(pendingId)).status, 'running');
    await releaseBatch(pendingId);

    const graceId = randomUUID();
    const graceDirectory = join(root, 'jobs', graceId);
    await mkdir(lock);
    await mkdir(graceDirectory, { recursive: true });
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ id: graceId, pid: 2147483647, phase: 'preparing', createdAt: new Date().toISOString() }));
    await writeFile(join(graceDirectory, 'job.json'), JSON.stringify({
      id: graceId, status: 'running', createdAt: new Date(Date.now() - 30000).toISOString(),
      config: validateFixtureInput({ name: 'Worker handoff grace', pagesPerSite: 12 }),
    }));
    assert.equal((await getJob(graceId)).status, 'running');
    await releaseBatch(graceId);

    const oldId = randomUUID();
    const oldDirectory = join(root, 'jobs', oldId);
    await mkdir(oldDirectory, { recursive: true });
    await writeFile(join(oldDirectory, 'job.json'), JSON.stringify({
      id: oldId, status: 'completed', createdAt: new Date(0).toISOString(),
      config: validateFixtureInput({ name: 'Previously saved', pagesPerSite: 12, seed: 0 }),
    }));

    const started = await createJob({ name: 'Fresh', pagesPerSite: 12 }, {
      freshSeed: true,
      resolveSeed(seed) {
        assert.notEqual(seed, 0);
        const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
        assert.equal(owner.pid, process.pid);
        assert.equal(owner.phase, 'preparing');
        return { name: 'Fresh', pagesPerSite: 12, seed };
      },
    });
    assert.notEqual(started.config.seed, 0);
    let completed;
    for (let attempt = 0; attempt < 300; attempt++) {
      completed = await getJob(started.id);
      if (completed.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(completed.status, 'completed', completed.error);
    assert.equal(completed.config.seed, started.config.seed);
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
