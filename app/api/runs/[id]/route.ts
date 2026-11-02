import { readRun } from '@/workbench/runner';
import { isLocalRequest } from '@/workbench/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(request)) return Response.json({ error: 'Local access only' }, { status: 403 });
  const { id } = await context.params;
  const run = await readRun(id);
  if (!run) return Response.json({ error: 'Run not found' }, { status: 404 });
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (new URL(request.url).searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename="test-run-${run.id}.json"`;
  return Response.json(run, { headers });
}
