import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { totalPlannedPages } from './config.mjs';
import { validateNewFixtureInput } from './new-request.mjs';
import { createPlanSnapshot, planDescriptor, planPath } from './plans.mjs';
import { unusedSeed } from './seeds.mjs';

export const PREVIEW_LIFETIME_MS = 30 * 60 * 1000;

export const fixtureRoot = () => resolve(/* turbopackIgnore: true */ process.env.FIXTURE_LAB_DATA_DIR || join(/* turbopackIgnore: true */ process.cwd(), '.fixture-lab'));
export const jobDirectory = id => join(fixtureRoot(), 'jobs', validUuid(id));
export const siteDirectory = (jobId, siteId) => join(jobDirectory(jobId), 'sites', validSiteId(siteId));
const jobPath = id => join(jobDirectory(id), 'job.json');
const workerPath = id => join(jobDirectory(id), 'worker.json');
const activeLockDirectory = () => join(fixtureRoot(), 'active.lock');
const activeOwnerPath = () => join(activeLockDirectory(), 'owner.json');
const previewDirectory = () => join(fixtureRoot(), 'previews');
const previewPath = (jobId, siteId) => join(previewDirectory(), `${validUuid(jobId)}--${validSiteId(siteId)}.json`);

export function validUuid(id) { if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid job ID'); return id; }
export function validSiteId(id) { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid site ID'); return id; }
export async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Stored fixture data could not be read. Existing files were preserved.', { cause: error }); } }
async function readPreviewJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}
async function readRecentPreview(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() || Date.now() - info.mtimeMs > PREVIEW_LIFETIME_MS) return null;
    return readPreviewJson(path);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function isAlive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
export async function saveJob(job) { await atomicJson(jobPath(job.id), job); }

export async function releaseBatch(id) {
  const active = await readJson(activeOwnerPath());
  if (active?.id !== id) return;
  await unlink(activeOwnerPath()).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(activeLockDirectory()).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

export async function claimBatch(id) {
  const active = await readJson(activeOwnerPath());
  if (active?.id !== id) throw new Error('Fixture job no longer owns the generation lock');
  await atomicJson(activeOwnerPath(), { ...active, pid: process.pid, phase: 'running' });
}

export async function recoverActiveBatch() {
  let lockInfo;
  try { lockInfo = await stat(activeLockDirectory()); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const active = await readJson(activeOwnerPath());
  if (!active) {
    if (Date.now() - lockInfo.mtimeMs < 10000) return { busy: true };
    try { await rmdir(activeLockDirectory()); return null; }
    catch (error) { if (error.code === 'ENOENT') return null; if (error.code === 'ENOTEMPTY') return { busy: true }; throw error; }
  }
  const age = Date.now() - Date.parse(active.createdAt ?? lockInfo.mtime.toISOString());
  if (active.phase === 'preparing' && age >= 10000) {
    const worker = await readJson(workerPath(active.id));
    if (worker && isAlive(worker.pid)) return active;
    if (worker) {
      const job = await readJson(jobPath(active.id));
      if (job?.status === 'running') await saveJob({ ...job, status: 'failed', finishedAt: new Date().toISOString(), error: 'The fixture worker stopped before generation completed. Completed sites were preserved.' });
      await releaseBatch(active.id);
      return null;
    }
  }
  if (age < 10000 || isAlive(active.pid)) return active;
  const job = await readJson(jobPath(active.id));
  if (job?.status === 'running') await saveJob({ ...job, status: 'failed', finishedAt: new Date().toISOString(), error: 'The fixture worker stopped before generation completed. Completed sites were preserved.' });
  await releaseBatch(active.id);
  return null;
}

async function recoverJob(job, active) {
  if (!job) return null;
  if (job.status !== 'running') return job;
  const worker = await readJson(workerPath(job.id));
  const age = Date.now() - Date.parse(job.createdAt);
  if (!worker && active?.id === job.id && active.phase === 'preparing') return job;
  if (age < 10000 || isAlive(worker?.pid)) return job;
  const recovered = { ...job, status: 'failed', finishedAt: new Date().toISOString(), error: 'The fixture worker stopped before generation completed. Completed sites were preserved.' };
  await saveJob(recovered);
  await releaseBatch(job.id);
  return recovered;
}

export async function getJob(id) { validUuid(id); const active = await recoverActiveBatch(); return recoverJob(await readJson(jobPath(id)), active); }
export async function listJobsWithDiagnostics() {
  await recoverActiveBatch();
  let entries; try { entries = await readdir(join(fixtureRoot(), 'jobs'), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return { jobs: [], issues: [] }; throw error; }
  const jobs = []; const issues = [];
  for (const entry of entries) if (entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name)) {
    try { const job = await getJob(entry.name); if (job) jobs.push(job); }
    catch { issues.push({ id: entry.name, message: 'Saved test set could not be read; its files were preserved.' }); }
  }
  return { jobs: jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), issues };
}
export async function listJobs() { return (await listJobsWithDiagnostics()).jobs; }

// Total size of the regular files under a directory (links are not followed). Used to show what a test set occupies.
export async function directoryBytes(directory) {
  let total = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) total += (await lstat(path)).size;
    }
  }
  return total;
}

/**
 * @param {unknown} input
 * @param {{ freshSeed?: boolean, resolveSeed?: (seed: number) => unknown }} [options]
 */
export async function createJob(input, { freshSeed = false, resolveSeed } = {}) {
  let config = validateNewFixtureInput(input);
  const id = randomUUID(); const createdAt = new Date().toISOString();
  const job = { id, name: config.name, status: 'running', config, createdAt, finishedAt: null, error: null, completedSites: 0, totalPages: totalPlannedPages(config), sites: [] };
  await mkdir(fixtureRoot(), { recursive: true, mode: 0o700 });
  await recoverActiveBatch();
  try { await mkdir(activeLockDirectory(), { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another fixture batch is already running'); throw error; }
  try { await atomicJson(activeOwnerPath(), { id, pid: process.pid, phase: 'preparing', createdAt }); }
  catch (error) { await rmdir(activeLockDirectory()).catch(() => {}); throw error; }
  try {
    if (freshSeed) {
      const previousJobs = await listJobs();
      const seed = unusedSeed(new Set(previousJobs.map(previous => previous.config?.seed).filter(Number.isInteger)));
      config = validateNewFixtureInput(resolveSeed ? resolveSeed(seed) : { ...config, seed });
      Object.assign(job, { name: config.name, config, totalPages: totalPlannedPages(config) });
    }
    await mkdir(jobDirectory(id), { recursive: true, mode: 0o700 });
    const snapshot = createPlanSnapshot(config);
    job.planSnapshot = planDescriptor(snapshot);
    await atomicJson(planPath(jobDirectory(id)), snapshot);
    await saveJob(job);
    const child = spawn(process.execPath, [resolve('scripts/fixture-worker.mjs'), id], { cwd: process.cwd(), env: { ...process.env, FIXTURE_LAB_DATA_DIR: fixtureRoot() }, detached: true, stdio: 'ignore', shell: false });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    await atomicJson(workerPath(id), { pid: child.pid, startedAt: createdAt }); child.unref();
    return job;
  } catch (error) {
    Object.assign(job, { status: 'failed', finishedAt: new Date().toISOString(), error: 'Could not start the fixture worker.' }); await saveJob(job).catch(() => {}); await releaseBatch(id); throw error;
  }
}

export async function ownedSite(jobId, siteId) {
  const job = await getJob(jobId); if (!job) throw new Error('Fixture job not found');
  validSiteId(siteId); const site = job.sites.find(item => item.id === siteId); if (!site) throw new Error('Fixture site not found');
  return { job, site, directory: siteDirectory(jobId, siteId) };
}

async function healthyPreview(record, directory) {
  if (!record || !isAlive(record.pid) || Date.parse(record.expiresAt) <= Date.now()) return false;
  try {
    const url = new URL(record.url);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) return false;
    if (url.protocol === 'http:') {
      const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(800) });
      return response.ok;
    }
    const ca = await readFile(join(directory, 'private', 'tls', 'cert.pem'));
    return await new Promise(accept => {
      const request = httpsRequest(url, { method: 'HEAD', ca, timeout: 800 }, response => { response.resume(); accept(response.statusCode >= 200 && response.statusCode < 300); });
      request.once('error', () => accept(false));
      request.once('timeout', () => request.destroy());
      request.end();
    });
  } catch { return false; }
}

let previewQueue = Promise.resolve();
async function serializedPreview(operation) {
  const previous = previewQueue; let release;
  previewQueue = new Promise(resolvePromise => { release = resolvePromise; });
  await previous;
  const lock = join(fixtureRoot(), 'preview-operation.lock');
  const ownerPath = join(lock, 'owner.json');
  const token = randomUUID(); let acquired = false;
  try {
    await mkdir(fixtureRoot(), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 12000;
    while (!acquired) {
      try { await mkdir(lock, { mode: 0o700 }); acquired = true; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const info = await lstat(lock).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!info) continue;
        if (!info.isDirectory()) throw new Error('Invalid preview operation lock');
        const owner = await readJson(ownerPath);
        if (owner ? !isAlive(owner.pid) : Date.now() - info.mtimeMs > 10000) {
          const recovery = join(lock, 'recovery');
          let recovering = false;
          try {
            await mkdir(recovery, { mode: 0o700 }); recovering = true;
            const current = await readJson(ownerPath);
            if (current ? !isAlive(current.pid) : !owner) {
              const stale = `${lock}.stale-${randomUUID()}`;
              await rename(lock, stale); recovering = false;
              await rm(stale, { recursive: true });
            }
          } catch (error) { if (!['EEXIST', 'ENOENT'].includes(error.code)) throw error; }
          finally { if (recovering) await rmdir(recovery).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
          continue;
        }
        if (Date.now() >= deadline) throw new FixtureDeletionError(409, 'Another preview or deletion is still running. Please retry.');
        await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
      }
    }
    await atomicJson(ownerPath, { token, pid: process.pid });
    return await operation();
  } finally {
    try {
      if (acquired) {
        const owner = await readJson(ownerPath);
        if (!owner || owner.token === token) {
          await unlink(ownerPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
          await rmdir(lock).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      }
    } finally { release(); }
  }
}

export async function previewSite(jobId, siteId) {
  return serializedPreview(async () => {
    const owned = await ownedSite(jobId, siteId);
    await mkdir(previewDirectory(), { recursive: true, mode: 0o700 });
    const path = previewPath(jobId, siteId); const existing = await readRecentPreview(path);
    if (await healthyPreview(existing, owned.directory)) return { url: existing.url };
    let files = []; try { files = await readdir(previewDirectory()); } catch {}
    let active = 0;
    for (const file of files) {
      const match = /^([0-9a-f-]{36})--([a-z][a-z0-9-]{0,63})\.json$/.exec(file);
      if (match && await healthyPreview(await readRecentPreview(join(previewDirectory(), file)), siteDirectory(match[1], match[2]))) active++;
    }
    if (active >= 5) throw new Error('Five fixture previews are already running');
    const child = spawn(process.execPath, [resolve('scripts/fixture-preview.mjs'), owned.directory, path], { cwd: process.cwd(), env: { ...process.env, FIXTURE_LAB_DATA_DIR: fixtureRoot() }, detached: true, stdio: 'ignore', shell: false });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); }); child.unref();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const record = await readPreviewJson(path); if (record?.pid === child.pid && await healthyPreview(record, owned.directory)) return { url: record.url }; await new Promise(resolvePromise => setTimeout(resolvePromise, 50)); }
    child.kill('SIGTERM');
    throw new Error('Fixture preview did not start');
  });
}

export async function previewRecord(jobId, siteId) { return readPreviewJson(previewPath(jobId, siteId)); }

export class FixtureDeletionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function deleteJob(id) {
  validUuid(id);
  return serializedPreview(async () => {
    await recoverActiveBatch();
    try { await mkdir(activeLockDirectory(), { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new FixtureDeletionError(409, 'A test set is still generating or being deleted. Try again when it finishes.');
      if (error.code === 'ENOENT') throw new FixtureDeletionError(404, 'Fixture job not found');
      throw error;
    }
    const operationId = randomUUID();
    try {
      await atomicJson(activeOwnerPath(), { id: operationId, pid: process.pid, phase: 'deleting', createdAt: new Date().toISOString() });
      const directory = jobDirectory(id);
      for (const path of [join(fixtureRoot(), 'jobs'), directory]) {
        let info;
        try { info = await lstat(path); }
        catch (error) { if (error.code === 'ENOENT') throw new FixtureDeletionError(404, 'Fixture job not found'); throw error; }
        if (!info.isDirectory() || info.isSymbolicLink()) throw new FixtureDeletionError(409, 'Linked folders cannot be deleted from the app.');
      }
      const job = await readJson(jobPath(id));
      if (!job || job.id !== id) throw new FixtureDeletionError(409, 'The saved test set could not be verified. No files were deleted.');
      const worker = await readJson(workerPath(id));
      if (job.status === 'running' && isAlive(worker?.pid)) throw new FixtureDeletionError(409, 'This test set is still generating.');
      let records = [];
      try { records = (await readdir(previewDirectory())).filter(name => name.startsWith(`${id}--`) && name.endsWith('.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      // Deleting a test set stops its own previews first. A process is stopped only when its fresh preview record still
      // answers at the recorded local address, so an unrelated process that reused an old PID is never signalled.
      for (const name of records) {
        const path = join(previewDirectory(), name);
        const record = await readPreviewJson(path);
        if (!isAlive(record?.pid)) continue;
        const match = /^(.+)--(.+)\.json$/.exec(name);
        const fresh = await readRecentPreview(path);
        if (record.pid !== process.pid && fresh?.pid === record.pid && match && await healthyPreview(fresh, siteDirectory(match[1], match[2]))) {
          try { process.kill(record.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
          const deadline = Date.now() + 5000;
          while (isAlive(record.pid) && Date.now() < deadline) await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
        }
        if (isAlive(record.pid)) throw new FixtureDeletionError(409, 'A preview is still running for this test set and could not be stopped. Try again in a moment.');
      }
      // Only the verified job tree is removed; links inside it are unlinked, never followed.
      for (const name of records) await unlink(join(previewDirectory(), name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rm(directory, { recursive: true });
      return { deleted: true, id };
    } finally {
      const owner = await readJson(activeOwnerPath());
      if (owner?.id === operationId) await releaseBatch(operationId);
      else if (!owner) await rmdir(activeLockDirectory()).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  });
}
