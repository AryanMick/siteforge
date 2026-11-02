import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const { chromium } = await import('playwright');
const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4400';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = resolve('outputs/fixture-lab-recovery');
await mkdir(output, { recursive: true });

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const siteId = 'site-1';
const config = {
  name: 'Recovery fixture', siteCount: 1, pagesPerSite: 16, domain: 'library', framework: 'html',
  visualStyle: 'legacy', noise: 'high', challenge: 'standard', seed: 48291, randomness: 50,
  fieldLayout: 'mixed', linkMode: 'root-relative', cmsProfile: 'none', builderProfile: 'none',
  optionalFields: true, scenario: 'legacy-clutter', transport: 'none', previewProtocol: 'http', suite: 'custom',
};
const job = {
  id, name: config.name, status: 'completed', config, createdAt: '2026-10-09T12:00:00.000Z',
  finishedAt: '2026-10-09T12:00:01.000Z', completedSites: 1, totalPages: 16,
  sites: [{ id: siteId, name: 'Recovery library', domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'high', pageCount: 16, seed: 48291, clusters: 2, noiseEvents: 1 }],
};
const otherJob = { ...job, id: otherId, name: 'Other recovery fixture' };
const runningJob = { ...job, status: 'running', finishedAt: undefined, completedSites: 0, sites: [] };
const answerPages = [
  { pageId: 'listing-1', url: '/books/', kind: 'listing', contentType: 'listing', expectedCluster: 'listing-books',
    fields: { title: 'Books' }, canonicalValues: { title: 'Books' }, fieldStates: { title: 'present' }, noiseEvents: [],
    repeatedItems: [{ pageId: 'book-1', url: '/books/one/', fields: { title: 'One', author: 'Ada', summary: 'First book' } }, { pageId: 'book-2', url: '/books/two/', fields: { title: 'Two', author: 'Bea', summary: 'Second book' } }],
  },
  { pageId: 'book-1', url: '/books/one/', kind: 'detail', contentType: 'book', expectedCluster: 'book',
    fields: { title: 'One', summary: 'First book', coverImage: '/assets/one.png' },
    canonicalValues: { title: 'One', author: 'Ada', summary: 'First book', coverImage: '/assets/one.png' },
    fieldSelectors: { coverImage: 'img[data-field="coverImage"]' },
    fieldStates: { title: 'present', author: 'absent', summary: 'present', coverImage: 'present' },
    noiseEvents: [{ type: 'missing-field', severity: 2, preservesSemantics: false }],
  },
  { pageId: 'book-2', url: '/books/two/', kind: 'detail', contentType: 'book', expectedCluster: 'book',
    fields: { title: 'Two', author: 'Bea', summary: 'Second book' },
    canonicalValues: { title: 'Two', author: 'Bea', summary: 'Second book' },
    fieldSelectors: { coverImage: 'img[data-field="coverImage"]' },
    fieldStates: { title: 'present', author: 'present', summary: 'present', coverImage: 'absent' }, noiseEvents: [],
  },
];
function gate() {
  let release;
  const promise = new Promise(resolvePromise => { release = resolvePromise; });
  return { promise, release };
}
async function waitForGate(gated, label) {
  let timeout;
  try {
    await Promise.race([gated.promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label} was not reached`)), 15000); })]);
  } finally {
    clearTimeout(timeout);
  }
}
async function waitForFailure(failures, predicate, label, since = 0) {
  const deadline = Date.now() + 5000;
  const wasAborted = item => predicate(item) && item.error === 'net::ERR_ABORTED';
  while (!failures.slice(since).some(wasAborted) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert(failures.slice(since).some(wasAborted), `${label} was not cancelled by the browser`);
}
const listTimeoutReleased = gate();
const jobTimeoutReleased = gate();
const otherStarted = gate();
const otherReleased = gate();
const otherFinished = gate();
const lateStarted = gate();
const lateReleased = gate();
const lateFinished = gate();
const retryStarted = gate();
const retryReleased = gate();
const timeoutReleased = gate();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30000);
const failures = [];
const failedRequests = [];
page.on('pageerror', error => failures.push(error.message));
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
let listRequests = 0;
let jobRequests = 0;
let answerRequests = 0;
let bookRequests = 0;
let listMode = 'error';
let jobMode = 'running';

try {
  await page.route(`${base}/api/fixtures?summary=1`, async route => {
    listRequests++;
    if (listMode === 'hang') {
      await listTimeoutReleased.promise;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [otherJob], issues: [] }) }).catch(() => {});
    } else if (listMode === 'error') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Saved sets temporarily unavailable.' }) });
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [job, otherJob], issues: [] }) });
  });
  await page.route(`${base}/api/fixtures/${id}`, async route => {
    jobRequests++;
    if (jobMode === 'running') {
      jobMode = 'hang';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: runningJob }) });
    } else if (jobMode === 'hang') {
      await jobTimeoutReleased.promise;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: otherJob }) }).catch(() => {});
    } else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job }) });
  });
  await page.route(`${base}/api/fixtures/${otherId}`, async route => {
    otherStarted.release();
    await otherReleased.promise;
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: otherJob }) }); }
    catch { /* The client may have cancelled this request. */ }
    finally { otherFinished.release(); }
  });
  await page.route(`${base}/api/fixtures/${id}/sites/${siteId}/answers?*`, async route => {
    answerRequests++;
    const params = new URL(route.request().url()).searchParams;
    const query = params.get('q')?.toLowerCase() || '';
    if (query === 'timeout') { await timeoutReleased.promise; await route.abort().catch(() => {}); return; }
    if (query === 'late') {
      lateStarted.release();
      await lateReleased.promise;
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pages: [], pagination: { total: 3, matched: 0, offset: 0, limit: 25 }, schemaDefinitions: {}, coverage: { counts: {}, affectedPages: 0 } }) }); }
      catch { /* The client may have cancelled this request. */ }
      finally { lateFinished.release(); }
      return;
    }
    if (query === 'book') {
      bookRequests++;
      if (bookRequests === 3) { retryStarted.release(); await retryReleased.promise; }
    }
    if (answerRequests === 1 || query === 'book' && bookRequests === 2) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Answer key temporarily unavailable.' }) });
      return;
    }
    const matched = answerPages.filter(item => `${item.url} ${item.contentType}`.includes(query));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      pages: matched, pagination: { total: 3, matched: matched.length, offset: 0, limit: 25 },
      schemaDefinitions: {
        'listing-books': { required: ['title'], optional: [], repeatedItemSchema: [{ name: 'author', type: 'person', optional: false }, { name: 'summary', type: 'text', optional: false }, { name: 'title', type: 'title', optional: false }] },
        book: { required: ['title', 'author', 'summary'], optional: ['coverImage'] },
      },
      transport: { profile: 'none', rules: [] }, coverage: { counts: {}, affectedPages: 0 },
    }) });
  });

  await page.goto(`${base}/?job=${id}`);
  await page.getByRole('heading', { name: 'Test sets unavailable' }).waitFor();
  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: 'Create', exact: true }).click();
  assert(await page.locator('#fixture-settings button[type=submit]').isDisabled());
  assert(await page.getByRole('alert').getByText('Saved sets temporarily unavailable.').isVisible());
  listMode = 'hang';
  const listFailureBaseline = failedRequests.length;
  await page.getByRole('button', { name: 'Retry test sets' }).click();
  await page.locator('#fixture-settings').getByText('The test set list request timed out.', { exact: true }).waitFor();
  await waitForFailure(failedRequests, item => item.url.endsWith('/api/fixtures?summary=1'), 'Hung list request', listFailureBaseline);
  listMode = 'success';
  listTimeoutReleased.release();
  const jobFailureBaseline = failedRequests.length;
  await page.getByRole('button', { name: 'Retry test sets' }).click();
  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: /Saved test sets/ }).click();
  await page.getByRole('heading', { name: config.name }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Test sets unavailable' }).count(), 0);
  await page.getByText('The test set request timed out.', { exact: true }).waitFor();
  await waitForFailure(failedRequests, item => item.url.endsWith(`/api/fixtures/${id}`), 'Hung job poll', jobFailureBaseline);
  assert.equal(await page.getByRole('heading', { name: config.name }).count(), 0);
  jobMode = 'success';
  jobTimeoutReleased.release();
  await page.getByRole('button', { name: 'Retry test set' }).click();
  await page.getByRole('heading', { name: config.name }).waitFor();

  await page.getByText('Saved settings', { exact: true }).click();
  const settings = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Saved settings' }) });
  assert.match(await settings.textContent(), /Legacy markup & clutter/);
  assert.match(await settings.textContent(), /16/);
  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: 'Create', exact: true }).click();
  assert.equal(await page.getByLabel('Site type').inputValue(), 'library');
  await page.getByRole('button', { name: 'Randomize settings' }).click();
  assert.equal(await page.getByLabel('Site type').inputValue(), 'random');
  await page.getByLabel('Site type').selectOption('library');
  assert.equal(await page.getByLabel('Site appearance').inputValue(), 'random');
  await page.getByText('Repeatability', { exact: true }).click();
  assert(await page.getByLabel('New seed every run').isChecked());
  await page.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: /Saved test sets/ }).click();

  await page.getByRole('button', { name: 'Answer keys', exact: true }).click();
  await page.getByRole('button', { name: 'Retry answer key' }).waitFor();
  assert(await page.getByLabel('Search answer pages').isVisible());
  await page.getByRole('button', { name: 'Retry answer key' }).click();
  await page.getByRole('button', { name: 'listing /books/' }).waitFor();
  await page.getByText('Repeated listing records (2)').click();
  assert(await page.getByText('author', { exact: true }).first().isVisible());
  assert(await page.getByText('/books/one/', { exact: true }).first().isVisible());
  assert(await page.getByText('person / Required').isVisible());
  await page.getByRole('button', { name: 'book /books/one/' }).click();
  assert(await page.getByText('Removed from page').isVisible());
  assert(await page.getByText('In generated HTML').first().isVisible());
  await page.getByText('author', { exact: true }).first().locator('..').locator('..').getByText('Source detail').click();
  assert(await page.getByText('Ada', { exact: true }).isVisible());
  await page.getByText('coverImage', { exact: true }).locator('..').locator('..').getByText('Source detail').click();
  assert(await page.getByText('img[data-field="coverImage"]', { exact: true }).isVisible());
  await page.getByRole('button', { name: 'book /books/two/' }).click();
  assert(await page.getByText('Absent at source').isVisible());
  await page.getByText('coverImage', { exact: true }).locator('..').locator('..').getByText('Source detail').click();
  assert(await page.getByText('img[data-field="coverImage"]', { exact: true }).isVisible());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/desktop-answer-details.png`, fullPage: true });

  const firstBookResponse = page.waitForResponse(response => response.url().includes('/answers?') && new URL(response.url()).searchParams.get('q') === 'book');
  await page.getByLabel('Search answer pages').fill('book');
  await firstBookResponse;
  await page.getByRole('button', { name: 'book /books/two/' }).waitFor();
  await page.getByLabel('Search answer pages').fill('late');
  await waitForGate(lateStarted, 'Delayed query');
  await page.getByLabel('Search answer pages').fill('book');
  await page.getByRole('button', { name: 'Retry answer key' }).waitFor();
  lateReleased.release();
  await waitForGate(lateFinished, 'Cancelled query completion');
  assert.equal(await page.getByRole('button', { name: 'book /books/one/' }).count(), 0);
  assert.equal(await page.getByText('Ada', { exact: true }).count(), 0);
  assert(await page.getByLabel('Search answer pages').isVisible());
  assert.equal(await page.getByText('Results unavailable').count(), 1);
  await page.getByRole('button', { name: 'Retry answer key' }).click();
  await waitForGate(retryStarted, 'Answer retry');
  assert.equal(await page.getByRole('button', { name: 'book /books/one/' }).count(), 0);
  assert.equal(await page.getByText('Ada', { exact: true }).count(), 0);
  retryReleased.release();
  await page.getByRole('button', { name: 'book /books/one/' }).waitFor();
  await page.getByLabel('Search answer pages').fill('timeout');
  await page.getByText('The answer key request timed out.', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Retry answer key' }).isVisible());
  timeoutReleased.release();
  await page.getByLabel('Search answer pages').fill('book');
  await page.getByRole('button', { name: 'book /books/one/' }).waitFor();
  const selectionFailureBaseline = failedRequests.length;
  await page.getByRole('button', { name: 'Back to test sets' }).click();
  await page.getByRole('button', { name: /Other recovery fixture/ }).click();
  await waitForGate(otherStarted, 'Other test set request');
  assert.equal(await page.getByRole('heading', { name: config.name }).count(), 0);
  await page.getByRole('button', { name: 'Back to test sets' }).click();
  await page.getByRole('button', { name: /Recovery fixture/ }).first().click();
  await waitForFailure(failedRequests, item => item.url.endsWith(`/api/fixtures/${otherId}`), 'Superseded job request', selectionFailureBaseline);
  otherReleased.release();
  await waitForGate(otherFinished, 'Superseded job completion');
  await page.getByRole('heading', { name: config.name }).waitFor();
  assert.equal(await page.getByRole('heading', { name: otherJob.name }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/mobile-recovered-test-set.png`, fullPage: true });
  assert.deepEqual(failures, []);
  const report = { status: 'passed', apiMode: 'mocked recovery responses; no jobs created', listRequests, jobRequests, answerRequests, cancelledRequests: failedRequests, checks: ['list timeout and cancellation', 'list error retry', 'running job poll timeout and cancellation', 'job retry', 'selection cancellation and stale masking', 'one-shot random settings', 'saved settings', 'answer retry', 'source and listing details', 'stale same-query masking on failure and retry', 'late-response cancellation', 'answer timeout recovery', 'mobile width'] };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  listTimeoutReleased.release(); jobTimeoutReleased.release(); otherReleased.release(); lateReleased.release(); retryReleased.release(); timeoutReleased.release();
  await browser.close();
}
