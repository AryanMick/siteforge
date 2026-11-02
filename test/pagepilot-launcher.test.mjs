import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { serverIdentity } from '../src/pagepilot/server-identity.mjs';
import { probeServer, portAvailable, serverTarget, waitForServer } from '../src/pagepilot/launcher.mjs';

const execute = promisify(execFile);
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'pagepilot-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function endpoint(t, handler) {
  const server = createServer(handler);
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  t.after(() => new Promise(accept => { server.close(accept); server.closeAllConnections(); }));
  const port = server.address().port;
  return { server, port, url: `http://127.0.0.1:${port}` };
}
async function lock(root, value) {
  const path = join(root, '.next/dev/lock');
  await mkdir(join(root, '.next/dev'), { recursive: true });
  const contents = typeof value === 'string' ? value : JSON.stringify(value);
  await writeFile(path, contents);
  return { path, contents };
}

test('workspace identity resolves symlinks and distinguishes folders and modes', async t => {
  const root = await workspace(t); const other = await workspace(t);
  const alias = join(other, 'alias'); await symlink(root, alias, 'dir');
  const identity = await serverIdentity(root, 'development');
  assert.deepEqual(await serverIdentity(alias, 'development'), identity);
  assert.notEqual((await serverIdentity(other, 'development')).workspaceId, identity.workspaceId);
  assert.notDeepEqual(await serverIdentity(root, 'production'), identity);
  assert(!JSON.stringify(identity).includes(root));
});

test('health probes require bounded local JSON with matching workspace and mode', async t => {
  const identity = await serverIdentity(await workspace(t), 'development');
  let status = 200; let body = JSON.stringify(identity); let requests = 0;
  const target = await endpoint(t, (request, response) => {
    requests++; assert.equal(request.url, '/api/health');
    response.writeHead(status, { 'content-type': 'application/json', location: '/api/health' }); response.end(body);
  });
  assert.equal(await probeServer(target.url, identity), true);
  for (const invalid of [{ ...identity, workspaceId: 'other' }, { ...identity, mode: 'production' }, { ...identity, app: 'other' }, null]) {
    body = JSON.stringify(invalid); assert.equal(await probeServer(target.url, identity), false);
  }
  for (const invalid of ['not json', ' '.repeat(4097) + JSON.stringify(identity)]) {
    body = invalid; assert.equal(await probeServer(target.url, identity), false);
  }
  body = JSON.stringify(identity);
  for (const code of [302, 403, 500]) { status = code; assert.equal(await probeServer(target.url, identity), false); }
  const before = requests;
  for (const address of ['https://127.0.0.1/', 'http://example.com/', 'http://user:pass@127.0.0.1/', 'invalid']) {
    assert.equal(await probeServer(address, identity), false);
  }
  assert.equal(requests, before);
});

test('a live healthy Next lock reuses its actual port and is never rewritten', async t => {
  const root = await workspace(t); const identity = await serverIdentity(root, 'development');
  const target = await endpoint(t, (_, response) => response.end(JSON.stringify(identity)));
  const saved = await lock(root, { pid: process.pid, port: target.port, hostname: '127.0.0.1', appUrl: 'https://untrusted.example/' });
  assert.deepEqual(await serverTarget(root, identity), { url: target.url, port: target.port, reuse: true });
  assert.equal(await readFile(saved.path, 'utf8'), saved.contents);
  assert.equal(await portAvailable(target.port), false);
});

test('a live but unhealthy or wrong-workspace lock refuses a duplicate server', async t => {
  const root = await workspace(t); const identity = await serverIdentity(root, 'development');
  const target = await endpoint(t, (_, response) => response.end(JSON.stringify({ ...identity, workspaceId: 'different' })));
  const saved = await lock(root, { pid: process.pid, port: target.port });
  await assert.rejects(serverTarget(root, identity, { lockWaitMs: 40 }), /No second server was started/);
  assert.equal(await readFile(saved.path, 'utf8'), saved.contents);
});

test('stale and damaged Next locks are preserved while choosing a free port', async t => {
  const root = await workspace(t); const identity = await serverIdentity(root, 'development');
  const target = await endpoint(t, (_, response) => response.end());
  await new Promise(accept => target.server.close(accept));
  assert.equal(await portAvailable(target.port), true);
  for (const value of ['{damaged', { pid: 2147483647, port: target.port }, { pid: process.pid, port: -1 }]) {
    const saved = await lock(root, value);
    assert.deepEqual(await serverTarget(root, identity, { firstPort: target.port, lastPort: target.port }), { url: target.url, port: target.port, reuse: false });
    assert.equal(await readFile(saved.path, 'utf8'), saved.contents);
  }
});

test('port discovery reuses only this app and workspace, not an unrelated occupant', async t => {
  const root = await workspace(t); const identity = await serverIdentity(root, 'development');
  let current = { ...identity, workspaceId: 'unrelated' };
  const target = await endpoint(t, (_, response) => response.end(JSON.stringify(current)));
  const range = { firstPort: target.port, lastPort: target.port };
  await assert.rejects(serverTarget(root, identity, range), /No free localhost port/);
  current = identity;
  assert.deepEqual(await serverTarget(root, identity, range), { url: target.url, port: target.port, reuse: true });
});

test('a stale lock with a recycled live PID and unused port does not prevent startup', async t => {
  const root = await workspace(t); const identity = await serverIdentity(root, 'development');
  const target = await endpoint(t, (_, response) => response.end());
  await new Promise(accept => target.server.close(accept));
  const saved = await lock(root, { pid: process.pid, port: target.port });
  assert.deepEqual(await serverTarget(root, identity, { firstPort: target.port, lastPort: target.port, lockWaitMs: 10 }), { url: target.url, port: target.port, reuse: false });
  assert.equal(await readFile(saved.path, 'utf8'), saved.contents);
});

test('readiness waits for health and reports an early exit or timeout', async () => {
  let attempts = 0;
  await waitForServer('unused', {}, { probe: async () => ++attempts === 3, intervalMs: 1, timeoutMs: 100 });
  assert.equal(attempts, 3);
  await assert.rejects(waitForServer('unused', {}, { exit: () => 'child exited with code 17' }), /code 17/);
  let exited = false;
  await assert.rejects(waitForServer('unused', {}, { probe: async () => { exited = true; return true; }, exit: () => exited ? 'child exited during health check' : null }), /during health check/);
  await assert.rejects(waitForServer('unused', {}, { probe: async () => false, intervalMs: 1, timeoutMs: 10 }), /did not become healthy/);
});

// Exercise the actual CLI with a tiny isolated Next stand-in, never the user's dev server.
async function launcherFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pagepilot-launcher-cli-'));
  for (const directory of ['scripts', 'src/pagepilot', 'node_modules/next/dist/bin']) await mkdir(join(root, directory), { recursive: true });
  for (const path of ['scripts/start-pagepilot.mjs', 'src/pagepilot/launcher.mjs', 'src/pagepilot/server-identity.mjs']) await copyFile(resolve(path), join(root, path));
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'node_modules/next/package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'node_modules/next/dist/bin/next'), `
    import { createServer } from 'node:http';
    import { mkdir, writeFile } from 'node:fs/promises';
    import { serverIdentity } from '../../../../src/pagepilot/server-identity.mjs';
    if (process.env.PAGEPILOT_FIXTURE_EXIT) process.exit(17);
    const identity = await serverIdentity();
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    const server = createServer((_, response) => response.end(JSON.stringify(identity)));
    await new Promise(resolve => setTimeout(resolve, 100));
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    await mkdir('.next/dev', { recursive: true });
    await writeFile('.next/dev/lock', JSON.stringify({ pid: process.pid, port }));
    process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
  `);
  t.after(async () => {
    try {
      let pid;
      try { pid = JSON.parse(await readFile(join(root, '.next/dev/lock'), 'utf8')).pid; } catch { return; }
      try { process.kill(pid, 'SIGTERM'); } catch { return; }
      for (let i = 0; i < 40; i++) {
        await sleep(50);
        try { process.kill(pid, 0); } catch { return; }
      }
      try { process.kill(pid, 'SIGKILL'); } catch { /* The fixture already stopped. */ }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  return { root, script: join(root, 'scripts/start-pagepilot.mjs') };
}

test('CLI starts a healthy background server and a second launch reuses the same PID', { timeout: 20000 }, async t => {
  const { root, script } = await launcherFixture(t);
  const result = await execute(process.execPath, [script, '--background'], { timeout: 10000 });
  assert.match(result.stdout, /Ready at http:\/\/127\.0\.0\.1:\d+ \(server PID \d+\)/);
  const first = JSON.parse(await readFile(join(root, '.next/dev/lock'), 'utf8'));
  assert.equal(await probeServer(`http://127.0.0.1:${first.port}`, await serverIdentity(root, 'development')), true);
  const second = await execute(process.execPath, [script, '--background'], { timeout: 10000 });
  assert.match(second.stdout, /Reusing the existing server/);
  assert.doesNotMatch(second.stdout, /Starting PagePilot/);
  assert.equal(JSON.parse(await readFile(join(root, '.next/dev/lock'), 'utf8')).pid, first.pid);
});

test('CLI reports child startup failure without printing ready', { timeout: 20000 }, async t => {
  const { script } = await launcherFixture(t);
  await assert.rejects(execute(process.execPath, [script, '--background'], { timeout: 10000, env: { ...process.env, PAGEPILOT_FIXTURE_EXIT: '1' } }), error => {
    assert.equal(error.code, 1); assert.match(error.stderr, /code 17/); assert.doesNotMatch(error.stdout, /Ready at/); return true;
  });
});

test('foreground CLI forwards termination only to its owned server', { timeout: 20000 }, async t => {
  const { script } = await launcherFixture(t);
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise((accept, reject) => { child.once('error', reject); child.once('exit', (code, signal) => accept({ code, signal })); });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  for (let i = 0; i < 100 && !stdout.includes('Ready at'); i++) {
    if (child.exitCode !== null) assert.fail(`CLI exited early: ${stdout}\n${stderr}`);
    await sleep(50);
  }
  assert.match(stdout, /Ready at/);
  child.kill('SIGTERM');
  assert.deepEqual(await done, { code: 0, signal: null });
});
