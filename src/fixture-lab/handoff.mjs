import { constants, createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ZipStream from 'zip-stream';
import { siteHostname } from './gateway.mjs';
import { jobDirectory, siteDirectory, validUuid } from './store.mjs';
import { hashFile } from '../json-artifacts.mjs';
import { hash } from '../util.mjs';

const entryHtml = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./website/index.html"><title>Open test website</title></head><body><a href="./website/index.html">Open test website</a></body></html>\n';
const noFollow = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

export class HandoffUnavailableError extends Error {}

function safeSegment(value) {
  if (!value || value === '.' || value === '..' || /[\\/:\x00-\x1f]/.test(value)) throw new HandoffUnavailableError('An unsafe website file name was found.');
  return value;
}

async function directory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new HandoffUnavailableError('A website source directory is not a regular directory.');
}

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new HandoffUnavailableError('A website source file is not a regular file.');
  const handle = await open(path, noFollow);
  try { if (!(await handle.stat()).isFile()) throw new HandoffUnavailableError('A website source file changed during validation.'); }
  finally { await handle.close(); }
}

async function privateFile(root, preferred, fallback) {
  const first = join(root, preferred);
  try { await regularFile(first); return first; }
  catch (error) {
    if (error.code !== 'ENOENT' || !fallback) throw error;
    const second = join(root, fallback);
    await regularFile(second);
    return second;
  }
}

async function* publicFiles(root, relative = '') {
  const parent = join(root, relative);
  for (const item of (await readdir(parent, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = safeSegment(item.name);
    const file = join(parent, name);
    const path = relative ? `${relative}/${name}` : name;
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new HandoffUnavailableError('Website symlinks cannot be exported.');
    if (info.isDirectory()) yield* publicFiles(root, path);
    else if (info.isFile()) yield { file, path };
    else throw new HandoffUnavailableError('A website source contains an unsupported file type.');
  }
}

function legacyMetadata(job, site) {
  return Buffer.from(JSON.stringify({ version: 1, source: 'saved-job', site: { id: site.id, name: site.name, domain: site.domain, framework: site.framework }, pageCount: site.pageCount, seed: site.seed }) + '\n');
}

async function* siteEntries(job, site, { legacy = false } = {}) {
  validUuid(job.id);
  const hostname = siteHostname(site.id);
  const root = siteDirectory(job.id, site.id);
  await directory(jobDirectory(job.id));
  await directory(join(jobDirectory(job.id), 'sites'));
  await directory(root);
  const publicRoot = join(root, 'public');
  const privateRoot = join(root, 'private');
  await directory(publicRoot);
  await directory(privateRoot);
  const answer = await privateFile(privateRoot, 'answer-key.json', legacy ? 'ground-truth.json' : undefined);
  let metadata;
  try { metadata = await privateFile(privateRoot, 'metadata.json'); }
  catch (error) { if (!legacy || error.code !== 'ENOENT') throw error; }
  yield { name: `${hostname}/index.html`, data: Buffer.from(entryHtml), private: false };
  yield { name: `${hostname}/answer-key.json`, file: answer, private: true };
  yield { name: `${hostname}/metadata.json`, ...(metadata ? { file: metadata } : { data: legacyMetadata(job, site) }), private: true };
  for await (const entry of publicFiles(publicRoot)) yield { name: `${hostname}/website/${entry.path}`, file: entry.file, private: false };
}

export function handoffDirectory(jobId, siteId) {
  return join(jobDirectory(jobId), 'handoff', siteHostname(siteId));
}

// Evaluator files stay independent copies (editing them must never alter the runtime originals), but they are
// made as copy-on-write clones where the filesystem supports it (APFS, Btrfs, XFS): no extra disk until edited.
// Elsewhere copyFile falls back to an ordinary byte copy. Sources must still be regular files (symlinks are refused).
async function copySource(source, target, mode) {
  const info = await lstat(source);
  if (!info.isFile()) throw new HandoffUnavailableError('Only regular files can be exported.');
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
  } catch (error) {
    if (error.code === 'EEXIST') throw error;
    await pipeline(createReadStream(source, { flags: noFollow }), createWriteStream(target, { flags: 'wx', mode }));
    return;
  }
  await chmod(target, mode);
}

export async function publishSiteHandoff(jobId, siteId) {
  const job = { id: validUuid(jobId) };
  const site = { id: siteId };
  const target = handoffDirectory(jobId, siteId);
  const parent = join(jobDirectory(jobId), 'handoff');
  await directory(jobDirectory(jobId));
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await directory(parent);
  try { await lstat(target); throw new HandoffUnavailableError('The evaluator folder already exists and was preserved.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = join(parent, `.building-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for await (const entry of siteEntries(job, site)) {
      const relative = entry.name.slice(siteHostname(siteId).length + 1);
      const destination = join(staging, ...relative.split('/'));
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      if (entry.file) await copySource(entry.file, destination, entry.private ? 0o600 : 0o644);
      else await writeFile(destination, entry.data, { flag: 'wx', mode: 0o644 });
    }
    try { await lstat(target); throw new HandoffUnavailableError('The evaluator folder already exists and was preserved.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, target);
    return target;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function* batchEntries(job) {
  if (job.status !== 'completed' || job.sites.length !== job.config.siteCount) throw new HandoffUnavailableError('The test set is incomplete.');
  const names = new Set();
  for (const site of job.sites) {
    const hostname = siteHostname(site.id);
    if (names.has(hostname)) throw new HandoffUnavailableError('The test set contains duplicate website names.');
    names.add(hostname);
    yield* siteEntries(job, site, { legacy: true });
  }
}

export async function evaluatorZipStream(job) {
  // Finish validation before returning a response so incomplete sources produce an HTTP error.
  let count = 0;
  for await (const entry of batchEntries(job)) { if (entry.file) await regularFile(entry.file); count++; }
  const zip = new ZipStream({ forceZip64: count >= 65535, zlib: { level: 6 } });
  const output = new PassThrough();
  let activeInput;
  zip.on('error', error => output.destroy(error));
  output.once('close', () => { activeInput?.destroy(); zip.destroy(); });
  zip.pipe(output);
  void (async () => {
    for await (const entry of batchEntries(job)) {
      if (output.destroyed) return;
      const input = entry.file ? createReadStream(entry.file, { flags: noFollow }) : entry.data;
      activeInput = entry.file ? input : undefined;
      await new Promise((accept, reject) => {
        let settled = false;
        const cancelled = () => done(new Error('Archive download cancelled'));
        const done = error => {
          if (settled) return;
          settled = true;
          output.off('close', cancelled);
          input?.off?.('error', done);
          error ? reject(error) : accept();
        };
        output.once('close', cancelled);
        input?.once?.('error', done);
        zip.entry(input, { name: entry.name, date: new Date('2020-01-01T00:00:00Z'), mode: entry.private ? 0o100600 : 0o100644 }, done);
      });
    }
    zip.finalize();
  })().catch(error => { if (!output.destroyed) output.destroy(error); });
  return output;
}

export function evaluatorDownloadName(job) {
  const name = String(job.name || 'test-set').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'test-set';
  return `${name}-${job.id}-evaluator.zip`;
}

export async function auditSiteHandoff(jobId, siteId) {
  const root = handoffDirectory(jobId, siteId);
  await directory(join(jobDirectory(jobId), 'handoff'));
  await directory(root);
  const expected = new Set();
  for await (const entry of siteEntries({ id: jobId }, { id: siteId })) {
    const relative = entry.name.slice(siteHostname(siteId).length + 1);
    expected.add(relative);
    const copied = join(root, ...relative.split('/'));
    await regularFile(copied);
    const originalHash = entry.file ? await hashFile(entry.file) : hash(entry.data);
    if (await hashFile(copied) !== originalHash) throw new HandoffUnavailableError(`Evaluator handoff digest mismatch: ${relative}`);
  }
  let count = 0;
  for await (const entry of publicFiles(root)) {
    if (!expected.has(entry.path)) throw new HandoffUnavailableError(`Unexpected evaluator handoff file: ${entry.path}`);
    count++;
  }
  if (count !== expected.size) throw new HandoffUnavailableError('Evaluator handoff inventory is incomplete.');
  return { files: count };
}
