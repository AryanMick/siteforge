import { requestRunStop } from '@/pagepilot/store.mjs';
import { apiError, bodyJson, HttpError, json, localOnly, validId } from '@/pagepilot/http';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    localOnly(request, true);
    const { id, runId } = await params;
    validId(id); validId(runId);
    const body = await bodyJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new HttpError(400, 'Stop accepts an empty JSON object');
    return json({ run: await requestRunStop(id, runId) });
  } catch (error) { return apiError(error); }
}
