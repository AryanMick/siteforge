import { createJob } from '@/fixture-lab/store.mjs';
import { randomFixtureInput, randomRequestSchema } from '@/fixture-lab/random.mjs';
import { apiError, bodyJson, json, localOnly } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    localOnly(request, true);
    const input = randomRequestSchema.parse(await bodyJson(request));
    const resolveSeed = (seed: number) => randomFixtureInput({ ...input, seed });
    const config = resolveSeed(input.seed ?? 0);
    return json({ job: await createJob(config, { freshSeed: input.seed === undefined, resolveSeed }) }, 202);
  } catch (error) { return apiError(error); }
}
