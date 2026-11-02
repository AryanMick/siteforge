import { loadFeatures } from '@/workbench/catalog';
import { listRuns } from '@/workbench/runner';
import { isLocalRequest } from '@/workbench/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalRequest(request)) return Response.json({ error: 'Local access only' }, { status: 403 });
  try {
    return Response.json({ features: await loadFeatures(), runs: await listRuns() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Unable to load the workbench. Check the local server log.' }, { status: 500 });
  }
}
