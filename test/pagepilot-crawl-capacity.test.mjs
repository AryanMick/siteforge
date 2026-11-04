import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { crawlSite } from '../src/crawl/real-crawler.mjs';
import { projectInput } from '../src/crawl/pagepilot/config.mjs';

const html = body => `<!doctype html><html><head><title>Capacity</title></head><body><h1>Capacity</h1>${body}</body></html>`;

async function capacityFixture(run) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/robots.txt' ? 'text/plain' : 'text/html');
    if (request.url === '/robots.txt') response.end('User-agent: *\nAllow: /\n');
    else if (request.url === '/') response.end(html(Array.from({ length: 119 }, (_, index) => `<a href="/page-${index + 1}">Page</a>`).join('')));
    else if (/^\/page-\d+$/.test(request.url)) response.end(html(`<p>${request.url}</p>`));
    else { response.statusCode = 404; response.end('missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}

const options = { allowLocal: true, delayMs: 0, timeoutMs: 2000, maxTimeMs: 1800000, maxPages: 120, maxDepth: 1, maxDiscovered: 5000, maxTotalBytes: 50000000 };

test('bounded crawler analyzes 120 deterministic pages and reports exact request progress', { timeout: 30000 }, async () => {
  await capacityFixture(async url => {
    const updates = [];
    const result = await crawlSite(url, options, undefined, { onProgress: async progress => updates.push(progress) });
    assert.equal(result.pages.length, 120);
    assert.equal(result.summary.analyzed, 120);
    assert.equal(result.summary.stopReason, null);
    assert.equal(result.settings.maxTimeMs, 1800000);
    assert.equal(result.summary.allEligibleAnalyzed, true);
    const final = updates.at(-1);
    assert.deepEqual(Object.keys(final).sort(), ['analyzed', 'bytes', 'currentUrl', 'discovered', 'elapsedMs', 'failed', 'maxPages', 'queued', 'skipped'].sort());
    assert.deepEqual({ analyzed: final.analyzed, discovered: final.discovered, queued: final.queued, failed: final.failed, skipped: final.skipped, currentUrl: final.currentUrl, maxPages: final.maxPages },
      { analyzed: 120, discovered: 120, queued: 0, failed: 0, skipped: 0, currentUrl: null, maxPages: 120 });
    assert(final.bytes > 0);
    assert(updates.some(progress => progress.currentUrl?.endsWith('/page-1')));
  });
});

test('cooperative stop retains collected pages and marks the remaining frontier', { timeout: 30000 }, async () => {
  await capacityFixture(async url => {
    let latest;
    const result = await crawlSite(url, options, undefined, {
      onProgress: async progress => { latest = progress; },
      shouldStop: async () => (latest?.analyzed ?? 0) >= 7,
    });
    assert.equal(result.pages.length, 7);
    assert.equal(result.summary.stopReason, 'user_stopped');
    assert.equal(result.summary.allEligibleAnalyzed, false);
    assert.equal(result.summary.counts.failed, 0);
    assert(result.summary.counts.unattempted > 0);
    assert(!result.urls.some(item => item.state === 'queued'));
    assert.equal(latest.analyzed, 7);
    assert.equal(latest.currentUrl, null);
  });
});

test('legacy stored project input receives new bounded defaults', () => {
  const legacy = projectInput({ name: 'Legacy', mode: 'public', profile: 'library', noise: 'clean', pageCount: 24, seed: 48291, url: 'https://example.com/', pathPrefix: '/', maxPages: 5, threshold: 0.32 });
  assert.equal(legacy.maxPages, 5);
  assert.equal(legacy.maxDepth, 6);
  assert.equal(legacy.maxDurationMinutes, 15);
});
