import { buildSiteReview } from './site-review.mjs';

function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function clientReportHtml(run) {
  if (!run.result) throw new Error('Run has no completed result');
  const result = run.result;
  const review = buildSiteReview(result);
  const e = escapeHtml;
  const source = result.provenance.synthetic ? `${result.provenance.profile} fictional benchmark` : result.provenance.sourceUrl || 'Public URL not recorded';
  const findings = review.findings.map(finding => `<section class="finding"><div class="finding-heading"><h3>${e(finding.title)}</h3><span class="priority ${e(finding.priority)}">${e(finding.priority)} priority</span></div><p class="muted">${finding.urls.length ? `${finding.urls.length} affected URLs` : 'Run-level finding'} / ${finding.occurrences} recorded occurrences</p><p>${e(finding.action)}</p>${finding.evidence.length ? `<p class="evidence">Evidence: ${finding.evidence.map(e).join('; ')}</p>` : ''}${finding.urls.length ? `<ul class="urls">${finding.urls.map(url => `<li><code>${e(url)}</code></li>`).join('')}</ul>` : ''}</section>`).join('');
  const groups = result.clusters.map(group => `<tr><td>${e(result.labels?.[group.id] || group.name)}</td><td>${group.count}</td><td>${e(group.fields.join(', ') || 'No common labeled fields')}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>PagePilot Site Review</title><style>
*{box-sizing:border-box}body{margin:0;color:#202124;background:#fff;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}main{max-width:1080px;margin:auto;padding:40px 28px}header{border-bottom:2px solid #0069d9;padding-bottom:24px}h1{font-size:30px;margin:8px 0}h2{font-size:21px;margin:32px 0 14px}h3{font-size:17px;margin:0}p{margin:8px 0}code,.source{overflow-wrap:anywhere}code{font-size:12px}.brand{color:#0058b8;font-weight:700}.muted,.evidence{color:#555a63;font-size:13px}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:24px 0;padding:18px 0;border-bottom:1px solid #dadce0}.facts strong{display:block;font-size:26px}.facts span{font-size:12px;color:#555a63}.finding{border-bottom:1px solid #dadce0;padding:20px 0}.finding-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.priority{font-size:12px;white-space:nowrap}.high{color:#aa2333}.medium{color:#835900}.low{color:#476173}.urls{padding-left:20px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #dadce0;overflow-wrap:anywhere}th{background:#f5f5f7}th:nth-child(2){width:70px}footer{margin-top:32px;border-top:1px solid #dadce0;padding-top:16px;font-size:12px;color:#555a63}@media(max-width:600px){main{padding:24px 16px}h1{font-size:25px}.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.finding-heading{align-items:flex-start;flex-direction:column;gap:4px}th,td{padding:8px 5px;font-size:12px}}@media print{main{padding:0;max-width:none}.finding-heading,h2{break-after:avoid}.facts{break-inside:avoid}}
</style></head><body><main><header><div class="brand">PagePilot</div><h1>Site Review</h1><p class="source">${e(source)}</p><p class="muted">${e(review.scope)} / Captured ${e(run.finishedAt || run.startedAt || 'date unavailable')}</p></header><div class="facts"><div><strong>${review.analyzedPages}</strong><span>Pages collected</span></div><div><strong>${result.clusters.length}</strong><span>Suggested groups</span></div><div><strong>${review.findings.length}</strong><span>Finding categories</span></div><div><strong>${review.highPriority}</strong><span>High-priority categories</span></div></div><h2>Scope and Limitations</h2><ul>${review.limitations.map(item => `<li>${e(item)}</li>`).join('')}</ul><p>Coverage: <strong>${result.crawl.allEligibleAnalyzed ? 'All eligible discovered URLs processed within the configured scope' : 'Incomplete sample'}</strong>.</p><h2>Prioritized Findings</h2>${findings || '<p>No findings were recorded by these checks. This is not an accessibility or migration-readiness certification.</p>'}<h2>Suggested Content Groups</h2><table><thead><tr><th>Group</th><th>Pages</th><th>Common fields</th></tr></thead><tbody>${groups}</tbody></table><footer>Run ${e(run.id)}. This report records observations and proposed work; it does not modify or certify the source website.</footer></main></body></html>`;
}
export function recordsCsv(run) {
  const pages = run.result?.pages ?? [];
  const fields = [...new Set(pages.flatMap(page => Object.keys(page.fields)))].sort();
  const rows = [['url', 'cluster', 'label', 'excluded', ...fields.map(field => `field:${field}`)]];
  for (const page of pages) rows.push([page.url, page.cluster, run.result.labels?.[page.cluster] ?? '', page.excluded ? 'true' : 'false', ...fields.map(field => page.fields[field] ?? '')]);
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
