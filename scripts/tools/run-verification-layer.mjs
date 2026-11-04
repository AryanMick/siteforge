import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';

export async function runLayer(name, command, args, directory, {
  cwd = process.cwd(), timeoutMs = 300000, killGraceMs = 3000, quiet = false,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Verification timeout must be positive.');
  if (!quiet) console.log(`\n[${name}] ${command} ${args.join(' ')}`);
  const started = Date.now();
  const log = createWriteStream(join(directory, `${name}.log`));
  let error;
  let logError;
  log.on('error', failure => { logError = failure.message; });
  const result = await new Promise(accept => {
    let settled = false;
    let timedOut = false;
    let deadline;
    let escalation;
    let lastResort;
    const windows = process.platform === 'win32';
    const grouped = !windows;
    // On Windows npm/npx are .cmd files, which Node can only start through a shell.
    const child = spawn(command, args, {
      cwd, env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`, FORCE_COLOR: '0' },
      shell: windows && /^(npm|npx)$/.test(command), detached: grouped, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (exitCode, signal, terminationUnconfirmed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline); clearTimeout(escalation); clearTimeout(lastResort);
      accept({ exitCode, signal, timedOut, terminationUnconfirmed });
    };
    const signalTree = signal => {
      // Process groups (negative PIDs) do not exist on Windows; taskkill /T stops the whole tree there.
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else if (windows && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill(signal));
        else child.kill(signal);
      }
      catch (failure) { if (failure.code !== 'ESRCH') error ??= failure.message; }
    };
    child.stdout.on('data', chunk => { log.write(chunk); if (!quiet) process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { log.write(chunk); if (!quiet) process.stderr.write(chunk); });
    child.on('error', failure => { error = failure.message; finish(null, null); });
    child.on('close', (code, signal) => finish(code, signal));
    deadline = setTimeout(() => {
      timedOut = true;
      error = `${name} exceeded ${timeoutMs} ms; process termination requested.`;
      log.write(`\n${error}\n`);
      signalTree('SIGTERM');
      escalation = setTimeout(() => {
        signalTree('SIGKILL');
        // Kernel I/O can prevent termination; still finish the evidence report.
        lastResort = setTimeout(() => {
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
          finish(null, null, true);
        }, 1000);
      }, killGraceMs);
    }, timeoutMs);
  });
  if (!log.destroyed) await new Promise(accept => { log.once('error', accept); log.end(accept); });
  error ??= logError;
  return {
    name, command: [command, ...args].join(' '),
    status: result.exitCode === 0 && !result.timedOut && !error ? 'passed' : 'failed',
    ...result, error, durationMs: Date.now() - started, timeoutMs, log: `${name}.log`,
  };
}
