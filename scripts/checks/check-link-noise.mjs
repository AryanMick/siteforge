import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { generate } from '../../src/site/generator.mjs';
import { serve } from '../../src/preview/server.mjs';

const root = await mkdtemp(join(tmpdir(), 'siteforge-link-noise-'));
const browser = await chromium.launch({ headless: true });
try {
  for (const framework of ['html', 'react', 'angular']) for (const mode of ['root-relative', 'relative', 'absolute', 'mixed', 'base-relative']) {
    const label = `${framework}/${mode}`;
    const directory = join(root, framework, mode);
    await generate({
      seed: 124,
      site: { id: 'link-demo', framework, pageCount: 8,
        baseUrl: 'http://link-demo.siteforge.test', linkMode: mode },
      noise: { level: 'custom', probability: 1, maxPerPage: 1, types: ['javascript-only-link'] },
    }, directory);
    const truth = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
    const record = truth.pages.find(page => page.kind === 'detail');
    assert(record.noiseEvents.some(event => event.type === 'javascript-only-link'), label);
    const server = await serve(directory, { port: 0, rebaseOrigin: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
      await page.goto(server.url + record.url);
      if (framework !== 'html') await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
      const link = page.locator('main a[href="javascript:void(0)"]').first();
      assert.equal(await link.count(), 1, label);
      assert.equal(await link.getAttribute('onclick'), "window.location.href='/'", label);
      await Promise.all([page.waitForURL(server.url + '/'), link.click()]);
      if (framework !== 'html') await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
      assert.equal(page.url(), server.url + '/', label);
      assert.deepEqual(pageErrors, [], `${label}: browser errors`);
      console.log(`${label}: click navigated to local home`);
    } finally {
      await page.close();
      await server.close();
    }
  }
  console.log('PASS: JavaScript-only links navigate locally in all 15 framework/link-mode combinations');
} finally {
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
