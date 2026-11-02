import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { parse } from 'parse5';
import { validateConfig } from '../src/config.mjs';
import { validateAnswerKey } from '../src/answer-key.mjs';
import { siteDirectory } from '../src/fixture-lab/store.mjs';
import { textContent, walk } from '../src/util.mjs';

const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4400';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = resolve('outputs/harder-demo');
const evidenceDirectory = resolve('outputs/harder-fixtures');
await mkdir(output, { recursive: true });
await mkdir(evidenceDirectory, { recursive: true });

const settings = {
  name: 'Extreme 200-page library demonstration', siteCount: 1, pagesPerSite: 200,
  domain: 'library', framework: 'html', visualStyle: 'legacy', noise: 'high',
  challenge: 'extreme', scenario: 'baseline', randomness: 100, fieldLayout: 'mixed',
  optionalFields: true, transport: 'none', previewProtocol: 'http', freshSeed: true,
};
const start = await fetch(`${base}/api/fixtures`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(settings) });
const startBody = await start.text();
assert.equal(start.status, 202, startBody);
const { job: initial } = JSON.parse(startBody);
let job;
for (let attempt = 0; attempt < 300; attempt++) {
  const response = await fetch(`${base}/api/fixtures/${initial.id}`);
  assert.equal(response.status, 200);
  ({ job } = await response.json());
  if (job.status !== 'running') break;
  await new Promise(resolveWait => setTimeout(resolveWait, 100));
}
assert.equal(job.status, 'completed', job.error || 'generation timed out');
assert.equal(job.sites.length, 1);
const site = job.sites[0];
const artifactOutput = join(output, job.id);
await mkdir(artifactOutput);
const endpoint = `${base}/api/fixtures/${job.id}/sites/${site.id}`;
const [keyResponse, zipResponse] = await Promise.all([fetch(`${endpoint}/download?kind=answers`), fetch(`${endpoint}/download?kind=public`)]);
assert.equal(keyResponse.status, 200);
assert.equal(zipResponse.status, 200);
assert.match(keyResponse.headers.get('content-disposition'), /answer-key\.json/);
const keyBytes = Buffer.from(await keyResponse.arrayBuffer());
const zipBytes = Buffer.from(await zipResponse.arrayBuffer());
const answer = JSON.parse(keyBytes.toString());
assert.equal(answer.pages.length, 200);
assert.equal(answer.transport.profile, 'none');
assert.deepEqual(answer.transport.rules, []);
const siteRoot = siteDirectory(job.id, site.id);
const source = JSON.parse(await readFile(join(siteRoot, 'private/canonical.json'), 'utf8'));
const config = validateConfig(JSON.parse(await readFile(join(siteRoot, 'private/config.json'), 'utf8')));
validateAnswerKey(source, answer, config);
assert.deepEqual(keyBytes, await readFile(join(siteRoot, 'private/answer-key.json')));
assert.deepEqual(keyBytes, await readFile(join(siteRoot, 'private/ground-truth.json')));
const zip = new AdmZip(zipBytes);
const files = zip.getEntries();
assert.equal(files.filter(file => file.entryName.endsWith('index.html')).length, 200);
assert(files.every(file => !/private|answer-key|ground-truth/.test(file.entryName)));
const normalize = text => text.replace(/\s+/g, ' ').trim();
for (const record of answer.pages) {
  const entry = zip.getEntry(`${record.url.slice(1)}index.html`);
  assert(entry, `No public HTML for ${record.url}`);
  const html = entry.getData().toString();
  const doc = parse(html);
  const main = walk(doc, node => node.tagName === 'main')[0];
  const content = walk(doc, node => node.attrs?.some(attribute => attribute.name === 'id' && attribute.value === 'content'))[0];
  assert(content, `No content container for ${record.url}`);
  assert.equal(Boolean(main), !record.noiseEvents.some(event => event.type === 'missing-main'), `Unexpected main landmark for ${record.url}`);
  const rendered = normalize(textContent(content));
  for (const [field, value] of Object.entries(record.fields)) {
    assert(rendered.includes(normalize(String(value))), `${record.url} is missing observed field ${field}`);
  }
  for (const item of record.repeatedItems ?? []) for (const value of Object.values(item.fields)) {
    assert(rendered.includes(normalize(String(value))), `${record.url} is missing repeated item content`);
  }
  assert(!/expectedCluster|canonicalValues|noiseEvents|answer-key\.json/.test(html), `${record.url} leaks private answers`);
}
const previewResponse = await fetch(`${endpoint}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
const previewBody = await previewResponse.text();
assert.equal(previewResponse.status, 200, previewBody);
const { url: previewUrl } = JSON.parse(previewBody);
assert(previewUrl.startsWith('http://127.0.0.1:'));
for (const record of answer.pages) {
  const response = await fetch(new URL(record.url, previewUrl));
  assert.equal(response.status, 200, `Preview failed for ${record.url}`);
  assert.match(response.headers.get('content-type'), /text\/html/);
}
for (const path of ['/answer-key.json', '/private/answer-key.json', '/ground-truth.json', '/private/ground-truth.json']) {
  assert.equal((await fetch(new URL(path, previewUrl))).status, 404);
}
await writeFile(join(artifactOutput, 'website.zip'), zipBytes);
await writeFile(join(artifactOutput, 'answer-key.json'), keyBytes);
const evidence = {
  status: 'passed', jobId: job.id, jobUrl: `${base}/?job=${job.id}`, previewUrl,
  siteId: site.id, seed: job.config.seed, pageCount: answer.pages.length,
  noiseEvents: answer.pages.reduce((sum, page) => sum + page.noiseEvents.length, 0),
  observedNoiseTypes: [...new Set(answer.pages.flatMap(page => page.noiseEvents.map(event => event.type)))].sort(),
  transportProfile: answer.transport.profile, publicPagesChecked: answer.pages.length,
  previewPagesChecked: answer.pages.length, privatePathsRejected: 4,
  websiteZip: join(artifactOutput, 'website.zip'), answerKey: join(artifactOutput, 'answer-key.json'),
};
await writeFile(join(evidenceDirectory, `${job.id}.json`), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
