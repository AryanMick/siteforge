import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hash } from '../src/site/util.mjs';
import { verifyZipEntries } from '../scripts/checks/zip-integrity.mjs';

test('streamed ZIP verification checks every entry, digest and exact inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zip-integrity-'));
  try {
    const path = join(root, 'fixture.zip');
    const zip = new AdmZip();
    const content = Buffer.from('A controlled website');
    zip.addFile('website/index.html', content);
    zip.addFile('answer-key.json', Buffer.from('{}'));
    zip.writeZip(path);
    const expected = new Map([['website/index.html', hash(content)], ['answer-key.json', hash(Buffer.from('{}'))]]);
    assert.deepEqual(await verifyZipEntries(path, expected), { entries: 2 });
    await assert.rejects(verifyZipEntries(path, expected, { signal: AbortSignal.abort(new Error('Cancelled archive check')) }), /Cancelled archive check/);
    const controller = new AbortController();
    const pending = verifyZipEntries(path, expected, { signal: controller.signal });
    controller.abort(new Error('Cancelled during file open'));
    await assert.rejects(pending, /Cancelled during file open/);
    await assert.rejects(verifyZipEntries(path, new Map([['website/index.html', hash(content)]])), /Unexpected archive entry/);
    await assert.rejects(verifyZipEntries(path, new Map([...expected, ['missing.json', hash('missing')]])), /inventory is incomplete/);
    await assert.rejects(verifyZipEntries(path, new Map([...expected, ['answer-key.json', hash('changed')]])), /digest mismatch/);
    const bytes = await readFile(path);
    await writeFile(path, bytes.subarray(0, bytes.length - 30));
    await assert.rejects(verifyZipEntries(path, expected));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('scale verifier preserves previous evidence and records a failed resume honestly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scale-report-'));
  try {
    const report = join(root, 'evidence.json');
    const previous = JSON.stringify({ status: 'passed', previous: true });
    await writeFile(report, previous);
    await writeFile(join(root, 'public.zip'), 'previous archive');
    const run = output => execFileSync(process.execPath, ['scripts/checks/check-single-site-scale.mjs'], {
      env: { ...process.env, SCALE_EVIDENCE_DIR: output, SCALE_JOB_ID: randomUUID(), FIXTURE_LAB_DATA_DIR: join(root, 'missing-data') },
      stdio: 'pipe', timeout: 20000,
    });
    assert.throws(() => run(root), /Use an empty scale evidence directory/);
    assert.equal(await readFile(report, 'utf8'), previous);
    assert.equal(await readFile(join(root, 'public.zip'), 'utf8'), 'previous archive');
    const fresh = join(root, 'new-run');
    assert.throws(() => run(fresh), /saved scale job was not found/);
    const failed = JSON.parse(await readFile(join(fresh, 'evidence.json'), 'utf8'));
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /saved scale job was not found/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
