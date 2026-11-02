#!/usr/bin/env node
// Clicks the buttons of the SiteForge app (Create / Saved test sets and the Case catalog) and asserts that each does
// what its label says (2026-11-02). Needs the running app: PAGEPILOT_URL=http://127.0.0.1:4400 (npm run siteforge).
// Buttons that would generate large catalogs are checked against an intercepted API call instead of being run. The
// one small test set this script creates (1 website, 5 pages) is deleted again through the app's Delete button.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PAGEPILOT_URL;
if (!base) throw new Error('Set PAGEPILOT_URL to the running SiteForge address');
const results = [];
const ok = (name, detail = '') => { results.push(name); console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`); };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let created = null;
try {
  // ---------------------------------------------------------------- Create view
  await page.goto(base, { waitUntil: 'networkidle' });
  const switcher = page.locator('#fixture-workspace-switch');
  await switcher.getByRole('button', { name: /Saved test sets/ }).click();
  assert.equal(await switcher.getByRole('button', { name: /Saved test sets/ }).getAttribute('aria-pressed'), 'true');
  assert.ok(await page.getByRole('searchbox', { name: 'Search saved test sets' }).isVisible());
  ok('"Saved test sets" shows the saved list');
  await switcher.getByRole('button', { name: 'Create' }).click();
  assert.equal(await switcher.getByRole('button', { name: 'Create' }).getAttribute('aria-pressed'), 'true');
  ok('"Create" shows the settings');
  const technology = page.getByRole('group', { name: 'Technology' });
  for (const name of ['React', 'Angular', 'Mixed', 'Random', 'HTML']) {
    await technology.getByRole('button', { name, exact: true }).click();
    assert.equal(await technology.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true', `Technology ${name}`);
  }
  ok('Technology buttons select their option');
  const noise = page.getByRole('group', { name: 'Markup noise' });
  for (const name of ['Clean', 'Low', 'Medium', 'High', 'Mixed', 'Random']) {
    await noise.getByRole('button', { name, exact: true }).click();
    assert.equal(await noise.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true', `Noise ${name}`);
  }
  ok('Markup noise buttons select their option');
  for (const summary of await page.locator('form summary').all()) { await summary.click(); }
  assert.ok(await page.locator('form details[open]').count() >= 3);
  ok('Settings sections expand');
  const before = await page.locator('form select').evaluateAll(selects => selects.map(s => s.value).join('|'));
  await page.getByRole('button', { name: 'Randomize settings' }).click();
  const after = await page.locator('form select').evaluateAll(selects => selects.map(s => s.value).join('|'));
  assert.notEqual(after, before);
  assert.ok(after.split('|').filter(value => value === 'random').length >= 5, after);
  ok('"Randomize settings" sets the options to random');

  // "Generate test set" creates a small test set and opens it.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByLabel('Name').fill('Button check (temporary)');
  await page.getByLabel('Websites').fill('1');
  await page.getByLabel('Pages per site').fill('5');
  await page.getByRole('button', { name: 'Generate test set' }).click();
  await page.getByRole('button', { name: 'Back to test sets' }).waitFor({ timeout: 30000 });
  created = new URL(page.url()).searchParams.get('job') ?? await page.evaluate(() => new URLSearchParams(location.search).get('job'));
  await page.getByText(/Completed|Ready/).first().waitFor({ timeout: 120000 });
  ok('"Generate test set" creates and opens the test set', created ?? 'id not in URL');

  // ---------------------------------------------------------------- Saved test set
  await page.getByRole('button', { name: 'Answer keys' }).click();
  assert.equal(await page.getByRole('button', { name: 'Answer keys' }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('group', { name: 'Test set views' }).waitFor();
  ok('"Answer keys" shows the answer keys');
  const answerPages = page.getByLabel('Answer pages').locator('button');
  await answerPages.first().waitFor({ timeout: 20000 });
  await answerPages.nth(1).click();
  assert.equal(await answerPages.nth(1).getAttribute('aria-pressed'), 'true');
  ok('Answer page buttons select the page');
  await page.getByRole('button', { name: 'Coverage' }).click();
  assert.equal(await page.getByRole('button', { name: 'Coverage' }).getAttribute('aria-pressed'), 'true');
  ok('"Coverage" shows coverage');
  await page.getByRole('button', { name: 'Websites' }).click();
  assert.equal(await page.getByRole('button', { name: 'Websites' }).getAttribute('aria-pressed'), 'true');
  ok('"Websites" shows the websites');

  const previewButton = page.getByRole('button', { name: /^(Preview|Restart preview for) / }).first();
  await previewButton.click();
  const open = page.getByRole('link', { name: /^Open / }).first();
  await open.waitFor({ timeout: 30000 });
  const siteUrl = await open.getAttribute('href');
  assert.equal((await page.request.get(siteUrl)).status(), 200);
  ok('"Preview" starts the website and "Open website" links to it', siteUrl);
  await page.getByRole('button', { name: /^Copy URL for / }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), siteUrl);
  ok('"Copy URL" copies the website address');
  for (const [name, type] of [[/^Download website /, /zip/], [/^Download answer key JSON /, /json/]]) {
    const href = await page.getByRole('link', { name }).first().getAttribute('href');
    const response = await page.request.get(new URL(href, base).href);
    assert.equal(response.status(), 200, href);
    assert.match(response.headers()['content-type'] ?? '', type, href);
  }
  ok('Website ZIP and answer key JSON links download their files');
  const packageHref = await page.getByRole('link', { name: 'Download full test package' }).getAttribute('href');
  const pack = await page.request.get(new URL(packageHref, base).href);
  assert.equal(pack.status(), 200); assert.match(pack.headers()['content-type'] ?? '', /zip/);
  ok('"Download full test package" downloads a ZIP');
  await page.getByRole('button', { name: /^Inspect answers for / }).first().click();
  assert.equal(await page.getByRole('button', { name: 'Answer keys' }).getAttribute('aria-pressed'), 'true');
  ok('"Inspect answers" opens that website\'s answer key');

  await page.getByRole('button', { name: 'Back to test sets' }).click();
  await page.getByRole('searchbox', { name: 'Search saved test sets' }).fill('Button check');
  const rows = page.locator('[class*=libraryRow]');
  assert.ok(await rows.count() >= 1);
  assert.ok((await rows.allTextContents()).every(text => /Button check/.test(text)));
  ok('Saved test set search filters the list');
  await rows.first().click();
  await page.getByRole('button', { name: 'Back to test sets' }).waitFor();
  ok('A saved test set row opens it');

  // "Repeat test set" generates a new test set with the same settings and seed.
  const seedText = async () => (await page.locator('[class*=jobHeading]').textContent()).match(/Seed (\d+)/)?.[1];
  const seed = await seedText();
  await page.getByRole('button', { name: 'Repeat test set' }).click();
  await page.waitForFunction(id => new URLSearchParams(location.search).get('job') && new URLSearchParams(location.search).get('job') !== id, created, { timeout: 30000 });
  const repeated = await page.evaluate(() => new URLSearchParams(location.search).get('job'));
  await page.getByText(/Completed|Ready/).first().waitFor({ timeout: 120000 });
  assert.equal(await seedText(), seed);
  ok('"Repeat test set" generates a new test set with the same seed', repeated);

  // "Delete": Cancel keeps the test set, "Delete test set" removes it.
  const deleteOpen = async () => {
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('dialog[open]').waitFor();
  };
  await deleteOpen();
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  ok('"Cancel" closes the delete dialog and keeps the test set');
  for (const id of [repeated, created]) {
    if (new URLSearchParams(new URL(page.url()).search).get('job') !== id) { await page.goto(`${base}/?job=${id}`, { waitUntil: 'networkidle' }); await page.getByRole('button', { name: 'Back to test sets' }).waitFor(); }
    await deleteOpen();
    await page.locator('dialog[open]').getByRole('button', { name: /^Delete test set/ }).click();
    await page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 30000 });
    await page.waitForTimeout(500);
    assert.equal((await page.request.get(`${base}/api/fixtures/${id}`)).status(), 404, `test set ${id} deleted`);
  }
  created = null;
  ok('"Delete test set" deletes the test set');

  // ---------------------------------------------------------------- Case catalog
  await page.goto(`${base}/cases`, { waitUntil: 'networkidle' });
  const firstRow = async () => (await page.locator('tbody tr').first().textContent())?.trim();
  const start = await firstRow();
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction(text => document.querySelector('tbody tr')?.textContent?.trim() !== text, start);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.waitForFunction(text => document.querySelector('tbody tr')?.textContent?.trim() === text, start);
  ok('Catalog "Next page" / "Previous page" page through the cases');
  const select = page.locator('select').nth(1);
  await select.selectOption({ index: 2 });
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole('button', { name: 'Clear filters' }).isEnabled(), true);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  assert.equal(await select.inputValue(), '');
  ok('Catalog "Clear filters" resets the filters');
  const bodies = [];
  await page.route('**/api/fixtures/catalog', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: { id: '00000000-0000-4000-8000-000000000000' } }) });
  });
  await page.locator('tbody button').first().click();
  await page.waitForURL(/\?job=00000000-0000-4000-8000-000000000000/);
  assert.equal(bodies[0].mode, 'single'); assert.ok(bodies[0].caseId);
  ok('Catalog "Generate <case>" requests that one case and opens its job', bodies[0].caseId);
  await page.goto(`${base}/cases`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Generate [\d,]+ core websites$/ }).click();
  await page.waitForURL(/\?job=00000000-0000-4000-8000-000000000000/);
  assert.equal(bodies[1].mode, 'all');
  ok('Catalog "Generate all core websites" requests the full catalog (intercepted, not run)');
  await page.unroute('**/api/fixtures/catalog');
  await page.route('**/api/fixtures/catalog', route => route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Simulated failure"}' }) : route.continue());
  await page.goto(`${base}/cases`, { waitUntil: 'networkidle' });
  await page.locator('tbody button').first().click();
  const alert = page.locator('[role=alert]', { hasText: 'Simulated failure' });
  await alert.waitFor();
  await alert.getByRole('button', { name: 'Dismiss' }).click();
  assert.equal(await alert.count(), 0);
  ok('Catalog error "Dismiss" closes the error');
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log(`\n${results.length} app controls passed.`);
} finally {
  if (created) await page.request.delete(`${base}/api/fixtures/${created}`).catch(() => {});
  await browser.close();
}
