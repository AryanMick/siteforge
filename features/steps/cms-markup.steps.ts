import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import * as parse5 from 'parse5';
import { validateConfig } from '../../src/site/config.mjs';
import { createModel } from '../../src/site/model.mjs';
import { renderPage } from '../../src/render/renderers.mjs';

type CmsNode = { tagName?: string; value?: string; attrs?: { name: string; value: string }[];
  childNodes?: CmsNode[]; parentNode?: CmsNode };
interface CmsWorld extends World {
  cmsProfile: string;
  builderProfile: string;
  html: string;
  title: string;
  pageSets: unknown[][];
}

const profiles = [
  ['none', 'none'], ['wordpress', 'none'], ['wordpress', 'gutenberg'],
  ['wordpress', 'elementor'], ['wordpress', 'beaver-builder'], ['wordpress', 'divi'], ['wordpress', 'wpbakery'], ['drupal', 'none'],
];

function source(cmsProfile: string, builderProfile: string) {
  return createModel(validateConfig({ version: 1, seed: 31,
    site: { id: 'bdd-cms', pageCount: 7, cmsProfile, builderProfile },
    contentTypes: [{ name: 'book', label: 'Books', fields: [
      { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
    ] }], noise: { level: 'clean' } }));
}

function find(node: CmsNode, predicate: (node: CmsNode) => boolean): CmsNode | undefined {
  if (predicate(node)) return node;
  for (const child of node.childNodes ?? []) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function nodeText(node: CmsNode): string {
  return node.value ?? (node.childNodes ?? []).map(nodeText).join('');
}

Given('a {string} CMS with the {string} builder', function(this: CmsWorld, cms: string, builder: string) {
  this.cmsProfile = cms;
  this.builderProfile = builder;
});

When('a source detail page is rendered', function(this: CmsWorld) {
  const model = source(this.cmsProfile, this.builderProfile);
  const record = model.pages.find(page => page.kind === 'detail' && page.contentType === 'book');
  assert(record);
  this.title = record.title;
  this.html = renderPage(model.site, record);
});

Then('the main landmark contains the source heading and CMS content', function(this: CmsWorld) {
  const document = parse5.parse(this.html) as unknown as CmsNode;
  const main = find(document, node => node.tagName === 'main');
  assert(main);
  assert.equal(main.parentNode?.tagName, 'body');
  const heading = main.childNodes?.find(node => node.tagName === 'header'
    && node.attrs?.find(attribute => attribute.name === 'class')?.value === 'page-heading');
  assert(heading);
  const h1 = find(heading, node => node.tagName === 'h1');
  assert(h1);
  assert.equal(nodeText(h1), this.title);
  if (this.cmsProfile !== 'none') assert(find(main, node => node.tagName === 'article'));
});

Then('the CMS markup has the expected {string} signature', function(this: CmsWorld, marker: string) {
  assert(this.html.includes(marker));
  if (this.cmsProfile === 'drupal') assert(!/field--name-body|data-history-node-id/.test(this.html));
  if (this.builderProfile === 'elementor') {
    assert.match(this.html, /data-elementor-id="\d+"/);
    assert.match(this.html, /data-element_type="container"/);
    assert.match(this.html, /data-widget_type="html.default"/);
  }
  if (this.builderProfile === 'beaver-builder') {
    const document = parse5.parse(this.html) as unknown as CmsNode;
    const classes = (node: CmsNode) => node.attrs?.find(attribute => attribute.name === 'class')?.value.split(' ') ?? [];
    const child = (node: CmsNode, className: string) => node.childNodes?.find(candidate => classes(candidate).includes(className));
    let node = find(document, candidate => classes(candidate).includes('entry-content'));
    assert(node);
    for (const className of ['fl-builder-content', 'fl-row', 'fl-row-content-wrap', 'fl-row-content',
      'fl-col-group', 'fl-col', 'fl-col-content', 'fl-module-html', 'fl-module-content', 'fl-html']) {
      node = child(node, className);
      assert(node, `Missing Beaver Builder ${className} child`);
      if (['fl-row', 'fl-col-group', 'fl-col', 'fl-module-html'].includes(className)) {
        const token = node.attrs?.find(attribute => attribute.name === 'data-node')?.value;
        assert.match(token ?? '', /^[a-f0-9]{8}$/);
        assert(classes(node).includes(`fl-node-${token}`));
      }
    }
  }
});

When('the same source is constructed for every CMS profile', function(this: CmsWorld) {
  this.pageSets = profiles.map(([cms, builder]) => source(cms, builder).pages);
});

Then('every profile has the same private page records', function(this: CmsWorld) {
  for (const pages of this.pageSets.slice(1)) assert.deepEqual(pages, this.pageSets[0]);
});
