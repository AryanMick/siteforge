import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlSite, isCanonicalUpgrade } from '../src/crawl/real-crawler.mjs';

const http = 'http://archive.example';
const https = 'https://archive.example';
const html = body => `<html><head><title>Archive</title></head><body><h1>Archive</h1>${body}</body></html>`;
const options = { allowLocal: true, delayMs: 0, maxPages: 5, maxTimeMs: 5000 };

// Replace only the wire transport. Crawl queues, policy checks and parsing stay real.
function wire(routes, address = '93.184.215.14') {
  const hits = []; const agents = []; const lookups = [];
  return { hits, agents, lookups, transport: {
    lookup: async hostname => { lookups.push(hostname); return [{ address, family: 4 }]; },
    Agent: class {
      constructor(config) { this.config = config; agents.push(this); }
      async close() { this.closed = true; }
    },
    fetch: async (url, init) => {
      hits.push(url.href);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.dispatcher, agents[0]);
      assert(init.signal instanceof AbortSignal);
      const route = routes[url.href];
      assert(route, `Unexpected request: ${url.href}`);
      if (route instanceof Error) throw route;
      if (route.delay) { await new Promise(resolve => setTimeout(resolve, route.delay)); init.signal.throwIfAborted(); }
      route.beforeResponse?.();
      return new Response(route.body ?? '', { status: route.status ?? 200, headers: route.headers ?? { 'Content-Type': url.pathname === '/robots.txt' ? 'text/plain' : 'text/html' } });
    },
  } };
}

test('canonical upgrades allow only same-host default-port HTTP to HTTPS', () => {
  assert(isCanonicalUpgrade(new URL(http), new URL(https)));
  for (const [from, to] of [[https, http], [http, 'https://www.archive.example'], [http, 'https://other.example'], [http + ':8080', https], [http, https + ':444'], [http, 'https://user:pass@archive.example']]) {
    assert.equal(isCanonicalUpgrade(new URL(from), new URL(to)), false, `${from} -> ${to}`);
  }
});

test('robots redirect upgrades the effective origin and follows legacy HTTP links over HTTPS', async () => {
  const net = wire({
    [http + '/robots.txt']: { status: 301, headers: { Location: https + '/robots.txt' } },
    [https + '/robots.txt']: { body: 'User-agent: *\nAllow: /' },
    [https + '/archive']: { body: html(`<a href="${http}/record">Record</a>`) },
    [https + '/record']: { body: html('<dl><dt>Year</dt><dd>1993</dd></dl>') },
  });
  const result = await crawlSite(http + '/archive', options, net.transport);
  assert.equal(result.startUrl, http + '/archive');
  assert.equal(result.effectiveStartUrl, https + '/archive');
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[1].fields.year, '1993');
  assert.equal(result.summary.allEligibleAnalyzed, true);
  assert.equal(result.robots.url, https + '/robots.txt');
  assert.equal(net.hits.filter(url => url.startsWith('http:')).length, 1);
  assert.equal(net.agents.length, 1);
  assert.deepEqual(net.lookups, ['archive.example']);
  assert(net.agents[0].closed);
  const pinned = await new Promise((resolve, reject) => net.agents[0].config.connect.lookup('archive.example', {}, (error, address) => error ? reject(error) : resolve(address)));
  assert.equal(pinned, '93.184.215.14');
});

test('page upgrade rechecks HTTPS robots and blocks a disallowed target before fetching it', async () => {
  const net = wire({
    [http + '/robots.txt']: { body: 'User-agent: *\nAllow: /' },
    [http + '/']: { status: 302, headers: { Location: https + '/archive' } },
    [https + '/robots.txt']: { body: 'User-agent: *\nDisallow: /archive' },
  });
  const result = await crawlSite(http, options, net.transport);
  assert.equal(result.pages.length, 0);
  assert.equal(result.urls[0].reason, 'robots_disallowed');
  assert.equal(result.summary.allEligibleAnalyzed, false);
  assert.deepEqual(net.hits, [http + '/robots.txt', http + '/', https + '/robots.txt']);
});

test('page upgrade continues under the secure policy and respects the original page budget', async () => {
  const net = wire({
    [http + '/robots.txt']: { body: 'User-agent: *\nAllow: /' },
    [http + '/']: { status: 301, headers: { Location: https + '/new?year=1993' } },
    [https + '/robots.txt']: { body: 'User-agent: *\nAllow: /' },
    [https + '/new?year=1993']: { body: html('<a href="/one">One</a><a href="/two">Two</a>') },
  });
  const result = await crawlSite(http, { ...options, maxPages: 1 }, net.transport);
  assert.equal(result.pages.length, 1);
  assert.equal(result.summary.counts.unattempted, 2);
  assert.equal(result.summary.allEligibleAnalyzed, false);
  assert.equal(result.pages[0].url, https + '/new?year=1993');
  assert.equal(result.effectiveStartUrl, https + '/new?year=1993');
  assert.equal(result.network.length, 4);
});

test('cross-host and custom-port redirects remain blocked with diagnostic evidence', async () => {
  for (const target of ['https://www.archive.example/robots.txt', https + ':444/robots.txt']) {
    const net = wire({ [http + '/robots.txt']: { status: 301, headers: { Location: target } } });
    const result = await crawlSite(http, options, net.transport);
    assert.equal(result.robots.code, 'cross_origin');
    assert.equal(result.robots.redirects[0].to, target);
    assert.equal(result.summary.stopReason, 'robots_unavailable');
    assert.equal(result.pages.length, 0);
    assert.deepEqual(net.hits, [http + '/robots.txt']);
  }
});

test('secure policy failure stops a page upgrade before collecting content', async () => {
  const net = wire({
    [http + '/robots.txt']: { body: 'User-agent: *\nAllow: /' },
    [http + '/']: { status: 301, headers: { Location: https + '/' } },
    [https + '/robots.txt']: { status: 500 },
  });
  const result = await crawlSite(http, options, net.transport);
  assert.equal(result.pages.length, 0);
  assert.equal(result.robots.code, 'http_500');
  assert.equal(result.summary.stopReason, 'robots_unavailable');
  assert.equal(net.hits.length, 3);
});

test('TLS errors retain their cause without an HTTP downgrade and private DNS never connects', async () => {
  const tls = new TypeError('fetch failed', { cause: Object.assign(new Error('Certificate expired'), { code: 'CERT_HAS_EXPIRED' }) });
  const net = wire({ [https + '/robots.txt']: tls });
  const result = await crawlSite(https, options, net.transport);
  assert.equal(result.robots.code, 'CERT_HAS_EXPIRED');
  assert.equal(result.robots.reason, 'Certificate expired');
  assert.deepEqual(net.hits, [https + '/robots.txt']);
  const unsafe = wire({}, '127.0.0.1');
  await assert.rejects(crawlSite(http, options, unsafe.transport), /Private network/);
  assert.equal(unsafe.hits.length, 0);
  assert.equal(unsafe.agents.length, 0);
});

test('disabled redirects do not mutate the effective origin or fetch another robots policy', async () => {
  const net = wire({
    [http + '/robots.txt']: { body: 'User-agent: *\nAllow: /' },
    [http + '/']: { status: 301, headers: { Location: https + '/' } },
  });
  const result = await crawlSite(http, { ...options, maxRedirects: 0 }, net.transport);
  assert.equal(result.effectiveStartUrl, http + '/');
  assert.equal(result.urls[0].reason, 'redirect_limit');
  assert.equal(net.hits.length, 2);
});

test('secure robots rereads preserve cumulative byte and time budget failures', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
  for (const [securePolicy, limits, expected] of [
    [{ body: 'x'.repeat(300) }, { maxTotalBytes: 256 }, 'total_byte_budget'],
    [{ body: 'User-agent: *\nAllow: /', beforeResponse: () => context.mock.timers.tick(550) }, { maxTimeMs: 500 }, 'time_budget'],
  ]) {
    const net = wire({
      [http + '/robots.txt']: { body: 'User-agent: *\nAllow: /' },
      [http + '/']: { status: 301, headers: { Location: https + '/' } },
      [https + '/robots.txt']: securePolicy,
    });
    const result = await crawlSite(http, { ...options, ...limits }, net.transport);
    assert.equal(result.summary.stopReason, expected, JSON.stringify(result));
    assert.equal(result.pages.length, 0);
    assert.equal(net.hits.length, 3);
  }
});

test('request allowance reserves both robots chains without truncating valid page redirects', async () => {
  const routes = {
    [http + '/robots.txt']: { status: 301, headers: { Location: '/r1' } },
    [http + '/r4']: { body: 'User-agent: *\nAllow: /' },
    [http + '/']: { status: 301, headers: { Location: https + '/p1' } },
    [https + '/robots.txt']: { body: 'User-agent: *\nAllow: /' },
    [https + '/p5']: { body: html('Final page') },
  };
  for (let index = 1; index < 4; index++) routes[http + '/r' + index] = { status: 301, headers: { Location: '/r' + (index + 1) } };
  for (let index = 1; index < 5; index++) routes[https + '/p' + index] = { status: 301, headers: { Location: '/p' + (index + 1) } };
  const net = wire(routes);
  const result = await crawlSite(http, { ...options, maxPages: 1, maxRedirects: 5 }, net.transport);
  assert.equal(result.pages.length, 1);
  assert.equal(result.summary.allEligibleAnalyzed, true);
  assert.equal(net.hits.length, 12);
});
