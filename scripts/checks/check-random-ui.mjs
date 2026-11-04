import assert from 'node:assert/strict';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const base = process.env.PAGEPILOT_URL || process.env.SITEFORGE_URL || 'http://127.0.0.1:4400';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = resolve('outputs/random-ui-browser');
const keepArtifacts = process.env.SITEFORGE_KEEP_TEST_ARTIFACTS === '1';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
const checks = [];
const createdJobs = new Set();
const downloadedFiles = new Set();
page.on('pageerror', error => errors.push(error.message));

async function audit(name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: document overflow`);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${name}: accessibility`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  checks.push(`${name}: no document overflow or detected A/AA violations`);
}

async function completed(id) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const response = await page.request.get(`${base}/api/fixtures/${id}`);
    assert.equal(response.status(), 200);
    const { job } = await response.json();
    if (job.status !== 'running') { assert.equal(job.status, 'completed', job.error); return job; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Generation timed out: ${id}`);
}

async function createFromForm(expectedPayload) {
  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: 'Create', exact: true }).click();
  const button = page.getByRole('button', { name: 'Generate test set', exact: true });
  await button.waitFor();
  await page.waitForFunction(() => {
    const submit = document.querySelector('#fixture-settings button[type=submit]');
    return submit && !submit.disabled;
  });
  const pending = page.waitForResponse(response => response.url() === `${base}/api/fixtures` && response.request().method() === 'POST');
  await button.click();
  const response = await pending;
  const body = await response.json();
  if (body?.job?.id) createdJobs.add(body.job.id);
  assert.equal(response.status(), 202, JSON.stringify(body));
  expectedPayload(response.request().postDataJSON());
  const { job: initial } = body;
  const job = await completed(initial.id);
  await page.getByRole('heading', { name: job.name, exact: true }).waitFor();
  await page.getByTestId('generated-site').waitFor();
  return job;
}

async function createViaRandomApi(input) {
  const response = await page.request.post(`${base}/api/fixtures/random`, { headers: { Origin: new URL(base).origin }, data: input });
  const body = await response.json();
  if (body?.job?.id) createdJobs.add(body.job.id);
  assert.equal(response.status(), 202, JSON.stringify(body));
  const { job: initial } = body;
  return completed(initial.id);
}

async function downloadAnswers(job) {
  const site = job.sites[0];
  const event = page.waitForEvent('download');
  await page.getByRole('link', { name: `Download answer key JSON for ${site.name}`, exact: true }).click();
  const download = await event;
  assert.match(download.suggestedFilename(), /answer-key\.json$/);
  const path = `${output}/${job.id}-answers.json`;
  downloadedFiles.add(path);
  await download.saveAs(path);
  const truth = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(truth.pages.length, site.pageCount);
  return truth;
}

async function apiAnswers(job) {
  const site = job.sites[0];
  const response = await page.request.get(`${base}/api/fixtures/${job.id}/sites/${site.id}/download?kind=answers`);
  assert.equal(response.status(), 200);
  assert.match(response.headers()['content-disposition'], /attachment/);
  const truth = await response.json();
  assert.equal(truth.pages.length, site.pageCount);
  return truth;
}

async function deleteCreatedJob(id) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const response = await page.request.delete(`${base}/api/fixtures/${id}`, { headers: { Origin: new URL(base).origin } });
    if (response.status() === 200 || response.status() === 404) return;
    if (response.status() !== 409) throw new Error(`Cleanup DELETE ${id}: HTTP ${response.status()} ${await response.text()}`);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`Cleanup DELETE ${id}: generation remained active`);
}

let runError;
try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Test sets', exact: true }).waitFor();
  assert(await page.locator('#fixture-settings').isVisible());
  await page.waitForFunction(() => {
    const submit = document.querySelector('#fixture-settings button[type=submit]');
    return submit && !submit.disabled;
  });
  assert.equal(await page.getByLabel('Preview protocol', { exact: true }).count(), 0);
  await page.getByText('Noise & scenarios', { exact: true }).click();
  await page.getByText('Repeatability', { exact: true }).click();
  const fresh = page.getByLabel('New seed every run');
  const pages = page.getByLabel('Pages per site', { exact: true });
  const siteCount = page.getByLabel('Websites', { exact: true });
  const randomness = page.getByRole('slider', { name: 'Randomness factor' });
  const generate = page.getByRole('button', { name: 'Generate test set', exact: true });
  assert(await fresh.isChecked());
  assert(await page.getByLabel('Seed', { exact: true }).isDisabled());
  assert.equal(await randomness.inputValue(), '50');
  await pages.fill('4');
  assert(await generate.isDisabled());
  await pages.fill('201');
  assert(await generate.isEnabled());
  await pages.fill('100001');
  assert(await generate.isDisabled());
  await pages.fill('0');
  assert(await generate.isDisabled(), 'The form requires 5-100,000 pages; random counts use the checkbox (the API still accepts 0)');
  await siteCount.fill('500');
  await pages.fill('200');
  assert(await generate.isEnabled(), '500 x 200 remains within the 100,000-page aggregate limit');
  await pages.fill('201');
  assert(await generate.isDisabled(), '500 x 201 exceeds the aggregate limit');
  await siteCount.fill('1');
  await pages.fill('5');
  await randomness.focus(); await randomness.press('Home');
  assert.equal(await randomness.inputValue(), '0');
  assert.equal(await page.locator('output[for="randomness-range"]').textContent(), '0%');
  await audit('desktop-controls');
  await page.setViewportSize({ width: 390, height: 844 });
  await audit('mobile-controls');
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('Page count 0 or 5-100,000, 100,000-page aggregate guard, and 0-100 randomness factor');

  const normal = await createFromForm(payload => {
    assert.equal(payload.pagesPerSite, 5);
    assert.equal(payload.randomness, 0);
    assert.equal(payload.freshSeed, true);
    assert.equal(payload.previewProtocol, 'http');
  });
  assert.equal(normal.sites[0].pageCount, 5);
  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: 'Create', exact: true }).click();
  assert.equal(await page.getByLabel('Seed', { exact: true }).inputValue(), String(normal.config.seed));
  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: /Saved test sets/ }).click();
  await downloadAnswers(normal);
  checks.push('Form generation requests a fresh seed, shows the returned seed, and downloads private JSON');

  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Randomize settings' }).click();
  assert.equal(await page.getByLabel('Site type').inputValue(), 'random');
  // Randomize turns on random page counts; the pages field becomes a maximum.
  assert.equal(await page.getByLabel('Max pages per site', { exact: true }).inputValue(), '100000');
  await page.getByLabel(/^Random page count per site/).uncheck();
  await pages.fill('5');
  await randomness.focus(); await randomness.press('End');
  await page.getByLabel('Challenge level').selectOption('hard');
  const randomizedForm = await createFromForm(payload => {
    assert.equal(payload.domain, 'random');
    assert.equal(payload.pagesPerSite, 5);
    assert.equal(payload.randomness, 100);
    assert.equal(payload.challenge, 'hard');
    assert.equal(payload.previewProtocol, 'http');
  });
  assert.equal(randomizedForm.sites[0].pageCount, 5);
  await downloadAnswers(randomizedForm);
  checks.push('Randomize settings feeds the single Generate command and preserves HTTP baseline');

  // The dedicated random API remains supported even though the UI shortcut was removed.
  const randomInput = { pagesPerSite: 5, randomness: 100, framework: 'html', previewProtocol: 'http', challenge: 'hard' };
  const randomA = await createViaRandomApi(randomInput);
  const answerA = await apiAnswers(randomA);
  const randomB = await createViaRandomApi(randomInput);
  const answerB = await apiAnswers(randomB);
  assert.notEqual(randomA.config.seed, randomB.config.seed);
  assert.notDeepEqual(answerA.pages.map(record => record.canonicalValues), answerB.pages.map(record => record.canonicalValues));
  checks.push('Random API compatibility: fresh runs have distinct seeds and canonical values');

  const replayA = await createViaRandomApi({ ...randomInput, seed: 0 });
  const truthA = await apiAnswers(replayA);
  const replayB = await createViaRandomApi({ ...randomInput, seed: 0 });
  const truthB = await apiAnswers(replayB);
  assert.equal(replayA.config.seed, 0);
  assert.equal(replayB.config.seed, 0);
  assert.deepEqual(truthA, truthB);
  checks.push('Random API compatibility: seed 0 replays identical private answers');

  const variable = await createViaRandomApi({ ...randomInput, pagesPerSite: 0, randomness: 0 });
  assert(variable.sites[0].pageCount >= 5 && variable.sites[0].pageCount <= 200);
  await apiAnswers(variable);
  checks.push('Random API compatibility: page count 0 resolves to 5-200 real pages');

  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForFunction(() => {
    const submit = document.querySelector('#fixture-settings button[type=submit]');
    return submit && !submit.disabled;
  });
  await fresh.uncheck();
  const seed = page.getByLabel('Seed', { exact: true });
  assert(await seed.isEnabled());
  await seed.fill('0');
  assert(await generate.isEnabled());
  await seed.fill('-1');
  assert(await generate.isDisabled());
  await fresh.check();
  assert(await seed.isDisabled());
  assert.equal(await seed.inputValue(), '48291');
  await pages.fill('200');
  await randomness.focus(); await randomness.press('Home');
  await page.getByRole('button', { name: 'Clean', exact: true }).click();
  await page.getByLabel('Obstacle scenario').selectOption('baseline');
  const large = await createFromForm(payload => {
    assert.equal(payload.pagesPerSite, 200);
    assert.equal(payload.randomness, 0);
    assert.equal(payload.freshSeed, true);
    assert.equal(payload.noise, 'clean');
    assert.equal(payload.scenario, 'baseline');
  });
  assert.equal(large.sites[0].pageCount, 200);
  const largeTruth = await downloadAnswers(large);
  assert(largeTruth.pages.every(record => record.noiseEvents.length === 0));
  const site = large.sites[0];
  const zipResponse = await page.request.get(`${base}/api/fixtures/${large.id}/sites/${site.id}/download?kind=public`);
  assert.equal(zipResponse.status(), 200);
  const zip = new AdmZip(await zipResponse.body());
  const entries = zip.getEntries();
  assert.equal(entries.filter(item => item.entryName.endsWith('.html')).length, 200);
  for (const entry of entries) {
    assert.doesNotMatch(entry.entryName, /(?:^|\/)(?:private|answer-key\.json|ground-truth\.json)/);
    if (/\.(?:html|js|json|txt)$/.test(entry.entryName)) assert.doesNotMatch(entry.getData().toString(), /canonicalValues|fieldLocations|expectedCluster/);
  }
  await audit('desktop-200-pages');
  await page.setViewportSize({ width: 390, height: 844 });
  await audit('mobile-200-pages');
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('200-page boundary, private JSON and public ZIP isolation, mobile and desktop layout');

  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: 'Create', exact: true }).click();
  await pages.fill('12');
  await page.getByLabel('Challenge level').selectOption('extreme');
  await page.getByRole('button', { name: 'High', exact: true }).click();
  const extreme = await createFromForm(payload => {
    assert.equal(payload.pagesPerSite, 12);
    assert.equal(payload.challenge, 'extreme');
    assert.equal(payload.noise, 'high');
  });
  const extremeTruth = await downloadAnswers(extreme);
  assert(extremeTruth.pages.some(record => record.noiseEvents.length >= 3));
  await audit('desktop-extreme-challenge');
  await page.setViewportSize({ width: 390, height: 844 });
  await audit('mobile-extreme-challenge');
  checks.push('Extreme challenge creates multiple real defects and downloadable private answers');
  assert.deepEqual(errors, []);
  const evidence = { status: 'passed', checks, jobsCreated: [...createdJobs], retained: keepArtifacts, errors };
  await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  runError = error;
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: error.stack, checks, errors, jobsCreated: [...createdJobs] }, null, 2));
  throw error;
} finally {
  const cleanupErrors = [];
  if (!keepArtifacts) {
    for (const id of createdJobs) {
      try { await deleteCreatedJob(id); }
      catch (error) { cleanupErrors.push(error); }
    }
    for (const path of downloadedFiles) {
      try { await unlink(path); }
      catch (error) { if (error.code !== 'ENOENT') cleanupErrors.push(error); }
    }
  }
  await browser.close();
  if (cleanupErrors.length) {
    const message = cleanupErrors.map(error => error.message).join('; ');
    if (runError) console.error(`Cleanup failed after test error: ${message}`);
    else throw new Error(`Cleanup failed: ${message}`);
  }
}
