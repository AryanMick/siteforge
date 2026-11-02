import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchBrowser } from '../src/crawler.mjs';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4400';
const sample = process.env.PAGEPILOT_PUBLIC_SAMPLE || 'demo';
if (!['demo', 'legacy'].includes(sample)) throw new Error('Public sample must be demo or legacy.');
const targets = sample === 'legacy'
  ? [{ host: 'info.cern.ch', address: 'http://info.cern.ch/hypertext/WWW/TheProject.html' }]
  : ['books.toscrape.com', 'quotes.toscrape.com'].map(host => ({ host, address: host }));
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('A loopback PagePilot server is required.');
const output = resolve('outputs/public-site-browser', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const report = { status: 'running', checks: [], browserErrors: [], limitations: ['Live HTTP samples are observations, not controlled accuracy tests.', 'Three pages per site; robots, network, and site changes can prevent a successful run.'] };
page.on('pageerror', error => report.browserErrors.push(error.message));

try {
  for (const { host, address } of targets) {
    await page.goto(base);
    const form = page.getByRole('form', { name: 'Run a website' });
    await form.getByRole('textbox', { name: 'Website address' }).fill(address);
    await form.locator('summary').click();
    await form.getByRole('spinbutton', { name: 'Page limit' }).fill('3');
    const started = page.waitForResponse(response => /\/api\/projects\/[^/]+\/run$/.test(response.url()) && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Run website', exact: true }).click();
    const response = await started;
    assert.equal(response.status(), 202, await response.text());
    const { run } = await response.json();
    let saved;
    const deadline = Date.now() + 110000;
    while (Date.now() < deadline) {
      const detail = await (await page.request.get(`${base}/api/projects/${run.projectId}`)).json();
      saved = detail.runs.find(item => item.id === run.id);
      if (saved && saved.status !== 'running') break;
      await new Promise(accept => setTimeout(accept, 300));
    }
    await writeFile(`${output}/${host}.json`, JSON.stringify(saved, null, 2));
    assert(saved?.result, `${host}: ${saved?.error || 'no result'}`);
    const result = saved.result;
    assert(result.metrics.pages > 0 && result.metrics.pages <= 3, `${host}: ${JSON.stringify(result.crawl)}`);
    assert.equal(result.provenance.synthetic, false);
    assert.equal(result.provenance.sourceUrl, new URL(address.includes('://') ? address : `https://${address}`).href);
    assert.equal(result.evaluation.status, 'not_available');
    assert.equal(result.metrics.coverage, null);
    assert.equal(result.metrics.pairwiseF1, null);
    assert.equal(result.metrics.fieldValueF1, null);
    assert(result.pages.every(item => new URL(item.url).hostname === host && item.fetch.status === 200));
    assert(result.clusters.length > 0);
    await page.locator(`[data-run-id="${run.id}"][data-result-ready="true"]`).waitFor();
    await page.getByTestId('stage-tab-review').click();
    await page.getByRole('heading', { name: 'Site review', exact: true }).waitFor();
    await page.screenshot({ path: `${output}/${host}-review.png`, fullPage: true });
    const download = page.waitForEvent('download');
    await page.getByTestId('review-download').click();
    const artifact = await download;
    await artifact.saveAs(`${output}/${host}-client-report.html`);
    assert.equal(await artifact.failure(), null);
    await page.getByTestId('section-pages').click();
    await page.getByTestId('stage-tab-content').click();
    await page.getByRole('tabpanel').locator('details summary').first().click();
    assert.equal(await page.getByRole('heading', { name: host, exact: true }).count(), 1);
    await page.screenshot({ path: `${output}/${host}-content.png`, fullPage: true });
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    assert.deepEqual(audit.violations.map(item => item.id), []);
    report.checks.push({ host, runId: run.id, projectId: run.projectId, status: saved.status, pages: result.metrics.pages, groups: result.metrics.clusters, fields: result.metrics.fields, crawlCounts: result.crawl.counts, stopReason: result.crawl.stopReason, accuracy: 'not_available' });
    console.log(`${host}: ${result.metrics.pages} pages, ${result.metrics.clusters} groups, ${saved.status}`);
  }
  assert.deepEqual(report.browserErrors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack; throw error;
} finally {
  await writeFile(`${output}/evidence.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`Public-site evidence: ${output}`);
}
