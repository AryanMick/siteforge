// Browser check for scoring an uploaded tool result in Saved test sets (2026-11-02).
//
//   PAGEPILOT_URL=http://127.0.0.1:4400 node scripts/checks/check-score-upload.mjs
//
// Generates one small set through the API, uploads (1) a perfect result built from the answer key, (2) a result that
// misses pages, and (3) a file that is not a tool result, then checks the score summaries, accessibility and layout at
// 390 and 1440 px. The generated set is deleted afterwards.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const { chromium } = await import('playwright');
const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4400';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const headers = { 'Content-Type': 'application/json', Origin: base, 'Sec-Fetch-Site': 'same-origin' };
const created = await (await fetch(`${base}/api/fixtures`, { method: 'POST', headers, body: JSON.stringify({ name: 'Score upload check', siteCount: 1, pagesPerSite: 20, seed: 3301, domain: 'library', framework: 'html', noise: 'low', randomness: 20, cmsProfile: 'none', linkMode: 'root-relative' }) })).json();
const jobId = created.job.id;
let browser;
try {
  let job;
  for (let attempt = 0; attempt < 300; attempt++) { job = (await (await fetch(`${base}/api/fixtures/${jobId}`)).json()).job; if (job.status !== 'running') break; await new Promise(done => setTimeout(done, 300)); }
  assert.equal(job.status, 'completed', job.error);
  const site = job.sites[0];
  const truth = await (await fetch(`${base}/api/fixtures/${jobId}/sites/${site.id}/download?kind=answers`)).json();
  const perfect = { version: 1, tool: 'check', pages: truth.pages.map(page => ({ url: page.url, cluster: page.expectedCluster, contentType: page.contentType, fields: page.fields, ...(page.repeatedItems?.length ? { repeatedItems: page.repeatedItems.map(item => ({ url: item.url, fields: item.fields })) } : {}) })) };
  const partial = { version: 1, pages: perfect.pages.slice(0, 10).map(({ url, cluster }) => ({ url, cluster })) };
  // The API scores directly, and rejects malformed output with a message.
  const direct = await (await fetch(`${base}/api/fixtures/${jobId}/sites/${site.id}/score`, { method: 'POST', headers, body: JSON.stringify(perfect) })).json();
  assert.equal(direct.report.coverage.recall, 1); assert.equal(direct.report.fields.values.f1, 1);
  const bad = await fetch(`${base}/api/fixtures/${jobId}/sites/${site.id}/score`, { method: 'POST', headers, body: JSON.stringify({ version: 1, pages: [{ url: '/' }] }) });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /does not match the format: actual\.pages\[0\]\.cluster/);
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/?job=${jobId}`);
    const input = page.getByLabel(`Score a tool's output for ${site.name}`);
    await input.setInputFiles({ name: 'perfect.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(perfect)) });
    const box = page.getByLabel(`Score for ${site.name}`);
    await box.waitFor();
    const text = await box.innerText();
    assert.match(text, new RegExp(`Pages found\\s+${truth.pages.length} of ${truth.pages.length} \\(100\\.0%\\)`));
    assert.match(text, /Cluster F1\s+100\.0%/); assert.match(text, /Field F1\s+100\.0%/);
    await input.setInputFiles({ name: 'partial.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(partial)) });
    await page.getByText('Score for partial.json').waitFor();
    assert.match(await page.getByLabel(`Score for ${site.name}`).innerText(), /Pages found\s+10 of 20 \(50\.0%\)/);
    await input.setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await page.getByRole('alert').filter({ hasText: 'notes.json is not JSON.' }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px overflow`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    assert.deepEqual(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${width}px accessibility`);
    await context.close();
  }
  console.log('Score upload checks passed at 1440 and 390 px: perfect result 100%, partial result 50% coverage, non-JSON and malformed output rejected with messages.');
} finally {
  await browser?.close();
  await fetch(`${base}/api/fixtures/${jobId}`, { method: 'DELETE', headers });
}
