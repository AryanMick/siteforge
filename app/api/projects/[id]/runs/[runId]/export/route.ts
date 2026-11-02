import { getRun } from '@/pagepilot/store.mjs';
import { clientReportHtml, recordsCsv } from '@/pagepilot/export.mjs';
import { apiError, HttpError, localOnly, validId } from '@/pagepilot/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    localOnly(request); const { id, runId } = await params; validId(id); validId(runId);
    const run = await getRun(id, runId);
    if (!run) throw new HttpError(404, 'Run not found');
    if (run.status === 'running') throw new HttpError(409, 'Report is not ready yet');
    const format = new URL(request.url).searchParams.get('format') ?? 'json';
    if (!['json', 'csv', 'html'].includes(format)) throw new HttpError(400, 'Unsupported export format');
    if (format === 'html' && !run.result) throw new HttpError(409, 'Report has no captured result');
    const content = format === 'html' ? clientReportHtml(run) : format === 'csv' ? recordsCsv(run) : JSON.stringify(run, null, 2);
    return new Response(content, { headers: { 'Content-Type': format === 'html' ? 'text/html; charset=utf-8' : format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="pagepilot-${runId}.${format}"`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  } catch (error) { return apiError(error); }
}
