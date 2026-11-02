import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import { parse } from 'parse5';
import { sitePlan } from '../../src/fixture-lab/config.mjs';
import { validateConfig } from '../../src/config.mjs';
import { createModel } from '../../src/model.mjs';
import { renderPage } from '../../src/renderers.mjs';
import { applyHtmlNoise } from '../../src/noise.mjs';
import { attr, walk } from '../../src/util.mjs';

interface BaseWorld extends World {
  request: Record<string, unknown>;
  plan: ReturnType<typeof sitePlan>;
  site: ReturnType<typeof createModel>['site'];
  record: ReturnType<typeof createModel>['pages'][number];
  document: ReturnType<typeof parse>;
  html: string;
}
const hasTag = (tagName: string) => (node: any) => node.tagName === tagName;

Given('a fixture request selects document base relative links', function(this: BaseWorld) {
  this.request = { name: 'Base relative', linkMode: 'base-relative', seed: 74 };
});
When('its site plan is built', function(this: BaseWorld) {
  this.plan = sitePlan(this.request, 0);
});
Then('the plan retains document base relative links without changing the random link choices', function(this: BaseWorld) {
  assert('linkMode' in this.plan.config.site);
  assert('linkMode' in this.plan.summary);
  assert.equal(this.plan.config.site.linkMode, 'base-relative');
  assert.equal(this.plan.summary.linkMode, 'base-relative');
  const random = sitePlan({ ...this.request, linkMode: 'random' }, 0);
  assert('linkMode' in random.config.site);
  assert(['relative', 'absolute', 'mixed'].includes(random.config.site.linkMode));
});

Given('a nested record in document base relative mode', function(this: BaseWorld) {
  const model = createModel(validateConfig({ seed: 74, site: {
    id: 'base-bdd', baseUrl: 'https://base.example', pageCount: 12, linkMode: 'base-relative',
  } }));
  this.site = model.site;
  this.record = model.pages.find(page => page.kind === 'detail' && page.links.length)!;
  assert(this.record?.url !== '/');
});
When('its public HTML is rendered', function(this: BaseWorld) {
  this.document = parse(renderPage(this.site, this.record));
});
Then('the first document base resolves its links to source canonical targets', function(this: BaseWorld) {
  const head = walk(this.document, hasTag('head'))[0];
  const bases = walk(head, hasTag('base'));
  assert.equal(bases.length, 1);
  assert.equal(attr(bases[0], 'href'), '/');
  const baseUrl = new URL(attr(bases[0], 'href'), `${this.site.baseUrl}${this.record.url}`);
  const anchors = walk(this.document, hasTag('main')).flatMap(main => walk(main, hasTag('a')));
  const targets = new Set(anchors.map(anchor => new URL(attr(anchor, 'href'), baseUrl).href));
  for (const link of this.record.links) assert(targets.has(`${this.site.baseUrl}${link.href}`), link.href);
  assert(anchors.some(anchor => new URL(attr(anchor, 'href'), `${this.site.baseUrl}${this.record.url}`).href !== new URL(attr(anchor, 'href'), baseUrl).href));
});
Then('its skip link resolves to the same record content', function(this: BaseWorld) {
  const base = walk(this.document, hasTag('base'))[0];
  const skip = walk(this.document, (node: any) => node.tagName === 'a' && attr(node, 'class') === 'skip-link')[0];
  const target = new URL(attr(skip, 'href'), new URL(attr(base, 'href'), this.site.baseUrl));
  assert.equal(target.href, `${this.site.baseUrl}${this.record.url}#content`);
});

Given('a nested public page with two different document bases', function(this: BaseWorld) {
  this.site = { baseUrl: 'https://base.example' } as BaseWorld['site'];
  this.record = { url: '/nested/record/', noiseEvents: [{ type: 'javascript-only-link', severity: 1 }] } as BaseWorld['record'];
  this.html = '<!doctype html><html><head><base href="/first/"><base href="/decoy/"></head><body><main><a href="./target/">Target</a></main></body></html>';
});
When('JavaScript only link noise is applied', function(this: BaseWorld) {
  this.document = parse(applyHtmlNoise(this.html, this.record, this.site));
});
Then('its handler uses the destination from the first base', function(this: BaseWorld) {
  const anchor = walk(this.document, hasTag('a'))[0];
  assert.equal(attr(anchor, 'onclick'), "window.location.href='/first/target/'");
});
