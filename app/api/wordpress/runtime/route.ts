import { startWordPress, stopWordPress, wordpressStatus } from '@/wordpress/runtime.mjs';
import { apiError, bodyJson, FixtureHttpError, json, localOnly } from '@/fixture-lab/http.mjs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: state of the local WordPress ('stopped' | 'starting' | 'running' | 'failed'), its URLs, login and log tail.
export async function GET(request: Request) {
  try { localOnly(request); return json(await wordpressStatus()); }
  catch (error) { return apiError(error); }
}

// POST { action: 'start' | 'stop' }. Start returns at once with state 'starting'; poll GET until 'running'.
export async function POST(request: Request) {
  try {
    localOnly(request, true);
    const { action } = z.object({ action: z.enum(['start', 'stop']) }).strict().parse(await bodyJson(request));
    if (action === 'stop') return json(await stopWordPress());
    try { return json(await startWordPress(), 202); }
    catch (error) {
      // Startup problems the user can fix (port taken, npm install missing) are reported as a conflict, not a crash.
      if (error instanceof Error && /^(Port \d+ is already in use|WordPress Playground is not installed|SITEFORGE_WP_PORT)/.test(error.message)) throw new FixtureHttpError(409, error.message);
      throw error;
    }
  } catch (error) { return apiError(error); }
}
