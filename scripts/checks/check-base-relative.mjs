import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { generate } from '../../src/site/generator.mjs';
import { serve } from '../../src/preview/server.mjs';

const outputRoot = resolve('outputs/base-relative');
await mkdir(outputRoot, { recursive: true });
const runRoot = await mkdtemp(join(outputRoot, 'run-'));
const browser = await chromium.launch({ headless: true });
const evidence = { mode: 'base-relative', output: runRoot, checks: [] };

try {
  for (const framework of ['html', 'react', 'angular']) {
    const directory = join(runRoot, framework);
    await generate({
      seed: 124,
      site: { id: 'base-browser', baseUrl: 'http://base-browser.siteforge.test', framework,
        pageCount: 12, linkMode: 'base-relative' },
      noise: { level: 'clean' },
    }, directory);
    const source = JSON.parse(await readFile(join(directory, 'private', 'canonical.json'), 'utf8'));
    const record = source.pages.find(item => item.kind === 'detail' && item.url !== '/' && item.links.length && item.image?.src);
    assert(record, `${framework}: no nested record with links and image`);
    const preview = await serve(directory, { port: 0, rebaseOrigin: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(preview.url + record.url, { waitUntil: 'networkidle' });
      if (framework !== 'html') await page.locator('site-app:not([aria-busy]) main h1').waitFor();
      const result = await page.evaluate(() => {
        const base = document.querySelector('head base[href]');
        const skip = document.querySelector('a.skip-link');
        const image = document.querySelector('main img');
        const stylesheet = document.querySelector('link[rel="stylesheet"]');
        const anchors = [...document.querySelectorAll('main a[href]')].map(anchor => ({
          href: anchor.getAttribute('href'), resolved: anchor.href,
        }));
        return {
          baseCount: document.querySelectorAll('head base[href]').length,
          baseHref: base?.getAttribute('href'), baseURI: document.baseURI,
          skipHref: skip?.getAttribute('href'), skipTarget: skip?.href,
          canonical: document.querySelector('link[rel="canonical"]')?.href,
          stylesheetHref: stylesheet?.getAttribute('href'), stylesheetLoaded: !!stylesheet?.sheet,
          imageSrc: image?.getAttribute('src'), imagePath: image ? new URL(image.src).pathname : null,
          imageLoaded: !!image?.complete && image.naturalWidth > 0,
          anchors,
        };
      });
      assert.equal(result.baseCount, 1);
      assert.equal(result.baseHref, '/');
      assert.equal(result.baseURI, preview.url + '/');
      assert.equal(result.canonical, preview.url + record.url);
      assert(result.stylesheetHref.startsWith('./'));
      assert(result.stylesheetLoaded, `${framework}: stylesheet did not load`);
      assert(result.imageSrc.startsWith('./'));
      assert.equal(result.imagePath, record.image.src);
      assert(result.imageLoaded, `${framework}: image did not load`);
      const imageLocation = record.fieldLocations[record.image.field];
      assert.equal(imageLocation.read, 'urlPath');
      const locatedImage = page.locator(imageLocation.selector);
      assert.equal(await locatedImage.count(), 1);
      const extractedPath = await locatedImage.evaluate(image => new URL(image.getAttribute('src'), document.baseURI).pathname);
      assert.equal(extractedPath, record.fields[record.image.field]);
      assert.equal(result.skipTarget, preview.url + record.url + '#content');
      assert(result.anchors.some(anchor => anchor.href.startsWith('./')
        && new URL(anchor.href, preview.url + record.url).href !== anchor.resolved), `${framework}: no base-dependent nested link`);
      const resolved = new Set(result.anchors.map(anchor => anchor.resolved));
      for (const link of record.links) assert(resolved.has(preview.url + link.href), `${framework}: missing source edge ${link.href}`);
      await page.locator('a.skip-link').focus();
      await page.keyboard.press('Enter');
      // Fragment navigation is asynchronous; wait for it instead of racing the address bar.
      await page.waitForURL(url => new URL(url).hash === '#content', { timeout: 5000 });
      assert.equal(new URL(page.url()).pathname, record.url);
      assert.equal(new URL(page.url()).hash, '#content');
      assert.equal(await page.locator('main#content').count(), 1);
      const related = record.links[0];
      const target = source.pages.find(item => item.url === related.href);
      assert(target, 'Related edge has a known source record');
      await page.locator(`main a[href=${JSON.stringify(`.${related.href}`)}]`).first().click();
      await page.waitForURL(url => url.pathname === target.url);
      if (framework !== 'html') await page.locator('site-app:not([aria-busy]) main h1').waitFor();
      assert.equal(await page.locator('main h1').textContent(), target.fields.title);
      assert.deepEqual(errors, [], `${framework}: browser errors`);
      evidence.checks.push({ framework, page: record.url, sourceEdgesChecked: record.links.length,
        imageField: record.image.field ?? null, baseURI: result.baseURI, skipTarget: result.skipTarget,
        stylesheetLoaded: result.stylesheetLoaded, imageLoaded: result.imageLoaded, hydrated: framework !== 'html',
        extractedImagePath: extractedPath, clickedSourceEdge: target.url });
      process.stdout.write(`PASS ${framework}: nested base, ${record.links.length} source edges, assets, skip, hydration\n`);
    } finally {
      await page.close();
      await preview.close();
    }
  }
  await writeFile(join(runRoot, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(`Evidence: ${join(runRoot, 'browser-evidence.json')}\n`);
} finally {
  await browser.close();
}
