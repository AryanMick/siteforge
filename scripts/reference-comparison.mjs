import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ISSUE_TO_NOISE } from '../src/site-study.mjs';
import { escapeHtml, json } from '../src/util.mjs';

export function summarizeReference(name, crawl) {
  const pages = crawl.pages ?? [];
  const issues = new Map();
  for (const page of pages) for (const issue of page.issues ?? []) {
    issues.set(issue.code, (issues.get(issue.code) ?? 0) + issue.count);
  }
  const measured = [...issues].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, count]) => ({ code, count, fictionalOperator: ISSUE_TO_NOISE[code] ?? null }));
  const sum = (selector) => pages.reduce((total, page) => total + (selector(page) ?? 0), 0);
  const firstFailure = crawl.urls?.find(item => item.state === 'failed');
  return {
    name,
    startUrl: crawl.startUrl,
    robots: crawl.robots?.status ?? 'unknown',
    analyzed: pages.length,
    discovered: crawl.summary?.discovered ?? 0,
    failed: crawl.summary?.counts?.failed ?? 0,
    unattempted: crawl.summary?.counts?.unattempted ?? 0,
    stopReason: crawl.summary?.stopReason ?? null,
    failure: firstFailure?.message?.slice(0, 160) ?? null,
    averageLinks: pages.length ? Math.round(sum(page => page.stats?.linkCount) / pages.length) : 0,
    maximumDepth: Math.max(0, ...pages.map(page => page.stats?.maxDepth ?? 0)),
    maximumFields: Math.max(0, ...pages.map(page => page.stats?.fieldCount ?? 0)),
    totalImages: sum(page => page.stats?.imageCount),
    repeatedRecordsDetected: sum(page => page.records?.length),
    issues: measured,
    unmappedIssues: measured.filter(issue => !issue.fictionalOperator).map(issue => issue.code),
  };
}

export async function compareReferenceDirectory(root) {
  const names = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const samples = [];
  for (const name of names) {
    let crawl;
    try { crawl = JSON.parse(await readFile(join(root, name, 'crawl.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    samples.push(summarizeReference(name, crawl));
  }
  const observed = new Set(samples.flatMap(sample => sample.issues.map(issue => issue.code)));
  const mapped = new Set(samples.flatMap(sample => sample.issues.filter(issue => issue.fictionalOperator).map(issue => issue.code)));
  return {
    version: 1,
    warning: 'Public samples are bounded observations. Inferred clusters and issue-to-operator mappings are not known answers or proof that a fictional page reproduces the original HTML.',
    sampleCount: samples.length,
    analyzedPages: samples.reduce((total, sample) => total + sample.analyzed, 0),
    observedIssueTypes: observed.size,
    mappedIssueTypes: mapped.size,
    samples,
  };
}

function renderComparison(result) {
  const escape = value => escapeHtml(String(value ?? ''));
  const rows = result.samples.map(sample => `<tr><th scope="row">${escape(sample.name)}</th><td>${sample.analyzed}</td><td>${sample.discovered}</td><td>${sample.averageLinks}</td><td>${sample.maximumDepth}</td><td>${sample.maximumFields}</td><td>${escape(sample.robots)}</td><td>${escape(sample.failure ?? sample.stopReason ?? 'Bounded sample')}</td><td>${sample.analyzed ? `<a href="${encodeURIComponent(sample.name)}/report.html">Study</a>` : 'Unavailable'}</td></tr>`).join('');
  const issues = result.samples.map(sample => `<section><h2>${escape(sample.name)}</h2>${sample.issues.length ? `<table><thead><tr><th>Observed issue</th><th>Count</th><th>Fictional operator</th></tr></thead><tbody>${sample.issues.map(issue => `<tr><td>${escape(issue.code)}</td><td>${issue.count}</td><td>${escape(issue.fictionalOperator ?? 'Not modeled')}</td></tr>`).join('')}</tbody></table>` : `<p>${sample.analyzed ? 'No issues recorded in the bounded sample.' : `No pages analyzed. ${escape(sample.failure ?? sample.stopReason ?? 'See crawl.json for the access diagnostic.')}`}</p>`}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reference sample comparison</title><style>body{margin:0;background:#f5f6f5;color:#202525;font:15px/1.5 system-ui}main{max-width:1100px;margin:auto;padding:32px 20px 70px}h1{font-size:30px;letter-spacing:0}h2{font-size:20px;margin:36px 0 12px}p{max-width:78ch}a{color:#126b64}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #dce2e1;vertical-align:top}thead{background:#e8eeee}.scroll{overflow:auto}.note{border-left:3px solid #ad6044;padding:8px 14px;background:white}</style></head><body><main><h1>Reference sample comparison</h1><p>${result.sampleCount} bounded samples, ${result.analyzedPages} analyzed pages. ${result.mappedIssueTypes} of ${result.observedIssueTypes} observed issue categories have a corresponding fictional test operator.</p><p class="note">${escape(result.warning)}</p><div class="scroll"><table><thead><tr><th>Site</th><th>Pages</th><th>Discovered</th><th>Avg links</th><th>Max DOM depth</th><th>Max fields</th><th>Robots</th><th>Limit</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div>${issues}<p><a href="comparison.json">Download summary JSON</a></p></main></body></html>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string', default: 'outputs/sample-comparison-20261007' } } });
  const root = resolve(values.root);
  const result = await compareReferenceDirectory(root);
  await writeFile(join(root, 'comparison.json'), json(result));
  await writeFile(join(root, 'comparison.html'), renderComparison(result));
  console.log(`Compared ${result.sampleCount} bounded samples and ${result.analyzedPages} pages: ${join(root, 'comparison.html')}`);
}
