import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { generate } from '../src/generator.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { serve } from '../src/server.mjs';

const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4402';
assert.equal(new URL(base).hostname, '127.0.0.1');
const id = process.argv[2];
assert.match(id ?? '', /^[0-9a-f-]{36}$/);
const output = resolve('outputs/single-site-browser');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'cover-browser-'));
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?job=${id}`);
  await page.getByTestId('generated-site').waitFor();
  await page.getByRole('button', { name: /^Inspect answers for/ }).click();
  await page.getByText('1-25 of 100,000', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Answer pages', { exact: true }).getByRole('button').count(), 25);
  await page.getByRole('button', { name: 'Next answers', exact: true }).click();
  await page.getByText('26-50 of 100,000', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'large-answers-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, 'large-answers-mobile.png'), fullPage: true });
  checks.push('100,000-page answer viewer paginates with only 25 rendered records on desktop and mobile');
  for (const framework of ['html', 'react', 'angular']) {
    const directory = join(root, framework);
    await generate(sitePlan({ name: 'Optional covers', pagesPerSite: 60, domain: 'library', framework, noise: 'clean', optionalFields: true, seed: 41 }, 0).config, directory);
    const truth = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
    const present = truth.pages.find(item => item.contentType === 'book' && item.fieldStates.coverImage === 'present');
    const absent = truth.pages.find(item => item.contentType === 'book' && item.fieldStates.coverImage === 'absent');
    assert(present && absent);
    const server = await serve(directory, { port: 0, rebaseOrigin: true });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(server.url + present.url);
      await page.locator('img[data-field="coverImage"]').waitFor();
      assert(await page.locator('img[data-field="coverImage"]').evaluate(image => image.complete && image.naturalWidth > 0));
      await page.screenshot({ path: join(output, `${framework}-cover-present.png`), fullPage: true });
      await page.goto(server.url + absent.url);
      await page.getByRole('heading', { level: 1, name: absent.fields.title, exact: true }).waitFor();
      assert.equal(await page.locator('img[data-field="coverImage"]').count(), 0);
      assert.equal(present.expectedCluster, absent.expectedCluster);
      checks.push(`${framework}: rendered cover asset loaded, absent cover omitted, same answer cluster`);
    } finally { await server.close(); }
  }
  assert.deepEqual(errors, []);
  const evidence = { status: 'passed', jobId: id, checks, browserErrors: errors };
  await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
