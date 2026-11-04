import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.PAGEPILOT_URL || process.env.SITEFORGE_URL || 'http://127.0.0.1:4400';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = resolve('outputs/fixture-redesign');
await mkdir(output, { recursive: true });
const id = '22222222-2222-4222-8222-222222222222';
const config = { name: 'Saved library set', siteCount: 1, pagesPerSite: 5, domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'low', challenge: 'standard', seed: 48291, randomness: 50, fieldLayout: 'mixed', linkMode: 'root-relative', cmsProfile: 'none', builderProfile: 'none', optionalFields: true, scenario: 'baseline', transport: 'none', previewProtocol: 'http' };
const site = { id: 'site-1', name: 'Saved library', domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'low', pageCount: 5, seed: 48291, clusters: 1, noiseEvents: 0 };
const job = { id, name: config.name, status: 'completed', config, createdAt: '2026-10-09T12:00:00.000Z', completedSites: 1, totalPages: 5, sites: [site] };
const answer = { pages: [{ pageId: 'book-1', url: '/books/one/', kind: 'detail', contentType: 'book', expectedCluster: 'book', fields: { title: 'One' }, canonicalValues: { title: 'One' }, fieldStates: { title: 'present' }, noiseEvents: [] }], schemaDefinitions: { book: { required: ['title'], optional: [] } }, pagination: { total: 1, matched: 1, offset: 0, limit: 25 }, coverage: { counts: {}, affectedPages: 0 } };
const browser = await chromium.launch({ headless: true });
const pageErrors = [];

async function mock(page, initial = true) {
  let saved = initial;
  let deleteFailure = false;
  let missing = false;
  let submitted = null;
  let deleteGate = null;
  let releaseDelete = null;
  await page.route('**/api/fixtures?summary=1', route => route.fulfill({ json: { jobs: saved ? [job] : [], issues: [] } }));
  await page.route(`**/api/fixtures/${id}`, async route => {
    if (route.request().method() === 'DELETE') {
      if (deleteFailure) return route.fulfill({ status: 409, json: { error: 'A preview is running.' } });
      if (deleteGate) await deleteGate;
      saved = false;
      return route.fulfill({ json: { deleted: true, id } });
    }
    return missing || !saved ? route.fulfill({ status: 404, json: { error: 'Test set not found.' } }) : route.fulfill({ json: { job } });
  });
  await page.route(`**/api/fixtures/${id}/sites/site-1/answers?*`, route => route.fulfill({ json: answer }));
  await page.route('**/api/fixtures', route => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ json: { job } });
  });
  return { failDelete(value) { deleteFailure = value; }, missing(value) { missing = value; }, submitted() { return submitted; }, pauseDelete() { deleteGate = new Promise(resolve => { releaseDelete = resolve; }); }, resumeDelete() { releaseDelete?.(); deleteGate = null; } };
}

try {
  for (const width of [320, 390, 760, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => pageErrors.push(error.message));
    const routes = await mock(page);
    await page.goto(base);
    const nav = page.getByRole('group', { name: 'Workspace views' });
    const create = page.locator('#fixture-settings');
    const saved = page.locator('#fixture-results');
    await create.getByRole('heading', { name: 'Create test set' }).waitFor();
    assert(await create.isVisible());
    assert(!await saved.isVisible());
    await create.getByRole('button', { name: 'Randomize settings' }).click();
    assert.equal(await create.getByLabel('Site type').inputValue(), 'random');
    assert.equal(await create.getByLabel('Preview protocol').count(), 0);
    await create.getByLabel('Pages per site').fill('4');
    assert(await create.getByRole('button', { name: 'Generate test set' }).isDisabled());
    await create.getByLabel('Pages per site').fill('60');
    assert(await create.getByRole('button', { name: 'Generate test set' }).isEnabled());
    await create.locator('summary', { hasText: 'Repeatability' }).click();
    await create.getByLabel('New seed every run').uncheck();
    await create.getByLabel('Seed', { exact: true }).fill('0');
    assert(await create.getByRole('button', { name: 'Generate test set' }).isEnabled());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(output, `create-${width}.png`), fullPage: true });
    await create.getByRole('button', { name: 'Generate test set' }).click();
    await saved.getByRole('heading', { name: config.name }).waitFor();
    assert.equal(routes.submitted().pagesPerSite, 60);
    assert.equal(routes.submitted().siteCount, 1);
    assert.equal(routes.submitted().domain, 'random');
    assert.equal(routes.submitted().seed, 0);
    assert.equal(routes.submitted().freshSeed, false);
    await saved.getByRole('button', { name: 'Back to test sets' }).click();
    await nav.getByRole('button', { name: /Saved test sets/ }).click();
    await saved.getByRole('searchbox', { name: 'Search saved test sets' }).fill('library');
    await saved.getByRole('button', { name: /Saved library set/ }).first().click();
    await saved.getByRole('heading', { name: config.name }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('job'), id);
    await saved.getByRole('button', { name: 'Answer keys' }).click();
    await saved.getByText('/books/one/').first().waitFor();
    await saved.getByRole('button', { name: 'Coverage' }).click();
    await saved.getByRole('heading', { name: 'Applied to this website' }).waitFor();
    await saved.getByRole('button', { name: 'Websites' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(output, `detail-${width}.png`), fullPage: true });
    await saved.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fixture-delete-cancel');
    await page.keyboard.press('Shift+Tab');
    assert.match(await page.evaluate(() => document.activeElement?.textContent || ''), /Delete test set/);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: 'Delete test set?' }).count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Delete');
    await saved.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog', { name: 'Delete test set?' }).getByRole('button', { name: 'Cancel' }).click();
    assert(await saved.getByRole('heading', { name: config.name }).isVisible());
    routes.failDelete(true);
    await saved.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete test set' }).click();
    await page.getByRole('dialog').getByText('A preview is running.').waitFor();
    routes.failDelete(false);
    if (width === 390) routes.pauseDelete();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete test set' }).click();
    if (width === 390) {
      await page.getByRole('dialog').getByText('Deleting...').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog', { name: 'Delete test set?' }).count(), 1);
      await assert.rejects(nav.getByRole('button', { name: 'Create', exact: true }).click({ timeout: 700 }));
      assert.equal(await saved.isVisible(), true);
      routes.resumeDelete();
    }
    await saved.getByRole('heading', { name: 'No saved test sets' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('job'), null);
    const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert(dimensions.document <= dimensions.viewport, `${width}px overflow: ${JSON.stringify(dimensions)}`);
    await page.close();
  }
  const missingPage = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await mock(missingPage, false);
  await missingPage.goto(`${base}/?job=${id}`);
  await missingPage.getByRole('heading', { name: 'Test set unavailable' }).waitFor();
  await missingPage.getByRole('button', { name: 'Back to test sets' }).click();
  await missingPage.locator('#fixture-results').getByRole('button', { name: 'Create test set' }).first().click();
  assert(await missingPage.getByRole('heading', { name: 'Create test set' }).isVisible());
  assert.deepEqual(pageErrors, []);
  console.log(`Fixture redesign passed at 320, 390, 760, and 1440px. Screenshots: ${output}`);
} finally { await browser.close(); }
