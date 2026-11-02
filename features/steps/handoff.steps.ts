import assert from 'node:assert/strict';
import { After, Given, Then, When, type World } from '@cucumber/cucumber';
import AdmZip from 'adm-zip';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFiles } from '../../src/artifact-files.mjs';
import { evaluatorZipStream, handoffDirectory } from '../../src/fixture-lab/handoff.mjs';
import { publicZipStream } from '../../src/fixture-lab/archive.mjs';
import { createJob, getJob, siteDirectory } from '../../src/fixture-lab/store.mjs';

interface HandoffWorld extends World {
  root: string;
  previousRoot?: string;
  job: { id: string; sites: { id: string; handoff: { version: number; status: string; directory: string } }[] };
  evaluator: AdmZip;
  publicArchive: AdmZip;
}

async function zipped(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return new AdmZip(Buffer.concat(chunks));
}

Given('a completed five-page evaluator test set', async function(this: HandoffWorld) {
  this.root = await mkdtemp(join(tmpdir(), 'bdd-evaluator-'));
  this.previousRoot = process.env.FIXTURE_LAB_DATA_DIR;
  process.env.FIXTURE_LAB_DATA_DIR = this.root;
  const started = await createJob({ name: 'BDD evaluator', pagesPerSite: 5, seed: 31 });
  for (let attempt = 0; attempt < 400; attempt++) {
    const job = await getJob(started.id);
    if (job?.status !== 'running') { assert.equal(job?.status, 'completed', job?.error); this.job = job; return; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error('Evaluator batch did not finish');
});

When('its local handoff and evaluator archive are inspected', async function(this: HandoffWorld) {
  this.evaluator = await zipped(await evaluatorZipStream(this.job));
  this.publicArchive = await zipped(await publicZipStream(siteDirectory(this.job.id, this.job.sites[0].id)));
});

Then('the handoff contains a website, answer key and metadata under its generated hostname', async function(this: HandoffWorld) {
  const site = this.job.sites[0];
  const host = `${site.id}.siteforge.test`;
  const handoff = handoffDirectory(this.job.id, site.id);
  assert.deepEqual(site.handoff, { version: 1, status: 'ready', directory: handoff });
  const inventory = await listFiles(handoff);
  assert(inventory.includes('website/index.html'));
  assert(inventory.includes('answer-key.json'));
  assert(inventory.includes('metadata.json'));
  assert.match(await readFile(join(handoff, 'index.html'), 'utf8'), /\.\/website\/index\.html/);
  assert.deepEqual(this.evaluator.getEntry(`${host}/answer-key.json`)?.getData(), await readFile(join(handoff, 'answer-key.json')));
  assert(this.evaluator.getEntry(`${host}/metadata.json`));
  assert(this.evaluator.getEntry(`${host}/website/index.html`));
});

Then('the public website archive does not contain the answer key', function(this: HandoffWorld) {
  assert(this.publicArchive.getEntry('index.html'));
  assert.equal(this.publicArchive.getEntry('answer-key.json'), null);
  assert.equal(this.publicArchive.getEntry('metadata.json'), null);
});

After({ tags: '@handoff' }, async function(this: HandoffWorld) {
  if (this.previousRoot === undefined) delete process.env.FIXTURE_LAB_DATA_DIR;
  else process.env.FIXTURE_LAB_DATA_DIR = this.previousRoot;
  if (this.root) await rm(this.root, { recursive: true, force: true });
});
