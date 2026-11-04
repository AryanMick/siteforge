import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClusterInsights } from '../src/crawl/pagepilot/insights.mjs';

function clustered(urls, overrides = {}) {
  return { clusters: [{ id: 'cluster-001', urls, representativeUrl: urls[0] ?? '', cohesion: 0.73, ...overrides }] };
}

test('counts unioned fields and names variable fields without treating them as schema truth', () => {
  const pages = [
    { url: 'https://example.test/items/1', fields: { title: 'One', price: '12.50' }, features: { tags: { article: 1, h1: 1, div: 3 } } },
    { url: 'https://example.test/items/2', fields: { title: 'Two' }, features: { tags: { article: 1, h1: 1, div: 4 } } },
  ];
  const insight = buildClusterInsights(pages, clustered(pages.map(page => page.url)))['cluster-001'];
  assert.deepEqual(insight.fields.map(field => [field.name, field.present, field.total, field.coverage, field.inferredType]), [
    ['price', 1, 2, 0.5, 'number'], ['title', 2, 2, 1, 'text'],
  ]);
  assert.deepEqual(insight.sharedFields, ['title']);
  assert.deepEqual(insight.variableFields, ['price']);
  assert.match(insight.notes.join(' '), /may be optional, but no authoritative schema/i);
});

test('same labels retain one cluster summary even when values describe distinct topics', () => {
  const pages = [
    { url: '/catalog/1', fields: { title: 'Cooking with Apples', author: 'A. Chef' } },
    { url: '/catalog/2', fields: { title: 'Quantum Databases', author: 'D. Engineer' } },
  ];
  const insight = buildClusterInsights(pages, clustered(pages.map(page => page.url)))['cluster-001'];
  assert.deepEqual(insight.sharedFields, ['author', 'title']);
  assert.match(insight.notes.join(' '), /Values and topic text are ignored/i);
});

test('empty and malformed field inputs degrade to empty bounded observations', () => {
  const pages = [{ url: '/blank', fields: null, features: 'bad' }, { url: '/also-blank', fields: [] }];
  const insight = buildClusterInsights(pages, clustered(pages.map(page => page.url)))['cluster-001'];
  assert.deepEqual(insight.fields, []);
  assert.deepEqual(insight.sharedFields, []);
  assert.equal(insight.layoutVariants[0].signature, '(no semantic tag counts)');
});

test('malformed values are bounded and type inference stays conservative', () => {
  const pages = [
    { url: '/people/550e8400-e29b-41d4-a716-446655440000', fields: { id: 42, contact: 'a@example.test', value: '7' } },
    { url: '/people/550e8400-e29b-41d4-a716-446655440001', fields: { id: 'not numeric', contact: 'https://example.test/a', value: '2026-02-30', badDate: '2026-02-30', huge: 'x'.repeat(500) } },
  ];
  const insight = buildClusterInsights(pages, clustered(pages.map(page => page.url)))['cluster-001'];
  const fields = Object.fromEntries(insight.fields.map(field => [field.name, field]));
  assert.equal(fields.id.inferredType, 'mixed');
  assert.equal(fields.contact.inferredType, 'mixed');
  assert.equal(fields.value.inferredType, 'mixed');
  assert.equal(fields.badDate.inferredType, 'text');
  assert.equal(fields.huge.examples[0].length, 150);
  assert.deepEqual(insight.pathPatterns, ['/people/:uuid']);
});

test('output is JSON data, leaves markup inert, and filters prototype-sensitive keys', () => {
  const unsafe = JSON.parse('{"__proto__":"bad","constructor":"bad","prototype":"bad","safe":"<img src=x onerror=alert(1)>"}');
  const insight = buildClusterInsights(
    [{ url: '/x', fields: unsafe, features: { tags: { article: 1, '<script>': 99, script: 1 } } }],
    { clusters: [{ id: '__proto__', urls: ['/x'], representativeUrl: '/x', cohesion: 1 }, { id: 'safe', urls: ['/x'], representativeUrl: '/x', cohesion: 1 }] },
  );
  assert.equal(Object.hasOwn(insight, '__proto__'), false);
  assert.deepEqual(insight.safe.fields.map(field => field.name), ['safe']);
  assert.doesNotThrow(() => JSON.stringify(insight));
  assert.equal(JSON.stringify(insight).includes('<img src=x onerror=alert(1)>'), true);
});

test('results are deterministic under raw-page reordering and retain cluster evidence exactly', () => {
  const pages = [
    { url: '/news/today', fields: { published: '2026-09-22', link: 'https://example.test/a' }, features: { tags: { main: 1, article: 1, p: 4, span: 9 } } },
    { url: '/news/yesterday', fields: { published: '2026-09-21', link: 'https://example.test/b' }, features: { tags: { main: 1, article: 1, p: 4, span: 2 } } },
  ];
  const result = clustered(pages.map(page => page.url), { representativeUrl: '/news/yesterday', cohesion: 0.123456 });
  assert.deepEqual(buildClusterInsights(pages, result), buildClusterInsights([...pages].reverse(), result));
  const insight = buildClusterInsights(pages, result)['cluster-001'];
  assert.equal(insight.representativeUrl, '/news/yesterday');
  assert.equal(insight.cohesion, 0.123456);
  assert.deepEqual(insight.pathPatterns, ['/news/*']);
  assert.equal(insight.layoutVariants[0].signature, 'article:1, main:1, p:4-7');
});

test('date evidence rejects prose and invalid times after a valid calendar date', () => {
  const values = ['2026-09-22 article', '2026-09-22Tgarbage', '2026-09-22T25:61:00Z', '2026-09-22', '2026-09-22T12:30:00Z'];
  const pages = values.map((value, index) => ({ url: `/dates/${index}`, fields: { [`value${index}`]: value } }));
  const insight = buildClusterInsights(pages, clustered(pages.map(page => page.url)))['cluster-001'];
  assert.deepEqual(insight.fields.map(field => field.inferredType), ['text', 'text', 'text', 'date', 'date']);
});
