import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isRunId } from './security';
import { summarizeBehaviors, summarizeMutations } from './results';
import type { RunKind, TestRun } from './types';

const ROOT = process.cwd();
const STORE = resolve(/* turbopackIgnore: true */ process.env.WORKBENCH_DATA_DIR || join(ROOT, '.workbench'));
const RUNS = join(STORE, 'runs');
const LOCK = join(STORE, 'active.json');
const MAX_LOG = 512_000;
const MAX_RUN_AGE = 300_000;

function processExists(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function saveRun(run: TestRun) {
  const target = join(RUNS, run.id, 'run.json');
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(run, null, 2));
  await rename(temporary, target);
}

export async function readRun(id: string): Promise<TestRun | null> {
  if (!isRunId(id)) return null;
  try {
    const run = JSON.parse(await readFile(join(RUNS, id, 'run.json'), 'utf8')) as TestRun;
    if (run.status === 'running' && (!processExists(run.ownerPid) || Date.now() - Date.parse(run.startedAt) > MAX_RUN_AGE)) {
      return { ...run, status: 'interrupted', error: 'Runner stopped before a completed result was recorded.' };
    }
    return run;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function listRuns(): Promise<TestRun[]> {
  await mkdir(RUNS, { recursive: true });
  const entries = (await readdir(RUNS)).filter(isRunId);
  const runs = (await Promise.all(entries.map(readRun))).filter((run): run is TestRun => run !== null);
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50);
}

async function releaseLock(id: string) {
  try {
    const active = JSON.parse(await readFile(LOCK, 'utf8')) as { id: string };
    if (active.id === id) await unlink(LOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

let recovering: Promise<void> | null = null;
async function recoverLock() {
  if (recovering) return recovering;
  recovering = (async () => {
    let content: string;
    let age: number;
    try {
      content = await readFile(LOCK, 'utf8');
      age = Date.now() - (await stat(LOCK)).mtimeMs;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    let active: { id: string; pid: number };
    try {
      active = JSON.parse(content);
      if (!active || !isRunId(active.id) || !Number.isInteger(active.pid) || active.pid <= 0) throw new Error('Invalid lock');
    } catch {
      if (age < MAX_RUN_AGE) throw new Error('Runner lock is incomplete. Existing data was preserved. Retry after five minutes.');
      // Keep corrupt evidence; only retire it after every supported suite's timeout.
      await rename(LOCK, join(STORE, `recovered-lock-${randomUUID()}.json`));
      return;
    }
    const run = await readRun(active.id);
    // The server PID can remain alive long after its individual test run finishes.
    if (processExists(active.pid) && (run?.status === 'running' || (!run && age < MAX_RUN_AGE))) return;
    if (run?.status === 'interrupted') await saveRun(run);
    await releaseLock(active.id);
  })().finally(() => { recovering = null; });
  return recovering;
}

async function acquireLock(id: string) {
  await mkdir(RUNS, { recursive: true });
  await recoverLock();
  const temporary = join(STORE, `lock-${id}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ id, pid: process.pid }), { flag: 'wx', mode: 0o600 });
    // Atomic publication: contenders never observe a partially written active.json.
    await link(temporary, LOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error('A test run is already active. Wait for it to finish.');
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function executeSuite(kind: RunKind): Promise<TestRun> {
  if (kind !== 'bdd' && kind !== 'mutation') throw new Error('Unsupported test suite');
  const id = randomUUID();
  await acquireLock(id);
  const directory = join(RUNS, id);
  const started = Date.now();
  const run: TestRun = { id, kind, status: 'running', startedAt: new Date(started).toISOString(), ownerPid: process.pid, log: '' };
  try {
    await mkdir(directory);
    await saveRun(run);
    const args = kind === 'bdd'
      ? ['node_modules/@cucumber/cucumber/bin/cucumber.js', '--config', 'cucumber.mjs', '--format', `json:${join(directory, 'cucumber.json')}`]
      : ['node_modules/@stryker-mutator/core/bin/stryker.js', 'run', 'stryker.config.mjs'];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: ROOT, shell: false, detached: process.platform !== 'win32',
        env: { ...process.env, SITEFORGE_RUN_DIR: directory, FORCE_COLOR: '0', NO_COLOR: '1', NEXT_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let failure: string | undefined;
      let hardKill: ReturnType<typeof setTimeout> | undefined;
      const signal = (value: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, value);
          else child.kill(value);
        } catch { /* The child may have already closed. */ }
      };
      const stop = (message: string) => {
        if (failure) return;
        failure = message;
        signal('SIGTERM');
        hardKill = setTimeout(() => signal('SIGKILL'), 2000);
      };
      const timer = setTimeout(() => stop('Test run exceeded its time limit.'), kind === 'bdd' ? 90_000 : 240_000);
      const collect = (data: Buffer) => {
        const remaining = MAX_LOG - Buffer.byteLength(run.log);
        if (remaining > 0) run.log += data.subarray(0, remaining).toString();
        if (data.length > remaining) stop('Test output exceeded its limit.');
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', error => { clearTimeout(timer); if (hardKill) clearTimeout(hardKill); reject(error); });
      child.once('close', code => {
        clearTimeout(timer); if (hardKill) clearTimeout(hardKill);
        run.exitCode = code;
        run.status = !failure && code === 0 ? 'passed' : 'failed';
        if (failure) run.error = failure;
        resolve();
      });
    });
    const reportName = kind === 'bdd' ? 'cucumber.json' : 'mutation.json';
    try {
      const result: unknown = JSON.parse(await readFile(join(directory, reportName), 'utf8'));
      if (kind === 'bdd') {
        run.behavior = summarizeBehaviors(result);
        if (!run.behavior.scenarios || run.behavior.failed || run.behavior.skipped) run.status = 'failed';
      } else {
        run.mutation = summarizeMutations(result);
        if (!run.mutation.total || run.mutation.score === null || run.mutation.runtimeErrors || run.mutation.pending) {
          run.status = 'failed';
          run.error = [run.error, 'Mutation analysis is incomplete or contains execution errors.'].filter(Boolean).join(' ');
        }
      }
    } catch (error) {
      run.status = 'failed';
      run.error = [run.error, `No valid ${kind} report: ${(error as Error).message}`].filter(Boolean).join(' ');
    }
  } catch (error) {
    run.status = 'failed';
    run.error = (error as Error).message;
  } finally {
    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - started;
    try { await saveRun(run); } finally { await releaseLock(id); }
  }
  return run;
}
