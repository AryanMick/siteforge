import test from 'node:test';
import assert from 'node:assert/strict';
import { publicProjectInput, validateProject, evaluationGate } from '../src/crawl/pagepilot/config.mjs';

test('quick start creates a bounded public project from a pasted address', () => {
  const input = publicProjectInput('  books.toscrape.com/catalogue/?page=2#results  ');
  assert.equal(input.name, 'books.toscrape.com');
  assert.equal(input.mode, 'public');
  assert.equal(input.url, 'https://books.toscrape.com/catalogue/?page=2');
  assert.equal(input.maxPages, 100);
  assert.equal(input.maxDepth, 6);
  assert.equal(input.maxDurationMinutes, 15);
  assert.equal(input.pathPrefix, '/');
  assert.equal(publicProjectInput('http://example.com').url, 'http://example.com/');
  assert.equal(publicProjectInput('example.com:8443/library', { maxPages: 3, pathPrefix: '/library' }).url, 'https://example.com:8443/library');
});

test('crawl budgets reject non-finite, fractional and out-of-range values with field errors', () => {
  for (const maxPages of [0, -1, 501, 1.5, NaN, Infinity, -Infinity, null, '5']) {
    assert.throws(() => publicProjectInput('example.com', { maxPages }), error => {
      assert.equal(error.field, 'maxPages');
      assert.equal(error.message, 'Page limit must be a whole number from 1 to 500.');
      return true;
    });
  }
  for (const maxPages of [1, 500]) assert.equal(publicProjectInput('example.com', { maxPages }).maxPages, maxPages);
  for (const maxDepth of [-1, 11, 1.5, null]) assert.throws(() => publicProjectInput('example.com', { maxDepth }), { field: 'maxDepth' });
  for (const maxDurationMinutes of [0, 31, 1.5, null]) assert.throws(() => publicProjectInput('example.com', { maxDurationMinutes }), { field: 'maxDurationMinutes' });
  const configured = publicProjectInput('example.com', { maxPages: 321, maxDepth: 9, maxDurationMinutes: 27 });
  assert.deepEqual([configured.maxPages, configured.maxDepth, configured.maxDurationMinutes], [321, 9, 27]);
});

test('the starting page must belong to the selected path scope on a segment boundary', () => {
  for (const address of ['example.com', 'example.com/library-other', 'example.com/books/library']) {
    assert.throws(() => publicProjectInput(address, { pathPrefix: '/library' }), { field: 'pathPrefix', message: 'The website address must be inside the path scope.' });
  }
  for (const address of ['example.com/library', 'example.com/library/', 'example.com/library/book?edition=2']) {
    assert.equal(publicProjectInput(address, { pathPrefix: '/library/' }).pathPrefix, '/library/');
  }
  assert.equal(publicProjectInput('example.com/caf%C3%A9/book', { pathPrefix: '/caf%C3%A9' }).pathPrefix, '/caf%C3%A9');
});

test('API input cannot bypass the URL and path checks used by the quick-start form', () => {
  for (const url of ['https:example.com', 'https://exa\nmple.com', 'https://example.com\\private', 'https://localhost.', 'https://demo.localhost.', 'https://example.com/%GG', 'https://example.com/%00', 'https://example.com/%5csecret', 'https://example.com/.hidden']) {
    assert.throws(() => validateProject({ name: 'Public', mode: 'public', url }), { field: 'url' }, url);
  }
  for (const pathPrefix of ['', '/%GG', '/%00', '/%0a', '/a?b', '/.hidden']) {
    assert.throws(() => publicProjectInput('example.com', { pathPrefix }), { field: 'pathPrefix' }, pathPrefix);
  }
});

test('normalization preserves meaningful query parameters, international hosts, ports and encoded spaces', () => {
  assert.equal(publicProjectInput('HTTPS://EXAMPLE.COM:443/books?q=one%20two&edition=2#description').url, 'https://example.com/books?q=one%20two&edition=2');
  assert.equal(publicProjectInput('https://xn--bcher-kva.example/books').name, 'xn--bcher-kva.example');
  assert.equal(publicProjectInput('example.com:8443/a%20b').url, 'https://example.com:8443/a%20b');
});

test('accuracy gates reject corrupt scores rather than reporting a successful benchmark', () => {
  const valid = { coverage: 1, pairwiseF1: 0.95, fieldValueF1: 0.95 };
  assert.equal(evaluationGate(valid, true).status, 'passed');
  for (const field of Object.keys(valid)) {
    for (const value of [NaN, Infinity, -Infinity, 1.01, -0.1, null, undefined, '1']) {
      assert.equal(evaluationGate({ ...valid, [field]: value }, true).status, 'failed', `${field}: ${value}`);
    }
  }
  for (const metrics of [undefined, null, {}]) assert.equal(evaluationGate(metrics, true).status, 'failed');
  assert.equal(evaluationGate(null, false).status, 'not_available');
});

test('quick start rejects ambiguous, unsafe and invalid configuration before creation', () => {
  for (const url of ['', '   ', 'not a website', '/relative/path', '//example.com', 'https:example.com', 'ftp://example.com', 'javascript:alert(1)', 'https://user:password@example.com', 'http://localhost', 'http://127.0.0.1', 'http://[::1]', 'https://exa\nmple.com', 'example', 'https://example.com\\private']) {
    assert.throws(() => publicProjectInput(url), undefined, url);
  }
  assert.throws(() => publicProjectInput('example.com', { maxPages: 501 }));
  assert.throws(() => publicProjectInput('example.com', { pathPrefix: '/%2eenv' }));
});
