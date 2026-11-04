import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { parse } from 'parse5';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { applyDataNoise, applyHtmlNoise } from '../src/noise/noise.mjs';
import { renderPage } from '../src/render/renderers.mjs';
import { walk } from '../src/site/util.mjs';

const modes = ['root-relative', 'relative', 'absolute', 'mixed', 'base-relative'];
const input = mode => ({
  seed: 124,
  site: { id: 'link-demo', framework: 'html', pageCount: 8,
    baseUrl: 'http://link-demo.siteforge.test', linkMode: mode },
  noise: { level: 'custom', probability: 1, maxPerPage: 1, types: ['javascript-only-link'] },
});
const attribute = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const mainAnchors = html => {
  const main = walk(parse(html), node => node.tagName === 'main')[0];
  return walk(main, node => node.tagName === 'a');
};

test('javascript-only-link truth corresponds to a same-site mutation in every link mode', () => {
  for (const mode of modes) {
    const model = createModel(validateConfig(input(mode)));
    const canonical = model.pages.find(page => page.kind === 'detail');
    const observed = applyDataNoise(canonical, model.site);
    assert.deepEqual(observed.noiseEvents.map(event => event.type), ['javascript-only-link']);
    const clean = renderPage(model.site, canonical);
    const noisy = applyHtmlNoise(renderPage(model.site, observed), observed, model.site);
    const original = mainAnchors(clean)[0];
    const mutated = mainAnchors(noisy)[0];
    const documentUrl = new URL(canonical.url, model.site.baseUrl);
    const base = walk(parse(clean), node => node.tagName === 'base')[0];
    const destination = new URL(attribute(original, 'href'), base ? new URL(attribute(base, 'href'), documentUrl) : documentUrl);
    assert.equal(destination.origin, new URL(model.site.baseUrl).origin);
    assert.equal(attribute(mutated, 'href'), 'javascript:void(0)', mode);
    assert.equal(attribute(mutated, 'onclick'),
      `window.location.href='${destination.pathname + destination.search + destination.hash}'`, mode);
    assert.notEqual(noisy, clean, mode);
  }
});

test('javascript-only-link uses the first document base despite a later decoy', () => {
  const site = { baseUrl: 'https://archive.example' };
  const page = { url: '/nested/record/', noiseEvents: [{ type: 'javascript-only-link', severity: 1 }] };
  const html = '<!doctype html><html><head><base href="/archive/"><base href="/wrong/"></head>'
    + '<body><main><a href="./related/?q=1#part">Related</a></main></body></html>';
  const anchor = mainAnchors(applyHtmlNoise(html, page, site))[0];
  assert.equal(attribute(anchor, 'href'), 'javascript:void(0)');
  assert.equal(attribute(anchor, 'onclick'), "window.location.href='/archive/related/?q=1#part'");
});

test('an invalid first base falls back to the document URL despite a later base', () => {
  const site = { baseUrl: 'https://archive.example' };
  const page = { url: '/nested/record/', noiseEvents: [{ type: 'javascript-only-link', severity: 1 }] };
  for (const invalid of ['http://[', 'data:text/plain,wrong', 'javascript:alert(1)']) {
    const html = `<!doctype html><html><head><base href="${invalid}"><base href="/wrong/"></head>`
      + '<body><main><a href="./related/">Related</a></main></body></html>';
    const anchor = mainAnchors(applyHtmlNoise(html, page, site))[0];
    assert.equal(attribute(anchor, 'onclick'), "window.location.href='/nested/record/related/'", invalid);
  }
});

test('javascript-only-link skips unsafe candidates and serializes a safe destination', () => {
  const site = { baseUrl: 'https://archive.example' };
  const page = { url: '/record/', noiseEvents: [{ type: 'javascript-only-link', severity: 1 }] };
  const html = '<!doctype html><html><body><main><a href="javascript:alert(1)">Script</a>'
    + '<a href="//outside.example/">Outside</a><a href="https://outside.example/">External</a>'
    + '<a href="https://archive.example//outside.example/path">Double slash</a>'
    + '<a href="https://archive.example/\\\\outside.example/path">Backslash</a>'
    + '<a href="/\\\\outside.example/path">Root backslash</a>'
    + '<a href="https://user:pass@archive.example/record/">Credentials</a>'
    + '<a href="./O&#39;Reilly/?q=%22%3Balert(1)%2F%2F">Related</a></main></body></html>';
  const anchors = mainAnchors(applyHtmlNoise(html, page, site));
  assert.deepEqual(anchors.slice(0, 7).map(anchor => attribute(anchor, 'href')),
    ['javascript:alert(1)', '//outside.example/', 'https://outside.example/',
      'https://archive.example//outside.example/path',
      'https://archive.example/\\\\outside.example/path',
      '/\\\\outside.example/path',
      'https://user:pass@archive.example/record/']);
  assert(anchors.slice(0, 7).every(anchor => attribute(anchor, 'onclick') === undefined));
  assert.equal(attribute(anchors[7], 'href'), 'javascript:void(0)');
  assert.equal(attribute(anchors[7], 'onclick'),
    "window.location.href='/record/O\\u0027Reilly/?q=%22%3Balert(1)%2F%2F'");
  const context = { window: { location: { href: '' } } };
  runInNewContext(attribute(anchors[7], 'onclick'), context);
  assert.equal(new URL(context.window.location.href, site.baseUrl).origin, site.baseUrl);
});

test('encoded leading backslashes remain local in the serialized handler', () => {
  const site = { baseUrl: 'https://archive.example' };
  const page = { url: '/record/', noiseEvents: [{ type: 'javascript-only-link', severity: 1 }] };
  const html = '<!doctype html><html><body><main><a href="/%5C%5Coutside.example/path">Encoded</a></main></body></html>';
  const anchor = mainAnchors(applyHtmlNoise(html, page, site))[0];
  assert.equal(attribute(anchor, 'href'), 'javascript:void(0)');
  assert.equal(attribute(anchor, 'onclick'), "window.location.href='/%5C%5Coutside.example/path'");
  assert.equal(new URL('/%5C%5Coutside.example/path', site.baseUrl).origin, site.baseUrl);
});
