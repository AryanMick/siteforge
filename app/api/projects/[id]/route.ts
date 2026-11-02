import { projectDetail, updateProject } from '@/pagepilot/store.mjs';
import { validateProject } from '@/pagepilot/config.mjs';
import { apiError, bodyJson, HttpError, json, localOnly, validId } from '@/pagepilot/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    localOnly(request); const { id } = await params; validId(id);
    const detail = await projectDetail(id);
    if (!detail) throw new HttpError(404, 'Project not found');
    return json(detail);
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    localOnly(request, true); const { id } = await params; validId(id);
    const input = await bodyJson(request);
    let parsed;
    try { parsed = validateProject(input); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid settings'); }
    return json({ project: await updateProject(id, parsed) });
  } catch (error) { return apiError(error); }
}
