import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as evaluatorDownload } from '../app/api/fixtures/[id]/download/route';
import { GET as publicDownload } from '../app/api/fixtures/[id]/sites/[siteId]/download/route';
import { GET as hostsDownload } from '../app/api/fixtures/[id]/hosts/route';
import { getJob, jobDirectory, saveJob, siteDirectory } from '../src/fixture-lab/store.mjs';

const origin = 'http://127.0.0.1:4400';
const batch = (id: string, requestOrigin = origin) => evaluatorDownload(new Request(`${requestOrigin}/api/fixtures/${id}/download`), { params: Promise.resolve({ id }) });

test('evaluator ZIP maps a complete batch from runtime sources, including legacy saved keys', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-evaluator-route-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  const id = randomUUID();
  const sites = ['site-0-library', 'site-1-news'].map((siteId, index) => ({ id: siteId, name: `Site ${index}`, domain: index ? 'news' : 'library', framework: 'html', pageCount: 1, seed: 42 + index }));
  const job = { id, name: 'Legacy evaluator batch', status: 'completed', config: { siteCount: 2 }, createdAt: new Date().toISOString(), sites };
  try {
    await mkdir(jobDirectory(id), { recursive: true });
    for (const [index, site] of sites.entries()) {
      const source = siteDirectory(id, site.id);
      await mkdir(join(source, 'public', 'records'), { recursive: true });
      await mkdir(join(source, 'private'));
      await writeFile(join(source, 'public', 'index.html'), `<h1>Site ${index}</h1>`);
      await writeFile(join(source, 'public', 'records', 'index.html'), `<h1>Record ${index}</h1>`);
      const answer = JSON.stringify({ pages: [{ pageId: `record-${index}`, fields: { title: `Site ${index}` } }] });
      await writeFile(join(source, 'private', index ? 'ground-truth.json' : 'answer-key.json'), answer);
      if (!index) await writeFile(join(source, 'private', 'metadata.json'), JSON.stringify({ pageCount: 1, site: site.id }));
      await writeFile(join(source, 'private', 'canonical.json'), 'private canonical');
      await writeFile(join(source, 'private', 'config.json'), 'private config');
    }
    await saveJob(job);
    assert.equal((await batch(id, 'https://external.example')).status, 403);
    assert.equal((await batch('invalid')).status, 400);
    assert.equal((await batch(randomUUID())).status, 404);
    assert.equal((await hostsDownload(new Request(`${origin}/api/fixtures/${id}/hosts`), { params: Promise.resolve({ id }) })).status, 404);
    const historicalHosts = sites.map(site => `127.0.0.1 ${site.id}.siteforge.test`).join('\n') + '\n';
    await writeFile(join(jobDirectory(id), 'hosts.txt'), historicalHosts);
    const historicalResponse = await hostsDownload(new Request(`${origin}/api/fixtures/${id}/hosts`), { params: Promise.resolve({ id }) });
    assert.equal(historicalResponse.status, 200);
    assert.equal(await historicalResponse.text(), historicalHosts);
    const response = await batch(id);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') || '', /-evaluator\.zip"$/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), false, 'Small archives should not force ZIP64');
    const zip = new AdmZip(bytes);
    const names = zip.getEntries().map(entry => entry.entryName).sort();
    const expected = sites.flatMap(site => {
      const host = `${site.id}.siteforge.test`;
      return [`${host}/answer-key.json`, `${host}/metadata.json`, `${host}/index.html`, `${host}/website/index.html`, `${host}/website/records/index.html`];
    }).sort();
    assert.deepEqual(names, expected);
    for (const [index, site] of sites.entries()) {
      const host = `${site.id}.siteforge.test`;
      assert.match(zip.getEntry(`${host}/index.html`)!.getData().toString(), /\.\/website\/index\.html/);
      assert.equal(JSON.parse(zip.getEntry(`${host}/answer-key.json`)!.getData().toString()).pages[0].fields.title, `Site ${index}`);
      assert.equal(zip.getEntry(`${host}/website/records/index.html`)!.getData().toString(), `<h1>Record ${index}</h1>`);
    }
    assert.equal(JSON.parse(zip.getEntry('site-1-news.siteforge.test/metadata.json')!.getData().toString()).source, 'saved-job');
    assert.equal(zip.getEntries().some(entry => /canonical|config|hosts|ground-truth|private|tls|run\.json/.test(entry.entryName)), false);
    assert.equal((await getJob(id))?.sites.length, 2);
    const firstSource = siteDirectory(id, sites[0].id);
    assert.equal(await readFile(join(firstSource, 'private', 'answer-key.json'), 'utf8'), zip.getEntry('site-0-library.siteforge.test/answer-key.json')!.getData().toString());
    const publicResponse = await publicDownload(new Request(`${origin}/api/fixtures/${id}/sites/${sites[0].id}/download?kind=public`), { params: Promise.resolve({ id, siteId: sites[0].id }) });
    assert.equal(publicResponse.status, 200);
    const publicZip = new AdmZip(Buffer.from(await publicResponse.arrayBuffer()));
    assert.deepEqual(publicZip.getEntries().map(entry => entry.entryName).sort(), ['index.html', 'records/index.html']);
    assert.equal(publicZip.getEntry('answer-key.json'), null);

    const incomplete = { ...job, sites: sites.slice(0, 1) };
    await saveJob(incomplete);
    assert.equal((await batch(id)).status, 409);
    await saveJob(job);
    await symlink(join(firstSource, 'private', 'answer-key.json'), join(firstSource, 'public', 'leak.json'));
    assert.equal((await batch(id)).status, 409);
    await rm(join(firstSource, 'public', 'leak.json'));
    await rm(join(firstSource, 'private', 'answer-key.json'));
    assert.equal((await batch(id)).status, 409);
  } finally {
    if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
    else process.env.FIXTURE_LAB_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
