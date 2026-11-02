import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluate } from '@/evaluator.mjs';
import { ownedSite } from '@/fixture-lab/store.mjs';
import { apiError, bodyJson, FixtureHttpError, json, localOnly, validJobId, validSiteId } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';
const MAX_RESULT_BYTES = 50 * 1024 * 1024;

// Scores a tool's output for one generated site (2026-11-02). Body: the output itself ({ version: 1, pages: [...] }),
// or { actual: <output>, options: <mapping options> }. The answer key never leaves the server; only the report does.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; siteId: string }> }) {
  try {
    localOnly(request, true); const { id, siteId } = await params; validJobId(id); validSiteId(siteId);
    const owned = await ownedSite(id, siteId);
    const body = await bodyJson(request, MAX_RESULT_BYTES) as { actual?: unknown; options?: unknown; pages?: unknown };
    const actual = body && typeof body === 'object' && 'actual' in body ? body.actual : body;
    const options = body && typeof body === 'object' && 'actual' in body && body.options !== undefined ? body.options : {};
    const truthFile = await readFile(join(/* turbopackIgnore: true */ owned.directory, 'private', 'answer-key.json'), 'utf8')
      .catch(() => readFile(join(/* turbopackIgnore: true */ owned.directory, 'private', 'ground-truth.json'), 'utf8'));
    let report;
    try { report = evaluate(JSON.parse(truthFile), actual, options as Record<string, unknown>); }
    catch (error) { if (error instanceof TypeError) throw new FixtureHttpError(400, `The tool output does not match the format: ${error.message}`); throw error; }
    return json({ report });
  } catch (error) { return apiError(error); }
}
