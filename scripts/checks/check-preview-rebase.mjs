import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { generate } from '../../src/site/generator.mjs';
import { serve } from '../../src/preview/server.mjs';

const sourceOrigin = 'http://site-001-library.siteforge.test';
const name = `${sourceOrigin} ?q=1&x=2#note </script>`;
const bodyLiteral = `Literal ${sourceOrigin}?q=1&x=2#note </script> end.`;
const frameworks = ['html', 'react', 'angular'];
const linkModes = ['root-relative', 'relative', 'absolute', 'mixed', 'base-relative'];

async function ready(page, framework) {
  if (framework === 'html') await page.locator('html[data-ready="true"] main h1').waitFor();
  else await page.locator('site-app:not([aria-busy]) main h1').waitFor();
}

async function checkImage(page) {
  const image = page.locator('main img').first();
  await image.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('main img');
    return image?.complete && image.naturalWidth > 0;
  });
  assert(await image.evaluate(element => element.complete && element.naturalWidth > 0), 'main image did not render');
}

async function checkLocalAttributes(page, origin) {
  const values = await page.locator('main a[href], main img[src]').evaluateAll(elements => elements.map(element => element.getAttribute(element.tagName === 'IMG' ? 'src' : 'href')));
  const baseURI = await page.evaluate(() => document.baseURI);
  assert(values.length > 0);
  for (const value of values) assert.equal(new URL(value, baseURI).origin, origin, value);
}

async function checkSite(browser, root, framework, linkMode) {
  const directory = join(root, `${framework}-${linkMode}`);
  await generate({
    site: { id: 'site-001-library', name, baseUrl: sourceOrigin, framework, linkMode, pageCount: 5 },
    contentPool: [bodyLiteral],
  }, directory);
  const truth = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
  const detail = truth.pages.find(item => item.kind === 'detail' && Object.values(item.fields).includes(bodyLiteral));
  assert(detail, 'generated fixture has no detail page with literal body text');
  const homePath = join(directory, 'public', 'index.html');
  const detailPath = join(directory, 'public', detail.url, 'index.html');
  const [storedHome, storedDetail] = await Promise.all([readFile(homePath), readFile(detailPath)]);
  const preview = await serve(directory, { port: 0, rebaseOrigin: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(preview.url, { waitUntil: 'networkidle' });
    await ready(page, framework);
    assert.equal(await page.locator('main h1').textContent(), name);
    await checkImage(page);
    await checkLocalAttributes(page, preview.url);

    const links = page.locator('main a[href]');
    let selected = null;
    for (let index = 0; index < await links.count(); index++) {
      const href = await links.nth(index).getAttribute('href');
      if (new URL(href, preview.url).pathname === detail.url) { selected = links.nth(index); break; }
    }
    assert(selected, `home page has no link to ${detail.url}`);
    await selected.click();
    await page.waitForURL(url => url.pathname === detail.url);
    await ready(page, framework);
    assert((await page.locator('main').innerText()).includes(bodyLiteral), 'detail body text changed during preview');
    if (linkMode === 'base-relative') assert.equal(await page.evaluate(() => document.baseURI), `${preview.url}/`);
    if (await page.locator('main img').count()) await checkImage(page);
    await checkLocalAttributes(page, preview.url);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${preview.url}${detail.url}`);
    assert.deepEqual(errors, [], `browser errors for ${framework}/${linkMode}`);
    assert.deepEqual(await readFile(homePath), storedHome);
    assert.deepEqual(await readFile(detailPath), storedDetail);
    process.stdout.write(`PASS ${framework}/${linkMode}: hydrated detail text, links, image, canonical URL, stored files\n`);
  } finally {
    await page.close();
    await preview.close();
  }
}

const root = await mkdtemp(join(tmpdir(), 'siteforge-preview-browser-'));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const framework of frameworks) for (const linkMode of linkModes) await checkSite(browser, root, framework, linkMode);
} finally {
  await browser?.close();
  await rm(root, { recursive: true, force: true });
}
