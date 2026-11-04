import { publicProjectInput } from './config.mjs';

function canonicalSuggestion(source, redirects, pathPrefix) {
  try {
    const start = new URL(source);
    const target = new URL(redirects?.at(-1)?.to);
    const sameSite = target.hostname.replace(/^www\./, '') === start.hostname.replace(/^www\./, '');
    if (!sameSite || target.origin === start.origin || start.port || target.port || target.username || target.password
      || !['http:', 'https:'].includes(target.protocol) || (start.protocol === 'https:' && target.protocol !== 'https:')) return null;
    // A robots redirect suggests an origin, not a new content path.
    const isRobots = redirects?.[0]?.from && new URL(redirects[0].from).pathname === '/robots.txt';
    if (isRobots) { target.pathname = start.pathname; target.search = start.search; }
    return publicProjectInput(target.href, { pathPrefix }).url;
  } catch { return null; }
}

/** An action is guidance, never an automatic protocol or host-policy bypass. */
export function crawlRecovery(run, { url = '', pathPrefix = '/' } = {}) {
  if (run.status === 'running') return null;
  const result = run.result;
  if (result?.provenance.synthetic || result?.crawl.allEligibleAnalyzed) return null;
  const robots = result?.diagnostics?.robots;
  const pageFailure = result?.outcomes.find(item => item.state === 'failed' || item.redirects?.length && item.state === 'skipped');
  const code = robots?.status === 'unavailable' ? robots.code ?? '' : pageFailure?.reason ?? '';
  const detail = robots?.status === 'unavailable' ? robots.reason : pageFailure?.message;
  const evidence = [code, detail, run.error].filter(Boolean).join(': ');
  const source = result?.provenance.sourceUrl ?? url;
  const startAddresses = [source, result?.diagnostics?.requestedUrl, result?.diagnostics?.effectiveUrl].filter(Boolean);
  const startOutcome = result?.outcomes.find(item => startAddresses.includes(item.url) && item.reason === 'cross_origin');
  const redirectEvidence = robots?.status === 'unavailable' && robots.code === 'cross_origin' ? robots.redirects : startOutcome?.redirects;
  const suggestedUrl = canonicalSuggestion(source, redirectEvidence, pathPrefix);
  const recovery = (title, message, action = 'settings') => ({ title, message, action, evidence, suggestedUrl: null });
  if (result?.crawl.stopReason === 'user_stopped') return recovery('Crawl stopped', `${result.crawl.analyzed} collected pages were saved. Review the partial results or start a new crawl.`, 'pages');

  const challenge = result?.outcomes.some(item => item.redirects?.some(redirect => {
    try { return /^\/(?:__superjs\/challenge|cdn-cgi\/challenge-platform)(?:\/|$)/i.test(new URL(redirect.to).pathname); } catch { return false; }
  }));
  if (challenge) return recovery('Website requires browser verification', 'Automated access was redirected to a verification challenge. Use an authorized HTML export or a crawlable source; verification is not bypassed.', 'pages');
  if (['http_401', 'http_403'].includes(code)) return recovery('Website denied access', 'The server refused this request. Check access with the site owner; restricted pages are not bypassed.', 'pages');
  if (suggestedUrl) return { ...recovery('The website uses another address', 'Review the detected address before starting a new crawl.'), suggestedUrl };
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(evidence)) return recovery('Website certificate is not trusted', 'Verify the address or ask the site owner to fix the certificate. Security checks stay enabled.');
  if (/TLS|SSL/i.test(evidence)) return recovery('Secure connection failed', 'Verify the website\'s published address and HTTPS support. The connection was not downgraded.');
  if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(evidence)) return recovery('Website address not found', 'Check the hostname or your network connection.');
  if (/ECONNREFUSED|ECONNRESET|UND_ERR_CONNECT|Timeout|timed out/i.test(evidence)) return recovery('Website did not respond', 'Check the address or retry when the server is available.');
  if (/Private network|Start URL rejected|auth_or_private|hidden_or_unsafe/i.test(evidence)) return recovery('Address blocked by crawl policy', 'Use a public content URL without private or sign-in paths.');
  if (/server_429|server_503/.test(evidence + result?.crawl.stopReason)) return recovery('Website asked us to stop', 'Wait before retrying. Collected pages remain available.', 'pages');
  if (result?.crawl.stopReason === 'robots_unavailable') return recovery('Robots policy could not be read', 'The crawl stopped before collecting more pages. Check the website policy.', 'pages');
  if (result?.outcomes.some(item => item.reason === 'robots_disallowed') && !result.crawl.analyzed) return recovery('Crawling is disallowed', 'Choose a public path permitted by the website robots policy.');
  if (!result?.crawl.analyzed) return recovery('No readable pages collected', 'Check that the address returns public HTML. Sign-in and script-only pages are unsupported.');
  if (result.crawl.counts.failed) return recovery('Some pages could not be read', 'Collected pages are saved. Review the failed URLs.', 'pages');
  if (result.outcomes.some(item => item.state === 'unattempted' && item.reason === 'page_budget')) return recovery('Page limit reached', `${result.crawl.analyzed} pages saved. Increase the limit or narrow the path for the next run.`);
  return recovery('Partial website sample', 'Review skipped URLs and crawl limits before using these results.', 'pages');
}
