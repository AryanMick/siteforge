import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalRequest, isRunId } from '../src/fixture-lab/security';

test('local APIs reject cross-origin requests, remote hosts and missing POST origins', () => {
  const request = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
  assert.equal(isLocalRequest(request('http://127.0.0.1:4400/api/fixtures', { origin: 'http://127.0.0.1:4400', host: '127.0.0.1:4400' }), true), true);
  assert.equal(isLocalRequest(request('http://localhost:4400/api/fixtures', { origin: 'http://127.0.0.1:4400', host: '127.0.0.1:4400' }), true), true);
  assert.equal(isLocalRequest(request('http://127.0.0.1:4400/api/fixtures'), true), false);
  assert.equal(isLocalRequest(request('http://127.0.0.1:4400/api/fixtures', { origin: 'https://external.example' }), true), false);
  assert.equal(isLocalRequest(request('http://external.example/api/fixtures')), false);
  assert.equal(isLocalRequest(request('http://127.0.0.1:4400/api/fixtures', { host: 'evil.example' })), false);
  assert.equal(isLocalRequest(request('http://localhost:4400/api/fixtures', { origin: 'http://localhost:4400', 'sec-fetch-site': 'cross-site' }), true), false);
});

test('run identifiers exclude traversal and arbitrary file names', () => {
  assert.equal(isRunId('cc2fbf5d-8d28-4cc4-8f60-0c7c37cf59cd'), true);
  for (const id of ['../config', 'package.json', '', 'cc2fbf5d-8d28-4cc4-8f60-0c7c37cf59cd/../']) assert.equal(isRunId(id), false);
});
