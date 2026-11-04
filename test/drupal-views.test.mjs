import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { generate } from '../src/site/generator.mjs';
import { serve } from '../src/preview/server.mjs';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { renderPage } from '../src/pages/renderers.mjs';

const config = (extra = {}) => ({ version: 1, seed: 7, site: { id: 'drupal-views', domain: 'museum', cmsProfile: 'drupal', pageCount: 120, pageSize: 10, ...extra.site }, ...extra.top });

async function withSite(input, fn) {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-drupal-views-'));
  try {
    await generate(input, join(root, 'site'));
    await fn(join(root, 'site'));
  } finally { await rm(root, { recursive: true, force: true }); }
}
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

// Rows of the View on one page: the detail-page URLs in order.
function viewRows($) {
  return $('.view .view-content').find('.views-row').map((_, row) => new URL($(row).find('a[hreflang]').last().attr('href'), $.pageUrl).pathname).get();
}

test('Drupal listings use real Views, Facets and pager markup with counts from the source records', async () => {
  await withSite(config(), async dir => {
    const truth = await readJson(join(dir, 'private', 'answer-key.json'));
    const views = await readJson(join(dir, 'private', 'drupal-views.json'));
    const html = await readFile(join(dir, 'public', 'exhibitions', 'index.html'), 'utf8');
    const $ = cheerio.load(html);
    const view = $('.view');
    assert.match(view.attr('class'), /^view view-exhibitions view-id-exhibitions view-display-id-page_1 js-view-dom-id-[0-9a-f]{64}$/);
    for (const selector of ['.view-header', '.view-filters form.views-exposed-form', '.view-content .views-row .views-field.views-field-title .field-content a',
      'nav.pager[role="navigation"] ul.pager__items.js-pager__items', '.pager__item.is-active', '.pager__item--next', '.pager__item--last',
      '.facets-widget-links ul.js-facets-links li.facet-item .facet-item__value', '.facet-item__count', 'nav.tabs ul.tabs.primary']) {
      assert(view.find(selector).length || $(selector).length, `missing ${selector}`);
    }
    assert.equal($('.region-content > .drupal-views-layout').length, 1, 'listing is not wrapped in a node article');
    const details = truth.pages.filter(page => page.kind === 'detail' && page.contentType === 'exhibition');
    assert.equal($('.views-result-summary').text(), `Displaying 1 - 10 of ${details.length} exhibitions.`);
    const exhibitionView = views.views.find(item => item.type === 'exhibition');
    for (const facet of exhibitionView.facets) for (const value of facet.values) {
      const expected = details.filter(page => (facet.source.startsWith('year:') ? page.fields[facet.source.slice(5)]?.slice(0, 4) : page.fields[facet.source]) === value.value).length;
      assert.equal(value.count, expected, `${facet.alias}=${value.value}`);
      assert.equal($(`a[data-drupal-facet-item-id="${facet.alias}-${value.slug}"] .facet-item__count`).text(), `(${expected})`);
    }
    assert.deepEqual(exhibitionView.tabs.map(tab => tab.id), ['current', 'upcoming', 'past']);
    // Answer key: no variant is a content page; every View row is an answer-key detail page.
    const urls = new Set(truth.pages.map(page => page.url));
    assert(views.variants.length > 0);
    for (const variant of views.variants) {
      assert(!urls.has(variant.url), variant.url);
      assert.equal(variant.contentPage, false);
      assert(variant.recordPageIds.every(id => truth.pages.some(page => page.pageId === id && page.kind === 'detail')));
      assert((await stat(join(dir, 'public', variant.url))).isFile());
    }
    const variantHtml = await readFile(join(dir, 'public', views.variants[0].url), 'utf8');
    assert.match(variantHtml, new RegExp(`<link rel="canonical" href="http://127\\.0\\.0\\.1:4310${views.variants[0].canonical}">`));
  });
});

for (const linkMode of ['root-relative', 'relative']) test(`every facet, sort, tab and pager link opens a page with the right records on the preview server (${linkMode})`, async () => {
  await withSite(config({ site: { linkMode } }), async dir => {
    const truth = await readJson(join(dir, 'private', 'answer-key.json'));
    const views = await readJson(join(dir, 'private', 'drupal-views.json'));
    const byUrl = new Map(truth.pages.map(page => [page.url, page]));
    const variants = new Map(views.variants.map(variant => [variant.url, variant]));
    const preview = await serve(dir, { port: 0 });
    try {
      const seen = new Set();
      const queue = views.views.map(view => view.base);
      let checked = 0;
      while (queue.length) {
        const path = queue.shift();
        if (seen.has(path)) continue;
        seen.add(path);
        const response = await fetch(new URL(path, preview.url));
        assert.equal(response.status, 200, path);
        const $ = cheerio.load(await response.text());
        $.pageUrl = new URL(path, preview.url).href;
        const rows = viewRows($);
        const variant = variants.get(path);
        const page = byUrl.get(path);
        if (variant) {
          assert.deepEqual(rows, variant.recordPageIds.map(id => truth.pages.find(item => item.pageId === id).url), path);
          const records = rows.map(url => byUrl.get(url));
          if (variant.facet) {
            const facet = views.views.find(view => view.type === variant.type).facets.find(item => item.alias === variant.facet.alias);
            for (const record of records) assert.equal(facet.source.startsWith('year:') ? record.fields[facet.source.slice(5)].slice(0, 4) : record.fields[facet.source], variant.facet.value, path);
          }
          if (variant.sort === 'title-asc') for (let i = 1; i < records.length; i++) assert(records[i - 1].fields.title.localeCompare(records[i].fields.title, 'en', { sensitivity: 'base' }) <= 0, path);
          if (variant.sort === 'title-desc') for (let i = 1; i < records.length; i++) assert(records[i - 1].fields.title.localeCompare(records[i].fields.title, 'en', { sensitivity: 'base' }) >= 0, path);
          assert.match($('.views-result-summary').text(), new RegExp(` of ${variant.total} `));
        } else {
          assert(page?.kind === 'listing', `${path} is an answer-key listing`);
          assert.deepEqual(rows, page.links.filter(link => !/^(Previous|Next) page$/.test(link.label)).map(link => link.href), path);
        }
        checked++;
        const controls = $('.facet-item a, .facet-summary-items a, .bef-links a, .pager__item a, .tabs__link').map((_, a) => $(a).attr('href')).get();
        for (const href of controls) { const target = new URL(href, $.pageUrl).pathname; if (!seen.has(target)) queue.push(target); }
      }
      const listings = truth.pages.filter(page => page.kind === 'listing').map(page => page.url);
      assert.deepEqual([...seen].filter(path => !variants.has(path)).sort(), listings.sort(), 'controls reach every listing page and nothing else');
      assert.equal([...seen].filter(path => variants.has(path)).length, views.variants.length, 'every variant is reachable from the controls');
      assert(checked > 20);
    } finally { await preview.close(); }
  });
});

test('Drupal listings with repeated items keep the answer-key repeated-item locations', async () => {
  await withSite(config({ site: { domain: 'library', id: 'drupal-views-repeated' }, top: { variation: { amount: 40 } } }), async dir => {
    const truth = await readJson(join(dir, 'private', 'answer-key.json'));
    const listings = truth.pages.filter(page => page.kind === 'listing');
    assert(listings.length && listings.every(page => page.repeatedItems?.length && page.repeatedItemLocations?.length === page.repeatedItems.length));
    // Same answer key as the model built before rendering: rendering Views changes no truth.
    const model = createModel(validateConfig(config({ site: { domain: 'library', id: 'drupal-views-repeated' }, top: { variation: { amount: 40 } } })));
    for (const page of listings) {
      const source = model.pages.find(item => item.url === page.url);
      assert.deepEqual(page.repeatedItemLocations, source.repeatedItemLocations);
      const $ = cheerio.load(await readFile(join(dir, 'public', page.url, 'index.html'), 'utf8'));
      page.repeatedItemLocations.forEach((location, index) => {
        const item = page.repeatedItems[index];
        for (const [name, where] of Object.entries(location.fieldLocations)) {
          if (where.state !== 'present') continue;
          const node = $(where.selector);
          assert.equal(node.length, 1, `${page.url} ${where.selector}`);
          const text = where.read === 'afterStrongLabel' ? node.clone().children('strong').remove().end().text().trim() : node.text();
          assert.equal(text, item.fields[name], `${page.url} ${name}`);
        }
      });
    }
  });
});

test('non-Drupal profiles render no Views markup', () => {
  for (const cmsProfile of ['none', 'wordpress']) {
    const model = createModel(validateConfig(config({ site: { cmsProfile } })));
    const listing = model.pages.find(page => page.kind === 'listing');
    assert.doesNotMatch(renderPage(model.site, listing), /views-element-container|facets-widget-links|pager__items/);
  }
});

test('variant pages name their own file in og:url and hreflang, not the folder (regression 2026-11-02)', async () => {
  await withSite(config({ site: { sourceClutter: 'realistic' } }), async dir => {
    const views = await readJson(join(dir, 'private', 'drupal-views.json'));
    const variants = (views.variants ?? views.views?.flatMap(view => view.variants ?? []) ?? []).map(item => item.path ?? item.url).filter(Boolean);
    assert(variants.length > 5, 'expected variant pages in private/drupal-views.json');
    for (const path of variants.slice(0, 40)) {
      const $ = cheerio.load(await readFile(join(dir, 'public', path), 'utf8'));
      for (const value of [$('meta[property="og:url"]').attr('content'), $('link[rel="alternate"][hreflang="en"]').attr('href')].filter(Boolean)) {
        assert.equal(new URL(value).pathname, path.startsWith('/') ? path : `/${path}`, `${path}: ${value}`);
      }
    }
  });
});
