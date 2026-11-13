#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { loadConfig, validateConfig, NOISE_TYPES } from './site/config.mjs';
import { DOMAINS, presetConfig } from './site/presets.mjs';
import { generate } from './site/generator.mjs';
import { serve } from './preview/server.mjs';
import { crawl } from './crawl/crawler.mjs';
import { evaluate, writeReports } from './answers/evaluator.mjs';
import { json } from './site/util.mjs';

const help = `Siteforge benchmark generator

node src/cli.mjs presets --out configs/demo
node src/cli.mjs validate examples/library.yaml
node src/cli.mjs generate examples/library.yaml --out outputs/library
node src/cli.mjs pair examples/library.yaml --noise high --out outputs/pair
node src/cli.mjs serve outputs/library --port 4310
node src/cli.mjs cms-theme outputs/library --cms wordpress|drupal --out outputs/library-wordpress.zip
node src/cli.mjs crawl http://127.0.0.1:4310 --mode browser --out outputs/actual.json
node src/cli.mjs evaluate --truth outputs/library/private/ground-truth.json --actual outputs/actual.json --out outputs/report
node src/cli.mjs run examples/library.yaml --out outputs/run
node src/cli.mjs batch examples/suite.yaml --out outputs/suite
node src/cli.mjs wordpress push outputs/library [--url http://127.0.0.1:9400] [--token T] [--builder blocks|elementor] [--front-page]
node src/cli.mjs wordpress inspect [--url ... --token ...] [--site outputs/library]
node src/cli.mjs wordpress reset outputs/library [--url ... --token ...]

Overrides: --pages N --framework html|react|angular --noise clean|low|medium|high|custom
WordPress: without --url/--token the connection in .wordpress/connection.json is used; --no-reuse always creates
  new post types, --no-home skips the Home page, --status FILE writes progress JSON there.
Crawl: --mode http|browser --strategy fields|structure --max-pages N --wait-ms N
Evaluation: --options path/to/normalization.json; --min-coverage 0..1 exits 2 on regression
Generation preserves existing directories. Answers exist only under private/.`;

function number(v, fallback) { if (v === undefined) return fallback; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`Invalid number: ${v}`); return n; }
function overrides(config, v) {
  const c = structuredClone(config);
  if (v.pages) c.site.pageCount = number(v.pages);
  if (v.framework) { c.site.framework = v.framework; delete c.site.rendering; }
  if (v.noise) c.noise = { level: v.noise };
  return validateConfig(c);
}
async function writeNew(path, value) { await mkdir(dirname(resolve(path)), { recursive:true }); await writeFile(path,value,{ flag:'wx' }); }
async function createNewDirectory(path) {
  const destination=resolve(path);
  await mkdir(dirname(destination),{recursive:true});
  try { await mkdir(destination); }
  catch(error) {
    if(error.code==='EEXIST') throw new Error(`Output directory already exists: ${destination}`);
    throw error;
  }
}

// wordpress push|inspect|reset: SiteForge content into a real WordPress through the SiteForge Importer plugin.
async function wordpressCommand([action, target], v) {
  const { pushSiteToWordPress, resetSiteInWordPress, loadSite } = await import('./wordpress/push.mjs');
  const { inspectWordPress } = await import('./wordpress/inspect.mjs');
  const { connect } = await import('./wordpress/client.mjs');
  const { rename } = await import('node:fs/promises');
  const atomicJson = async (path, value) => { const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, json(value), { mode: 0o600 }); await (await import('./site/replace-file.mjs')).replaceFile(temporary, path); };
  const connection = { url: v.url, token: v.token };
  if (action === 'inspect') {
    const { client } = await connect(connection);
    const siteTypes = v.site ? (await loadSite(v.site)).types : undefined;
    const summary = await inspectWordPress(client, { siteTypes });
    console.log(summary.text); return;
  }
  if (!target) throw new Error(`wordpress ${action ?? ''} requires a generated site directory`.replace('  ', ' '));
  if (action === 'reset') {
    const result = await resetSiteInWordPress(target, connection);
    console.log(`Deleted ${result.deleted} items of ${result.siteId}${result.removedTypes.length ? `; removed content types ${result.removedTypes.join(', ')}` : ''}.`); return;
  }
  if (action !== 'push') throw new Error('wordpress commands: push <site-dir>, inspect, reset <site-dir>');
  if (v.builder && !['blocks', 'elementor'].includes(v.builder)) throw new Error('--builder must be blocks or elementor');
  // --status FILE: progress for the app (state queued/running/done/failed), rewritten atomically.
  const status = { state: 'running', pid: process.pid, siteDir: resolve(target), builder: v.builder ?? 'blocks', frontPage: Boolean(v['front-page']), startedAt: new Date().toISOString(), progress: null, summary: null, error: null };
  const save = async () => { if (v.status) await atomicJson(v.status, { ...status, updatedAt: new Date().toISOString() }); };
  await save();
  let last = 0;
  try {
    const summary = await pushSiteToWordPress(target, { ...connection, builder: v.builder ?? 'blocks', setFrontPage: Boolean(v['front-page']), homePage: !v['no-home'], reuseExisting: !v['no-reuse'], ...(v['site-key'] ? { siteKey: v['site-key'] } : {}),
      onProgress: async event => {
        status.progress = event;
        if (Date.now() - last > 500 || event.phase === 'done') { last = Date.now(); await save(); }
        if (!v.status && process.stderr.isTTY) process.stderr.write(`\r${event.phase} ${event.done ?? ''}/${event.total ?? ''}   `);
      } });
    Object.assign(status, { state: 'done', summary, finishedAt: new Date().toISOString() }); await save();
    if (!v.status && process.stderr.isTTY) process.stderr.write('\n');
    console.log(json(summary));
  } catch (error) {
    Object.assign(status, { state: 'failed', error: error.message, finishedAt: new Date().toISOString() }); await save();
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { values:v, positionals:p } = parseArgs({ args:argv, allowPositionals:true, strict:true, options:Object.fromEntries(['out','port','host','pages','framework','noise','truth','actual','mode','strategy','max-pages','wait-ms','options','min-coverage','cms','url','token','builder','status','site','site-key'].map(k=>[k,{type:'string'}]).concat(['help','front-page','no-home','no-reuse'].map(k=>[k,{type:'boolean'}]))) });
  const command = p[0];
  if (!command || v.help) { console.log(help); return; }
  if (command === 'wordpress') { await wordpressCommand(p.slice(1), v); return; }
  if (command === 'presets') {
    if (!v.out) throw new Error('presets requires --out');
    for (const [i,d] of DOMAINS.entries()) await writeNew(join(v.out,`${d}.yaml`),stringify(presetConfig(d,i)));
    console.log(`Created 10 configurations in ${resolve(v.out)}`); return;
  }
  if (command === 'serve') {
    if (!p[1]) throw new Error('serve requires generated output directory');
    const server = await serve(p[1],{ port:number(v.port,4310), host:v.host ?? '127.0.0.1' });
    console.log(`Serving public files only: ${server.url}`);
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
    return;
  }
  if (command === 'cms-theme') {
    if (!p[1] || !v.out || !v.cms) throw new Error('cms-theme requires a generated output directory, --cms wordpress|drupal and --out file.zip');
    const { cmsPackageEntries } = await import('./cms/cms-theme.mjs');
    const { zipEntriesStream } = await import('./fixture-lab/archive.mjs');
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { entries, content } = await cmsPackageEntries(p[1], v.cms);
    await mkdir(dirname(resolve(v.out)), { recursive: true });
    await pipeline(zipEntriesStream(entries, { date: new Date() }), createWriteStream(v.out, { flags: 'wx' }));
    console.log(`Created ${v.cms} package with ${content.total} pages: ${resolve(v.out)}`); return;
  }
  if (command === 'crawl') {
    if (!p[1] || !v.out) throw new Error('crawl requires URL and --out');
    const result = await crawl(p[1],{ mode:v.mode, strategy:v.strategy, maxPages:number(v['max-pages'],10000), waitMs:number(v['wait-ms'],1000) });
    await writeNew(v.out,json(result)); console.log(json(result.crawl)); return;
  }
  if (command === 'evaluate') {
    if (!v.truth || !v.actual || !v.out) throw new Error('evaluate requires --truth, --actual and --out');
    const threshold = number(v['min-coverage'],0);
    if (threshold < 0 || threshold > 1) throw new Error('min-coverage must be between 0 and 1');
    const [truth,actual,options] = await Promise.all([readFile(v.truth,'utf8').then(JSON.parse),readFile(v.actual,'utf8').then(JSON.parse),v.options ? readFile(v.options,'utf8').then(JSON.parse) : {}]);
    const report = evaluate(truth,actual,options); await writeReports(report,v.out); console.log(json(report));
    const coverage = report.coverage?.recall;
    if ((coverage ?? 0) < threshold) process.exitCode = 2;
    return;
  }
  if (command === 'batch') {
    if (!p[1] || !v.out) throw new Error('batch requires suite YAML or config directory and --out');
    const path = resolve(p[1]); const info = await stat(path);
    let configs = [];
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).filter(n=>/\.ya?ml$|\.json$/.test(n)).sort()) configs.push(await loadConfig(join(path,name)));
    } else {
      const suite = parse(await readFile(path,'utf8'));
      if (suite.version !== 1 || !Number.isInteger(suite.siteCount) || suite.siteCount < 1 || suite.siteCount > 1000 || !Number.isInteger(suite.pagesPerSite)) throw new Error('Suite requires version: 1, siteCount (1..1000), pagesPerSite');
      for (let i=0;i<suite.siteCount;i++) { const c = presetConfig(DOMAINS[i%DOMAINS.length],i); c.site.pageCount = suite.pagesPerSite; configs.push(c); }
    }
    if (!configs.length) throw new Error('No configurations found');
    configs=configs.map(c=>overrides(c,v));
    if(new Set(configs.map(c=>c.site.id)).size!==configs.length) throw new Error('Batch site IDs must be unique');
    await createNewDirectory(v.out);
    const results = [];
    for (const [i,c] of configs.entries()) { const result = await generate(c,join(v.out,c.site.id)); results.push(result); console.log(`[${i+1}/${configs.length}] ${c.site.id}: ${result.pageCount} pages, ${result.durationMs}ms`); }
    await writeNew(join(v.out,'batch-summary.json'),json({ sites:results.length,pages:results.reduce((n,r)=>n+r.pageCount,0),results })); return;
  }
  if (!['validate','generate','pair','run'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (!p[1]) throw new Error(`${command} requires a configuration file`);
  const c = overrides(await loadConfig(p[1]),v);
  if (command === 'validate') { console.log(json(c)); return; }
  if (!v.out) throw new Error(`${command} requires --out`);
  if (command === 'pair') {
    const clean = structuredClone(c); clean.noise = { level:'clean' };
    const dirty = structuredClone(c); dirty.noise = { level:v.noise ?? 'high' };
    await createNewDirectory(v.out);
    const a = await generate(clean,join(v.out,'clean')); const b = await generate(dirty,join(v.out,'noisy'));
    if (a.canonicalSha256 !== b.canonicalSha256) throw new Error('Paired canonical content mismatch');
    console.log(json({ clean:a, noisy:b, identicalCanonicalContent:true })); return;
  }
  const output = await generate(c,v.out); console.log(json(output));
  if (command === 'run') {
    const server = await serve(v.out,{ port:0 });
    try {
      const actual = await crawl(server.url,{ mode:v.mode ?? (c.site.framework === 'html' ? 'http' : 'browser'),strategy:v.strategy ?? 'fields',maxPages:c.site.pageCount,waitMs:number(v['wait-ms'],700) });
      const truth = JSON.parse(await readFile(join(v.out,'private','ground-truth.json'),'utf8'));
      // Rebase only the temporary local origin, keeping every path and query intact.
      for (const page of actual.pages) page.url = new URL(page.url).pathname + new URL(page.url).search;
      await writeNew(join(v.out,'private','baseline-actual.json'),json(actual));
      const report = evaluate(truth,actual); await writeReports(report,join(v.out,'private','report'));
      console.log(`Baseline evaluation: ${resolve(v.out,'private/report/report.html')}`);
    } finally { await server.close(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode=1; });
