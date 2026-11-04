import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'parse5';
import { createLegacyFixture } from '../src/noise/legacy-fixture.mjs';
import { auditLocalContrast } from '../src/site/contrast-audit.mjs';
import { serve } from '../src/preview/server.mjs';
import { walk, attr, textContent } from '../src/site/util.mjs';

test('fixture is complete, private, structurally varied, and refuses an existing root', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'siteforge-legacy-unit-'));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const out = join(parent, 'fixture');
  const created = await createLegacyFixture(out);
  assert.equal(created.pages, 10);
  await assert.rejects(createLegacyFixture(out), /already exists/);

  const truth = JSON.parse(await readFile(created.truthPath, 'utf8'));
  assert.equal(truth.version, 1);
  assert.deepEqual(truth.site, { id: 'legacy-library-controlled', baseUrl: 'http://127.0.0.1:4310', framework: 'html', noise: { level: 'custom' } });
  assert.deepEqual(truth.schemas.book, ['title', 'author', 'publicationDate', 'summary']);
  assert.deepEqual(truth.schemas.author, ['title', 'name', 'biography']);
  assert.equal(truth.pages.filter((page) => page.contentType === 'book').length, 3);
  assert.equal(truth.pages.filter((page) => page.contentType === 'author').length, 2);
  for (const page of truth.pages) {
    assert.deepEqual(page.fields, page.canonicalValues);
    assert(Object.values(page.fieldStates).every((state) => state === 'present'));
    assert.deepEqual(page.relationships, []);
    assert.deepEqual(page.noiseEvents, []);
  }

  const files = [];
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = join(prefix, entry.name);
      if (entry.isDirectory()) await collect(join(directory, entry.name), relative);
      else files.push(relative);
    }
  }
  await collect(created.publicDir);
  assert.equal(files.filter((file) => file.endsWith('.html')).length, truth.pages.length);
  const publicText = (await Promise.all(files.filter((file) => file.endsWith('.html')).map((file) => readFile(join(created.publicDir, file), 'utf8')))).join('\n');
  for (const secret of ['expectedCluster', 'canonicalValues', 'pageId', ...truth.pages.map((page) => page.pageId), ...new Set(truth.pages.map((page) => page.expectedCluster))]) {
    assert(!publicText.includes(secret), `public HTML leaked ${secret}`);
  }
  assert(publicText.includes('/private/ground-truth.json'));
  assert(publicText.includes('onclick="location.href='));
  assert(publicText.includes('http-equiv="refresh"'));
  assert(publicText.includes('color: #bbb'));
  assert(publicText.includes('color: #222'));

  const home = parse(await readFile(join(created.publicDir, 'index.html'), 'utf8'));
  const homeLinks = new Set(walk(home, (node) => node.tagName === 'a').map((node) => attr(node, 'href')));
  for (const page of truth.pages.filter((page) => page.url !== '/')) {
    assert(homeLinks.has(page.url), `home page does not link declared URL ${page.url}`);
  }

  const semantic = parse(await readFile(join(created.publicDir, 'books/wind-harbor.html'), 'utf8'));
  const table = parse(await readFile(join(created.publicDir, 'books/glass-orchard.html'), 'utf8'));
  const malformedSource = await readFile(join(created.publicDir, 'books/night-index.html'), 'utf8');
  const malformed = parse(malformedSource);
  assert.equal(walk(semantic, (node) => node.tagName === 'dl').length, 1);
  assert.equal(walk(table, (node) => node.tagName === 'table').length, 1);
  assert(malformedSource.includes('<p class="wrapOuter">Archived record starts here<div'));
  assert.equal(walk(malformed, (node) => attr(node, 'id') === 'edition').length, 2);
  for (const expected of truth.pages.find((page) => page.url.endsWith('night-index.html')).fields ? Object.values(truth.pages.find((page) => page.url.endsWith('night-index.html')).fields) : []) {
    assert(textContent(malformed).includes(expected));
  }
});

test('server exposes public pages but not private truth', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'siteforge-legacy-server-'));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const out = join(parent, 'fixture');
  await createLegacyFixture(out);
  const server = await serve(out, { port: 0 });
  try {
    assert.equal((await fetch(server.url)).status, 200);
    assert.equal((await fetch(`${server.url}/books/wind-harbor.html`)).status, 200);
    assert.equal((await fetch(`${server.url}/private/ground-truth.json`)).status, 404);
    assert.equal((await fetch(`${server.url}/missing-shelf.html`)).status, 404);
  } finally {
    await server.close();
  }
});

test('contrast audit rejects external, authenticated, traversal, and private targets before launch', async () => {
  await assert.rejects(auditLocalContrast('https://127.0.0.1:4310', ['/']), /HTTP loopback/);
  await assert.rejects(auditLocalContrast('http://user@127.0.0.1:4310', ['/']), /HTTP loopback/);
  await assert.rejects(auditLocalContrast('http://example.com', ['/']), /HTTP loopback/);
  await assert.rejects(auditLocalContrast('http://127.0.0.1:4310', ['https://example.com']), /same-origin absolute path/);
  await assert.rejects(auditLocalContrast('http://127.0.0.1:4310', ['/%2e%2e/private/ground-truth.json']), /private fixture data|stay on the supplied origin/);
  await assert.rejects(auditLocalContrast('http://127.0.0.1:4310', ['/%70rivate/ground-truth.json']), /private fixture data/);
  await assert.rejects(auditLocalContrast('http://127.0.0.1:4310', ['/private/ground-truth.json']), /private fixture data/);
});
