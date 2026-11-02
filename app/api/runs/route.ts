import { z } from 'zod';
import { executeSuite } from '@/workbench/runner';
import { isLocalRequest } from '@/workbench/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const input = z.object({ kind: z.enum(['bdd', 'mutation']) }).strict();

export async function POST(request: Request) {
  if (!isLocalRequest(request, true)) return Response.json({ error: 'Same-origin local requests only' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = await request.text();
  if (body.length > 1024) return Response.json({ error: 'Request too large' }, { status: 413 });
  let parsed;
  try { parsed = input.safeParse(JSON.parse(body)); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: 'Choose bdd or mutation; custom commands are not allowed.' }, { status: 400 });
  try {
    return Response.json(await executeSuite(parsed.data.kind), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }
}
