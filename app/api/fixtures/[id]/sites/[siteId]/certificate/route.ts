import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ownedSite } from '@/fixture-lab/store.mjs';
import { apiError, FixtureHttpError, localOnly, validJobId, validSiteId } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string; siteId: string }> }) {
  try {
    localOnly(request);
    const { id, siteId } = await context.params;
    const owned = await ownedSite(validJobId(id), validSiteId(siteId));
    let certificate;
    try { certificate = await readFile(join(/* turbopackIgnore: true */ owned.directory, 'private', 'tls', 'cert.pem'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FixtureHttpError(404, 'Start this HTTPS preview before downloading its test certificate.'); throw error; }
    if (!/^-----BEGIN CERTIFICATE-----\r?\n/.test(certificate) || certificate.includes('PRIVATE KEY')) throw new FixtureHttpError(500, 'Invalid test certificate.');
    return new Response(certificate, { headers: { 'Content-Type': 'application/x-pem-file', 'Content-Disposition': `attachment; filename="${siteId}-test-certificate.pem"`, 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
