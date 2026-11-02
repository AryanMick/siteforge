import { Readable } from 'node:stream';
import { answerStream } from '@/fixture-lab/archive.mjs';
import { inspectAnswers } from '@/fixture-lab/answer-inspection.mjs';
import { ownedSite } from '@/fixture-lab/store.mjs';
import { apiError, localOnly, validJobId, validSiteId } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; siteId: string }> }) {
  try {
    localOnly(request); const { id, siteId } = await params; validJobId(id); validSiteId(siteId);
    const owned = await ownedSite(id, siteId);
    const query = new URL(request.url).searchParams;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (query.size) return Response.json(await inspectAnswers(owned.directory, Object.fromEntries(query)), { headers });
    return new Response(Readable.toWeb(await answerStream(owned.directory)) as ReadableStream, { headers });
  } catch (error) { return apiError(error); }
}
