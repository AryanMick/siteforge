import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlRecovery } from '../src/pagepilot/crawl-recovery.mjs';

function run(overrides = {}) {
  return { status: 'failed', error: null, result: { provenance: { synthetic: false, sourceUrl: 'https://archive.example/records' }, crawl: { analyzed: 0, counts: {}, allEligibleAnalyzed: false }, outcomes: [], ...overrides } };
}
const robotFailure = (code, reason) => ({ diagnostics: { robots: { status: 'unavailable', code, reason } }, crawl: { analyzed: 0, counts: {}, stopReason: 'robots_unavailable' } });

test('TLS, DNS, transport and safety failures have distinct recovery guidance', () => {
  assert.equal(crawlRecovery(run(robotFailure('CERT_HAS_EXPIRED', 'Expired certificate'))).title, 'Website certificate is not trusted');
  assert.doesNotMatch(crawlRecovery(run(robotFailure('CERT_HAS_EXPIRED'))).message, /http:\/\//);
  assert.equal(crawlRecovery(run(robotFailure('ERR_SSL_WRONG_VERSION_NUMBER'))).title, 'Secure connection failed');
  assert.equal(crawlRecovery({ status: 'failed', error: 'getaddrinfo ENOTFOUND archive.example', result: null }).title, 'Website address not found');
  assert.equal(crawlRecovery(run(robotFailure('ECONNREFUSED', 'Connection refused'))).title, 'Website did not respond');
  assert.equal(crawlRecovery({ status: 'failed', error: 'Private network URL rejected', result: null }).title, 'Address blocked by crawl policy');
});

test('a canonical www redirect is an explicit settings suggestion, not a fetched URL', () => {
  const original = run({ ...robotFailure('cross_origin', 'cross_origin') });
  original.result.diagnostics.robots.redirects = [{ from: 'https://archive.example/robots.txt', to: 'https://www.archive.example/robots.txt' }];
  const before = JSON.stringify(original);
  const recovery = crawlRecovery(original, { pathPrefix: '/records' });
  assert.equal(recovery.title, 'The website uses another address');
  assert.equal(recovery.suggestedUrl, 'https://www.archive.example/records');
  assert.equal(recovery.action, 'settings');
  assert.equal(JSON.stringify(original), before);
});

test('canonical suggestions reject downgrade, credentials, unrelated hosts, scope changes and unsafe schemes', () => {
  for (const target of ['http://www.archive.example/records', 'https://evil.example/records', 'https://user:pass@www.archive.example/records', 'https://www.archive.example:444/records', 'https://www.archive.example/outside', 'javascript:alert(1)', 'https://www.archive.example/.private']) {
    const original = run({ outcomes: [{ state: 'skipped', reason: 'cross_origin', redirects: [{ from: 'https://archive.example/records', to: target }] }] });
    assert.equal(crawlRecovery(original, { pathPrefix: '/records' }).suggestedUrl, null, target);
  }
});

test('recovery distinguishes rate limits, policy blocks, page caps and partial results', () => {
  assert.equal(crawlRecovery(run(robotFailure('server_429_stop', '429'))).title, 'Website asked us to stop');
  assert.equal(crawlRecovery(run(robotFailure('http_500', 'HTTP 500'))).title, 'Robots policy could not be read');
  assert.equal(crawlRecovery(run({ outcomes: [{ reason: 'robots_disallowed' }] })).title, 'Crawling is disallowed');
  const sample = run({ crawl: { analyzed: 3, counts: { unattempted: 4 } }, outcomes: [{ state: 'unattempted', reason: 'page_budget' }] });
  assert.equal(crawlRecovery(sample).title, 'Page limit reached');
  assert.match(crawlRecovery(sample).message, /3 pages saved/);
  assert.equal(crawlRecovery(run({ crawl: { analyzed: 2, counts: { failed: 1 } } })).action, 'pages');
});

test('completed, running and synthetic runs do not show public recovery guidance', () => {
  assert.equal(crawlRecovery({ status: 'running' }), null);
  assert.equal(crawlRecovery(run({ provenance: { synthetic: true } })), null);
  assert.equal(crawlRecovery(run({ crawl: { analyzed: 1, allEligibleAnalyzed: true } })), null);
});

test('older run records without network diagnostics remain usable', () => {
  assert.equal(crawlRecovery(run()).title, 'No readable pages collected');
  assert.equal(crawlRecovery(run({ crawl: { analyzed: 1, counts: {}, allEligibleAnalyzed: false } })).title, 'Partial website sample');
});

test('an already attempted HTTPS upgrade surfaces its actual robots failure', () => {
  const original = run({ ...robotFailure('http_500', 'HTTP 500'), provenance: { synthetic: false, sourceUrl: 'http://archive.example/' }, outcomes: [{ url: 'http://archive.example/', state: 'failed', reason: 'robots_unavailable', redirects: [{ from: 'http://archive.example/', to: 'https://archive.example/' }] }] });
  original.result.diagnostics.effectiveUrl = 'https://archive.example/';
  const recovery = crawlRecovery(original);
  assert.equal(recovery.suggestedUrl, null);
  assert.equal(recovery.title, 'Robots policy could not be read');
});

test('an internal-page redirect never proposes changing the whole project address', () => {
  const original = run({ crawl: { analyzed: 1, counts: {}, allEligibleAnalyzed: false }, outcomes: [{ url: 'https://archive.example/records', state: 'analyzed' }, { url: 'https://archive.example/old', state: 'skipped', reason: 'cross_origin', redirects: [{ from: 'https://archive.example/old', to: 'https://www.archive.example/promo' }] }] });
  assert.equal(crawlRecovery(original).suggestedUrl, null);
  assert.equal(crawlRecovery(original).action, 'pages');
});

test('canonical start recovery survives an earlier robots HTTP-to-HTTPS upgrade', () => {
  const original = run({ provenance: { synthetic: false, sourceUrl: 'http://archive.example/records' }, diagnostics: { requestedUrl: 'http://archive.example/records', effectiveUrl: 'https://archive.example/records', robots: { status: 'loaded' } }, outcomes: [{ url: 'https://archive.example/records', state: 'skipped', reason: 'cross_origin', redirects: [{ from: 'https://archive.example/records', to: 'https://www.archive.example/records' }] }] });
  assert.equal(crawlRecovery(original).suggestedUrl, 'https://www.archive.example/records');
});

test('browser verification redirects and HTTP denials explain blocked access without offering bypasses', () => {
  for (const path of ['/__superjs/challenge?u=%2Farticles%2Fautopilot', '/cdn-cgi/challenge-platform/h/b']) {
    const saved = run({ outcomes: [{ state: 'skipped', reason: 'outside_path_prefix', redirects: [{ from: 'https://archive.example/records', to: 'https://archive.example' + path }] }] });
    const recovery = crawlRecovery(saved);
    assert.equal(recovery.title, 'Website requires browser verification');
    assert.equal(recovery.action, 'pages');
    assert.equal(recovery.suggestedUrl, null);
    assert.match(recovery.message, /not bypassed/);
  }
  assert.equal(crawlRecovery(run({ outcomes: [{ state: 'failed', reason: 'http_403' }] })).title, 'Website denied access');
  assert.equal(crawlRecovery(run(robotFailure('http_401', 'HTTP 401'))).title, 'Website denied access');
  const ordinary = run({ outcomes: [{ state: 'skipped', redirects: [{ to: 'https://archive.example/articles/challenge-response' }] }] });
  assert.notEqual(crawlRecovery(ordinary).title, 'Website requires browser verification');
});
