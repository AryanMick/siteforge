import { parse } from 'parse5';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, walk, textContent, attr } from '../site/util.mjs';

export async function launchBrowser() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('../../.cache/browsers', import.meta.url));
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

export function extractPublicPage(html, url, strategy = 'fields') {
  const doc = parse(html);
  const main = walk(doc, n => n.tagName === 'main')[0];
  const scope = main ?? doc;
  const fields = {};
  const title = walk(scope, n => n.tagName === 'h1')[0];
  if (title) fields.title = textContent(title).replace(/\s+/g,' ').trim();
  for (const dt of walk(scope, n => n.tagName === 'dt')) {
    const nodes = dt.parentNode.childNodes.filter(n => n.tagName);
    const dd = nodes[nodes.indexOf(dt) + 1];
    if (dd?.tagName !== 'dd') continue;
    const words = textContent(dt).trim().replace(/\s+/g,' ').toLowerCase().split(' ');
    const key = words.map((w,i) => i ? w[0]?.toUpperCase() + w.slice(1) : w).join('');
    if (key && !['__proto__','constructor','prototype'].includes(key)) fields[key] = textContent(dd).replace(/\s+/g,' ').trim();
  }
  // rel="nofollow" links (sign-in, request and policy pages behind the site's controls) are not followed.
  const anchors = walk(doc, n => n.tagName === 'a' && !/\bnofollow\b/i.test(attr(n,'rel') ?? '')).map(n => attr(n,'href')).filter(Boolean);
  const elements = walk(scope, n => !!n.tagName);
  const signature = strategy === 'structure'
    ? elements.map(n => `${n.tagName}[${attr(n,'class') ?? ''}]`).join('|')
    : Object.keys(fields).sort().join('|') + `:${walk(scope,n=>n.tagName === 'dl').length ? 'record' : 'directory'}`;
  // Pages with a field list are record pages; every other page reports its listing records, possibly none.
  const recordPage = walk(scope, n => n.tagName === 'dl').length > 0;
  const repeatedItems = strategy === 'fields' && !recordPage ? listingRecords(scope, url) : undefined;
  return { record: { url, cluster: `predicted-${hash(signature).slice(0,16)}`, fields, ...(repeatedItems ? { repeatedItems } : {}) }, links: anchors };
}

const camel = label => label.trim().replace(/\s+/g,' ').toLowerCase().split(' ').map((w,i) => i ? w[0]?.toUpperCase() + w.slice(1) : w).join('');
// Listing records (2026-11-02): the smallest element holding exactly one link and at least one "<strong>Label</strong> value"
// paragraph is one record. The link text is its title and the link its URL. A simple baseline heuristic, not a parser
// for every listing layout.
function listingRecords(scope, pageUrl) {
  const labelled = node => node.tagName === 'p' && node.childNodes.find(child => child.tagName || child.value?.trim())?.tagName === 'strong';
  const candidates = walk(scope, node => ['li','tr','td','article','div','section'].includes(node.tagName)
    && walk(node, n => n.tagName === 'a' && attr(n,'href')).length === 1 && walk(node, labelled).length >= 1);
  const innermost = candidates.filter(node => !candidates.some(other => other !== node && walk(node, n => n === other).length));
  const records = [];
  for (const node of innermost) {
    const link = walk(node, n => n.tagName === 'a' && attr(n,'href'))[0];
    let href; try { href = new URL(attr(link,'href'), pageUrl).href; } catch { continue; }
    const fields = { title: textContent(link).replace(/\s+/g,' ').trim() };
    for (const p of walk(node, labelled)) {
      const strong = p.childNodes.find(child => child.tagName === 'strong');
      const key = camel(textContent(strong).trim().replace(/:$/, ''));
      if (!key || ['__proto__','constructor','prototype','title'].includes(key)) continue;
      const rest = p.childNodes.slice(p.childNodes.indexOf(strong) + 1).map(child => textContent(child)).join('');
      fields[key] = rest.replace(/^\s/, '');
    }
    records.push({ url: href, fields });
  }
  return records;
}

export async function crawl(startUrl, { mode = 'http', strategy = 'fields', maxPages = 10000, waitMs = 1000, timeoutMs = 15000 } = {}) {
  if (!['http','browser'].includes(mode)) throw new Error('mode must be http or browser');
  if (!['fields','structure'].includes(strategy)) throw new Error('strategy must be fields or structure');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100000) throw new Error('maxPages must be between 1 and 100000');
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 60000) throw new Error('waitMs must be between 0 and 60000');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000) throw new Error('timeoutMs must be positive and at most 300000');
  const start = new URL(startUrl); start.hash = '';
  if (!['http:','https:'].includes(start.protocol) || start.username || start.password) throw new Error('crawl URL must be http(s) without credentials');
  const queue = [start.href]; const queued = new Set(queue); const visited = new Set(); const pages = []; const failures = [];
  let browser, page;
  if (mode === 'browser') { browser = await launchBrowser(); page = await browser.newPage(); }
  const started = performance.now();
  try {
    for (let index = 0; index < queue.length && visited.size < maxPages; index++) {
      const url = queue[index]; if (visited.has(url)) continue;
      visited.add(url);
      try {
        let html;
        if (mode === 'browser') {
          const response = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
          if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'unknown'}`);
          await page.waitForTimeout(waitMs);
          if (new URL(page.url()).origin !== start.origin) throw new Error('Cross-origin redirect refused');
          html = await page.content();
        } else {
          const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (!response.headers.get('content-type')?.includes('text/html')) continue;
          html = await response.text();
        }
        const extracted = extractPublicPage(html,url,strategy); pages.push(extracted.record);
        for (const href of extracted.links) {
          let next; try { next = new URL(href,url); } catch { continue; }
          next.hash = '';
          if (next.origin !== start.origin || !['http:','https:'].includes(next.protocol)) continue;
          if (/\.(png|jpg|jpeg|js|css|svg|pdf|xml|json)$/i.test(next.pathname)) continue;
          if (!queued.has(next.href)) { queued.add(next.href); queue.push(next.href); }
        }
      } catch (error) { failures.push({ url, error: error.message }); }
    }
  } finally { await browser?.close(); }
  return { version:1, pages, crawl: { mode, strategy, attempted:visited.size, discovered:queued.size, truncated:queued.size > visited.size, failures, durationMs:Math.round(performance.now()-started), note:'Public-only demonstration baseline. Not Brad\'s crawler and not a production accuracy claim.' } };
}
