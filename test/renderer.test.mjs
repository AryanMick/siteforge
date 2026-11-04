import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { finalizePage, prepareAssets, renderPage } from '../src/render/renderers.mjs';

function fixture(framework = 'html') {
  return {
    site: {
      id: 'private-site-id', name: 'Civic Archive', domain: 'public-records',
      framework, rendering: framework === 'html' ? 'static' : 'client', visualStyle: 'conventional',
      seed: 90817, baseUrl: 'https://example.test', noise: { defects: ['secret-defect'] },
      navigation: [{ label: 'Records', href: '/records/' }], description: 'A public collection.',
    },
    page: {
      pageId: 'private-page-id', url: '/records/example/', kind: 'detail', contentType: 'secret-content-type',
      expectedCluster: 'secret-answer-cluster', template: 'detail-2', title: 'Example & record',
      fields: { title: 'Example & record', author: 'A. <Writer>', date: '2024-04-03' },
      fieldLabels: { author: 'Creator' }, canonicalValues: { title: 'Example & record', removed: 'SECRET-CANONICAL' },
      fieldStates: { title: 'present', removed: 'absent' },
      relationships: [{ type: 'related', targetUrl: '/people/writer/' }],
      links: [{ label: 'Writer profile', href: '/people/writer/' }, { label: 'Next page', href: '/records/page/2/' }],
      image: { src: '/assets/collection.png', alt: 'Collection cover' },
      noiseEvents: [{ type: 'secret-defect' }], delayMs: 20,
    },
  };
}

test('static renderer exposes observed content and no private truth', () => {
  const { site, page } = fixture();
  const html = renderPage(site, page);
  assert.match(html, /<main[^>]*>/);
  assert.match(html, /<h1>Example &amp; record<\/h1>/);
  assert.match(html, /<dt>Creator<\/dt><dd>A\. &lt;Writer&gt;<\/dd>/);
  assert.match(html, /aria-label="Pagination"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/records\/example\/">/);
  for (const secret of ['private-site-id', 'private-page-id', 'secret-content-type', 'secret-answer-cluster', 'SECRET-CANONICAL', 'secret-defect', 'detail-2', '90817']) {
    assert.doesNotMatch(html, new RegExp(secret));
  }
});

test('home page never recovers a summary removed from observed fields', () => {
  const { site, page } = fixture();
  site.description = 'PRIVATE REMOVED SUMMARY';
  Object.assign(page, { url: '/', kind: 'home', title: 'Archive home', fields: { title: 'Archive home' }, template: 'home' });
  const html = renderPage(site, page);
  assert.doesNotMatch(html, /PRIVATE REMOVED SUMMARY/);
  assert.match(html, /<meta name="description" content="Archive home">/);
  assert.doesNotMatch(html, /class="lede"/);
});

test('long names and headings are escaped and supported by fixed responsive type', async () => {
  const { site, page } = fixture();
  site.name = `${'LongName'.repeat(20)} <site>`;
  page.title = `${'Heading'.repeat(22)} <unsafe>`;
  page.fields.title = page.title;
  const html = renderPage(site, page);
  assert.match(html, /&lt;site&gt;/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<unsafe>/);
  const css = await readFile(new URL('../src/render/site.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /font-size:\s*(?:clamp|[^;]*vw)/);
  assert.doesNotMatch(css, /white-space:\s*nowrap/);
  assert.match(css, /h1[^}]*overflow-wrap:\s*anywhere/s);
});

test('detail templates vary semantic containers and legacy listings use a table', () => {
  const { site, page } = fixture();
  assert.match(renderPage(site, { ...page, template: 'detail-0' }), /<div class="content-grid"><section class="record-facts">/);
  assert.match(renderPage(site, { ...page, template: 'detail-1' }), /<article class="editorial-record">/);
  assert.match(renderPage(site, { ...page, template: 'detail-2' }), /<div class="record-sheet">/);

  const listing = { ...page, kind: 'listing', template: 'listing', fields: { title: page.title } };
  const html = renderPage({ ...site, visualStyle: 'legacy' }, listing);
  assert.match(html, /<table class="directory-table">/);
  assert.doesNotMatch(html, /<ul class="link-list">/);
});

test('client finalizer preserves mutated main only in escaped public payload', () => {
  const { site, page } = fixture('react');
  const clean = renderPage(site, page);
  const mutated = clean.replace('<dl class="field-list">', '<div class="layout-noise"><dl class="changed">')
    .replace('</dl>', '</dl></div>');
  const result = finalizePage(site, page, mutated);
  assert.doesNotMatch(result, /<main id="content"/);
  assert.match(result, /<site-app class="client-root"/);
  assert.match(result, /\\u003cmain/);
  assert.match(result, /layout-noise/);
  assert.match(result, /react-app\.js/);
  assert.doesNotMatch(result, /SECRET-CANONICAL|secret-answer-cluster|private-page-id/);
});

test('HTML finalization is an identity operation', () => {
  const { site, page } = fixture();
  assert.equal(finalizePage(site, page, '<!doctype html><main>changed</main>'), '<!doctype html><main>changed</main>');
});

test('asset preparation writes valid bitmap, CSS, and real runtime bundles', async (t) => {
  for (const framework of ['html', 'react', 'angular']) {
    const { site } = fixture(framework);
    const output = await mkdtemp(join(tmpdir(), `renderer-${framework}-`));
    t.after(async () => rm(output, { recursive: true, force: true }));
    await prepareAssets(site, output);
    const png = await readFile(join(output, 'assets', 'collection.png'));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok((await stat(join(output, 'assets', 'site.css'))).size > 2000);
    if (framework !== 'html') {
      const bundlePath = join(output, 'assets', `${framework}-app.js`);
      assert.ok((await stat(bundlePath)).size > 10_000);
      assert.match(await readFile(bundlePath, 'utf8'), /@license|Copyright/i);
    }
  }
});

test('unsupported renderer combinations fail clearly', () => {
  const { site, page } = fixture();
  assert.throws(() => renderPage({ ...site, framework: 'vue' }, page), /Unsupported framework/);
  assert.throws(() => renderPage({ ...site, rendering: 'client' }, page), /static rendering only/);
});
