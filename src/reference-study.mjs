import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { validateConfig } from './config.mjs';
import { generate } from './generator.mjs';
import { crawlSite, scopeReason } from './real-crawler.mjs';
import { clusterPages } from './page-clusters.mjs';
import { analyzeLocal } from './site-study.mjs';
import { escapeHtml, hash, json } from './util.mjs';

const COSMETIC_TYPES = [
  'extra-wrapper',
  'class-churn',
  'inline-style',
  'reorder-fields',
  'duplicate-id',
  'missing-metadata',
];
const LEVELS = ['clean', 'cosmetic', 'high'];
const PRIVATE_PATH = /(^|\/)(?:login|logout|signin|signout|admin|account|accounts|private|checkout|cart|delete|remove)(?:\/|$)/i;

const referenceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  url: z.string().url(),
  pathPrefix: z.string().startsWith('/').max(1024),
  inspiration: z.array(z.string().min(1).max(500)).max(30),
  config: z.unknown(),
}).strict();

const manifestSchema = z.object({
  version: z.literal(1),
  references: z.array(referenceSchema).min(1).max(5),
}).strict().superRefine((manifest, context) => {
  const seen = new Set();
  for (const [index, reference] of manifest.references.entries()) {
    if (seen.has(reference.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['references', index, 'id'], message: 'Duplicate reference id' });
    }
    seen.add(reference.id);
  }
});

function publicHttpsUrl(raw, pathPrefix) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('must use https');
  if (url.username || url.password) throw new Error('must not contain credentials');
  if (url.hash) throw new Error('must not contain a fragment');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
    throw new Error('must identify an external host');
  }
  if (ipaddr.isValid(url.hostname.replace(/^\[|\]$/gu, ''))) {
    if (ipaddr.process(url.hostname.replace(/^\[|\]$/gu, '')).range() !== 'unicast') throw new Error('must identify a public host');
  } else if (!url.hostname.includes('.')) {
    throw new Error('must identify an external host');
  }
  let decodedPath;
  let decodedPrefix;
  try {
    decodedPath = decodeURIComponent(url.pathname);
    decodedPrefix = decodeURIComponent(pathPrefix);
  } catch { throw new Error('contains invalid path encoding'); }
  if (/[?#\\\0]/u.test(decodedPrefix) || decodedPrefix.split('/').some((part) => part.startsWith('.'))) {
    throw new Error('pathPrefix must be a safe URL path');
  }
  if (PRIVATE_PATH.test(decodedPath) || PRIVATE_PATH.test(decodedPrefix)) throw new Error('must not target an authentication or private path');
  const normalizedPrefix = decodedPrefix.replace(/\/$/u, '');
  if (normalizedPrefix && decodedPath !== normalizedPrefix && !decodedPath.startsWith(`${normalizedPrefix}/`)) {
    throw new Error('path must be within pathPrefix');
  }
  const rejected = scopeReason(url, url, { pathPrefix });
  if (rejected) throw new Error(`source scope rejected: ${rejected}`);
  return url.href;
}

function validateManifest(input) {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid reference manifest:\n${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')}`);
  }
  const references = parsed.data.references.map((reference, index) => {
    let url;
    try { url = publicHttpsUrl(reference.url, reference.pathPrefix); }
    catch (error) { throw new Error(`Invalid reference manifest:\nreferences.${index}.url: ${error.message}`); }
    let config;
    try { config = validateConfig(reference.config); }
    catch (error) { throw new Error(`Invalid reference manifest:\nreferences.${index}.config: ${error.message}`); }
    if (config.site.framework !== 'html' || config.site.rendering !== 'static') {
      throw new Error(`Invalid reference manifest:\nreferences.${index}.config: reference studies require html/static generation`);
    }
    if (config.site.pageCount > 100) {
      throw new Error(`Invalid reference manifest:\nreferences.${index}.config.site.pageCount: must be at most 100`);
    }
    return { ...reference, url, config };
  });
  return { version: 1, references };
}

function validateRunOptions({ live, seeds, levels, maxPages, delayMs, threshold }) {
  if (typeof live !== 'boolean') throw new Error('live must be a boolean');
  if (!Array.isArray(seeds) || !seeds.length || seeds.length > 5 || seeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    throw new Error('seeds must contain 1..5 unsigned 32-bit integers');
  }
  if (new Set(seeds).size !== seeds.length) throw new Error('seeds must not contain duplicates');
  if (!Array.isArray(levels) || !levels.length || levels.some((level) => !LEVELS.includes(level))) {
    throw new Error(`levels must be a non-empty array containing only ${LEVELS.join(', ')}`);
  }
  if (new Set(levels).size !== levels.length) throw new Error('levels must not contain duplicates');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 8) throw new Error('maxPages must be an integer from 1 to 8');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 30000 || live && delayMs < 500) {
    throw new Error(`delayMs must be an integer from ${live ? 500 : 0} to 30000${live ? ' for live studies' : ''}`);
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('threshold must be in [0,1]');
}

async function createFreshOutput(path) {
  try { await stat(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(dirname(path), { recursive: true });
    await mkdir(path);
    return;
  }
  throw new Error(`Output already exists: ${path}. Choose a fresh directory.`);
}

function effectiveConfig(base, seed, level) {
  const config = structuredClone(base);
  config.seed = seed;
  if (level === 'cosmetic') {
    config.noise = {
      level: 'custom',
      probability: 1,
      severity: 3,
      maxPerPage: 6,
      types: [...COSMETIC_TYPES],
      overrides: {},
    };
  } else config.noise = { level };
  return validateConfig(config);
}

function unsampledProvenance(reference) {
  return {
    version: 1,
    referenceId: reference.id,
    manifestDeclaration: {
      url: reference.url,
      pathPrefix: reference.pathPrefix,
      inspiration: reference.inspiration,
    },
    sampling: { mode: 'offline', status: 'not-sampled' },
    observationProvenance: null,
    note: 'Manifest-supplied inspiration only. The source was not sampled, so no source observations or observation provenance are claimed.',
  };
}

function sourceIssues(crawl) {
  const counts = {};
  for (const page of crawl.pages) for (const issue of page.issues ?? []) counts[issue.code] = (counts[issue.code] ?? 0) + issue.count;
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, count]) => ({ code, count }));
}

async function observeReference(reference, directory, { maxPages, delayMs, threshold }) {
  let crawl;
  try {
    crawl = await crawlSite(reference.url, {
      maxPages,
      maxDepth: 2,
      maxTimeMs: 90000,
      delayMs,
      pathPrefix: reference.pathPrefix,
    });
    await writeFile(join(directory, 'crawl.json'), json(crawl));
    if (!crawl.pages.length) {
      const reason = `No analyzable source pages (${crawl.summary.stopReason ?? 'empty bounded sample'})`;
      const provenance = {
        version: 1,
        referenceId: reference.id,
        manifestDeclaration: { url: reference.url, pathPrefix: reference.pathPrefix, inspiration: reference.inspiration },
        sampling: { mode: 'live', status: 'blocked', reason },
        observationProvenance: { crawlSha256: hash(crawl) },
        note: 'The bounded crawl returned no analyzable pages. No prediction or accuracy claim is made.',
      };
      await writeFile(join(directory, 'provenance.json'), json(provenance));
      return {
        status: 'blocked',
        reason,
        crawl: crawl.summary,
        hashes: provenance.observationProvenance,
        provenancePath: `references/${reference.id}/provenance.json`,
      };
    }
    const clusters = clusterPages(crawl.pages, { threshold });
    const status = crawl.summary.counts.failed || crawl.summary.stopReason ? 'sampled-with-errors' : 'sampled';
    const observations = {
      version: 1,
      referenceId: reference.id,
      sampledPages: crawl.pages.length,
      clusterCount: clusters.clusters.length,
      issues: sourceIssues(crawl),
      crawlSha256: hash(crawl),
      clustersSha256: hash(clusters),
      warning: 'These are bounded live observations and predicted clusters, not known answers and not an accuracy measurement.',
    };
    await writeFile(join(directory, 'clusters.json'), json(clusters));
    await writeFile(join(directory, 'observations.json'), json(observations));
    const provenance = {
      version: 1,
      referenceId: reference.id,
      manifestDeclaration: { url: reference.url, pathPrefix: reference.pathPrefix, inspiration: reference.inspiration },
      sampling: { mode: 'live', status, robots: crawl.robots.status, sampledPages: crawl.pages.length },
      observationProvenance: {
        sourceUrls: crawl.pages.map((page) => page.url),
        sourceHashes: crawl.pages.map((page) => ({ url: page.url, sha256: page.fetch.sha256 })),
        crawlSha256: observations.crawlSha256,
        clustersSha256: observations.clustersSha256,
        observationsSha256: hash(observations),
      },
      note: 'Only bounded HTTP observations and hashes are retained. Predicted clusters are not ground truth, and source HTML is not copied.',
    };
    await writeFile(join(directory, 'provenance.json'), json(provenance));
    return {
      status,
      sampledPages: crawl.pages.length,
      clusterCount: clusters.clusters.length,
      robots: crawl.robots.status,
      crawl: crawl.summary,
      hashes: provenance.observationProvenance,
      provenancePath: `references/${reference.id}/provenance.json`,
    };
  } catch (error) {
    const provenance = {
      version: 1,
      referenceId: reference.id,
      manifestDeclaration: { url: reference.url, pathPrefix: reference.pathPrefix, inspiration: reference.inspiration },
      sampling: { mode: 'live', status: 'failed-source', error: error.message },
      observationProvenance: crawl ? { crawlSha256: hash(crawl) } : null,
      note: 'Live source sampling failed. No accuracy claim is made, and synthetic evaluation continues independently.',
    };
    await writeFile(join(directory, 'provenance.json'), json(provenance));
    return {
      status: 'failed-source',
      error: error.message,
      provenancePath: `references/${reference.id}/provenance.json`,
    };
  }
}

function metricGate(referenceId, seed, level, metrics) {
  const failures = [];
  const prefix = `${referenceId}/${seed}/${level}`;
  if (metrics?.coverage !== 1) failures.push(`${prefix}: coverage must equal 1 (received ${metrics?.coverage ?? 'unavailable'})`);
  if (level === 'clean' || level === 'cosmetic') {
    if (!(metrics?.pairwiseF1 >= 0.95)) failures.push(`${prefix}: pairwise F1 must be at least 0.95 (received ${metrics?.pairwiseF1 ?? 'unavailable'})`);
    if (!(metrics?.fieldValueF1 >= 0.95)) failures.push(`${prefix}: field-value F1 must be at least 0.95 (received ${metrics?.fieldValueF1 ?? 'unavailable'})`);
  }
  return failures;
}

const displayMetric = (value) => value === null || value === undefined ? 'Unavailable' : Number(value).toFixed(4);

export function renderReferenceReport(study) {
  const rows = [];
  for (const reference of study.references) for (const seed of reference.seeds) for (const variant of seed.variants) {
    const reportLink = `${variant.directory}/private/score/report.html`;
    rows.push(`<tr><td>${escapeHtml(reference.id)}</td><td>${seed.seed}</td><td>${escapeHtml(variant.level)}</td><td>${displayMetric(variant.metrics?.coverage)}</td><td>${displayMetric(variant.metrics?.pairwiseF1)}</td><td>${displayMetric(variant.metrics?.fieldValueF1)}</td><td>${variant.gate.passed ? (variant.level === 'high' ? 'coverage passed (stress)' : 'passed') : 'failed'}</td><td><a href="${escapeHtml(reportLink)}">private score report</a></td></tr>`);
  }
  const sources = study.references.map((reference) => `<li><strong>${escapeHtml(reference.id)}</strong>: ${escapeHtml(reference.source.status)}; ${escapeHtml(reference.url)}. Inspiration: ${escapeHtml(reference.inspiration.join('; '))}. <a href="${escapeHtml(reference.source.provenancePath)}">source provenance</a></li>`).join('');
  const failures = study.gates.failures.length ? `<ul>${study.gates.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('')}</ul>` : '<p>All selected gates passed.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Multi-reference study</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#20242a;margin:0}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:28px}h2{font-size:20px;margin-top:30px}.notice{border-left:4px solid #a8453c;padding-left:12px}.table{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:9px;border-bottom:1px solid #d7dbe0;vertical-align:top}th{background:#f2f4f5}a{color:#087267;overflow-wrap:anywhere}</style></head><body><main><h1>Multi-reference study</h1><p>Status: <strong>${escapeHtml(study.status)}</strong>. Mode: ${escapeHtml(study.mode)}.</p><p class="notice">${escapeHtml(study.warning)}</p><h2>Reference sources</h2><ul>${sources}</ul><h2>Synthetic known-answer results</h2><p>${escapeHtml(study.gatePolicy.note)} Clean/cosmetic gates require full coverage and cluster/value F1 of at least 0.95. High noise requires coverage only; its accuracy remains diagnostic. Live source availability separately affects the overall run status.</p><div class="table"><table><thead><tr><th>Reference</th><th>Seed</th><th>Level</th><th>Coverage</th><th>Pairwise F1</th><th>Field-value F1</th><th>Gate</th><th>Report</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><h2>Gate failures</h2>${failures}<p><a href="study.json">Summary JSON</a></p></main></body></html>`;
}

export async function runReferenceStudy(manifest, out, {
  live = false,
  seeds = [48291, 91703],
  levels = ['clean', 'cosmetic', 'high'],
  maxPages = 5,
  delayMs = 1200,
  threshold = 0.32,
} = {}) {
  const validated = validateManifest(manifest);
  validateRunOptions({ live, seeds, levels, maxPages, delayMs, threshold });
  if (typeof out !== 'string' || !out.trim()) throw new Error('out must be a non-empty path');
  const output = resolve(out);
  await createFreshOutput(output);
  const started = Date.now();
  const references = validated.references.map((reference) => ({
    id: reference.id,
    url: reference.url,
    pathPrefix: reference.pathPrefix,
    inspiration: reference.inspiration,
    source: null,
    seeds: seeds.map((seed) => ({ seed, variants: [] })),
  }));

  try {
    // Generate every answer key before any source crawl. Later inference cannot influence private truth.
    for (const [referenceIndex, reference] of validated.references.entries()) {
      const referenceDirectory = join(output, 'references', reference.id);
      await mkdir(referenceDirectory, { recursive: true });
      for (const seedResult of references[referenceIndex].seeds) {
        for (const level of levels) {
          const config = effectiveConfig(reference.config, seedResult.seed, level);
          const relativeDirectory = `synthetic/${reference.id}/${seedResult.seed}/${level}`;
          const directory = join(output, relativeDirectory);
          const generated = await generate(config, directory);
          const provenance = {
            version: 1,
            referenceId: reference.id,
            seed: seedResult.seed,
            level,
            designBasis: 'manifest-authored synthetic configuration',
            sourceSamplingAtGeneration: 'not-consulted',
            note: 'The synthetic answer key was generated before optional live reference inference.',
          };
          await writeFile(join(directory, 'effective-config.json'), json(config));
          await writeFile(join(directory, 'provenance.json'), json(provenance));
          seedResult.variants.push({
            level,
            directory: relativeDirectory,
            canonicalSha256: generated.canonicalSha256,
            noiseEvents: generated.noiseEvents,
            metrics: null,
            gate: { passed: false, failures: [] },
          });
        }
      }
    }

    // Optional live work is sequential and bounded; an individual source failure does not stop synthetic scoring.
    for (const [referenceIndex, reference] of validated.references.entries()) {
      const directory = join(output, 'references', reference.id);
      if (live) references[referenceIndex].source = await observeReference(reference, directory, { maxPages, delayMs, threshold });
      else {
        const provenance = unsampledProvenance(reference);
        await writeFile(join(directory, 'provenance.json'), json(provenance));
        references[referenceIndex].source = {
          status: 'not-sampled',
          provenancePath: `references/${reference.id}/provenance.json`,
        };
      }
    }

    const failures = [];
    for (const reference of references) {
      if (reference.source.status === 'sampled-with-errors') failures.push(`${reference.id}: partial source sample; inspect references/${reference.id}/crawl.json`);
      if (reference.source.status === 'failed-source') failures.push(`${reference.id}: live source failed: ${reference.source.error}`);
      if (reference.source.status === 'blocked') failures.push(`${reference.id}: live source blocked: ${reference.source.reason}`);
      for (const seedResult of reference.seeds) {
        const hashes = new Set(seedResult.variants.map((variant) => variant.canonicalSha256));
        seedResult.identicalCanonicalData = hashes.size === 1;
        seedResult.canonicalSha256 = hashes.size === 1 ? [...hashes][0] : null;
        if (!seedResult.identicalCanonicalData) failures.push(`${reference.id}/${seedResult.seed}: canonical data changed across levels`);
        for (const variant of seedResult.variants) {
          try {
            variant.metrics = await analyzeLocal(join(output, variant.directory), {
              threshold,
              maxPages: validated.references.find((item) => item.id === reference.id).config.site.pageCount,
            });
          } catch (error) {
            variant.analysisError = error.message;
          }
          variant.gate.failures = metricGate(reference.id, seedResult.seed, variant.level, variant.metrics);
          if (variant.analysisError) variant.gate.failures.push(`${reference.id}/${seedResult.seed}/${variant.level}: analysis failed: ${variant.analysisError}`);
          variant.gate.passed = variant.gate.failures.length === 0;
          failures.push(...variant.gate.failures);
        }
      }
    }

    const study = {
      version: 1,
      status: failures.length ? 'failed' : 'passed',
      mode: live ? 'live' : 'offline',
      manifest: { version: validated.version, referenceCount: validated.references.length },
      options: { seeds, levels, maxPages, delayMs, threshold },
      warning: live
        ? 'Live source clusters are bounded predictions, not ground truth or accuracy. Accuracy metrics apply only to separately generated synthetic known-answer pages.'
        : 'Reference sources were not sampled. Inspiration is manifest-supplied; accuracy metrics apply only to generated synthetic known-answer pages.',
      gatePolicy: {
        scope: 'synthetic-metric-guardrails-and-live-source-availability',
        status: 'local-product-candidate',
        note: 'These thresholds are local candidate guardrails and are not Brad-approved acceptance criteria.',
      },
      references,
      gates: { passed: failures.length === 0, failures },
      durationMs: Date.now() - started,
    };
    await writeFile(join(output, 'study.json'), json(study));
    await writeFile(join(output, 'report.html'), renderReferenceReport(study));
    return { output, study };
  } catch (error) {
    await writeFile(join(output, 'failure.json'), json({ status: 'failed', message: error.message }));
    throw error;
  }
}
