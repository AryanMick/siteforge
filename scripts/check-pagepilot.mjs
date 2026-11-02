import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchBrowser } from '../src/crawler.mjs';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4400';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('UI checks require a loopback server');
const output = resolve('outputs/pagepilot-browser');
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; const checks = []; const audits = [];
page.on('pageerror', error => errors.push(error.message));
const tab = name => page.getByTestId('stage-tab-' + name);
async function openTab(name) {
  const section = { review: 'overview', validation: 'overview', crawl: 'pages', content: 'pages', cleanup: 'pages', clustering: 'groups', labeling: 'groups', export: 'export' }[name];
  if (!await tab(name).isVisible()) await page.getByTestId('section-' + section).click();
  await tab(name).click();
}
async function snapshot(name, target = page) {
  assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': document overflow');
  await target.screenshot({ path: output + '/' + name + '.png', fullPage: true });
  const audit = await new AxeBuilder({ page: target }).withTags(['wcag2a', 'wcag2aa']).analyze();
  audits.push({ name, violations: audit.violations });
}
async function finish(projectId, runId) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const detail = await (await page.request.get(base + '/api/projects/' + projectId)).json();
    const run = detail.runs.find(run => run.id === runId);
    if (run && run.status !== 'running') {
      await page.locator('[data-run-id="' + runId + '"][data-result-ready="true"]').waitFor();
      await page.getByRole('heading', { name: 'Results', exact: true }).waitFor({ state: 'attached' });
      await page.getByRole('tabpanel').waitFor();
      return run;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Run ' + runId + ' did not finish');
}
async function start(action, endpoint = 'run') {
  const response = page.waitForResponse(response => response.url().endsWith('/' + endpoint) && response.request().method() === 'POST');
  await action();
  const started = await response; assert.equal(started.status(), 202, await started.text());
  const { run } = await started.json();
  return finish(run.projectId, run.id);
}
async function createOrOpen(name, noise = 'clean', profile = 'library') {
  const existing = (await (await page.request.get(base + '/api/projects')).json()).projects.find(project => project.name === name);
  await page.getByTestId('new-project').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('radio', { name: 'Fictional benchmark', exact: true }).check();
  await dialog.getByLabel('Noise', { exact: true }).selectOption(noise);
  await dialog.getByLabel('Profile', { exact: true }).selectOption(profile);
  assert.equal(await dialog.getByLabel('Name', { exact: true }).inputValue(), name);
  await snapshot('desktop-create-' + noise);
  if (existing) {
    await page.keyboard.press('Escape');
    await page.getByTestId('open-project-' + existing.id).click();
  } else {
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  }
  await page.getByRole('heading', { name, exact: true }).waitFor();
}
let failure;
try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  const quickStart = page.getByRole('form', { name: 'Run a website' });
  const countBeforeInvalid = (await (await page.request.get(base + '/api/projects')).json()).projects.length;
  await quickStart.getByRole('textbox', { name: 'Website address' }).fill('javascript:alert(1)');
  await quickStart.getByRole('button', { name: 'Run website', exact: true }).click();
  await quickStart.getByRole('alert').waitFor();
  assert.equal((await (await page.request.get(base + '/api/projects')).json()).projects.length, countBeforeInvalid);
  await snapshot('desktop-url-validation');
  await quickStart.getByRole('textbox', { name: 'Website address' }).fill('books.toscrape.com');
  await quickStart.locator('summary').click();
  await quickStart.getByRole('spinbutton', { name: 'Page limit' }).fill('21');
  assert.equal(await quickStart.getByRole('spinbutton', { name: 'Page limit' }).evaluate(input => input.validity.valid), false);
  await quickStart.locator('summary').click();
  await quickStart.getByRole('button', { name: 'Run website', exact: true }).click();
  await quickStart.getByRole('alert').getByText('Page limit must be a whole number from 1 to 20.', { exact: true }).waitFor({ timeout: 5000 });
  assert(await quickStart.locator('details').evaluate(details => details.open));
  assert(await quickStart.getByRole('spinbutton', { name: 'Page limit' }).evaluate(input => document.activeElement === input));
  assert.equal(await quickStart.getByRole('spinbutton', { name: 'Page limit' }).getAttribute('aria-invalid'), 'true');
  assert.equal(await quickStart.getByRole('textbox', { name: 'Website address' }).getAttribute('aria-invalid'), 'false');
  await snapshot('desktop-hidden-option-validation');
  await quickStart.getByRole('spinbutton', { name: 'Page limit' }).fill('5');
  await quickStart.getByRole('textbox', { name: 'Path scope' }).fill('/catalogue');
  await quickStart.locator('summary').click();
  await quickStart.getByRole('button', { name: 'Run website', exact: true }).click();
  await quickStart.getByRole('alert').getByText('The website address must be inside the path scope.', { exact: true }).waitFor();
  assert(await quickStart.getByRole('textbox', { name: 'Path scope' }).evaluate(input => document.activeElement === input));
  assert.equal((await (await page.request.get(base + '/api/projects')).json()).projects.length, countBeforeInvalid);
  await page.setViewportSize({ width: 390, height: 844 });
  await snapshot('mobile-option-validation');
  await quickStart.getByRole('textbox', { name: 'Path scope' }).fill('/');
  assert.equal(await quickStart.getByRole('alert').count(), 0);
  await snapshot('mobile-url-options');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await quickStart.locator('summary').click();
  checks.push('URL-first form rejects unsafe addresses and mismatched scopes before creation; hidden invalid options reopen with focused, accessible errors on desktop and mobile');
  await createOrOpen('Workflow verification');
  const original = await start(() => page.getByTestId('run-project').click());
  assert.equal(original.status, 'completed');
  assert.equal(original.result.metrics.pages, 24);
  assert.equal(original.result.metrics.coverage, 1);
  assert.equal(original.result.metrics.pairwiseF1, 1);
  assert.equal(await tab('review').getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('button').count(), 4);
  assert.equal(await page.getByRole('tab').count(), 2);
  assert.equal(await page.locator('details[aria-label="Pipeline execution"]').evaluate(details => details.open), false);
  assert.equal(await page.getByText('Scope and limitations', { exact: true }).locator('..').evaluate(details => details.open), false);
  await snapshot('desktop-site-review');
  await openTab('crawl'); await snapshot('desktop-crawl');
  await openTab('clustering');
  await page.getByRole('tabpanel').locator('details summary').first().click();
  assert(await page.getByRole('tabpanel').getByRole('cell', { name: 'text', exact: true }).count() > 0);
  await snapshot('desktop-clusters');
  await openTab('content');
  await page.getByRole('tabpanel').locator('details summary').first().click();
  assert(await page.getByRole('tabpanel').locator('details[open] dd').count() > 0);
  await page.getByRole('tabpanel').locator('details[open]').getByText('HTTP', { exact: true }).waitFor();
  await snapshot('desktop-content');
  checks.push('Real clean generation, crawl, scoring, group evidence, fields, and HTTP capture metadata');

  await openTab('labeling');
  const labelId = original.result.clusters[0].id;
  await page.getByTestId('label-input-' + labelId).fill('Reviewed group');
  await page.getByTestId('save-labels').click();
  await page.getByText('Labels saved to this run.', { exact: true }).waitFor();
  await snapshot('desktop-labels');
  await openTab('export');
  for (const format of ['json', 'csv', 'html']) {
    const download = page.waitForEvent('download');
    await page.getByTestId('export-' + format).click();
    const item = await download;
    await item.saveAs(output + '/ui-export.' + format);
    assert.equal(await item.failure(), null);
    const response = await page.request.get(base + '/api/projects/' + original.projectId + '/runs/' + original.id + '/export?format=' + format);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-disposition'], /attachment/);
    const text = await response.text(); assert.match(text, /Reviewed group/);
    assert(!/canonicalValues|expectedCluster|ground-truth/.test(text));
  }
  const reportPage = await context.newPage();
  reportPage.on('pageerror', error => errors.push(error.message));
  await reportPage.goto(new URL('file://' + output + '/ui-export.html').href);
  await reportPage.getByRole('heading', { name: 'Site Review', exact: true }).waitFor();
  await reportPage.getByRole('cell', { name: 'Reviewed group', exact: true }).waitFor();
  assert.equal(await reportPage.locator('script, iframe, img').count(), 0);
  await snapshot('desktop-client-report', reportPage);
  await reportPage.setViewportSize({ width: 390, height: 844 });
  await snapshot('mobile-client-report', reportPage);
  await reportPage.close();
  await snapshot('desktop-export');
  checks.push('Labels persist through actual JSON/CSV/HTML downloads; the client report renders on desktop/mobile without scripts or private answers');

  await openTab('cleanup');
  await page.getByTestId('cleanup-toggle-0').uncheck();
  const excluded = await start(() => page.getByTestId('apply-cleanup').click(), 'recluster');
  assert.equal(excluded.status, 'attention');
  assert.equal(excluded.result.metrics.coverage, 23 / 24);
  assert.equal(excluded.result.pages.filter(page => page.excluded).length, 1);
  await openTab('cleanup');
  assert.equal(await page.getByTestId('cleanup-toggle-0').isChecked(), false);
  await snapshot('desktop-cleanup');
  await openTab('validation'); await snapshot('desktop-validation-excluded');
  await openTab('cleanup');
  await page.getByRole('button', { name: 'Restore all', exact: true }).click();
  const restored = await start(() => page.getByTestId('apply-cleanup').click(), 'recluster');
  assert.equal(restored.result.metrics.coverage, 1);
  assert.equal(restored.snapshotRunId, original.id);
  await openTab('clustering');
  await page.getByTestId('threshold-input').fill('0.61');
  const regrouped = await start(() => page.getByTestId('recluster-button').click(), 'recluster');
  assert.equal(regrouped.result.rules.threshold, 0.61);
  assert.equal(await page.getByTestId('threshold-input').inputValue(), '0.61');
  assert.equal(regrouped.stages.find(stage => stage.id === 'crawl').status, 'skipped');
  checks.push('Cleanup retains exclusions after completion, reduces coverage, restores pages, and preserves edited merge distance');

  await page.getByRole('combobox', { name: 'Run', exact: true }).selectOption(original.id);
  await openTab('labeling');
  assert.equal(await page.getByTestId('label-input-' + labelId).inputValue(), 'Reviewed group');
  await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('Seed', { exact: true }).fill('48292');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  await openTab('crawl');
  assert((await page.getByRole('tabpanel').locator('dl').first().innerText()).includes('48291'));
  await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  assert.equal(await settings.getByLabel('Seed', { exact: true }).inputValue(), '48292');
  await settings.getByLabel('Seed', { exact: true }).fill('48291');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  checks.push('History retains original labels and provenance; settings persist without rewriting old results');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const stage of ['review', 'crawl', 'cleanup', 'clustering', 'labeling', 'content', 'validation', 'export']) {
    await openTab(stage);
    if (['clustering', 'content'].includes(stage)) await page.getByRole('tabpanel').locator('details summary').first().click();
    await snapshot('mobile-' + stage);
  }
  await openTab('crawl');
  await tab('crawl').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await tab('content').getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('Workflow verification');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByRole('group', { name: 'Project source', exact: true }).getByRole('button', { name: /^Websites/ }).click();
  await page.getByText('No projects match these filters.', { exact: true }).waitFor();
  await page.getByRole('group', { name: 'Project source', exact: true }).getByRole('button', { name: /^Benchmarks/ }).click();
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByRole('group', { name: 'Project source', exact: true }).getByRole('button', { name: /^All projects/ }).click();
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('failed');
  await page.getByText('No projects match these filters.', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('all');
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('');
  await snapshot('mobile-projects');
  await page.getByTestId('new-project').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Public URL', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'Public URL', exact: true }).fill('http://127.0.0.1:4200/');
  await dialog.getByLabel('Name', { exact: true }).fill('Forbidden local crawl');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').textContent(), /Local URLs/);
  await snapshot('mobile-public-validation');
  await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
  checks.push('Eight mobile stages, keyboard navigation, filters, dialog focus, and private URL rejection');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await createOrOpen('Archive noise check', 'high', 'archive');
  const noisy = await start(() => page.getByTestId('run-project').click());
  assert.equal(noisy.status, 'attention');
  await openTab('review');
  const findings = page.getByRole('region', { name: 'Prioritized findings', exact: true });
  await findings.getByRole('combobox', { name: 'Finding priority' }).selectOption('low');
  assert(await findings.locator('details').count() > 0);
  await findings.getByRole('searchbox', { name: 'Search findings' }).fill('unmatched-finding-8675309');
  await findings.getByText('No findings match these filters.', { exact: true }).waitFor();
  await findings.getByRole('searchbox', { name: 'Search findings' }).fill('');
  await findings.getByRole('combobox', { name: 'Finding priority' }).selectOption('all');
  await findings.getByText('Known-answer benchmark did not pass', { exact: true }).waitFor();
  await findings.getByTestId('finding-duplicate-id').locator('summary').click();
  assert(await findings.getByTestId('finding-duplicate-id').locator('code').count() > 0);
  await snapshot('desktop-legacy-findings');
  await page.setViewportSize({ width: 390, height: 844 });
  await snapshot('mobile-legacy-findings');
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('Legacy findings have working priority/search filters, expandable affected URLs, and responsive client review');
  await openTab('validation');
  await page.getByText(noisy.result.evaluation.reason, { exact: true }).waitFor();
  await snapshot('desktop-noisy-validation');
  checks.push('High-noise benchmark visibly reports real accuracy failures instead of false success');

  // UI-only failure fixtures; crawler transport and persistence have separate real-code tests.
  for (const [index, scenario] of [
    { code: 'CERT_HAS_EXPIRED', title: 'Website certificate is not trusted', action: 'Edit settings' },
    { code: 'cross_origin', title: 'The website uses another address', action: 'Review address' },
  ].entries()) {
    const recoveryPage = await context.newPage();
    recoveryPage.on('pageerror', error => errors.push(error.message));
    const id = `00000000-0000-4000-8000-00000000000${index}`;
    const address = 'https://archive.example/records';
    const project = { id, name: 'Legacy recovery fixture', mode: 'public', profile: 'library', noise: 'clean', pageCount: 24, seed: 48291, url: address, pathPrefix: '/records', maxPages: 5, threshold: 0.32, status: 'failed', createdAt: original.startedAt, updatedAt: original.startedAt, latestRunId: original.id, metrics: { pages: 0, clusters: 0, fields: 0 } };
    const failedRun = structuredClone(original);
    failedRun.projectId = id; failedRun.status = 'failed';
    failedRun.result = { ...failedRun.result, metrics: { pages: 0, clusters: 0, fields: 0, coverage: null, pairwiseF1: null, fieldValueF1: null }, pages: [], clusters: [], issues: [], warnings: [], labels: {}, outcomes: [{ url: address, state: 'unattempted', reason: 'robots_unavailable' }], crawl: { analyzed: 0, discovered: 1, counts: { failed: 0, unattempted: 1 }, stopReason: 'robots_unavailable', allEligibleAnalyzed: false, frontierExhausted: false }, evaluation: { status: 'not_available', reason: 'No answer key', thresholds: null }, provenance: { ...failedRun.result.provenance, synthetic: false, sourceUrl: address }, diagnostics: { requestedUrl: address, effectiveUrl: address, robots: { url: 'https://archive.example/robots.txt', status: 'unavailable', code: scenario.code, reason: scenario.code, redirects: scenario.code === 'cross_origin' ? [{ from: 'https://archive.example/robots.txt', to: 'https://www.archive.example/robots.txt', status: 301 }] : [] } } };
    let saves = 0;
    await recoveryPage.route(/\/api\/projects(?:\/|$)/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/projects' && route.request().method() === 'GET') return route.fulfill({ json: { projects: [project] } });
      if (path === '/api/projects/' + id) {
        if (route.request().method() === 'PATCH') { Object.assign(project, route.request().postDataJSON()); saves++; return route.fulfill({ json: { project } }); }
        if (route.request().method() === 'GET') return route.fulfill({ json: { project, runs: [failedRun] } });
      }
      errors.push('Unexpected recovery-fixture request: ' + route.request().method() + ' ' + path);
      await route.abort();
    });
    await recoveryPage.goto(base);
    await recoveryPage.getByTestId('open-project-' + id).click();
    const recovery = recoveryPage.getByRole('region', { name: 'Crawl recovery' });
    await recovery.getByRole('heading', { name: scenario.title, exact: true }).waitFor();
    await recovery.getByText('Technical details', { exact: true }).click();
    await recovery.getByText(scenario.code + ': ' + scenario.code, { exact: true }).waitFor();
    await snapshot('desktop-recovery-' + scenario.code, recoveryPage);
    await recoveryPage.setViewportSize({ width: 390, height: 844 });
    await snapshot('mobile-recovery-' + scenario.code, recoveryPage);
    await recovery.getByRole('button', { name: scenario.action, exact: true }).click();
    const settings = recoveryPage.getByRole('dialog');
    const expected = scenario.code === 'cross_origin' ? 'https://www.archive.example/records' : address;
    assert.equal(await settings.getByRole('textbox', { name: 'Public URL', exact: true }).inputValue(), expected);
    await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(saves, 0);
    assert.equal(project.url, address);
    await recovery.getByRole('button', { name: scenario.action, exact: true }).click();
    await recoveryPage.getByRole('dialog').getByRole('button', { name: 'Save settings', exact: true }).click();
    await recoveryPage.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(saves, 1);
    assert.equal(project.url, expected);
    assert.equal(failedRun.result.provenance.sourceUrl, address);
    await recoveryPage.close();
  }
  checks.push('Deterministic recovery UI fixtures: certificate and canonical-host failures, desktop/mobile accessibility, cancel-before-save, reviewed URL persistence, and unchanged captured source');
  assert.equal((await page.request.post(base + '/api/projects', { headers: { Origin: 'https://external.example' }, data: { name: 'Forbidden' } })).status(), 403);
  assert.equal((await page.request.get(base + '/api/projects/invalid')).status(), 400);
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  for (const [index, target] of context.pages().entries()) await target.screenshot({ path: `${output}/failure-${index}.png`, fullPage: true }).catch(() => {});
}
finally {
  const violations = audits.flatMap(audit => audit.violations.map(violation => ({ view: audit.name, id: violation.id, nodes: violation.nodes.map(node => node.target) })));
  await writeFile(output + '/results.json', JSON.stringify({ status: failure || violations.length ? 'failed' : 'passed', checks, errors, audits, violations, failure: failure?.stack }, null, 2));
  await browser.close();
  if (failure) throw failure;
  assert.deepEqual(violations, [], 'Accessibility violations; see outputs/pagepilot-browser/results.json');
  console.log('PASS: ' + checks.length + ' workflow groups, ' + audits.length + ' desktop/mobile accessibility checks. Evidence: ' + output);
}
