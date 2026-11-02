import { readdir, access, mkdir, open } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { serverIdentity } from '../src/pagepilot/server-identity.mjs';
import { serverTarget, waitForServer } from '../src/pagepilot/launcher.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const production = process.argv.includes('--production');
const identity = await serverIdentity(root, production ? 'production' : 'development');
let target;
try { target = await serverTarget(root, identity); }
catch (error) { console.error(error.message); process.exit(1); }
if (target.reuse) {
  console.log(`PagePilot is already running: ${target.url}`);
  console.log('Reusing the existing server. No new server was started.');
  process.exit(0);
}
let runtime = process.execPath;
const major = Number(process.versions.node.split('.')[0]);
if (![22, 24].includes(major) && major < 26) {
  const cache = join(root, '.cache/npm/_npx');
  runtime = '';
  for (const entry of await readdir(cache).catch(() => [])) {
    const candidate = join(cache, entry, 'node_modules/node/bin/node');
    try {
      await access(candidate);
      const info = JSON.parse(await (await import('node:fs/promises')).readFile(join(cache, entry, 'node_modules/node/package.json'), 'utf8'));
      if (info.version.startsWith('24.')) { runtime = candidate; break; }
    } catch { /* Ignore unrelated cached packages. */ }
  }
  if (!runtime) throw new Error('PagePilot needs Node 24 LTS. Install Node 24, run npm ci, then npm run pagepilot.');
}
const background = process.argv.includes('--background');
await mkdir('.pagepilot', { recursive: true });
const log = background ? await open('.pagepilot/server.log', 'a') : null;
const server = spawn(runtime, [join(root, 'node_modules/next/dist/bin/next'), production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(target.port)], {
  cwd: root, env: { ...process.env, NODE_ENV: identity.mode, PATH: `${dirname(runtime)}:${process.env.PATH}` },
  detached: background, stdio: background ? ['ignore', log.fd, log.fd] : 'inherit', shell: false,
});
let outcome;
const exited = new Promise(resolve => {
  server.once('error', error => { outcome = { code: 1, message: error.message }; resolve(outcome); });
  server.once('exit', (code, signal) => { outcome = { code: code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1), message: `PagePilot server exited before becoming ready (${signal ?? `code ${code}`}).` }; resolve(outcome); });
});
const stop = signal => { if (!outcome) server.kill(signal); };
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
console.log(`Starting PagePilot at ${target.url} ...`);
try {
  await waitForServer(target.url, identity, { exit: () => outcome?.message ?? null });
  console.log(`Ready at ${target.url} (server PID ${server.pid}).`);
  if (background) server.unref();
  else process.exitCode = (await exited).code;
} catch (error) {
  console.error(`${error.message}${background ? ' See .pagepilot/server.log.' : ''}`);
  stop('SIGTERM');
  const forceStop = setTimeout(() => stop('SIGKILL'), 2500); forceStop.unref();
  await exited; clearTimeout(forceStop);
  process.exitCode = 1;
} finally { await log?.close(); }
