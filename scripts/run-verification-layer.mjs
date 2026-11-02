import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

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
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd, env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, FORCE_COLOR: '0' },
      shell: false, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (exitCode, signal, terminationUnconfirmed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline); clearTimeout(escalation); clearTimeout(lastResort);
      accept({ exitCode, signal, timedOut, terminationUnconfirmed });
    };
    const signalTree = signal => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
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
