import { createProject, listProjects } from '@/pagepilot/store.mjs';
import { validateProject } from '@/pagepilot/config.mjs';
import { apiError, bodyJson, HttpError, json, localOnly } from '@/pagepilot/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { localOnly(request); return json({ projects: await listProjects() }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    localOnly(request, true);
    const input = await bodyJson(request);
    let parsed;
    try { parsed = validateProject(input); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid project'); }
    return json({ project: await createProject(parsed) }, 201);
  } catch (error) { return apiError(error); }
}
