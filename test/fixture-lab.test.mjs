import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generate } from '../src/site/generator.mjs';
import { sitePlan, totalPlannedPages, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { CATALOG_SETTINGS, listCatalogCases } from '../src/fixture-lab/case-catalog.mjs';
import { publicZip } from '../src/fixture-lab/archive.mjs';
import { createJob, getJob, jobDirectory, previewRecord, previewSite, recoverActiveBatch, saveJob, siteDirectory } from '../src/fixture-lab/store.mjs';

async function finished(id) {
  for (let attempt = 0; attempt < 400; attempt++) { const job = await getJob(id); if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Timed out waiting for fixture job ${id}`);
}

test('fixture configuration is strict, bounded, deterministic, and marks one optional field per type', () => {
  const defaults = validateFixtureInput({ name: 'External crawler benchmark' });
  assert.deepEqual({ siteCount: defaults.siteCount, pagesPerSite: defaults.pagesPerSite, domain: defaults.domain, framework: defaults.framework, visualStyle: defaults.visualStyle, noise: defaults.noise, seed: defaults.seed, fieldLayout: defaults.fieldLayout, optionalFields: defaults.optionalFields, scenario: defaults.scenario },
    { siteCount: 1, pagesPerSite: 60, domain: 'library', framework: 'html', visualStyle: 'conventional', noise: 'clean', seed: 48291, fieldLayout: 'mixed', optionalFields: true, scenario: 'baseline' });
  assert.throws(() => validateFixtureInput({ name: 'Too large', siteCount: 101, pagesPerSite: 1000 }), /100,000/);
  assert.throws(() => validateFixtureInput({ name: 'Unknown', command: 'run' }));
  assert.throws(() => validateFixtureInput({ name: 'Delayed HTML', scenario: 'client-delay', framework: 'html' }), /React or Angular/);
  assert.throws(() => validateFixtureInput({ name: 'Delayed mixed', scenario: 'client-delay', framework: 'mixed' }), /React or Angular/);
  const input = validateFixtureInput({ name: 'Mixed', siteCount: 2, pagesPerSite: 12, domain: 'mixed', framework: 'mixed', visualStyle: 'mixed', noise: 'mixed' });
  const plans = [sitePlan(input, 0), sitePlan(input, 1)];
  assert.deepEqual(plans, [sitePlan(input, 0), sitePlan(input, 1)]);
  assert.notEqual(plans[0].summary.framework, plans[1].summary.framework);
  for (const plan of plans) for (const type of plan.config.contentTypes) {
    assert.equal(type.fieldLayout, 'mixed');
    const optional = type.fields.filter(field => field.optional);
    assert.equal(optional.length, 1); assert.equal(optional[0].presenceProbability, 0.5); assert.notEqual(optional[0].name, 'title');
  }
  assert.deepEqual(sitePlan(validateFixtureInput({ name: 'Legacy', scenario: 'legacy-clutter' }), 0).config.noise.types,
    ['extra-wrapper', 'class-churn', 'inline-style', 'boilerplate', 'malformed-nesting', 'duplicate-id', 'missing-metadata', 'reorder-fields', 'legacy-document', 'missing-main', 'deep-wrapper-tree', 'legacy-color-attribute', 'frame-missing-title', 'split-text-runs', 'entity-encoded-text', 'uppercase-legacy-tags', 'spacer-elements']);
  assert.deepEqual(sitePlan(validateFixtureInput({ name: 'Inconsistent', scenario: 'inconsistent-fields' }), 0).config.noise.types,
    ['missing-field', 'label-variation', 'date-format', 'reorder-fields']);
  assert.deepEqual(sitePlan(validateFixtureInput({ name: 'Delayed', scenario: 'client-delay', framework: 'react' }), 0).config.noise.types, ['delayed-content']);
});

test('zero pages per site chooses bounded, reproducible counts independently', () => {
  const config = validateFixtureInput({ name: 'Random sizes', siteCount: 8, pagesPerSite: 0, seed: 413 });
  const counts = Array.from({ length: 8 }, (_, index) => sitePlan(config, index).summary.pageCount);
  assert(counts.every(count => count >= 5 && count <= 200));
  assert(new Set(counts).size > 1);
  assert.equal(totalPlannedPages(config), counts.reduce((sum, count) => sum + count, 0));
  assert.deepEqual(counts, Array.from({ length: 8 }, (_, index) => sitePlan(config, index).summary.pageCount));
  const large = validateFixtureInput({ name: 'Bounded many', siteCount: 500, pagesPerSite: 0 });
  assert(Array.from({ length: 500 }, (_, index) => sitePlan(large, index).summary.pageCount).every(count => count <= 200));
  const full = validateFixtureInput({ name: 'Full batch', siteCount: 500, pagesPerSite: 200 });
  assert.equal(totalPlannedPages(full), 100000);
  assert.throws(() => validateFixtureInput({ name: 'Over budget', siteCount: 500, pagesPerSite: 201 }), /100,000/);
});

test('random choices resolve to concrete per-site technology and content settings', () => {
  const config = validateFixtureInput({ name: 'Everything random', siteCount: 30, pagesPerSite: 0, seed: 893,
    domain: 'random', framework: 'random', visualStyle: 'random', noise: 'random', challenge: 'random', fieldLayout: 'random', linkMode: 'random', optionalFields: 'random', scenario: 'random', transport: 'random', previewProtocol: 'random' });
  const plans = Array.from({ length: config.siteCount }, (_, index) => sitePlan(config, index));
  assert.deepEqual(plans, Array.from({ length: config.siteCount }, (_, index) => sitePlan(config, index)));
  assert(new Set(plans.map(plan => plan.summary.framework)).size > 1);
  assert(new Set(plans.map(plan => plan.summary.domain)).size > 1);
  assert(new Set(plans.map(plan => plan.summary.linkMode)).size > 1);
  assert(plans.every(plan => ['http', 'https'].includes(plan.summary.previewProtocol)));
  assert(plans.every(plan => !Object.values(plan.summary).includes('random')));
  assert(plans.every(plan => !(plan.summary.framework === 'html' && plan.summary.scenario === 'client-delay')));
  assert(plans.every(plan => plan.config.site.pageCount === plan.summary.pageCount));
});

test('catalog batches enforce the exact matrix without removing custom batch limits', () => {
  assert.throws(() => validateFixtureInput({ name: 'Custom limit', siteCount: 501, pagesPerSite: 16 }), /500 websites/);
  const config = validateFixtureInput({ ...CATALOG_SETTINGS, name: 'Catalog' });
  assert.equal(config.siteCount * config.pagesPerSite, 23040);
  assert.throws(() => validateFixtureInput({ ...config, siteCount: 1000 }), /1440 websites/);
  assert.throws(() => validateFixtureInput({ ...config, pagesPerSite: 17 }), /16/);
  assert.throws(() => sitePlan(config, 1440), /outside/);
  assert.throws(() => validateFixtureInput({ ...config, suite: 'catalog-case', siteCount: 1, caseId: 'case-9999' }), /existing catalog/);
  for (const descriptor of listCatalogCases()) {
    const single = validateFixtureInput({ ...config, suite: 'catalog-case', siteCount: 1, caseId: descriptor.id, previewProtocol: descriptor.protocol });
    const plan = sitePlan(single, 0);
    assert.equal(plan.id, descriptor.id);
    assert.equal(plan.config.previewProtocol, descriptor.protocol);
    assert.equal(plan.summary.caseId, descriptor.id);
    assert.equal(plan.config.site.pageCount, 16);
  }
});

test('background jobs generate 1x60 and two mixed source-first sites without answer leakage', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fixture-lab-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR; process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    const started = await createJob({ name: 'Smartcite controlled', pagesPerSite: 60 });
    const job = await finished(started.id);
    assert.equal(job.status, 'completed', job.error); assert.equal(job.completedSites, 1); assert.equal(job.totalPages, 60); assert.equal(job.sites[0].pageCount, 60);
    const site = job.sites[0]; const truthPath = join(siteDirectory(job.id, site.id), 'private', 'ground-truth.json');
    const truth = JSON.parse(await readFile(truthPath, 'utf8'));
    assert.equal(truth.pages.length, 60); assert.equal(new Set(truth.pages.map(page => page.expectedCluster)).size, site.clusters);
    await assert.rejects(readFile(join(jobDirectory(job.id), 'hosts.txt')), { code: 'ENOENT' });
    assert.equal(site.handoff?.version, 1);
    assert.equal(JSON.parse(await readFile(join(siteDirectory(job.id, site.id), 'private', 'metadata.json'), 'utf8')).pageCount, 60);
    assert.match(await readFile(join(siteDirectory(job.id, site.id), 'index.html'), 'utf8'), /url=\.\/public\/index\.html/);
    const comparison = join(root, 'comparison'); await generate(sitePlan(job.config, 0).config, comparison);
    assert.deepEqual(JSON.parse(await readFile(join(comparison, 'private', 'ground-truth.json'), 'utf8')), truth);

    const zip = new AdmZip(await publicZip(siteDirectory(job.id, site.id)));
    const names = zip.getEntries().map(entry => entry.entryName);
    assert(names.includes('index.html')); assert(names.includes('assets/site.css')); assert(names.every(name => !name.startsWith('private/')));
    const publicText = zip.getEntries().filter(entry => !entry.isDirectory).map(entry => entry.getData().toString('utf8')).join('\n');
    for (const secret of ['ground-truth', 'expectedCluster', 'canonicalValues', 'noiseEvents']) assert(!publicText.includes(secret), secret);

    const mixed = await finished((await createJob({ name: 'Mixed fixtures', siteCount: 2, pagesPerSite: 12, domain: 'mixed', framework: 'mixed', visualStyle: 'mixed', noise: 'high', scenario: 'legacy-clutter', seed: 48293 })).id);
    assert.equal(mixed.status, 'completed', mixed.error); assert.equal(mixed.sites.length, 2); assert.equal(mixed.totalPages, 24);
    assert.notEqual(mixed.sites[0].framework, mixed.sites[1].framework);
    assert(mixed.sites.every(site => site.scenario === 'legacy-clutter'));
    const allowedEvents = new Set(['extra-wrapper', 'class-churn', 'inline-style', 'boilerplate', 'malformed-nesting', 'duplicate-id', 'missing-metadata', 'reorder-fields', 'legacy-document', 'missing-main', 'deep-wrapper-tree', 'legacy-color-attribute', 'frame-missing-title', 'split-text-runs', 'entity-encoded-text', 'uppercase-legacy-tags', 'spacer-elements']);
    let malformedFixture;
    for (const generatedSite of mixed.sites) {
      const generatedTruth = JSON.parse(await readFile(join(siteDirectory(mixed.id, generatedSite.id), 'private', 'ground-truth.json'), 'utf8'));
      const events = generatedTruth.pages.flatMap(page => page.noiseEvents);
      assert(events.length > 0); assert(events.every(event => allowedEvents.has(event.type)));
      const malformedPage = generatedTruth.pages.find(page => page.noiseEvents.some(event => event.type === 'malformed-nesting'));
      if (!malformedFixture && generatedSite.framework === 'html' && malformedPage) malformedFixture = { site: generatedSite, page: malformedPage };
    }
    assert(malformedFixture, 'high-noise legacy fixture should include malformed nesting');

    let record;
    try {
      const selectedSite = malformedFixture.site;
      const preview = await previewSite(mixed.id, selectedSite.id); const reused = await previewSite(mixed.id, selectedSite.id);
      assert.equal(reused.url, preview.url);
      const page = await fetch(preview.url); assert.equal(page.status, 200); const homeHtml = await page.text();
      const selectedTruth = JSON.parse(await readFile(join(siteDirectory(mixed.id, selectedSite.id), 'private', 'ground-truth.json'), 'utf8'));
      if (selectedTruth.pages.find(item => item.url === '/').noiseEvents.some(event => event.type === 'legacy-document')) assert.doesNotMatch(homeHtml, /<!doctype html>/i);
      else assert.match(homeHtml, /<!doctype html>/i);
      assert.equal((await fetch(preview.url + '/assets/site.css')).status, 200);
      assert.equal((await fetch(preview.url + '/private/ground-truth.json')).status, 404);
      const robots = await (await fetch(preview.url + '/robots.txt')).text(); assert.match(robots, new RegExp(`Sitemap: ${preview.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sitemap\\.xml`));
      const sitemap = await (await fetch(preview.url + '/sitemap.xml')).text();
      const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]); assert(sitemapUrls.length); assert(sitemapUrls.every(value => new URL(value).origin === preview.url));
      const detailUrl = sitemapUrls.find(value => new URL(value).pathname !== '/'); const detailHtml = await (await fetch(detailUrl)).text();
      assert.match(detailHtml, new RegExp(`<link rel="canonical" href="${detailUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
      const malformedHtml = await (await fetch(preview.url + malformedFixture.page.url)).text();
      assert(malformedHtml.includes('<p class="archive-note"><div>Record last reviewed.</p></div>'));
      assert.match(malformedHtml, new RegExp(`<link rel="canonical" href="${(preview.url + malformedFixture.page.url).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
      const storedSitemap = await readFile(join(siteDirectory(mixed.id, selectedSite.id), 'public', 'sitemap.xml'), 'utf8'); assert.match(storedSitemap, /http:\/\/site-.*\.siteforge\.test/); assert(!storedSitemap.includes(preview.url));
      record = await previewRecord(mixed.id, selectedSite.id);
    } finally { if (record?.pid) process.kill(record.pid, 'SIGTERM'); }

    const crashed = { id: randomUUID(), name: 'Interrupted', status: 'running', config: validateFixtureInput({ name: 'Interrupted' }), createdAt: '2020-01-01T00:00:00.000Z', finishedAt: null, error: null, completedSites: 0, totalPages: 60, sites: [] };
    await mkdir(jobDirectory(crashed.id), { recursive: true }); await saveJob(crashed);
    await mkdir(join(root, 'active.lock')); await writeFile(join(root, 'active.lock', 'owner.json'), JSON.stringify({ id: crashed.id, pid: 99999999, createdAt: crashed.createdAt }));
    const recovered = await getJob(crashed.id); assert.equal(recovered.status, 'failed'); assert.match(recovered.error, /preserved/);
    await assert.rejects(readFile(join(root, 'active.lock', 'owner.json')), { code: 'ENOENT' });

    await mkdir(join(root, 'active.lock')); await writeFile(join(root, 'active.lock', 'owner.json'), '{bad');
    const old = new Date('2020-01-01T00:00:00.000Z'); await utimes(join(root, 'active.lock'), old, old);
    await assert.rejects(recoverActiveBatch(), /preserved/);
    assert.equal(await readFile(join(root, 'active.lock', 'owner.json'), 'utf8'), '{bad');
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR; else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
