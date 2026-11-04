import { Readable } from 'node:stream';
import { answerStream, downloadName, publicZipStream, zipEntriesStream } from '@/fixture-lab/archive.mjs';
import { cmsPackageEntries, MAX_CMS_PAGES } from '@/cms/cms-theme.mjs';
import { ownedSite } from '@/fixture-lab/store.mjs';
import { apiError, FixtureHttpError, localOnly, validJobId, validSiteId } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; siteId: string }> }) {
  try {
    localOnly(request); const { id, siteId } = await params; validJobId(id); validSiteId(siteId);
    const kind = new URL(request.url).searchParams.get('kind'); if (!['public', 'answers', 'wordpress', 'drupal'].includes(kind ?? '')) throw new FixtureHttpError(400, 'kind must be public, answers, wordpress or drupal');
    const owned = await ownedSite(id, siteId);
    if ((kind === 'wordpress' || kind === 'drupal') && owned.site.pageCount > MAX_CMS_PAGES) throw new FixtureHttpError(413, `WordPress and Drupal packages support up to ${MAX_CMS_PAGES.toLocaleString('en-US')} pages; this website has ${owned.site.pageCount.toLocaleString('en-US')}.`);
    // WordPress/Drupal: a theme package that makes a real CMS serve this site (see README "WordPress and Drupal theme packages").
    const body = kind === 'public' ? await publicZipStream(owned.directory)
      : kind === 'wordpress' || kind === 'drupal' ? zipEntriesStream((await cmsPackageEntries(owned.directory, kind)).entries, { date: new Date() })
        : await answerStream(owned.directory);
    const filename = downloadName(owned.job, owned.site, kind);
    return new Response(Readable.toWeb(body) as ReadableStream, { headers: { 'Content-Type': kind === 'answers' ? 'application/json; charset=utf-8' : 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return apiError(error); }
}
