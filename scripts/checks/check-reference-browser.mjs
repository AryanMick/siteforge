import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { serve } from '../../src/preview/server.mjs';
import { launchBrowser } from '../../src/crawl/crawler.mjs';
import { json, label } from '../../src/site/util.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } }, strict: true });
if (!values.out) throw new Error('--out must point to a completed reference study');
const root = resolve(values.out);
const study = JSON.parse(await readFile(join(root, 'study.json'), 'utf8'));
const browser = await launchBrowser();
const results = [];
const shots = join(root, 'browser');
await mkdir(shots, { recursive: true });
try {
  for (const reference of study.references) for (const seedRun of reference.seeds) for (const variant of seedRun.variants) {
    const seed = seedRun.seed, level = variant.level;
    assert(/^[a-z][a-z0-9-]{0,63}$/.test(reference.id) && Number.isInteger(seed) && seed >= 0 && ['clean','cosmetic','high'].includes(level), 'Invalid study path components');
    const directory = join(root, 'synthetic', reference.id, String(seed), level);
    const truth = JSON.parse(await readFile(join(directory, 'private/ground-truth.json'), 'utf8'));
    const server = await serve(directory, { port: 0 });
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    try {
      let verified = 0;
      for (const record of truth.pages) {
        await page.goto(server.url + record.url, { waitUntil: 'load' });
        assert.equal((await page.locator('h1').innerText()).trim(), record.fields.title);
        for (const [key, expected] of Object.entries(record.fields)) {
          if (key === 'title') continue;
          const wanted = record.fieldLabels?.[key] ?? label(key);
          const actual = await page.locator('main').evaluate((main, wantedLabel) => {
            const normalize = text => text.replace(/\s+/g, ' ').trim();
            for (const dt of main.querySelectorAll('dt')) if (normalize(dt.textContent) === wantedLabel) return normalize(dt.nextElementSibling?.textContent ?? '');
            for (const tr of main.querySelectorAll('tr')) if (normalize(tr.firstElementChild?.textContent ?? '') === wantedLabel) return normalize(tr.lastElementChild?.textContent ?? '');
            for (const strong of main.querySelectorAll('p > strong')) if (normalize(strong.textContent).replace(/:$/, '') === wantedLabel) return normalize(strong.parentElement.textContent.slice(strong.textContent.length));
            return null;
          }, wanted);
          assert.equal(actual, String(expected).replace(/\s+/g, ' ').trim(), `${reference.id}/${seed}/${level}${record.url}: ${key}`);
        }
        assert(await page.locator('img').evaluateAll(images => images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0)), `Image failed: ${record.url}`);
        verified++;
      }
      const samples = [...new Map(truth.pages.filter(record => record.kind === 'detail').map(record => [record.fieldLayout, record])).values()];
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        for (const record of samples) {
          await page.goto(server.url + record.url, { waitUntil: 'load' });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow: ${reference.id}/${level}/${record.fieldLayout}/${viewport.width}`);
          if (seed === reference.seeds[0].seed && level === 'clean') await page.screenshot({ path: join(shots, `${reference.id}-${record.fieldLayout}-${viewport.width}.png`), fullPage: true });
        }
      }
      assert.deepEqual(errors, []);
      assert.equal((await context.request.get(server.url + '/private/ground-truth.json')).status(), 404);
      results.push({ reference: reference.id, seed, level, pagesVerified: verified, responsiveLayouts: samples.map(record => record.fieldLayout), viewports: [1440, 390], imagesLoaded: true, truthIsolated: true, errors });
      console.log(`${reference.id}/${seed}/${level}: ${verified} pages PASS`);
    } finally { await context.close(); await server.close(); }
  }
} finally { await browser.close(); }
await writeFile(join(shots, 'verification.json'), json({ results }));
console.log(`Browser evidence: ${shots}`);
