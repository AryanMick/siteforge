import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseFeature, loadFeatures } from '../src/workbench/catalog';
import { isLocalRequest, isRunId } from '../src/workbench/security';
import { summarizeBehaviors, summarizeMutations } from '../src/workbench/results';

test('Gherkin is parsed structurally, including scenario outlines and rules', () => {
  const feature = parseFeature('@planned\nFeature: Library\n Rule: Shared fields\n  Scenario Outline: A book\n   Given <cover>\n   Then same shape\n   Examples:\n    | cover |\n    | yes |\n    | no |\n', 'library.feature');
  assert.equal(feature.planned, true);
  assert.equal(feature.scenarios.length, 1);
  assert.equal(feature.scenarios[0].examples, 2);
  assert.deepEqual(feature.scenarios[0].steps, ['Given <cover>', 'Then same shape']);
  assert.throws(() => parseFeature('not a feature', 'invalid.feature'));
});

test('all 74 source cases remain identifiable as planned rather than implicitly passed', async () => {
  const features = await loadFeatures();
  const plan = await readFile('README.md', 'utf8');
  const ids = [...plan.matchAll(/^\| ((?:REF|GEN|DATA|GOLD|WEB|NOISE|CRAWL|ADAPT|EVAL|AI|RUN|SCALE|SEC|REPORT)-\d{2}) \|/gm)].map(match => `@${match[1]}`);
  const planned = features.filter(feature => feature.planned).flatMap(feature => feature.scenarios.flatMap(scenario => scenario.tags.filter(tag => tag !== '@planned')));
  assert.equal(ids.length, 74);
  assert.deepEqual(planned.sort(), ids.sort());
  assert.ok(features.some(feature => !feature.planned));
});

test('local run APIs reject cross-origin requests, remote hosts and missing POST origins', () => {
  const request = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
  assert.equal(isLocalRequest(request('http://127.0.0.1:4400/api/runs', { origin: 'http://127.0.0.1:4400', host: '127.0.0.1:4400' }), true), true);
  assert.equal(isLocalRequest(request('http://localhost:4400/api/runs', { origin: 'http://127.0.0.1:4400', host: '127.0.0.1:4400' }), true), true);
  assert.equal(isLocalRequest(request('http://127.0.0.1:4400/api/runs'), true), false);
  assert.equal(isLocalRequest(request('http://127.0.0.1:4400/api/runs', { origin: 'https://external.example' }), true), false);
  assert.equal(isLocalRequest(request('http://external.example/api/runs')), false);
  assert.equal(isLocalRequest(request('http://127.0.0.1:4400/api/runs', { host: 'evil.example' })), false);
  assert.equal(isLocalRequest(request('http://localhost:4400/api/runs', { origin: 'http://localhost:4400', 'sec-fetch-site': 'cross-site' }), true), false);
});

test('run identifiers exclude traversal and arbitrary file names', () => {
  assert.equal(isRunId('cc2fbf5d-8d28-4cc4-8f60-0c7c37cf59cd'), true);
  for (const id of ['../config', 'package.json', '', 'cc2fbf5d-8d28-4cc4-8f60-0c7c37cf59cd/../']) assert.equal(isRunId(id), false);
});

test('behavior reports distinguish failed hooks, skipped and undefined steps', () => {
  const step = (status: string) => ({ result: { status } });
  const report = summarizeBehaviors([{ elements: [
    { name: 'good', steps: [step('passed')] },
    { name: 'bad hook', steps: [step('passed')], after: [step('failed')] },
    { name: 'not executed', steps: [step('skipped')] },
    { name: 'not defined', steps: [step('undefined')] },
    { name: 'no results', steps: [] },
    { name: 'setup', type: 'background', steps: [step('passed')] },
  ] }]);
  assert.equal(report.scenarios, 5);
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 2);
  assert.equal(report.skipped, 2);
  assert.throws(() => summarizeBehaviors({}));
});

test('mutation score counts detected mutants and does not include invalid or ignored mutants', () => {
  const result = summarizeMutations({ files: { 'structure.ts': { mutants: ['Killed', 'Timeout', 'Survived', 'NoCoverage', 'CompileError', 'Ignored'].map(status => ({ status })) } } });
  assert.equal(result.total, 6);
  assert.equal(result.score, 50);
  assert.equal(result.excluded, 2);
  assert.equal(result.compileErrors, 1);
  assert.equal(result.ignored, 1);
  assert.equal(result.runtimeErrors, 0);
  assert.equal(result.pending, 0);
  assert.deepEqual(result.scope, ['structure.ts']);
  assert.equal(summarizeMutations({ files: {} }).score, null);
});

test('runner recovers a finished-run lock without stealing an active run', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-lock-'));
  const previous = process.env.WORKBENCH_DATA_DIR;
  process.env.WORKBENCH_DATA_DIR = directory;
  try {
    const { executeSuite } = await import('../src/workbench/runner');
    const id = randomUUID();
    await mkdir(join(directory, 'runs', id), { recursive: true });
    const completed = { id, kind: 'bdd', status: 'passed', ownerPid: process.pid, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), log: 'Preserved completed evidence' };
    await writeFile(join(directory, 'runs', id, 'run.json'), JSON.stringify(completed));
    await writeFile(join(directory, 'active.json'), JSON.stringify({ id, pid: process.pid }));
    const attempts = await Promise.allSettled([executeSuite('bdd'), executeSuite('bdd')]);
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(item => item.status === 'rejected').length, 1);
    assert.match(attempts.find(item => item.status === 'rejected')?.reason.message, /already active/);
    const success = attempts.find(item => item.status === 'fulfilled');
    assert.equal(success?.value.status, 'passed');
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'runs', id, 'run.json'), 'utf8')), completed);
    await assert.rejects(readFile(join(directory, 'active.json')), { code: 'ENOENT' });
    await writeFile(join(directory, 'runs', id, 'run.json'), JSON.stringify({ ...completed, status: 'running' }));
    await writeFile(join(directory, 'active.json'), JSON.stringify({ id, pid: process.pid }));
    await assert.rejects(executeSuite('bdd'), /already active/);
    assert.equal(JSON.parse(await readFile(join(directory, 'active.json'), 'utf8')).id, id);

    const orphan = { id: randomUUID(), pid: process.pid };
    await writeFile(join(directory, 'active.json'), JSON.stringify(orphan));
    await assert.rejects(executeSuite('bdd'), /already active/, 'a fresh handoff must remain locked');
    const old = new Date(Date.now() - 360_000);
    await utimes(join(directory, 'active.json'), old, old);
    assert.equal((await executeSuite('bdd')).status, 'passed', 'an old orphan cannot stay locked just because its PID is alive');

    await writeFile(join(directory, 'active.json'), '{');
    await assert.rejects(executeSuite('bdd'), /lock is incomplete.*preserved/i);
    assert.equal(await readFile(join(directory, 'active.json'), 'utf8'), '{');
    await utimes(join(directory, 'active.json'), old, old);
    assert.equal((await executeSuite('bdd')).status, 'passed');
    const recovered = (await readdir(directory)).filter(name => name.startsWith('recovered-lock-'));
    assert.equal(recovered.length, 1);
    assert.equal(await readFile(join(directory, recovered[0]), 'utf8'), '{', 'damaged evidence is archived, not discarded');
    assert(!(await readdir(directory)).some(name => name.endsWith('.tmp')), 'lock publication leaves no temporary files');
  } finally {
    if (previous === undefined) delete process.env.WORKBENCH_DATA_DIR; else process.env.WORKBENCH_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
