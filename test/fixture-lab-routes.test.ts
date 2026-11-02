import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { GET as list, POST as create } from '../app/api/fixtures/route';
import { DELETE as remove, GET as detail } from '../app/api/fixtures/[id]/route';
import { GET as hosts } from '../app/api/fixtures/[id]/hosts/route';
import { GET as jobDownload } from '../app/api/fixtures/[id]/download/route';
import { GET as answers } from '../app/api/fixtures/[id]/sites/[siteId]/answers/route';
import { GET as download } from '../app/api/fixtures/[id]/sites/[siteId]/download/route';
import { POST as preview } from '../app/api/fixtures/[id]/sites/[siteId]/preview/route';
import { GET as certificate } from '../app/api/fixtures/[id]/sites/[siteId]/certificate/route';
import { GET as catalog, POST as generateCase } from '../app/api/fixtures/catalog/route';
import { POST as randomWebsite } from '../app/api/fixtures/random/route';
import { getJob, previewRecord, siteDirectory } from '../src/fixture-lab/store.mjs';
import { CATALOG_SETTINGS } from '../src/fixture-lab/case-catalog.mjs';

const origin = 'http://127.0.0.1:4400';
const post = (path: string, body = '{}', requestOrigin = origin) => new Request(origin + path, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body });
async function finished(id: string) { for (let attempt = 0; attempt < 300; attempt++) { const job = await getJob(id); if (job?.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Fixture timed out'); }

test('ignored generation settings return field-specific errors without starting jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-override-routes-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    for (const request of [
      { ...CATALOG_SETTINGS, name: 'Full catalog' },
      { ...CATALOG_SETTINGS, name: 'Single catalog', suite: 'catalog-case', siteCount: 1, caseId: 'case-0001', previewProtocol: 'http' },
    ]) {
      for (const extra of [{ cmsProfile: 'wordpress' }, { cmsProfile: 'wordpress', builderProfile: 'elementor' },
        { linkMode: 'absolute' }, { randomness: 70 }]) {
        const response = await create(post('/api/fixtures', JSON.stringify({ ...request, ...extra })));
        assert.equal(response.status, 400);
        const { error } = await response.json();
        for (const key of Object.keys(extra)) assert(error.includes(`${key}:`), error);
        assert.match(error, /fixed settings/);
      }
    }
    for (const cmsProfile of [undefined, 'none', 'drupal']) {
      const input = { name: 'Ignored random builder', pagesPerSite: 5, builderProfile: 'random',
        ...(cmsProfile === undefined ? {} : { cmsProfile }) };
      const response = await create(post('/api/fixtures', JSON.stringify(input)));
      assert.equal(response.status, 400);
      const { error } = await response.json();
      assert.match(error, /builderProfile:.*requires WordPress or a random CMS/);
    }
    assert.deepEqual(await readdir(root), []);
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('random generation preserves seed zero and supplies reproducible answer JSON', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'random-routes-')); const previous = process.env.FIXTURE_LAB_DATA_DIR; process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    assert.equal((await randomWebsite(post('/random', '{}', 'https://external.example'))).status, 403);
    assert.equal((await randomWebsite(post('/random', '{"pagesPerSite":100001}'))).status, 400);
    assert.equal((await randomWebsite(post('/random', '{"sourceCode":"run me"}'))).status, 400);
    const truth = [];
    for (let index = 0; index < 2; index++) {
      const response = await randomWebsite(post('/random', '{"seed":0,"pagesPerSite":16}'));
      assert.equal(response.status, 202);
      const job = await finished((await response.json()).job.id);
      assert.equal(job.config.seed, 0); assert.equal(job.status, 'completed', job.error);
      const hostsResponse = await hosts(new Request(origin + `/api/fixtures/${job.id}/hosts`), { params: Promise.resolve({ id: job.id }) });
      assert.equal(hostsResponse.status, 404);
      assert.equal(job.sites[0].handoff?.version, 1);
      const params = { params: Promise.resolve({ id: job.id, siteId: job.sites[0].id }) };
      const answer = await download(new Request(origin + '/download?kind=answers'), params);
      assert.equal(answer.status, 200); const content = await answer.json();
      assert.equal(content.pages.length, 16); truth.push(content);
    }
    assert.deepEqual(truth[0], truth[1]);
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR; else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('deletion route requires same-origin local requests and removes generated outputs', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'delete-routes-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR; process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    const started = await create(post('/api/fixtures', JSON.stringify({ name: 'Disposable test', pagesPerSite: 5 })));
    const job = await finished((await started.json()).job.id);
    assert.equal(job.status, 'completed');
    const params = { params: Promise.resolve({ id: job.id }) };
    const deletion = (requestOrigin: string) => new Request(`${origin}/api/fixtures/${job.id}`, { method: 'DELETE', headers: { Origin: requestOrigin } });
    assert.equal((await remove(deletion('https://outside.example'), params)).status, 403);
    assert.equal((await detail(new Request(origin), params)).status, 200);
    assert.equal((await remove(deletion(origin), { params: Promise.resolve({ id: '../invalid' }) })).status, 400);
    const deleted = await remove(deletion(origin), params);
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true, id: job.id });
    assert.equal((await detail(new Request(origin), params)).status, 404);
    assert.equal((await remove(deletion(origin), params)).status, 404);
    assert.deepEqual((await (await list(new Request(origin + '/api/fixtures'))).json()).jobs, []);
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR; else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('random endpoint enforces page and variation bounds with persistent answers', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'random-bounds-')); const previous = process.env.FIXTURE_LAB_DATA_DIR; process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    for (const body of [
      { seed: 0, pagesPerSite: 4 }, { seed: 0, pagesPerSite: 100001 },
      { seed: 0, randomness: -1 }, { seed: 0, randomness: 101 },
      { seed: 0, randomness: 0.5 }, { seed: 0, unknown: true },
    ]) assert.equal((await randomWebsite(post('/api/fixtures/random', JSON.stringify(body)))).status, 400);
    for (const [pagesPerSite, randomness] of [[5, 0], [200, 100]]) {
      const response = await randomWebsite(post('/api/fixtures/random', JSON.stringify({ seed: pagesPerSite, pagesPerSite, randomness })));
      assert.equal(response.status, 202);
      const job = await finished((await response.json()).job.id);
      assert.equal(job.status, 'completed', job.error);
      assert.equal(job.config.pagesPerSite, pagesPerSite);
      assert.equal(job.config.randomness, randomness);
      assert.equal(job.sites[0].pageCount, pagesPerSite);
      const params = { params: Promise.resolve({ id: job.id, siteId: job.sites[0].id }) };
      const answer = await download(new Request(origin + '/download?kind=answers'), params);
      assert.equal(answer.status, 200);
      const saved = JSON.parse(await readFile(join(siteDirectory(job.id, job.sites[0].id), 'private/ground-truth.json'), 'utf8'));
      assert.deepEqual(await answer.json(), saved);
      assert.equal(saved.pages.length, pagesPerSite);
      assert.equal(new Set(saved.pages.map((page: {url: string}) => page.url)).size, pagesPerSite);
    }
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR; else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('omitted random seeds and fresh custom seeds avoid every saved job seed', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-route-seeds-')); const previous = process.env.FIXTURE_LAB_DATA_DIR; process.env.FIXTURE_LAB_DATA_DIR = root;
  try {
    assert.equal((await create(post('/api/fixtures', JSON.stringify({ name: 'Bad fresh flag', pagesPerSite: 5, freshSeed: 'true' })))).status, 400);
    const used = new Set<number>();
    for (const [kind, body] of [
      ['random', { seed: 0, pagesPerSite: 5 }],
      ['random', { pagesPerSite: 5 }],
      ['random', { pagesPerSite: 5 }],
      ['custom', { name: 'Fresh custom', pagesPerSite: 5, seed: 0, freshSeed: true }],
    ] as const) {
      const response = kind === 'random'
        ? await randomWebsite(post('/api/fixtures/random', JSON.stringify(body)))
        : await create(post('/api/fixtures', JSON.stringify(body)));
      assert.equal(response.status, 202);
      const job = await finished((await response.json()).job.id);
      assert.equal(job.status, 'completed', job.error);
      assert(!used.has(job.config.seed), `Seed ${job.config.seed} was reused`);
      used.add(job.config.seed);
    }
    assert.equal(used.size, 4);
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR; else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('fixture routes enforce local ownership and expose only selected generated artifacts', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fixture-routes-')); const previous = process.env.FIXTURE_LAB_DATA_DIR; process.env.FIXTURE_LAB_DATA_DIR = root;
  let previewPid: number | undefined;
  try {
    assert.equal((await list(new Request('https://external.example/api/fixtures'))).status, 403);
    assert.equal((await create(post('/api/fixtures', '{}', 'https://external.example'))).status, 403);
    assert.equal((await create(post('/api/fixtures', JSON.stringify({ name: 'Too many', siteCount: 500, pagesPerSite: 1000 })))).status, 400);
    assert.equal((await create(post('/api/fixtures', JSON.stringify({ name: 'Bad delay', pagesPerSite: 12, scenario: 'client-delay', framework: 'html' })))).status, 400);
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        create(post('/api/fixtures', JSON.stringify({ name: index ? `Blocked concurrent ${index}` : 'Route fixture', pagesPerSite: 12 })))),
    );
    assert.deepEqual(concurrent.map(response => response.status).sort(), [202, ...Array(9).fill(409)]);
    const response = concurrent.find(item => item.status === 202)!; const started = (await response.json()).job; const job = await finished(started.id);
    assert.equal(job.status, 'completed', job.error); const site = job.sites[0]; const params = { params: Promise.resolve({ id: job.id, siteId: site.id }) };
    assert.equal((await list(new Request(origin + '/api/fixtures'))).status, 200);
    const inventory = await (await list(new Request(origin + '/api/fixtures'))).json();
    const summary = await (await list(new Request(origin + '/api/fixtures?summary=1'))).json();
    assert.equal(summary.jobs.length, inventory.jobs.length);
    assert.deepEqual(summary.issues, inventory.issues);
    const { sites: omittedSites, ...expectedSummary } = inventory.jobs[0];
    assert.equal(omittedSites.length, 1);
    assert.deepEqual(summary.jobs[0], expectedSummary);
    assert.equal(Object.hasOwn(summary.jobs[0], 'sites'), false);
    assert.equal((await detail(new Request(origin), { params: Promise.resolve({ id: job.id }) })).status, 200);
    assert.equal((await detail(new Request(origin), { params: Promise.resolve({ id: 'invalid' }) })).status, 400);
    assert.equal((await detail(new Request(origin), { params: Promise.resolve({ id: randomUUID() }) })).status, 404);
    assert.equal((await answers(new Request('https://external.example'), params)).status, 403);
    assert.equal((await answers(new Request(origin), { params: Promise.resolve({ id: job.id, siteId: 'INVALID' }) })).status, 400);
    assert.equal((await answers(new Request(origin), { params: Promise.resolve({ id: job.id, siteId: 'site-999-library' }) })).status, 404);
    const truth = await (await answers(new Request(origin), params)).json(); assert.equal(truth.pages.length, 12);
    const window = await (await answers(new Request(origin + '/answers?offset=5&limit=3'), params)).json();
    assert.deepEqual(window.pages, truth.pages.slice(5, 8));
    assert.equal(window.pagination.total, 12);
    assert.equal((await answers(new Request(origin + '/answers?limit=1000'), params)).status, 400);
    assert.equal((await download(new Request(origin + '/download?kind=bad'), params)).status, 400);
    const publicResponse = await download(new Request(origin + '/download?kind=public'), params); assert.equal(publicResponse.status, 200); assert.match(publicResponse.headers.get('content-disposition')!, /public\.zip/);
    const zip = new AdmZip(Buffer.from(await publicResponse.arrayBuffer())); assert(zip.getEntry('index.html')); assert.equal(zip.getEntry('private/ground-truth.json'), null); assert.equal(zip.getEntry('private/answer-key.json'), null);
    const answerResponse = await download(new Request(origin + '/download?kind=answers'), params); assert.match(answerResponse.headers.get('content-disposition')!, /answer-key\.json/); assert.deepEqual(await answerResponse.json(), truth);
    assert.deepEqual(JSON.parse(await readFile(join(siteDirectory(job.id, site.id), 'private/answer-key.json'), 'utf8')), truth);
    // CMS theme packages: installable extensions with the public pages, never the private answer key.
    const wordpress = await download(new Request(origin + '/download?kind=wordpress'), params);
    assert.equal(wordpress.status, 200); assert.equal(wordpress.headers.get('content-type'), 'application/zip'); assert.match(wordpress.headers.get('content-disposition')!, /wordpress-theme\.zip/);
    const wpZip = new AdmZip(Buffer.from(await wordpress.arrayBuffer())); const wpNames = wpZip.getEntries().map(entry => entry.entryName);
    assert(wpNames.some(name => /^siteforge-[^/]+\/style\.css$/.test(name))); assert(wpNames.some(name => name.endsWith('/content/site.json'))); assert(wpNames.some(name => name.endsWith('/content/pages.ndjson')));
    const drupal = await download(new Request(origin + '/download?kind=drupal'), params);
    const drNames = new AdmZip(Buffer.from(await drupal.arrayBuffer())).getEntries().map(entry => entry.entryName);
    assert(drNames.includes('modules/custom/siteforge_content/siteforge_content.info.yml')); assert(drNames.includes('themes/custom/siteforge_theme/templates/html.html.twig'));
    for (const names of [wpNames, drNames]) assert(!names.some(name => /answer-key|ground-truth|canonical\.json|private\//.test(name)), 'no private files in CMS packages');
    assert.equal(wpZip.readAsText(wpNames.find(name => name.endsWith('/content/pages.ndjson'))!).split('\n').filter(Boolean).length, truth.pages.length);
    // The whole test set as one ZIP of per-site packages.
    const batch = await jobDownload(new Request(`http://127.0.0.1:4400/api/fixtures/${job.id}/download?kind=wordpress`), { params: Promise.resolve({ id: job.id }) });
    assert.equal(batch.status, 200); assert.match(batch.headers.get('content-disposition')!, /-wordpress-packages\.zip/);
    const outer = new AdmZip(Buffer.from(await batch.arrayBuffer()));
    const inner = outer.getEntries().find(entry => entry.entryName.endsWith('-wordpress-theme.zip'))!;
    assert(inner, 'per-site theme ZIP inside');
    assert(new AdmZip(inner.getData()).getEntries().some(entry => /^siteforge-[^/]+\/style\.css$/.test(entry.entryName)), 'inner ZIP is an installable theme');
    assert(outer.getEntry('README.txt'));
    assert.equal((await jobDownload(new Request(`http://127.0.0.1:4400/api/fixtures/${job.id}/download?kind=joomla`), { params: Promise.resolve({ id: job.id }) })).status, 400);
    assert.equal((await preview(post('/preview', '{}', 'https://external.example'), params)).status, 403);
    const previewResponse = await preview(post('/preview'), params); assert.equal(previewResponse.status, 200); const url = (await previewResponse.json()).url;
    assert.equal((await fetch(url)).status, 200); assert.equal((await fetch(url + '/private/ground-truth.json')).status, 404); assert.equal((await fetch(url + '/private/answer-key.json')).status, 404);
    previewPid = (await previewRecord(job.id, site.id))?.pid;
  } finally {
    if (previewPid) process.kill(previewPid, 'SIGTERM');
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR; else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('catalog filters, generation, HTTPS trust and certificate ownership work together', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-routes-')); const previous = process.env.FIXTURE_LAB_DATA_DIR; process.env.FIXTURE_LAB_DATA_DIR = root;
  let previewPid: number | undefined;
  const get = (query = '') => catalog(new Request(`${origin}/api/fixtures/catalog${query}`));
  try {
    const inventory = await (await get()).json();
    assert.equal(inventory.total, 3120); assert.equal(inventory.matched, 3120); assert.equal(inventory.core, 1440);
    assert.equal((await (await get('?set=core')).json()).matched, 1440); assert.equal((await (await get('?set=real-world&profile=word-paste')).json()).matched, 240); assert.equal(inventory.cases.length, 25);
    const filtered = await (await get('?protocol=https&framework=html&profile=http-faults')).json();
    assert.equal(filtered.matched, 40);
    assert(filtered.cases.every((item: {protocol: string; framework: string}) => item.protocol === 'https' && item.framework === 'html'));
    assert.equal((await get('?pageSize=1000')).status, 400);
    assert.equal((await get('?unknown=1')).status, 400);
    assert.equal((await catalog(new Request('https://external.example/api/fixtures/catalog'))).status, 403);
    assert.equal((await generateCase(post('/catalog', '{"mode":"all"}', 'https://external.example'))).status, 403);
    assert.equal((await generateCase(post('/catalog', '{"mode":"single","caseId":"case-9999"}'))).status, 400);
    const started = await generateCase(post('/catalog', JSON.stringify({ mode: 'single', caseId: filtered.cases[0].id })));
    assert.equal(started.status, 202);
    const job = await finished((await started.json()).job.id);
    assert.equal(job.status, 'completed', job.error); assert.equal(job.totalPages, 16); assert.equal(job.sites[0].transportRules, 10);
    const site = job.sites[0]; const params = { params: Promise.resolve({ id: job.id, siteId: site.id }) };
    assert.equal((await certificate(new Request(origin), params)).status, 404);
    assert.equal((await certificate(new Request('https://external.example'), params)).status, 403);
    assert.equal((await certificate(new Request(origin), { params: Promise.resolve({ id: job.id, siteId: 'case-9999' }) })).status, 404);
    const opened = await preview(post('/preview'), params);
    assert.equal(opened.status, 200); const url = (await opened.json()).url;
    previewPid = (await previewRecord(job.id, site.id))?.pid;
    assert.match(url, /^https:\/\//);
    assert.equal((await (await preview(post('/preview'), params)).json()).url, url);
    const certResponse = await certificate(new Request(origin), params);
    assert.equal(certResponse.status, 200); const ca = await certResponse.text();
    assert.match(ca, /BEGIN CERTIFICATE/); assert.doesNotMatch(ca, /PRIVATE KEY/);
    const status = (path: string, certificateAuthority?: string) => new Promise<number>((resolve, reject) => {
      const request = httpsRequest(url + path, { ca: certificateAuthority }, response => { response.resume(); resolve(response.statusCode!); });
      request.on('error', reject); request.end();
    });
    await assert.rejects(status('/'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    assert.equal(await status('/', ca), 200);
    assert.equal(await status('/private/tls/key.pem', ca), 404);
    assert.equal(await status('/private/ground-truth.json', ca), 404);
    const zip = new AdmZip(Buffer.from(await (await download(new Request(origin + '/download?kind=public'), params)).arrayBuffer()));
    assert(zip.getEntries().every(entry => !/\.pem$|private\//.test(entry.entryName)));
  } finally {
    if (previewPid) process.kill(previewPid, 'SIGTERM');
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR; else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
