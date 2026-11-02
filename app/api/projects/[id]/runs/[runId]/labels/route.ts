import { updateLabels } from '@/pagepilot/store.mjs';
import { apiError, bodyJson, json, localOnly, validId } from '@/pagepilot/http';
export const runtime = 'nodejs';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    localOnly(request, true); const { id, runId } = await params; validId(id); validId(runId);
    return json({ run: await updateLabels(id, runId, await bodyJson(request)) });
  } catch (error) { return apiError(error); }
}
