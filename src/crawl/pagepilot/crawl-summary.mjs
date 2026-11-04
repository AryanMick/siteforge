export function describeCrawl(result) {
  const { crawl, outcomes = [] } = result;
  const pages = crawl.analyzed;
  if (crawl.stopReason === 'user_stopped') return { title: 'Stopped by you', message: `${pages} collected pages were saved. Remaining queued URLs were not requested.` };
  if (crawl.stopReason === 'robots_unavailable') return { title: 'Robots policy unavailable', message: 'No further requests were made because the site\'s robots policy could not be read safely.' };
  if (crawl.stopReason === 'server_429_stop' || crawl.stopReason === 'server_503_stop') return { title: 'The website asked the crawler to stop', message: `${pages} pages were saved before the server returned a rate-limit or unavailable response.` };
  if (!pages) return { title: 'No HTML pages collected', message: 'The URL was blocked, unavailable, or did not return readable HTML. Recorded outcomes below contain the failure reasons.' };
  if (crawl.stopReason) return { title: 'Crawl stopped early', message: `${pages} pages were saved. Stop reason: ${crawl.stopReason.replaceAll('_', ' ')}.` };
  if (crawl.counts?.failed) return { title: 'Some pages could not be read', message: `${pages} pages were saved; ${crawl.counts.failed} requests failed. Results cover only the collected pages.` };
  const remaining = crawl.counts?.unattempted ?? 0;
  if (outcomes.some(item => item.state === 'unattempted' && item.reason === 'page_budget')) return { title: 'Page limit reached', message: `${pages} pages collected; ${remaining} discovered URLs were not attempted. This is a bounded sample, not the whole website.` };
  if (remaining || crawl.omittedLinks) return { title: 'Partial sample collected', message: `${pages} pages were saved. Depth or discovery limits left additional URLs outside this sample.` };
  if (!crawl.allEligibleAnalyzed) return { title: 'Crawl needs review', message: `${pages} pages were saved, but not every eligible URL returned analyzable HTML.` };
  return { title: 'Crawl completed', message: `${pages} pages collected. All eligible discovered URLs were processed within the configured scope.` };
}
