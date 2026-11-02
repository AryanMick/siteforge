import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'parse5';
import { serve } from '../src/server.mjs';

const sourceOrigin = 'http://site-001-library.siteforge.test';
const encodedPayload = value => JSON.stringify(value)
  .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.childNodes ?? []) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

function payloadFrom(html) {
  const script = find(parse(html), node => node.tagName === 'script' && node.attrs?.some(attribute => attribute.name === 'id' && attribute.value === 'page-data'));
  return JSON.parse(script.childNodes[0].value);
}

test('preview rebases client URLs without changing source-origin text or stored markup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-preview-rebase-'));
  const publicDir = join(root, 'public');
  const privateDir = join(root, 'private');
  await mkdir(publicDir);
  await mkdir(privateDir);
  await writeFile(join(privateDir, 'config.json'), JSON.stringify({ site: { baseUrl: sourceOrigin } }));
  const external = `https://elsewhere.example/path?reference=${sourceOrigin}#original`;
  const clientHtml = `<main><h1>${sourceOrigin}</h1><p title="${sourceOrigin}">Literal ${sourceOrigin}?q=1&amp;x=2#note &lt;/script&gt;</p><!-- ${sourceOrigin} --><a href="${sourceOrigin}/records/?q=1&amp;x=2#note">Record</a><a href="${external}">External</a><img src="${sourceOrigin}/assets/site.css" alt="${sourceOrigin}"><p class="wrapOuter">Original<div>malformed nesting</div></main>`;
  const nonconforming = JSON.stringify({ html: clientHtml });
  const original = `<!doctype html><html><head><link rel="canonical" href="${sourceOrigin}/"></head><body><script id="page-data" type="application/json">${encodedPayload([clientHtml, 0])}</script><script id="other-data" type="application/json">${encodedPayload([clientHtml, 0])}</script><script id="page-data" type="application/json">{invalid json</script><script id="page-data" type="application/json">${nonconforming}</script></body></html>`;
  await writeFile(join(publicDir, 'index.html'), original);
  const preview = await serve(root, { port: 0, rebaseOrigin: true });
  try {
    const response = await fetch(preview.url);
    const served = await response.text();
    assert.equal(response.status, 200);
    assert.equal(await readFile(join(publicDir, 'index.html'), 'utf8'), original);
    assert.match(served, new RegExp(`href="${preview.url}/"`));
    assert.match(served, /<script id="page-data" type="application\/json">\{invalid json<\/script>/);
    assert(served.includes(`<script id="page-data" type="application/json">${nonconforming}</script>`));
    assert.match(served, new RegExp(`<script id="other-data" type="application/json">${encodedPayload([clientHtml, 0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    const script = find(parse(served), node => node.tagName === 'script' && node.attrs?.some(attribute => attribute.name === 'id' && attribute.value === 'page-data'));
    assert(script.childNodes[0].value.includes('\\u003c'));
    assert(!script.childNodes[0].value.includes('</script>'));
    const [rebased] = payloadFrom(served);
    assert(rebased.includes(`<h1>${sourceOrigin}</h1>`));
    assert(rebased.includes(`Literal ${sourceOrigin}?q=1&amp;x=2#note &lt;/script&gt;`));
    assert(rebased.includes(`title="${sourceOrigin}"`));
    assert(rebased.includes(`alt="${sourceOrigin}"`));
    assert(rebased.includes(`<!-- ${sourceOrigin} -->`));
    assert(rebased.includes(`href="${preview.url}/records/?q=1&amp;x=2#note"`));
    assert(rebased.includes(`src="${preview.url}/assets/site.css"`));
    assert(rebased.includes(`href="${external}"`));
    assert(rebased.includes('<p class="wrapOuter">Original<div>malformed nesting</div>'));
  } finally {
    await preview.close();
    await rm(root, { recursive: true, force: true });
  }
});
