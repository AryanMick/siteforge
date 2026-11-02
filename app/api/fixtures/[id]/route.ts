import { deleteJob, FixtureDeletionError, getJob } from '@/fixture-lab/store.mjs';
import { apiError, FixtureHttpError, json, localOnly, validJobId } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { localOnly(request); const { id } = await params; validJobId(id); const job = await getJob(id); if (!job) throw new FixtureHttpError(404, 'Fixture job not found'); return json({ job }); }
  catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    localOnly(request, true);
    const { id } = await params;
    validJobId(id);
    return json(await deleteJob(id));
  } catch (error) {
    if (error instanceof FixtureDeletionError) return json({ error: error.message }, error.status);
    if (error instanceof FixtureHttpError) return apiError(error);
    console.error('Fixture deletion:', error);
    return json({ error: 'Deletion could not finish. Some generated files may remain. Please retry.' }, 500);
  }
}
