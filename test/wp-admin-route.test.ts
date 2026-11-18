import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../app/wp-admin/[[...path]]/route';
import { GET as DRUPAL_ADMIN } from '../app/admin/[[...path]]/route';
import { GET as DRUPAL_SITE } from '../app/drupal/[[...path]]/route';

const call = (path: string[] | undefined, url: string, headers: Record<string, string> = {}) =>
  GET(new Request(url, { headers }), { params: Promise.resolve(path ? { path } : {}) });

test('/wp-admin on the SiteForge address opens the local WordPress dashboard, or offers to start it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'siteforge-wp-admin-'));
  const previous = process.cwd();
  // Stands in for a running WordPress: the status check only asks /wp-json/ for its namespaces.
  const wordpress = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ namespaces: ['wp/v2'], installed: true }));
  });
  try {
    process.chdir(directory);

    const drupalStopped = await DRUPAL_ADMIN(new Request('http://127.0.0.1:4400/admin'), { params: Promise.resolve({}) });
    assert.match(await drupalStopped.text(), /<button id="start" type="button">Start Drupal<\/button>[\s\S]*const target = "http:\/\/127\.0\.0\.1:\d+\/admin";/);

    const stopped = await call(undefined, 'http://127.0.0.1:4400/wp-admin');
    assert.equal(stopped.status, 200);
    assert.match(stopped.headers.get('content-type') ?? '', /^text\/html/);
    const html = await stopped.text();
    assert.match(html, /<button id="start" type="button">Start WordPress<\/button>/);
    assert.match(html, /const target = "http:\/\/127\.0\.0\.1:\d+\/wp-admin\/";/);

    assert.equal((await call(undefined, 'http://127.0.0.1:4400/wp-admin', { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call(undefined, 'http://127.0.0.1:4400/wp-admin', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);

    await new Promise<void>(resolve => wordpress.listen(0, '127.0.0.1', resolve));
    const { port } = wordpress.address() as { port: number };
    await mkdir(join(directory, '.wordpress'));
    await writeFile(join(directory, '.wordpress', 'runtime.json'), JSON.stringify({ pid: process.pid, port, state: 'running', startedAt: new Date().toISOString() }));

    const dashboard = await call(undefined, 'http://127.0.0.1:4400/wp-admin');
    assert.equal(dashboard.status, 307);
    assert.equal(dashboard.headers.get('location'), `http://127.0.0.1:${port}/wp-admin/`);
    const list = await call(['edit.php'], 'http://127.0.0.1:4400/wp-admin/edit.php?post_type=sf_book');
    assert.equal(list.headers.get('location'), `http://127.0.0.1:${port}/wp-admin/edit.php?post_type=sf_book`);

    await mkdir(join(directory, '.drupal'));
    await writeFile(join(directory, '.drupal', 'runtime.json'), JSON.stringify({ pid: process.pid, port, state: 'running', startedAt: new Date().toISOString() }));
    const admin = await DRUPAL_ADMIN(new Request('http://127.0.0.1:4400/admin'), { params: Promise.resolve({}) });
    assert.equal(admin.headers.get('location'), `http://127.0.0.1:${port}/admin`);
    const content = await DRUPAL_ADMIN(new Request('http://127.0.0.1:4400/admin/content?type=sf_book'), { params: Promise.resolve({ path: ['content'] }) });
    assert.equal(content.headers.get('location'), `http://127.0.0.1:${port}/admin/content?type=sf_book`);
    const record = await DRUPAL_SITE(new Request('http://127.0.0.1:4400/drupal/books/000001-x/'), { params: Promise.resolve({ path: ['books', '000001-x'] }) });
    assert.equal(record.headers.get('location'), `http://127.0.0.1:${port}/books/000001-x/`);
  } finally {
    process.chdir(previous);
    wordpress.close();
    await rm(directory, { recursive: true, force: true });
  }
});
