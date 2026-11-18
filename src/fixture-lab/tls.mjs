import { spawn } from 'node:child_process';
import { randomUUID, X509Certificate } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';
import { dirname, join, resolve } from 'node:path';

const CERTIFICATE_DAYS = 30;
const KEY_FILE = 'key.pem';
const CERTIFICATE_FILE = 'cert.pem';
const LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 25;
const UNOWNED_LOCK_STALE_MS = 10000;
const LOCK_OWNER_FILE = 'owner.json';

function opensslConfig() {
  return `[req]
distinguished_name = subject
prompt = no
x509_extensions = local_preview

[subject]
CN = localhost

[local_preview]
subjectAltName = @preview_names
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage = serverAuth

[preview_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
`;
}

async function runOpenSsl(argumentsList, cwd) {
  await new Promise((accept, reject) => {
    const child = spawn('openssl', argumentsList, { cwd, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk; });
    child.once('error', error => reject(new Error(`Could not run openssl: ${error.message}`, { cause: error })));
    child.once('close', code => code === 0
      ? accept()
      : reject(new Error(`openssl could not create the preview certificate${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));
  });
}

async function pathExists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function helperCertificate(parsed) {
  return parsed.subject === 'CN=localhost'
    && parsed.issuer === parsed.subject
    && parsed.ca === true
    && parsed.verify(parsed.publicKey)
    && parsed.publicKey.asymmetricKeyType === 'rsa'
    && parsed.publicKey.asymmetricKeyDetails?.modulusLength >= 2048;
}

async function inspectCertificateDirectory(directory) {
  let directoryInfo;
  try { directoryInfo = await lstat(directory); }
  catch (error) { if (error.code === 'ENOENT') return { status: 'missing' }; throw error; }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Preview TLS path must be a directory');

  const keyPath = join(directory, KEY_FILE);
  const certPath = join(directory, CERTIFICATE_FILE);
  const entries = await Promise.all([keyPath, certPath].map(async path => {
    try { return await lstat(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }));
  if (entries.every(entry => entry === null)) throw new Error('Preview TLS directory exists without a key and certificate; refusing to overwrite it');
  if (entries.some(entry => entry === null)) throw new Error('Preview TLS directory is incomplete; refusing to replace existing certificate state');
  if (entries.some(entry => !entry.isFile() || entry.isSymbolicLink())) throw new Error('Preview TLS key and certificate must be regular files');
  // Windows has no POSIX permission bits (every file reads as 0666), so the check only applies elsewhere.
  if (process.platform !== 'win32' && (entries[0].mode & 0o777) !== 0o600) throw new Error('Preview TLS private key permissions must be 0600');

  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  try {
    createSecureContext({ key, cert });
    const parsed = new X509Certificate(cert);
    const validFrom = Date.parse(parsed.validFrom);
    const validTo = Date.parse(parsed.validTo);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || validTo <= validFrom) throw new Error('certificate validity is malformed');
    if (validTo - validFrom > (CERTIFICATE_DAYS + 1) * 24 * 60 * 60 * 1000) throw new Error('certificate validity exceeds the local preview limit');
    if (!parsed.checkHost('localhost') || !parsed.checkIP('127.0.0.1') || !parsed.checkIP('::1')) throw new Error('certificate is missing a localhost subject alternative name');
    const generatedByHelper = helperCertificate(parsed);
    const now = Date.now();
    if (validFrom > now) throw new Error('certificate is not yet valid');
    if (validTo <= now) {
      if (!generatedByHelper) throw new Error('expired certificate does not match the local preview certificate profile');
      return { status: 'expired', files: { key, cert, keyPath, certPath }, generatedByHelper };
    }
    return { status: 'current', files: { key, cert, keyPath, certPath }, generatedByHelper };
  } catch (error) {
    throw new Error(`Preview TLS certificate is invalid: ${error.message}`, { cause: error });
  }
}

async function generateCertificate(parent) {
  const staging = await mkdtemp(join(parent, '.tls-building-'));
  const configPath = join(staging, 'openssl.cnf');
  try {
    await chmod(staging, 0o700);
    await writeFile(configPath, opensslConfig(), { mode: 0o600, flag: 'wx' });
    await runOpenSsl([
      'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
      '-days', String(CERTIFICATE_DAYS), '-keyout', KEY_FILE, '-out', CERTIFICATE_FILE,
      '-config', configPath, '-extensions', 'local_preview',
    ], staging);
    await chmod(join(staging, KEY_FILE), 0o600);
    await chmod(join(staging, CERTIFICATE_FILE), 0o600);
    await unlink(configPath);
    const generated = await inspectCertificateDirectory(staging);
    if (generated.status !== 'current' || !generated.generatedByHelper) throw new Error('Generated preview TLS certificate failed validation');
    return staging;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function validLockOwner(value) {
  return value !== null
    && typeof value === 'object'
    && Number.isInteger(value.pid)
    && value.pid > 0
    && typeof value.token === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.token)
    && Number.isFinite(Date.parse(value.createdAt));
}

async function recoverStaleLock(lockPath) {
  let lockInfo;
  try { lockInfo = await lstat(lockPath); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  if (!lockInfo.isDirectory() || lockInfo.isSymbolicLink()) return false;

  let owner = null;
  try { owner = JSON.parse(await readFile(join(lockPath, LOCK_OWNER_FILE), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const stale = validLockOwner(owner)
    ? !processAlive(owner.pid)
    : Date.now() - lockInfo.mtimeMs >= UNOWNED_LOCK_STALE_MS;
  if (!stale) return false;

  const quarantine = `${lockPath}.stale-${randomUUID()}`;
  try { await rename(lockPath, quarantine); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  await rm(quarantine, { recursive: true, force: true });
  return true;
}

async function acquireLock(lockPath) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await writeFile(join(lockPath, LOCK_OWNER_FILE), JSON.stringify(owner) + '\n', { mode: 0o600, flag: 'wx' });
      return owner;
    }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await recoverStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the preview TLS certificate lock');
      await new Promise(resolvePromise => setTimeout(resolvePromise, LOCK_POLL_MS));
    }
  }
}

async function releaseLock(lockPath, owner) {
  const stored = JSON.parse(await readFile(join(lockPath, LOCK_OWNER_FILE), 'utf8'));
  if (!validLockOwner(stored) || stored.token !== owner.token || stored.pid !== owner.pid) throw new Error('Preview TLS certificate lock ownership changed unexpectedly');
  await unlink(join(lockPath, LOCK_OWNER_FILE));
  await rmdir(lockPath);
}

async function withLock(lockPath, operation) {
  const owner = await acquireLock(lockPath);
  try { return await operation(); }
  finally { await releaseLock(lockPath, owner); }
}

async function reconcileBackup(target, backup) {
  let state = await inspectCertificateDirectory(target);
  const backupExists = await pathExists(backup);
  if (state.status === 'missing' && backupExists) {
    const backupState = await inspectCertificateDirectory(backup);
    if (!backupState.generatedByHelper) throw new Error('Preview TLS recovery backup does not match the local certificate profile');
    await rename(backup, target);
    state = await inspectCertificateDirectory(target);
  } else if (state.status === 'current' && backupExists) {
    const backupState = await inspectCertificateDirectory(backup);
    if (!backupState.generatedByHelper) throw new Error('Preview TLS recovery backup does not match the local certificate profile');
    await rm(backup, { recursive: true });
  } else if (state.status === 'expired' && backupExists) {
    throw new Error('Preview TLS recovery backup already exists; refusing to replace certificate state');
  }
  return state;
}

export async function ensurePreviewCertificate(directory) {
  const target = resolve(directory);
  const parent = dirname(target);
  const lockPath = `${target}.lock`;
  const backup = `${target}.renewal-backup`;
  await mkdir(parent, { recursive: true, mode: 0o700 });

  const initial = await inspectCertificateDirectory(target);
  if (initial.status === 'current' && !(await pathExists(backup))) return initial.files;

  return withLock(lockPath, async () => {
    const state = await reconcileBackup(target, backup);
    if (state.status === 'current') return state.files;

    const staging = await generateCertificate(parent);
    try {
      if (state.status === 'missing') {
        await rename(staging, target);
      } else {
        await rename(target, backup);
        let installed = false;
        try {
          await rename(staging, target);
          installed = true;
          const renewed = await inspectCertificateDirectory(target);
          if (renewed.status !== 'current' || !renewed.generatedByHelper) throw new Error('Renewed preview TLS certificate failed validation');
        } catch (error) {
          try {
            if (installed) await rename(target, staging);
            await rename(backup, target);
          } catch (rollbackError) {
            throw new Error(`Preview TLS renewal failed and the original remains at ${backup}: ${rollbackError.message}`, { cause: error });
          }
          throw error;
        }
        await rm(backup, { recursive: true });
      }
      const installed = await inspectCertificateDirectory(target);
      if (installed.status !== 'current') throw new Error('Preview TLS certificate was not created');
      return installed.files;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  });
}
