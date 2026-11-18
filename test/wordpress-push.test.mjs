// WordPress push without a WordPress: payloads, batching, streaming and the saved answer key, with a fake fetch
// that answers like the SiteForge Importer plugin. Also lints the plugin's PHP when php is installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/site/generator.mjs';
import { evaluate } from '../src/answers/evaluator.mjs';
import { loadSite, pushSiteToWordPress, recordBatches, recordDate, resetSiteInWordPress, streamJsonArray, typeSpec } from '../src/wordpress/push.mjs';
import { WordPressError, wordpressClient } from '../src/wordpress/client.mjs';
import { inspectWordPress } from '../src/wordpress/inspect.mjs';

const pluginDir = fileURLToPath(new URL('../wordpress/siteforge-importer/', import.meta.url));
let root, siteDir;

test.before(async () => {
  root = await mkdtemp(join(tmpdir(), 'siteforge-wp-push-'));
  siteDir = join(root, 'library');
  await generate({ version: 1, seed: 4242, site: { id: 'wp-test', domain: 'library', pageCount: 40, pageSize: 5 }, noise: { level: 'clean' } }, siteDir);
});
test.after(async () => { await rm(root, { recursive: true, force: true }); });

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A stand-in for the plugin: keeps posts by external ID, answers the routes the pusher calls.
function fakeWordPress({ perPage = 10 } = {}) {
  const posts = new Map();
  const calls = [];
  const types = new Map();
  let nextId = 100;
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    const route = url.searchParams.get('rest_route').replace('/siteforge/v1', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ route, body, token: init.headers['X-SiteForge-Token'] });
    if (init.headers['X-SiteForge-Token'] !== 'secret') return json(401, { code: 'siteforge_forbidden', message: 'bad token' });
    if (route === '/status') return json(200, { wordpress: { version: '6.9', php: '8.3', home: 'http://wp.test/', admin: 'http://wp.test/wp-admin/', permalinkStructure: '/%postname%/', postsPerPage: perPage }, theme: { name: 'Twenty Twenty-Five', version: '1.4', is_block_theme: true }, elementor: { active: false }, plugins: [], sites: [] });
    if (route === '/import') {
      for (const type of body.types) types.set(type.name, type);
      const results = body.records.map(record => {
        const existing = posts.get(record.externalId);
        const post = { ...record, postId: existing?.postId ?? nextId++, url: `/${types.get(record.type).slug}/${record.slug}/` };
        posts.set(record.externalId, post);
        return { externalId: record.externalId, postId: post.postId, url: `http://wp.test${post.url}`, status: existing ? 'unchanged' : 'created' };
      });
      return json(200, { types: body.types.map(type => ({ name: type.name, postType: type.name === 'author' ? 'sf_author' : type.name, reused: false, label: type.label, archiveUrl: `http://wp.test/${type.slug}/` })), results, created: results.filter(r => r.status === 'created').length, updated: 0, unchanged: results.filter(r => r.status === 'unchanged').length, failed: 0 });
    }
    if (route === '/relationships') return json(200, { processed: posts.size, updated: 3, total: posts.size, nextOffset: null });
    if (route === '/pages') return json(200, { pageId: 1, url: 'http://wp.test/home/', frontPage: body.setFrontPage, links: types.size });
    if (route === '/reset') { const deleted = posts.size; posts.clear(); return json(200, { deleted, remaining: 0, done: true, removedTypes: [...types.keys()] }); }
    if (route === '/types') return json(200, { postTypes: [{ name: 'book', label: 'Books', singular: 'Book', public: true, showUi: true, registeredBy: 'siteforge', published: 8, archiveUrl: 'http://wp.test/books/', metaKeys: ['author'], taxonomies: ['topic'], supports: ['title'] }], taxonomies: [] });
    if (route === '/match') return json(200, { matches: body.types.map(type => ({ name: type.name, label: type.label, postType: type.name === 'event' ? 'tribe_events' : type.name, reused: type.name === 'event', reason: type.name === 'event' ? 'known equivalent' : 'new' })) });
    if (route === '/answer-key') {
      // Records in import order, then archive pages listing them newest first (the pusher dates them that way).
      const all = [...posts.values()].sort((a, b) => a.order - b.order);
      const entries = all.map(post => ({ pageId: post.externalId, url: post.url, kind: 'detail', contentType: post.type, expectedCluster: post.type, fields: { title: post.title, ...post.fields }, canonicalValues: { title: post.title, ...post.fields }, fieldStates: Object.fromEntries(['title', ...Object.keys(post.fields)].map(key => [key, 'present'])), relationships: post.relationships.map(rel => ({ type: rel.type, targetUrl: posts.get(rel.targetExternalId).url })), noiseEvents: [] }));
      for (const type of types.values()) {
        const items = all.filter(post => post.type === type.name).sort((a, b) => b.date.localeCompare(a.date));
        for (let n = 0; n * perPage < items.length; n++) {
          entries.push({ pageId: `archive-${type.name}-${n + 1}`, url: n ? `/${type.slug}/page/${n + 1}/` : `/${type.slug}/`, kind: 'listing', contentType: 'listing', expectedCluster: 'listing', fields: { title: `Archives: ${type.label}` }, canonicalValues: { title: `Archives: ${type.label}` }, fieldStates: { title: 'present' }, relationships: [], repeatedItems: items.slice(n * perPage, (n + 1) * perPage).map(post => ({ pageId: post.externalId, url: post.url, fields: { title: post.title } })), noiseEvents: [] });
        }
      }
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 0) || entries.length;
      const end = Math.min(entries.length, offset + limit);
      return json(200, { version: 1, site: { id: body?.siteId ?? url.searchParams.get('siteId'), baseUrl: 'http://wp.test', framework: 'html', noise: { level: 'clean' } }, schemas: {}, total: entries.length, offset, limit, nextOffset: end < entries.length ? end : null, pages: entries.slice(offset, end) });
    }
    return json(404, { code: 'rest_no_route', message: 'No route' });
  };
  return { fetch, calls, posts };
}

test('streamJsonArray yields every canonical page, also across tiny chunks', async () => {
  const file = join(siteDir, 'private', 'canonical.json');
  const expected = JSON.parse(await readFile(file, 'utf8')).pages;
  for (const chunkSize of [7, 1000, 1 << 20]) {
    const pages = [];
    for await (const page of streamJsonArray(file, 'pages', { chunkSize })) pages.push(page);
    assert.deepEqual(pages, expected, `chunk size ${chunkSize}`);
  }
});

test('loadSite builds the type spec from the generated site', async () => {
  const site = await loadSite(siteDir);
  assert.equal(site.id, 'wp-test');
  assert.equal(site.records, Object.values(site.counts).reduce((a, b) => a + b, 0));
  const spec = typeSpec(site);
  assert.deepEqual(spec.map(type => [type.name, type.slug]), [['book', 'books'], ['author', 'authors'], ['event', 'events'], ['branch', 'branches']]);
  const book = spec.find(type => type.name === 'book');
  assert.ok(!book.fields.some(field => field.name === 'title'), 'title is the post title, not a field');
  assert.equal(book.fields.find(field => field.name === 'summary').display, 'text');
  assert.equal(book.fields.find(field => field.name === 'isbn').display, 'row');
  assert.equal(book.fields.find(field => field.name === 'isbn').label, 'ISBN');
  assert.equal(book.fields.find(field => field.name === 'coverImage').display, 'image');
});

test('record batches respect the size limits, send each image once and map relationships to record IDs', async () => {
  const site = await loadSite(siteDir);
  const batches = [];
  for await (const batch of recordBatches(site, { size: 6, maxBytes: 40000 })) batches.push(batch);
  const records = batches.flat();
  assert.equal(records.length, site.records);
  assert.ok(batches.every(batch => batch.length <= 6));
  assert.ok(batches.every(batch => batch.length === 1 || JSON.stringify(batch).length <= 40000 + 2 * batch.length));
  assert.equal(new Set(records.map(record => record.externalId)).size, records.length);
  const withData = records.filter(record => record.image?.base64);
  assert.equal(new Set(withData.map(record => record.image.source)).size, withData.length, 'image bytes are sent once per source path');
  assert.equal(new Set(records.filter(record => record.image).map(record => record.image.source)).size, withData.length);
  const ids = new Set(records.map(record => record.externalId));
  const book = records.find(record => record.type === 'book');
  assert.equal(book.slug, book.path.split('/').filter(Boolean).pop());
  assert.ok(book.relationships.length && book.relationships.every(rel => ids.has(rel.targetExternalId) && rel.targetExternalId.startsWith('author-')));
  assert.ok(!('title' in book.fields) && !('coverImage' in book.fields));
  assert.ok(book.terms.topic.length === 1);
  // Newest first in generator order, all in the past.
  const dates = records.map(record => record.date);
  assert.ok(dates.every((date, i) => i === 0 || date < dates[i - 1]));
  assert.ok(Date.parse(`${recordDate(0).replace(' ', 'T')}Z`) < Date.now());
});

test('pushSiteToWordPress imports in batches, resolves relationships and saves a scorable answer key', async () => {
  const wordpress = fakeWordPress({ perPage: 3 });
  const events = [];
  const summary = await pushSiteToWordPress(siteDir, { url: 'http://wp.test', token: 'secret', fetch: wordpress.fetch, batchSize: 5, onProgress: event => events.push(event) });
  const imports = wordpress.calls.filter(call => call.route === '/import');
  assert.ok(imports.length >= Math.ceil(summary.records / 5) && imports.every(call => call.body.records.length <= 5));
  assert.ok(imports.every(call => call.body.site.id === 'wp-test' && call.body.builder === 'blocks' && call.body.types.length === 4));
  assert.equal(summary.created, summary.records);
  assert.equal(wordpress.posts.size, summary.records);
  assert.ok(wordpress.calls.some(call => call.route === '/relationships'));
  assert.deepEqual(wordpress.calls.find(call => call.route === '/pages').body.setFrontPage, false);
  assert.equal(summary.types.find(type => type.name === 'author').postType, 'sf_author');
  assert.ok(events.some(event => event.phase === 'import') && events.at(-1).phase === 'done');
  const truth = JSON.parse(await readFile(summary.answerKeyPath, 'utf8'));
  assert.equal(truth.pages.length, summary.answerKeyPages);
  assert.ok(truth.pages.some(page => page.url === '/books/page/2/'));
  const actual = { version: 1, pages: truth.pages.map(page => ({ url: page.url, cluster: page.expectedCluster, contentType: page.contentType, fields: page.fields, relationships: page.relationships, ...(page.repeatedItems ? { repeatedItems: page.repeatedItems } : {}) })) };
  const report = evaluate(truth, actual);
  assert.equal(report.coverage.recall, 1);
  assert.equal(report.fields.values.f1, 1);
  assert.equal(report.relationships.score.f1, 1);
  assert.equal(report.repeatedItems.items.f1, 1);
  // A second push sends the same records again; the plugin decides they are unchanged (no duplicates).
  const again = await pushSiteToWordPress(siteDir, { url: 'http://wp.test', token: 'secret', fetch: wordpress.fetch });
  assert.equal(again.created, 0);
  assert.equal(again.unchanged, summary.records);
  assert.equal(wordpress.posts.size, summary.records);
  const reset = await resetSiteInWordPress(siteDir, { url: 'http://wp.test', token: 'secret', fetch: wordpress.fetch });
  assert.equal(reset.deleted, summary.records);
  assert.equal(reset.siteId, 'wp-test');
});

test('inspectWordPress summarizes types and planned mappings', async () => {
  const wordpress = fakeWordPress();
  const summary = await inspectWordPress(wordpressClient({ url: 'http://wp.test', token: 'secret', fetch: wordpress.fetch }));
  assert.equal(summary.contentTypes[0].name, 'book');
  assert.equal(summary.matches.find(match => match.name === 'event').postType, 'tribe_events');
  assert.match(summary.text, /event \(Events\) → tribe_events reuses the existing type/);
});

test('the client explains unreachable sites, bad tokens and a missing plugin', async () => {
  const failing = wordpressClient({ url: 'http://wp.test', token: 'x', fetch: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); } });
  await assert.rejects(failing.status(), error => error instanceof WordPressError && error.code === 'unreachable' && /not reachable \(ECONNREFUSED\)/.test(error.message));
  const wordpress = fakeWordPress();
  await assert.rejects(wordpressClient({ url: 'http://wp.test', token: 'wrong', fetch: wordpress.fetch }).status(), error => error.code === 'bad_token');
  const noPlugin = wordpressClient({ url: 'http://wp.test', token: 'x', fetch: async () => json(404, { code: 'rest_no_route', message: 'No route was found' }) });
  await assert.rejects(noPlugin.status(), error => error.code === 'plugin_missing');
  const html = wordpressClient({ url: 'http://wp.test', token: 'x', fetch: async () => new Response('<html></html>', { status: 200 }) });
  await assert.rejects(html.status(), error => error.code === 'not_json');
  assert.throws(() => wordpressClient({ url: 'http://wp.test' }), error => error.code === 'no_token');
});

test('every plugin PHP file passes php -l', { skip: spawnSync('php', ['-v']).status !== 0 && 'php is not installed' }, async () => {
  const files = [join(pluginDir, 'siteforge-importer.php'), ...(await readdir(join(pluginDir, 'includes'))).filter(name => name.endsWith('.php')).map(name => join(pluginDir, 'includes', name))];
  assert.ok(files.length >= 5);
  for (const file of files) {
    const result = spawnSync('php', ['-l', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stdout}${result.stderr}`);
  }
  const main = await readFile(join(pluginDir, 'siteforge-importer.php'), 'utf8');
  assert.match(main, /Plugin Name:\s+SiteForge Importer/);
  assert.match(main, /Requires PHP:\s+8\.0/);
  assert.match(main, /License:\s+GPL-2\.0-or-later/);
});

test('siteKey replaces the site id in WordPress so test sets that share site ids stay apart', async () => {
  const wordpress = fakeWordPress({ perPage: 50 });
  const summary = await pushSiteToWordPress(siteDir, { url: 'http://wp.test', token: 'secret', fetch: wordpress.fetch, siteKey: 'set-abc12345-wp-test' });
  const imports = wordpress.calls.filter(call => call.route === '/import');
  assert.ok(imports.length && imports.every(call => call.body.site.id === 'set-abc12345-wp-test'));
  assert.equal(summary.siteId, 'set-abc12345-wp-test');
  await assert.rejects(pushSiteToWordPress(siteDir, { url: 'http://wp.test', token: 'secret', fetch: wordpress.fetch, siteKey: '9-starts-with-a-digit' }), /siteKey must be/);
});
