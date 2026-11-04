import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCrawl } from '../src/crawl/pagepilot/crawl-summary.mjs';

test('page limits are explained as partial sampling even without a global stop reason', () => {
  const result = describeCrawl({ crawl: { analyzed: 3, counts: { unattempted: 12 }, stopReason: null, allEligibleAnalyzed: false }, outcomes: [{ state: 'unattempted', reason: 'page_budget' }] });
  assert.equal(result.title, 'Page limit reached');
  assert.match(result.message, /3 pages collected; 12 discovered/);
  assert.match(result.message, /not the whole website/);
});

test('crawl summaries distinguish policy blocks, server stops, failures, limits, and completed scope', () => {
  const result = crawl => describeCrawl({ crawl, outcomes: [] });
  assert.equal(result({ analyzed: 0, stopReason: 'robots_unavailable' }).title, 'Robots policy unavailable');
  assert.match(result({ analyzed: 1, stopReason: 'server_429_stop' }).title, /asked the crawler to stop/);
  assert.equal(result({ analyzed: 0 }).title, 'No HTML pages collected');
  assert.equal(result({ analyzed: 2, stopReason: 'time_budget' }).title, 'Crawl stopped early');
  assert.equal(result({ analyzed: 2, counts: { failed: 1 } }).title, 'Some pages could not be read');
  assert.equal(result({ analyzed: 2, counts: { unattempted: 1 } }).title, 'Partial sample collected');
  assert.equal(result({ analyzed: 2, counts: {}, allEligibleAnalyzed: false }).title, 'Crawl needs review');
  assert.equal(result({ analyzed: 2, allEligibleAnalyzed: true }).title, 'Crawl completed');
});
