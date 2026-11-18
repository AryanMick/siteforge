import { replaceFile } from '@/site/replace-file.mjs';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { isAlive, jobDirectory, ownedSite } from '@/fixture-lab/store.mjs';
import { apiError, bodyJson, FixtureHttpError, json, localOnly, validJobId, validSiteId } from '@/fixture-lab/http.mjs';
import { readConnection } from '@/wordpress/client.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pushes a saved site into the local WordPress (connection in .wordpress/connection.json) with the SiteForge Importer
// plugin: native content types, the WordPress theme and plugins decide the design. The push runs in a background
// process (`node src/cli.mjs wordpress push`) that keeps its status in <job>/wordpress/<site>.json.
//   POST {builder?: 'blocks'|'elementor', frontPage?: boolean} → 202 with the queued status
//   GET                → latest push status: state queued/running/done/failed, progress, summary, error
//   GET ?kind=answers  → the WordPress answer key (real WordPress URLs) written by the last push

type PushStatus = { state: 'none' | 'queued' | 'running' | 'done' | 'failed'; pid?: number; error?: string | null; finishedAt?: string; [key: string]: unknown };

const statusFile = (jobId: string, siteId: string) => join(/* turbopackIgnore: true */ jobDirectory(jobId), 'wordpress', `${siteId}.json`);

async function readStatus(file: string): Promise<PushStatus> {
  try { return JSON.parse(await readFile(file, 'utf8')) as PushStatus; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return { state: 'none' };
    throw error;
  }
}

async function writeStatus(file: string, value: PushStatus) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await replaceFile(temporary, file);
}

// A push whose process is gone without finishing is reported as failed (a queued one gets a few seconds to start).
async function currentStatus(file: string): Promise<PushStatus> {
  const status = await readStatus(file);
  if ((status.state === 'running' || status.state === 'queued') && !isAlive(status.pid as number)) {
    const age = Date.now() - Date.parse(String(status.updatedAt ?? status.queuedAt ?? 0));
    if (status.state === 'running' || age > 15000) {
      const failed: PushStatus = { ...status, state: 'failed', error: 'The WordPress push stopped before it finished. Push again to continue; finished items are kept.', finishedAt: new Date().toISOString() };
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
    if (new URL(request.url).searchParams.get('kind') === 'answers') {
      const file = join(/* turbopackIgnore: true */ owned.directory, 'private', 'wordpress-answer-key.json');
      if (!(await stat(file).catch(() => null))?.isFile()) throw new FixtureHttpError(404, 'Push this website into WordPress first; its WordPress answer key is written when the push finishes.');
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${siteId}-wordpress-answer-key.json"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    return json({ status: await currentStatus(statusFile(id, siteId)) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; siteId: string }> }) {
  try {
    localOnly(request, true); const { id, siteId } = await params; validJobId(id); validSiteId(siteId);
    const body = z.object({ builder: z.enum(['blocks', 'elementor']).default('blocks'), frontPage: z.boolean().default(false) }).strict().parse(await bodyJson(request));
    const owned = await ownedSite(id, siteId);
    try { await readConnection(process.cwd()); }
    catch (error) { throw new FixtureHttpError(409, (error as Error).message); }
    const file = statusFile(id, siteId);
    const existing = await currentStatus(file);
    if (existing.state === 'running' || existing.state === 'queued') throw new FixtureHttpError(409, 'This website is already being pushed into WordPress.');
    await mkdir(join(/* turbopackIgnore: true */ jobDirectory(id), 'wordpress'), { recursive: true, mode: 0o700 });
    const queued: PushStatus = { state: 'queued', jobId: id, siteId, builder: body.builder, frontPage: body.frontPage, queuedAt: new Date().toISOString(), progress: null, summary: null, error: null };
    await writeStatus(file, queued);
    const args = [resolve(/* turbopackIgnore: true */ process.cwd(), 'src/cli.mjs'), 'wordpress', 'push', owned.directory, '--builder', body.builder, '--status', file, '--site-key', wordpressSiteKey(id, siteId), ...(body.frontPage ? ['--front-page'] : [])];
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, detached: true, windowsHide: true, stdio: 'ignore', shell: false });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    child.unref();
    const started = { ...queued, pid: child.pid };
    await writeStatus(file, started);
    return json({ status: started }, 202);
  } catch (error) { return apiError(error); }
}

// Every test set has a site-001-..., so the WordPress key includes the set: pushing a second set never overwrites the
// first one's posts, while pushing the same site again still updates its own posts.
function wordpressSiteKey(jobId: string, siteId: string) {
  return `set-${jobId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}-${siteId}`.slice(0, 64).replace(/-+$/, '');
}
