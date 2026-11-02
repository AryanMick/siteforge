import { createJob, listJobsWithDiagnostics } from '@/fixture-lab/store.mjs';
import { apiError, bodyJson, json, localOnly } from '@/fixture-lab/http.mjs';
import { validateFixtureInput } from '@/fixture-lab/config.mjs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    localOnly(request);
    const result = await listJobsWithDiagnostics();
    if (new URL(request.url).searchParams.get('summary') === '1') {
      return json({ ...result, jobs: result.jobs.map(({ sites, ...job }) => job) });
    }
    return json(result);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    localOnly(request, true);
    const body = z.object({ freshSeed: z.boolean().default(false) }).passthrough().parse(await bodyJson(request));
    const { freshSeed, ...settings } = body;
    const input = validateFixtureInput(settings);
    return json({ job: await createJob(input, { freshSeed }) }, 202);
  }
  catch (error) { return apiError(error); }
}
