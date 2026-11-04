import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { request } from 'node:https';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { ensurePreviewCertificate } from '../src/fixture-lab/tls.mjs';
import { serve } from '../src/preview/server.mjs';
import { buildTransportPlan } from '../src/noise/transport.mjs';

const roots = [];
const execFileAsync = promisify(execFile);
test.after(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

async function writePublic(root, pathname, body) {
  const relative = pathname === '/' ? 'index.html' : pathname.endsWith('/') ? join(pathname.slice(1), 'index.html') : pathname.slice(1);
  const file = join(root, 'public', relative);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, body);
}

async function fixture({ protocol } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-https-preview-'));
  roots.push(root);
  await mkdir(join(root, 'private'));
  await writePublic(root, '/', '<!doctype html><html><head><link rel="canonical" href="http://legacy.example/"></head><body>Legacy home</body></html>');
  await writePublic(root, '/robots.txt', 'User-agent: *\nSitemap: http://legacy.example/sitemap.xml\n');
  const pages = Array.from({ length: 12 }, (_, index) => ({ kind: 'detail', url: `/records/${String(index + 1).padStart(3, '0')}/` }));
  for (const page of pages) await writePublic(root, page.url, `<!doctype html><link rel="canonical" href="https://legacy.example${page.url}"><p>${page.url}</p>`);
  await writePublic(root, '/sitemap.xml', `<?xml version="1.0"?><urlset><url><loc>http://legacy.example/</loc></url>${pages.map(page => `<url><loc>https://legacy.example${page.url}</loc></url>`).join('')}</urlset>`);
  await writeFile(join(root, 'private', 'transport.json'), JSON.stringify(buildTransportPlan(pages, { profile: 'mixed', seed: 771 })));
  await writeFile(join(root, 'private', 'config.json'), JSON.stringify(protocol ? { previewProtocol: protocol } : {}));
  return root;
}

function httpsResponse(url, { ca, method = 'GET' } = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, { ca, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    req.end();
  });
}

async function waitForJson(path, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function writeExpiredCertificate(directory, { includeSans = true } = {}) {
  const configPath = join(directory, 'expired-ca.cnf');
  const requestPath = join(directory, 'expired.csr');
  const outputPath = join(directory, 'expired-cert.pem');
  const indexPath = join(directory, 'expired-index.txt');
  const serialPath = join(directory, 'expired-serial');
  const issuedPath = join(directory, '01.pem');
  const extensions = `[ca]
default_ca=local_ca

[local_ca]
database=expired-index.txt
new_certs_dir=.
certificate=cert.pem
private_key=key.pem
serial=expired-serial
default_md=sha256
policy=local_policy
unique_subject=no
x509_extensions=local_preview

[local_policy]
commonName=supplied

[local_preview]
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage=serverAuth
${includeSans ? 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1' : ''}
`;
  await writeFile(configPath, extensions, { mode: 0o600 });
  await writeFile(indexPath, '', { mode: 0o600 });
  await writeFile(serialPath, '01\n', { mode: 0o600 });
  try {
    await execFileAsync('openssl', ['req', '-new', '-key', 'key.pem', '-subj', '/CN=localhost', '-out', requestPath], { cwd: directory });
    await execFileAsync('openssl', [
      'ca', '-selfsign', '-batch', '-config', configPath, '-in', requestPath, '-out', outputPath,
      '-startdate', '20200101000000Z', '-enddate', '20200130000000Z', '-extensions', 'local_preview', '-notext',
    ], { cwd: directory });
    await rename(outputPath, join(directory, 'cert.pem'));
  } finally {
    for (const path of [configPath, requestPath, outputPath, indexPath, `${indexPath}.attr`, `${indexPath}.old`, `${indexPath}.attr.old`, serialPath, `${serialPath}.old`, issuedPath]) {
      await unlink(path).catch(() => {});
    }
  }
  return readFile(join(directory, 'cert.pem'));
}

test('preview certificates are private, bounded, reusable, and reject incomplete state', async () => {
  const root = await fixture();
  const tlsDirectory = join(root, 'private', 'tls');
  const first = await ensurePreviewCertificate(tlsDirectory);
  const firstStat = await stat(first.keyPath);
  assert.equal(first.keyPath, join(tlsDirectory, 'key.pem'));
  assert.equal(first.certPath, join(tlsDirectory, 'cert.pem'));
  assert.equal(firstStat.mode & 0o777, 0o600);
  const certificate = new X509Certificate(first.cert);
  assert(certificate.checkHost('localhost'));
  assert(certificate.checkIP('127.0.0.1'));
  assert(certificate.checkIP('::1'));
  assert(Date.parse(certificate.validTo) - Date.parse(certificate.validFrom) <= 31 * 24 * 60 * 60 * 1000);
  const second = await ensurePreviewCertificate(tlsDirectory);
  assert.deepEqual(second.key, first.key);
  assert.deepEqual(second.cert, first.cert);

  const concurrentDirectory = join(root, 'private', 'concurrent-tls');
  const concurrent = await Promise.all([ensurePreviewCertificate(concurrentDirectory), ensurePreviewCertificate(concurrentDirectory)]);
  assert.deepEqual(concurrent[0].key, concurrent[1].key);
  assert.deepEqual(concurrent[0].cert, concurrent[1].cert);

  const partial = join(root, 'private', 'partial-tls');
  await mkdir(partial, { mode: 0o700 });
  await writeFile(join(partial, 'key.pem'), first.key, { mode: 0o600 });
  await assert.rejects(ensurePreviewCertificate(partial), /incomplete/);

  const exposed = join(root, 'private', 'exposed-tls');
  await mkdir(exposed, { mode: 0o700 });
  await writeFile(join(exposed, 'key.pem'), first.key, { mode: 0o600 });
  await writeFile(join(exposed, 'cert.pem'), first.cert, { mode: 0o600 });
  await chmod(join(exposed, 'key.pem'), 0o644);
  await assert.rejects(ensurePreviewCertificate(exposed), /0600/);

  const invalid = join(root, 'private', 'invalid-tls');
  await mkdir(invalid, { mode: 0o700 });
  await writeFile(join(invalid, 'key.pem'), 'not a private key', { mode: 0o600 });
  await writeFile(join(invalid, 'cert.pem'), 'not a certificate', { mode: 0o600 });
  await assert.rejects(ensurePreviewCertificate(invalid), /certificate is invalid/);
  assert.equal(await readFile(join(invalid, 'key.pem'), 'utf8'), 'not a private key');
  assert.equal(await readFile(join(invalid, 'cert.pem'), 'utf8'), 'not a certificate');
});

test('expired helper certificates renew atomically once across concurrent callers', async () => {
  const root = await fixture();
  const tlsDirectory = join(root, 'private', 'tls');
  const original = await ensurePreviewCertificate(tlsDirectory);
  const expired = await writeExpiredCertificate(tlsDirectory);
  assert(Date.parse(new X509Certificate(expired).validTo) < Date.now());

  const renewed = await Promise.all([
    ensurePreviewCertificate(tlsDirectory),
    ensurePreviewCertificate(tlsDirectory),
    ensurePreviewCertificate(tlsDirectory),
  ]);
  assert.deepEqual(renewed[0].key, renewed[1].key);
  assert.deepEqual(renewed[1].cert, renewed[2].cert);
  assert.notDeepEqual(renewed[0].key, original.key);
  assert.notDeepEqual(renewed[0].cert, expired);
  assert(Date.parse(new X509Certificate(renewed[0].cert).validTo) > Date.now());
  await assert.rejects(access(`${tlsDirectory}.lock`));
  await assert.rejects(access(`${tlsDirectory}.renewal-backup`));
});

test('renewal recovers an interrupted backup but never replaces missing-SAN state', async () => {
  const root = await fixture();
  const interrupted = join(root, 'private', 'interrupted-tls');
  await ensurePreviewCertificate(interrupted);
  const expired = await writeExpiredCertificate(interrupted);
  await rename(interrupted, `${interrupted}.renewal-backup`);
  await mkdir(`${interrupted}.lock`, { mode: 0o700 });
  await writeFile(join(`${interrupted}.lock`, 'owner.json'), JSON.stringify({
    pid: 2147483647,
    token: '00000000-0000-4000-8000-000000000001',
    createdAt: new Date().toISOString(),
  }), { mode: 0o600 });
  const recovered = await ensurePreviewCertificate(interrupted);
  assert.notDeepEqual(recovered.cert, expired);
  await assert.rejects(access(`${interrupted}.lock`));
  await assert.rejects(access(`${interrupted}.renewal-backup`));

  const missingSan = join(root, 'private', 'missing-san-tls');
  const original = await ensurePreviewCertificate(missingSan);
  const invalid = await writeExpiredCertificate(missingSan, { includeSans: false });
  await assert.rejects(ensurePreviewCertificate(missingSan), /missing a localhost subject alternative name/);
  assert.deepEqual(await readFile(join(missingSan, 'key.pem')), original.key);
  assert.deepEqual(await readFile(join(missingSan, 'cert.pem')), invalid);
  await assert.rejects(access(`${missingSan}.renewal-backup`));
});

test('a live certificate lock is preserved and fails after a bounded wait', { timeout: 10000 }, async () => {
  const root = await fixture();
  const tlsDirectory = join(root, 'private', 'live-lock-tls');
  const lockDirectory = `${tlsDirectory}.lock`;
  const owner = {
    pid: process.pid,
    token: '00000000-0000-4000-8000-000000000002',
    createdAt: new Date().toISOString(),
  };
  await mkdir(lockDirectory, { mode: 0o700 });
  await writeFile(join(lockDirectory, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
  const began = performance.now();
  await assert.rejects(ensurePreviewCertificate(tlsDirectory), /Timed out waiting for the preview TLS certificate lock/);
  assert(performance.now() - began >= 4900);
  assert.deepEqual(JSON.parse(await readFile(join(lockDirectory, 'owner.json'), 'utf8')), owner);
  await rm(lockDirectory, { recursive: true });
});

test('HTTPS preserves rebasing, privacy, HEAD, fault statuses, and redirect behavior', { timeout: 15000 }, async () => {
  const root = await fixture();
  const credentials = await ensurePreviewCertificate(join(root, 'private', 'tls'));
  const preview = await serve(root, { port: 0, rebaseOrigin: true, tls: { key: credentials.key, cert: credentials.cert } });
  try {
    assert.match(preview.url, /^https:\/\/127\.0\.0\.1:/);
    await assert.rejects(httpsResponse(preview.url), error => ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code));

    const home = await httpsResponse(preview.url, { ca: credentials.cert });
    assert.equal(home.status, 200);
    assert.match(home.body, new RegExp(`href="${preview.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/"`));
    const robots = await httpsResponse(`${preview.url}/robots.txt`, { ca: credentials.cert });
    assert.match(robots.body, new RegExp(`Sitemap: ${preview.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sitemap\\.xml`));
    const sitemap = await httpsResponse(`${preview.url}/sitemap.xml`, { ca: credentials.cert });
    assert([...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].every(match => new URL(match[1]).origin === preview.url));

    for (const path of ['/private/config.json', '/private/tls/key.pem', '/private/tls/cert.pem', '/%70rivate/tls/key.pem']) {
      assert.equal((await httpsResponse(preview.url + path, { ca: credentials.cert })).status, 404, path);
    }

    const plan = JSON.parse(await readFile(join(root, 'private', 'transport.json'), 'utf8'));
    for (const rule of plan.rules) {
      const response = await httpsResponse(preview.url + rule.path, { ca: credentials.cert });
      assert.equal(response.status, rule.status, rule.type);
      const head = await httpsResponse(preview.url + rule.path, { ca: credentials.cert, method: 'HEAD' });
      assert.equal(head.status, rule.status, `${rule.type} HEAD`);
      assert.equal(head.body, '');
    }
    const loop = plan.rules.find(rule => rule.type === 'redirect-loop');
    const firstHop = await httpsResponse(preview.url + loop.path, { ca: credentials.cert });
    const secondHop = await httpsResponse(preview.url + firstHop.headers.location, { ca: credentials.cert });
    assert.equal(secondHop.headers.location, loop.path);
  } finally {
    await preview.close();
  }
});

test('HTTP remains the default and fixture-preview opts into HTTPS from private config', { timeout: 15000 }, async () => {
  const plainRoot = await fixture();
  const plain = await serve(plainRoot, { port: 0, rebaseOrigin: true });
  try {
    assert.match(plain.url, /^http:\/\//);
    assert.equal((await fetch(plain.url)).status, 200);
    await assert.rejects(access(join(plainRoot, 'private', 'tls')));
  } finally {
    await plain.close();
  }

  const secureRoot = await fixture({ protocol: 'https' });
  const recordPath = join(secureRoot, 'preview.json');
  const script = fileURLToPath(new URL('../scripts/fixture-preview.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, secureRoot, recordPath], { cwd: process.cwd(), shell: false, stdio: 'ignore' });
  try {
    const record = await waitForJson(recordPath);
    assert.equal(record.pid, child.pid);
    assert.equal(record.protocol, 'https');
    assert.match(record.url, /^https:\/\//);
    const cert = await readFile(join(secureRoot, 'private', 'tls', 'cert.pem'));
    assert.equal((await httpsResponse(record.url, { ca: cert })).status, 200);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }

  for (const file of ['src/preview/server.mjs', 'src/fixture-lab/tls.mjs', 'scripts/fixture-preview.mjs']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*:\s*false/);
  }
});
