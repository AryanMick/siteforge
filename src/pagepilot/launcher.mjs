import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

export async function probeServer(address, identity, timeoutMs = 1200) {
  try {
    const url = new URL(address);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) return false;
    const response = await fetch(new URL('/api/health', url.origin), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) { await response.body?.cancel(); return false; }
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 4096) { await reader.cancel(); return false; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return data?.app === identity.app && data.workspaceId === identity.workspaceId && data.mode === identity.mode;
  } catch { return false; }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export async function portAvailable(port) {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function waitForServer(url, identity, { timeoutMs = 60000, intervalMs = 300, exit = () => null, probe = probeServer } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exit()) throw new Error(exit());
    const ready = await probe(url, identity);
    if (exit()) throw new Error(exit());
    if (ready) return;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`PagePilot did not become healthy at ${url}. Check the server log.`);
}

export async function serverTarget(root, identity, { firstPort = 4400, lastPort = 4429, lockWaitMs = 5000, probe = probeServer } = {}) {
  if (identity.mode === 'development') {
    let info;
    try { info = JSON.parse(await readFile(join(root, '.next/dev/lock'), 'utf8')); } catch { /* Next owns lock recovery. */ }
    if (Number.isInteger(info?.pid) && info.pid > 0 && Number.isInteger(info?.port) && info.port > 0 && info.port <= 65535 && alive(info.pid)) {
      const host = ['::1', '[::1]'].includes(info.hostname) ? '[::1]' : '127.0.0.1';
      const url = `http://${host}:${info.port}`;
      try {
        await waitForServer(url, identity, { timeoutMs: lockWaitMs, probe });
        return { url, port: info.port, reuse: true };
      } catch {
        // A stale lock can name a recycled PID. Leave recovery of the lock itself to Next.
        if (host === '[::1]' || !await portAvailable(info.port)) throw new Error(`Next recorded a dev server for this folder (PID ${info.pid}), but ${url} did not pass the PagePilot health check and its port is occupied. No second server was started. Check .next/dev/logs/next-development.log and the existing server terminal.`);
      }
    }
  }
  let freePort;
  for (let port = firstPort; port <= lastPort; port++) {
    if (await portAvailable(port)) freePort ??= port;
    else if (await probe(`http://127.0.0.1:${port}`, identity)) return { url: `http://127.0.0.1:${port}`, port, reuse: true };
  }
  if (freePort === undefined) throw new Error(`No free localhost port between ${firstPort} and ${lastPort}.`);
  return { url: `http://127.0.0.1:${freePort}`, port: freePort, reuse: false };
}
