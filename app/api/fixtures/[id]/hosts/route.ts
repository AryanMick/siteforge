import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jobDirectory, getJob } from '@/fixture-lab/store.mjs';
import { apiError, json, localOnly, validJobId } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    localOnly(request);
    const { id } = await params;
    validJobId(id);
    const job = await getJob(id);
    if (!job) return json({ error: 'Fixture job not found' }, 404);
    if (!job.sites.length) return json({ error: 'No generated websites yet' }, 404);
    let body;
    try { body = await readFile(join(jobDirectory(id), 'hosts.txt')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return json({ error: 'No saved hosts file for this test set' }, 404); throw error; }
    return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="siteforge-${id}-hosts.txt"`, 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
