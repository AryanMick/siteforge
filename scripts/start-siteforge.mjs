import { readdir, access, mkdir, open } from 'node:fs/promises';
import { delimiter, resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { statSync, utimesSync } from 'node:fs';
import { serverIdentity } from '../src/crawl/pagepilot/server-identity.mjs';
import { serverTarget, waitForServer } from '../src/crawl/pagepilot/launcher.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const windows = process.platform === 'win32';

// First run, or package files changed since the last install: install dependencies (npm writes
// node_modules/.package-lock.json at the end of every install).
const modified = path => { try { return statSync(path).mtimeMs; } catch { return -1; } };
const installed = modified('node_modules/.package-lock.json');
if (modified('node_modules/next/dist/bin/next') < 0 || (installed >= 0 && (installed < modified('package.json') || installed < modified('package-lock.json')))) {
  console.log('Installing dependencies (first start takes a few minutes) ...');
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { stdio: 'inherit', shell: windows });
  if (install.status !== 0) { console.error('npm install failed.'); process.exit(1); }
  const now = new Date();
  utimesSync('node_modules/.package-lock.json', now, now);
}

// --open: open the app in the default browser once it answers.
const openBrowser = url => {
  if (!process.argv.includes('--open')) return;
  const [command, args] = windows ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: windows });
  child.on('error', () => console.log(`Open ${url} in your browser.`));
  child.unref();
};
const production = process.argv.includes('--production');
const identity = await serverIdentity(root, production ? 'production' : 'development');
let target;
try { target = await serverTarget(root, identity); }
catch (error) { console.error(error.message); process.exit(1); }
if (target.reuse) {
  console.log(`SiteForge is already running: ${target.url}`);
  console.log('Reusing the existing server. No new server was started.');
  openBrowser(target.url);
  process.exit(0);
}
let runtime = process.execPath;
const major = Number(process.versions.node.split('.')[0]);
if (![22, 24].includes(major) && major < 26) {
  const cache = join(root, '.cache/npm/_npx');
  runtime = '';
  for (const entry of await readdir(cache).catch(() => [])) {
    const candidate = join(cache, entry, 'node_modules/node/bin', process.platform === 'win32' ? 'node.exe' : 'node');
    try {
      await access(candidate);
      const info = JSON.parse(await (await import('node:fs/promises')).readFile(join(cache, entry, 'node_modules/node/package.json'), 'utf8'));
      if (info.version.startsWith('24.')) { runtime = candidate; break; }
    } catch { /* Ignore unrelated cached packages. */ }
  }
  if (!runtime) throw new Error('SiteForge needs Node 24. Install it from https://nodejs.org, then run npm start.');
}
const background = process.argv.includes('--background');
await mkdir('.pagepilot', { recursive: true });
const log = background ? await open('.pagepilot/server.log', 'a') : null;
const server = spawn(runtime, [join(root, 'node_modules/next/dist/bin/next'), production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(target.port)], {
  cwd: root, env: { ...process.env, NODE_ENV: identity.mode, PATH: `${dirname(runtime)}${delimiter}${process.env.PATH}` },
  detached: background, stdio: background ? ['ignore', log.fd, log.fd] : 'inherit', shell: false,
});
let outcome;
const exited = new Promise(resolve => {
  server.once('error', error => { outcome = { code: 1, message: error.message }; resolve(outcome); });
  server.once('exit', (code, signal) => { outcome = { code: code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1), message: `SiteForge server exited before becoming ready (${signal ?? `code ${code}`}).` }; resolve(outcome); });
});
const stop = signal => { if (!outcome) server.kill(signal); };
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
console.log(`Starting SiteForge at ${target.url} ...`);
try {
  await waitForServer(target.url, identity, { exit: () => outcome?.message ?? null });
  console.log(`Ready at ${target.url} (server PID ${server.pid}).`);
  openBrowser(target.url);
  if (background) server.unref();
  else process.exitCode = (await exited).code;
} catch (error) {
  console.error(`${error.message}${background ? ' See .pagepilot/server.log.' : ''}`);
  stop('SIGTERM');
  const forceStop = setTimeout(() => stop('SIGKILL'), 2500); forceStop.unref();
  await exited; clearTimeout(forceStop);
  process.exitCode = 1;
} finally { await log?.close(); }
