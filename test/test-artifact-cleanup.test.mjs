import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTestArtifacts } from '../scripts/checks/test-artifact-cleanup.mjs';

test('cleanup deletes only tracked jobs and its own downloaded files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-test-cleanup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const download = join(root, 'evaluator.zip');
  const answerKey = join(root, 'answer-key.json');
  const website = join(root, 'website.zip');
  const evidence = join(root, 'config.json');
  await writeFile(download, 'test archive');
  await writeFile(answerKey, 'test answers');
  await writeFile(website, 'test website');
  await writeFile(evidence, 'retained evidence');
  const ids = [randomUUID(), randomUUID()];
  const calls = [];
  const request = { delete: async (url, options) => {
    calls.push({ url, origin: options.headers.Origin });
    return { status: () => 200 };
  } };
  const errors = await cleanupTestArtifacts({ base: 'http://127.0.0.1:4403', request,
    jobIds: new Set(ids), downloadedFile: download, downloadedFiles: [answerKey, website, answerKey] });
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, ids.reverse().map(id => ({
    url: `http://127.0.0.1:4403/api/fixtures/${id}`, origin: 'http://127.0.0.1:4403',
  })));
  await assert.rejects(readFile(download), { code: 'ENOENT' });
  await assert.rejects(readFile(answerKey), { code: 'ENOENT' });
  await assert.rejects(readFile(website), { code: 'ENOENT' });
  assert.equal(await readFile(evidence, 'utf8'), 'retained evidence');
});

test('artifact retention skips deletion and keeps the downloaded archive', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-test-retention-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const download = join(root, 'evaluator.zip');
  const answerKey = join(root, 'answer-key.json');
  await writeFile(download, 'retained');
  await writeFile(answerKey, 'retained answers');
  const errors = await cleanupTestArtifacts({ base: 'http://127.0.0.1:4403',
    request: { delete: () => { throw new Error('Deletion should not run'); } },
    jobIds: new Set([randomUUID()]), downloadedFile: download, downloadedFiles: [answerKey], keepArtifacts: true });
  assert.deepEqual(errors, []);
  assert.equal(await readFile(download, 'utf8'), 'retained');
  assert.equal(await readFile(answerKey, 'utf8'), 'retained answers');
});

test('cleanup reports a refused deletion without silently claiming success', async () => {
  const id = randomUUID();
  const errors = await cleanupTestArtifacts({ base: 'http://127.0.0.1:4403',
    request: { delete: async () => ({ status: () => 409, text: async () => 'Preview still running' }) },
    jobIds: new Set([id]) });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, new RegExp(`Could not delete test job ${id}: DELETE returned 409`));
});
