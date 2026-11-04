import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as parse5 from 'parse5';
import { generate } from '../src/site/generator.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { walk, attr } from '../src/site/util.mjs';

const plan = (domain, cmsProfile, seed, sourceClutter = 'realistic') => sitePlan({ name: 'Clutter', domain, pagesPerSite: 20, seed, visualStyle: 'conventional', randomness: 50, cmsProfile, noise: 'clean', sourceClutter }, 0);

test('realistic page source is long, valid and references only files that exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-clutter-'));
  try {
    for (const [domain, cms, seed] of [['news', 'wordpress', 3], ['library', 'drupal', 4], ['university', 'none', 5]]) {
      const directory = join(root, `${domain}-${cms}`);
      await generate(plan(domain, cms, seed).config, directory);
      const answer = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
      for (const page of answer.pages.filter((item, index, all) => all.findIndex(other => other.kind === item.kind) === index)) {
        const html = await readFile(join(directory, 'public', ...page.url.split('/').filter(Boolean), 'index.html'), 'utf8');
        const lines = html.split('\n').length;
        assert(lines >= (page.kind === 'home' ? 1800 : 1100), `${domain}/${cms}/${page.kind}: only ${lines} lines`);
        const document = parse5.parse(html);
        assert.equal(walk(document, node => node.tagName === 'main').length, 1);
        assert.equal(walk(document, node => node.tagName === 'h1').length, 1);
        assert.equal(walk(document, node => node.tagName === 'main')[0].parentNode.tagName, 'body');
        const ids = walk(document, node => attr(node, 'id') !== undefined).map(node => attr(node, 'id'));
        assert.equal(new Set(ids).size, ids.length, `${domain}/${cms}: duplicate ids`);
        for (const node of walk(document, item => ['script', 'img'].includes(item.tagName) && attr(item, 'src') || item.tagName === 'link' && ['stylesheet', 'icon', 'manifest', 'apple-touch-icon'].includes(attr(item, 'rel')))) {
          const value = attr(node, node.tagName === 'link' ? 'href' : 'src');
          const url = new URL(value, `http://example.test${page.url}`);
          assert.equal(url.host, 'example.test', `${value} must be local`);
          await stat(join(directory, 'public', ...decodeURIComponent(url.pathname).split('/').filter(Boolean)));
        }
        if (cms === 'none') assert.doesNotMatch(html, /wp-content|wp-includes|name="generator"|drupal|sites\/default\/files|wp-theme/i);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('clutter is deterministic per seed and differs between seeds, and never changes the answer key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-clutter-'));
  try {
    const read = async (name, config) => { await generate(config, join(root, name)); return [await readFile(join(root, name, 'public', 'index.html'), 'utf8'), await readFile(join(root, name, 'private', 'answer-key.json'), 'utf8')]; };
    const [a1, k1] = await read('a1', plan('museum', 'wordpress', 9).config);
    const [a2] = await read('a2', plan('museum', 'wordpress', 9).config);
    const [b] = await read('b', plan('museum', 'wordpress', 10).config);
    const [clean, k2] = await read('clean', plan('museum', 'wordpress', 9, 'none').config);
    assert.equal(a1, a2);
    assert.notEqual(a1, b);
    assert(clean.split('\n').length < a1.split('\n').length / 3);
    const pages = value => JSON.parse(value).pages;
    assert.deepEqual(pages(k1), pages(k2), 'page source clutter must not change the answer key');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('realistic sites are served gzip-compressed when accepted, identical once decoded', async () => {
  const { serve } = await import('../src/preview/server.mjs');
  const { request } = await import('node:http');
  const { gunzipSync } = await import('node:zlib');
  const root = await mkdtemp(join(tmpdir(), 'siteforge-gzip-'));
  try {
    for (const clutter of ['realistic', 'none']) {
      const directory = join(root, clutter);
      await generate(plan('news', 'wordpress', 3, clutter).config, directory);
      const preview = await serve(directory, { port: 0 });
      try {
        const raw = await new Promise((resolve, reject) => request(`${preview.url}/`, { headers: { 'accept-encoding': 'gzip' } }, res => {
          const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject).end());
        const plain = await readFile(join(directory, 'public', 'index.html'));
        if (clutter === 'realistic') {
          assert.equal(raw.headers['content-encoding'], 'gzip');
          assert.match(raw.headers.vary, /Accept-Encoding/);
          assert(raw.body.length < plain.length / 3);
          assert.deepEqual(gunzipSync(raw.body), plain);
        } else {
          assert.equal(raw.headers['content-encoding'], undefined);
          assert.deepEqual(raw.body, plain);
        }
        const identity = await fetch(`${preview.url}/`, { headers: { 'accept-encoding': 'identity' } });
        assert.equal(Buffer.compare(Buffer.from(await identity.arrayBuffer()), plain), 0);
      } finally { await preview.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('realistic sites answer missing pages with a themed 404 and ship CMS-style robots.txt', async () => {
  const { serve } = await import('../src/preview/server.mjs');
  const root = await mkdtemp(join(tmpdir(), 'siteforge-404-'));
  try {
    for (const [cms, clutter] of [['drupal', 'realistic'], ['wordpress', 'realistic'], ['wordpress', 'none']]) {
      const directory = join(root, `${cms}-${clutter}`);
      await generate(plan('library', cms, 8, clutter).config, directory);
      const robots = await readFile(join(directory, 'public', 'robots.txt'), 'utf8');
      assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
      if (cms === 'drupal') assert.match(robots, /Disallow: \/user\/login/);
      if (cms === 'wordpress') assert.match(robots, /Disallow: \/wp-admin\/\nAllow: \/wp-admin\/admin-ajax\.php/);
      const preview = await serve(directory, { port: 0, rebaseOrigin: true });
      try {
        for (const path of ['/no-such-page/', '/private/answer-key.json', '/books/missing.html']) {
          const response = await fetch(preview.url + path);
          const text = await response.text();
          assert.equal(response.status, 404, path);
          assert.doesNotMatch(text, /"pages"|canonicalValues|fieldLocations/, `${path} must not leak private data`);
          if (clutter === 'realistic') {
            assert.match(text, /<h1>Page not found<\/h1>/);
            assert.match(text, /<meta name="robots" content="noindex">/);
            assert.match(text, /class="site-header/);
            assert.match(response.headers.get('server') ?? '', cms === 'drupal' ? /Apache/ : /nginx/);
          } else assert.equal(text, 'Not found');
        }
      } finally { await preview.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
