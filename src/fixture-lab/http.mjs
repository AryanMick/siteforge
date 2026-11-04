import { isLocalRequest, isRunId } from './security.ts';
import { ZodError } from 'zod';

export class FixtureHttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function localOnly(request, mutate = false) { if (!isLocalRequest(request, mutate)) throw new FixtureHttpError(403, 'This endpoint is restricted to this local app.'); }
export function validJobId(id) { if (!isRunId(id)) throw new FixtureHttpError(400, 'Invalid job ID'); return id; }
export function validSiteId(id) { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new FixtureHttpError(400, 'Invalid site ID'); return id; }
// Request bodies are small settings objects (8 KB) unless a route allows more, such as an uploaded tool result.
export async function bodyJson(request, maxBytes = 8192) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new FixtureHttpError(415, 'Expected application/json');
  const reader = request.body?.getReader(); if (!reader) throw new FixtureHttpError(400, 'Expected a JSON body');
  const chunks = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new FixtureHttpError(413, 'Request body is too large'); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new FixtureHttpError(400, 'Invalid JSON'); }
}
export function json(value, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function apiError(error) {
  if (error instanceof FixtureHttpError) return json({ error: error.message }, error.status);
  if (error instanceof ZodError) return json({ error: error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') }, 400);
  if (['Fixture job not found', 'Fixture site not found'].includes(error?.message)) return json({ error: error.message }, 404);
  if (['Fixture site is not ready', 'Five fixture previews are already running', 'Another fixture batch is already running', 'Another preview or deletion is still running. Please retry.'].includes(error?.message)) return json({ error: error.message }, 409);
  console.error('Fixture Lab:', error);
  return json({ error: 'The fixture operation could not finish. Existing jobs were preserved.' }, 500);
}
