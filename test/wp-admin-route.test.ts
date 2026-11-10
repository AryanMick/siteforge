import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../app/wp-admin/[[...path]]/route';

const call = (path: string[] | undefined, url: string, headers: Record<string, string> = {}) =>
  GET(new Request(url, { headers }), { params: Promise.resolve(path ? { path } : {}) });

test('/wp-admin on the SiteForge address opens the local WordPress dashboard, or offers to start it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'siteforge-wp-admin-'));
  const previous = process.cwd();
  // Stands in for a running WordPress: the status check only asks /wp-json/ for its namespaces.
  const wordpress = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ namespaces: ['wp/v2'] }));
  });
  try {
    process.chdir(directory);

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
  } finally {
    process.chdir(previous);
    wordpress.close();
    await rm(directory, { recursive: true, force: true });
  }
});
