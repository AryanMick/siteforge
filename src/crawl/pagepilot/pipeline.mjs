import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from '../../site/generator.mjs';
import { serve } from '../../preview/server.mjs';
import { crawlSite } from '../real-crawler.mjs';
import { clusterPages } from '../page-clusters.mjs';
import { evaluate, writeReports } from '../../answers/evaluator.mjs';
import { validateProject, evaluationGate } from './config.mjs';
import { buildClusterInsights } from './insights.mjs';

const profiles = { archive: 'maine-archive', library: 'new-york-library', government: 'maryland-manual' };
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

/** @param {(stage: { id: string, status: string, message: string }) => Promise<void>} onStage */
export async function runPipeline(input, directory, onStage = async () => {}, options = {}) {
  const project = validateProject(input);
  await mkdir(directory, { recursive: true });
  const synthetic = project.mode === 'synthetic';
  let server;
  let generated;
  let reference;
  const stage = async (id, status, message) => onStage({ id, status, message });
  try {
    await stage('prepare', 'running', synthetic ? 'Building fictional pages and their private answer key.' : 'Validating the bounded public crawl.');
    let url = project.url;
    if (synthetic && !options.sourceDirectory) {
      const manifest = JSON.parse(await readFile(new URL('../../../examples/reference-sites.json', import.meta.url), 'utf8'));
      reference = manifest.references.find(item => item.id === profiles[project.profile]);
      const config = structuredClone(reference.config);
      config.seed = project.seed;
      config.site.pageCount = project.pageCount;
      config.noise = { level: project.noise };
      generated = await generate(config, join(directory, 'site'));
      server = await serve(join(directory, 'site'), { port: 0 });
      url = server.url;
    }
    await stage('prepare', options.sourceDirectory ? 'skipped' : 'passed', options.sourceDirectory ? 'Reusing the original captured site. No new site is generated.' : synthetic ? `${generated.pageCount} fictional HTML pages; answer key stored outside the public site.` : 'Public HTTP crawl; robots policy and address checks enforced by the crawler.');
    await stage('crawl', 'running', options.sourceDirectory ? 'Loading the saved crawl. No network requests.' : 'Reading HTML and extracting labeled data fields.');
    const crawl = options.sourceDirectory ? JSON.parse(await readFile(join(options.sourceDirectory, 'crawl.json'), 'utf8')) : await crawlSite(url, synthetic
      ? { allowLocal: true, delayMs: 0, maxPages: project.pageCount, maxDepth: 10, maxTimeMs: 90000, maxDiscovered: 1500, maxTotalBytes: 20000000 }
      : { maxPages: project.maxPages, pathPrefix: project.pathPrefix, maxDepth: project.maxDepth, delayMs: 1200, maxTimeMs: project.maxDurationMinutes * 60000, maxDiscovered: 5000, maxTotalBytes: 50000000 },
    undefined, { onProgress: options.onCrawlProgress, shouldStop: options.shouldStop });
    await save(join(directory, 'crawl.json'), crawl);
    await stage('crawl', options.sourceDirectory ? 'skipped' : crawlStageStatus(crawl.summary), `${options.sourceDirectory ? 'Saved snapshot: ' : ''}${crawl.pages.length} pages analyzed; ${crawl.summary.counts.failed} failed; ${crawl.summary.counts.unattempted} unattempted. Robots: ${crawl.robots.status}.`);
    await stage('cluster', 'running', 'Comparing extracted field structures.');
    const relative = raw => synthetic ? new URL(raw).pathname + new URL(raw).search : raw;
    const excluded = new Set(options.excludedUrls ?? []);
    const observedUrls = new Set(crawl.pages.map(page => relative(page.url)));
    if ([...excluded].some(url => !observedUrls.has(url))) throw new Error('Excluded URL was not present in the source crawl');
    const selectedPages = crawl.pages.filter(page => !excluded.has(relative(page.url)));
    if (excluded.size && !selectedPages.length) throw new Error('Keep at least one page in the analysis');
    const clustered = clusterPages(selectedPages, { threshold: project.threshold });
    await save(join(directory, 'clusters.json'), clustered);
    const predictions = { version: 1, pages: clustered.pages.map(page => ({ ...page, url: relative(page.url) })) };
    await save(join(directory, 'predictions.json'), predictions);
    await stage('cluster', crawl.pages.length ? 'passed' : 'skipped', `${clustered.clusters.length} inferred groups. Optional fields may vary within a group.`);
    const metrics = { pages: crawl.pages.length, clusters: clustered.clusters.length,
      fields: crawl.pages.reduce((total, page) => total + Object.keys(page.fields).length, 0), coverage: null, pairwiseF1: null, fieldValueF1: null };
    if (synthetic) {
      await stage('evaluate', 'running', 'Comparing predictions with the construction-time answer key.');
      // Ground truth is loaded only after crawling, extraction and clustering finish.
      const truth = JSON.parse(await readFile(join(options.sourceDirectory ?? directory, 'site/private/ground-truth.json'), 'utf8'));
      const score = evaluate(truth, predictions);
      metrics.coverage = score.coverage.recall;
      metrics.pairwiseF1 = score.clustering.allExpected.pairs.f1;
      metrics.fieldValueF1 = score.fields.values?.f1 ?? null;
      await writeReports(score, join(directory, 'score'));
    }
    const evaluation = evaluationGate(metrics, synthetic);
    await stage('evaluate', synthetic ? (evaluation.status === 'passed' ? 'passed' : 'failed') : 'skipped', evaluation.reason);
    const counts = new Map();
    for (const page of crawl.pages) for (const issue of page.issues ?? []) counts.set(issue.code, (counts.get(issue.code) ?? 0) + issue.count);
    const assignments = new Map(clustered.pages.map(page => [page.url, page.cluster]));
    const warnings = [...clustered.warnings, ...crawl.limitations];
    if (excluded.size) warnings.unshift(`${excluded.size} observed page(s) excluded from grouping. Benchmark coverage still counts them as missing predictions.`);
    if (!crawl.summary.allEligibleAnalyzed) warnings.unshift(`Incomplete crawl: ${crawl.summary.stopReason ?? 'some discovered URLs were not analyzed'}. Results describe only the collected sample.`);
    const result = {
      metrics,
      clusters: clustered.clusters.map(cluster => ({ id: cluster.id, name: cluster.suggestedName, count: cluster.count, fields: cluster.commonFields, urls: cluster.urls.map(relative) })),
      pages: crawl.pages.map(page => ({ url: relative(page.url), title: page.fields?.title ?? page.title ?? relative(page.url), cluster: assignments.get(page.url) ?? 'excluded', excluded: excluded.has(relative(page.url)), fields: page.fields, issues: page.issues ?? [], fetch: { status: page.fetch.status, bytes: page.fetch.bytes, encoding: page.fetch.encoding, sha256: page.fetch.sha256, contentType: page.fetch.contentType, htmlDetected: page.fetch.htmlDetected }, tagCounts: page.features?.tags ?? {}, linkCount: page.links?.length ?? 0, recordCount: page.records?.length ?? 0 })),
      issues: [...counts].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
      outcomes: crawl.urls.map(item => ({ ...item, url: relative(item.url) })), warnings, crawl: crawl.summary, evaluation,
      diagnostics: { robots: Object.fromEntries(['url', 'status', 'httpStatus', 'code', 'reason', 'redirects'].filter(key => crawl.robots[key] !== undefined).map(key => [key, crawl.robots[key]])), requestedUrl: crawl.startUrl, effectiveUrl: crawl.effectiveStartUrl ?? crawl.startUrl },
      provenance: options.sourceProvenance ?? { profile: synthetic ? project.profile : 'public', referenceUrl: reference?.url ?? null, synthetic, seed: synthetic ? project.seed : null, canonicalSha256: generated?.canonicalSha256 ?? null, noiseEvents: generated?.noiseEvents ?? 0, sourceUrl: synthetic ? null : project.url, noise: synthetic ? project.noise : null },
      rules: { threshold: project.threshold, excludedUrls: [...excluded].sort() }, labels: {},
      maxCrawlDepth: Math.max(0, ...crawl.urls.filter(item => item.state === 'analyzed').map(item => item.depth ?? 0)),
      clusterInsights: Object.fromEntries(Object.entries(buildClusterInsights(selectedPages, clustered)).map(([id, insight]) => [id, { ...insight, representativeUrl: relative(insight.representativeUrl) }])),
    };
    await stage('export', 'running', 'Saving the report and raw crawl evidence.');
    await save(join(directory, 'result.json'), result);
    await stage('export', 'passed', 'Report saved.');
    return result;
  } finally { if (server) await server.close(); }
}

export function resultStatus(result) {
  if (!result.metrics.pages) return 'failed';
  return result.evaluation.status === 'failed' || !result.crawl.allEligibleAnalyzed ? 'attention' : 'completed';
}

export function crawlStageStatus(summary) {
  if (!summary.analyzed) return 'failed';
  return summary.allEligibleAnalyzed ? 'passed' : 'attention';
}
