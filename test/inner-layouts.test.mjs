import assert from 'node:assert/strict';
import test from 'node:test';
import * as parse5 from 'parse5';
import { createModel } from '../src/site/model.mjs';
import { validateConfig } from '../src/site/config.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { DOMAINS } from '../src/site/presets.mjs';
import { innerCss, innerLookClasses, renderDetailVariant, renderListingVariant } from '../src/pages/inner-layouts.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const FIELDS = '<dl class="field-list"><dt>Marker label</dt><dd>FIELD-MARKER-VALUE</dd></dl>';
const RELATED = '<section aria-labelledby="related-heading"><h2 class="section-heading" id="related-heading">Related pages</h2><ul class="link-list"><li><a href="/related-marker/">RELATED-MARKER</a></li></ul></section><nav class="pager" aria-label="Pagination"><a href="/next-marker/">Next page</a></nav>';
const IMAGE = '<aside class="visual"><img src="/assets/image-marker.png" alt="IMAGE-MARKER" width="480" height="640"></aside>';
const FORBIDDEN_CLASSES = ['field-list', 'page-heading', 'lede', 'kicker', 'breadcrumb', 'repeated-records', 'record-cards', 'link-list', 'directory-table', 'visual'];

const models = new Map();
function model(domain, seed) {
  const key = `${domain}:${seed}`;
  if (!models.has(key)) models.set(key, createModel(validateConfig(sitePlan({ name: 'Test', domain, pagesPerSite: 40, seed, visualStyle: 'conventional', randomness: 50 }, 0).config)));
  return models.get(key);
}
const parts = (site, page, overrides = {}) => ({ fields: FIELDS, related: RELATED, image: IMAGE, esc, typeLabel: 'Type', sectionLabel: 'Section', siteName: site.name, ...overrides });
const firstOfEach = (pages, kind) => {
  const seen = new Map();
  for (const page of pages) {
    if (page.kind !== kind || page.contentType === 'information') continue;
    const type = kind === 'listing' ? page.pageId.replace(/-\d+$/, '') : page.contentType;
    if (!seen.has(type)) seen.set(type, page);
  }
  return [...seen.values()];
};
const count = (haystack, needle) => haystack.split(needle).length - 1;
// Structural signature: the element/class skeleton of the module's own markup.
const skeleton = html => (html.match(/<(div|section|aside|nav|form|ul|ol|table|details|figure)\b[^>]*class="(pg-[^"\s]*)/g) ?? [])
  .map(tag => tag.replace(/^<(\w+)[^>]*class="(pg-[^"\s]*).*$/, '$1.$2')).filter(tag => !/pg-(t|lt|a|skin|view)-/.test(tag)).join('>');

function assertContract(html, label) {
  assert.equal(count(html, FIELDS), 1, `${label}: fields included once`);
  assert.equal(count(html, RELATED), 1, `${label}: related included once`);
  assert.equal(count(html, IMAGE), 1, `${label}: image included once`);
  const own = html.replace(FIELDS, '').replace(RELATED, '').replace(IMAGE, '');
  assert.doesNotMatch(own, /<(img|h1|main|base|dl|dt|dd)\b/i, `${label}: forbidden element`);
  assert.doesNotMatch(own, /data-field/i, `${label}: data-field attribute`);
  for (const cls of FORBIDDEN_CLASSES) assert.doesNotMatch(own, new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`), `${label}: class ${cls}`);
  assert.doesNotMatch(own, /\sstyle=/i, `${label}: inline style`);
  const ids = [...own.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate ids ${ids}`);
  assert(ids.every(id => id.startsWith('pg-')), `${label}: unprefixed id`);
  for (const match of own.matchAll(/<a\b[^>]*>/g)) {
    const href = match[0].match(/href="([^"]*)"/)?.[1];
    assert.match(href ?? '', /^#pg-/, `${label}: only in-page links allowed (${match[0]})`);
    assert(ids.includes(href.slice(1)), `${label}: fragment ${href} has a target`);
  }
  for (const match of own.matchAll(/<button\b[^>]*>/g)) assert.match(match[0], /type="button"/, `${label}: button type`);
  for (const match of own.matchAll(/<form\b[^>]*>/g)) assert.match(match[0], /action="\/" method="get"/, `${label}: form target`);
  const errors = [];
  parse5.parseFragment(html, { onParseError: error => errors.push(error.code) });
  assert.deepEqual(errors, [], `${label}: parse errors`);
  assert.equal(count(html, '<div'), count(html, '</div>'), `${label}: divs closed`);
}

test('detail and listing variants keep every supplied part exactly once and add no forbidden markup', () => {
  for (const domain of DOMAINS) for (const seed of [1, 2, 3]) {
    const { site, pages } = model(domain, seed);
    for (const page of firstOfEach(pages, 'detail')) assertContract(renderDetailVariant(site, page, parts(site, page)), `${domain}/${seed}/${page.pageId}`);
    for (const page of firstOfEach(pages, 'listing')) assertContract(renderListingVariant(site, page, parts(site, page)), `${domain}/${seed}/${page.pageId}`);
  }
});

test('variants tolerate missing images, empty related markup and an empty-note field block', () => {
  for (const domain of DOMAINS) {
    const { site, pages } = model(domain, 5);
    for (const page of [...firstOfEach(pages, 'detail'), ...firstOfEach(pages, 'listing')]) {
      const render = page.kind === 'detail' ? renderDetailVariant : renderListingVariant;
      const html = render(site, page, parts(site, page, { image: '', related: '', fields: '<p class="empty-note">No additional details are available.</p>' }));
      assert.equal(count(html, 'empty-note'), 1);
      assert.doesNotMatch(html, /<img\b/);
      for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.match(html, new RegExp(`id="${match[1]}"`), `${domain} ${page.pageId} ${match[1]}`);
    }
  }
  const { site } = model('library', 1);
  const info = { pageId: 'information', url: '/site-information/', kind: 'detail', contentType: 'information', title: 'Site information', fields: { title: 'Site information' }, links: [] };
  assertContract(renderDetailVariant(site, info, parts(site, info)), 'information');
});

test('rendering is deterministic', () => {
  for (const domain of DOMAINS) {
    const { site, pages } = model(domain, 7);
    const again = model(domain, 7);
    for (const page of [...firstOfEach(pages, 'detail'), ...firstOfEach(pages, 'listing')]) {
      const render = page.kind === 'detail' ? renderDetailVariant : renderListingVariant;
      const copy = again.pages.find(candidate => candidate.pageId === page.pageId);
      assert.equal(render(site, page, parts(site, page)), render(site, copy, parts(site, copy)));
      assert.equal(innerLookClasses(site, page), innerLookClasses(again.site, copy));
    }
  }
});

test('each domain produces at least four structurally different detail and listing designs across seeds', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
  for (const domain of DOMAINS) {
    const detailByType = new Map();
    const listingByType = new Map();
    for (const seed of seeds) {
      const { site, pages } = model(domain, seed);
      for (const page of firstOfEach(pages, 'detail')) {
        if (!detailByType.has(page.contentType)) detailByType.set(page.contentType, new Set());
        detailByType.get(page.contentType).add(skeleton(renderDetailVariant(site, page, parts(site, page))));
      }
      for (const page of firstOfEach(pages, 'listing')) {
        const type = page.pageId.replace(/-\d+$/, '');
        if (!listingByType.has(type)) listingByType.set(type, new Set());
        listingByType.get(type).add(skeleton(renderListingVariant(site, page, parts(site, page))));
      }
    }
    for (const [type, designs] of detailByType) assert(designs.size >= 4, `${domain} ${type}: ${designs.size} detail designs`);
    for (const [type, designs] of listingByType) assert(designs.size >= 4, `${domain} ${type}: ${designs.size} listing designs`);
  }
});

test('different content types within one site get different structures', () => {
  for (const domain of DOMAINS) for (const seed of [1, 2, 3, 4]) {
    const { site, pages } = model(domain, seed);
    const details = firstOfEach(pages, 'detail').map(page => skeleton(renderDetailVariant(site, page, parts(site, page))));
    assert.equal(new Set(details).size, details.length, `${domain}/${seed} detail structures repeat`);
    const classes = firstOfEach(pages, 'detail').map(page => innerLookClasses(site, page));
    assert.equal(new Set(classes).size, classes.length, `${domain}/${seed} main classes repeat`);
  }
});

test('two sites of the same sector lay out the same content type differently', () => {
  for (const domain of DOMAINS) {
    const designs = new Set([1, 2, 3, 4, 5, 6].map(seed => {
      const { site, pages } = model(domain, seed);
      const page = firstOfEach(pages, 'detail')[0];
      return `${innerLookClasses(site, page)}|${skeleton(renderDetailVariant(site, page, parts(site, page)))}`;
    }));
    assert(designs.size >= 3, `${domain}: ${designs.size}`);
  }
});

test('inner stylesheet follows the responsive and theming rules', () => {
  const css = innerCss();
  assert.doesNotMatch(css, /white-space:\s*nowrap/);
  assert.doesNotMatch(css, /font-size:\s*(?:clamp|[^;]*vw)/);
  assert.doesNotMatch(css, /url\(|@import|@font-face/);
  assert.match(css, /@media \(max-width: 720px\)/);
  for (const token of ['--accent', '--accent-strong', '--ink', '--muted', '--paper', '--wash', '--line', '--heading-font']) assert(css.includes(`var(${token}`), token);
  const { site, pages } = model('library', 1);
  assert.match(innerLookClasses(site, pages.find(page => page.kind === 'detail')), /^inner-v-\d inner-detail inner-d-\w+ inner-a-\w+$/);
  assert.match(innerLookClasses(site, pages.find(page => page.kind === 'listing')), /^inner-v-\d inner-listing inner-l-\w+ inner-a-\w+$/);
});
