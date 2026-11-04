import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { generate } from '../src/site/generator.mjs';
import { parseSiteHost, siteHostname, startGateway } from '../src/fixture-lab/gateway.mjs';

const jobId = '23ba1c75-298c-4b49-9320-1707a6a714cf';
const siteId = 'site-001-library';
const secondSiteId = 'site-002-news';

test('hostname gateway isolates two public sites and rebases their metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-gateway-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  let gateway;
  try {
    const jobRoot = join(root, 'jobs', jobId);
    const directory = join(jobRoot, 'sites', siteId);
    const secondDirectory = join(jobRoot, 'sites', secondSiteId);
    await mkdir(join(jobRoot, 'sites'), { recursive: true });
    await generate({ version: 1, seed: 4, site: { id: siteId, domain: 'library', framework: 'html', pageCount: 5, baseUrl: `http://${siteHostname(siteId)}` }, noise: { level: 'clean' } }, directory);
    await generate({ version: 1, seed: 5, site: { id: secondSiteId, domain: 'news', framework: 'html', pageCount: 6, baseUrl: `http://${siteHostname(secondSiteId)}` }, noise: { level: 'clean' } }, secondDirectory);
    await writeFile(join(jobRoot, 'job.json'), JSON.stringify({ id: jobId, name: 'Gateway test', status: 'completed', config: {}, createdAt: new Date().toISOString(), sites: [{ id: siteId }, { id: secondSiteId }] }));
    gateway = await startGateway({ jobId, port: 0 });
    const hostname = siteHostname(siteId);
    const request = (path, host = `${hostname}:${gateway.port}`) => new Promise((accept, reject) => {
      const client = httpRequest({ hostname: '127.0.0.1', port: gateway.port, path, headers: { Host: host } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => accept({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      client.on('error', reject); client.end();
    });
    const home = await request('/');
    assert.equal(home.status, 200, home.body);
    assert.match(home.body, new RegExp(`http://${hostname}:${gateway.port}/`));
    const secondHome = await request('/', `${siteHostname(secondSiteId)}:${gateway.port}`);
    assert.equal(secondHome.status, 200, secondHome.body);
    assert.match(secondHome.body, new RegExp(`http://${siteHostname(secondSiteId)}:${gateway.port}/`));
    assert.doesNotMatch(secondHome.body, new RegExp(`http://${hostname}:${gateway.port}/`));
    const sitemap = await request('/sitemap.xml');
    assert.match(sitemap.body, new RegExp(`http://${hostname}:${gateway.port}/`));
    assert.equal((await request('/private/answer-key.json')).status, 404);
    assert.equal((await request('/', `unknown.siteforge.test:${gateway.port}`)).status, 404);
    assert.equal((await request('/', 'example.com')).status, 404);
    assert.equal((await request('/', `${hostname}:99999`)).status, 404);
    assert.equal(JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8')).pages.length, 5);
    const metadata = JSON.parse(await readFile(join(directory, 'private', 'metadata.json'), 'utf8'));
    assert.equal(metadata.pageCount, 5);
    assert.equal(metadata.site.id, siteId);
    assert.match(await readFile(join(directory, 'index.html'), 'utf8'), /url=\.\/public\/index\.html/);
  } finally {
    await gateway?.close();
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('hostnames reject malformed and non-local fixture domains', () => {
  const hostname = siteHostname(siteId);
  assert.deepEqual(parseSiteHost(hostname), { siteId, authority: hostname });
  for (const host of ['example.com', `${hostname}.evil.test`, `${hostname}:0`, `${hostname}:65536`, `a@${hostname}`, `${hostname}/private`, '']) assert.equal(parseSiteHost(host), null);
});
