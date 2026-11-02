import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { POST } from '../app/api/projects/[id]/runs/[runId]/wordpress/route';

const origin = 'http://127.0.0.1:4400';
const request = (body: string, headers: Record<string, string> = {}) => new Request(`${origin}/api/wordpress`, {
  method: 'POST', body, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
});

test('WordPress route enforces local strict input, ownership, body limits, and captured inclusion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepilot-wordpress-route-'));
  const previous = process.env.PAGEPILOT_DATA_DIR; process.env.PAGEPILOT_DATA_DIR = directory;
  const id = randomUUID(); const runId = randomUUID();
  const params = { params: Promise.resolve({ id, runId }) };
  const valid = { siteUrl: 'https://wordpress.example', username: 'editor', applicationPassword: 'app pass', pageUrls: ['/included'] };
  try {
    await mkdir(join(directory, 'runs', runId), { recursive: true });
    await writeFile(join(directory, 'runs', runId, 'run.json'), JSON.stringify({
      id: runId, projectId: id, status: 'completed', result: {
        labels: {}, pages: [
          { url: '/included', title: 'Included', cluster: 'group', excluded: false, fields: { title: 'Included' } },
          { url: '/excluded', title: 'Excluded', cluster: 'excluded', excluded: true, fields: { title: 'Excluded' } },
        ],
      },
    }));
    assert.equal((await POST(request(JSON.stringify(valid), { Origin: 'https://attacker.example' }), params)).status, 403);
    assert.equal((await POST(request('x'.repeat(8193)), params)).status, 413);
    assert.equal((await POST(request(JSON.stringify({ ...valid, publish: true })), params)).status, 400);
    assert.equal((await POST(request(JSON.stringify({ ...valid, pageUrls: ['/included', '/included'] })), params)).status, 400);
    assert.equal((await POST(request(JSON.stringify({ ...valid, pageUrls: ['/excluded'] })), params)).status, 400);
    assert.equal((await POST(request(JSON.stringify(valid)), { params: Promise.resolve({ id: randomUUID(), runId }) })).status, 404);
    const invalidSite = await POST(request(JSON.stringify({ ...valid, siteUrl: 'http://wordpress.example' })), params);
    assert.equal(invalidSite.status, 400);
    assert.doesNotMatch(await invalidSite.text(), /app pass|editor/);
  } finally {
    if (previous === undefined) delete process.env.PAGEPILOT_DATA_DIR; else process.env.PAGEPILOT_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
