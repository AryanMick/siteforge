import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLayer } from '../tools/run-verification-layer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(root);
const supported = version => /^(22|24)\./.test(version) || Number(version.split('.')[0]) >= 26;
if (!supported(process.versions.node)) {
  let runtime;
  const cache = join(root, '.cache/npm/_npx');
  for (const entry of await readdir(cache).catch(() => [])) {
    try {
      const base = join(cache, entry, 'node_modules/node');
      const info = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'));
      if (info.version.startsWith('24.')) { runtime = join(base, process.platform === 'win32' ? 'bin/node.exe' : 'bin/node'); break; }
    } catch { /* Ignore unrelated cached packages. */ }
  }
  if (!runtime) throw new Error('Verification requires Node 24. Install Node 24 and run npm ci first.');
  const child = spawn(runtime, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, PATH: `${dirname(runtime)}${delimiter}${process.env.PATH}` } });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  await verify();
}

async function sourceHash() {
  const hash = createHash('sha256');
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) { hash.update(child.slice(root.length + 1)); hash.update(await readFile(child)); }
    }
  }
  for (const directory of ['app', 'src', 'test', 'scripts', 'features', 'examples', 'public', '.github/workflows']) await visit(join(root, directory));
  for (const file of ['README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.mjs', 'config/cucumber.mjs', 'config/stryker.config.mjs', 'config/stryker.generator.config.mjs', 'config/stryker.repeated.config.mjs']) {
    hash.update(file); hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

async function verify() {
  const directory = resolve('outputs/verification', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(directory, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(), sourceSha256: await sourceHash(), node: process.version,
    specApproval: 'not obtained (autonomous run)', status: 'running',
    limits: [
      'No configured lint, formatting, or complexity gate.',
      'No changed-line coverage gate; no coverage percentage claimed.',
      'Separate Stryker runs target src/crawl/engine/structure.ts, src/answers/field-locations.mjs and src/answers/repeated-item-locations.mjs. They do not measure mutation coverage of the whole generator, job API or application.',
      'Generator archives use zip-stream; adm-zip is retained for archive-reading tests and legacy exports. The October 9 dependency audit reported zero advisories after pinned updates; this is a dated snapshot, not a security certification.',
      'Random-site properties sample 1,500 cases with replayable fast-check seeds and shrink paths; full second-source replay and DOM checks use bounded subsets. This is not exhaustive over all inputs. No randomized test-order runner is configured.',
      'Independent old-coder verifier protocol not performed; not all new checks had a recorded RED run.',
      'Smartcite integration, real authentication, TLS failures beyond self-signed trust, DNS failures, PDFs/OCR and every possible obstacle are not verified. Full 1440-site artifact evidence is separate in outputs/case-catalog/evidence.json; this run checks the catalog configuration and UI, not full-corpus regeneration. Response conditions and HTTPS require the preview server, not a static ZIP.',
      'Private fieldLocations cover page.fields; repeatedItemLocations cover declared fields in repeatedItems. Older keys may predate these contracts. Evaluator ZIPs contain private answers and must not be publicly hosted.',
    ],
    layers: [],
  };
  try {
    const base = process.env.PAGEPILOT_URL || 'http://127.0.0.1:4400';
    if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Only a loopback test server is permitted.');
    const response = await fetch(`${base}/api/fixtures`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok || !Array.isArray((await response.json()).jobs)) throw new Error('Start SiteForge with npm run siteforge before verification.');
    for (const [name, args] of [
      ['unit', ['test']], ['types', ['run', 'typecheck']], ['pagepilot', ['run', 'test:pagepilot']],
      ['generator-api', ['run', 'test:generator-api']], ['bdd', ['run', 'test:bdd']],
      ['mutation', ['run', 'test:mutation']], ['generator-mutation', ['run', 'test:mutation:generator']],
      ['repeated-mutation', ['run', 'test:mutation:repeated']], ['build', ['run', 'build']],
      ['generator-browser', ['run', 'test:generator-ui']],
      ['generator-recovery', ['run', 'test:generator-recovery']],
      ['generator-navigation', ['run', 'test:generator-navigation']],
      ['generator-redesign', ['run', 'test:generator-redesign']],
      ['framework-browser', ['run', 'test:browser']], ['legacy-browser', ['run', 'test:legacy-browser']],
      ['field-locations', ['run', 'test:field-locations']],
      ['cms-markup', ['run', 'test:cms-markup']],
      ['link-noise', ['run', 'test:link-noise']],
      ['base-relative', ['run', 'test:base-relative']],
      ['preview-rebase', ['run', 'test:preview-rebase']],
    ]) {
      const layer = await runLayer(name, 'npm', args, directory);
      report.layers.push(layer);
      await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2));
      if (layer.status !== 'passed') throw new Error(`${name} failed; see ${layer.log}`);
    }
    const randomBrowser = await runLayer('random-browser', process.execPath, ['scripts/checks/check-random-ui.mjs'], directory);
    report.layers.push(randomBrowser);
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2));
    if (randomBrowser.status !== 'passed') throw new Error(`random-browser failed; see ${randomBrowser.log}`);
    if (await sourceHash() !== report.sourceSha256) throw new Error('Source changed during verification; a fresh run is required.');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message; process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2));
    await writeFile(resolve('outputs/verification/latest.json'), JSON.stringify({ directory, ...report }, null, 2));
    console.log(`\nVerification ${report.status}: ${join(directory, 'evidence.json')}`);
  }
}
