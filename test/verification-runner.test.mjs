import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runLayer } from '../scripts/tools/run-verification-layer.mjs';

test('verification records real exit codes and both output streams', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-runner-'));
  try {
    const passed = await runLayer('pass', process.execPath, ['-e', 'console.log("result"); console.error("diagnostic")'], directory, { quiet: true });
    assert.equal(passed.status, 'passed');
    assert.equal(passed.timedOut, false);
    const log = await readFile(join(directory, passed.log), 'utf8');
    assert.match(log, /result/); assert.match(log, /diagnostic/);
    const failed = await runLayer('fail', process.execPath, ['-e', 'process.exitCode = 7'], directory, { quiet: true });
    assert.equal(failed.status, 'failed'); assert.equal(failed.exitCode, 7);
    const missing = await runLayer('missing', join(directory, 'nonexistent'), [], directory, { quiet: true });
    assert.equal(missing.status, 'failed'); assert.match(missing.error, /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('verification times out stalled tools, including ones that ignore SIGTERM', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-timeout-'));
  try {
    const result = await runLayer('stall', process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("started"); setInterval(() => {}, 100)'], directory, { quiet: true, timeoutMs: 400, killGraceMs: 100 });
    assert.equal(result.status, 'failed'); assert.equal(result.timedOut, true);
    assert.equal(result.terminationUnconfirmed, false);
    assert.match(result.error, /exceeded 400 ms/);
    assert(result.durationMs < 5000);
    assert.match(await readFile(join(directory, result.log), 'utf8'), /process termination requested/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
