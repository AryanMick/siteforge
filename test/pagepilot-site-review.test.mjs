import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteReview } from '../src/pagepilot/site-review.mjs';
import { clientReportHtml } from '../src/pagepilot/export.mjs';
import { parse } from 'parse5';

const page = (url, issues = [], extra = {}) => ({ url, title: url, fields: { title: url, author: 'Fictional author' }, issues, ...extra });
const result = (pages = []) => ({ pages, outcomes: [], crawl: { allEligibleAnalyzed: true }, provenance: { synthetic: false } });

test('site review groups evidence by issue and counts distinct affected URLs', () => {
  const review = buildSiteReview(result([
    page('/a', [{ code: 'image-missing-alt', count: 3 }, { code: 'missing-title', count: 1 }]),
    page('/b', [{ code: 'image-missing-alt', count: 2 }]),
  ]));
  const alt = review.findings.find(item => item.code === 'image-missing-alt');
  assert.equal(alt.occurrences, 5);
  assert.deepEqual(alt.urls, ['/a', '/b']);
  assert.equal(review.affectedUrls, 2);
  assert.equal(review.highPriority, 0);
  assert.match(review.limitations.at(-1), /accuracy is not measured/);
});

test('failed and incomplete samples rank ahead of cosmetic markup with actionable URL evidence', () => {
  const input = result([page('/a', [{ code: 'legacy-font', count: 5 }])]);
  input.crawl.allEligibleAnalyzed = false;
  input.outcomes = [{ url: '/failed', state: 'failed', reason: 'http_404' }, { url: '/remaining', state: 'unattempted', reason: 'page_budget' }];
  const review = buildSiteReview(input);
  assert.equal(review.highPriority, 2);
  assert.equal(review.findings[0].priority, 'high');
  assert.deepEqual(review.findings.find(item => item.code === 'failed-request').evidence, ['http_404']);
  assert.equal(review.affectedUrls, 3);
  assert(review.findings.every(item => item.action.length > 20));
});

test('optional fields and recorded microdata are not reported as extraction defects', () => {
  const review = buildSiteReview(result([
    page('/book-a', [], { fields: { title: 'A', author: 'A', cover: 'cover.png' } }),
    page('/book-b', [], { fields: { title: 'B', author: 'B' } }),
    page('/listing', [], { fields: { title: 'Listing' }, recordCount: 3 }),
  ]));
  assert.equal(review.findings.length, 0);
  assert.match(review.limitations.join(' '), /Optional fields do not automatically/);
});

test('recovered headers, title collisions and weak field evidence remain visible and deterministic', () => {
  const pages = [page('/b', [], { title: 'Duplicate', fields: { title: 'Duplicate' } }), page('/a', [{ code: 'html-content-type-recovered', count: 1, evidence: 'text/plain' }], { title: ' duplicate ', fetch: { htmlDetected: true } })];
  const review = buildSiteReview(result(pages));
  assert.equal(review.recoveredPages, 1);
  assert.deepEqual(review.findings.find(item => item.code === 'repeated-title').urls, ['/a', '/b']);
  assert.deepEqual(review.findings.find(item => item.code === 'limited-field-evidence').urls, ['/b']);
  assert.deepEqual(buildSiteReview(result([...pages].reverse())), review);
});

test('client HTML report keeps untrusted source text inert and includes limits, findings and saved labels', () => {
  const attack = '<script>alert("unsafe")</script><img src=x onerror=alert(1)>';
  const input = result([page(attack, [{ code: 'html-parse-error', count: 1, evidence: attack }])]);
  input.provenance.sourceUrl = attack;
  input.clusters = [{ id: 'one', name: attack, count: 1, fields: [attack] }];
  input.labels = { one: 'Reviewed books' };
  const html = clientReportHtml({ id: 'test-run', finishedAt: '2026-09-29T00:00:00Z', result: input });
  assert.match(html, /Reviewed books/);
  assert.match(html, /Clustering accuracy is not measured/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /&lt;script&gt;/);
  const elements = [];
  const walk = node => { if (node.tagName) elements.push(node); for (const child of node.childNodes ?? []) walk(child); };
  walk(parse(html));
  assert(!elements.some(node => ['script', 'img', 'iframe', 'object', 'embed'].includes(node.tagName)));
  assert(!elements.some(node => node.attrs.some(attr => /^on/.test(attr.name))));
  assert.throws(() => clientReportHtml({ result: null }), /no completed result/);
});

test('bounded evidence and combined legacy presentation findings are deterministic', () => {
  const pages = ['z', 'a', 'b', 'c', 'd'].map(value => page('/' + value, [{ code: 'html-parse-error', count: 1, evidence: value }, { code: value === 'z' ? 'legacy-font' : 'legacy-center', count: 2 }]));
  const review = buildSiteReview(result(pages));
  assert.deepEqual(review, buildSiteReview(result([...pages].reverse())));
  assert.deepEqual(review.findings.find(item => item.code === 'html-parse-error').evidence, ['a', 'b', 'c']);
  assert.equal(review.findings.find(item => item.code === 'legacy-presentation').occurrences, 10);
});

test('failed known-answer gates remain high priority even when the crawl is complete', () => {
  const input = result([page('/book')]);
  input.provenance.synthetic = true;
  input.evaluation = { status: 'failed', reason: 'Field-value F1 missed the required gate.' };
  const review = buildSiteReview(input);
  assert.equal(review.highPriority, 1);
  assert.equal(review.findings[0].code, 'benchmark-gate-failed');
  assert.match(review.findings[0].evidence[0], /Field-value F1/);
});

test('fetch-time skips identify missing URLs without flagging ordinary out-of-scope links', () => {
  const input = result([page('/collected')]);
  input.crawl.allEligibleAnalyzed = false;
  input.outcomes = [
    { url: '/not-html', state: 'skipped', reason: 'non_html_response', redirects: [] },
    { url: '/blocked-redirect', state: 'skipped', reason: 'auth_or_private_path', redirects: [{ from: '/blocked-redirect', to: '/private/data', status: 302 }] },
    { url: 'https://outside.example/', state: 'skipped', reason: 'cross_origin' },
  ];
  const review = buildSiteReview(input);
  assert.equal(review.affectedUrls, 2);
  assert.deepEqual(review.findings.find(item => item.code === 'fetch-skipped').urls, ['/blocked-redirect', '/not-html']);
  input.clusters = [];
  const html = clientReportHtml({ id: 'skipped-report', result: input });
  assert.match(html, /\/blocked-redirect/);
  assert.match(html, /\/not-html/);
  assert(!html.includes('https://outside.example/'));
});
