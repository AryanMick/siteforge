import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import AxeBuilder from '@axe-core/playwright';
import { previewRecord } from '../../src/fixture-lab/store.mjs';
import { cleanupTestArtifacts } from './test-artifact-cleanup.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const { chromium } = await import('playwright');
const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4400';
const builderProfile = process.env.SITEFORGE_TEST_BUILDER || 'beaver-builder';
assert(['elementor', 'beaver-builder'].includes(builderProfile));
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = resolve('outputs/fixture-lab-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
async function audit(name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal overflow`);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${name}: accessibility`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  checks.push(`${name}: no detected A/AA violations or document overflow`);
}
let report;
let ownedPreview;
let downloadedEvaluator;
let primaryError;
const ownedJobs = new Set();
try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Test sets', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Generate test set', exact: true }).waitFor();
  assert.equal(await page.locator('#fixture-settings').isVisible(), true);
  assert.equal(await page.locator('#fixture-results').isVisible(), false);
  assert.equal(await page.getByLabel('Site appearance').inputValue(), 'legacy');
  await page.getByText('Look & page source', { exact: true }).click();
  await page.getByText('Noise & scenarios', { exact: true }).click();
  await page.getByText('Links & responses', { exact: true }).click();
  await page.getByText('Repeatability', { exact: true }).click();
  assert.equal(await page.getByLabel('Obstacle scenario').inputValue(), 'legacy-clutter');
  assert.equal(await page.getByLabel('Server responses').inputValue(), 'none');
  assert.equal(await page.getByRole('button', { name: 'Crawl', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Preview protocol', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'hosts.txt', exact: true }).count(), 0);
  await page.getByLabel('Websites', { exact: true }).fill('500');
  await page.getByLabel(/^Pages per site/).fill('200');
  await page.getByLabel('Website settings', { exact: true }).getByText('100,000', { exact: true }).waitFor();
  assert.equal(await page.getByText('Maximum 100,000 pages per test set.').count(), 0);
  await page.getByLabel('Websites', { exact: true }).fill('1');
  await page.getByLabel(/^Pages per site/).fill('100000');
  assert(await page.getByRole('button', { name: 'Generate test set', exact: true }).isEnabled());
  assert.equal(await page.getByLabel('Small-site size', { exact: true }).count(), 0);
  await page.getByLabel('Websites', { exact: true }).fill('2');
  assert(await page.getByRole('button', { name: 'Generate test set', exact: true }).isDisabled());
  await page.getByLabel('Websites', { exact: true }).fill('1');
  await page.getByLabel(/^Pages per site/).fill('60');
  await page.getByLabel('New seed every run').uncheck();
  await page.getByLabel('Name', { exact: true }).fill('Adversarial library verification');
  await page.getByLabel('Obstacle scenario').selectOption('client-delay');
  assert.equal(await page.getByRole('button', { name: 'React', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'HTML', exact: true }).click();
  assert.equal(await page.getByLabel('Obstacle scenario').inputValue(), 'baseline');
  await page.getByLabel('Obstacle scenario').selectOption('baseline');
  await page.getByLabel('Server responses').selectOption('mixed');
  await page.getByLabel('Link URLs').selectOption('base-relative');
  await page.getByLabel(/^CMS markup/).selectOption('wordpress');
  await page.getByLabel(/^Page-builder markup/).selectOption(builderProfile);
  await page.getByRole('button', { name: 'High', exact: true }).click();
  await audit('desktop-setup');
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url() === `${base}/api/fixtures` && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Generate test set', exact: true }).click(),
  ]);
  assert.equal(response.status(), 202);
  const { job: initial } = await response.json();
  ownedJobs.add(initial.id);
  let job;
  for (let attempt = 0; attempt < 90; attempt++) {
    const response = await page.request.get(`${base}/api/fixtures/${initial.id}`);
    assert.equal(response.status(), 200);
    ({ job } = await response.json());
    if (job.status !== 'running') break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  assert.equal(job.sites.length, 1);
  assert.equal(job.sites[0].pageCount, 60);
  assert.equal(job.config.linkMode, 'base-relative');
  assert.equal(job.sites[0].linkMode, 'base-relative');
  assert.equal(job.config.cmsProfile, 'wordpress');
  assert.equal(job.config.builderProfile, builderProfile);
  assert.equal(job.sites[0].cmsProfile, 'wordpress');
  assert.equal(job.sites[0].builderProfile, builderProfile);
  assert(job.sites[0].noiseEvents > 0);
  await page.getByTestId('generated-site').waitFor();
  await audit('desktop-websites');
  const site = job.sites[0];
  const endpoint = `${base}/api/fixtures/${job.id}/sites/${site.id}`;
  const answers = await (await page.request.get(`${endpoint}/answers`)).json();
  assert.equal(answers.site.linkMode, 'base-relative');
  assert.equal(answers.site.cmsProfile, 'wordpress');
  assert.equal(answers.site.builderProfile, builderProfile);
  assert.equal(answers.transport.rules.length, 10);
  const zipResponse = await page.request.get(`${endpoint}/download?kind=public`);
  assert.equal(zipResponse.status(), 200);
  assert.match(zipResponse.headers()['content-disposition'], /attachment/);
  const zip = new AdmZip(await zipResponse.body());
  const files = zip.getEntries();
  // 60 answer-key pages plus the five site tool pages (search results, my list, sign-in, request, subscribe), which
  // are not content pages and are not in the answer key.
  const toolPages = ['site-search.html', 'my-list.html', 'sign-in.html', 'request.html', 'subscribe.html'];
  assert.equal(files.filter(file => file.entryName.endsWith('.html') && !toolPages.includes(file.entryName)).length, 60);
  assert.deepEqual(toolPages.filter(name => files.some(file => file.entryName === name)), toolPages);
  assert.equal(answers.pages.length, 60);
  for (const file of files) {
    assert(!/(?:^|\/)(?:private|answer-key\.json|ground-truth\.json|canonical\.json|config\.json|manifest\.json|transport\.json)/.test(file.entryName));
    if (/\.(?:html|js|xml|txt)$/.test(file.entryName)) assert.doesNotMatch(file.getData().toString(), /expectedCluster|canonicalValues|noiseEvents|fieldLocations|repeatedItemLocations|repeatedItemLocationVersion|answer-key\.json|ground-truth\.json/);
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download full test package', exact: true }).click(),
  ]);
  assert.match(download.suggestedFilename(), /-evaluator\.zip$/);
  const packagePath = `${output}/evaluator.zip`;
  await download.saveAs(packagePath);
  downloadedEvaluator = packagePath;
  const evaluator = new AdmZip(packagePath);
  const host = `${site.id}.siteforge.test`;
  assert.deepEqual(evaluator.getEntries().map(entry => entry.entryName).sort(), [
    `${host}/index.html`, `${host}/answer-key.json`, `${host}/metadata.json`,
    ...files.map(file => `${host}/website/${file.entryName}`),
  ].sort());
  assert.deepEqual(JSON.parse(evaluator.getEntry(`${host}/answer-key.json`).getData().toString()), answers);
  for (const file of files) assert.deepEqual(evaluator.getEntry(`${host}/website/${file.entryName}`).getData(), file.getData());
  const metadata = JSON.parse(evaluator.getEntry(`${host}/metadata.json`).getData().toString());
  assert.equal(metadata.configuration.site.pageCount, 60);
  assert.equal(metadata.configuration.site.linkMode, 'base-relative');
  assert.equal(metadata.configuration.site.cmsProfile, 'wordpress');
  assert.equal(metadata.configuration.site.builderProfile, builderProfile);
  assert(metadata.coverage.affectedPages > 0);
  assert.equal(job.sites[0].handoff.status, 'ready');
  await page.getByText('Local folders', { exact: true }).click();
  assert(await page.getByText(job.sites[0].handoff.directory, { exact: true }).isVisible());
  await page.getByText('Local folders', { exact: true }).click();
  checks.push('Private evaluator ZIP downloaded from UI; exact domain-folder inventory, JSON, metadata and website bytes verified');
  for (const expected of answers.pages) {
    const file = zip.getEntry(`${expected.url.replace(/^\//, '')}index.html`);
    assert(file, `Public page exists for ${expected.url}`);
    const document = load(file.getData().toString());
    const builderSelector = builderProfile === 'beaver-builder' ? '.fl-html' : '[data-widget_type="html.default"]';
    assert.equal(document(builderSelector).length, 1, `${builderProfile} markup exists in ${expected.url}`);
    assert.equal(typeof expected.expectedCluster, 'string');
    assert.equal(typeof expected.fields.title, 'string');
  }
  assert(answers.pages.some(record => Object.values(record.fieldStates).includes('absent')), 'Optional fields have real absence');
  assert(files.some(file => file.entryName.endsWith('.html') && file.getData().includes('legacy-notice-table')), 'Legacy clutter exists in actual artifacts');
  checks.push('Actual 60-page job, exact ZIP/answer inventory, optional absence, private-key isolation and real legacy clutter');
  checks.push('Document base relative option persists in the job, site, private answer key and evaluator metadata');
  checks.push(`WordPress/${builderProfile} controls persist through job, answer key and evaluator metadata; every downloaded page contains the selected builder markup`);

  const [preview] = await Promise.all([
    page.waitForResponse(response => response.url() === `${endpoint}/preview` && response.request().method() === 'POST', { timeout: 45000 }),
    page.getByRole('button', { name: `Preview ${site.name}`, exact: true }).click(),
  ]);
  assert.equal(preview.status(), 200);
  const { url } = await preview.json();
  ownedPreview = { jobId: job.id, siteId: site.id, pid: (await previewRecord(job.id, site.id))?.pid };
  await page.getByRole('link', { name: `Open ${site.name}`, exact: true }).waitFor();
  const fixture = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await fixture.goto(url);
  assert.equal(await fixture.locator('h1').first().textContent(), answers.pages[0].fields.title);
  assert.equal((await fixture.request.get(url + '/assets/collection.png')).status(), 200);
  assert.equal(new URL(await fixture.locator('link[rel=canonical]').getAttribute('href')).origin, new URL(url).origin);
  await fixture.screenshot({ path: `${output}/generated-legacy-site.png`, fullPage: true });
  const detail = answers.pages.find(item => item.kind === 'detail' && !answers.transport.rules.some(rule => rule.path === item.url));
  assert(detail, 'An unaffected detail remains available');
  await fixture.goto(new URL(detail.url, url).href);
  assert.equal(await fixture.locator('h1').first().textContent(), detail.fields.title);
  for (const rule of answers.transport.rules) {
    const response = await fixture.request.get(url + rule.path, { maxRedirects: 0 });
    assert.equal(response.status(), rule.status, rule.type);
  }
  const soft404 = answers.transport.rules.find(rule => rule.type === 'soft-404');
  await fixture.goto(url + soft404.path);
  await fixture.getByRole('heading', { name: 'Page not found', exact: true }).waitFor();
  await fixture.screenshot({ path: `${output}/generated-soft-404.png`, fullPage: true });
  for (const path of ['/private/answer-key.json', '/answer-key.json', '/private/ground-truth.json', '/ground-truth.json', '/private/config.json', '/.fixture-lab/']) assert.equal((await fixture.request.get(new URL(path, url).href)).status(), 404);
  const sitemap = await (await fixture.request.get(new URL('/sitemap.xml', url).href)).text();
  assert.doesNotMatch(sitemap, /example\.test/);
  assert.match(sitemap, new RegExp(new URL(url).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await fixture.close();
  checks.push('Preview serves real HTML/assets/deep paths, rebased canonical/sitemap and private 404s');
  checks.push('All 10 server-response conditions returned their declared status; soft 404 rendered in a real browser');
  await page.getByRole('button', { name: 'Coverage', exact: true }).click();
  await page.getByRole('heading', { name: 'Applied to this website', exact: true }).waitFor();
  await page.getByText('Preview server only / Not in static ZIP', { exact: true }).waitFor();
  assert.equal(await page.getByText('HTTP 429', { exact: true }).count(), 1);
  await audit('desktop-coverage');
  await page.setViewportSize({ width: 390, height: 844 });
  await audit('mobile-coverage');
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('button', { name: 'Websites', exact: true }).click();
  await page.getByRole('button', { name: `Inspect answers for ${site.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Next answers', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next answers', exact: true }).click();
  await page.getByText('26-50 of 60', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Answer pages', { exact: true }).getByRole('button').count(), 25);
  checks.push('One-site 100,000-page form budget and paginated answer navigation');
  await page.getByLabel('Search answer pages').fill('book');
  await page.getByRole('heading', { name: 'Expected fields', exact: true }).waitFor();
  const titleField = page.getByText('title', { exact: true }).first().locator('..').locator('..');
  await titleField.getByText('Source detail').click();
  await titleField.getByText('#content > .page-heading > h1', { exact: true }).waitFor();
  await titleField.getByText('textContent', { exact: true }).waitFor();
  await audit('desktop-answers');
  await page.getByRole('link', { name: 'Answer key JSON', exact: true }).waitFor();
  assert.equal(answers.repeatedItemLocationVersion, 1);
  const listingAnswer = answers.pages.find(record => record.repeatedItems?.length);
  assert(listingAnswer, 'Generated listing records exist');
  await page.getByLabel('Search answer pages').fill(listingAnswer.pageId);
  await page.getByRole('button', { name: `listing ${listingAnswer.url}`, exact: true }).click();
  await page.getByText(`Repeated listing records (${listingAnswer.repeatedItems.length})`, { exact: true }).click();
  const firstItem = listingAnswer.repeatedItems[0];
  const itemFields = page.getByLabel(`Fields for ${firstItem.pageId}`, { exact: true });
  await itemFields.waitFor();
  for (const value of Object.values(firstItem.fields)) assert((await itemFields.textContent()).includes(String(value)));
  await page.getByText('Extraction locations', { exact: true }).first().click();
  const itemLocations = listingAnswer.repeatedItemLocations[0].fieldLocations;
  await page.getByText(itemLocations.title.selector, { exact: true }).waitFor();
  await audit('desktop-listing-locations');
  await page.setViewportSize({ width: 390, height: 844 });
  await audit('mobile-listing-locations');
  checks.push('Source-first repeated-item JSON locations and values visible in desktop/mobile inspector');
  await page.getByRole('button', { name: 'Websites', exact: true }).click();
  await audit('mobile-websites');
  await page.reload();
  await page.getByTestId('generated-site').waitFor();
  assert.equal(await page.getByRole('heading', { name: job.name, exact: true }).count(), 1);
  assert.equal(new URL(page.url()).searchParams.get('job'), job.id);
  checks.push('Persistent saved job, private answer inspection/search and desktop/mobile controls');

  const [repeatedResponse] = await Promise.all([
    page.waitForResponse(response => response.url() === `${base}/api/fixtures` && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Repeat test set', exact: true }).click(),
  ]);
  assert.equal(repeatedResponse.status(), 202);
  const { job: replay } = await repeatedResponse.json();
  ownedJobs.add(replay.id);
  assert.notEqual(replay.id, job.id);
  assert.deepEqual(replay.config, job.config);
  await page.getByTestId('generated-site').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('job'), replay.id);
  const replayEndpoint = `${base}/api/fixtures/${replay.id}/sites/${site.id}`;
  const replayAnswers = await page.request.get(`${replayEndpoint}/answers`);
  assert.equal(replayAnswers.status(), 200);
  assert.deepEqual(await replayAnswers.json(), answers);
  const replayZip = new AdmZip(await (await page.request.get(`${replayEndpoint}/download?kind=public`)).body());
  assert.deepEqual(replayZip.getEntries().map(entry => entry.entryName), files.map(entry => entry.entryName));
  for (const file of files) assert(file.getData().equals(replayZip.getEntry(file.entryName).getData()), `Replay differs: ${file.entryName}`);
  checks.push('Repeat button preserves settings, seed, answer JSON and every public file; selection survives reload');

  const jobUrl = `${base}/api/fixtures/${replay.id}`;
  await page.route(jobUrl, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Saved test set temporarily unavailable.' }) }));
  await page.reload();
  await page.getByRole('heading', { name: 'Test set unavailable', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Loading test set', exact: true }).count(), 0);
  await audit('mobile-load-error');
  await page.unroute(jobUrl);
  await page.getByRole('button', { name: 'Retry test set', exact: true }).click();
  await page.getByTestId('generated-site').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('job'), replay.id);
  checks.push('Saved-job load failure has a visible retry state and recovers without losing the selection');
  assert.deepEqual(errors, []);
  report = { status: 'passed', completedAt: new Date().toISOString(), generatorVersion: answers.generatorVersion,
    cmsProfile: answers.site.cmsProfile, builderProfile, jobId: job.id, replayJobId: replay.id,
    previewUrl: url, pages: 60, noiseEvents: site.noiseEvents, transportConditions: answers.transport.rules.length, checks, browserErrors: errors };
  await writeFile(`${output}/evidence.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  primaryError = error;
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: error.stack, checks, browserErrors: errors }, null, 2)).catch(writeError => console.error('Could not save failure evidence:', writeError));
  throw error;
} finally {
  const cleanupErrors = await cleanupTestArtifacts({ base, request: page.request, jobIds: ownedJobs,
    preview: ownedPreview, downloadedFile: downloadedEvaluator,
    keepArtifacts: process.env.SITEFORGE_KEEP_TEST_ARTIFACTS === '1' });
  try { await browser.close(); }
  catch (error) { cleanupErrors.push(new Error(`Could not close browser: ${error.message}`, { cause: error })); }
  if (cleanupErrors.length) {
    for (const error of cleanupErrors) console.error('Test artifact cleanup:', error);
    await writeFile(`${output}/cleanup-failure.json`, JSON.stringify({ errors: cleanupErrors.map(error => error.message), jobIds: [...ownedJobs] }, null, 2)).catch(error => console.error('Could not save cleanup evidence:', error));
    if (!primaryError) throw new AggregateError(cleanupErrors, 'Test artifact cleanup failed');
  }
}
