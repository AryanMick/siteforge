import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const { chromium } = await import('playwright');
const base = process.env.WORKBENCH_URL || 'http://127.0.0.1:4400';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Workbench check only supports loopback');
const output = resolve('outputs/workbench-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
async function noOverflow(label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(dimensions.content <= dimensions.width, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  checks.push(`${label}: no document overflow`);
}
try {
  await page.goto(`${base}/test-lab`);
  await page.getByRole('heading', { name: 'Behavior specifications', exact: true }).waitFor();
  await noOverflow('Desktop specifications');
  await page.screenshot({ path: `${output}/desktop-specifications.png`, fullPage: true });
  await page.getByLabel('Specification status').selectOption('planned');
  assert.equal(await page.locator('.feature-row').count(), 7);
  await page.getByLabel('Search specifications').fill('Private construction');
  assert.equal(await page.locator('.feature-row').count(), 1);
  await page.getByLabel('Search specifications').fill('');
  await page.getByLabel('Specification status').selectOption('automated');
  const catalog = await (await page.request.get(`${base}/api/workbench`)).json();
  assert.equal(await page.locator('.feature-row').count(), catalog.features.filter(feature => !feature.planned).length);
  assert(catalog.features.some(feature => feature.file.endsWith('html-robustness.feature') && !feature.planned));
  checks.push('Specification filters and search use parsed feature files');

  await page.getByRole('button', { name: 'Book structure', exact: true }).click();
  await page.getByText('Matches book reference structure', { exact: true }).waitFor();
  const cover = page.locator('.book-cover');
  assert.equal(await cover.evaluate(image => image.complete && image.naturalWidth > 0), true);
  await page.getByLabel('Cover image', { exact: true }).uncheck();
  await page.locator('tr').filter({ hasText: 'coverImage' }).getByText('absent', { exact: true }).waitFor();
  await page.getByText('Matches book reference structure', { exact: true }).waitFor();
  for (const layout of ['wrapped', 'table', 'clean']) {
    await page.getByLabel('HTML layout').selectOption(layout);
    await page.getByText('Matches book reference structure', { exact: true }).waitFor();
  }
  await page.getByLabel('Cover image', { exact: true }).check();
  await page.screenshot({ path: `${output}/desktop-structure.png`, fullPage: true });
  checks.push('Optional cover and all three markup layouts preserve reference conformance');

  const finished = page.waitForResponse(response => response.url() === `${base}/api/runs` && response.request().method() === 'POST', { timeout: 100000 });
  await page.getByRole('button', { name: 'Run behaviors', exact: true }).click();
  const response = await finished;
  assert.equal(response.status(), 200);
  const run = await response.json();
  assert.equal(run.status, 'passed', JSON.stringify(run));
  assert.ok(run.behavior.scenarios >= 36);
  assert.equal(run.behavior.failed, 0);
  await page.getByRole('heading', { name: 'Behavior results', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/desktop-results.png`, fullPage: true });
  checks.push(`UI executed ${run.behavior.scenarios} passing Cucumber scenarios`);

  const invalid = await page.request.post(`${base}/api/runs`, { headers: { Origin: base }, data: { kind: 'shell', command: 'anything' } });
  assert.equal(invalid.status(), 400);
  const crossOrigin = await page.request.post(`${base}/api/runs`, { headers: { Origin: 'https://external.example' }, data: { kind: 'bdd' } });
  assert.equal(crossOrigin.status(), 403);
  const absent = await page.request.get(`${base}/api/runs/not-a-run`);
  assert.equal(absent.status(), 404);
  checks.push('API rejects arbitrary commands, cross-origin execution and invalid run IDs');

  let mutation;
  if (process.env.CHECK_MUTATIONS === '1') {
    const completed = page.waitForResponse(item => item.url() === `${base}/api/runs` && item.request().method() === 'POST' && item.status() === 200, { timeout: 260000 });
    await page.getByRole('button', { name: 'Run mutations', exact: true }).click();
    let started = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const snapshot = await (await page.request.get(`${base}/api/workbench`)).json();
      if (snapshot.runs.some(item => item.kind === 'mutation' && item.status === 'running')) { started = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(started, true);
    const concurrent = await page.request.post(`${base}/api/runs`, { headers: { Origin: base }, data: { kind: 'bdd' } });
    assert.equal(concurrent.status(), 409);
    mutation = await (await completed).json();
    assert.equal(mutation.status, 'passed', JSON.stringify(mutation));
    assert.equal(mutation.mutation.runtimeErrors, 0);
    assert.equal(mutation.mutation.pending, 0);
    assert.ok(mutation.mutation.score >= 75);
    await page.getByRole('heading', { name: 'Mutation results', exact: true }).waitFor();
    await page.screenshot({ path: `${output}/desktop-mutations.png`, fullPage: true });
    checks.push(`UI mutation run: ${mutation.mutation.killed}/${mutation.mutation.total} killed; concurrent launch rejected`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow('Mobile results');
  await page.getByRole('button', { name: 'Book structure', exact: true }).click();
  await noOverflow('Mobile structure');
  await page.screenshot({ path: `${output}/mobile-structure.png`, fullPage: true });
  await page.getByRole('button', { name: 'Specifications', exact: false }).click();
  await noOverflow('Mobile specifications');
  await page.screenshot({ path: `${output}/mobile-specifications.png`, fullPage: true });
  assert.deepEqual(errors, []);
  const result = { status: 'passed', runId: run.id, scenarios: run.behavior.scenarios, mutationRunId: mutation?.id, mutation: mutation?.mutation, checks, browserErrors: errors };
  await writeFile(`${output}/verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
