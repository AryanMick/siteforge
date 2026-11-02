import { previewSite } from '@/fixture-lab/store.mjs';
import { apiError, json, localOnly, validJobId, validSiteId } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string; siteId: string }> }) {
  try { localOnly(request, true); const { id, siteId } = await params; validJobId(id); validSiteId(siteId); return json(await previewSite(id, siteId)); }
  catch (error) { return apiError(error); }
}
