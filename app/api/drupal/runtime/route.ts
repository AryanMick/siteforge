import { drupalStatus, startDrupal, stopDrupal } from '@/drupal/runtime.mjs';
import { apiError, bodyJson, FixtureHttpError, json, localOnly } from '@/fixture-lab/http.mjs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: state of the local Drupal ('stopped' | 'starting' | 'running' | 'failed'), its URLs, login and log tail.
export async function GET(request: Request) {
  try { localOnly(request); return json(await drupalStatus()); }
  catch (error) { return apiError(error); }
}

// POST { action: 'start' | 'stop' }. Start returns at once with state 'starting'; poll GET until 'running'.
export async function POST(request: Request) {
  try {
    localOnly(request, true);
    const { action } = z.object({ action: z.enum(['start', 'stop']) }).strict().parse(await bodyJson(request));
    if (action === 'stop') return json(await stopDrupal());
    try { return json(await startDrupal(), 202); }
    catch (error) {
      if (error instanceof Error && /^(Port \d+ is already in use|WordPress Playground \(which also runs Drupal\) is not installed|SITEFORGE_DRUPAL_PORT)/.test(error.message)) throw new FixtureHttpError(409, error.message);
      throw error;
    }
  } catch (error) { return apiError(error); }
}
