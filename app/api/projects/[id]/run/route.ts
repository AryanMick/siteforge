import { startRun } from '@/crawl/pagepilot/store.mjs';
import { apiError, bodyJson, HttpError, json, localOnly, validId } from '@/crawl/pagepilot/http';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    localOnly(request, true); const { id } = await params; validId(id);
    const body = await bodyJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new HttpError(400, 'Run accepts an empty JSON object');
    return json({ run: await startRun(id) }, 202);
  } catch (error) { return apiError(error); }
}
