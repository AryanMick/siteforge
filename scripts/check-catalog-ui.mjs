import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import AxeBuilder from '@axe-core/playwright';
import { previewRecord } from '../src/fixture-lab/store.mjs';
import { cleanupTestArtifacts } from './test-artifact-cleanup.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const { chromium } = await import('playwright');
const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4400';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = resolve('outputs/catalog-browser');
const demo = resolve('outputs/random-demo');
await mkdir(output, { recursive: true }); await mkdir(demo, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = []; const checks = [];
let ownedPreview;
let primaryError;
const ownedJobs = new Set();
const downloadedFiles = [];
page.on('pageerror', error => errors.push(error.message));
async function audit(name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow`);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], name);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  checks.push(`${name}: no detected A/AA violations or document overflow`);
}
async function finished(id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await page.request.get(`${base}/api/fixtures/${id}`);
    const { job } = await response.json();
    if (job.status !== 'running') { assert.equal(job.status, 'completed', job.error); return job; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error('Generated job timed out');
}
async function waitCases() { await page.locator('tbody tr td code').first().waitFor(); }

try {
  await page.goto(`${base}/cases`); await waitCases();
  assert.equal(await page.locator('tbody tr').count(), 25);
  await audit('catalog-desktop');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByText('case-0026', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Protocol', exact: true }).selectOption('https'); await waitCases();
  await page.getByText('720 matching', { exact: true }).waitFor();
  assert((await page.locator('tbody tr td:nth-child(5)').allTextContents()).every(value => value === 'HTTPS'));
  await page.getByLabel('Search cases', { exact: true }).fill('case-0008');
  await page.getByText('1 matching', { exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 }); await audit('catalog-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  let resolveCatalogCapture;
  const catalogCapture = new Promise(resolve => { resolveCatalogCapture = resolve; });
  await page.route(`${base}/api/fixtures/catalog`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    try {
      const response = await route.fetch();
      const status = response.status();
      const body = status === 202 ? await response.json() : null;
      if (body?.job?.id) ownedJobs.add(body.job.id);
      await route.fulfill({ response });
      resolveCatalogCapture({ status, body });
    } catch (error) {
      resolveCatalogCapture({ error });
      await route.abort().catch(() => {});
    }
  });
  await page.locator('tbody button').click();
  const capturedCatalog = await catalogCapture;
  if (capturedCatalog.error) throw capturedCatalog.error;
  assert.equal(capturedCatalog.status, 202);
  const catalogId = capturedCatalog.body.job.id;
  await page.unroute(`${base}/api/fixtures/catalog`);
  await page.waitForURL(url => url.pathname === '/' && url.searchParams.has('job'));
  assert.equal(new URL(page.url()).searchParams.get('job'), catalogId);
  const catalogJob = await finished(catalogId);
  await page.getByTestId('generated-site').waitFor();
  assert.equal(catalogJob.sites[0].id, 'case-0008');
  assert.equal(catalogJob.sites[0].previewProtocol, 'https');
  checks.push('Catalog filtering, pagination, per-case generation and job deep link');

  const randomResponse = await page.request.post(`${base}/api/fixtures/random`, {
    headers: { Origin: new URL(base).origin },
    data: { seed: 48392, pagesPerSite: 16, randomness: 50, framework: 'html', previewProtocol: 'http' },
  });
  assert.equal(randomResponse.status(), 202);
  const randomId = (await randomResponse.json()).job.id;
  ownedJobs.add(randomId);
  const randomJob = await finished(randomId);
  await page.goto(`${base}/?job=${randomId}`);
  const site = randomJob.sites[0];
  const endpoint = `${base}/api/fixtures/${randomJob.id}/sites/${site.id}`;
  await page.getByRole('heading', { name: randomJob.name, exact: true }).waitFor();
  await page.getByRole('link', { name: `Download answer key JSON for ${site.name}`, exact: true }).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: `Download answer key JSON for ${site.name}`, exact: true }).click();
  const download = await downloadEvent;
  downloadedFiles.push(`${demo}/answer-key.json`);
  await download.saveAs(`${demo}/answer-key.json`);
  const truth = JSON.parse(await readFile(`${demo}/answer-key.json`, 'utf8'));
  assert.equal(truth.pages.length, 16);
  assert(truth.pages.every(record => record.expectedCluster && record.fields.title && record.fieldStates));
  const zipResponse = await page.request.get(`${endpoint}/download?kind=public`);
  assert.equal(zipResponse.status(), 200); const bytes = await zipResponse.body();
  downloadedFiles.push(`${demo}/website.zip`);
  await writeFile(`${demo}/website.zip`, bytes); await writeFile(`${demo}/config.json`, JSON.stringify(randomJob.config, null, 2));
  const zip = new AdmZip(bytes);
  assert.equal(zip.getEntries().filter(item => item.entryName.endsWith('.html')).length, 16);
  assert(zip.getEntries().every(item => !/private\/|\.pem$/.test(item.entryName)));
  for (const file of zip.getEntries().filter(item => item.entryName.endsWith('.html'))) assert.doesNotMatch(file.getData().toString(), /expectedCluster|canonicalValues|noiseEvents/);
  await audit('random-desktop');
  await page.setViewportSize({ width: 390, height: 844 }); await audit('random-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const previewed = page.waitForResponse(response => response.url() === `${endpoint}/preview` && response.request().method() === 'POST');
  await page.getByRole('button', { name: `Preview ${site.name}`, exact: true }).click();
  const previewResponse = await previewed; assert.equal(previewResponse.status(), 200);
  const { url } = await previewResponse.json();
  ownedPreview = { jobId: randomJob.id, siteId: site.id, pid: (await previewRecord(randomJob.id, site.id))?.pid };
  const fixture = await browser.newPage();
  await fixture.goto(url);
  assert.equal(await fixture.locator('h1').first().textContent(), truth.pages[0].fields.title);
  const detail = truth.pages.find(item => item.kind === 'detail');
  await fixture.goto(url + detail.url);
  assert.equal(await fixture.locator('h1').first().textContent(), detail.fields.title);
  await fixture.screenshot({ path: `${output}/random-legacy-html.png`, fullPage: true });
  await fixture.close();
  const replayResponse = await page.request.post(`${base}/api/fixtures`, { headers: { Origin: base }, data: randomJob.config });
  assert.equal(replayResponse.status(), 202);
  const replayId = (await replayResponse.json()).job.id;
  ownedJobs.add(replayId);
  const replayJob = await finished(replayId);
  const replayTruth = await (await page.request.get(`${base}/api/fixtures/${replayJob.id}/sites/${replayJob.sites[0].id}/answers`)).json();
  assert.deepEqual(replayTruth, truth);
  checks.push('Random API compatibility: actual 16-page HTML ZIP and answer-key JSON download from job detail, public preview, deterministic saved-config replay');
  assert.deepEqual(errors, []);
  const evidence = { status: 'passed', catalogJob: catalogJob.id, randomJob: randomJob.id, seed: randomJob.config.seed, replayJob: replayJob.id, previewUrl: url, checks, errors };
  await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  primaryError = error;
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: error.stack, checks, errors }, null, 2)).catch(writeError => console.error('Could not save failure evidence:', writeError));
  throw error;
} finally {
  const cleanupErrors = await cleanupTestArtifacts({ base, request: page.request, jobIds: ownedJobs,
    preview: ownedPreview, downloadedFiles, keepArtifacts: process.env.SITEFORGE_KEEP_TEST_ARTIFACTS === '1' });
  try { await browser.close(); }
  catch (error) { cleanupErrors.push(new Error(`Could not close browser: ${error.message}`, { cause: error })); }
  if (cleanupErrors.length) {
    for (const error of cleanupErrors) console.error('Test artifact cleanup:', error);
    await writeFile(`${output}/cleanup-failure.json`, JSON.stringify({ errors: cleanupErrors.map(error => error.message), jobIds: [...ownedJobs] }, null, 2)).catch(error => console.error('Could not save cleanup evidence:', error));
    if (!primaryError) throw new AggregateError(cleanupErrors, 'Test artifact cleanup failed');
  }
}
