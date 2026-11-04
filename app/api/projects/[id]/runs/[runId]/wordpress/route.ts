import { z } from 'zod';
import { convertPages } from '@/crawl/pagepilot/conversion.mjs';
import { getRun } from '@/crawl/pagepilot/store.mjs';
import { createWordPressDrafts, WordPressExportError } from '@/crawl/pagepilot/wordpress.mjs';
import { apiError, bodyJson, HttpError, json, localOnly, validId } from '@/crawl/pagepilot/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  siteUrl: z.string().min(1).max(2048),
  username: z.string().min(1).max(200).regex(/^[^:\u0000-\u001f\u007f]+$/, 'Username contains unsupported characters'),
  applicationPassword: z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/, 'Application password contains unsupported characters'),
  pageUrls: z.array(z.string().min(1).max(4096)).min(1).max(10)
    .refine(urls => new Set(urls).size === urls.length, 'Page URLs must be unique'),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    localOnly(request, true);
    const { id, runId } = await params; validId(id); validId(runId);
    const input = inputSchema.parse(await bodyJson(request));
    const run = await getRun(id, runId);
    if (!run) throw new HttpError(404, 'Run not found');
    if (run.status === 'running' || !run.result) throw new HttpError(409, 'Report is not ready yet');
    const records = convertPages(run.result) as Array<{ sourceUrl: string; title: string; slug: string; content: string; status: 'draft'; cluster: string; fields: Record<string, string> }>;
    const byUrl = new Map(records.map(record => [record.sourceUrl, record]));
    if (input.pageUrls.some(url => !byUrl.has(url))) throw new HttpError(400, 'Every selected URL must be an included page captured by this report.');
    const result = await createWordPressDrafts({
      siteUrl: input.siteUrl, username: input.username, applicationPassword: input.applicationPassword,
      pages: input.pageUrls.map(url => byUrl.get(url)!), runId,
    });
    return json(result);
  } catch (error) {
    if (error instanceof WordPressExportError) return json({ error: error.message }, error.status);
    return apiError(error);
  }
}
