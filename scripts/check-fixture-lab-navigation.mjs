import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.PAGEPILOT_URL || process.env.SITEFORGE_URL || 'http://127.0.0.1:4400';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = process.env.SITEFORGE_SCREENSHOTS || resolve('outputs/fixture-lab-navigation');
await mkdir(output, { recursive: true });

const id = '22222222-2222-4222-8222-222222222222';
const config = {
  name: 'Saved library set', siteCount: 1, pagesPerSite: 5, domain: 'library', framework: 'html',
  visualStyle: 'legacy', noise: 'low', challenge: 'standard', seed: 48291, randomness: 50,
  fieldLayout: 'mixed', linkMode: 'root-relative', cmsProfile: 'none', builderProfile: 'none',
  optionalFields: true, scenario: 'baseline', transport: 'none', previewProtocol: 'http',
};
const site = { id: 'site-1', name: 'Saved library', domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'low', pageCount: 5, seed: 48291, clusters: 1, noiseEvents: 0 };
const savedJob = { id, name: config.name, status: 'completed', config, createdAt: '2026-10-09T12:00:00.000Z', completedSites: 1, totalPages: 5, sites: [site] };
const answer = {
  pages: [{ pageId: 'book-1', url: '/books/one/', kind: 'detail', contentType: 'book', expectedCluster: 'book', fields: { title: 'One' }, canonicalValues: { title: 'One' }, fieldStates: { title: 'present' }, noiseEvents: [] }],
  schemaDefinitions: { book: { required: ['title'], optional: [] } },
  pagination: { total: 1, matched: 1, offset: 0, limit: 25 }, coverage: { counts: {}, affectedPages: 0 },
};
const browser = await chromium.launch({ headless: true });
const errors = [];

async function capture(page, filename) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, filename), fullPage: true });
}

async function noOverflow(page, width) {
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert(dimensions.document <= dimensions.viewport, `${width}px horizontal overflow: ${JSON.stringify(dimensions)}`);
}

async function headingInViewport(page, selector) {
  await page.waitForFunction(selector => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return box && box.bottom > 0 && box.top < window.innerHeight;
  }, selector);
}

async function checkInputErrors(page, width) {
  const setup = page.locator('#fixture-settings');
  const nav = page.getByRole('group', { name: 'Workspace views' });
  await nav.getByRole('button', { name: 'Create', exact: true }).click();
  const conditions = setup.locator('details').filter({ has: page.locator('summary', { hasText: 'Repeatability' }) });
  if (await conditions.getAttribute('open') === null) await conditions.locator('summary').click();
  await setup.getByLabel('New seed every run').uncheck();
  const submit = setup.getByRole('button', { name: 'Generate test set', exact: true });
  for (const [name, invalid, restored, errorId] of [
    ['Name', '   ', 'Draft settings survive', 'fixture-name-error'],
    ['Websites', '0', '1', 'fixture-count-error'],
    ['Websites', '501', '1', 'fixture-count-error'],
    ['Websites', '1.5', '1', 'fixture-count-error'],
    ['Pages per site', '4', '60', 'fixture-pages-error'],
    ['Pages per site', '100001', '60', 'fixture-pages-error'],
    ['Pages per site', '5.5', '60', 'fixture-pages-error'],
    ['Seed', '-1', '48291', 'fixture-seed-error'],
    ['Seed', '4294967296', '48291', 'fixture-seed-error'],
    ['Seed', '0.5', '48291', 'fixture-seed-error'],
  ]) {
    const input = setup.getByLabel(name, { exact: true });
    await input.fill(invalid);
    assert.equal(await input.getAttribute('aria-invalid'), 'true', `${width}px ${name}: invalid state`);
    assert.equal(await input.getAttribute('aria-describedby'), errorId);
    assert(await page.locator(`#${errorId}`).isVisible());
    assert(await submit.isDisabled());
    await noOverflow(page, width);
    await input.fill(restored);
    assert.equal(await input.getAttribute('aria-invalid'), 'false');
    assert.equal(await page.locator(`#${errorId}`).count(), 0);
    assert(await submit.isEnabled());
  }
  // 0 pages is the meeting's "random page count" request (5 to 200 per site); the checkbox gives a larger maximum.
  await setup.getByLabel('Pages per site', { exact: true }).fill('0');
  assert.equal(await setup.getByLabel('Pages per site', { exact: true }).getAttribute('aria-invalid'), 'false', `${width}px: 0 pages is valid`);
  assert.match(await page.locator('#fixture-pages-hint').innerText(), /0 = random: each site gets 5 to 200 pages/);
  assert(await submit.isEnabled(), '0 pages (random) can be generated');
  await setup.getByLabel('Pages per site', { exact: true }).fill('60');
  // Random page counts with a larger maximum use the checkbox (the pages value becomes a maximum).
  await setup.getByLabel(/^Random page count per site/).check();
  await setup.getByLabel('Seed', { exact: true }).fill('0');
  assert(await submit.isEnabled(), 'Random page count and seed zero remain valid');
  await setup.getByLabel(/^Random page count per site/).uncheck();
  await setup.getByLabel('Pages per site', { exact: true }).fill('60');
  await setup.getByLabel('Seed', { exact: true }).fill('48291');
  if (width === 390) {
    await setup.getByLabel('Pages per site', { exact: true }).fill('4');
    await capture(page, 'invalid-pages-390.png');
    await setup.getByLabel('Pages per site', { exact: true }).fill('60');
  }
  await setup.getByLabel('Seed', { exact: true }).fill('-1');
  await setup.getByLabel('New seed every run').check();
  assert.equal(await setup.getByLabel('Seed', { exact: true }).getAttribute('aria-invalid'), 'false');
  assert(await submit.isEnabled(), 'Fresh-seed mode clears an invalid explicit seed');
  await nav.getByRole('button', { name: /Saved test sets/ }).click();
}

async function routeSaved(page) {
  await page.route(`${base}/api/fixtures?summary=1`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [savedJob], issues: [] }) }));
  await page.route(`${base}/api/fixtures/${id}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: savedJob }) }));
  await page.route(`${base}/api/fixtures/${id}/sites/site-1/answers?*`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }));
}

try {
  for (const width of [320, 390, 760, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await routeSaved(page);
    await page.goto(base);
    const setup = page.locator('#fixture-settings');
    const results = page.locator('#fixture-results');
    const navigation = page.getByRole('group', { name: 'Workspace views' });
    await setup.getByRole('heading', { name: 'Create test set' }).waitFor();
    assert(await navigation.isVisible(), `${width}px workspace navigation missing`);
    assert(await setup.isVisible(), `${width}px Create should be visible first`);
    assert.equal(await results.isVisible(), false);
    await navigation.getByRole('button', { name: /Saved test sets/ }).click();
    await results.getByRole('button', { name: /Saved library set/ }).click();
    await results.getByRole('heading', { name: config.name }).waitFor();
    if (width <= 400) {
      const metricTops = await results.locator('[class*="metrics"] > div > strong').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
      assert.equal(metricTops.length, 3);
      assert(Math.max(...metricTops) - Math.min(...metricTops) < 2, `${width}px metric values should align: ${metricTops}`);
    }
    {
      assert.equal(await setup.isVisible(), false, `${width}px Create should not sit beside saved results`);
      await navigation.getByRole('button', { name: 'Create', exact: true }).click();
      assert(await setup.isVisible());
      assert.equal(await results.isVisible(), false);
      await setup.getByRole('textbox', { name: 'Name' }).fill('Draft settings survive');
      await setup.getByRole('button', { name: 'Generate test set' }).scrollIntoViewIfNeeded();
      if (width <= 760) assert(await page.evaluate(() => window.scrollY > document.getElementById('fixture-workspace-start').offsetTop + 200), `${width}px Create did not reach deep scroll`);
      await navigation.getByRole('button', { name: /Saved test sets/ }).click();
      await headingInViewport(page, '#fixture-results [class*="resultsBar"] h2');
      await results.getByRole('button', { name: 'Answer keys' }).click();
      const search = results.getByRole('searchbox', { name: 'Search answer pages' });
      await search.fill('book');
      await results.getByText('/books/one/').first().waitFor();
      await results.locator('[class*="outputFoot"]').scrollIntoViewIfNeeded();
      await navigation.getByRole('button', { name: 'Create', exact: true }).click();
      await headingInViewport(page, '#fixture-settings h2');
      assert.equal(await setup.getByRole('textbox', { name: 'Name' }).inputValue(), 'Draft settings survive');
      await navigation.getByRole('button', { name: /Saved test sets/ }).click();
      assert.equal(await search.inputValue(), 'book', `${width}px answer search lost on panel switch`);
    }
    await checkInputErrors(page, width);
    await noOverflow(page, width);
    await capture(page, `saved-${width}.png`);
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  let postCount = 0;
  let currentJob = { ...savedJob, status: 'running', completedSites: 0, sites: [], progress: { siteIndex: 0, phase: 'preparing', completedPages: 0, totalPages: 5 } };
  await page.route(`${base}/api/fixtures?summary=1`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [], issues: [] }) }));
  await page.route(`${base}/api/fixtures`, route => {
    postCount++;
    return postCount === 1
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Generation temporarily unavailable.' }) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: currentJob }) });
  });
  await page.route(`${base}/api/fixtures/${id}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: currentJob }) }));
  await page.goto(base);
  const navigation = page.getByRole('group', { name: 'Workspace views' });
  await page.getByRole('button', { name: 'Generate test set' }).waitFor();
  assert(await page.locator('#fixture-settings').isVisible(), 'Empty workspace should start at setup');
  await page.getByRole('button', { name: 'Generate test set' }).click();
  await page.getByRole('alert').getByText('Generation temporarily unavailable.').waitFor();
  assert(await page.locator('#fixture-settings').isVisible(), 'A failed submission should leave settings available');
  await page.waitForFunction(() => {
    const box = document.getElementById('fixture-request-error')?.getBoundingClientRect();
    return box && box.bottom > 0 && box.top < window.innerHeight;
  });
  const alertPosition = await page.getByRole('alert').first().boundingBox();
  assert(alertPosition && alertPosition.y + alertPosition.height > 0 && alertPosition.y < 850, 'Submission error should scroll into view');
  await capture(page, 'generation-error-390.png');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Generate test set' }).click();
  await page.getByRole('heading', { name: config.name }).last().waitFor();
  assert.equal(await navigation.getByRole('button', { name: /Saved test sets/ }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('progressbar', { name: 'Generation progress' }).waitFor();
  await navigation.getByRole('button', { name: 'Create', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Randomize settings' }).isDisabled());
  await navigation.getByRole('button', { name: /Saved test sets/ }).click();
  await page.waitForFunction(() => {
    const box = document.querySelector('#fixture-results h2')?.getBoundingClientRect();
    return box && box.bottom > 0 && box.top < window.innerHeight;
  });
  await noOverflow(page, 390);
  await capture(page, 'generation-running-390.png');
  currentJob = { ...savedJob };
  await page.getByRole('link', { name: 'Download full test package' }).waitFor({ timeout: 5000 });
  await capture(page, 'generation-ready-390.png');
  await page.close();

  const unavailable = await browser.newPage({ viewport: { width: 390, height: 850 } });
  unavailable.on('pageerror', error => errors.push(error.message));
  await unavailable.route(`${base}/api/fixtures?summary=1`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Saved sets unavailable.' }) }));
  await unavailable.goto(base);
  await unavailable.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: /Saved test sets/ }).click();
  await unavailable.getByRole('button', { name: 'Retry test sets' }).waitFor();
  assert.equal(await unavailable.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: /Saved test sets/ }).getAttribute('aria-pressed'), 'true');
  assert(await unavailable.getByRole('alert').getByText('Saved sets unavailable.').isVisible());
  await unavailable.getByRole('group', { name: 'Workspace views' }).getByRole('button', { name: 'Create', exact: true }).click();
  assert(await unavailable.getByRole('alert').getByText('Saved sets unavailable.').isVisible());
  assert(await unavailable.getByRole('button', { name: 'Retry test sets' }).isVisible());
  assert(await unavailable.getByRole('button', { name: 'Generate test set' }).isDisabled());
  await noOverflow(unavailable, 390);
  await capture(unavailable, 'list-error-390.png');
  await unavailable.close();

  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({
    status: 'passed', api: 'mocked', browser: 'Chromium', baseURL: base,
    widths: [320, 390, 760, 1440],
    checks: ['Create and Saved are separate at every width', 'deep-scroll view switching returns to view heading', 'form and answer search state persist', 'small-screen metric values align', 'invalid name/count/pages/seed have linked inline errors and cannot submit', 'correcting invalid inputs restores submission', 'random page count and seed zero remain accepted', 'fresh seed clears invalid explicit seed', 'no horizontal overflow', 'submission error visible', 'generation progress and ready states visible', 'list error and retry discoverable', 'no page errors'],
    screenshots: ['saved-320.png', 'saved-390.png', 'saved-760.png', 'saved-1440.png', 'generation-error-390.png', 'generation-running-390.png', 'generation-ready-390.png', 'list-error-390.png'],
  }, null, 2) + '\n');
  console.log(`Navigation checks passed at 320, 390, 760, and 1440px; screenshots: ${output}`);
} finally {
  await browser.close();
}
