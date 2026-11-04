import { serverIdentity } from '@/crawl/pagepilot/server-identity.mjs';
import { apiError, json, localOnly } from '@/crawl/pagepilot/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    localOnly(request);
    return json(await serverIdentity());
  } catch (error) { return apiError(error); }
}
