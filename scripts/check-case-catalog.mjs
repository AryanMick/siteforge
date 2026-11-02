import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, parseFragment } from 'parse5';
import { listFiles } from '../src/artifact-files.mjs';
import { validateConfig } from '../src/config.mjs';
import { TRANSPORT_CATALOG } from '../src/fixture-lab/catalog.mjs';
import { buildCatalogSiteConfig, CATALOG_SETTINGS, CATALOG_VERSION, listCatalogCases } from '../src/fixture-lab/case-catalog.mjs';
import { getJob, siteDirectory, validUuid } from '../src/fixture-lab/store.mjs';
import { createModel } from '../src/model.mjs';
import { applyDataNoise, applyHtmlNoise } from '../src/noise.mjs';
import { finalizePage, renderPage } from '../src/renderers.mjs';
import { buildTransportPlan } from '../src/transport.mjs';
import { attr, hash, textContent, walk } from '../src/util.mjs';

const PRIVATE_TERMS = /expectedCluster|canonicalValues|noiseEvents|ground-truth|pageId/;
const EVIDENCE_PATH = join(process.cwd(), 'outputs', 'case-catalog', 'evidence.json');

export async function verifyCaseCatalogJob(jobId, { concurrency = 8 } = {}) {
  const startedAt = new Date();
  const evidence = {
    version: 1,
    catalogVersion: CATALOG_VERSION,
    jobId,
    startedAt: startedAt.toISOString(),
    completedAt: null,
    durationMs: null,
    status: 'failed',
    scope: { suite: CATALOG_SETTINGS.suite, siteCount: 1440, pagesPerSite: 16, expectedPublicPages: 23040 },
    claims: {
      deterministicFixtureReplay: true,
      publicArtifactIntegrity: true,
      smartCiteEvaluation: false,
      tlsNetworkPerCase: false,
    },
    totals: { cases: 1440, passed: 0, failed: 0, pages: 0, artifactFiles: 0 },
    axes: axisCounts(listCatalogCases()),
    coverage: null,
    failures: [],
    cases: [],
  };

  try {
    const job = await requireCompletedJob(jobId);
    const expectedCases = listCatalogCases();
    const actualIds = job.sites.map(site => site.id);
    assert.equal(new Set(actualIds).size, CATALOG_SETTINGS.siteCount, 'job site IDs must be unique');
    assert.deepEqual([...actualIds].sort(), expectedCases.map(item => item.id), 'job inventory must contain every catalog case exactly once');

    const results = await mapConcurrent(expectedCases, concurrency, descriptor => verifyCase(job, descriptor));
    markDuplicateSignatures(results);
    const coverage = suiteCoverage(results);
    evidence.coverage = coverage.summary;
    evidence.failures.push(...coverage.failures);
    evidence.cases = results.map(({ signature: _signature, ...result }) => result);
    evidence.totals.passed = evidence.cases.filter(result => result.status === 'passed').length;
    evidence.totals.failed = evidence.cases.length - evidence.totals.passed;
    evidence.totals.pages = evidence.cases.reduce((sum, result) => sum + (result.pageCount ?? 0), 0);
    evidence.totals.artifactFiles = evidence.cases.reduce((sum, result) => sum + (result.artifactFiles ?? 0), 0);
    evidence.status = evidence.totals.failed === 0 && evidence.failures.length === 0 ? 'passed' : 'failed';
    if (evidence.status === 'failed') evidence.failures.push(`${evidence.totals.failed} catalog case(s) failed verification`);
  } catch (error) {
    evidence.failures.push(errorMessage(error));
  } finally {
    const completedAt = new Date();
    evidence.completedAt = completedAt.toISOString();
    evidence.durationMs = completedAt.getTime() - startedAt.getTime();
    await mkdir(join(process.cwd(), 'outputs', 'case-catalog'), { recursive: true });
    await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n');
  }

  return { evidence, evidencePath: EVIDENCE_PATH };
}

async function requireCompletedJob(jobId) {
  validUuid(jobId);
  const job = await getJob(jobId);
  assert(job, 'fixture job not found');
  assert.equal(job.status, 'completed', 'fixture job must be completed before verification');
  for (const [key, value] of Object.entries(CATALOG_SETTINGS)) {
    assert.deepEqual(job.config?.[key], value, `fixture job setting ${key} must equal ${JSON.stringify(value)}`);
  }
  assert(Number.isInteger(job.config?.seed) && job.config.seed >= 0 && job.config.seed <= 0xffffffff, 'fixture job seed must be an unsigned 32-bit integer');
  assert.equal(job.completedSites, CATALOG_SETTINGS.siteCount, 'fixture job completed-site count is incomplete');
  assert.equal(job.sites?.length, CATALOG_SETTINGS.siteCount, 'fixture job site inventory is incomplete');
  assert.equal(job.totalPages, CATALOG_SETTINGS.siteCount * CATALOG_SETTINGS.pagesPerSite, 'fixture job total-page count is invalid');
  return job;
}

async function verifyCase(job, descriptor) {
  const started = performance.now();
  const result = { id: descriptor.id, status: 'failed', durationMs: 0 };
  try {
    const summary = job.sites.find(site => site.id === descriptor.id);
    assert(summary, 'site is missing from job inventory');
    const root = siteDirectory(job.id, descriptor.id);
    const privateDirectory = join(root, 'private');
    const publicDirectory = join(root, 'public');
    const [rawConfig, canonical, truth, manifest, storedTransport, publicFiles] = await Promise.all([
      readJson(join(privateDirectory, 'config.json')),
      readJson(join(privateDirectory, 'canonical.json')),
      readJson(join(privateDirectory, 'ground-truth.json')),
      readJson(join(privateDirectory, 'manifest.json')),
      readJson(join(privateDirectory, 'transport.json')),
      listFiles(publicDirectory),
    ]);

    const config = validateConfig(rawConfig);
    const expectedConfig = validateConfig(buildCatalogSiteConfig(descriptor.id, {
      seed: job.config.seed,
      pageCount: CATALOG_SETTINGS.pagesPerSite,
      name: config.site.name,
    }));
    assert.deepEqual(config, expectedConfig, 'stored config does not match its catalog descriptor');
    assert.equal(config.previewProtocol, descriptor.protocol);
    assert.equal(summary.previewProtocol, descriptor.protocol, 'job summary protocol must match actual config');
    assert.equal(new URL(config.site.baseUrl).protocol, `${descriptor.protocol}:`);
    assert.equal(config.site.framework, descriptor.framework);
    assert.equal(config.site.domain, descriptor.domain);
    assert.equal(config.site.visualStyle, descriptor.visualStyle);

    const replayCanonical = createModel(config);
    assert.deepEqual(canonical, replayCanonical, 'canonical model is not a deterministic replay');
    const replayPages = replayCanonical.pages.map(page => applyDataNoise(page, replayCanonical.site));
    const replayTransport = buildTransportPlan(replayCanonical.pages, { profile: config.transport.profile, seed: config.seed });
    assert.deepEqual(truth, { ...replayCanonical, pages: replayPages, transport: replayTransport }, 'ground truth is not a deterministic replay');
    assert.deepEqual(storedTransport, replayTransport, 'stored transport plan differs from deterministic replay');

    assert.equal(canonical.pages.length, CATALOG_SETTINGS.pagesPerSite);
    assert.equal(truth.pages.length, CATALOG_SETTINGS.pagesPerSite);
    assert.equal(new Set(canonical.pages.map(page => page.url)).size, CATALOG_SETTINGS.pagesPerSite, 'canonical page URLs must be unique');
    assert.equal(new Set(canonical.pages.map(page => page.pageId)).size, CATALOG_SETTINGS.pagesPerSite, 'canonical page IDs must be unique');
    assertStableTruth(canonical, truth);
    assertProfileCoverage(config, truth, replayTransport);

    const htmlFiles = publicFiles.filter(name => name.endsWith('.html'));
    assert.equal(htmlFiles.length, CATALOG_SETTINGS.pagesPerSite, 'public HTML inventory must contain 16 pages');
    assert(publicFiles.includes('robots.txt'), 'robots.txt is missing');
    assert(publicFiles.includes('sitemap.xml'), 'sitemap.xml is missing');
    assert(publicFiles.includes('assets/site.css'), 'site stylesheet is missing');
    assert(publicFiles.includes('assets/collection.png'), 'site image is missing');
    assert.deepEqual(Object.keys(manifest.artifactFiles).sort(), publicFiles, 'manifest artifact inventory is incomplete');

    const fileBuffers = await Promise.all(publicFiles.map(name => readFile(join(publicDirectory, name))));
    const publicArtifacts = new Map(publicFiles.map((name, index) => [name, fileBuffers[index]]));
    for (let index = 0; index < publicFiles.length; index++) {
      assert.equal(sha256(fileBuffers[index]), manifest.artifactFiles[publicFiles[index]], `artifact digest mismatch: ${publicFiles[index]}`);
    }
    assert.equal(manifest.configurationSha256, hash(rawConfig), 'configuration digest is invalid');
    assert.equal(manifest.canonicalSha256, hash(canonical.pages), 'canonical digest is invalid');
    assert.equal(manifest.truthSha256, hash(truth), 'ground-truth digest is invalid');
    assert.equal(manifest.pageCount, CATALOG_SETTINGS.pagesPerSite);
    assert.equal(manifest.siteId, descriptor.id);

    await Promise.all(truth.pages.map(async (page, index) => {
      const html = publicArtifacts.get(publicPageName(page.url))?.toString('utf8');
      assert.equal(typeof html, 'string', `${page.url} is absent from the public artifact inventory`);
      assert.doesNotMatch(html, PRIVATE_TERMS, `${page.url} exposes private field names`);
      for (const canonicalPage of canonical.pages.filter(item => /^[a-z]+-\d{6}$/.test(item.pageId))) {
        assert(!html.includes(canonicalPage.pageId), `${page.url} exposes private page ID ${canonicalPage.pageId}`);
      }
      const expectedHtml = finalizePage(canonical.site, page, applyHtmlNoise(renderPage(canonical.site, page), page, canonical.site));
      assert.equal(html, expectedHtml, `${page.url} differs from deterministic render replay`);
      assertPublicFields(html, config.site.framework, canonical.pages[index], page);
    }));

    result.status = 'passed';
    result.pageCount = truth.pages.length;
    result.artifactFiles = publicFiles.length;
    result.pathCounts = pathCounts(publicFiles);
    result.assetSha256 = Object.fromEntries(publicFiles.filter(name => name.startsWith('assets/')).map(name => [name, manifest.artifactFiles[name]]));
    result.noiseEvents = truth.pages.reduce((sum, page) => sum + page.noiseEvents.length, 0);
    result.configuredNoiseTypes = [...config.noise.types];
    result.observedNoiseTypes = [...new Set(truth.pages.flatMap(page => page.noiseEvents.map(event => event.type)))].sort();
    result.framework = descriptor.framework;
    result.protocol = descriptor.protocol;
    result.profile = descriptor.profile;
    result.transportRules = replayTransport.rules.length;
    result.transportTypes = replayTransport.rules.map(rule => rule.type).sort();
    result.signature = configurationSignature(config);
  } catch (error) {
    result.error = errorMessage(error);
  }
  result.durationMs = Math.round(performance.now() - started);
  return result;
}

function assertStableTruth(canonical, truth) {
  for (let index = 0; index < canonical.pages.length; index++) {
    const source = canonical.pages[index];
    const observed = truth.pages[index];
    assert.equal(observed.url, source.url);
    assert.equal(observed.pageId, source.pageId);
    assert.equal(observed.expectedCluster, source.expectedCluster, `${source.url} changed its expected cluster`);
    assert.deepEqual(observed.canonicalValues, source.canonicalValues, `${source.url} changed canonical values`);
    for (const [field, state] of Object.entries(observed.fieldStates)) {
      if (state === 'present') assert(Object.hasOwn(observed.fields, field), `${source.url} marks missing ${field} present`);
      if (state === 'absent') assert(!Object.hasOwn(observed.fields, field), `${source.url} marks present ${field} absent`);
    }
  }
}

function assertProfileCoverage(config, truth, transport) {
  const expectedTypes = new Set(config.noise.types);
  const actualTypes = new Set(truth.pages.flatMap(page => page.noiseEvents.map(event => event.type)));
  for (const type of actualTypes) assert(expectedTypes.has(type), `unexpected noise event type: ${type}`);
  if (config.noise.level === 'clean') assert.equal(actualTypes.size, 0, 'clean control must not contain noise events');
  else assert(actualTypes.size > 0, 'non-clean profile must contain actual noise events');
  if (config.transport.profile === 'mixed') {
    assert.equal(transport.rules.length, 10, 'mixed transport profile must exercise all ten rules');
    assert.equal(new Set(transport.rules.map(rule => rule.type)).size, 10, 'transport rule types must be unique');
    assert.deepEqual(transport.rules.map(rule => rule.type).sort(), TRANSPORT_CATALOG.map(item => item.id).sort(), 'mixed transport profile must cover the transport catalog');
  } else {
    assert.equal(config.transport.profile, 'none');
    assert.equal(transport.rules.length, 0);
  }
}

function assertPublicFields(html, framework, canonical, observed) {
  let root = parse(html);
  if (framework !== 'html') {
    const payload = walk(root, node => node.tagName === 'script' && attr(node, 'id') === 'page-data')[0];
    assert(payload, `${observed.url} is missing client page data`);
    const decoded = JSON.parse(rawText(payload));
    assert(Array.isArray(decoded) && typeof decoded[0] === 'string', `${observed.url} has invalid client page data`);
    root = parseFragment(decoded[0]);
  }
  const heading = walk(root, node => node.tagName === 'h1')[0];
  assert(heading, `${observed.url} is missing its primary heading`);
  assert.equal(normalize(textContent(heading)), normalize(observed.title), `${observed.url} has an unexpected heading`);
  if (observed.kind !== 'detail') return;
  const fields = walk(root, node => attr(node, 'class')?.split(/\s+/).includes('field-list'))[0];
  const fieldText = normalize(textContent(fields ?? { childNodes: [] }));
  for (const [name, value] of Object.entries(observed.fields)) {
    if (name !== 'title') assert(fieldText.includes(normalize(value)), `${observed.url} is missing public field ${name}`);
  }
  for (const [name, state] of Object.entries(observed.fieldStates)) {
    if (name !== 'title' && state === 'absent' && Object.hasOwn(canonical.canonicalValues, name)) {
      const absentValue = normalize(canonical.canonicalValues[name]);
      const duplicatedByPresentField = Object.entries(observed.fields)
        .some(([presentName, value]) => presentName !== 'title' && presentName !== name && normalize(value) === absentValue);
      if (!duplicatedByPresentField) assert(!fieldText.includes(absentValue), `${observed.url} exposes absent field ${name}`);
    }
  }
}

function publicPageName(url) {
  const segments = url.split('/').filter(Boolean);
  return join(...segments, 'index.html');
}

function configurationSignature(config) {
  const value = structuredClone(config);
  delete value.seed;
  delete value.site.id;
  delete value.site.name;
  delete value.site.baseUrl;
  return JSON.stringify(value);
}

function markDuplicateSignatures(results) {
  const bySignature = new Map();
  for (const result of results.filter(item => item.signature)) {
    const matches = bySignature.get(result.signature) ?? [];
    matches.push(result);
    bySignature.set(result.signature, matches);
  }
  for (const matches of bySignature.values()) if (matches.length > 1) {
    for (const result of matches) {
      result.status = 'failed';
      result.error = `configuration behavior duplicates ${matches.filter(item => item !== result).map(item => item.id).join(', ')}`;
    }
  }
}

function suiteCoverage(results) {
  const failures = [];
  for (const protocol of ['http', 'https']) {
    if (results.filter(result => result.status === 'passed' && result.protocol === protocol).length !== 720) failures.push(`suite must verify exactly 720 ${protocol.toUpperCase()} cases`);
  }
  const groups = new Map();
  for (const result of results.filter(item => item.status === 'passed')) {
    const key = `${result.profile}/${result.framework}`;
    const group = groups.get(key) ?? { configured: new Set(), observed: new Set() };
    for (const type of result.configuredNoiseTypes) group.configured.add(type);
    for (const type of result.observedNoiseTypes) group.observed.add(type);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    const missing = [...group.configured].filter(type => !group.observed.has(type));
    if (missing.length) failures.push(`${key} did not exercise configured noise types: ${missing.join(', ')}`);
  }
  const transportTypes = [...new Set(results.flatMap(result => result.transportTypes ?? []))].sort();
  const missingTransport = TRANSPORT_CATALOG.map(item => item.id).filter(type => !transportTypes.includes(type));
  if (missingTransport.length) failures.push(`suite did not exercise transport types: ${missingTransport.join(', ')}`);
  return {
    failures,
    summary: {
      noiseByProfileAndFramework: Object.fromEntries([...groups].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => [key, {
        configured: [...group.configured].sort(),
        observed: [...group.observed].sort(),
        missing: [...group.configured].filter(type => !group.observed.has(type)).sort(),
      }])),
      transportTypes,
      missingTransport,
    },
  };
}

function axisCounts(cases) {
  const count = key => Object.fromEntries([...new Set(cases.map(item => item[key]))].sort().map(value => [value, cases.filter(item => item[key] === value).length]));
  return { domain: count('domain'), framework: count('framework'), fieldLayout: count('fieldLayout'), protocol: count('protocol'), profile: count('profile') };
}

function pathCounts(files) {
  const counts = { html: 0, css: 0, js: 0, png: 0, xml: 0, txt: 0, other: 0 };
  for (const file of files) {
    const extension = file.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (extension && Object.hasOwn(counts, extension)) counts[extension]++;
    else counts.other++;
  }
  return counts;
}

async function mapConcurrent(items, concurrency, operation) {
  assert(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 32, 'concurrency must be an integer from 1 to 32');
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function rawText(node) {
  return node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(rawText).join('');
}

function normalize(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function errorMessage(error) {
  return String(error?.message ?? error).slice(0, 2000);
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--job') throw new Error('Usage: node scripts/check-case-catalog.mjs --job <uuid>');
  return validUuid(argv[1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { evidence, evidencePath } = await verifyCaseCatalogJob(parseArguments(process.argv.slice(2)));
    console.log(`Case catalog: ${evidence.totals.passed}/${evidence.totals.cases} passed in ${evidence.durationMs}ms`);
    console.log(`Evidence: ${evidencePath}`);
    if (evidence.status !== 'passed') {
      for (const failure of evidence.failures) console.error(failure);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
