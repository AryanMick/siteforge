import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as parse5 from 'parse5';
import { seedFor } from '../site/util.mjs';
import { builderSampleWav } from '../noise/builder-modules.mjs';
import { isPlatform, platformFooterAttrs, platformHeaderAttrs, platformAssetBody, platformAssetPaths, platformBeforeMain, platformBodyAttrs, platformBodyClasses, platformBodyEnd, platformBodyStart, platformContent, platformHead, platformHtmlAttrs, platformLang, platformTitleSeparator } from './platforms.mjs';
import { MEDIA_POOL, hasIllustration, illustrationPng } from '../site/illustrations.mjs';
import { siteLook } from './site-look.mjs';
import { beforeFooterClutter, bodyEndClutter, bodyOpenClutter, clutterAssetFiles, footerInnerClutter, headClutter } from './source-clutter.mjs';
import { innerCss, innerLookClasses, renderDetailVariant, renderListingVariant } from './inner-layouts.mjs';
import { detailFurniture, listingFurniture, listingThumb, relatedCards } from './record-furniture.mjs';
import { realScript, runtimeScript, RUNTIME_ASSET } from './site-runtime.mjs';
import { drupalViewsCss, drupalViewsJs, renderDrupalListing } from './drupal-views.mjs';
import { homeCss, renderHomePage, renderLegacyHome } from './home-pages.mjs';

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(tmpdir(), 'siteforge-renderer-v1', String(process.pid));
const FRAMEWORKS = new Set(['html', 'react', 'angular']);
const STYLES = new Set(['legacy', 'conventional', 'modern']);
const bundleBuilds = new Map();

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function safeHref(value) {
  const href = String(value ?? '');
  return href.startsWith('/') && !href.startsWith('//') ? escapeHtml(href) : '#';
}

function siteHref(site, page, value) {
  const path = String(value ?? '');
  if (!path.startsWith('/') || path.startsWith('//')) return '#';
  let mode = site.linkMode ?? 'root-relative';
  if (mode === 'base-relative') return escapeHtml(`./${path.slice(1)}`);
  if (mode === 'mixed') mode = seedFor(site.seed, page.pageId, path, 'link-mode') % 2 ? 'absolute' : 'relative';
  if (mode === 'absolute') return escapeHtml(new URL(path, site.baseUrl).href);
  if (mode === 'relative') {
    const target = new URL(path, site.baseUrl);
    const from = page.url.endsWith('/') ? page.url : `${page.url}/`;
    let relative = posix.relative(from, target.pathname);
    if (!relative) relative = '.';
    if (target.pathname.endsWith('/') && !relative.endsWith('/')) relative += '/';
    if (!relative.startsWith('.')) relative = `./${relative}`;
    return escapeHtml(`${relative}${target.search}${target.hash}`);
  }
  return safeHref(path);
}

function humanize(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function assertSupported(site) {
  if (!site || !FRAMEWORKS.has(site.framework)) throw new Error(`Unsupported framework: ${site?.framework ?? 'missing'}`);
  if (!STYLES.has(site.visualStyle)) throw new Error(`Unsupported visual style: ${site?.visualStyle ?? 'missing'}`);
  if (site.framework === 'html' && site.rendering !== 'static') throw new Error('The html framework supports static rendering only');
  if (site.framework !== 'html' && site.rendering !== 'client') throw new Error(`${site.framework} supports client rendering only`);
}

function pageLinks(page) {
  const links = [];
  const seen = new Set();
  for (const link of page.links ?? []) {
    if (!link || typeof link.href !== 'string' || seen.has(link.href)) continue;
    seen.add(link.href);
    links.push({ label: String(link.label || 'View item'), href: link.href, type: '' });
  }
  for (const relation of page.relationships ?? []) {
    if (!relation || typeof relation.targetUrl !== 'string' || seen.has(relation.targetUrl)) continue;
    seen.add(relation.targetUrl);
    links.push({ label: humanize(relation.type || 'Related item'), href: relation.targetUrl, type: String(relation.type || '') });
  }
  return links;
}

function renderFields(page) {
  const entries = Object.entries(page.fields ?? {})
    
    .filter(([key, value]) => key !== 'title' && key !== page.image?.field && value !== undefined && value !== null);
  if (!entries.length) return page.kind === 'home' ? '' : '<p class="empty-note">No additional details are available.</p>';
  if (page.fieldLayout === 'table') return `<table class="field-list"><tbody>${entries.map(([key, value]) => `<tr><th scope="row">${escapeHtml(page.fieldLabels?.[key] ?? humanize(key))}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>`;
  if (page.fieldLayout === 'paragraphs') return `<section class="field-list">${entries.map(([key, value]) => `<p><strong>${escapeHtml(page.fieldLabels?.[key] ?? humanize(key))}:</strong> ${escapeHtml(value)}</p>`).join('')}</section>`;
  return `<dl class="field-list">${entries.map(([key, value]) => {
    const label = page.fieldLabels?.[key] ?? humanize(key);
    return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
  }).join('')}</dl>`;
}

// Public labels only: the listing's own title and, on themed sites, the type label the kicker already shows.
const listingTypeLabel = page => String(page.title ?? 'Entry');
const publicTypeLabel = (site, page) => CHROME[site.domain] ? (TYPE_LABELS[page.contentType] ?? humanize(page.contentType)) : 'record';

function renderRelated(site, page) {
  const links = pageLinks(page);
  if (!links.length) return '';
  const paging = links.filter((link) => /^(previous|prev|next|page)$/i.test(link.type) || /^(previous|next) page$/i.test(link.label));
  const related = links.filter((link) => !paging.includes(link));
  let list = '';
  if (related.length && page.kind === 'listing' && site.shell && page.repeatedItems?.length) {
    const table = page.template === 'listing-0' || site.shell === 'archive';
    const items = page.repeatedItems.map(item => {
      const details = Object.entries(item.fields).filter(([key]) => key !== 'title');
      const thumb = site.mediaPool && site.visualStyle !== 'legacy' ? (() => {
        const person = (site.personSections ?? []).some(prefix => String(item.url).startsWith(prefix));
        const n = seedFor(site.seed, item.url, 'thumb');
        const src = siteHref(site, page, person ? `/assets/media/portrait-${1 + n % MEDIA_POOL.portraits}.png` : `/assets/media/${site.domain}-${1 + n % MEDIA_POOL.scenes}.png`);
        return `<img class="record-thumb" src="${src}" width="480" height="640" loading="lazy" decoding="async" alt="">`;
      })() : '';
      const tile = site.visualStyle === 'legacy' ? listingThumb(site, item.url, escapeHtml, item.fields.title) : '';
      const meta = site.visualStyle === 'legacy' ? `<span class="rf-card-meta">${escapeHtml(listingTypeLabel(page))}</span>` : '';
      const content = `${thumb}${tile}<a href="${siteHref(site, page, item.url)}">${escapeHtml(item.fields.title)}</a>${details.map(([key, value]) => `<p><strong>${escapeHtml(humanize(key))}</strong> ${escapeHtml(value)}</p>`).join('')}${meta}`;
      return table ? `<tr><td>${content}</td></tr>` : `<li>${content}</li>`;
    }).join('');
    list = table ? `<section aria-labelledby="related-heading"><h2 class="section-heading" id="related-heading">Browse entries</h2><table class="directory-table repeated-records"><tbody>${items}</tbody></table></section>`
      : `<section aria-labelledby="related-heading"><h2 class="section-heading" id="related-heading">Browse entries</h2><ul class="record-cards repeated-records">${items}</ul></section>`;
  } else if (related.length && page.kind === 'listing' && site.visualStyle === 'legacy') {
    list = `<section aria-labelledby="related-heading"><h2 class="section-heading" id="related-heading">Browse entries</h2><table class="directory-table"><tbody>${related.map((link) => `<tr><td>${listingThumb(site, link.href, escapeHtml, link.label)}<a href="${siteHref(site, page, link.href)}">${escapeHtml(link.label)}<small>${escapeHtml(link.href)}</small></a><span class="rf-card-meta">${escapeHtml(listingTypeLabel(page))}</span></td></tr>`).join('')}</tbody></table></section>`;
  } else if (related.length && page.kind === 'detail') {
    // "More like this" cards: only the page's own model links, with media-pool thumbnails where the site has them.
    const thumb = link => {
      if (!site.mediaPool || !hasIllustration(site.domain)) return null;
      const person = (site.personSections ?? []).some(prefix => String(link.href).startsWith(prefix));
      const n = seedFor(site.seed, link.href, 'thumb');
      return `<img class="rf-card-img" src="${siteHref(site, page, person ? `/assets/media/portrait-${1 + n % MEDIA_POOL.portraits}.png` : `/assets/media/${site.domain}-${1 + n % MEDIA_POOL.scenes}.png`)}" width="480" height="640" loading="lazy" decoding="async" alt="">`;
    };
    list = relatedCards(site, page, related, { esc: escapeHtml, href: path => siteHref(site, page, path), thumb, heading: detailFurniture(site, page, { esc: escapeHtml, typeLabel: publicTypeLabel(site, page) }).cardsHeading });
  } else if (related.length) {
    list = `<section aria-labelledby="related-heading"><h2 class="section-heading" id="related-heading">${page.kind === 'listing' ? 'Browse entries' : 'Related pages'}</h2><ul class="link-list">${related.map((link) => `<li><a href="${siteHref(site, page, link.href)}">${escapeHtml(link.label)}<small>${escapeHtml(link.href)}</small></a></li>`).join('')}</ul></section>`;
  }
  const pager = paging.length ? `<nav class="pager" aria-label="Pagination">${paging.map((link) => `<a href="${siteHref(site, page, link.href)}">${escapeHtml(link.label)}</a>`).join('')}</nav>` : '';
  return list + pager;
}

function layoutIndex(template) {
  const suffix = Number.parseInt(String(template ?? '').match(/(\d+)$/)?.[1] ?? '0', 10);
  return suffix % 4;
}

// Front pages laid out the way each kind of real site does it (quick-link tiles, featured stories, about panel).
const HOME_COPY = {
  library: { tiles: ['Find your next read', 'Meet local and visiting writers', 'Workshops, story times and talks', 'Hours, addresses and services'], featured: 'New and noteworthy', about: 'About the library' },
  government: { tiles: ['Grants, rebates and assistance', 'Offices and leadership', 'Rules and guidance', 'Reports and fact sheets'], featured: 'Featured', about: 'About the agency' },
  municipality: { tiles: ['Request and pay for services', 'Find a city office', 'Agendas and public meetings', 'Closures and public notices'], featured: 'Popular right now', about: 'About the city' },
  university: { tiles: ['Explore what you can study', 'Find faculty and experts', 'Undergraduate and graduate degrees', 'Discoveries from our researchers'], featured: 'News and research', about: 'About the university' },
  healthcare: { tiles: ['Care for every stage of life', 'Find a location near you', 'Find a doctor or specialist', 'Health tips and guides'], featured: 'Featured care', about: 'About us' },
  documentation: { tiles: ['Concepts and how-tos', 'Every endpoint and method', 'What changed in each version', 'Step-by-step walkthroughs'], featured: 'Popular pages', about: 'About these docs' },
  museum: { tiles: ['Objects in the collection', 'Artists and makers', 'On view now and coming soon', 'For schools and families'], featured: 'Highlights', about: 'About the museum' },
  nonprofit: { tiles: ['Our work in the community', 'Funding opportunities', 'Our impact, in numbers', 'Give your time'], featured: 'Latest from the foundation', about: 'Who we are' },
  records: { tiles: ['Search individual records', 'Browse record collections', 'Guides to our holdings', 'Reading room and offices'], featured: 'Recently added', about: 'About the archives' },
  news: { tiles: ['Latest local news', 'Our reporters', 'In-depth stories', 'Print editions'], featured: 'Top stories', about: 'About the newsroom' },
};

const HOME_HEADINGS = {
  sections: ['Explore', 'Quick links', 'I want to…', 'Browse', 'Popular topics', 'Start here', 'Find what you need'],
  about: { library: ['About the library', 'Our mission', 'Who we are'], government: ['About the agency', 'Our mission', 'About us'], municipality: ['About the city', 'Your local government', 'About us'], university: ['About the university', 'Our mission', 'At a glance'], healthcare: ['About us', 'Our mission', 'Why choose us'], documentation: ['About these docs', 'Overview', 'How the docs are organized'], museum: ['About the museum', 'Our mission', 'Visit us'], nonprofit: ['Who we are', 'Our mission', 'Why we do it'], records: ['About the archives', 'Our holdings', 'Using the archives'], news: ['About the newsroom', 'Our journalism', 'About us'] },
  featured: { library: ['New and noteworthy', 'Staff picks', 'Coming up', 'Just added'], government: ['Featured', 'In focus', 'Latest updates'], municipality: ['Popular right now', 'News and updates', 'Featured services'], university: ['News and research', 'Featured stories', 'In the spotlight'], healthcare: ['Featured care', 'Health news', 'Spotlight'], documentation: ['Popular pages', 'Recently updated', 'Start with these'], museum: ['Highlights', 'Now on view', 'From the collection'], nonprofit: ['Latest from the foundation', 'Stories of impact', 'Featured'], records: ['Recently added', 'Featured collections', 'From the vaults'], news: ['Top stories', 'Latest', 'Most read'] },
};

// Plain-text panels real home pages carry (hours, stats, notices); they contain no links or fields.
function homeExtras(site) {
  const r = salt => seedFor(site.seed, site.id ?? '', 'home-extra', salt);
  const hours = ['Mon–Thu 9:00–20:00 · Fri–Sat 9:00–17:00 · Sun 13:00–17:00', 'Open daily 10:00–17:00 · Thursdays until 21:00', 'Monday to Friday 8:30–16:30', 'Tue–Sat 10:00–18:00 · Closed Sunday and Monday'][r('hours') % 4];
  const n = (salt, min, max) => (min + r(salt) % (max - min)).toLocaleString('en-US');
  const stats = {
    library: [[`${n('a', 400, 1900)}K`, 'items borrowed last year'], [n('b', 3, 14), 'branches'], [`${n('c', 900, 4000)}`, 'free programs a year']],
    university: [[n('a', 9000, 41000), 'students'], [n('b', 120, 400), 'degree programs'], [`$${n('c', 80, 900)}M`, 'research funding']],
    nonprofit: [[`$${n('a', 2, 19)}.${r('d') % 10}M`, 'granted since founding'], [n('b', 1200, 9000), 'volunteers'], [n('c', 40, 300), 'partner organizations']],
    healthcare: [[n('a', 12, 60), 'locations'], [n('b', 200, 1400), 'providers'], [`${n('c', 90, 99)}%`, 'patients would recommend us']],
    museum: [[`${n('a', 12, 90)}K`, 'objects in the collection'], [n('b', 4, 16), 'exhibitions a year'], ['Free', 'for members and under-18s']],
    records: [[`${n('a', 2, 40)}K`, 'cubic feet of records'], [n('b', 1840, 1890), 'oldest record series'], [n('c', 100, 900), 'finding aids online']],
    municipality: [[n('a', 18000, 240000), 'residents'], [n('b', 30, 180), 'parks'], ['311', 'for non-emergency requests']],
    government: [[n('a', 20, 140), 'assistance programs'], [n('b', 8, 30), 'regional offices'], [`$${n('c', 40, 900)}M`, 'distributed last year']],
    documentation: [[`v${2 + r('v') % 4}.${r('w') % 9}`, 'current release'], [n('b', 140, 600), 'API endpoints'], ['99.9%', 'uptime last 90 days']],
    news: [[n('a', 1890, 1960), 'year founded'], [n('b', 20, 120), 'journalists'], [`${n('c', 40, 900)}K`, 'monthly readers']],
  }[site.domain] ?? [];
  const panels = [];
  if (['library', 'museum', 'records', 'healthcare', 'municipality'].includes(site.domain) && r('show-hours') % 3 !== 0) panels.push(`<section class="home-hours" aria-label="Opening hours"><p class="home-panel-title">Hours today</p><p>${escapeHtml(hours)}</p></section>`);
  if (r('show-stats') % 3 !== 0) panels.push(`<section class="home-stats" aria-label="At a glance"><ul>${stats.map(([value, label]) => `<li><span class="home-stat-value">${escapeHtml(value)}</span><span class="home-stat-label">${escapeHtml(label)}</span></li>`).join('')}</ul></section>`);
  if (r('show-band') % 2 === 0) {
    const band = { library: 'Your library card is free. Sign up online or at any branch.', government: 'Need help? Our call center is open Monday to Friday, 8 am to 6 pm.', municipality: 'Report potholes, missed pickups and streetlight outages any time by calling 311.', university: 'Applications for next year are open. Priority deadline: January 15.', healthcare: 'New patients welcome. Most insurance plans accepted.', documentation: 'New to the platform? Most developers make their first API call in under ten minutes.', museum: 'Members enjoy free admission, exhibition previews and shop discounts.', nonprofit: 'Every dollar given this month is matched by a local donor.', records: 'Research appointments can be booked up to three weeks in advance.', news: 'Get the morning briefing in your inbox every weekday at 6 am.' }[site.domain];
    if (band) panels.push(`<section class="home-band" aria-label="Notice"><p>${escapeHtml(band)}</p></section>`);
  }
  return panels;
}

const homeContext = (site, page, image, fields) => ({ esc: escapeHtml, href: path => siteHref(site, page, path), image, fields, links: pageLinks(page), chrome: chromeFor(site) });

function renderHome(site, page, image, fields) {
  // Full per-domain front pages (src/render/home-pages.mjs); the block layout below remains the fallback.
  const full = renderHomePage(site, page, homeContext(site, page, image, fields));
  if (full) return full;
  const copy = HOME_COPY[site.domain];
  const r = salt => seedFor(site.seed, site.id ?? '', 'home', salt);
  const navHrefs = new Set((site.navigation ?? []).map(item => item.href));
  const links = pageLinks(page);
  const sections = links.filter(link => navHrefs.has(link.href));
  const featured = links.filter(link => !navHrefs.has(link.href));
  const variant = r('variant') % 6;
  const tileStyle = ['boxed', 'list', 'pill', 'icon', 'plain'][r('tile-style') % 5];
  const cardStyle = ['grid', 'list', 'overlay', 'numbered'][r('card-style') % 4];
  const showBlurbs = r('blurbs') % 4 !== 0;
  const tiles = sections.map((link, index) => `<li class="home-tile"><a href="${siteHref(site, page, link.href)}">${escapeHtml(link.label)}</a>${showBlurbs ? `<p>${escapeHtml(copy.tiles[index % copy.tiles.length])}</p>` : ''}</li>`).join('');
  const thumbs = site.mediaPool && cardStyle !== 'numbered' && cardStyle !== 'list';
  const thumbFor = link => {
    const person = (site.personSections ?? []).some(prefix => String(link.href).startsWith(prefix));
    const n = seedFor(site.seed, link.href, 'thumb');
    return person ? `/assets/media/portrait-${1 + n % MEDIA_POOL.portraits}.png` : `/assets/media/${site.domain}-${1 + n % MEDIA_POOL.scenes}.png`;
  };
  const cards = featured.map((link, index) => {
    const src = thumbs ? siteHref(site, page, thumbFor(link)) : '';
    const img = thumbs ? `<img class="home-card-thumb" src="${src}" srcset="${src} 480w" sizes="(max-width: 720px) 100vw, 320px" width="480" height="640" loading="lazy" decoding="async" alt="">` : '';
    return `<li class="home-card${index === 0 ? ' home-card-lead' : ''}${thumbs ? ' has-thumb' : ''}">${img}${cardStyle === 'numbered' ? `<span class="home-card-number">${index + 1}</span>` : ''}<a href="${siteHref(site, page, link.href)}">${escapeHtml(link.label)}</a></li>`;
  }).join('');
  const sectionsHeading = HOME_HEADINGS.sections[r('sections-heading') % HOME_HEADINGS.sections.length];
  const featuredHeading = (HOME_HEADINGS.featured[site.domain] ?? [copy.featured])[r('featured-heading') % (HOME_HEADINGS.featured[site.domain]?.length ?? 1)];
  const aboutHeading = (HOME_HEADINGS.about[site.domain] ?? [copy.about])[r('about-heading') % (HOME_HEADINGS.about[site.domain]?.length ?? 1)];
  const blocks = {
    media: `<div class="home-media">${image}</div>`,
    tiles: `<section class="home-sections tiles-${tileStyle}" aria-labelledby="related-heading"><h2 class="section-heading" id="related-heading">${escapeHtml(sectionsHeading)}</h2><ul class="home-tiles">${tiles}</ul></section>`,
    featured: cards ? `<section class="home-featured cards-${cardStyle}" aria-labelledby="featured-heading"><h2 class="section-heading" id="featured-heading">${escapeHtml(featuredHeading)}</h2><ul class="home-cards">${cards}</ul></section>` : '',
    about: `<section class="home-about record-facts" aria-labelledby="about-heading"><h2 class="section-heading" id="about-heading">${escapeHtml(aboutHeading)}</h2>${fields}</section>`,
  };
  const extras = homeExtras(site);
  const orders = [['media', 'tiles', 'featured', 'about'], ['featured', 'media', 'tiles', 'about'], ['tiles', 'featured', 'media', 'about'], ['about', 'tiles', 'featured', 'media'], ['media', 'featured', 'tiles', 'about'], ['tiles', 'media', 'featured', 'about']];
  const order = orders[r('order') % orders.length];
  // The primary image stays first in the source (noise operators and crawlers treat it as the page image); CSS order sets the visual sequence.
  const visual = Object.fromEntries(order.map((key, index) => [key, index * 2 + 1]));
  for (const key of Object.keys(blocks)) if (blocks[key]) blocks[key] = blocks[key].replace(/^<(div|section) class="/, `<$1 class="home-order-${visual[key]} `);
  const body = ['media', ...order.filter(key => key !== 'media')].map(key => blocks[key]).filter(Boolean);
  extras.forEach((panel, index) => body.push(panel.replace(/^<section class="/, `<section class="home-order-${2 + 2 * ((r(`extra-at-${index}`) + index) % 4)} `)));
  return `<div class="home-layout home-${escapeHtml(site.domain)} home-v-${variant}">
      ${body.join('\n      ')}
    </div>`;
}

const usesInnerLayouts = (site, page) => site.visualStyle !== 'legacy' && Boolean(CHROME[site.domain]) && (page.kind === 'detail' || page.kind === 'listing');

function renderBody(site, page, image) {
  // Drupal listings are Views pages with working facets, sorts, tabs and pager (src/render/drupal-views.mjs).
  if (site.cmsProfile === 'drupal' && page.kind === 'listing') return renderDrupalListing(site, page, { href: path => siteHref(site, page, path), theme: drupalTheme(site) });
  const fields = page.kind === 'listing' && site.shell ? '' : renderFields(page);
  if (page.kind === 'home' && HOME_COPY[site.domain] && site.visualStyle !== 'legacy') return renderHome(site, page, image, fields);
  if (page.kind === 'home' && HOME_COPY[site.domain] && site.visualStyle === 'legacy') return renderLegacyHome(site, page, homeContext(site, page, image, fields));
  const related = renderRelated(site, page);
  if (usesInnerLayouts(site, page)) {
    const section = (site.navigation ?? []).find(item => item.href !== '/' && String(page.url).startsWith(item.href));
    const parts = { fields, related, image, esc: escapeHtml, typeLabel: TYPE_LABELS[page.contentType] ?? humanize(page.contentType), sectionLabel: section?.label ?? page.title, siteName: site.name };
    if (page.kind !== 'detail') return renderListingVariant(site, page, parts);
    // Prose sections about the record (src/render/record-furniture.mjs) follow the page design's own widgets.
    return `${renderDetailVariant(site, page, parts)}<div class="rf-after">${detailFurniture(site, page, { esc: escapeHtml, typeLabel: publicTypeLabel(site, page) }).body}</div>`;
  }
  if (page.kind === 'listing') {
    // Legacy listings: intro, result bar and a refine/help sidebar around the unchanged entry list.
    const count = page.repeatedItems?.length ?? pageLinks(page).filter(link => !/^(previous|next) page$/i.test(link.label)).length;
    const furniture = listingFurniture(site, page, { esc: escapeHtml, count });
    return `${furniture.top}<div class="rf-layout rf-layout-listing"><div class="rf-main"><div class="content-grid"><section class="record-facts">${fields}${related}</section>${image}</div></div>${furniture.aside}</div>`;
  }
  if (page.kind !== 'detail') {
    return `<div class="content-grid"><section class="record-facts">${fields}${related}</section>${image}</div>`;
  }
  // Legacy detail pages: page tools, contents, prose, a visit/contact aside, tags, citation and footer line
  // around the unchanged record layouts below.
  const furniture = detailFurniture(site, page, { esc: escapeHtml, typeLabel: publicTypeLabel(site, page) });
  const framed = core => `${furniture.top}<div class="rf-layout rf-layout-${escapeHtml(site.domain ?? 'site')}"><div class="rf-main">${core}${furniture.body}</div>${furniture.aside}</div>${furniture.bottom}`;
  if (layoutIndex(page.template) === 1) {
    return framed(`<article class="editorial-record">${image}<section class="record-facts">${fields}</section></article><div class="related-strip">${related}</div>`);
  }
  if (layoutIndex(page.template) === 2) {
    return framed(`<div class="record-sheet"><section class="record-facts">${fields}</section>${image}</div><div class="related-strip">${related}</div>`);
  }
  if (layoutIndex(page.template) === 3) {
    return framed(`<div class="archive-record"><section class="record-facts">${fields}</section><aside class="archive-aside">${image}${related}</aside></div>`);
  }
  return framed(`<div class="content-grid"><section class="record-facts">${fields}${related}</section>${image}</div>`);
}

const TYPE_LABELS = { object: 'Collection object', findingAid: 'Finding aid', faculty: 'Faculty profile', provider: 'Provider', journalist: 'Writer', information: 'About', article: 'Article', resource: 'Learning resource', opportunity: 'Volunteer opportunity' };

// Realistic source puts block elements on their own lines, as CMS templates do. Only whitespace *between* tags
// is added, before opening block tags, so no element's text (fields, titles, repeated items) changes; <pre> is untouched.
const BLOCK_TAGS = 'div|section|article|header|aside|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|h2|h3|h4|form|nav|p|figure|footer|details|fieldset';
const BLOCK_OPEN = new RegExp(`>(?=<(?:${BLOCK_TAGS})[\\s>])`, 'g');
function prettyBlocks(html) {
  return html.split(/(<pre[\s>][\s\S]*?<\/pre>)/).map((part, index) => index % 2 ? part : part.replace(BLOCK_OPEN, '>\n')).join('');
}

function renderMain(site, page) {
  const themed = Boolean(CHROME[site.domain]);
  const kindLabel = !themed ? (page.kind === 'home' ? 'Welcome' : page.kind === 'listing' ? 'Directory' : 'Record')
    : page.kind === 'home' ? chromeFor(site).tagline : page.kind === 'listing' ? site.name : (TYPE_LABELS[page.contentType] ?? humanize(page.contentType));
  const image = page.image?.src ? `<aside class="visual"><img src="${siteHref(site, page, page.image.src)}" alt="${escapeHtml(page.image.alt || '')}"${page.image.field ? ` data-field="${escapeHtml(page.image.field)}"` : ''} width="480" height="640"></aside>` : '';
  const summary = page.kind === 'home' ? page.fields?.summary : undefined;
  const description = summary !== undefined && summary !== null ? `<p class="lede">${escapeHtml(summary)}</p>` : '';
  const layout = ['layout-reference', 'layout-editorial', 'layout-compact', 'layout-archive'][layoutIndex(page.template)];
  const section = themed && page.kind === 'detail' ? (site.navigation ?? []).find(item => item.href !== '/' && String(page.url).startsWith(item.href) && item.href !== page.url) : undefined;
  const trail = section ? `<a href="${siteHref(site, page, section.href)}">${escapeHtml(section.label)}</a> / ` : '';
  const breadcrumb = `<p class="breadcrumb${themed && page.kind === 'home' ? ' visually-hidden' : ''}"><a href="${siteHref(site, page, '/')}">Home</a> / ${trail}${escapeHtml(page.title)}</p>`;
  const inner = usesInnerLayouts(site, page) ? ` ${innerLookClasses(site, page)}` : '';
  const mainHtml = `<main id="content" class="page-shell ${layout}${inner}">${breadcrumb}<header class="page-heading"><p class="kicker">${escapeHtml(kindLabel)}</p><h1>${escapeHtml(page.title)}</h1>${description}</header>${cmsMarkup(site, page, renderBody(site, page, image))}</main>`;
  return site.sourceClutter === 'realistic' ? prettyBlocks(mainHtml) : mainHtml;
}

function domainClass(domain) {
  let hash = 0;
  for (const character of String(domain ?? '')) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return ['domain-emerald', 'domain-red', 'domain-charcoal'][hash % 3];
}

// Representative CMS fingerprints modeled on the markup real WordPress and Drupal sites emit
// (wp_head()/body_class() output, Drupal 11 asset aggregation, drupalSettings and theme regions).
// Versions, IDs and hashes are fixture constants or seeded tokens, not installed software.
export const WORDPRESS_VERSION = '7.1.3';
export const DRUPAL_MAJOR = '11';
const JQUERY_VERSION = '3.7.1';

function token(site, ...parts) {
  return Buffer.from(seedFor(site.seed, ...parts).toString(16).padStart(8, '0') + seedFor(site.seed, 'b', ...parts).toString(16).padStart(8, '0')
    + seedFor(site.seed, 'c', ...parts).toString(16).padStart(8, '0') + seedFor(site.seed, 'd', ...parts).toString(16).padStart(8, '0'), 'hex')
    .toString('base64url');
}

export function themeSlug(site) {
  const words = String(site.name ?? site.id ?? 'site').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(word => !['the', 'of', 'city', 'town', 'village', 'state', 'county', 'university', 'college', 'museum'].includes(word));
  return (words.slice(0, 2).join('-') || 'site').slice(0, 30);
}
const drupalTheme = site => themeSlug(site).replaceAll('-', '_');

function cmsFiles(site) {
  if (site.cmsProfile === 'wordpress') {
    const theme = themeSlug(site);
    const styles = [['wp-block-library-css', '/wp-includes/css/dist/block-library/style.min.css', WORDPRESS_VERSION],
      [`${theme}-style-css`, `/wp-content/themes/${theme}/style.css`, '1.4.2']];
    if (site.builderProfile === 'elementor') styles.push(['elementor-frontend-css', '/wp-content/plugins/elementor/assets/css/frontend.min.css', '3.32.4'], ['elementor-post-7-css', '/wp-content/uploads/elementor/css/post-7.css', String(1700000000 + seedFor(site.seed, 'elementor-css') % 90000000)]);
    if (site.builderProfile === 'beaver-builder') styles.push(['fl-builder-layout-bundle-css', '/wp-content/uploads/bb-plugin/cache/layout-bundle.css', '2.9.4']);
    if (site.builderProfile === 'divi') styles.push(['divi-style-parent-css', '/wp-content/themes/Divi/style-static.min.css', '4.27.4'], ['et-builder-googlefonts-cached-css', '/wp-content/et-cache/global/et-divi-customizer-global.min.css', String(1700000000 + seedFor(site.seed, 'divi-css') % 90000000)]);
    if (site.builderProfile === 'wpbakery') styles.push(['js_composer_front-css', '/wp-content/plugins/js_composer/assets/css/js_composer.min.css', '7.9']);
    const scripts = [['jquery-core-js', '/wp-includes/js/jquery/jquery.min.js', JQUERY_VERSION], ['jquery-migrate-js', '/wp-includes/js/jquery/jquery-migrate.min.js', '3.4.1']];
    if (site.builderProfile === 'elementor') scripts.push(['elementor-frontend-js', '/wp-content/plugins/elementor/assets/js/frontend.min.js', '3.32.4']);
    if (site.builderProfile === 'divi') scripts.push(['divi-custom-script-js', '/wp-content/themes/Divi/js/scripts.min.js', '4.27.4']);
    if (site.builderProfile === 'wpbakery') scripts.push(['wpb_composer_front_js-js', '/wp-content/plugins/js_composer/assets/js/dist/js_composer_front.min.js', '7.9']);
    return { styles, scripts };
  }
  if (site.cmsProfile === 'drupal') {
    const theme = drupalTheme(site);
    const include = token(site, 'drupal-include');
    return {
      styles: [[null, `/sites/default/files/css/css_${token(site, 'drupal-css-0')}.css`, `delta=0&language=en&theme=${theme}&include=${include}`],
        [null, `/sites/default/files/css/css_${token(site, 'drupal-css-1')}.css`, `delta=1&language=en&theme=${theme}&include=${include}`]],
      scripts: [[null, `/sites/default/files/js/js_${token(site, 'drupal-js')}.js`, `scope=footer&delta=0&language=en&theme=${theme}&include=${include}`]],
    };
  }
  return { styles: [], scripts: [] };
}

function cmsAssetBody(site, path) {
  if (path.endsWith('/style.css') && path.includes('/wp-content/themes/')) {
    return `/*\nTheme Name: ${site.name}\nAuthor: ${site.name} web team\nDescription: Custom theme for ${site.name}.\nVersion: 1.4.2\nRequires at least: 6.5\nRequires PHP: 8.1\nText Domain: ${themeSlug(site)}\n*/\n.screen-reader-text{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)}\n.alignleft{float:left;margin-right:1.5em}.alignright{float:right;margin-left:1.5em}.aligncenter{display:block;margin-inline:auto}\n`;
  }
  if (path.includes('/sites/default/files/js/')) return `/* Site behaviours bundle. */\n(function(){document.documentElement.classList.add("js");})();\n${drupalViewsJs()}`;
  if (path.includes('/sites/default/files/css/')) return `${drupalViewsCss()}` + '.visually-hidden{position:absolute!important;clip:rect(1px,1px,1px,1px);overflow:hidden;height:1px;width:1px;word-wrap:normal}.hidden{display:none}.clearfix::after{display:table;clear:both;content:""}.menu--level-1{list-style:none;margin:0;padding:0}.node__content{font-size:1rem}\n';
  if (path.endsWith('.css')) return '.wp-block-group{box-sizing:border-box}.wp-block-columns{display:flex;flex-wrap:wrap;gap:2em}.wp-block-column{flex:1 1 0;min-width:0}.is-layout-constrained>*{margin-inline:auto}.visually-hidden{position:absolute!important;clip:rect(1px,1px,1px,1px);overflow:hidden;height:1px;width:1px}.hidden{display:none}\n';
  return realScript(site, path);
}

export function cmsAssetPaths(site) {
  const { styles, scripts } = cmsFiles(site);
  return [...styles, ...scripts].map(([, path]) => path);
}

function archiveType(page) {
  return /^listing-(.+)-\d+$/.exec(page.pageId ?? '')?.[1] ?? 'record';
}

const postId = (site, page) => page.kind === 'home' ? 2 + seedFor(site.seed, 'front-page') % 40 : 100 + seedFor(site.seed, page.pageId, 'wordpress-post-id') % 90000;
const nodeId = (site, page) => 1 + seedFor(site.seed, page.pageId, 'drupal-node-id') % 20000;
const assetUrl = (site, page, path, query) => siteHref(site, page, query ? `${path}?${query}` : path);

function cmsHead(site, page, canonical) {
  const { styles } = cmsFiles(site);
  const name = escapeHtml(site.name);
  if (site.cmsProfile === 'wordpress') {
    const id = postId(site, page);
    const builder = site.builderProfile === 'elementor' ? '\n<meta name="generator" content="Elementor 3.32.4; features: additional_custom_breakpoints; settings: css_print_method-external, google_font-enabled, font_display-swap">' : '';
    const links = styles.map(([sheet, path, version]) => `<link rel="stylesheet" id="${sheet}" href="${assetUrl(site, page, path, `ver=${version}`)}" media="all">`).join('\n');
    return `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="alternate" type="application/rss+xml" title="${name} &raquo; Feed" href="${siteHref(site, page, '/')}">
${site.sourceClutter === 'realistic' ? '' : `<style id="wp-img-auto-sizes-contain-inline-css">
img:is([sizes=auto i],[sizes^="auto," i]){contain-intrinsic-size:3000px 1500px}
</style>
`}${links}
${site.sourceClutter === 'realistic' ? '' : `<style id="global-styles-inline-css">
:root{--wp--preset--aspect-ratio--square: 1;--wp--preset--aspect-ratio--4-3: 4/3;--wp--preset--color--black: #000000;--wp--preset--color--white: #ffffff;--wp--preset--font-size--small: 13px;--wp--preset--font-size--medium: 20px;--wp--preset--spacing--40: 1rem;--wp--preset--spacing--50: clamp(1.5rem, 3vw, 2rem);}
</style>`}
<script src="${assetUrl(site, page, '/wp-includes/js/jquery/jquery.min.js', `ver=${JQUERY_VERSION}`)}" id="jquery-core-js"></script>
<script src="${assetUrl(site, page, '/wp-includes/js/jquery/jquery-migrate.min.js', 'ver=3.4.1')}" id="jquery-migrate-js"></script>
<meta name="generator" content="WordPress ${WORDPRESS_VERSION}">${builder}
<link rel="shortlink" href="${siteHref(site, page, '/')}?p=${id}">`;
  }
  if (site.cmsProfile === 'drupal') {
    const links = styles.map(([, path, query]) => `<link rel="stylesheet" media="all" href="${assetUrl(site, page, path, query)}">`).join('\n    ');
    const shortlink = page.kind === 'detail' ? `\n<link rel="shortlink" href="${escapeHtml(new URL(`/node/${nodeId(site, page)}`, canonical).href)}">` : '';
    return `<meta name="Generator" content="Drupal ${DRUPAL_MAJOR} (https://www.drupal.org)">
<meta name="MobileOptimized" content="width">
<meta name="HandheldFriendly" content="true">${shortlink}
    ${links}`;
  }
  return '';
}

function cmsBodyClasses(site, page) {
  if (site.cmsProfile === 'wordpress') {
    const type = escapeHtml(page.kind === 'listing' ? archiveType(page) : page.contentType);
    const id = postId(site, page);
    const view = page.kind === 'home' ? `home wp-singular page-template-default page page-id-${id}`
      : page.kind === 'listing' ? `archive post-type-archive post-type-archive-${type}`
        : `wp-singular ${type}-template-default single single-${type} postid-${id} single-format-standard`;
    const builder = site.builderProfile === 'elementor' ? ` elementor-default elementor-kit-7 elementor-page elementor-page-${id}`
      : site.builderProfile === 'beaver-builder' ? ' fl-builder fl-builder-2-9-4 fl-theme-builder-header fl-framework-base fl-preset-default fl-full-width'
        : site.builderProfile === 'divi' ? ` et_pb_button_helper_class et_fixed_nav et_show_nav et_primary_nav_dropdown_animation_fade et_secondary_nav_dropdown_animation_fade et_header_style_left et_pb_footer_columns4 et_cover_background et_pb_gutter et_pb_gutters3 et_pb_pagebuilder_layout et_right_sidebar et_divi_theme et-db`
          : site.builderProfile === 'wpbakery' ? ' wpb-js-composer js-comp-ver-7.9 vc_responsive'
        : site.builderProfile === 'gutenberg' ? ' wp-embed-responsive is-block-theme' : ' wp-embed-responsive';
    return ` ${view} wp-theme-${themeSlug(site)}${builder}`;
  }
  if (site.cmsProfile === 'drupal') {
    if (page.kind === 'home') return ' path-frontpage';
    if (page.kind === 'listing') return ` path-${escapeHtml(archiveType(page))}`;
    return ` path-node page-node-type-${escapeHtml(page.contentType)}`;
  }
  return '';
}

function cmsBodyEnd(site, page) {
  const { scripts } = cmsFiles(site);
  if (site.cmsProfile === 'wordpress') {
    const theme = themeSlug(site);
    const rules = JSON.stringify({ prefetch: [{ source: 'document', where: { and: [{ href_matches: '/*' }, { not: { href_matches: ['/wp-*.php', '/wp-admin/*', '/wp-content/uploads/*', '/wp-content/*', '/wp-content/plugins/*', `/wp-content/themes/${theme}/*`, '/*\\?(.+)'] } }, { not: { selector_matches: 'a[rel~="nofollow"]' } }, { not: { selector_matches: '.no-prefetch, .no-prefetch a' } }] }, eagerness: 'conservative' }] });
    const builder = scripts.filter(([id]) => /^(elementor|divi|wpb_)/.test(id)).map(([id, path, version]) => `\n<script src="${assetUrl(site, page, path, `ver=${version}`)}" id="${id}"></script>`).join('');
    return `\n<script type="speculationrules">\n${rules.replaceAll('<', '\\u003c')}\n</script>${builder}\n`;
  }
  if (site.cmsProfile === 'drupal') {
    const theme = drupalTheme(site);
    const currentPath = page.kind === 'detail' ? `node/${nodeId(site, page)}` : page.kind === 'home' ? 'node' : archiveType(page);
    const settings = JSON.stringify({ path: { baseUrl: '/', pathPrefix: '', currentPath, currentPathIsAdmin: false, isFront: page.kind === 'home', currentLanguage: 'en' },
      pluralDelimiter: '\u0003', suppressDeprecationErrors: true, ajaxPageState: { libraries: token(site, 'drupal-libraries'), theme, theme_token: null },
      ajaxTrustedUrl: [], user: { uid: 0, permissionsHash: token(site, 'drupal-permissions') } })
      .replaceAll('/', '\\/').replaceAll('\u0003', '\\u0003').replaceAll('<', '\\u003c');
    const [[, path, query]] = scripts;
    return `\n    <script type="application/json" data-drupal-selector="drupal-settings-json">${settings}</script>\n<script src="${assetUrl(site, page, path, query)}"></script>\n`;
  }
  return '';
}

// Sector-specific chrome outside <main>, modeled on how real sites in each sector present themselves
// (for example WordPress showcase sites such as whitehouse.gov, nasa.gov, noguchi.org and rollingstone.com,
// and Drupal sites such as boston.gov, ox.ac.uk and public library sites). All links point at pages that exist.
// Each sector has several real-world variants of its header copy; one is chosen per site from the seed.
const CHROME_OPTIONS = {
  library: {
    tagline: ['Borrow, learn and explore', 'Free for everyone, every day', 'Read, discover, connect', 'Your community’s living room', 'Books, ideas and community'],
    notice: ['All branches open today · Free Wi-Fi and printing', 'Summer reading starts June 1 — sign up at any branch', 'Main Library closes at 6 pm on Friday for maintenance', 'New: borrow museum passes with your library card', 'Holds pickup lockers now available 24/7'],
    utility: [[['Hours & Locations', 3], ['Events', 2]], [['Locations', 3], ['Calendar', 2], ['Authors', 1]], [['Branches', 3], ['What’s on', 2]]],
    cta: [['Get a library card', 3], ['My account', 0], ['Renew items', 0], ['Book a room', 3]],
    search: ['Search the catalog', 'Search books, movies, music and more', 'Find books, events and more', 'Search our collection'],
  },
  government: {
    tagline: ['Serving residents across the state', 'Working for every community', 'Programs, guidance and public information', 'Open, accountable government'],
    notice: ['An official website of {name}. Secure pages use HTTPS.', 'Official state website · Here’s how you know', 'Translate this page · Accessibility options available', 'Offices closed Monday for the holiday'],
    utility: [[['Programs', 0], ['Publications', 3]], [['Departments', 1], ['Policies', 2]], [['Publications', 3], ['Departments', 1], ['Programs', 0]]],
    cta: [['Apply for a program', 0], ['Find a service', 0], ['Contact an office', 1], ['Read the latest guidance', 2]],
    search: ['Search this site', 'Search programs and services', 'How can we help?', 'Search state services'],
  },
  municipality: {
    tagline: ['Services for residents, businesses and visitors', 'A city that works for you', 'Proud past, bright future', 'Your city, online'],
    notice: ['Street sweeping resumes Monday. Check the service schedule for your neighborhood.', 'Winter parking ban in effect tonight from 7 pm', 'Trash and recycling on normal schedule this week', 'Water main repair: expect delays downtown'],
    utility: [[['Meetings', 2], ['Public notices', 3]], [['Offices', 1], ['Council meetings', 2]], [['Notices', 3], ['Services', 0], ['Offices', 1]]],
    cta: [['Request a service', 0], ['Pay a bill', 0], ['Report an issue', 0], ['Find an office', 1]],
    search: ['What can we help you find?', 'Search city services', 'Search the city website', 'Search services, notices and meetings'],
  },
  university: {
    tagline: ['Teaching, research and public engagement', 'Knowledge in service of the world', 'Learn. Discover. Lead.', 'Founded on curiosity'],
    notice: ['Applications for next fall are open', 'Campus visit days every Friday — register now', 'Commencement information and livestream', 'Spring course registration begins Monday'],
    utility: [[['Programs', 2], ['Research', 3], ['Faculty directory', 1]], [['Admissions', 2], ['Research', 3]], [['Faculty', 1], ['Courses', 0], ['Programs', 2]]],
    cta: [['Apply', 2], ['Visit', 2], ['Give', 3], ['Request info', 2]],
    search: ['Search the university', 'Search people, programs and news', 'Search site', 'Find a program'],
  },
  healthcare: {
    tagline: ['Care close to home', 'Expert care for every stage of life', 'Healthier together', 'Your neighborhood health partner'],
    notice: ['Medical emergency? Call 911 or go to the nearest emergency department.', 'Flu shots now available at all locations — walk in or book online', 'Visitor policy updated: two visitors per patient', 'Same-day appointments available in primary care'],
    utility: [[['Find a provider', 2], ['Locations', 1]], [['Find a doctor', 2], ['Patient resources', 3]], [['Locations', 1], ['Services', 0], ['Health library', 3]]],
    cta: [['Book an appointment', 0], ['Find a doctor', 2], ['Patient portal', 3], ['Get care now', 0]],
    search: ['Search services, providers or locations', 'Search for a doctor, condition or location', 'How can we help you?', 'Search our site'],
  },
  documentation: {
    tagline: ['Build, integrate and ship', 'Everything you need to integrate', 'Guides, API reference and examples', 'Developer documentation'],
    notice: ['Latest release notes are available', 'v4 is here — read the migration guide', 'API status: all systems operational', 'Deprecation notice: legacy auth ends next quarter'],
    utility: [[['API reference', 1], ['Changelog', 2]], [['Tutorials', 3], ['Reference', 1]], [['Releases', 2], ['Guides', 0], ['API', 1]]],
    cta: [['Get started', 0], ['Quickstart', 0], ['Sign in', 0], ['Get an API key', 0]],
    search: ['Search docs', 'Search documentation', 'Search guides and reference', 'Search… ⌘K'],
  },
  museum: {
    tagline: ['Art, objects and stories', 'Art for everyone', 'Where history comes alive', 'Collections, exhibitions and learning'],
    notice: ['Open today 10:00–17:00 · Free for members', 'Free admission on first Fridays', 'New exhibition opens this weekend', 'Late opening every Thursday until 21:00'],
    utility: [[['Exhibitions', 2], ['Learning', 3]], [['Collection', 0], ['Visit', 2]], [['What’s on', 2], ['Artists', 1], ['Schools', 3]]],
    cta: [['Plan your visit', 2], ['Buy tickets', 2], ['Become a member', 3], ['Visit', 2]],
    search: ['Search the collection', 'Search objects, artists and events', 'Search', 'Explore the collection'],
  },
  nonprofit: {
    tagline: ['Stronger neighborhoods, together', 'Neighbors helping neighbors since 1987', 'Building a community where everyone thrives', 'Local giving, lasting change'],
    notice: ['Every gift is matched this month', 'Volunteer orientation this Saturday at 10 am', 'Our annual report is out', 'Help us reach our winter appeal goal'],
    utility: [[['Volunteer', 3], ['Grants', 1]], [['Our work', 0], ['Reports', 2]], [['Get involved', 3], ['Apply for a grant', 1]]],
    cta: [['Donate', 0], ['Give today', 0], ['Donate now', 0], ['Volunteer', 3]],
    search: ['Search', 'Search our work', 'Search the site', 'Search projects and grants'],
  },
  records: {
    tagline: ['Preserving the public record', 'Your history, preserved', 'Public records and archives', 'Documenting our community since 1852'],
    notice: ['Reading room open by appointment, Tuesday to Saturday', 'Online catalog updated weekly', 'Digitized council minutes now searchable', 'Copy requests take 5–10 business days'],
    utility: [[['Finding aids', 2], ['Visit', 3]], [['Collections', 1], ['Research help', 2]], [['Catalog', 0], ['Reading room', 3]]],
    cta: [['Request a record', 0], ['Book the reading room', 3], ['Ask an archivist', 3], ['Search the catalog', 0]],
    search: ['Search the catalog', 'Search records and collections', 'Search finding aids', 'Search the archives'],
  },
  news: {
    tagline: ['Independent local journalism', 'News that matters to you', 'Reporting since 1891', 'Your community, your news'],
    notice: [null, null, 'Breaking: council budget vote tonight', 'Sign up for our morning newsletter'],
    utility: [[['Features', 2], ['Editions', 3]], [['Writers', 1], ['E-edition', 3]], [['News', 0], ['Opinion', 2], ['Print', 3]]],
    cta: [['Subscribe', 3], ['Subscribe for $1', 3], ['Sign in', 0], ['Get the newsletter', 0]],
    search: ['Search', 'Search articles', 'Search the archive', 'Search news'],
  },
};
const PHONES = { library: '(555) 014-2200', government: '(555) 016-4000', municipality: '311 or (555) 013-1100', university: '(555) 019-3000', healthcare: '(555) 017-8800', documentation: null, museum: '(555) 012-5500', nonprofit: '(555) 015-7700', records: '(555) 018-2400', news: '(555) 011-9000' };
const ALERT_DOMAINS = new Set(['municipality', 'healthcare']);
const CHROME = CHROME_OPTIONS;
const chromeCache = new WeakMap();

function navHref(site, index) {
  const items = Array.isArray(site.navigation) ? site.navigation : [];
  return items[index]?.href ?? items[0]?.href ?? '/';
}

function chromeFor(site) {
  const options = CHROME_OPTIONS[site.domain];
  if (!options) return { tagline: '', notice: null, utility: [], cta: null, search: 'Search', phone: null, header: 0, footer: 0 };
  if (chromeCache.has(site)) return chromeCache.get(site);
  const choose = (key) => options[key][seedFor(site.seed, site.id ?? '', 'chrome', key) % options[key].length];
  const chrome = { tagline: choose('tagline'), notice: choose('notice'), utility: choose('utility'), cta: choose('cta'), search: choose('search'),
    phone: PHONES[site.domain], alert: ALERT_DOMAINS.has(site.domain) && seedFor(site.seed, 'chrome-alert') % 3 !== 0,
    header: seedFor(site.seed, site.id ?? '', 'chrome-header') % 5, footer: seedFor(site.seed, site.id ?? '', 'chrome-footer') % 4,
    utilityBar: seedFor(site.seed, 'chrome-utility') % 5 !== 0 };
  chromeCache.set(site, chrome);
  return chrome;
}

function renderNav(site, page) {
  const items = Array.isArray(site.navigation) ? site.navigation : [];
  const current = item => item.href === page.url;
  if (site.cmsProfile === 'wordpress' && site.builderProfile === 'gutenberg') {
    return `<nav class="site-nav wp-block-navigation is-layout-flex wp-block-navigation-is-layout-flex" aria-label="Primary">
          <ul class="wp-block-navigation__container wp-block-navigation">${items.map(item => `
            <li class="wp-block-navigation-item${current(item) ? ' current-menu-item' : ''} wp-block-navigation-link"><a class="wp-block-navigation-item__content" href="${siteHref(site, page, item.href)}"${current(item) ? ' aria-current="page"' : ''}><span class="wp-block-navigation-item__label">${escapeHtml(item.label)}</span></a></li>`).join('')}
          </ul>
        </nav>`;
  }
  if (site.cmsProfile === 'wordpress') {
    return `<nav id="site-navigation" class="site-nav main-navigation" aria-label="Primary">
          <ul id="primary-menu" class="menu">${items.map((item, index) => {
    const id = 20 + index + seedFor(site.seed, 'menu-item') % 400;
    const object = escapeHtml(String(item.href).split('/').filter(Boolean)[0] ?? 'page');
    return `
            <li id="menu-item-${id}" class="menu-item menu-item-type-post_type_archive menu-item-object-${object}${current(item) ? ' current-menu-item' : ''} menu-item-${id}"><a href="${siteHref(site, page, item.href)}"${current(item) ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a></li>`;
  }).join('')}
          </ul>
        </nav>`;
  }
  if (site.cmsProfile === 'drupal') {
    const theme = drupalTheme(site);
    return `<nav role="navigation" aria-labelledby="block-${theme}-main-menu-menu" id="block-${theme}-main-menu" class="site-nav block block-menu navigation menu--main">
            <h2 class="visually-hidden" id="block-${theme}-main-menu-menu">Main navigation</h2>
            <ul class="menu menu--level-1">${items.map(item => `
              <li class="menu__item menu__item--link menu__item--level-1${current(item) ? ' menu__item--active-trail' : ''}"><a href="${siteHref(site, page, item.href)}" class="menu__link menu__link--link menu__link--level-1${current(item) ? ' is-active' : ''}"${current(item) ? ' aria-current="page"' : ''} data-drupal-link-system-path="${escapeHtml(String(item.href).replace(/^\/|\/$/g, ''))}">${escapeHtml(item.label)}</a></li>`).join('')}
            </ul>
          </nav>`;
  }
  return `<nav class="site-nav" aria-label="Primary">
          <ul>${items.map(item => `
            <li><a href="${siteHref(site, page, item.href)}"${current(item) ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a></li>`).join('')}
          </ul>
        </nav>`;
}

// Inline SVG logo mark (many real sites inline their logo); seeded shape and initials, no text nodes so the link text stays the site name.
function siteLogo(site) {
  const initials = String(site.name).split(/\s+/).filter(word => /^[A-Z]/.test(word) && !['The', 'Of'].includes(word)).slice(0, 2).map(word => word[0]).join('') || 'S';
  const shape = seedFor(site.seed, 'logo-shape') % 4;
  const background = ['<circle cx="20" cy="20" r="19"/>', '<rect x="1" y="1" width="38" height="38" rx="8"/>', '<path d="M20 1 39 20 20 39 1 20Z"/>', '<path d="M4 1h32v26L20 39 4 27Z"/>'][shape];
  const glyphs = initials.split('').map((letter, index) => `<path d="${LOGO_GLYPHS[letter] ?? LOGO_GLYPHS.S}" transform="translate(${initials.length === 1 ? 13 : 7 + index * 13} 11) scale(0.55)"/>`).join('');
  return `<svg class="site-logo" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><g fill="currentColor">${background}</g><g fill="none" stroke="var(--paper, #fff)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${glyphs}</g></svg>`;
}

const LOGO_GLYPHS = Object.fromEntries(Object.entries({
  A: 'M2 32 12 2 22 32M6 20h12', B: 'M3 2v30h11a8 8 0 0 0 0-16H3m0 0h9a7 7 0 0 0 0-14H3', C: 'M22 6A14 14 0 1 0 22 28', D: 'M3 2v30h8A15 15 0 0 0 11 2Z', E: 'M21 2H3v30h18M3 17h14', F: 'M21 2H3v30M3 17h14', G: 'M22 7A14 14 0 1 0 23 22v-5h-9', H: 'M3 2v30M21 2v30M3 17h18', I: 'M12 2v30M6 2h12M6 32h12', J: 'M18 2v22a8 8 0 0 1-16 0', K: 'M3 2v30M21 2 3 20l18 12', L: 'M3 2v30h18', M: 'M2 32V2l10 16L22 2v30', N: 'M3 32V2l18 30V2', O: 'M12 2a12 15 0 1 0 0.1 0Z', P: 'M3 32V2h10a8 8 0 0 1 0 16H3', Q: 'M12 2a12 15 0 1 0 0.1 0ZM14 24l8 8', R: 'M3 32V2h10a8 8 0 0 1 0 16H3m9 0 9 14', S: 'M21 6c-3-5-18-5-18 3 0 9 18 6 18 15 0 9-16 9-19 3', T: 'M2 2h20M12 2v30', U: 'M3 2v20a9 9 0 0 0 18 0V2', V: 'M2 2 12 32 22 2', W: 'M1 2l5 30 6-20 6 20 5-30', X: 'M3 2l18 30M21 2 3 32', Y: 'M2 2l10 14L22 2M12 16v16', Z: 'M3 2h18L3 32h18',
}));

function renderHeader(site, page) {
  const chrome = chromeFor(site);
  const utility = chrome.utility.map(([label, index]) => `<a href="${siteHref(site, page, navHref(site, index))}">${escapeHtml(label)}</a>`).join('\n          ');
  const notice = chrome.notice ? `<p class="utility-notice">${escapeHtml(chrome.notice.replace('{name}', site.name))}</p>` : `<p class="utility-notice utility-date">${escapeHtml(new Date(Date.UTC(2026, seedFor(site.seed, page.pageId, 'dateline') % 12, 1 + seedFor(site.seed, page.pageId, 'dateline-day') % 27)).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }))}</p>`;
  const bar = `<div class="utility-bar${chrome.alert ? ' utility-alert' : ''}" role="region" aria-label="Site notice">
      <div class="header-inner utility-inner">
        ${notice}
        <div class="utility-links">
          ${utility}
        </div>
      </div>
    </div>`;
  const brandClass = site.cmsProfile === 'drupal' ? `site-branding block block-system block-system-branding-block` : site.cmsProfile === 'wordpress' ? 'site-branding' : 'site-branding';
  const brandId = site.cmsProfile === 'drupal' ? ` id="block-${drupalTheme(site)}-site-branding"` : '';
  const brand = `<div${brandId} class="${brandClass}">
          <a class="site-name" href="${siteHref(site, page, '/')}" rel="home">${CHROME[site.domain] && site.visualStyle !== 'legacy' ? siteLogo(site) : ''}${escapeHtml(site.name)}</a>
          ${chrome.tagline ? `<p class="site-description site-slogan">${escapeHtml(chrome.tagline)}</p>` : ''}
        </div>`;
  const search = `<form role="search" method="get" class="site-search search-form" action="${siteHref(site, page, '/')}">
          <label><span class="visually-hidden screen-reader-text">${escapeHtml(chrome.search)}</span><input type="search" class="search-field" placeholder="${escapeHtml(chrome.search)}" name="${site.cmsProfile === 'drupal' ? 'keys' : 's'}"></label>
          <button type="submit" class="search-submit">Search</button>
        </form>`;
  // The link keeps its section page (the crawlable link graph is unchanged); site-actions.js sends a click on a
  // sign-in, request or search label to that page instead (src/render/browser/site-actions.js).
  const cta = chrome.cta ? `<a class="header-cta" href="${siteHref(site, page, navHref(site, chrome.cta[1]))}">${escapeHtml(chrome.cta[0])}</a>` : '';
  const variant = CHROME_OPTIONS[site.domain] ? ` header-v-${chrome.header}` : '';
  const headerAttrs = platformHeaderAttrs(site, variant) ?? (site.cmsProfile === 'drupal' ? ` id="header" class="site-header${variant}" data-drupal-selector="site-header" role="banner"`
    : site.cmsProfile === 'wordpress' && site.builderProfile === 'gutenberg' ? ` class="site-header${variant} wp-block-template-part"`
      : site.cmsProfile === 'wordpress' ? ` id="masthead" class="site-header${variant}"` : ` class="site-header${variant}"`);
  const region = site.cmsProfile === 'drupal' ? ['<div class="region region-header">', '</div>'] : ['', ''];
  return `${chrome.utilityBar === false ? '' : bar}
    <header${headerAttrs}>
      <div class="header-inner">
        ${region[0]}${brand}
        <div class="header-tools">
          ${search}
          ${cta}
        </div>${region[1]}
      </div>
      <div class="header-inner header-nav">
        ${renderNav(site, page)}
      </div>
    </header>`;
}

function renderFooter(site, page, ctx = null) {
  const chrome = chromeFor(site);
  const items = Array.isArray(site.navigation) ? site.navigation : [];
  const year = 2026;
  const fv = CHROME_OPTIONS[site.domain] ? ` footer-v-${chrome.footer}` : '';
  const attrs = platformFooterAttrs(site, fv) ?? (site.cmsProfile === 'wordpress' ? ` id="colophon" class="site-footer${fv}"` : site.cmsProfile === 'drupal' ? ` class="site-footer${fv}" role="contentinfo"` : ` class="site-footer${fv}"`);
  const contact = chrome.phone ? `<p>${escapeHtml(chrome.phone)}</p>` : '';
  return `<footer${attrs}>
      <div class="site-footer-inner">
        <div class="footer-brand">
          <p class="footer-name">${escapeHtml(site.name)}</p>
          ${chrome.tagline ? `<p>${escapeHtml(chrome.tagline)}</p>` : ''}
          ${contact}
        </div>
        <nav class="footer-links" aria-label="Footer">
          <ul>${items.map(item => `
            <li><a href="${siteHref(site, page, item.href)}">${escapeHtml(item.label)}</a></li>`).join('')}
          </ul>
        </nav>
        <p class="footer-legal">&copy; ${year} ${escapeHtml(site.name)}. All rights reserved. This is a fictional test website.</p>
      </div>${ctx ? `\n      ${footerInnerClutter(site, page, ctx)}` : ''}
    </footer>`;
}

function cmsMarkup(site, page, body) {
  if (site.cmsProfile === 'wordpress') {
    let content = body;
    if (site.builderProfile === 'gutenberg') content = `<div class="wp-block-group is-layout-constrained"><div class="wp-block-columns"><div class="wp-block-column">${content}</div></div></div>`;
    if (site.builderProfile === 'elementor') {
      const documentId = seedFor(site.seed, page.pageId, 'elementor-document');
      const containerId = seedFor(site.seed, page.pageId, 'elementor-container').toString(16).padStart(8, '0');
      const widgetId = seedFor(site.seed, page.pageId, 'elementor-widget').toString(16).padStart(8, '0');
      content = `<div class="elementor elementor-${documentId}" data-elementor-type="wp-post" data-elementor-id="${documentId}" data-elementor-settings="[]"><div class="elementor-element elementor-element-${containerId} e-con e-parent" data-id="${containerId}" data-element_type="container"><div class="elementor-element elementor-element-${widgetId} elementor-widget elementor-widget-html" data-id="${widgetId}" data-element_type="widget" data-widget_type="html.default"><div class="elementor-widget-container">${content}</div></div></div></div>`;
    }
    if (site.builderProfile === 'beaver-builder') {
      const node = kind => seedFor(site.seed, page.pageId, `beaver-${kind}`).toString(16).padStart(8, '0');
      const row = node('row');
      const group = node('group');
      const column = node('column');
      const module = node('module');
      content = `<div class="fl-builder-content"><div class="fl-row fl-row-fixed-width fl-row-bg-none fl-node-${row}" data-node="${row}"><div class="fl-row-content-wrap"><div class="fl-row-content fl-row-fixed-width fl-node-content"><div class="fl-col-group fl-node-${group}" data-node="${group}"><div class="fl-col fl-node-${column}" data-node="${column}"><div class="fl-col-content fl-node-content"><div class="fl-module fl-module-html fl-node-${module}" data-node="${module}"><div class="fl-module-content fl-node-content"><div class="fl-html">${content}</div></div></div></div></div></div></div></div></div></div>`;
    }
    if (site.builderProfile === 'divi') {
      // Divi: section > row > column > text module, each with a numbered _0 class and the inner wrapper.
      content = `<div id="et-boc" class="et-boc"><div class="et-l et-l--post"><div class="et_builder_inner_content et_pb_gutters3"><div class="et_pb_section et_pb_section_0 et_section_regular"><div class="et_pb_row et_pb_row_0"><div class="et_pb_column et_pb_column_4_4 et_pb_column_0 et_pb_css_mix_blend_mode_passthrough et-last-child"><div class="et_pb_module et_pb_text et_pb_text_0 et_pb_text_align_left et_pb_bg_layout_light"><div class="et_pb_text_inner">${content}</div></div></div></div></div></div></div></div>`;
    }
    if (site.builderProfile === 'wpbakery') {
      // WPBakery: rows, column containers and wpb_wrapper divs around a text column element.
      const css = seedFor(site.seed, page.pageId, 'wpbakery-css');
      content = `<div class="wpb-content-wrapper"><div class="vc_row wpb_row vc_row-fluid vc_custom_${css}"><div class="wpb_column vc_column_container vc_col-sm-12"><div class="vc_column-inner"><div class="wpb_wrapper"><div class="wpb_text_column wpb_content_element"><div class="wpb_wrapper">${content}</div></div></div></div></div></div></div>`;
    }
    const type = escapeHtml(page.contentType);
    return `<article class="${type} type-${type} status-publish hentry"><div class="entry-content">${content}</div></article>`;
  }
  if (site.cmsProfile === 'drupal' && page.kind === 'listing') return `<div class="region region-content">${body}</div>`;
  if (site.cmsProfile === 'drupal') return `<div class="region region-content"><article class="node node--type-${escapeHtml(page.contentType)} node--view-mode-full"><div class="node__content">${body}</div></article></div>`;
  if (isPlatform(site)) return platformContent(site, page, body);
  return body;
}

function documentHtml(site, page, main) {
  const rootReady = site.framework === 'html' ? ' data-ready="true"' : '';
  const description = page.fields?.summary ?? page.title;
  const canonical = new URL(page.url, site.baseUrl).href;
  const variantCss = site.shell ? `\n  <link rel="stylesheet" href="${siteHref(site, page, '/assets/site-variants.css')}">` : '';
  const shellClass = site.shell ? ` shell-${escapeHtml(site.shell)}` : '';
  const cmsClass = site.cmsProfile && site.cmsProfile !== 'none' ? ` cms-${escapeHtml(site.cmsProfile)}` : '';
  const themeClass = CHROME[site.domain] ? ` theme-${escapeHtml(site.domain)}` : '';
  const look = site.visualStyle !== 'legacy' ? siteLook(site) : { className: '', css: '' };
  const lookClass = look.className ? ` ${look.className}` : '';
  const base = site.linkMode === 'base-relative' ? '\n  <base href="/">' : '';
  const skipHref = site.linkMode === 'base-relative' ? siteHref(site, page, `${page.url}#content`) : '#content';
  const lang = site.cmsProfile === 'wordpress' ? 'en-US' : isPlatform(site) ? platformLang(site) : 'en';
  const dir = site.cmsProfile === 'drupal' ? ' dir="ltr"' : '';
  const separator = site.cmsProfile === 'wordpress' ? ' &#8211; ' : isPlatform(site) ? platformTitleSeparator(site) : ' | ';
  const title = page.kind === 'home' && site.cmsProfile === 'wordpress' && chromeFor(site).tagline ? `${escapeHtml(site.name)} &#8211; ${escapeHtml(chromeFor(site).tagline)}` : page.kind === 'home' && site.cmsProfile === 'drupal' ? `Home | ${escapeHtml(site.name)}` : page.kind === 'home' && page.title === site.name ? escapeHtml(site.name) : `${escapeHtml(page.title)}${separator}${escapeHtml(site.name)}`;
  const platformCtx = { href: path => siteHref(site, page, path), canonical };
  const cms = isPlatform(site) ? platformHead(site, page, platformCtx) : cmsHead(site, page, canonical);
  const messages = site.cmsProfile === 'drupal' ? '\n    <div data-drupal-messages-fallback class="hidden"></div>' : platformBeforeMain(site);
  const clutter = site.sourceClutter === 'realistic' && CHROME[site.domain];
  const ctx = clutter ? { href: path => siteHref(site, page, path), esc: escapeHtml, canonical } : null;
  const extraHead = clutter ? `\n${headClutter(site, page, ctx)}` : '';
  const bodyOpen = clutter ? `\n  ${bodyOpenClutter(site, page, ctx)}` : '';
  const preFooter = clutter ? `\n  ${beforeFooterClutter(site, page, ctx)}` : '';
  const bodyEnd = clutter ? `\n${bodyEndClutter(site, page, ctx)}` : '';
  return `<!doctype html>
<html lang="${lang}"${dir}${platformHtmlAttrs(site, page)}${rootReady}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">${base}
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="stylesheet" href="${siteHref(site, page, '/assets/site.css')}">${variantCss}
  <link rel="icon" href="${siteHref(site, page, '/assets/collection.png')}">${look.css ? `\n  <style id="site-look">\n${look.css}  </style>` : ''}${cms ? `\n${cms}` : ''}${extraHead}
</head>
<body${platformBodyAttrs(site, page)} class="style-${site.visualStyle} ${domainClass(site.domain)}${themeClass}${lookClass}${shellClass}${cmsClass}${cmsBodyClasses(site, page)}${platformBodyClasses(site, page)}">${platformBodyStart(site, page)}${bodyOpen}
    <a class="skip-link" href="${skipHref}">Skip to content</a>
    ${renderHeader(site, page)}${messages}
    ${main}${preFooter}
    ${renderFooter(site, page, ctx)}${cmsBodyEnd(site, page)}${platformBodyEnd(site, page, platformCtx)}${bodyEnd}
<script src="${siteHref(site, page, RUNTIME_ASSET)}" defer></script>
</body>
</html>
`;
}

// A site page outside the answer key (search results, my list, sign-in, request forms): the site's own header and
// footer around `body`, marked noindex. Used by generator.mjs for the pages in src/render/site-runtime.mjs.
export function renderUtilityPage(site, { path, title, body }) {
  assertSupported(site);
  // Without the per-page source clutter (inline CSS, tracking blocks): these pages only need the header and footer.
  site = { ...site, sourceClutter: 'none' };
  const page = { pageId: `utility${path}`, url: path, kind: 'listing', contentType: 'page', title, fields: { summary: `${title} — ${site.name}` }, noiseEvents: [] };
  const main = `<main id="content" class="page-shell layout-reference utility-page"><p class="breadcrumb"><a href="${siteHref(site, page, '/')}">Home</a> / ${escapeHtml(title)}</p><header class="page-heading"><p class="kicker">${escapeHtml(site.name)}</p><h1>${escapeHtml(title)}</h1></header>${body}</main>`;
  return documentHtml(site, page, main)
    .replace(/<meta name="robots" content="[^"]*">\n?/g, '')
    .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="robots" content="noindex, nofollow">');
}

export function renderPage(site, page) {
  assertSupported(site);
  if (!page || !['home', 'listing', 'detail'].includes(page.kind)) throw new Error(`Unsupported page kind: ${page?.kind ?? 'missing'}`);
  return documentHtml(site, page, renderMain(site, page));
}

function findElement(node, tagName) {
  if (node?.tagName === tagName) return node;
  for (const child of node?.childNodes ?? []) {
    const found = findElement(child, tagName);
    if (found) return found;
  }
  return null;
}

export function finalizePage(site, page, mutatedHtml) {
  assertSupported(site);
  if (site.framework === 'html') return mutatedHtml;
  if (typeof mutatedHtml !== 'string') throw new TypeError('mutatedHtml must be a string');
  const document = parse5.parse(mutatedHtml, { sourceCodeLocationInfo: true });
  const location = findElement(document, 'main')?.sourceCodeLocation;
  if (!location || !Number.isInteger(location.startOffset) || !Number.isInteger(location.endOffset)) {
    throw new Error('Client rendering requires a main element after structural mutations');
  }
  const publicMain = mutatedHtml.slice(location.startOffset, location.endOffset);
  const payload = JSON.stringify([publicMain, Math.max(0, Number(page.delayMs) || 0)])
    .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  const bundle = site.framework === 'react' ? 'react-app.js' : 'angular-app.js';
  const shell = `<site-app class="client-root" aria-busy="true"></site-app><script id="page-data" type="application/json">${payload}</script><script type="module" src="${siteHref(site, page, `/assets/${bundle}`)}"></script>`;
  return mutatedHtml.slice(0, location.startOffset) + shell + mutatedHtml.slice(location.endOffset);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const DOMAIN_PALETTES = {
  library: [[11, 110, 121], [238, 246, 245], [242, 181, 68], [8, 80, 90]],
  government: [[22, 46, 81], [240, 240, 240], [181, 9, 9], [0, 94, 162]],
  municipality: [[24, 113, 189], [255, 255, 255], [252, 182, 26], [9, 31, 47]],
  university: [[140, 21, 21], [244, 244, 244], [46, 45, 41], [109, 14, 14]],
  healthcare: [[0, 121, 122], [238, 247, 247], [16, 53, 58], [0, 91, 92]],
  documentation: [[15, 23, 42], [241, 245, 249], [37, 99, 235], [96, 165, 250]],
  museum: [[17, 17, 17], [245, 245, 243], [196, 196, 190], [0, 0, 0]],
  nonprofit: [[46, 125, 50], [241, 248, 241], [191, 54, 12], [27, 94, 32]],
  records: [[109, 76, 47], [241, 235, 223], [138, 59, 18], [78, 52, 32]],
  news: [[18, 18, 18], [247, 247, 247], [196, 22, 28], [80, 80, 80]],
};

function collectionPng(domain, theme) {
  const width = 480;
  const height = 640;
  let hash = 2166136261;
  for (const character of String(domain ?? 'site')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const palettes = [
    [[23, 107, 85], [246, 244, 236], [163, 59, 59], [37, 42, 44]],
    [[163, 59, 59], [250, 248, 241], [23, 107, 85], [43, 46, 47]],
    [[45, 53, 54], [244, 246, 241], [23, 107, 85], [163, 59, 59]],
  ];
  const colors = DOMAIN_PALETTES[theme] ?? palettes[hash % palettes.length];
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const band = Math.floor((x + ((hash >>> 8) % 90) + y * 0.18) / 92) % 4;
      const inset = x > 56 && x < width - 56 && y > 72 && y < height - 72;
      const frame = inset && (x < 72 || x >= width - 72 || y < 88 || y >= height - 88);
      const circle = (x - width * 0.5) ** 2 + (y - height * 0.43) ** 2 < 92 ** 2;
      const color = frame ? colors[3] : circle ? colors[2] : inset ? colors[(band + 1) % 2] : colors[band % 2];
      const offset = row + 1 + x * 4;
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function buildFrameworkBundle(framework) {
  if (bundleBuilds.has(framework)) return bundleBuilds.get(framework);
  const task = buildUncached(framework);
  bundleBuilds.set(framework, task);
  return task;
}

async function buildUncached(framework) {
  const output = join(CACHE_DIR, `${framework}-app.js`);
  const { build } = await import('esbuild');
  await mkdir(CACHE_DIR, { recursive: true });
  await build({
    entryPoints: [join(SOURCE_DIR, 'browser', `${framework}-app.mjs`)], outfile: output,
    bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], minify: true, legalComments: 'inline',
  });
  return readFile(output);
}

export async function prepareAssets(site, publicDir) {
  assertSupported(site);
  if (typeof publicDir !== 'string' || !publicDir) throw new TypeError('publicDir must be a path');
  const assetsDir = join(publicDir, 'assets');
  await mkdir(assetsDir, { recursive: true });
  const tasks = [
    // Sector page designs ship inside the site stylesheet (one file, like most real themes).
    readFile(join(SOURCE_DIR, 'site.css')).then((css) => writeFile(join(assetsDir, 'site.css'), `${site.visualStyle !== 'legacy' && CHROME[site.domain] ? `${css}\n${innerCss()}` : css}\n${homeCss()}`)),
    writeFile(join(publicDir, ...RUNTIME_ASSET.slice(1).split('/')), runtimeScript(site)),
    writeFile(join(assetsDir, 'collection.png'), hasIllustration(site.domain) ? illustrationPng(site.domain, `${site.seed}:0`) : collectionPng(site.domain, site.domain)),
  ];
  if (site.shell) {
    tasks.push(readFile(join(SOURCE_DIR, 'site-variants.css')).then((css) => writeFile(join(assetsDir, 'site-variants.css'), css)));
    for (let variant = 1; variant <= 4; variant++) {
      tasks.push(writeFile(join(assetsDir, `collection-${variant}.png`), hasIllustration(site.domain) ? illustrationPng(site.domain, `${site.seed}:${variant}`) : collectionPng(`${site.domain}:${site.seed}:${variant}`, site.domain)));
    }
  }
  if (site.mediaPool && hasIllustration(site.domain)) {
    tasks.push(mkdir(join(assetsDir, 'media'), { recursive: true }).then(() => Promise.all([
      ...Array.from({ length: MEDIA_POOL.scenes }, (_, i) => writeFile(join(assetsDir, 'media', `${site.domain}-${i + 1}.png`), illustrationPng(site.domain, `${site.seed}:media:${i}`))),
      ...Array.from({ length: MEDIA_POOL.portraits }, (_, i) => writeFile(join(assetsDir, 'media', `portrait-${i + 1}.png`), illustrationPng('portrait', `${site.seed}:portrait:${i}`))),
    ])));
  }
  if (site.noise?.types?.includes('builder-modules')) {
    // Local files for the page-builder module noise (src/noise/builder-modules.mjs): a decoy photo and an audio clip.
    tasks.push(mkdir(join(assetsDir, 'media'), { recursive: true }).then(() => Promise.all([
      writeFile(join(assetsDir, 'media', 'builder-photo.png'), hasIllustration(site.domain) ? illustrationPng(site.domain, `${site.seed}:builder`) : collectionPng(`${site.domain}:${site.seed}:builder`, site.domain)),
      writeFile(join(assetsDir, 'media', 'builder-sample.wav'), builderSampleWav()),
    ])));
  }
  if (site.sourceClutter === 'realistic' && CHROME[site.domain]) {
    for (const { path, body } of clutterAssetFiles(site)) {
      const file = join(publicDir, ...path.slice(1).split('/'));
      tasks.push(mkdir(dirname(file), { recursive: true }).then(() => writeFile(file, body)));
    }
  }
  for (const path of cmsAssetPaths(site)) {
    const file = join(publicDir, ...path.slice(1).split('/'));
    tasks.push(mkdir(dirname(file), { recursive: true }).then(() => writeFile(file, cmsAssetBody(site, path))));
  }
  for (const path of platformAssetPaths(site)) {
    const file = join(publicDir, ...path.slice(1).split('/'));
    tasks.push(mkdir(dirname(file), { recursive: true }).then(() => writeFile(file, platformAssetBody(site, path))));
  }
  if (site.framework !== 'html') {
    tasks.push(buildFrameworkBundle(site.framework).then((bundle) => writeFile(join(assetsDir, `${site.framework}-app.js`), bundle)));
  }
  await Promise.all(tasks);
}
