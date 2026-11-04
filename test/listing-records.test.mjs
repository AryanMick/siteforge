import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/site/generator.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { extractPublicPage } from '../src/crawl/crawler.mjs';
import { evaluate } from '../src/answers/evaluator.mjs';

// 2026-11-02: the bundled baseline crawler reports listing records, and the evaluator scores them.
test('the baseline extracts listing records that the evaluator matches to the answer key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-listing-records-'));
  try {
    for (const [domain, seed] of [['library', 3], ['government', 4], ['museum', 5]]) {
      const directory = join(root, domain);
      await generate(sitePlan({ name: 'Records', domain, pagesPerSite: 40, seed, visualStyle: 'conventional', randomness: 0, cmsProfile: 'none', noise: 'clean', framework: 'html', linkMode: 'root-relative', sourceClutter: 'none' }, 0).config, directory);
      const truth = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
      const pages = [];
      for (const page of truth.pages) {
        const html = await readFile(join(directory, 'public', page.url, 'index.html'), 'utf8');
        pages.push({ ...extractPublicPage(html, new URL(page.url, truth.site.baseUrl).href).record, url: page.url });
      }
      const report = evaluate(truth, { version: 1, pages });
      const listed = truth.pages.filter(page => page.repeatedItems?.length).length;
      if (!listed) continue;
      assert.equal(report.repeatedItems.availability, 'available', domain);
      assert.ok(report.repeatedItems.items.recall >= 0.9, `${domain}: records found ${JSON.stringify(report.repeatedItems.items)}`);
      assert.ok(report.repeatedItems.values.f1 >= 0.8, `${domain}: record fields ${JSON.stringify(report.repeatedItems.values)}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
