// Crawler-trap operators. Each entry is a deterministic description of one way real (often old)
// websites confuse crawlers. The same entry produces the private answer-key details, the public
// markup, any extra public resources and, where needed, the preview-server behaviour. Nothing
// here reads the network or another site.
import { gzipSync } from 'node:zlib';
import { escapeHtml, seedFor } from './util.mjs';

const e = escapeHtml;
const isLocalPageTarget = value => typeof value === 'string' && /^\/[a-zA-Z0-9/_-]*$/.test(value) && !value.startsWith('//');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const TRAP_GROUPS = Object.freeze({
  'old-site-navigation': 'Old-site navigation',
  'javascript-links': 'JavaScript-only links',
  'url-duplication': 'URL duplication',
  'infinite-spaces': 'Infinite URL spaces',
  'indexing-signals': 'Indexing signals',
  'server-behaviour': 'Server behaviour & gates',
  'encoding-and-markup': 'Encoding & URL syntax',
});

// Reserved top-level paths used by trap routes and resources; content types may not use them.
export const TRAP_RESERVED_SLUGS = Object.freeze(['cgi-bin', 'intl', 'old-site', 'frames', 'feeds', 'login', 'm']);

export const CALENDAR_PATH = '/cgi-bin/calendar.pl';
export const CALENDAR_RANGE = Object.freeze({ from: '1996-01', to: '2015-12' });
export const DAY_RANGE = Object.freeze({ from: '2004-01-01', to: '2005-12-31' });
const CALENDAR_VIEWS = Object.freeze(['month', 'list']);
export const PATH_INFO_ROOT = '/cgi-bin/browse.pl/';
export const PATH_INFO_ENTRY = `${PATH_INFO_ROOT}archive/`;
const PATH_INFO_STEPS = Object.freeze(['media', 'print']);
export const PATH_INFO_MAX_SEGMENTS = 8;
export const REDIRECT_PATH = '/cgi-bin/redirect.pl';
const JUMP_PATH = '/cgi-bin/jump.pl';
const NOJS_PATH = '/cgi-bin/nojs.pl';
const LIST_PATH = '/cgi-bin/list.pl';
const LIST = Object.freeze({ step: 10, first: 10, last: 200 });
const SEARCH_PATH = '/cgi-bin/search.pl';
const SEARCH_PAGES = 5;
const ARCHIVE_ROOT = '/cgi-bin/archive.pl/';
const ARCHIVE_YEARS = Object.freeze([2003, 2004]);
const CANONICAL_PATH = '/cgi-bin/canonical.pl';
const LOGIN_PATH = '/login';
const LOGIN_MAX_DEPTH = 2;
const DEFAULT_DOCUMENTS = Object.freeze(['default.asp', 'default.aspx', 'index.php', 'index.htm', 'index.shtml']);
const FRAMESET = '/frames/frameset.html';
const FRAME_NAV = '/frames/nav.html';
const FEED = '/feeds/news.rss';
const WRONG_HOST = 'http://www.wrong-host.siteforge.invalid';

function token(seed, id, salt, length, alphabet) {
  let value = '';
  for (let index = 0; value.length < length; index++) {
    const word = seedFor(seed, id, salt, index);
    for (let shift = 0; shift < 32 && value.length < length; shift += 5) value += alphabet[(word >>> shift) % alphabet.length];
  }
  return value;
}
const HEX = '0123456789ABCDEF';
const ALNUM = 'abcdefghijklmnopqrstuvwxyz012345';
function linkTargets(page, limit) {
  return [...new Set(['/', ...page.links.map(link => link.href)].filter(isLocalPageTarget).filter(href => href !== page.url))].slice(0, limit);
}
function firstTarget(page) {
  return page.links.map(link => link.href).find(href => isLocalPageTarget(href) && href !== page.url) ?? '/';
}
const navTargets = site => ['/', ...(site.navigation ?? []).map(item => item.href).filter(isLocalPageTarget)];
const alias = (href, kind, page, status = 200, extra = {}) => ({ href, kind, resolvesTo: page.url, status, ...extra });
const queryEncode = value => encodeURIComponent(value).replace(/%20/g, '+');
const notRoot = page => page.url !== '/';
const homeOnly = page => page.url === '/';
const noBaseRewrite = (page, site) => !['relative', 'base-relative', 'mixed'].includes(site.linkMode);

// ---- month/day helpers -------------------------------------------------------
function monthKey(index) { return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`; }
function monthIndex(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(key ?? '');
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}
const CALENDAR_FIRST = monthIndex(CALENDAR_RANGE.from);
const CALENDAR_LAST = monthIndex(CALENDAR_RANGE.to);
const dayNumber = key => /^\d{4}-\d{2}-\d{2}$/.test(key ?? '') && !Number.isNaN(Date.parse(`${key}T00:00:00Z`)) && new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) === key ? Date.parse(`${key}T00:00:00Z`) / 86400000 : null;
const dayKey = number => new Date(number * 86400000).toISOString().slice(0, 10);
const DAY_FIRST = dayNumber(DAY_RANGE.from);
const DAY_LAST = dayNumber(DAY_RANGE.to);
export function calendarHref(month, view = 'month') { return `${CALENDAR_PATH}?month=${month}${view === 'month' ? '' : `&view=${view}`}`; }
export function calendarEntry(seed) { return calendarHref(monthKey(CALENDAR_FIRST + 36 + seedFor(seed, 'calendar-entry') % 120)); }
export function redirectHref(target, delay = 0) { return `${REDIRECT_PATH}?url=${encodeURIComponent(target)}${delay ? `&delay=${delay}` : ''}`; }
const archiveDays = ARCHIVE_YEARS.reduce((sum, year) => sum + (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000, 0);

function percentEncodeHyphen(url) { const i = url.indexOf('-'); return i < 0 ? null : `${url.slice(0, i)}%2D${url.slice(i + 1)}`; }
function doubleSlash(url) { const i = url.indexOf('/', 1); return i < 0 || i === url.length - 1 ? null : `${url.slice(0, i)}/${url.slice(i)}`; }
function uniqueAliases(page, candidates) {
  const seen = new Set([page.url]);
  return candidates.filter(item => item.href && item.href.startsWith('/') && !item.href.startsWith('//') && !seen.has(item.href) && seen.add(item.href));
}
function facetVariants(base, dimensions) {
  let combos = [[]];
  for (const [name, values] of dimensions) combos = combos.flatMap(combo => [combo, ...values.map(value => [...combo, `${name}=${value}`])]);
  return combos.filter(combo => combo.length).map(combo => `${base}?${combo.join('&')}`);
}
const copyPath = (prefix, url) => `/old-site${prefix}${url.slice(0, -1)}.html`;
const editionDate = (seed, pageId) => dayKey(dayNumber('2001-01-01') + seedFor(seed, pageId, 'edition') % 1500);

const SMART_TEXT = '\u201cSmart quotes\u201d, caf\u00e9 and \u2014 dashes';
function encodeWindows1252(text) {
  const map = { '\u201c': 0x93, '\u201d': 0x94, '\u2014': 0x97, '\u2019': 0x92 };
  return Buffer.from([...text].map(char => map[char] ?? char.charCodeAt(0)));
}

// ---- registry ----------------------------------------------------------------
// Fields: group, semantic (false = misleading document-level declaration), eligible(page, site),
// details(page, site, severity), main/head(d, page, site) markup, raw(d) markup inserted verbatim
// after serialization, mutateHead(head, d, site, helpers), post(html, d), resources(d) declared public files,
// script (emits <script>), looseLinks (emits non-root-relative or non-http hrefs), resourceOnly (no HTML symptom).
const R = {};

// ---------- old-site navigation
R['select-navigation'] = { group: 'old-site-navigation', details: (p, s, v) => ({ targets: linkTargets(p, 2 + v) }),
  main: d => `<form class="jump-menu" action="#"><label>Quick links <select name="jump" onchange="if (this.value) window.location.href = this.value;"><option value="" selected>Select a page</option>${d.targets.map((href, i) => `<option value="${e(href)}">${href === '/' ? 'Home page' : `Related page ${i}`}</option>`).join('')}</select></label></form>` };
R['postback-link'] = { group: 'old-site-navigation',
  details: (p, s) => ({ eventTarget: `ctl00$ContentPlaceHolder1$lnkRelated${seedFor(s.seed, p.pageId, 'postback') % 90 + 10}`, formAction: p.url, method: 'POST', resolvesTo: firstTarget(p), followableByGet: false }),
  main: d => { const id = d.eventTarget.replaceAll('$', '_'); return `<form method="post" action="${e(d.formAction)}" id="aspnetForm" class="webform"><div class="aspNetHidden"><input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value=""><input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value=""><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="/wEPDwUKLTk2NjE4NjQ2OWRkZGQ="></div><a id="${e(id)}" href="#" onclick="javascript:__doPostBack('${e(d.eventTarget)}','');return false;">Related record</a></form>`; } };
R['image-map-navigation'] = { group: 'old-site-navigation', details: (p, s, v) => ({ image: '/assets/collection.png', targets: linkTargets(p, 1 + v) }),
  main: d => `<p class="nav-image"><img src="${e(d.image)}" width="${80 * d.targets.length}" height="40" border="0" usemap="#navmap" alt="Site navigation"></p><map name="navmap" id="navmap">${d.targets.map((href, i) => `<area shape="rect" coords="${i * 80},0,${i * 80 + 79},39" href="${e(href)}" alt="${href === '/' ? 'Home' : `Related page ${i}`}">`).join('')}</map>` };
R['noscript-only-link'] = { group: 'old-site-navigation', details: p => ({ targets: [firstTarget(p)] }),
  main: d => `<noscript><p class="text-only">Text-only version: <a href="${e(d.targets[0])}">related record</a></p></noscript>` };
R['comment-only-link'] = { group: 'old-site-navigation',
  details: (p, s, v) => ({ links: [{ href: `/old-site/${seedFor(s.seed, p.pageId, 'commented-link') % 100000}.htm`, exists: false, expectedStatus: 404 }, ...(v >= 2 ? [{ href: firstTarget(p), exists: true, expectedStatus: 200 }] : [])], isHyperlink: false }),
  main: d => d.links.map((link, i) => `<!-- <a href="${e(link.href)}">${i ? 'Related record' : 'Previous edition'}</a> -->`).join('') };
R['document-write-menu'] = { group: 'old-site-navigation', script: true, details: (p, s, v) => ({ targets: linkTargets(p, 2 + v), revealedBy: 'document.write' }),
  main: d => `<script type="text/javascript">document.write('<div class="legacy-menu">${d.targets.map((href, i) => `<a href="${href}">${i ? `Related page ${i}` : 'Home page'}<\\/a>`).join(' | ')}<\\/div>');</script><noscript><p>This menu requires JavaScript.</p></noscript>` };
R['dhtml-hover-menu'] = { group: 'old-site-navigation', details: (p, s, v) => ({ targets: linkTargets(p, 2 + v), linksInDom: true, hiddenUntil: 'mouseover' }),
  main: d => `<div class="nav-flyout"><a href="#" onmouseover="document.getElementById('flyout1').style.visibility='visible'" onmouseout="document.getElementById('flyout1').style.visibility='hidden'">More pages</a><div id="flyout1" style="visibility:hidden;position:absolute">${d.targets.map((href, i) => `<a href="${e(href)}">${i ? `Related page ${i}` : 'Home page'}</a>`).join('<br>')}</div></div>` };
R['frameset-navigation'] = { group: 'old-site-navigation',
  details: (p, s) => ({ entry: FRAMESET, resources: [{ path: FRAMESET, kind: 'frameset', contentPage: false }, { path: FRAME_NAV, kind: 'frame-navigation', contentPage: false }], frames: [{ name: 'nav', src: FRAME_NAV }, { name: 'main', src: '/' }], navTargets: navTargets(s), noframesFallback: ['/'] }),
  main: d => `<p class="frames-link"><a href="${e(d.entry)}" target="_top">Frames version</a></p>` };
R['iframe-navigation'] = { group: 'old-site-navigation',
  details: (p, s) => ({ frameSrc: FRAME_NAV, navTargets: navTargets(s), resources: [{ path: FRAME_NAV, kind: 'frame-navigation', contentPage: false }] }),
  main: d => `<iframe class="nav-frame" src="${e(d.frameSrc)}" title="Site navigation" width="200" height="160"></iframe>` };
R['window-open-popup'] = { group: 'old-site-navigation', looseLinks: true,
  details: (p, s, v) => ({ links: [{ href: `javascript:window.open('${firstTarget(p)}','related','width=600,height=400');void(0)`, opens: firstTarget(p), crawlableHref: false }, ...(v >= 2 ? [{ href: '/', opens: '/', crawlableHref: true, target: '_blank' }] : [])] }),
  main: d => d.links.map((link, i) => i ? `<a href="${e(link.href)}" target="_blank" onclick="window.open(this.href,'popup','width=600,height=400');return false;">Open home in a new window</a>` : `<a href="${e(link.href)}">Open related record</a>`).join(' ') };
R['ie-conditional-links'] = { group: 'old-site-navigation',
  details: (p, s) => ({ hiddenInConditionalComment: [{ href: `/old-site/ie-${seedFor(s.seed, p.pageId, 'ie') % 10000}.htm`, condition: 'lt IE 9', expectedStatus: 404 }], visibleOutsideIe: [{ href: firstTarget(p), condition: '!IE' }] }),
  main: d => `<!--[if lt IE 9]><p><a href="${e(d.hiddenInConditionalComment[0].href)}">Upgrade your browser</a></p><![endif]--><!--[if !IE]><!--><p class="modern-only"><a href="${e(d.visibleOutsideIe[0].href)}">Related record</a></p><!--<![endif]-->` };
R['object-embed-fallback'] = { group: 'old-site-navigation',
  details: (p, s, v) => ({ plugins: [{ src: '/assets/navigation.swf', element: 'object', expectedStatus: 404 }, ...(v >= 2 ? [{ src: '/assets/intro.swf', element: 'embed', expectedStatus: 404 }] : [])], fallbackLinks: [firstTarget(p)] }),
  main: d => `<object data="${e(d.plugins[0].src)}" type="application/x-shockwave-flash" width="400" height="40"><param name="movie" value="${e(d.plugins[0].src)}"><p><a href="${e(d.fallbackLinks[0])}">Related record (HTML version)</a></p></object>${d.plugins[1] ? `<embed src="${e(d.plugins[1].src)}" type="application/x-shockwave-flash" width="400" height="40">` : ''}` };
R['svg-links'] = { group: 'old-site-navigation', details: (p, s, v) => ({ links: [{ href: firstTarget(p), attribute: 'xlink:href' }, ...(v >= 2 ? [{ href: '/', attribute: 'href' }] : [])] }),
  main: d => `<svg class="svg-nav" width="320" height="30" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${d.links.map((link, i) => `<a ${link.attribute}="${e(link.href)}"><text x="${i * 160}" y="20">${i ? 'Home' : 'Related record'}</text></a>`).join('')}</svg>` };
R['form-get-navigation'] = { group: 'old-site-navigation',
  details: (p, s) => { const action = navTargets(s)[1] ?? '/'; return { action, method: 'GET', fields: { section: 'related', view: 'all' }, submittedUrl: `${action}?section=related&view=all`, resolvesTo: action }; },
  main: d => `<form method="get" action="${e(d.action)}" class="section-finder"><input type="hidden" name="section" value="related"><input type="hidden" name="view" value="all"><button type="submit">Browse this section</button></form>` };

// ---------- JavaScript-only links
R['location-handlers'] = { group: 'javascript-links',
  details: (p, s, v) => { const t = linkTargets(p, 3); return { handlers: [{ element: 'button', form: "location='…'", href: t[1] ?? t[0] }, ...(v >= 2 ? [{ element: 'span', form: 'location.assign()', href: t[0] }] : []), ...(v >= 3 ? [{ element: 'div', form: 'self.location.replace()', href: '/' }] : [])] }; },
  main: d => d.handlers.map(h => h.element === 'button' ? `<button type="button" onclick="location='${e(h.href)}'">Open related page</button>` : h.element === 'span' ? `<span class="pseudo-link" role="link" tabindex="0" onclick="location.assign('${e(h.href)}')">Continue</span>` : `<div class="tile" onclick="self.location.replace('${e(h.href)}')">Back to the start</div>`).join(' ') };
R['js-string-links'] = { group: 'javascript-links', script: true, details: (p, s, v) => ({ targets: linkTargets(p, 2 + v), onlyInScript: true }),
  main: d => `<script type="text/javascript">var relatedPages = [${d.targets.map(href => `'${href}'`).join(', ')}];\nfunction goRelated(i) { window.location = relatedPages[i]; }</script><p class="js-related"><span onclick="goRelated(0)">Related pages</span></p>` };
R['json-blob-links'] = { group: 'javascript-links', script: true,
  details: (p, s, v) => ({ jsonTargets: linkTargets(p, 3), ...(v >= 2 ? { jsonLdUrls: [`${s.baseUrl}/`, `${s.baseUrl}${p.url}`] } : {}) }),
  main: d => `<script type="application/json" id="nav-config">${JSON.stringify({ menu: d.jsonTargets.map(url => ({ url })) })}</script>${d.jsonLdUrls ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: d.jsonLdUrls.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })) })}</script>` : ''}` };
R['data-attribute-links'] = { group: 'javascript-links',
  details: (p, s, v) => { const t = linkTargets(p, 3); return { links: [{ attribute: 'data-href', element: 'span', href: t[1] ?? t[0] }, { attribute: 'data-url', element: 'a', href: t[0], anchorWithoutHref: true }, ...(v >= 3 ? [{ attribute: 'data-link', element: 'li', href: t[2] ?? t[0] }] : [])] }; },
  main: d => d.links.map(l => l.element === 'span' ? `<span class="clickable" data-href="${e(l.href)}" onclick="window.location=this.getAttribute('data-href')">Related record</span>` : l.element === 'a' ? `<a class="js-link" data-url="${e(l.href)}">More pages</a>` : `<ul class="js-list"><li data-link="${e(l.href)}">Listing</li></ul>`).join(' ') };
R['js-redirect-page'] = { group: 'javascript-links', details: p => ({ href: `${JUMP_PATH}?to=${encodeURIComponent(firstTarget(p))}`, status: 200, mechanism: 'window.location.replace', redirectTo: firstTarget(p), htmlFallback: false }),
  main: d => `<p class="jump-link"><a href="${e(d.href)}">Related page (script redirect)</a></p>` };
R['meta-refresh-link'] = { group: 'javascript-links', details: p => { const t = firstTarget(p); return { href: redirectHref(t), status: 200, refreshDelaySeconds: 0, refreshTo: t }; },
  main: d => `<p class="moved-link"><a href="${e(d.href)}">Related page (moved)</a></p>` };
R['meta-refresh-delayed'] = { group: 'javascript-links', details: p => { const t = firstTarget(p); return { href: redirectHref(t, 5), status: 200, refreshDelaySeconds: 5, refreshTo: t }; },
  main: d => `<p class="moved-link-slow"><a href="${e(d.href)}">Related page (moved, redirects after 5 seconds)</a></p>` };
R['noscript-meta-refresh'] = { group: 'javascript-links', details: p => ({ href: `${NOJS_PATH}?url=${encodeURIComponent(firstTarget(p))}`, status: 200, refreshTo: firstTarget(p), refreshOnlyWithoutScript: true }),
  main: d => `<p class="basic-link"><a href="${e(d.href)}">Basic HTML version</a></p>` };
R['shadow-dom-links'] = { group: 'javascript-links', details: p => ({ targets: [firstTarget(p)], declarativeShadowRoot: 'open' }),
  main: d => `<div class="related-host"><template shadowrootmode="open"><nav><a href="${e(d.targets[0])}">Related record</a></nav><slot></slot></template><p>Related links</p></div>` };
R['web-component-slots'] = { group: 'javascript-links', script: true, details: p => ({ slotted: [firstTarget(p)], shadowOnly: ['/'], element: 'related-links' }),
  main: d => `<related-links><a slot="item" href="${e(d.slotted[0])}">Related record</a></related-links><script>if (!customElements.get('related-links')) customElements.define('related-links', class extends HTMLElement { connectedCallback() { if (this.shadowRoot) return; this.attachShadow({ mode: 'open' }).innerHTML = '<ul><li><slot name="item"></slot></li><li><a href="${d.shadowOnly[0]}">Home</a></li></ul>'; } });</script>` };
R['lazy-load-noscript'] = { group: 'javascript-links', looseLinks: true,
  details: (p, s, v) => ({ images: [{ placeholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', realSrc: '/assets/collection.png', attribute: 'data-src', noscriptFallback: true }, ...(v >= 2 ? [{ realSrc: '/assets/collection.png', attribute: 'data-bg', noscriptFallback: false }] : [])] }),
  main: d => `<img class="lazy" src="${e(d.images[0].placeholder)}" data-src="${e(d.images[0].realSrc)}" alt="Collection highlight" width="120" height="80"><noscript><img src="${e(d.images[0].realSrc)}" alt="Collection highlight"></noscript>${d.images[1] ? `<div class="lazy-bg" data-bg="${e(d.images[1].realSrc)}"></div>` : ''}` };
R['load-more-pagination'] = { group: 'javascript-links', script: true,
  details: () => ({ entry: `${LIST_PATH}?offset=${LIST.first}`, pattern: `${LIST_PATH}?offset=N (N = 10…200, step 10)`, attribute: 'data-next-url', reachableUrls: (LIST.last - LIST.first) / LIST.step + 1, contentPages: 0, beyondLastStatus: 200, beyondLastBehaviour: 'empty list' }),
  main: d => `<div class="results" data-next-url="${e(d.entry)}"><button type="button" class="load-more" data-next-url="${e(d.entry)}">Load more</button></div><script>document.querySelectorAll('.load-more').forEach(function (button) { button.addEventListener('click', function () { fetch(button.getAttribute('data-next-url')).then(function (r) { return r.text(); }).then(function (html) { button.insertAdjacentHTML('beforebegin', html); }); }); });</script>` };
// Infinite scroll that rewrites the address bar (history.pushState) as the reader scrolls; the ?page=N addresses are
// served as this same listing, so they add URLs but no content (Sitebulb's "infinite-scroll-url-updates" case, 2026-11-02).
R['pushstate-infinite-scroll'] = { group: 'javascript-links', script: true, eligible: p => p.kind === 'listing',
  details: (p, s, v) => ({ pushStateUrls: Array.from({ length: 1 + v }, (_, i) => `${p.url}?page=${i + 2}`), servedAs: p.url, status: 200, trigger: 'scroll (IntersectionObserver)', contentPagesAdded: 0, linkedInMarkup: false }),
  main: d => `<div class="scroll-sentinel" data-pages="${e(d.pushStateUrls.join(' '))}" aria-hidden="true"></div><script>(function () { var sentinel = document.querySelector('.scroll-sentinel'); if (!sentinel || !('IntersectionObserver' in window)) return; var pages = sentinel.getAttribute('data-pages').split(' '); new IntersectionObserver(function (entries) { if (entries[0].isIntersecting && pages.length) history.pushState(null, '', pages.shift()); }).observe(sentinel); })();</script>` };

// ---------- URL duplication
R['session-id-urls'] = { group: 'url-duplication', server: true,
  details: (p, s, v) => ({ aliases: [
    alias(`${p.url};jsessionid=${token(s.seed, p.pageId, 'jsessionid', 32, HEX)}`, 'jsessionid-path-parameter', p),
    ...(v >= 2 ? [alias(`${p.url}?PHPSESSID=${token(s.seed, p.pageId, 'phpsessid', 26, '0123456789abcdefghijklmnopqrstuv')}`, 'phpsessid-query', p)] : []),
    ...(v >= 3 ? [alias(`/(S(${token(s.seed, p.pageId, 'aspnet-session', 24, ALNUM)}))${p.url}`, 'aspnet-cookieless-path', p)] : []),
  ], sessionTokensVaryByPage: true }),
  main: d => `<p class="session-links">${d.aliases.map((a, i) => `<a href="${e(a.href)}">${i ? `Bookmark this record (${i + 1})` : 'Bookmark this record'}</a>`).join(' | ')}</p>` };
R['duplicate-url-aliases'] = { group: 'url-duplication', server: true,
  details: (p, s, v) => ({ aliases: uniqueAliases(p, [
    alias(`${p.url}index.html`, 'index-file', p),
    ...(v >= 2 ? [alias(p.url.toUpperCase(), 'case-variant', p), alias(p.url.replace(/\/$/, ''), 'missing-trailing-slash', p, 308)] : []),
    ...(v >= 3 ? [alias(percentEncodeHyphen(p.url), 'percent-encoded', p), alias(doubleSlash(p.url), 'double-slash', p)] : []),
  ]) }),
  main: d => `<p class="record-permalinks">${d.aliases.map((a, i) => `<a href="${e(a.href)}">${['Permanent link', 'Printable version', 'Archive copy', 'Cited link', 'Mirror link'][i] ?? 'Alternate link'}</a>`).join(' · ')}</p>` };
const aliasList = cls => d => `<p class="${cls}">${d.aliases.map((a, i) => `<a href="${e(a.href)}">Alternate view ${i + 1}</a>`).join(' | ')}</p>`;
R['tracking-params'] = { group: 'url-duplication',
  details: (p, s, v) => ({ aliases: [alias(`${p.url}?utm_source=newsletter&utm_medium=email&utm_campaign=spring-${seedFor(s.seed, p.pageId, 'utm') % 100}`, 'utm', p), ...(v >= 2 ? [alias(`${p.url}?fbclid=IwAR${token(s.seed, p.pageId, 'fbclid', 24, ALNUM)}`, 'fbclid', p)] : []), ...(v >= 3 ? [alias(`${p.url}?gclid=Cj0K${token(s.seed, p.pageId, 'gclid', 20, ALNUM)}`, 'gclid', p)] : [])] }),
  main: aliasList('share-links') };
R['print-duplicates'] = { group: 'url-duplication', details: (p, s, v) => ({ aliases: [alias(`${p.url}?print=1`, 'print-query', p), ...(v >= 2 ? [alias(`${p.url}?format=print&lang=en`, 'print-format', p)] : [])] }),
  main: d => `<p class="print-links">${d.aliases.map((a, i) => `<a href="${e(a.href)}">${i ? 'Print (large type)' : 'Printer-friendly version'}</a>`).join(' | ')}</p>` };
R['mobile-duplicates'] = { group: 'url-duplication', server: true, details: (p, s, v) => ({ aliases: [alias(`/m${p.url}`, 'mobile-path-prefix', p), ...(v >= 2 ? [alias(`${p.url}?mobile=1`, 'mobile-query', p)] : [])] }),
  main: d => `<p class="mobile-links">${d.aliases.map((a, i) => `<a href="${e(a.href)}">${i ? 'Mobile view' : 'Mobile site'}</a>`).join(' | ')}</p>` };
R['faceted-navigation'] = { group: 'url-duplication',
  details: (p, s, v) => { const dimensions = [['color', ['red', 'blue', 'green']], ['size', ['s', 'm', 'l']], ...(v >= 2 ? [['sort', ['asc', 'desc']]] : [])]; const variants = facetVariants(p.url, dimensions); return { base: p.url, parameters: Object.fromEntries(dimensions), variants, variantCount: variants.length, servedAs: p.url, declaredCanonical: p.url }; },
  main: d => `<div class="filters"><h2>Refine</h2><ul>${d.variants.map(href => `<li><a href="${e(href)}">${e(href.split('?')[1].replaceAll('&', ', '))}</a></li>`).join('')}</ul></div>` };
R['sort-order-params'] = { group: 'url-duplication',
  details: (p, s, v) => ({ aliases: [alias(`${p.url}?sort=title&order=asc`, 'sort', p), alias(`${p.url}?sort=date&order=desc`, 'sort', p), ...(v >= 2 ? [alias(`${p.url}?orderby=date&dir=asc`, 'orderby', p)] : []), ...(v >= 3 ? [alias(`${p.url}?order=asc&sort=title`, 'reordered-parameters', p)] : [])] }),
  main: aliasList('sort-links') };
R['default-document-aliases'] = { group: 'url-duplication', server: true,
  details: (p, s, v) => ({ aliases: DEFAULT_DOCUMENTS.slice(0, 1 + v + (v >= 3 ? 1 : 0)).map(name => alias(`${p.url}${name}`, 'default-document', p)) }),
  main: aliasList('doc-links') };
R['mixed-case-extensions'] = { group: 'url-duplication', server: true,
  details: (p, s, v) => ({ aliases: ['INDEX.HTM', 'Index.Html', 'index.HTML'].slice(0, v).map(name => alias(`${p.url}${name}`, 'mixed-case-extension', p)) }),
  main: aliasList('ext-links') };
R['dot-segment-urls'] = { group: 'url-duplication', eligible: notRoot,
  details: (p, s, v) => { const parts = p.url.split('/').filter(Boolean); const last = parts.at(-1); const dir = `/${parts.slice(0, -1).join('/')}${parts.length > 1 ? '/' : ''}`; return { links: [{ href: `${dir}./${last}/`, resolvesTo: p.url, rawRequestStatus: 200 }, ...(v >= 2 ? [{ href: `${p.url}../${last}/`, resolvesTo: p.url, rawRequestStatus: 200 }] : []), ...(v >= 3 ? [{ href: `${p.url}#top`, resolvesTo: p.url, fragment: true }] : [])], normalization: 'WHATWG URL parser removes dot segments' }; },
  main: d => `<p class="dot-links">${d.links.map((l, i) => `<a href="${e(l.href)}">Same record ${i + 1}</a>`).join(' ')}</p>` };
R['relative-climb-links'] = { group: 'url-duplication', looseLinks: true,
  details: (p, s, v) => { const t = firstTarget(p); return { links: [{ href: `${'../'.repeat(6)}${t.slice(1)}`, resolvesTo: t }, ...(v >= 2 ? [{ href: `./${'../'.repeat(4)}./${t.slice(1)}`, resolvesTo: t }] : [])], climbsAboveRoot: true }; },
  main: d => `<p class="climb-links">${d.links.map((l, i) => `<a href="${e(l.href)}">Related record${i ? ' (alternate path)' : ''}</a>`).join(' ')}</p>` };
R['backslash-urls'] = { group: 'url-duplication', looseLinks: true,
  details: (p, s, v) => { const t = firstTarget(p); return { links: [{ href: t.replaceAll('/', '\\'), resolvesTo: t, rawRequestStatus: 400, note: 'literal request target is not origin-form' }, ...(v >= 2 && t.length > 1 ? [{ href: `${t.slice(0, -1).replace(/\/(?=[^/]*$)/, '\\')}/`, resolvesTo: t, rawRequestStatus: 404 }] : [])], normalization: 'WHATWG treats \\ as / for http(s)' }; },
  main: d => `<p class="win-links">${d.links.map((l, i) => `<a href="${e(l.href)}">Related record ${i + 1}</a>`).join(' ')}</p>` };
R['protocol-relative-links'] = { group: 'url-duplication', looseLinks: true,
  details: (p, s) => { const t = firstTarget(p); return { links: [{ href: `//${new URL(s.baseUrl).host}${t}`, resolvesTo: t, sameHost: true }] }; },
  main: d => `<p class="pr-links"><a href="${e(d.links[0].href)}">Related record</a></p>` };
R['cross-scheme-links'] = { group: 'url-duplication', looseLinks: true,
  details: (p, s, v) => { const t = firstTarget(p); const url = new URL(s.baseUrl); const other = url.protocol === 'http:' ? 'https:' : 'http:'; return { links: [{ href: `${other}//${url.host}${t}`, resolvesTo: t, scheme: other.slice(0, -1), previewReachable: false }, ...(v >= 2 ? [{ href: `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'http:' ? 80 : 443)}${t}`, resolvesTo: t, explicitDefaultPort: !url.port }] : [])] }; },
  main: d => `<p class="scheme-links">${d.links.map((l, i) => `<a href="${e(l.href)}">${i ? 'Related record (port)' : 'Secure version'}</a>`).join(' ')}</p>` };
R['base-href-traps'] = { group: 'url-duplication', looseLinks: true, eligible: noBaseRewrite,
  details: (p, s, v) => ({ bases: [`${s.baseUrl}/intl/`, ...(v >= 2 ? ['http://mirror.siteforge.invalid/'] : [])], effectiveBase: '/intl/', laterBasesIgnored: v >= 2, relativeLinks: [{ href: 'contact/', resolvesTo: '/intl/contact/', status: 404 }], fragmentLinksAffected: true }),
  main: d => `<p class="contact-link"><a href="${e(d.relativeLinks[0].href)}">Contact the archive</a></p>`,
  mutateHead: (head, d, site, h) => { for (const href of [...d.bases].reverse()) h.prepend(head, `<base href="${e(href)}">`); } };
R['duplicate-section-content'] = { group: 'url-duplication', eligible: notRoot,
  details: p => ({ copy: { path: copyPath('', p.url), kind: 'exact-copy', duplicateOf: p.url, contentPage: false, expectedStatus: 200 } }),
  main: d => `<p class="copy-link"><a href="${e(d.copy.path)}">Archived copy</a></p>` };
R['near-duplicate-dated'] = { group: 'url-duplication', eligible: notRoot,
  details: (p, s) => { const date = editionDate(s.seed, p.pageId); return { copy: { path: copyPath(`/${date}`, p.url), kind: 'near-duplicate', duplicateOf: p.url, differsBy: `edition line "Edition of ${date}"`, date, contentPage: false, expectedStatus: 200 } }; },
  main: d => `<p class="edition-link"><a href="${e(d.copy.path)}">Edition of ${e(d.copy.date)}</a></p>` };
R['pagination-query-variants'] = { group: 'url-duplication',
  details: (p, s, v) => ({ variants: [{ href: `${p.url}?page=1`, servedAs: p.url, kind: 'first-page' }, { href: `${p.url}?page=2`, servedAs: p.url, kind: 'next-page' }, { href: `${p.url}?page=999`, servedAs: p.url, kind: 'beyond-last', status: 200 }, ...(v >= 2 ? [{ href: `${p.url}?p=2&start=24`, servedAs: p.url, kind: 'offset-page' }] : [])], ...(v >= 2 ? { relNext: `${p.url}?page=2` } : {}) }),
  main: d => `<p class="pager">${d.variants.map(item => `<a href="${e(item.href)}">${item.kind === 'beyond-last' ? 'Last' : item.kind === 'first-page' ? '1' : '2'}</a>`).join(' ')}</p>`,
  head: d => d.relNext ? `<link rel="next" href="${e(d.relNext)}">` : '' };
R['long-url-links'] = { group: 'url-duplication',
  details: (p, s) => { const href = `${p.url}?ref=${token(s.seed, p.pageId, 'long-url', 2100, ALNUM)}`; return { links: [{ href, length: href.length, resolvesTo: p.url, status: 200 }] }; },
  main: d => `<p class="ref-link"><a href="${e(d.links[0].href)}">Reference link</a></p>` };

// ---------- infinite URL spaces
R['calendar-trap'] = { group: 'infinite-spaces', server: true,
  details: (p, s) => ({ entry: calendarEntry(s.seed), pattern: `${CALENDAR_PATH}?month=YYYY-MM[&view=list]`, range: { ...CALENDAR_RANGE }, reachableUrls: (CALENDAR_LAST - CALENDAR_FIRST + 1) * CALENDAR_VIEWS.length, contentPages: 0, outsideRangeStatus: 404 }),
  main: d => `<p class="events-calendar-link"><a href="${e(d.entry)}">Events calendar</a></p>` };
R['day-calendar-trap'] = { group: 'infinite-spaces', server: true,
  details: (p, s) => ({ entry: `${CALENDAR_PATH}?date=${dayKey(DAY_FIRST + seedFor(s.seed, 'day-entry') % (DAY_LAST - DAY_FIRST + 1))}`, pattern: `${CALENDAR_PATH}?date=YYYY-MM-DD`, range: { ...DAY_RANGE }, reachableUrls: DAY_LAST - DAY_FIRST + 1, contentPages: 0, outsideRangeStatus: 404 }),
  main: d => `<p class="day-link"><a href="${e(d.entry)}">What's on today</a></p>` };
R['path-info-trap'] = { group: 'infinite-spaces', server: true,
  details: () => ({ entry: PATH_INFO_ENTRY, pattern: `${PATH_INFO_ENTRY}{media|print}/…`, relativeLinks: PATH_INFO_STEPS.map(step => `${step}/`), maxSegments: PATH_INFO_MAX_SEGMENTS, reachableUrls: 2 ** PATH_INFO_MAX_SEGMENTS - 1, contentPages: 0, beyondLimitStatus: 404 }),
  main: d => `<p class="archive-browser-link"><a href="${e(d.entry)}">Browse the archive</a></p>` };
R['date-archive-trap'] = { group: 'infinite-spaces', server: true,
  details: () => ({ entry: `${ARCHIVE_ROOT}${ARCHIVE_YEARS[0]}/`, pattern: `${ARCHIVE_ROOT}YYYY/[MM/[DD/]]`, years: [...ARCHIVE_YEARS], reachableUrls: ARCHIVE_YEARS.length * 13 + archiveDays, contentPages: 0, outsideRangeStatus: 404 }),
  main: d => `<p class="date-archive-link"><a href="${e(d.entry)}">Archive by date</a></p>` };
R['search-tag-cloud'] = { group: 'infinite-spaces', server: true,
  details: (p, s, v) => { const words = [...new Set(String(p.title).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 3))]; const terms = (words.length ? words : ['archive']).slice(0, 1 + v); return { terms, links: terms.map(term => `${SEARCH_PATH}?q=${queryEncode(term)}`), pagesPerQuery: SEARCH_PAGES, reachableUrls: terms.length * SEARCH_PAGES, contentPages: 0, beyondLastStatus: 200 }; },
  main: d => `<p class="tag-cloud">Tags: ${d.links.map((href, i) => `<a href="${e(href)}">${e(d.terms[i])}</a>`).join(' ')}</p>` };
R['login-wall-links'] = { group: 'infinite-spaces', server: true,
  details: p => ({ href: `${LOGIN_PATH}?next=${encodeURIComponent(p.url)}`, status: 200, wall: 'login form', nestedNextLinks: true, maxDepth: LOGIN_MAX_DEPTH, reachableUrls: LOGIN_MAX_DEPTH + 1, contentPages: 0 }),
  main: d => `<p class="signin-link"><a href="${e(d.href)}">Sign in to save this record</a></p>` };

// ---------- indexing signals
const setCanonical = (head, href, h) => h.setCanonical(head, href);
R['misleading-canonical'] = { group: 'indexing-signals', semantic: false, eligible: notRoot,
  details: (p, s, v) => ({ declaredCanonical: '/', ...(v >= 2 ? { declaredOgUrl: `${p.url}?view=print` } : {}), trueUrl: p.url }),
  head: (d, p, s) => d.declaredOgUrl ? `<meta property="og:url" content="${e(`${s.baseUrl}${d.declaredOgUrl}`)}">` : '',
  mutateHead: (head, d, s, h) => setCanonical(head, `${s.baseUrl}${d.declaredCanonical}`, h) };
R['canonical-chain'] = { group: 'indexing-signals', semantic: false, server: true, eligible: notRoot,
  details: p => { const hop = n => `${CANONICAL_PATH}?hop=${n}&url=${encodeURIComponent(p.url)}`; return { chain: [hop(1), hop(2), p.url], declaredCanonical: hop(1), finalCanonical: p.url, trueUrl: p.url, hopDocuments: 'copies of this page with the next canonical' }; },
  mutateHead: (head, d, s, h) => setCanonical(head, `${s.baseUrl}${d.declaredCanonical}`, h) };
R['canonical-to-404'] = { group: 'indexing-signals', semantic: false, eligible: notRoot,
  details: (p, s) => ({ declaredCanonical: `/old-site/gone-${seedFor(s.seed, p.pageId, 'gone') % 100000}.htm`, canonicalStatus: 404, trueUrl: p.url }),
  mutateHead: (head, d, s, h) => setCanonical(head, `${s.baseUrl}${d.declaredCanonical}`, h) };
R['canonical-cross-host'] = { group: 'indexing-signals', semantic: false, eligible: notRoot,
  details: p => ({ declaredCanonical: `https://www.archive-mirror.siteforge.invalid${p.url}`, differentHost: true, differentScheme: true, trueUrl: p.url }),
  mutateHead: (head, d, s, h) => setCanonical(head, d.declaredCanonical, h) };
R['multiple-canonical'] = { group: 'indexing-signals', semantic: false, eligible: notRoot,
  details: (p, s, v) => ({ canonicals: [p.url, v >= 2 ? '/' : `${p.url}?view=all`], conflicting: true, trueUrl: p.url }),
  head: (d, p, s) => `<link rel="canonical" href="${e(`${s.baseUrl}${d.canonicals[1]}`)}">` };
R['social-url-conflicts'] = { group: 'indexing-signals', semantic: false,
  details: (p, s, v) => ({ ogUrl: `${p.url}?share=facebook`, twitterUrl: `${p.url}index.html`, ...(v >= 3 ? { itempropUrl: '/' } : {}), trueUrl: p.url }),
  head: (d, p, s) => `<meta property="og:url" content="${e(s.baseUrl + d.ogUrl)}"><meta name="twitter:url" content="${e(s.baseUrl + d.twitterUrl)}">${d.itempropUrl ? `<meta itemprop="url" content="${e(s.baseUrl + d.itempropUrl)}">` : ''}` };
R['hreflang-alternates'] = { group: 'indexing-signals',
  details: (p, s, v) => ({ alternates: [{ hreflang: 'en', href: p.url, status: 200 }, { hreflang: 'x-default', href: '/', status: 200 }, { hreflang: 'fr', href: `/intl/fr${p.url}`, status: 404 }, ...(v >= 2 ? [{ hreflang: 'de', href: `/intl/de${p.url}`, status: 404 }] : [])], absolute: true, origin: s.baseUrl }),
  head: (d, p, s) => d.alternates.map(item => `<link rel="alternate" hreflang="${e(item.hreflang)}" href="${e(`${s.baseUrl}${item.href}`)}">`).join('') };
R['hreflang-cross-page'] = { group: 'indexing-signals',
  details: p => ({ alternates: [{ hreflang: 'en', href: p.url }, { hreflang: 'es', href: firstTarget(p), targetLanguage: 'en', declaredLanguageWrong: true }], returnLinkGuaranteed: false }),
  head: (d, p, s) => d.alternates.map(item => `<link rel="alternate" hreflang="${item.hreflang}" href="${e(`${s.baseUrl}${item.href}`)}">`).join('') };
R['robots-noindex'] = { group: 'indexing-signals', semantic: false, details: (p, s, v) => ({ robots: v >= 3 ? 'noindex, nofollow' : 'noindex, follow', source: 'meta' }),
  head: d => `<meta name="robots" content="${e(d.robots)}">` };
R['meta-robots-variants'] = { group: 'indexing-signals', semantic: false,
  details: (p, s, v) => ({ metas: [{ name: 'robots', content: 'noarchive, nosnippet, max-image-preview:none' }, ...(v >= 2 ? [{ name: 'googlebot', content: 'noindex' }] : []), ...(v >= 3 ? [{ name: 'robots', content: 'none' }] : [])] }),
  head: d => d.metas.map(meta => `<meta name="${meta.name}" content="${e(meta.content)}">`).join('') };
R['rel-nofollow-links'] = { group: 'indexing-signals',
  details: (p, s, v) => { const t = linkTargets(p, 3); return { links: [{ href: t[0], rel: 'nofollow' }, ...(v >= 2 ? [{ href: t[1] ?? t[0], rel: 'ugc' }] : []), ...(v >= 3 ? [{ href: t[2] ?? t[0], rel: 'sponsored noopener', target: '_blank' }] : [])] }; },
  main: d => `<p class="rel-links">${d.links.map((l, i) => `<a href="${e(l.href)}" rel="${l.rel}"${l.target ? ` target="${l.target}"` : ''}>Linked page ${i + 1}</a>`).join(' ')}</p>` };
R['rel-link-hints'] = { group: 'indexing-signals',
  details: (p, s, v) => ({ hints: [{ rel: 'prefetch', href: firstTarget(p), status: 200 }, { rel: 'next', href: `${p.url}?page=2`, status: 200 }, { rel: 'prev', href: `${p.url}?page=0`, status: 200 }, ...(v >= 2 ? [{ rel: 'preload', href: '/assets/site.css', as: 'style', status: 200 }, { rel: 'alternate', type: 'application/rss+xml', href: '/feeds/missing.rss', status: 404 }] : [])] }),
  head: d => d.hints.map(h => `<link rel="${h.rel}" href="${e(h.href)}"${h.as ? ` as="${h.as}"` : ''}${h.type ? ` type="${h.type}"` : ''}>`).join('') };
R['feed-links'] = { group: 'indexing-signals', details: () => ({ feed: FEED, resources: [{ path: FEED, kind: 'rss', contentPage: false }], items: 'first five detail pages in inventory order, absolute source-origin URLs' }),
  head: d => `<link rel="alternate" type="application/rss+xml" title="News feed" href="${e(d.feed)}">`, main: d => `<p class="feed-link"><a href="${e(d.feed)}">RSS</a></p>` };
const robotsText = baseUrl => `User-agent: *\nDisallow: /cgi-bin/\nAllow: /cgi-bin/calendar.pl\nDisallow: /*?print=\nDisallow: /*.pdf$\nDisallow: /old-site/\nCrawl-delay: 5\n\nUser-agent: Googlebot\nDisallow:\n\nSitemap: ${baseUrl}/sitemap.xml\nSitemap: ${WRONG_HOST}/sitemap.xml\n`;
R['robots-txt-traps'] = { group: 'indexing-signals', eligible: homeOnly, resourceOnly: true,
  details: (p, s) => ({ path: '/robots.txt', content: robotsText(s.baseUrl), crawlDelaySeconds: 5, sitemaps: [`${s.baseUrl}/sitemap.xml`, `${WRONG_HOST}/sitemap.xml`],
    expectations: [{ path: '/cgi-bin/browse.pl/archive/', allowed: false }, { path: calendarEntry(s.seed), allowed: true, reason: 'longer Allow wins' }, { path: '/books/?print=1', allowed: false, reason: 'wildcard' }, { path: '/old-site/index.htm', allowed: false }, { path: '/', allowed: true }, { path: '/cgi-bin/browse.pl/archive/', allowed: true, userAgent: 'Googlebot' }] }) };
R['sitemap-traps'] = { group: 'indexing-signals', eligible: homeOnly,
  details: (p, s) => ({ index: '/sitemap-index.xml', resources: [{ path: '/sitemap-index.xml', kind: 'sitemapindex' }, { path: '/sitemap-pages.xml', kind: 'urlset' }, { path: '/sitemap-nested-index.xml', kind: 'nested sitemapindex (invalid by protocol)' }, { path: '/sitemap-legacy.xml.gz', kind: 'gzip urlset' }],
    entries: [{ loc: `${s.baseUrl}/`, expectedStatus: 200 }, { loc: `${s.baseUrl}/old-site/removed-page.htm`, expectedStatus: 404 }, { loc: `${s.baseUrl}${(navTargets(s)[1] ?? '/').replace(/\/$/, '') || '/'}`, expectedStatus: (navTargets(s)[1] ?? '/') === '/' ? 200 : 308 }, { loc: `${s.baseUrl}/#top`, fragment: true, expectedStatus: 200 }, { loc: `${WRONG_HOST}/`, wrongHost: true }], gzipEntries: [`${s.baseUrl}/`] }),
  head: d => `<link rel="sitemap" type="application/xml" href="${e(d.index)}">` };
// A second <title> in the head: crawlers that keep the last title, or concatenate them, record the wrong page title.
R['title-anomalies'] = { group: 'indexing-signals', semantic: false, eligible: notRoot,
  details: (p, s, v) => ({ extraTitles: ['Untitled Document', ...(v >= 2 ? ['Home'] : [])], position: 'after the real title', trueTitleSource: 'first <title> and the page heading' }),
  head: d => d.extraTitles.map(title => `<title>${e(title)}</title>`).join('') };
// Structured data that contradicts the visible page: a JSON-LD name and date that differ from the rendered fields.
R['structured-data-conflict'] = { group: 'indexing-signals', semantic: false, script: true,
  details: (p, s, v) => ({ format: 'application/ld+json', declared: { name: 'Untitled record', ...(v >= 2 ? { datePublished: '1999-01-01' } : {}), ...(v >= 3 ? { url: `${p.url}?view=print` } : {}) }, trueValuesSource: 'page fields' }),
  head: (d, p, s) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'CreativeWork', ...d.declared, ...(d.declared.url ? { url: `${s.baseUrl}${d.declared.url}` } : {}) }).replace(/</g, '\\u003c')}</script>` };

// ---------- server behaviour & gates
R['cookie-consent-wall'] = { group: 'server-behaviour',
  details: (p, s) => ({ overlay: 'div.consent-overlay[role=dialog]', contentInDom: true, dismissedBy: 'click (sets consent=1 cookie)', links: [{ href: `/old-site/privacy-${seedFor(s.seed, 'privacy') % 1000}.htm`, expectedStatus: 404 }] }),
  main: d => `<div class="consent-overlay" role="dialog" aria-modal="true" aria-label="Cookie consent" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.88);color:#fff;z-index:9999;padding:4em"><p>This site uses cookies. Accept to continue reading.</p><button type="button" onclick="document.cookie='consent=1; path=/';this.parentNode.style.display='none'">Accept</button> <a style="color:#fff" href="${e(d.links[0].href)}">Privacy policy</a></div>` };
R['age-gate'] = { group: 'server-behaviour', looseLinks: true,
  details: p => ({ confirmHref: `${p.url}?age_verified=1`, resolvesTo: p.url, exitHref: 'https://www.example.invalid/', contentInDom: true, interstitial: 'div.age-check[role=dialog]' }),
  main: d => `<div class="age-check" role="dialog" aria-modal="true" aria-label="Age check" style="position:fixed;top:0;left:0;right:0;bottom:0;background:#fff;z-index:9998;padding:4em"><p>You must be 18 or older to view this collection.</p><a href="${e(d.confirmHref)}">I am 18 or older</a> <a href="${e(d.exitHref)}">Leave</a></div>` };

// ---------- encoding & URL syntax
R['charset-conflict'] = { group: 'encoding-and-markup', semantic: false,
  details: (p, s, v) => ({ httpCharset: 'utf-8', declaredCharset: 'iso-8859-1', byteOrderMark: v >= 2, effectiveEncoding: 'utf-8' }),
  mutateHead: (head, d, s, h) => { h.removeCharset(head); h.prepend(head, `<meta http-equiv="Content-Type" content="text/html; charset=${d.declaredCharset}">`); },
  post: (html, d) => d.byteOrderMark ? `\uFEFF${html}` : html };
const PRESS = ['/old-site/press-1998.htm', '/old-site/press-1999.htm'];
R['windows-1252-documents'] = { group: 'encoding-and-markup',
  details: () => ({ resources: [{ path: PRESS[0], bytes: 'windows-1252', declared: 'windows-1252', httpCharset: null, expectedText: SMART_TEXT, decodesCorrectly: true, contentPage: false }, { path: PRESS[1], bytes: 'windows-1252', declared: 'utf-8', httpCharset: null, expectedText: SMART_TEXT, decodesCorrectly: false, contentPage: false }] }),
  main: d => `<p class="press-links"><a href="${e(d.resources[0].path)}">Press release (1998)</a> | <a href="${e(d.resources[1].path)}">Press release (1999)</a></p>` };
const UTF16 = '/old-site/notice-utf16.htm';
R['utf16-document'] = { group: 'encoding-and-markup', details: () => ({ resources: [{ path: UTF16, bytes: 'utf-16le', byteOrderMark: true, declared: 'utf-16', expectedText: 'Notice: reading room hours changed.', contentPage: false }] }),
  main: d => `<p class="notice-link"><a href="${e(d.resources[0].path)}">Reading room notice</a></p>` };
const SPACED = ['/old-site/Annual Report 2004.htm', '/old-site/caf\u00e9-men\u00fc.htm'];
R['space-unicode-urls'] = { group: 'encoding-and-markup', looseLinks: true,
  details: () => ({ resources: SPACED.map(path => ({ path, hrefs: [path, encodeURI(path)], expectedStatus: 200, contentPage: false })) }),
  main: d => `<p class="report-links">${d.resources.flatMap(r => r.hrefs.map((href, i) => `<a href="${e(href)}">${i ? 'Encoded link' : 'Raw link'}</a>`)).join(' ')}</p>` };
R['entity-encoded-hrefs'] = { group: 'encoding-and-markup', looseLinks: true,
  details: (p, s, v) => { const t = firstTarget(p); return { links: [{ raw: t.replaceAll('/', '&#47;'), resolvesTo: t }, { raw: `${t}?a=1&amp;b=2`, resolvesTo: t, decodedQuery: 'a=1&b=2' }, ...(v >= 2 ? [{ raw: t.replaceAll('/', '&#x2F;'), resolvesTo: t }] : [])] }; },
  raw: d => `<p class="entity-links">${d.links.map((l, i) => `<a href="${l.raw}">Related record ${i + 1}</a>`).join(' ')}</p>` };
R['whitespace-hrefs'] = { group: 'encoding-and-markup', looseLinks: true,
  details: (p, s, v) => { const t = firstTarget(p); const mid = Math.max(1, Math.floor(t.length / 2)); return { links: [{ href: `  ${t}  `, resolvesTo: t }, { href: `\n${t}\n`, resolvesTo: t }, ...(v >= 2 ? [{ href: `${t.slice(0, mid)}\t${t.slice(mid)}`, resolvesTo: t, note: 'tab removed by URL parser' }] : [])] }; },
  main: d => `<p class="ws-links">${d.links.map((l, i) => `<a href="${e(l.href)}">Related record ${i + 1}</a>`).join(' ')}</p>` };
R['non-http-schemes'] = { group: 'encoding-and-markup', looseLinks: true,
  details: (p, s, v) => ({ links: [{ href: 'mailto:archive@example.invalid?subject=Record%20enquiry', scheme: 'mailto' }, { href: 'tel:+15550142200', scheme: 'tel' }, ...(v >= 2 ? [{ href: 'sms:+15550142200', scheme: 'sms' }, { href: 'ftp://ftp.example.invalid/pub/records.txt', scheme: 'ftp' }] : []), ...(v >= 3 ? [{ href: 'file:///C:/Archive/record.doc', scheme: 'file' }, { href: 'data:text/html,%3Cp%3EInline%3C%2Fp%3E', scheme: 'data' }] : [])].map(link => ({ ...link, crawlable: false })) }),
  main: d => `<p class="contact-schemes">${d.links.map(l => `<a href="${e(l.href)}">${l.scheme}</a>`).join(' | ')}</p>` };
R['css-links'] = { group: 'encoding-and-markup',
  details: p => ({ imports: [{ href: '/assets/legacy-print.css', expectedStatus: 404 }], urls: [{ href: '/assets/collection.png', context: 'background-image', expectedStatus: 200 }, { href: firstTarget(p), context: 'inline style background (an HTML page)', expectedStatus: 200 }, { href: '/assets/csshover.htc', context: 'IE behavior', expectedStatus: 404 }] }),
  main: d => `<style>@import url("${d.imports[0].href}"); .record-banner { background-image: url("${d.urls[0].href}"); } .nav-flyout a { behavior: url("${d.urls[2].href}"); }</style><div class="record-banner" style="background: url('${e(d.urls[1].href)}') no-repeat"></div>` };
// A right-to-left notice (Arabic or Hebrew) inside the page: mixed-direction text that is not part of any field.
R['rtl-content-block'] = { group: 'encoding-and-markup',
  details: (p, s, v) => { const hebrew = seedFor(s.seed, p.pageId, 'rtl') % 2 === 1; return { language: hebrew ? 'he' : 'ar', direction: 'rtl', text: hebrew ? 'שעות הפתיחה עשויות להשתנות בחגים.' : 'قد تتغير ساعات العمل خلال العطلات.', isField: false, ...(v >= 2 ? { bidiIsolate: true } : {}) }; },
  main: d => `<p class="notice-translation" lang="${d.language}" dir="rtl">${d.bidiIsolate ? `<bdi>${e(d.text)}</bdi>` : e(d.text)}</p>` };

export const CRAWLER_TRAP_TYPES = Object.freeze(Object.keys(R));
const TRAP_SET = new Set(CRAWLER_TRAP_TYPES);
export const NON_SEMANTIC_TRAP_TYPES = Object.freeze(CRAWLER_TRAP_TYPES.filter(type => R[type].semantic === false));
export const SCRIPT_TRAP_TYPES = Object.freeze(CRAWLER_TRAP_TYPES.filter(type => R[type].script));
export const LOOSE_LINK_TRAP_TYPES = Object.freeze(CRAWLER_TRAP_TYPES.filter(type => R[type].looseLinks));
export const RESOURCE_ONLY_TRAP_TYPES = Object.freeze(CRAWLER_TRAP_TYPES.filter(type => R[type].resourceOnly));
export const SERVER_TRAP_TYPES = Object.freeze(CRAWLER_TRAP_TYPES.filter(type => R[type].server).concat(['meta-refresh-link', 'meta-refresh-delayed', 'js-redirect-page', 'noscript-meta-refresh', 'load-more-pagination']));
export const TRAP_SCENARIOS = Object.freeze(Object.fromEntries(Object.keys(TRAP_GROUPS).map(group => [group, CRAWLER_TRAP_TYPES.filter(type => R[type].group === group)])));
export const trapGroup = type => R[type]?.group;

export function isCrawlerTrap(type) { return TRAP_SET.has(type); }
export function trapEligible(type, page, site) {
  if (!isLocalPageTarget(page.url)) return false;
  return R[type].eligible ? R[type].eligible(page, site) : true;
}
export function trapDetails(type, page, site, severity) {
  if (!R[type]) throw new TypeError(`Unknown crawler trap ${type}`);
  return R[type].details(page, site, severity);
}
export function trapMainMarkup(event, page, site) { return R[event.type]?.main?.(event.details, page, site) ?? ''; }
export function trapRawMarkup(event) { return R[event.type]?.raw?.(event.details) ?? ''; }
export function trapHeadMarkup(event, site, page) { return R[event.type]?.head?.(event.details, page, site) ?? ''; }
export function trapMutateHead(event, head, site, helpers) { R[event.type]?.mutateHead?.(head, event.details, site, helpers); }
export function trapPostProcess(event, html) { return R[event.type]?.post ? R[event.type].post(html, event.details) : html; }

// ---- extra public resources (written by the generator, hashed in the manifest) ------------------
function legacyDocument(title, body, charset = 'utf-8') {
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">\n<html><head><meta http-equiv="Content-Type" content="text/html; charset=${charset}"><title>${e(title)}</title></head><body bgcolor="#ffffff">${body}<hr><p><a href="/">Home</a></p></body></html>\n`;
}
function framesetDocument(site) {
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Frameset//EN">\n<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>${e(site.name ?? 'Site')} (frames)</title></head><frameset cols="200,*"><frame name="nav" src="${FRAME_NAV}" scrolling="auto"><frame name="main" src="/"><noframes><body><p>This site uses frames. <a href="/">Continue without frames</a>.</p></body></noframes></frameset></html>\n`;
}
function frameNavDocument(site) {
  return legacyDocument('Navigation', `<ul>${navTargets(site).map(href => `<li><a href="${e(href)}" target="main">${href === '/' ? 'Home' : e(site.navigation.find(item => item.href === href)?.label ?? href)}</a></li>`).join('')}</ul>`);
}
function urlset(urls) { return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${e(url)}</loc></url>`).join('')}</urlset>\n`; }
function sitemapIndex(urls) { return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<sitemap><loc>${e(url)}</loc></sitemap>`).join('')}</sitemapindex>\n`; }
function utf16(text) { return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]); }

// Returns [{ path, body: Buffer|string }] for every public resource the recorded events declare.
export function trapArtifacts({ site, pages, readPublic }) {
  const files = new Map();
  const add = (path, body) => files.set(path, body);
  const events = pages.flatMap(page => page.noiseEvents.filter(event => isCrawlerTrap(event.type)).map(event => ({ page, event })));
  const has = type => events.some(item => item.event.type === type);
  if (has('frameset-navigation')) add(FRAMESET, framesetDocument(site));
  if (has('frameset-navigation') || has('iframe-navigation')) add(FRAME_NAV, frameNavDocument(site));
  if (has('feed-links')) {
    const items = pages.filter(page => page.kind === 'detail').slice(0, 5);
    add(FEED, `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${e(site.name ?? 'News')}</title><link>${e(site.baseUrl)}/</link><description>Latest records</description>${items.map(page => `<item><title>${e(page.title)}</title><link>${e(site.baseUrl + page.url)}</link><guid>${e(site.baseUrl + page.url)}</guid></item>`).join('')}</channel></rss>\n`);
  }
  if (has('windows-1252-documents')) {
    add(PRESS[0], Buffer.concat([Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>Press release 1998</title></head><body><p>'), encodeWindows1252(SMART_TEXT), Buffer.from('</p></body></html>\n')]));
    add(PRESS[1], Buffer.concat([Buffer.from('<html><head><meta charset="utf-8"><title>Press release 1999</title></head><body><p>'), encodeWindows1252(SMART_TEXT), Buffer.from('</p></body></html>\n')]));
  }
  if (has('utf16-document')) add(UTF16, utf16('<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-16"><title>Notice</title></head><body><p>Notice: reading room hours changed.</p></body></html>\n'));
  if (has('space-unicode-urls')) for (const path of SPACED) add(path, legacyDocument(path.split('/').pop().replace(/\.htm$/, ''), `<h1>${e(path.split('/').pop())}</h1><p>Archived document.</p>`));
  for (const { page, event } of events) {
    if (event.type === 'duplicate-section-content') add(event.details.copy.path, readPublic(page.url));
    if (event.type === 'near-duplicate-dated') {
      const line = `<p class="edition-date">Edition of ${event.details.copy.date}</p>`;
      add(event.details.copy.path, String(readPublic(page.url)).replace(/<\/body>/i, `${line}</body>`));
    }
    if (event.type === 'robots-txt-traps') add('/robots.txt', event.details.content);
    if (event.type === 'sitemap-traps') {
      const d = event.details;
      add('/sitemap-index.xml', sitemapIndex([`${site.baseUrl}/sitemap-pages.xml`, `${site.baseUrl}/sitemap-nested-index.xml`, `${site.baseUrl}/sitemap-legacy.xml.gz`]));
      add('/sitemap-pages.xml', urlset(d.entries.map(entry => entry.loc)));
      add('/sitemap-nested-index.xml', sitemapIndex([`${site.baseUrl}/sitemap.xml`]));
      add('/sitemap-legacy.xml.gz', gzipSync(Buffer.from(urlset(d.gzipEntries)), { level: 9, mtime: 0 }));
    }
  }
  return [...files].map(([path, body]) => ({ path, body }));
}

// ---- preview-server support ----------------------------------------------------
export function enabledServerTraps(types) {
  return new Set((Array.isArray(types) ? types : []).filter(type => SERVER_TRAP_TYPES.includes(type)));
}
export function stripSessionPath(pathname) {
  return pathname.replace(/;jsessionid=[^/;]*/gi, '').replace(/^\/\(S\([a-z0-9]{1,64}\)\)(?=\/)/i, '');
}
// Path rewrites old servers perform before file lookup.
export function rewriteTrapPath(pathname, traps) {
  let path = pathname;
  if (traps.has('session-id-urls')) path = stripSessionPath(path);
  if (traps.has('mobile-duplicates') && path.startsWith('/m/')) path = path.slice(2);
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (traps.has('default-document-aliases') && DEFAULT_DOCUMENTS.includes(last)) path = path.slice(0, -last.length);
  else if (traps.has('mixed-case-extensions') && ['index.html', 'index.htm'].includes(last.toLowerCase()) && last !== 'index.html') path = path.slice(0, -last.length);
  return path;
}

function page(title, body) { return legacyDocument(title, body); }
const html = body => ({ status: 200, body });
const missing = { status: 404, body: 'Not found' };

export function calendarResponse(searchParams) {
  if (searchParams.has('date')) {
    const day = dayNumber(searchParams.get('date'));
    if (day === null || day < DAY_FIRST || day > DAY_LAST) return missing;
    const nav = [[day - 1, '‹ Previous day'], [day + 1, 'Next day ›']].filter(([target]) => target >= DAY_FIRST && target <= DAY_LAST)
      .map(([target, text]) => `<a href="${CALENDAR_PATH}?date=${dayKey(target)}">${text}</a>`).join(' | ');
    return html(page(`Events on ${dayKey(day)}`, `<h1>Events on ${dayKey(day)}</h1><p>${nav}</p><p>No events are scheduled for this day.</p>`));
  }
  const month = searchParams.get('month');
  const view = searchParams.get('view') ?? 'month';
  const index = monthIndex(month);
  if (index === null || index < CALENDAR_FIRST || index > CALENDAR_LAST || !CALENDAR_VIEWS.includes(view)) return missing;
  const year = Math.floor(index / 12);
  const name = `${MONTHS[index % 12]} ${year}`;
  const nav = [[index - 12, '« Previous year'], [index - 1, '‹ Previous month'], [index + 1, 'Next month ›'], [index + 12, 'Next year »']]
    .filter(([target]) => target >= CALENDAR_FIRST && target <= CALENDAR_LAST)
    .map(([target, text]) => `<a href="${e(calendarHref(monthKey(target), view))}">${text}</a>`).join(' | ');
  const other = view === 'month' ? 'list' : 'month';
  const days = new Date(Date.UTC(year, index % 12 + 1, 0)).getUTCDate();
  const grid = view === 'month'
    ? `<table border="1" cellpadding="4" summary="Calendar"><tr>${Array.from({ length: days }, (_, day) => `${day && day % 7 === 0 ? '</tr><tr>' : ''}<td>${day + 1}</td>`).join('')}</tr></table>`
    : '<ul><li>No events scheduled.</li></ul>';
  return html(page(`Events calendar: ${name}`, `<h1>Events calendar: ${name}</h1><p>${nav}</p><p><a href="${e(calendarHref(month, other))}">${other === 'list' ? 'List view' : 'Month view'}</a></p>${grid}<p>No events are scheduled for this month.</p>`));
}

export function pathInfoResponse(pathname) {
  if (!pathname.startsWith(PATH_INFO_ROOT) || !pathname.endsWith('/')) return missing;
  const segments = pathname.slice(PATH_INFO_ROOT.length, -1).split('/');
  if (segments[0] !== 'archive' || segments.length > PATH_INFO_MAX_SEGMENTS || segments.slice(1).some(segment => !PATH_INFO_STEPS.includes(segment))) return missing;
  const links = segments.length < PATH_INFO_MAX_SEGMENTS ? PATH_INFO_STEPS.map(step => `<a href="${step}/">${step === 'media' ? 'Media files' : 'Printable list'}</a>`).join(' | ') : '';
  return html(page('Archive browser', `<h1>Archive browser</h1><p>Folder: ${e(segments.join(' / '))}</p><p>${links}</p><p>This folder is empty.</p>`));
}

function archiveResponse(pathname) {
  const match = /^\/cgi-bin\/archive\.pl\/(\d{4})\/(?:(\d{2})\/(?:(\d{2})\/)?)?$/.exec(pathname);
  if (!match) return missing;
  const [year, month, day] = [Number(match[1]), match[2] && Number(match[2]), match[3] && Number(match[3])];
  if (!ARCHIVE_YEARS.includes(year) || (month && (month < 1 || month > 12))) return missing;
  const first = ARCHIVE_YEARS[0];
  const last = ARCHIVE_YEARS.at(-1);
  const pad = value => String(value).padStart(2, '0');
  if (!month) return html(page(`Archive ${year}`, `<h1>Archive ${year}</h1><p>${[year - 1, year + 1].filter(y => y >= first && y <= last).map(y => `<a href="${ARCHIVE_ROOT}${y}/">${y}</a>`).join(' | ')}</p><ul>${Array.from({ length: 12 }, (_, i) => `<li><a href="${pad(i + 1)}/">${MONTHS[i]}</a></li>`).join('')}</ul>`));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!day) return html(page(`Archive ${MONTHS[month - 1]} ${year}`, `<h1>${MONTHS[month - 1]} ${year}</h1><ul>${Array.from({ length: days }, (_, i) => `<li><a href="${pad(i + 1)}/">${i + 1}</a></li>`).join('')}</ul><p><a href="../">Year</a></p>`));
  if (day < 1 || day > days) return missing;
  const number = Date.UTC(year, month - 1, day) / 86400000;
  const firstDay = Date.UTC(first, 0, 1) / 86400000;
  const lastDay = Date.UTC(last, 11, 31) / 86400000;
  const nav = [[number - 1, 'Previous day'], [number + 1, 'Next day']].filter(([n]) => n >= firstDay && n <= lastDay)
    .map(([n, text]) => `<a href="${ARCHIVE_ROOT}${dayKey(n).replaceAll('-', '/')}/">${text}</a>`).join(' | ');
  return html(page(`Archive ${dayKey(number)}`, `<h1>Archive for ${dayKey(number)}</h1><p>${nav}</p><p><a href="../">Month</a></p><p>No records were added on this day.</p>`));
}

function searchResponse(searchParams) {
  const q = searchParams.get('q') ?? '';
  const pageNumber = Number(searchParams.get('page') ?? '1');
  if (!/^[a-z0-9 ]{1,40}$/.test(q) || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 99) return missing;
  const next = pageNumber < SEARCH_PAGES ? `<p><a href="${SEARCH_PATH}?q=${queryEncode(q)}&amp;page=${pageNumber + 1}">Next results</a></p>` : '';
  return html(page(`Search: ${q}`, `<h1>Search results for “${e(q)}”</h1><p>Page ${pageNumber}. ${pageNumber > SEARCH_PAGES ? 'No more results.' : 'No matching records on this page.'}</p>${next}`));
}

function listResponse(searchParams) {
  const offset = Number(searchParams.get('offset'));
  if (!Number.isInteger(offset) || offset < LIST.first || offset % LIST.step !== 0 || offset > 10000) return missing;
  if (offset > LIST.last) return html(page('More results', '<ul class="results-page"></ul>'));
  const next = offset < LIST.last ? `${LIST_PATH}?offset=${offset + LIST.step}` : null;
  return html(page('More results', `<ul class="results-page"${next ? ` data-next-url="${next}"` : ''}>${Array.from({ length: LIST.step }, (_, i) => `<li>Result ${offset + i + 1} (archived)</li>`).join('')}</ul>${next ? `<p><a rel="next" href="${next}">More results</a></p>` : ''}`));
}

function loginResponse(searchParams) {
  const next = searchParams.get('next');
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.length > 1024) return missing;
  const depth = (next.match(/^\/login\?/) ? 1 : 0) + (next.match(/next=%2Flogin%3F/gi)?.length ?? 0);
  if (depth > LOGIN_MAX_DEPTH) return missing;
  const self = `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
  const forgot = depth < LOGIN_MAX_DEPTH ? `<p><a href="${e(`${LOGIN_PATH}?next=${encodeURIComponent(self)}`)}">Forgot your password?</a></p>` : '';
  return html(page('Sign in', `<h1>Sign in</h1><form method="post" action="${e(self)}"><label>User name <input name="user"></label> <label>Password <input type="password" name="password"></label> <button type="submit">Sign in</button></form>${forgot}`));
}

// Returns null when the request is not a trap route, otherwise { status, body, headers? } (possibly async).
export async function trapRouteResponse(pathname, searchParams, traps, { exists, readPage, baseUrl }) {
  if ((traps.has('calendar-trap') || traps.has('day-calendar-trap')) && pathname === CALENDAR_PATH) {
    if (searchParams.has('date') ? !traps.has('day-calendar-trap') : !traps.has('calendar-trap')) return missing;
    return calendarResponse(searchParams);
  }
  if (traps.has('path-info-trap') && pathname.startsWith(PATH_INFO_ROOT)) return pathInfoResponse(pathname);
  if (traps.has('date-archive-trap') && pathname.startsWith(ARCHIVE_ROOT)) return archiveResponse(pathname);
  if (traps.has('search-tag-cloud') && pathname === SEARCH_PATH) return searchResponse(searchParams);
  if (traps.has('load-more-pagination') && pathname === LIST_PATH) return listResponse(searchParams);
  if (traps.has('login-wall-links') && pathname === LOGIN_PATH) return loginResponse(searchParams);
  const target = searchParams.get('url') ?? searchParams.get('to');
  const local = isLocalPageTarget(target) && await exists(target);
  if ((traps.has('meta-refresh-link') || traps.has('meta-refresh-delayed')) && pathname === REDIRECT_PATH) {
    const delay = searchParams.get('delay') ?? '0';
    if (!local || !['0', '5'].includes(delay) || (delay === '5' && !traps.has('meta-refresh-delayed')) || (delay === '0' && !traps.has('meta-refresh-link'))) return missing;
    return html(`<html><head><meta http-equiv="refresh" content="${delay}; URL=${e(target)}"><title>Redirecting</title></head><body><p>This page has moved. <a href="${e(target)}">Continue</a>.</p></body></html>\n`);
  }
  if (traps.has('js-redirect-page') && pathname === JUMP_PATH) {
    if (!local || !searchParams.has('to')) return missing;
    return html(`<html><head><title>Redirecting</title><script>window.location.replace(${JSON.stringify(target)});</script></head><body><p>Redirecting…</p></body></html>\n`);
  }
  if (traps.has('noscript-meta-refresh') && pathname === NOJS_PATH) {
    if (!local) return missing;
    return html(`<html><head><title>Loading</title><noscript><meta http-equiv="refresh" content="0; URL=${e(target)}"></noscript><script>document.documentElement.className = 'js';</script></head><body><p>Loading the interactive viewer…</p></body></html>\n`);
  }
  if (traps.has('canonical-chain') && pathname === CANONICAL_PATH) {
    const hop = searchParams.get('hop');
    if (!local || !['1', '2'].includes(hop)) return missing;
    const next = hop === '1' ? `${CANONICAL_PATH}?hop=2&url=${encodeURIComponent(target)}` : target;
    const body = String(await readPage(target)).replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${e(baseUrl + next)}">`);
    return html(body);
  }
  return null;
}
