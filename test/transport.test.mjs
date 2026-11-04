import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildTransportPlan, TRANSPORT_PROFILES, validateTransportPlan } from '../src/noise/transport.mjs';
import { serve } from '../src/preview/server.mjs';

const fixtureRoots = [];
test.after(async () => {
  for (const root of fixtureRoots) await rm(root, { recursive: true, force: true });
});

const detailPages = count => Array.from({ length: count }, (_, index) => ({
  kind: 'detail',
  url: `/records/${String(index + 1).padStart(3, '0')}/`,
}));

async function writePublic(root, path, body) {
  const file = path.endsWith('/') ? join(root, 'public', path, 'index.html') : join(root, 'public', path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
}

async function fixture(plan, { rawManifest, malformedHtml = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-transport-test-'));
  fixtureRoots.push(root);
  await mkdir(join(root, 'private'));
  await writePublic(root, '/', '<!doctype html><title>Healthy home</title><h1>Healthy home</h1>');
  await writePublic(root, '/records/', '<!doctype html><title>Healthy listing</title>');
  await writePublic(root, '/assets/site.css', 'body { color: black; }');
  await writePublic(root, '/robots.txt', 'User-agent: *\nAllow: /\n');
  for (const page of detailPages(14)) {
    const markup = malformedHtml
      ? `<!doctype html><html><head><link rel="canonical" href="https://fixture.example${page.url}"><title>Record</title></head><body><p class="wrapOuter">Archived record starts here<div>Record ${page.url}</div></body></html>`
      : `<!doctype html><html><head><link rel="canonical" href="https://fixture.example${page.url}"><title>Record</title></head><body>Original HTML ${page.url}</body></html>`;
    await writePublic(root, page.url, markup);
  }
  if (rawManifest !== undefined) await writeFile(join(root, 'private', 'transport.json'), rawManifest);
  else if (plan) await writeFile(join(root, 'private', 'transport.json'), JSON.stringify(plan));
  return root;
}

test('transport plans are deterministic, detail-only, bounded, and profile-complete', () => {
  assert.deepEqual(TRANSPORT_PROFILES, ['none', 'errors', 'redirects', 'mixed', 'legacy-server']);
  const pages = [
    { kind: 'home', url: '/' },
    { kind: 'listing', url: '/records/' },
    { kind: 'detail', url: '/assets/not-eligible/' },
    ...detailPages(14),
  ];
  const mixed = buildTransportPlan(pages, { profile: 'mixed', seed: 8128 });
  assert.deepEqual(mixed, buildTransportPlan([...pages].reverse(), { profile: 'mixed', seed: 8128 }));
  assert.notDeepEqual(mixed.rules.map(rule => rule.path), buildTransportPlan(pages, { profile: 'mixed', seed: 8129 }).rules.map(rule => rule.path));
  assert.deepEqual(mixed.rules.map(rule => rule.type), [
    'http-403', 'http-404', 'http-410', 'http-429', 'http-503', 'soft-404',
    'wrong-content-type', 'slow-response', 'redirect-chain', 'redirect-loop',
  ]);
  assert.equal(new Set(mixed.rules.map(rule => rule.path)).size, 10);
  assert(mixed.rules.every(rule => pages.some(page => page.kind === 'detail' && page.url === rule.path)));
  assert(mixed.rules.every(rule => rule.expected && Object.hasOwn(rule.expected, 'availability') && Object.hasOwn(rule.expected, 'finalPath')));
  assert.equal(buildTransportPlan(pages, { profile: 'errors', seed: 1 }).rules.length, 6);
  assert.equal(buildTransportPlan(pages, { profile: 'redirects', seed: 1 }).rules.length, 2);
  assert.equal(buildTransportPlan(detailPages(3), { profile: 'mixed', seed: 1 }).rules.length, 3);
  assert.deepEqual(buildTransportPlan(pages).rules, []);
});

test('transport validation rejects extensions, unsafe paths, unbounded values, and external redirects', () => {
  const plan = buildTransportPlan(detailPages(14), { profile: 'mixed', seed: 3 });
  assert.deepEqual(validateTransportPlan(plan), plan);
  for (const mutate of [
    value => { value.extra = true; },
    value => { value.rules[0].path = '/assets/site.css'; },
    value => { value.rules[0].path = '/records/%2e%2e/private/'; },
    value => { value.rules[0].path = '//records/001/'; },
    value => { value.rules[0].headers = { 'Set-Cookie': 'x=y' }; },
    value => { value.rules.find(rule => rule.type === 'slow-response').delayMs = 301; },
    value => { value.rules.find(rule => rule.type === 'redirect-chain').expected.finalPath = 'https://example.com/'; },
    value => { value.rules.find(rule => rule.type === 'redirect-loop').virtualPaths[0] = '/ordinary/path'; },
    value => { value.rules.find(rule => rule.type === 'redirect-loop').virtualPaths[0] += '\r\nLocation: https://example.com/'; },
  ]) {
    const invalid = structuredClone(plan);
    mutate(invalid);
    assert.throws(() => validateTransportPlan(invalid), /Invalid transport plan/);
  }
});

test('server applies all bounded synthetic obstacles while health routes stay normal', async () => {
  const plan = buildTransportPlan(detailPages(14), { profile: 'mixed', seed: 991 });
  const root = await fixture(plan);
  const preview = await serve(root, { port: 0 });
  const byType = Object.fromEntries(plan.rules.map(rule => [rule.type, rule]));
  try {
    for (const type of ['http-403', 'http-404', 'http-410', 'http-429', 'http-503']) {
      const rule = byType[type];
      const response = await fetch(preview.url + rule.path, { redirect: 'manual' });
      assert.equal(response.status, rule.status, type);
      for (const alias of [rule.path.replace('/records/', '/records//'), rule.path + 'index.html']) {
        assert.equal((await fetch(preview.url + alias, { redirect: 'manual' })).status, rule.status, `${type} alias ${alias}`);
      }
      if (type === 'http-429') assert.equal(response.headers.get('retry-after'), '1');
      const head = await fetch(preview.url + rule.path, { method: 'HEAD', redirect: 'manual' });
      assert.equal(head.status, rule.status, `${type} HEAD`);
      assert.equal(await head.text(), '');
      assert(Number(head.headers.get('content-length')) > 0);
    }

    for (const rule of plan.rules) {
      const head = await fetch(preview.url + rule.path, { method: 'HEAD', redirect: 'manual' });
      assert.equal(head.status, rule.status, `${rule.type} HEAD status`);
      assert.equal(await head.text(), '', `${rule.type} HEAD body`);
    }

    const soft = await fetch(preview.url + byType['soft-404'].path);
    assert.equal(soft.status, 200);
    assert.match(soft.headers.get('content-type'), /^text\/html/);
    assert.match(await soft.text(), /Page not found/);

    const wrong = await fetch(preview.url + byType['wrong-content-type'].path);
    assert.equal(wrong.status, 200);
    assert.equal(wrong.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.match(await wrong.text(), /Original HTML/);

    const began = performance.now();
    const slow = await fetch(preview.url + byType['slow-response'].path);
    const elapsed = performance.now() - began;
    assert.equal(slow.status, 200);
    assert(elapsed >= 260, `expected a bounded delay, observed ${elapsed}ms`);
    assert(elapsed < 1500, `delay exceeded bound with scheduling allowance: ${elapsed}ms`);

    const chainRule = byType['redirect-chain'];
    let response = await fetch(preview.url + chainRule.path, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), chainRule.virtualPaths[0]);
    response = await fetch(preview.url + response.headers.get('location'), { redirect: 'manual' });
    assert.equal(response.headers.get('location'), chainRule.virtualPaths[1]);
    response = await fetch(preview.url + response.headers.get('location'), { redirect: 'manual' });
    assert.equal(response.headers.get('location'), '/');
    assert.equal((await fetch(preview.url + chainRule.path)).url, `${preview.url}/`);

    const loopRule = byType['redirect-loop'];
    response = await fetch(preview.url + loopRule.path, { redirect: 'manual' });
    assert.equal(response.headers.get('location'), loopRule.virtualPaths[0]);
    response = await fetch(preview.url + response.headers.get('location'), { redirect: 'manual' });
    assert.equal(response.headers.get('location'), loopRule.path);
    await assert.rejects(fetch(preview.url + loopRule.path), /redirect|fetch failed/i);

    for (const path of ['/', '/records/', '/assets/site.css', '/robots.txt']) assert.equal((await fetch(preview.url + path)).status, 200, path);
    for (const path of ['/private/transport.json', '/%70rivate/transport.json', '/%2e%2e/private/transport.json', '/__siteforge_transport__/v1/not-a-route']) {
      assert.equal((await fetch(preview.url + path, { redirect: 'manual' })).status, 404, path);
    }
  } finally {
    await preview.close();
  }
});

test('server rejects malformed manifests and missing targets before listening', async () => {
  const malformed = await fixture(null, { rawManifest: '{"version":1,"profile":"mixed","rules":[' });
  await assert.rejects(serve(malformed, { port: 0 }), /invalid private\/transport\.json/);

  const plan = buildTransportPlan(detailPages(14), { profile: 'errors', seed: 8 });
  plan.rules[0].path = '/records/missing/';
  const missing = await fixture(plan);
  await assert.rejects(serve(missing, { port: 0 }), /transport target does not exist/);
});

test('fixtures without a manifest retain canonical rebasing and source markup', async () => {
  const root = await fixture(null, { malformedHtml: true });
  const preview = await serve(root, { port: 0, rebaseOrigin: true });
  try {
    const response = await fetch(`${preview.url}/records/001/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert(html.includes(`href="${preview.url}/records/001/"`));
    assert(html.includes('<p class="wrapOuter">Archived record starts here<div'));
  } finally {
    await preview.close();
  }
});
