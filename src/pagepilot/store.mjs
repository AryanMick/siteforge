import { mkdir, readFile, writeFile, rename, readdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { initialStages, validateProject, projectInput } from './config.mjs';
import { z } from 'zod';

// Local run data is runtime state, never a deployable dependency or public asset.
export const dataRoot = () => resolve(/* turbopackIgnore: true */ process.env.PAGEPILOT_DATA_DIR || join(process.cwd(), '.pagepilot'));
export function checkId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid ID');
  return id;
}
export const runDirectory = id => join(dataRoot(), 'runs', checkId(id));
const projectPath = id => join(dataRoot(), 'projects', `${checkId(id)}.json`);
const lockPath = () => join(dataRoot(), 'active.json');
const stopRequestPath = id => join(runDirectory(id), 'stop-request.json');
export async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Stored project data could not be read. Existing files have been preserved.', { cause: error }); }
}
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export async function saveRun(run) { await atomicJson(join(runDirectory(run.id), 'run.json'), run); }
async function readStopRequest(id, projectId) {
  const marker = await readJson(stopRequestPath(id));
  return marker?.runId === id && typeof marker.projectId === 'string' && (!projectId || marker.projectId === projectId) ? marker : null;
}
async function presentRun(run) {
  if (!run) return null;
  return { ...run, stopRequested: run.status === 'running' && Boolean(await readStopRequest(run.id, run.projectId)) };
}
export async function stopRequested(id) {
  checkId(id);
  const run = await readJson(join(runDirectory(id), 'run.json'));
  return run?.status === 'running' && Boolean(await readStopRequest(id, run.projectId));
}
export async function releaseLock(id) {
  const lock = await readJson(lockPath());
  if (lock?.id === id) await unlink(lockPath()).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
let recovering;
export async function recoverActiveRun() {
  if (!recovering) recovering = recover().finally(() => { recovering = null; });
  return recovering;
}
async function recover() {
  const lock = await readJson(lockPath());
  if (!lock) return;
  // A short grace period covers the handoff between the API and worker process.
  const age = Date.now() - Date.parse(lock.startedAt);
  const deadline = Date.parse(lock.deadlineAt ?? '');
  const beforeDeadline = Number.isFinite(deadline) ? Date.now() < deadline : age < 300000;
  if (age < 10000 || (beforeDeadline && isAlive(lock.pid))) return;
  const run = await readJson(join(runDirectory(lock.id), 'run.json'));
  if (run?.status === 'running') {
    run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = 'The pipeline worker stopped before completing. You can run this project again.';
    for (const stage of run.stages) if (stage.status === 'running') { stage.status = 'failed'; stage.message = run.error; }
    await saveRun(run);
  }
  await releaseLock(lock.id);
}
async function materialize(project) {
  if (!project) return null;
  const run = project.latestRunId ? await readJson(join(runDirectory(project.latestRunId), 'run.json')) : null;
  const stages = run?.stages ?? [];
  const labeledPages = (run?.result?.clusters ?? []).filter(cluster => run.result.labels?.[cluster.id]).reduce((total, cluster) => total + cluster.count, 0);
  return { ...project, ...projectInput(project), crawlProgress: run?.status === 'running' ? run.crawlProgress : null, status: run?.status ?? 'ready', updatedAt: [run?.finishedAt ?? run?.startedAt ?? '', project.modifiedAt ?? project.createdAt].sort().at(-1), metrics: run?.result?.metrics ?? null,
    progress: { completed: stages.filter(stage => ['passed', 'skipped'].includes(stage.status)).length, total: stages.length || 5, current: stages.find(stage => stage.status === 'running')?.label ?? (run?.result ? 'Clustered' : 'Not started') }, labeledPages };
}

async function withWriteLock(operation) {
  await recoverActiveRun();
  await mkdir(dataRoot(), { recursive: true, mode: 0o700 });
  const id = randomUUID(); let handle;
  try { handle = await open(lockPath(), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another pipeline is running. Wait for it to finish.'); throw error; }
  try {
    await handle.writeFile(JSON.stringify({ id, pid: process.pid, startedAt: new Date().toISOString() })); await handle.close();
    return await operation();
  } finally { await handle.close().catch(() => {}); await releaseLock(id); }
}
export async function updateProject(id, input) {
  checkId(id); const parsed = validateProject(input);
  return withWriteLock(async () => {
    const project = await readJson(projectPath(id));
    if (!project) throw new Error('Project not found');
    const updated = { ...project, ...parsed, modifiedAt: new Date().toISOString() };
    await atomicJson(projectPath(id), updated);
    return materialize(updated);
  });
}
export async function updateLabels(projectId, runId, input) {
  checkId(projectId); checkId(runId);
  const { labels } = z.object({ labels: z.record(z.string().trim().max(80)) }).strict().parse(input);
  return withWriteLock(async () => {
    const run = await getRun(projectId, runId);
    if (!run) throw new Error('Run not found');
    if (run.status === 'running' || !run.result) throw new Error('Run has no completed result');
    const ids = new Set(run.result.clusters.map(cluster => cluster.id));
    if (Object.keys(labels).some(id => !ids.has(id))) throw new Error('Unknown cluster ID');
    run.result.labels = Object.fromEntries(Object.entries(labels).filter(([, label]) => label.length));
    run.labelsUpdatedAt = new Date().toISOString();
    await saveRun(run);
    return run;
  });
}
export async function createProject(input) {
  const parsed = validateProject(input);
  await mkdir(join(dataRoot(), 'projects'), { recursive: true, mode: 0o700 });
  const project = { ...parsed, id: randomUUID(), createdAt: new Date().toISOString(), latestRunId: null };
  await atomicJson(projectPath(project.id), project);
  return materialize(project);
}
export async function listProjects() {
  await recoverActiveRun();
  let files;
  try { files = await readdir(join(dataRoot(), 'projects')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const projects = [];
  for (const file of files.filter(file => file.endsWith('.json'))) {
    checkId(file.slice(0, -5));
    const project = await materialize(await readJson(join(dataRoot(), 'projects', file)));
    if (project) projects.push(project);
  }
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function projectDetail(id) {
  checkId(id); await recoverActiveRun();
  const project = await materialize(await readJson(projectPath(id)));
  if (!project) return null;
  const runs = [];
  const entries = await readdir(join(dataRoot(), 'runs')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const entry of entries) {
    checkId(entry);
    const run = await readJson(join(runDirectory(entry), 'run.json'));
    if (run?.projectId === id) runs.push(await presentRun(run));
  }
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { project, runs: runs.slice(0, 50) };
}
export async function getRun(projectId, runId) {
  checkId(projectId); checkId(runId); await recoverActiveRun();
  const run = await readJson(join(runDirectory(runId), 'run.json'));
  return run?.projectId === projectId ? presentRun(run) : null;
}
export async function requestRunStop(projectId, runId) {
  checkId(projectId); checkId(runId);
  const run = await readJson(join(runDirectory(runId), 'run.json'));
  if (run?.projectId !== projectId) throw new Error('Run not found');
  if (run.status !== 'running') return presentRun(run);
  const existing = await readStopRequest(runId, projectId);
  if (!existing) await atomicJson(stopRequestPath(runId), { runId, projectId, requestedAt: new Date().toISOString() });
  return presentRun(await readJson(join(runDirectory(runId), 'run.json')));
}
export async function startRun(projectId, options = {}) {
  let project = await readJson(projectPath(projectId));
  if (!project) throw new Error('Project not found');
  await recoverActiveRun();
  const plannedInput = projectInput(project);
  await mkdir(join(dataRoot(), 'runs'), { recursive: true, mode: 0o700 });
  const id = randomUUID(); const startedAt = new Date().toISOString();
  const deadlineAt = new Date(Date.parse(startedAt) + (plannedInput.maxDurationMinutes * 60 + 150) * 1000).toISOString();
  let handle;
  try { handle = await open(lockPath(), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another pipeline is running. Wait for it to finish.'); throw error; }
  await handle.writeFile(JSON.stringify({ id, startedAt, deadlineAt, pid: null })); await handle.close();
  const run = { id, projectId, status: 'running', startedAt, finishedAt: null, stages: initialStages(), error: null, result: null,
    stopRequested: false, crawlProgress: { analyzed: 0, discovered: 0, queued: 0, failed: 0, skipped: 0, bytes: 0, elapsedMs: 0, currentUrl: null, maxPages: plannedInput.mode === 'public' ? plannedInput.maxPages : plannedInput.pageCount } };
  try {
    project = await readJson(projectPath(projectId));
    let input = projectInput(project);
    await atomicJson(lockPath(), { id, startedAt, deadlineAt: new Date(Date.parse(startedAt) + (input.maxDurationMinutes * 60 + 150) * 1000).toISOString(), pid: null });
    run.kind = options.sourceRunId ? 'recluster' : 'crawl';
    if (options.sourceRunId) {
      const parsed = z.object({ sourceRunId: z.string().uuid(), threshold: z.number().min(0).max(1), excludedUrls: z.array(z.string().min(1).max(4096)).max(500) }).strict().parse(options);
      const source = await getRun(projectId, parsed.sourceRunId);
      if (!source?.result || source.status === 'running' || !source.result.pages.length) throw new Error('Source run has no completed pages');
      const urls = new Set(source.result.pages.map(page => page.url));
      if (parsed.excludedUrls.some(url => !urls.has(url))) throw new Error('Excluded URL was not present in the source crawl');
      if (new Set(parsed.excludedUrls).size === urls.size) throw new Error('Keep at least one page in the analysis');
      input = projectInput(await readJson(join(runDirectory(source.id), 'input.json')));
      input.threshold = parsed.threshold;
      run.sourceRunId = source.id;
      run.snapshotRunId = source.snapshotRunId ?? source.id;
      run.excludedUrls = [...new Set(parsed.excludedUrls)];
      run.sourceProvenance = source.result.provenance;
    }
    await mkdir(runDirectory(id), { mode: 0o700 });
    await atomicJson(join(runDirectory(id), 'input.json'), input);
    await saveRun(run);
    await atomicJson(projectPath(projectId), { ...project, latestRunId: id });
    const child = spawn(process.execPath, [resolve('scripts/pagepilot-worker.mjs'), id], {
      cwd: process.cwd(), env: { ...process.env, PAGEPILOT_DATA_DIR: dataRoot() }, detached: true, stdio: 'ignore', shell: false,
    });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    // Worker takes ownership itself so a very fast completion cannot race this write.
    child.unref();
    return run;
  } catch (error) {
    run.status = 'failed'; run.error = 'Could not start the pipeline worker.'; run.finishedAt = new Date().toISOString();
    await saveRun(run).catch(() => {}); await releaseLock(id); throw error;
  }
}
export async function claimRun(id) {
  const lock = await readJson(lockPath());
  if (lock?.id !== id) throw new Error('Run no longer owns the pipeline lock');
  await atomicJson(lockPath(), { ...lock, pid: process.pid });
  return readJson(join(runDirectory(id), 'run.json'));
}
export async function ownsLock(id) { return (await readJson(lockPath()))?.id === id; }
