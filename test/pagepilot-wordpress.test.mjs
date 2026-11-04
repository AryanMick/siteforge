import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { convertPages } from '../src/crawl/pagepilot/conversion.mjs';
import { createWordPressDrafts, WordPressExportError } from '../src/crawl/pagepilot/wordpress.mjs';

function mockTransport(responses, addresses = [{ address: '93.184.216.34', family: 4 }]) {
  const requests = []; const agents = [];
  return {
    requests, agents,
    transport: {
      lookup: async () => addresses,
      Agent: class { constructor(config) { this.config = config; agents.push(this); } async close() { this.closed = true; } },
      fetch: async (url, init) => {
        requests.push({ url: url.href, init });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

async function runFixture(operation) {
  const directory = await mkdtemp(join(tmpdir(), 'pagepilot-wordpress-'));
  const previous = process.env.PAGEPILOT_DATA_DIR; process.env.PAGEPILOT_DATA_DIR = directory;
  const runId = randomUUID(); await mkdir(join(directory, 'runs', runId), { recursive: true });
  try { return await operation({ directory, runId }); }
  finally {
    if (previous === undefined) delete process.env.PAGEPILOT_DATA_DIR; else process.env.PAGEPILOT_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('conversion filters excluded pages and escapes every captured field', () => {
  const result = convertPages({
    labels: { alpha: 'Articles' },
    pages: [
      { url: '/News/<Launch>', title: '<img src=x onerror=alert(1)>', cluster: 'alpha', fields: { title: '<Title>', body: '<script>alert(1)</script>', tags: ['one', '<two>'] } },
      { url: '/excluded', cluster: 'excluded', fields: { title: 'No' } },
      { url: '/also-excluded', excluded: true, cluster: 'alpha', fields: { title: 'No' } },
    ],
  });
  assert.equal(result.length, 1);
  assert.deepEqual(Object.keys(result[0]), ['sourceUrl', 'title', 'slug', 'content', 'status', 'cluster', 'fields']);
  assert.equal(result[0].status, 'draft');
  assert.equal(result[0].cluster, 'Articles');
  assert.equal(result[0].slug, 'launch');
  assert.match(result[0].content, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(result[0].content, /one, &lt;two&gt;/);
  assert.doesNotMatch(result[0].content, /<script|<img/i);
});

test('WordPress export pins vetted DNS, forces drafts, stays sequential, and deduplicates receipts', () => runFixture(async ({ directory, runId }) => {
  let active = 0; let maximum = 0;
  const net = mockTransport([
    new Response(JSON.stringify({ id: 41, status: 'draft', link: 'https://wordpress.example/first/' }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    new Response(JSON.stringify({ id: 42, status: 'draft', link: 'https://wordpress.example/second/' }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
  ]);
  const originalFetch = net.transport.fetch;
  net.transport.fetch = async (...args) => { active++; maximum = Math.max(maximum, active); try { return await originalFetch(...args); } finally { active--; } };
  const pages = [
    { sourceUrl: '/first', title: 'First', slug: 'first', content: '<p>First</p>', status: 'publish' },
    { sourceUrl: '/second', title: 'Second', slug: 'second', content: '<p>Second</p>', status: 'draft' },
  ];
  const credentials = { siteUrl: 'https://wordpress.example', username: 'editor', applicationPassword: 'secret app password', pages, runId };
  const first = await createWordPressDrafts(credentials, net.transport);
  assert.deepEqual(first, { created: [{ sourceUrl: '/first', id: 41, link: 'https://wordpress.example/first/' }, { sourceUrl: '/second', id: 42, link: 'https://wordpress.example/second/' }], failed: [], uncertain: false });
  assert.equal(maximum, 1);
  assert.equal(net.requests.length, 2);
  for (const request of net.requests) {
    assert.equal(request.url, 'https://wordpress.example/wp-json/wp/v2/posts');
    assert.equal(request.init.redirect, 'error');
    assert.equal(request.init.dispatcher, net.agents[0]);
    assert.equal(JSON.parse(request.init.body).status, 'draft');
    assert.equal('publish' in JSON.parse(request.init.body), false);
  }
  const pinned = await new Promise((resolve, reject) => net.agents[0].config.connect.lookup('wordpress.example', { all: true }, (error, value) => error ? reject(error) : resolve(value)));
  assert.deepEqual(pinned, [{ address: '93.184.216.34', family: 4 }]);
  const again = await createWordPressDrafts(credentials, mockTransport([]).transport);
  assert.deepEqual(again, first);
  const receiptText = await readFile(join(directory, 'runs', runId, 'wordpress-receipts.json'), 'utf8');
  assert.doesNotMatch(receiptText, /editor|secret app password|Authorization|Basic/);
}));

test('partial and ambiguous failures are explicit and never retried', () => runFixture(async ({ runId }) => {
  const net = mockTransport([
    new Response('{"code":"rest_forbidden"}', { status: 403 }),
    new TypeError('fetch failed'),
    new Response('server error', { status: 503 }),
  ]);
  const pages = ['forbidden', 'network', 'server'].map(name => ({ sourceUrl: `/${name}`, title: name, slug: name, content: `<p>${name}</p>` }));
  const result = await createWordPressDrafts({ siteUrl: 'https://wordpress.example', username: 'u', applicationPassword: 'p', pages, runId }, net.transport);
  assert.equal(net.requests.length, 3);
  assert.deepEqual(result.created, []);
  assert.equal(result.failed.length, 3);
  assert.equal(result.uncertain, true);
  assert.match(result.failed[0].error, /not allowed/);
  assert.match(result.failed[1].error, /Check WordPress before retrying/);
  assert.match(result.failed[2].error, /Check WordPress before retrying/);
  assert.doesNotMatch(JSON.stringify(result), /rest_forbidden|fetch failed/);
}));

test('unsafe sites and any private DNS answer are rejected before authorization exists', () => runFixture(async ({ runId }) => {
  const page = { sourceUrl: '/one', title: 'One', slug: 'one', content: '<p>One</p>' };
  for (const siteUrl of ['http://wordpress.example', 'https://user:pass@wordpress.example', 'https://wordpress.example:444', 'https://wordpress.example/?target=x', 'https://wordpress.example/#x']) {
    await assert.rejects(createWordPressDrafts({ siteUrl, username: 'u', applicationPassword: 'secret', pages: [page], runId }, mockTransport([]).transport), WordPressExportError);
  }
  const net = mockTransport([], [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  await assert.rejects(createWordPressDrafts({ siteUrl: 'https://wordpress.example', username: 'u', applicationPassword: 'secret', pages: [page], runId }, net.transport), /public network/);
  assert.equal(net.requests.length, 0);
  assert.equal(net.agents.length, 0);
}));

test('oversized or malformed successful responses are uncertain and do not create receipts', () => runFixture(async ({ directory, runId }) => {
  const net = mockTransport([new Response('x', { status: 201, headers: { 'Content-Length': '1000001' } })]);
  const page = { sourceUrl: '/one', title: 'One', slug: 'one', content: '<p>One</p>' };
  const result = await createWordPressDrafts({ siteUrl: 'https://wordpress.example', username: 'u', applicationPassword: 'p', pages: [page], runId }, net.transport);
  assert.equal(result.uncertain, true);
  assert.equal(result.created.length, 0);
  await assert.rejects(readFile(join(directory, 'runs', runId, 'wordpress-receipts.json')), error => error.code === 'ENOENT');
}));
