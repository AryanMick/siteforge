import { isLocalRequest, isRunId } from '../../fixture-lab/security';
import { ZodError } from 'zod';

export function localOnly(request: Request, mutate = false) {
  if (!isLocalRequest(request, mutate)) throw new HttpError(403, 'This endpoint is restricted to this local app.');
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function validId(id: string) { if (!isRunId(id)) throw new HttpError(400, 'Invalid ID'); }
export async function bodyJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new HttpError(415, 'Expected application/json');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Expected a JSON body');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new HttpError(413, 'Request body is too large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
}
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function apiError(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : 'Unknown error';
  if (error instanceof ZodError) return json({ error: error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') }, 400);
  if (['Unknown cluster ID', 'Source run has no completed pages', 'Excluded URL was not present in the source crawl', 'Keep at least one page in the analysis', 'Run has no completed result'].includes(message)) return json({ error: message }, 400);
  if (message.startsWith('Another pipeline')) return json({ error: message }, 409);
  if (message === 'Project not found' || message === 'Run not found') return json({ error: message }, 404);
  console.error('PagePilot:', error);
  return json({ error: 'The operation could not finish. Existing results are preserved. Check the server log.' }, 500);
}
