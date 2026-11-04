// Runs SiteForge's own offline baseline (the bundled crawler, field extractor and clusterer) against generated
// sites and scores it with the evaluator, exactly as a Smartcite result would be scored.
//
//   node scripts/tools/benchmark-baseline.mjs <site-dir> [<site-dir> ...] [--out <dir>] [--cms-url <url>] [--crawler <name>]
//
// Crawlers (all bundled, all offline):
//   pagepilot (default)  the polite HTTP crawler with field extraction and structure clustering (src/crawl/real-crawler.mjs)
//   http                 the simple fields crawler (src/crawl/crawler.mjs), plain HTTP
//   browser              the same crawler in headless Chromium, so React and Angular pages are rendered first
//
// Each site is served by the SiteForge preview server on a free loopback port, unless --cms-url is given (one site
// only): then the crawl starts at that WordPress or Drupal install and URLs are compared by path. The answer key is
// read only after crawling and clustering finish. Output: predictions.json (the Smartcite output format, version 1),
// report.json/csv/html per site, and summary.json/summary.md for the whole run. Nothing leaves this machine.
// The bundled crawler stops at 500 pages, depth 10 and 50 MB, so larger sites are scored on that sample only.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { crawlSite } from '../../src/crawl/real-crawler.mjs';
import { clusterPages } from '../../src/crawl/page-clusters.mjs';
import { evaluate, writeReports } from '../../src/answers/evaluator.mjs';
import { serve } from '../../src/preview/server.mjs';
import { crawl as simpleCrawl } from '../../src/crawl/crawler.mjs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); if (index < 0) return undefined; const value = args[index + 1]; args.splice(index, 2); return value; };
const out = resolve(option('--out') ?? `outputs/baseline-benchmark-${new Date().toISOString().slice(0, 19).replaceAll(':', '')}`);
const cmsUrl = option('--cms-url');
const crawler = option('--crawler') ?? 'pagepilot';
if (!['pagepilot', 'http', 'browser'].includes(crawler)) { console.error('--crawler must be pagepilot, http or browser'); process.exit(2); }
const sites = args.map(item => resolve(item));
if (!sites.length) { console.error('Usage: node scripts/tools/benchmark-baseline.mjs <site-dir> [...] [--out <dir>] [--cms-url <url>]'); process.exit(2); }
if (cmsUrl && sites.length !== 1) { console.error('--cms-url takes exactly one site directory'); process.exit(2); }
if (await access(out).then(() => true, () => false)) { console.error(`${out} already exists; choose a new --out directory`); process.exit(2); }
await mkdir(out, { recursive: true });

const percent = value => value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;
const rows = [];
for (const directory of sites) {
  const config = JSON.parse(await readFile(join(directory, 'private', 'config.json'), 'utf8'));
  const name = basename(directory);
  const target = join(out, cmsUrl ? `${name}-cms` : name);
  await mkdir(target, { recursive: true });
  let server;
  try {
    // rebaseOrigin: links to the generation address point at this preview, as in the app's previews.
    if (!cmsUrl) server = await serve(directory, { port: 0, rebaseOrigin: true });
    const start = cmsUrl ?? server.url;
    const began = Date.now();
    const path = raw => { const url = new URL(raw); return url.pathname + url.search; };
    let pages, crawled, stopReason;
    if (crawler === 'pagepilot') {
      const crawl = await crawlSite(start, { allowLocal: true, delayMs: 0, maxPages: 500, maxDepth: 10, maxTimeMs: 600000, maxDiscovered: 5000, maxTotalBytes: 50000000 });
      await writeFile(join(target, 'crawl-summary.json'), `${JSON.stringify({ summary: crawl.summary, limitations: crawl.limitations, urls: crawl.urls }, null, 2)}\n`);
      pages = clusterPages(crawl.pages, {}).pages;
      crawled = crawl.pages.length; stopReason = crawl.summary.stopReason ?? 'finished';
    } else {
      const result = await simpleCrawl(start, { mode: crawler, maxPages: 500, waitMs: crawler === 'browser' ? 300 : 0 });
      await writeFile(join(target, 'crawl-summary.json'), `${JSON.stringify(result.crawl, null, 2)}\n`);
      pages = result.pages;
      crawled = pages.length; stopReason = result.crawl.truncated ? 'page limit' : result.crawl.failures.length ? `finished, ${result.crawl.failures.length} failed` : 'finished';
    }
    const crawlMs = Date.now() - began;
    // The Smartcite output format: { version: 1, pages: [{ url, cluster, contentType?, fields?, relationships?, repeatedItems? }] }.
    const predictions = { version: 1, tool: `siteforge-offline-baseline/${crawler}`, pages: pages.map(page => ({ ...page, url: path(page.url),
      ...(page.repeatedItems ? { repeatedItems: page.repeatedItems.map(item => item.url && new URL(item.url).origin === new URL(start).origin ? { ...item, url: path(item.url) } : item) } : {}) })) };
    await writeFile(join(target, 'predictions.json'), `${JSON.stringify(predictions, null, 2)}\n`);
    // Only now is the answer key read.
    const truth = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
    const report = evaluate(truth, predictions);
    await writeReports(report, join(target, 'report'));
    rows.push({
      site: name, target: cmsUrl ? `CMS ${new URL(cmsUrl).host}` : 'preview', framework: config.site.framework, noise: config.noise?.level ?? 'n/a',
      cms: config.site.cmsProfile ?? 'none', links: config.site.linkMode ?? 'root-relative', pages: truth.pages.length,
      crawler, crawled, stopReason, crawlSeconds: Math.round(crawlMs / 100) / 10,
      coverage: report.coverage.recall, unexpected: report.coverage.unexpected,
      clusterF1: report.clustering.allExpected.pairs.f1, adjustedRand: report.clustering.allExpected.adjustedRandIndex,
      fieldF1: report.fields.values?.f1 ?? null, relationshipF1: report.relationships.score?.f1 ?? null,
      recordsF1: report.repeatedItems?.items?.f1 ?? null, recordFieldF1: report.repeatedItems?.values?.f1 ?? null,
    });
    console.log(`${name}${cmsUrl ? ' (CMS)' : ''}: coverage ${percent(report.coverage.recall)}, cluster F1 ${percent(rows.at(-1).clusterF1)}, field F1 ${percent(rows.at(-1).fieldF1)}`);
  } catch (error) {
    rows.push({ site: name, target: cmsUrl ? 'CMS' : 'preview', error: error.message });
    console.error(`${name}: ${error.message}`);
  } finally { await server?.close(); }
}
const header = '| Site | Served by | Crawler | Framework | Noise | Markup | Links | Pages | Crawled | Crawl ended | Coverage | Unexpected URLs | Cluster F1 | Field F1 | Listing records F1 | Record field F1 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const lines = rows.map(row => row.error ? `| ${row.site} | ${row.target} | ${crawler} | failed: ${row.error} | | | | | | | | | | | | |`
  : `| ${row.site} | ${row.target} | ${row.crawler} | ${row.framework} | ${row.noise} | ${row.cms} | ${row.links} | ${row.pages} | ${row.crawled} | ${row.stopReason} | ${percent(row.coverage)} | ${row.unexpected} | ${percent(row.clusterF1)} | ${percent(row.fieldF1)} | ${percent(row.recordsF1)} | ${percent(row.recordFieldF1)} |`);
await writeFile(join(out, 'summary.json'), `${JSON.stringify({ tool: `siteforge-offline-baseline/${crawler}`, createdAt: new Date().toISOString(), rows }, null, 2)}\n`);
await writeFile(join(out, 'summary.md'), `# Offline baseline benchmark\n\n${header}\n${lines.join('\n')}\n`);
console.log(`Summary: ${join(out, 'summary.md')}`);
