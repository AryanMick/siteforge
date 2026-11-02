import { Readable } from 'node:stream';
import { evaluatorDownloadName, evaluatorZipStream, HandoffUnavailableError } from '@/fixture-lab/handoff.mjs';
import { getJob, siteDirectory } from '@/fixture-lab/store.mjs';
import { downloadName, zipEntriesStream } from '@/fixture-lab/archive.mjs';
import { cmsPackageEntries, MAX_CMS_PAGES } from '@/cms-theme.mjs';
import { apiError, FixtureHttpError, localOnly, validJobId } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    localOnly(request);
    const { id } = await params;
    validJobId(id);
    const job = await getJob(id);
    if (!job) throw new FixtureHttpError(404, 'Fixture job not found');
    // ?kind=wordpress|drupal: one ZIP holding every website's CMS package (each inner ZIP installs on its own).
    const kind = new URL(request.url).searchParams.get('kind');
    if (kind !== null) {
      if (!['wordpress', 'drupal'].includes(kind)) throw new FixtureHttpError(400, 'kind must be wordpress or drupal');
      const sites = (job.sites ?? []) as { id: string; name: string; pageCount: number }[];
      if (!sites.length) throw new FixtureHttpError(409, 'No completed websites to package yet.');
      const date = new Date();
      const included = sites.filter(site => site.pageCount <= MAX_CMS_PAGES);
      const skipped = sites.filter(site => site.pageCount > MAX_CMS_PAGES);
      if (!included.length) throw new FixtureHttpError(409, `Every website is over the ${MAX_CMS_PAGES.toLocaleString('en-US')}-page limit for WordPress and Drupal packages.`);
      const entries: { name: string; data?: string; open?: () => Promise<NodeJS.ReadableStream> }[] = included.map(site => ({
        name: downloadName(job, site, kind),
        open: async () => zipEntriesStream((await cmsPackageEntries(siteDirectory(job.id, site.id), kind)).entries, { date }),
      }));
      entries.push({ name: 'README.txt', data: `${kind === 'wordpress' ? 'WordPress themes' : 'Drupal module and theme packages'} for the SiteForge test set "${job.name}".\nEach ZIP installs one fictional website; see the SITEFORGE-README or README.txt inside it. Answer keys are not included.\n${skipped.length ? `\nNot packaged (over ${MAX_CMS_PAGES.toLocaleString('en-US')} pages): ${skipped.map(site => site.name).join(', ')}\n` : ''}` });
      const filename = `${job.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'test-set';
      return new Response(Readable.toWeb(zipEntriesStream(entries, { date })) as ReadableStream, { headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}-${kind}-packages.zip"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    let body;
    try { body = await evaluatorZipStream(job); }
    catch (error) {
      if (error instanceof HandoffUnavailableError || ['ENOENT', 'ELOOP', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new FixtureHttpError(409, 'The evaluator package is incomplete or contains unsafe source files. Existing files were preserved.');
      throw error;
    }
    return new Response(Readable.toWeb(body) as ReadableStream, { headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${evaluatorDownloadName(job)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return apiError(error); }
}
