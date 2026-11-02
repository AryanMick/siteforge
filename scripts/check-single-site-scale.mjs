import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import * as parse5 from 'parse5';
import { createJob, getJob, siteDirectory, fixtureRoot } from '../src/fixture-lab/store.mjs';
import { publicZipStream, answerStream } from '../src/fixture-lab/archive.mjs';
import { evaluatorZipStream } from '../src/fixture-lab/handoff.mjs';
import { inspectAnswers } from '../src/fixture-lab/answer-inspection.mjs';
import { walk, textContent } from '../src/util.mjs';
import { hashFile } from '../src/json-artifacts.mjs';
import { verifyZipEntries } from './zip-integrity.mjs';

const output = resolve(process.env.SCALE_EVIDENCE_DIR || 'outputs/single-site-scale');
await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, 'Use an empty scale evidence directory; existing reports and archives are preserved');
const started = performance.now();
const startedAt = new Date().toISOString();
const evidencePath = join(output, 'evidence.json');
await writeFile(evidencePath, JSON.stringify({ status: 'running', startedAt }), { flag: 'wx' });
try {
const initial = process.env.SCALE_JOB_ID ? await getJob(process.env.SCALE_JOB_ID) : await createJob({ name: 'Single-site 100000-page verification', siteCount: 1, pagesPerSite: 100000,
  domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'high', randomness: 50,
  cmsProfile: 'wordpress', builderProfile: 'gutenberg', transport: 'mixed', seed: 48291, optionalFields: true });
assert(initial, 'The requested saved scale job was not found');
console.log(JSON.stringify({ jobId: initial.id, dataDirectory: fixtureRoot() }));
let job;
let reported = '';
const deadline = Date.now() + 20 * 60 * 1000;
while (Date.now() < deadline) {
  job = await getJob(initial.id);
  const progress = `${job.progress?.phase ?? job.status}: ${job.progress?.completedPages ?? 0}`;
  if (progress !== reported) { console.log(progress); reported = progress; }
  if (job.status !== 'running') break;
  await new Promise(resolvePromise => setTimeout(resolvePromise, 2000));
}
assert.equal(job.status, 'completed', job.error || '100,000-page generation timed out');
assert.equal(job.sites.length, 1);
assert.equal(job.sites[0].pageCount, 100000);
const directory = siteDirectory(job.id, job.sites[0].id);
const privateRoot = join(directory, 'private');
const publicRoot = join(directory, 'public');
const generation = JSON.parse(await readFile(join(privateRoot, 'run.json'), 'utf8'));
const first = await inspectAnswers(directory, { offset: 0, limit: 25 });
const last = await inspectAnswers(directory, { offset: 99975, limit: 25 });
assert.equal(first.pagination.total, 100000);
assert.equal(last.pages.length, 25);
const books = await inspectAnswers(directory, { q: 'book', limit: 100 });
assert(books.pages.some(page => page.fieldStates.coverImage === 'present'));
assert(books.pages.some(page => page.fieldStates.coverImage === 'absent'));

const locations = xml => walk(parse5.parse(xml), node => node.tagName === 'loc').map(node => textContent(node).trim());
const sitemapIndex = locations(await readFile(join(publicRoot, 'sitemap.xml'), 'utf8'));
assert.equal(sitemapIndex.length, 3);
const sitemapUrls = new Set();
for (const url of sitemapIndex) {
  const file = join(publicRoot, new URL(url).pathname);
  assert((await stat(file)).size <= 52428800);
  const urls = locations(await readFile(file, 'utf8'));
  assert(urls.length <= 50000);
  for (const value of urls) { assert(!sitemapUrls.has(value)); sitemapUrls.add(value); }
}
assert.equal(sitemapUrls.size, 100000);
console.log('Auditing every page, answer record, inspection chunk and public file hash');
await promisify(execFile)(process.execPath, ['scripts/audit-fixture-job.mjs', job.id, join(output, 'audit.json')], { env: process.env, timeout: 600000, maxBuffer: 1024 * 1024 });
const audit = JSON.parse(await readFile(join(output, 'audit.json'), 'utf8'));
assert.equal(audit.status, 'passed');

const zipStarted = performance.now();
const zipPath = join(output, 'public.zip');
await pipeline(await publicZipStream(directory), createWriteStream(zipPath, { flags: 'wx' }), { signal: AbortSignal.timeout(300000) });
const zipMs = Math.round(performance.now() - zipStarted);
console.log(`ZIP streamed in ${zipMs}ms; checking every archived file`);
const manifest = JSON.parse(await readFile(join(privateRoot, 'manifest.json'), 'utf8'));
assert.equal(Object.keys(manifest.artifactFiles).filter(name => name.endsWith('index.html')).length, 100000);
const publicArchive = await verifyZipEntries(zipPath, new Map(Object.entries(manifest.artifactFiles)));
const exportedKey = join(output, 'answer-key.json');
await pipeline(await answerStream(directory), createWriteStream(exportedKey, { flags: 'wx' }), { signal: AbortSignal.timeout(300000) });
assert.equal(await hashFile(exportedKey), await hashFile(join(privateRoot, 'answer-key.json')));
console.log('Checking the private evaluator ZIP and its domain-folder inventory');
const evaluatorPath = join(output, 'evaluator.zip');
await pipeline(await evaluatorZipStream(job), createWriteStream(evaluatorPath, { flags: 'wx' }), { signal: AbortSignal.timeout(300000) });
const host = `${job.sites[0].id}.siteforge.test`;
const expectedEvaluator = new Map(Object.entries(manifest.artifactFiles).map(([name, digest]) => [`${host}/website/${name}`, digest]));
expectedEvaluator.set(`${host}/answer-key.json`, await hashFile(join(privateRoot, 'answer-key.json')));
expectedEvaluator.set(`${host}/metadata.json`, await hashFile(join(privateRoot, 'metadata.json')));
expectedEvaluator.set(`${host}/index.html`, await hashFile(join(job.sites[0].handoff.directory, 'index.html')));
const evaluatorArchive = await verifyZipEntries(evaluatorPath, expectedEvaluator);
const evidence = { status: 'passed', startedAt, jobId: job.id, siteId: job.sites[0].id, dataDirectory: fixtureRoot(),
  websites: 1, pages: 100000, publicFilesVerified: audit.publicFilesVerified, sitemapChunks: sitemapIndex.length,
  optionalCoversPresentAndAbsent: true, paginatedAnswers: true, zip64Entries: publicArchive.entries, zipMs,
  zipBytes: (await stat(zipPath)).size, answerBytes: (await stat(exportedKey)).size,
  evaluatorEntriesVerified: evaluatorArchive.entries, handoffFilesVerified: audit.handoffFilesVerified,
  evaluatorBytes: (await stat(evaluatorPath)).size,
  generationMs: generation.durationMs, generatorPeakRssBytes: generation.peakRssBytes,
  verifierPeakRssBytes: process.resourceUsage().maxRSS * 1024, totalMs: Math.round(performance.now() - started),
  reusedSavedJob: Boolean(process.env.SCALE_JOB_ID),
  smartciteRun: false, dockerRun: false };
await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await writeFile(evidencePath, JSON.stringify({ status: 'failed', startedAt, error: String(error?.message ?? error), durationMs: Math.round(performance.now() - started) }, null, 2));
  throw error;
}
