import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { validateConfig } from '../src/config.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { createModel } from '../src/model.mjs';
import { renderPage } from '../src/renderers.mjs';
import { attr, walk } from '../src/util.mjs';

const origin = 'https://base-relative.example';
const config = (variation = 0) => validateConfig({ seed: 124, variation: { amount: variation }, site: {
  id: 'base-relative-demo', baseUrl: origin, framework: 'html', pageCount: 12, linkMode: 'base-relative',
}, noise: { level: 'clean' } });

test('base-relative is explicit in the fixture lab and absent from seeded random choices', () => {
  const chosen = sitePlan({ name: 'Base mode', linkMode: 'base-relative' }, 0);
  assert.equal(chosen.summary.linkMode, 'base-relative');
  assert.equal(chosen.config.site.linkMode, 'base-relative');
  for (let seed = 0; seed < 32; seed++) {
    const random = sitePlan({ name: 'Random mode', linkMode: 'random', seed }, 0);
    assert(['relative', 'absolute', 'mixed'].includes(random.config.site.linkMode));
  }
});

test('nested pages resolve canonical edges and all assets through the first document base', () => {
  const model = createModel(config());
  const source = model.pages.find(page => page.kind === 'detail' && page.links.length);
  assert(source && source.url !== '/');
  const page = structuredClone(source);
  page.links.push({ label: 'Query and fragment', href: '/lookup/?q=1#part' });
  const document = parse(renderPage(model.site, page));
  const head = walk(document, node => node.tagName === 'head')[0];
  const base = walk(head, node => node.tagName === 'base')[0];
  const stylesheet = walk(head, node => node.tagName === 'link' && attr(node, 'rel') === 'stylesheet')[0];
  assert.equal(attr(base, 'href'), '/');
  assert(head.childNodes.indexOf(base) < head.childNodes.indexOf(stylesheet));
  const baseUrl = new URL(attr(base, 'href'), origin + page.url);
  assert.equal(baseUrl.href, origin + '/');
  const anchors = walk(document, node => node.tagName === 'a');
  const destinations = new Set(anchors.map(anchor => new URL(attr(anchor, 'href'), baseUrl).href));
  assert(anchors.some(anchor => {
    const href = attr(anchor, 'href');
    return href?.startsWith('./') && new URL(href, origin + page.url).href !== new URL(href, baseUrl).href;
  }), 'nested document URL must resolve at least one generated link differently');
  for (const link of page.links) assert(destinations.has(origin + link.href), link.href);
  for (const item of page.repeatedItems ?? []) assert(destinations.has(origin + item.url), item.url);
  assert(destinations.has(origin + '/'));
  assert(destinations.has(origin + '/lookup/?q=1#part'));
  assert.equal(attr(anchors.find(anchor => attr(anchor, 'class') === 'skip-link'), 'href'), `.${page.url}#content`);
  assert.equal(new URL(attr(anchors.find(anchor => attr(anchor, 'class') === 'skip-link'), 'href'), baseUrl).href, origin + page.url + '#content');
  for (const node of walk(document, node => node.tagName === 'img' || node.tagName === 'link' && ['stylesheet', 'icon'].includes(attr(node, 'rel')))) {
    const value = attr(node, node.tagName === 'img' ? 'src' : 'href');
    assert(value.startsWith('./'), value);
    assert.equal(new URL(value, baseUrl).origin, origin);
  }
  assert.equal(attr(walk(head, node => node.tagName === 'link' && attr(node, 'rel') === 'canonical')[0], 'href'), origin + page.url);
});

test('every generated page preserves source links and repeated-item targets', () => {
  const model = createModel(config(80));
  let repeatedItems = 0;
  for (const page of model.pages) {
    const document = parse(renderPage(model.site, page));
    const base = walk(document, node => node.tagName === 'base')[0];
    const baseUrl = new URL(attr(base, 'href'), origin + page.url);
    const main = walk(document, node => node.tagName === 'main')[0];
    const targets = new Set(walk(main, node => node.tagName === 'a').map(anchor => new URL(attr(anchor, 'href'), baseUrl).href));
    for (const link of page.links) assert(targets.has(origin + link.href), `${page.url}: ${link.href}`);
    for (const item of page.repeatedItems ?? []) {
      assert(targets.has(origin + item.url), `${page.url}: repeated ${item.url}`);
      repeatedItems++;
    }
  }
  assert(repeatedItems > 0);
});
