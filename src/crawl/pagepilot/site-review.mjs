const RULES = {
  'missing-title': ['medium', 'Missing document titles', 'Add a unique, descriptive HTML title to each affected page.'],
  'missing-lang': ['medium', 'Missing page language', 'Set the correct lang attribute on the HTML element, then review multilingual pages.'],
  'image-missing-alt': ['medium', 'Images without an alt attribute', 'Review each image: describe informative images and use empty alt text for decorative images.'],
  'html-parse-error': ['medium', 'HTML required parser repair', 'Validate the affected templates and compare the recovered fields with the original content.'],
  'html-content-type-recovered': ['medium', 'HTML recovered from incorrect response headers', 'Configure the source server to return text/html for these pages. Review the recovered content before migration.'],
  'duplicate-id': ['medium', 'Repeated HTML IDs', 'Make IDs unique and check in-page links, labels and scripted controls.'],
  'javascript-only-link': ['high', 'Navigation requires JavaScript', 'Request a crawlable HTML export or review rendered pages separately. HTTP-only discovery may miss destinations.'],
  'meta-refresh': ['medium', 'Timed or HTML-based redirects', 'Confirm the intended destination. Replace timed redirects with appropriate server redirects where possible.'],
  'legacy-frame': ['medium', 'Legacy frame content', 'Review the frame pages and their combined reading order. Move content into ordinary, directly addressable pages.'],
  'legacy-frameset': ['medium', 'Frameset-based layout', 'Check that all required frame documents were captured and consolidate the layout without losing content.'],
  'embedded-frame': ['medium', 'Embedded frame content', 'Review embedded documents separately; restricted or external frames are not included in this crawl.'],
  'frame-missing-title': ['medium', 'Frames without a descriptive title', 'Give each frame a title describing its content and verify its reading order in the combined page.'],
  'table-layout-suspected': ['low', 'Possible layout tables', 'Confirm which tables contain data and which control layout. Preserve data headers and reading order during redesign.'],
  'missing-doctype': ['low', 'Missing document type', 'Add a standards-mode doctype and check the resulting layout in supported browsers.'],
  'missing-main': ['low', 'No main content landmark', 'Identify the primary content region and add a semantic main landmark.'],
  'legacy-color-attribute': ['low', 'Legacy color attributes', 'Move presentation into stylesheets and measure actual text contrast in a rendered browser.'],
  'inline-style': ['low', 'Inline presentation styles', 'Consolidate repeated presentation rules after verifying that content remains intact.'],
  'deep-wrapper-tree': ['low', 'Deeply nested page structure', 'Simplify unnecessary containers while preserving field relationships and reading order.'],
  'duplicate-navigation': ['low', 'Repeated navigation blocks', 'Review repeated menus and separate global navigation from the content to be migrated.'],
  'input-truncated': ['high', 'HTML exceeded the analysis limit', 'Use a smaller approved scope or split the source export; this page was not analyzed in full.'],
  'dom-node-limit': ['high', 'DOM exceeded the analysis limit', 'Inspect the omitted content before accepting extraction results.'],
  'field-limit': ['medium', 'Field extraction reached its limit', 'Review the source for additional records or fields that were not retained.'],
  'link-limit': ['medium', 'Link extraction reached its limit', 'Use smaller path scopes and confirm navigation coverage.'],
};
const PRIORITY = { high: 0, medium: 1, low: 2 };

/** Findings describe captured evidence, not certification or benchmark accuracy.
 * @param {import('./types').PipelineResult} result
 * @returns {import('./types').SiteReview}
 */
export function buildSiteReview(result) {
  const pages = result.pages ?? [];
  const findings = new Map();
  function add(code, rule, url, count = 1, evidence = '') {
    let finding = findings.get(code);
    if (!finding) {
      const [priority, title, action] = rule;
      finding = { code, priority, title, action, occurrences: 0, urls: new Set(), evidence: new Set() };
      findings.set(code, finding);
    }
    finding.occurrences += Number.isInteger(count) && count > 0 ? Math.min(count, 100_000) : 1;
    if (url) finding.urls.add(url);
    if (evidence) {
      finding.evidence.add(String(evidence).slice(0, 200));
      finding.evidence = new Set([...finding.evidence].sort().slice(0, 3));
    }
  }
  const titles = new Map();
  for (const page of pages) {
    for (const issue of page.issues ?? []) {
      const legacyPresentation = !Object.hasOwn(RULES, issue.code) && issue.code.startsWith('legacy-');
      const rule = Object.hasOwn(RULES, issue.code) ? RULES[issue.code] : legacyPresentation
        ? ['low', 'Obsolete HTML elements', 'Replace obsolete presentation markup with semantic HTML and stylesheets after reviewing the content.']
        : ['low', 'Additional source markup finding', 'Inspect the recorded source evidence before changing the template.'];
      add(legacyPresentation ? 'legacy-presentation' : issue.code, rule, page.url, issue.count, issue.evidence || (legacyPresentation ? issue.code : ''));
    }
    if (!Object.keys(page.fields ?? {}).some(key => key !== 'title') && !(page.recordCount > 0)) {
      add('limited-field-evidence', ['medium', 'Limited structured field evidence', 'Confirm whether this is free-text content or an unrecognized record layout. Review extracted values before accepting the suggested group.'], page.url);
    }
    const title = String(page.title ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (title) {
      const sameTitle = titles.get(title) ?? new Set();
      sameTitle.add(page.url); titles.set(title, sameTitle);
    }
  }
  for (const [title, urls] of titles) if (urls.size > 1) {
    for (const url of urls) add('repeated-title', ['medium', 'Repeated captured page titles', 'Check whether these are distinct records, duplicate content, or a site-wide title masking the actual page heading.'], url, 1, title);
  }
  for (const outcome of result.outcomes ?? []) {
    if (outcome.state === 'failed') add('failed-request', ['high', 'Pages could not be collected', 'Check the source URL and server response. Retry only after resolving the recorded error; missing pages are not represented in the groups.'], outcome.url, 1, outcome.reason);
    if (outcome.state === 'unattempted') add('unattempted-url', ['medium', 'Discovered pages outside this sample', 'Review the remaining URLs and run another approved, bounded path scope if more coverage is needed.'], outcome.url, 1, outcome.reason);
    if (outcome.state === 'skipped' && (outcome.reason === 'non_html_response' || outcome.redirects?.length)) {
      add('fetch-skipped', ['medium', 'Requested pages could not be analyzed', 'Check whether the URL should return HTML or redirects to an approved destination. Restricted targets remain excluded; do not treat this URL as captured content.'], outcome.url, 1, outcome.reason);
    }
  }
  if (!result.crawl?.allEligibleAnalyzed) {
    add('incomplete-crawl', ['high', 'Crawl coverage is incomplete', 'Review Crawl outcomes before presenting the sample as a full-site inventory. Resolve failures or agree a narrower crawl scope.'], null, 1, result.crawl?.stopReason || 'Not every eligible URL was analyzed');
  }
  if (result.evaluation?.status === 'failed') {
    add('benchmark-gate-failed', ['high', 'Known-answer benchmark did not pass', 'Review Validation for missing pages, incorrect grouping or field mismatches. Do not accept these predictions as a successful benchmark.'], null, 1, result.evaluation.reason);
  }
  const items = [...findings.values()].map(finding => ({
    ...finding, urls: [...finding.urls].sort(), evidence: [...finding.evidence].sort(),
  })).sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || b.urls.length - a.urls.length || a.code.localeCompare(b.code));
  return {
    findings: items,
    analyzedPages: pages.length,
    affectedUrls: new Set(items.flatMap(finding => finding.urls)).size,
    highPriority: items.filter(finding => finding.priority === 'high').length,
    recoveredPages: pages.filter(page => page.fetch?.htmlDetected).length,
    scope: result.provenance?.synthetic ? 'Fictional benchmark' : 'Public HTML sample',
    limitations: [
      'Findings describe the captured sample, not the entire website. The source website has not been changed.',
      'HTTP HTML only: scripts, visual layout, interactive behavior and computed color contrast are not assessed here.',
      'Suggested groups and fields require review. Optional fields do not automatically mean a page is defective.',
      result.provenance?.synthetic ? 'Accuracy is measured against the private answer key for this fictional fixture only.' : 'No answer key exists for this public site. Clustering accuracy is not measured.',
    ],
  };
}
