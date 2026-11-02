import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { deleteJob, jobDirectory, listJobs, previewSite } from '../src/fixture-lab/store.mjs';

async function fixture(operation) {
  const root = await mkdtemp(join(tmpdir(), 'fixture-delete-'));
  const previous = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = root;
  try { await operation(root); }
  finally { if (previous === undefined) delete process.env.FIXTURE_LAB_DATA_DIR; else process.env.FIXTURE_LAB_DATA_DIR = previous; await rm(root, { recursive: true, force: true }); }
}
async function savedJob(status = 'completed') {
  const id = randomUUID();
  await mkdir(join(jobDirectory(id), 'sites/site-001-library/public'), { recursive: true });
  await writeFile(join(jobDirectory(id), 'job.json'), JSON.stringify({ id, status, createdAt: new Date().toISOString(), sites: [{ id: 'site-001-library' }] }));
  await writeFile(join(jobDirectory(id), 'sites/site-001-library/public/index.html'), '<h1>Fixture</h1>');
  return id;
}

test('deletion removes only the selected generated test set and its stale preview records', () => fixture(async root => {
  const id = await savedJob(); const keep = await savedJob();
  await mkdir(join(root, 'previews'));
  await writeFile(join(root, 'previews', `${id}--site-001-library.json`), JSON.stringify({ pid: 99999999 }));
  await writeFile(join(root, 'evidence.json'), '{"keep":true}');
  assert.deepEqual(await deleteJob(id), { deleted: true, id });
  assert.deepEqual((await listJobs()).map(job => job.id), [keep]);
  assert.deepEqual(await readdir(join(root, 'previews')), []);
  assert.equal(await readFile(join(root, 'evidence.json'), 'utf8'), '{"keep":true}');
  await assert.rejects(readFile(join(root, 'active.lock/owner.json')), { code: 'ENOENT' });
  await assert.rejects(previewSite(id, 'site-001-library'), /not found/);
}));

test('deletion rejects active generation and preserves the lock owner', () => fixture(async root => {
  const id = await savedJob();
  await mkdir(join(root, 'active.lock'));
  const owner = JSON.stringify({ id, phase: 'running', pid: process.pid, createdAt: new Date().toISOString() });
  await writeFile(join(root, 'active.lock/owner.json'), owner);
  await assert.rejects(deleteJob(id), { status: 409 });
  assert.equal(await readFile(join(root, 'active.lock/owner.json'), 'utf8'), owner);
  assert.equal(JSON.parse(await readFile(join(jobDirectory(id), 'job.json'), 'utf8')).id, id);
}));

test('deletion rejects a live preview without signalling its PID', () => fixture(async root => {
  const id = await savedJob();
  await mkdir(join(root, 'previews'));
  await writeFile(join(root, 'previews', `${id}--site-001-library.json`), JSON.stringify({ pid: process.pid, expiresAt: '2000-01-01T00:00:00Z' }));
  await assert.rejects(deleteJob(id), { status: 409 });
  assert.equal(JSON.parse(await readFile(join(jobDirectory(id), 'job.json'), 'utf8')).id, id);
  await assert.rejects(readFile(join(root, 'active.lock/owner.json')), { code: 'ENOENT' });
}));

test('deletion stops the test set\'s own running preview, then removes the files', { timeout: 30000 }, () => fixture(async root => {
  const id = await savedJob();
  // A stand-in preview process: a local server with a fresh preview record, as scripts/fixture-preview.mjs writes.
  const child = spawn(process.execPath, ['-e', "const s=require('node:http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',()=>console.log(s.address().port));process.on('SIGTERM',()=>process.exit(0))"], { stdio: ['ignore', 'pipe', 'ignore'] });
  const port = await new Promise(resolvePort => child.stdout.once('data', data => resolvePort(Number(String(data).trim()))));
  await mkdir(join(root, 'previews'));
  await writeFile(join(root, 'previews', `${id}--site-001-library.json`), JSON.stringify({ pid: child.pid, url: `http://127.0.0.1:${port}/`, expiresAt: new Date(Date.now() + 60000).toISOString() }));
  const exited = new Promise(resolveExit => child.once('exit', resolveExit));
  assert.deepEqual(await deleteJob(id), { deleted: true, id });
  await exited;
  assert.deepEqual(await readdir(join(root, 'previews')), []);
  await assert.rejects(readFile(join(jobDirectory(id), 'job.json')), { code: 'ENOENT' });
}));

test('deletion rejects linked job roots but does not follow links inside verified jobs', () => fixture(async root => {
  const keep = await savedJob(); const id = randomUUID();
  await symlink(jobDirectory(keep), jobDirectory(id));
  await assert.rejects(deleteJob(id), { status: 409 });
  const remove = await savedJob();
  await symlink(jobDirectory(keep), join(jobDirectory(remove), 'outside'));
  await deleteJob(remove);
  assert.equal(JSON.parse(await readFile(join(jobDirectory(keep), 'job.json'), 'utf8')).id, keep);
}));

test('deletion refuses invalid IDs and missing or mismatched job records', () => fixture(async root => {
  await assert.rejects(deleteJob('../outside'), /Invalid job ID/);
  await assert.rejects(deleteJob(randomUUID()), { status: 404 });
  const id = await savedJob();
  await writeFile(join(jobDirectory(id), 'job.json'), JSON.stringify({ id: randomUUID() }));
  await assert.rejects(deleteJob(id), { status: 409 });
  assert.equal((await readdir(join(root, 'jobs'))).includes(id), true);
}));

test('separate store instances honor the shared preview operation lock before deleting', () => fixture(async root => {
  const id = await savedJob();
  const lock = join(root, 'preview-operation.lock');
  await mkdir(lock);
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ token: 'other-process', pid: process.pid }));
  const isolated = await import('../src/fixture-lab/store.mjs?isolated-delete-check');
  let settled = false;
  const deletion = isolated.deleteJob(id).finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(settled, false);
  assert.equal(JSON.parse(await readFile(join(jobDirectory(id), 'job.json'), 'utf8')).id, id);
  await rm(lock, { recursive: true });
  assert.deepEqual(await deletion, { deleted: true, id });
}));

test('deletion recovers a dead preview-operation owner', () => fixture(async root => {
  const id = await savedJob();
  await mkdir(join(root, 'preview-operation.lock'));
  await writeFile(join(root, 'preview-operation.lock/owner.json'), JSON.stringify({ token: 'dead', pid: 99999999 }));
  assert.deepEqual(await deleteJob(id), { deleted: true, id });
  assert.equal((await readdir(root)).some(name => name.startsWith('preview-operation.lock')), false);
}));
