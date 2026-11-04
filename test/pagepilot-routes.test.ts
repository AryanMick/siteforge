import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GET, POST } from '../app/api/projects/route';
import { GET as health } from '../app/api/health/route';
import { serverIdentity } from '../src/crawl/pagepilot/server-identity.mjs';
import { GET as detail } from '../app/api/projects/[id]/route';
import { POST as run } from '../app/api/projects/[id]/run/route';
import { GET as download } from '../app/api/projects/[id]/runs/[runId]/export/route';
import { PATCH as settings } from '../app/api/projects/[id]/route';
import { PATCH as labels } from '../app/api/projects/[id]/runs/[runId]/labels/route';
import { POST as recluster } from '../app/api/projects/[id]/recluster/route';
import { POST as stop } from '../app/api/projects/[id]/runs/[runId]/stop/route';
import { createProject, startRun, getRun, runDirectory } from '../src/crawl/pagepilot/store.mjs';

const origin = 'http://127.0.0.1:4400';
const request = (body: string, headers: Record<string, string> = {}) => new Request(`${origin}/api/projects`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body });
test('health identifies this workspace without exposing its path or project data', async () => {
  const response = await health(new Request(`${origin}/api/health`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const identity = await response.json();
  assert.deepEqual(identity, await serverIdentity());
  assert.match(identity.workspaceId, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(identity).includes(process.cwd()));
  assert.equal((await health(new Request('https://external.example/api/health'))).status, 403);
  assert.equal((await health(new Request(`${origin}/api/health`, { headers: { Origin: 'https://external.example' } }))).status, 403);
});
test('project routes enforce origin, strict inputs, byte limits, IDs and export ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepilot-api-')); process.env.PAGEPILOT_DATA_DIR = directory;
  try {
    assert.equal((await POST(request('{}', { Origin: 'https://external.example' }))).status, 403);
    assert.equal((await POST(request('{}', { Origin: '' }))).status, 403);
    assert.equal((await GET(new Request('https://external.example/api/projects'))).status, 403);
    assert.equal((await POST(request('{}', { 'Content-Type': 'text/plain' }))).status, 415);
    assert.equal((await POST(request('x'.repeat(8193)))).status, 413);
    assert.equal((await POST(request('{'))).status, 400);
    assert.equal((await POST(request('{"name":"Test","command":"ls"}'))).status, 400);
    const created = await POST(request('{"name":"Test"}')); assert.equal(created.status, 201);
    const { project } = await created.json();
    const listed = await GET(new Request(`${origin}/api/projects`)); assert.equal((await listed.json()).projects.length, 1);
    assert.equal((await detail(new Request(origin), { params: Promise.resolve({ id: project.id }) })).status, 200);
    assert.equal((await detail(new Request(origin), { params: Promise.resolve({ id: 'invalid' }) })).status, 400);
    assert.equal((await detail(new Request(origin), { params: Promise.resolve({ id: randomUUID() }) })).status, 404);
    assert.equal((await run(request('{"command":"ls"}'), { params: Promise.resolve({ id: project.id }) })).status, 400);
    assert.equal((await run(request('{}'), { params: Promise.resolve({ id: randomUUID() }) })).status, 404);
    assert.equal((await download(new Request(origin), { params: Promise.resolve({ id: project.id, runId: randomUUID() }) })).status, 404);
  } finally { delete process.env.PAGEPILOT_DATA_DIR; await rm(directory, { recursive: true, force: true }); }
});

test('editing routes enforce ownership and validation and export saved labels as CSV', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepilot-edit-api-'));
  process.env.PAGEPILOT_DATA_DIR = directory;
  try {
    const project = await createProject({ name: 'API library', pageCount: 12 });
    const started = await startRun(project.id);
    let saved = await getRun(project.id, started.id);
    for (let attempt = 0; saved.status === 'running' && attempt < 200; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100)); saved = await getRun(project.id, started.id);
    }
    assert.equal(saved.status, 'completed');
    const params = { params: Promise.resolve({ id: project.id, runId: saved.id }) };
    const projectParams = { params: Promise.resolve({ id: project.id }) };
    const clusterId = saved.result.clusters[0].id;
    assert.equal((await labels(request('{}', { Origin: 'https://external.example' }), params)).status, 403);
    assert.equal((await settings(request('{}', { Origin: 'https://external.example' }), projectParams)).status, 403);
    assert.equal((await recluster(request('{}', { Origin: 'https://external.example' }), projectParams)).status, 403);
    assert.equal((await labels(request(JSON.stringify({ labels: { unknown: 'Bad' } })), params)).status, 400);
    assert.equal((await labels(request(JSON.stringify({ labels: { [clusterId]: 'Books' } })), { params: Promise.resolve({ id: randomUUID(), runId: saved.id }) })).status, 404);
    assert.equal((await labels(request(JSON.stringify({ labels: { [clusterId]: 'Reviewed books' } })), params)).status, 200);
    assert.equal((await settings(request('{"name":"Changed","threshold":2}'), projectParams)).status, 400);
    assert.equal((await recluster(request(JSON.stringify({ sourceRunId: saved.id, threshold: -1, excludedUrls: [] })), projectParams)).status, 400);
    assert.equal((await recluster(request(JSON.stringify({ sourceRunId: saved.id, threshold: 0.32, excludedUrls: ['/unknown'] })), projectParams)).status, 400);
    const csv = await download(new Request(`${origin}/api/projects/export?format=csv`), params);
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type')!, /text\/csv/);
    assert.match(await csv.text(), /Reviewed books/);
    const html = await download(new Request(`${origin}/api/projects/export?format=html`), params);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type')!, /text\/html/);
    assert.match(html.headers.get('content-security-policy')!, /sandbox/);
    assert.match(html.headers.get('content-disposition')!, /attachment/);
    assert.match(await html.text(), /Reviewed books/);
    assert.equal((await download(new Request(`${origin}/api/projects/export?format=exe`), params)).status, 400);
    const json = await download(new Request(origin), params);
    assert.equal((await json.json()).result.labels[clusterId], 'Reviewed books');
  } finally { delete process.env.PAGEPILOT_DATA_DIR; await rm(directory, { recursive: true, force: true }); }
});

test('public validation returns readable errors and leaves project storage unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepilot-validation-api-'));
  const previous = process.env.PAGEPILOT_DATA_DIR;
  process.env.PAGEPILOT_DATA_DIR = directory;
  try {
    for (const [extra, message] of [
      [{ maxPages: 501 }, 'Page limit must be a whole number from 1 to 500.'],
      [{ pathPrefix: '/catalogue' }, 'The website address must be inside the path scope.'],
      [{ url: 'https://example.com\\private' }, 'Enter a full HTTP or HTTPS URL without spaces or backslashes.'],
    ] as const) {
      const response = await POST(request(JSON.stringify({ name: 'Rejected', mode: 'public', url: 'https://example.com/', ...extra })));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, message);
    }
    assert.deepEqual((await (await GET(new Request(`${origin}/api/projects`))).json()).projects, []);
    const project = await createProject({ name: 'Preserved public project', mode: 'public', url: 'https://example.com/' });
    const params = { params: Promise.resolve({ id: project.id }) };
    const response = await settings(request(JSON.stringify({ name: 'Invalid update', mode: 'public', url: 'https://example.com/', pathPrefix: '/catalogue' })), params);
    assert.equal(response.status, 400);
    const saved = await (await detail(new Request(origin), params)).json();
    assert.equal(saved.project.name, project.name);
    assert.equal(saved.project.pathPrefix, '/');
  } finally {
    if (previous === undefined) delete process.env.PAGEPILOT_DATA_DIR; else process.env.PAGEPILOT_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('stop route validates local ownership and keeps the request separate from worker state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepilot-stop-api-'));
  const previous = process.env.PAGEPILOT_DATA_DIR;
  process.env.PAGEPILOT_DATA_DIR = directory;
  try {
    const project = await createProject({ name: 'Stop owner' });
    const other = await createProject({ name: 'Other owner' });
    const runId = randomUUID();
    const raw = { id: runId, projectId: project.id, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, stages: [], error: null, result: null };
    await mkdir(runDirectory(runId), { recursive: true });
    await writeFile(join(runDirectory(runId), 'run.json'), JSON.stringify(raw));
    const params = { params: Promise.resolve({ id: project.id, runId }) };
    assert.equal((await stop(request('{}', { Origin: 'https://external.example' }), params)).status, 403);
    assert.equal((await stop(request('{"extra":true}'), params)).status, 400);
    assert.equal((await stop(request('{}'), { params: Promise.resolve({ id: project.id, runId: 'invalid' }) })).status, 400);
    assert.equal((await stop(request('{}'), { params: Promise.resolve({ id: other.id, runId }) })).status, 404);
    const requested = await stop(request('{}'), params);
    assert.equal(requested.status, 200);
    assert.equal((await requested.json()).run.stopRequested, true);
    assert.equal(JSON.parse(await readFile(join(runDirectory(runId), 'run.json'), 'utf8')).stopRequested, undefined);
    assert.deepEqual(JSON.parse(await readFile(join(runDirectory(runId), 'stop-request.json'), 'utf8')).projectId, project.id);
    assert.equal((await (await stop(request('{}'), params)).json()).run.stopRequested, true);
    await writeFile(join(runDirectory(runId), 'run.json'), JSON.stringify({ ...raw, status: 'completed', finishedAt: new Date().toISOString() }));
    const completed = await (await stop(request('{}'), params)).json();
    assert.equal(completed.run.status, 'completed');
    assert.equal(completed.run.stopRequested, false);
  } finally {
    if (previous === undefined) delete process.env.PAGEPILOT_DATA_DIR; else process.env.PAGEPILOT_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
