import { z } from 'zod';
import { startRun } from '@/crawl/pagepilot/store.mjs';
import { apiError, bodyJson, json, localOnly, validId } from '@/crawl/pagepilot/http';
export const runtime = 'nodejs';
const schema = z.object({ sourceRunId: z.string().uuid(), threshold: z.number().min(0).max(1), excludedUrls: z.array(z.string().min(1).max(4096)).max(500) }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    localOnly(request, true); const { id } = await params; validId(id);
    const input = schema.parse(await bodyJson(request));
    return json({ run: await startRun(id, input) }, 202);
  } catch (error) { return apiError(error); }
}
