import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { drupalPaths, drupalStatus } from '@/drupal/runtime.mjs';
import { isAlive, jobDirectory, ownedSite } from '@/fixture-lab/store.mjs';
import { apiError, FixtureHttpError, json, localOnly, validJobId, validSiteId } from '@/fixture-lab/http.mjs';
import { replaceFile } from '@/site/replace-file.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pushes a saved site into the local Drupal (`node src/cli.mjs drupal push` in a background process, status in
// <job>/drupal/<site>.json). The local Drupal holds one site at a time, so GET also says whether this site is the one
// in Drupal now. Pages keep their generated addresses, so the site's own answer key scores a crawl of Drupal.
//   POST → 202 with the queued status        GET → { status, current }

type PushStatus = { state: 'none' | 'queued' | 'running' | 'done' | 'failed'; pid?: number; error?: string | null; [key: string]: unknown };
const statusFile = (jobId: string, siteId: string) => join(/* turbopackIgnore: true */ jobDirectory(jobId), 'drupal', `${siteId}.json`);

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}
async function writeStatus(file: string, value: PushStatus) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await replaceFile(temporary, file);
}
async function currentStatus(file: string): Promise<PushStatus> {
  const status = await readJson<PushStatus>(file) ?? { state: 'none' };
  if ((status.state === 'running' || status.state === 'queued') && !isAlive(status.pid as number)) {
    const age = Date.now() - Date.parse(String(status.updatedAt ?? status.queuedAt ?? 0));
    if (status.state === 'running' || age > 15000) {
      const failed: PushStatus = { ...status, state: 'failed', error: 'The Drupal push stopped before it finished. Push again.', finishedAt: new Date().toISOString() };
      await writeStatus(file, failed);
      return failed;
    }
  }
  return status;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; siteId: string }> }) {
  try {
    localOnly(request); const { id, siteId } = await params; validJobId(id); validSiteId(siteId);
    const owned = await ownedSite(id, siteId);
    const status = await currentStatus(statusFile(id, siteId));
    const inDrupal = await readJson<{ siteDir?: string }>(join(drupalPaths().data, 'current.json'));
    return json({ status, current: Boolean(inDrupal?.siteDir) && resolve(inDrupal!.siteDir!) === resolve(owned.directory) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; siteId: string }> }) {
  try {
    localOnly(request, true); const { id, siteId } = await params; validJobId(id); validSiteId(siteId);
    const owned = await ownedSite(id, siteId);
    if ((await drupalStatus()).state !== 'running') throw new FixtureHttpError(409, 'Start Drupal first.');
    const file = statusFile(id, siteId);
    const existing = await currentStatus(file);
    if (existing.state === 'running' || existing.state === 'queued') throw new FixtureHttpError(409, 'This website is already being pushed into Drupal.');
    await mkdir(join(/* turbopackIgnore: true */ jobDirectory(id), 'drupal'), { recursive: true, mode: 0o700 });
    const queued: PushStatus = { state: 'queued', jobId: id, siteId, queuedAt: new Date().toISOString(), progress: null, summary: null, error: null };
    await writeStatus(file, queued);
    const args = [resolve(/* turbopackIgnore: true */ process.cwd(), 'src/cli.mjs'), 'drupal', 'push', owned.directory, '--status', file];
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, detached: true, windowsHide: true, stdio: 'ignore', shell: false });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    child.unref();
    const started = { ...queued, pid: child.pid };
    await writeStatus(file, started);
    return json({ status: started }, 202);
  } catch (error) { return apiError(error); }
}
