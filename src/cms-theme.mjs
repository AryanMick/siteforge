// WordPress and Drupal theme packages for a generated site.
//
// SiteForge is a test-site generator, not a CMS product. This exporter only exists so the same fictional site can be
// served by a real WordPress or Drupal install. The CMS then adds its own head tags, scripts, body classes and wrappers
// ("CMS noise") around page content that is copied byte-for-byte from the generated site, so every answer-key URL and
// field location still holds.
//
// Each package carries its content in three files, read as a stream so big sites import within a web request's memory
// limit: content/site.json (site, front page, content types, page count), content/lines.json (the line table) and
// content/pages.ndjson (one page per line). Each page is split into: head lines, body attributes,
// chrome before <main>, the <main> element itself and chrome after it. Lines repeated across pages (header, footer,
// inline styles) are stored once, which keeps the package and the CMS database small.
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { rebaseHtml } from './rebase-html.mjs';

// The generation address in links and the client app's page data (fully qualified and mixed link modes) is replaced by
// this placeholder in the package, and by the CMS's own address when the CMS imports or serves the page, as the
// SiteForge preview does. Visible text and deliberate wrong-host links stay unchanged.
export const ORIGIN_PLACEHOLDER = 'http://siteforge-origin.invalid';
export function packagePageHtml(html, origin) {
  return origin && html.includes(`//${new URL(origin).host}`) ? rebaseHtml(html, ORIGIN_PLACEHOLDER, origin) : html;
}

export const CMS_TARGETS = ['wordpress', 'drupal'];
// The largest site SiteForge generates. Both CMSs import in time-limited batches with flat memory use (see README).
export const MAX_CMS_PAGES = 100000;

// Head lines the real CMS prints itself; keeping SiteForge's imitation copies would duplicate them. Other platforms'
// generator tags (Joomla, HubSpot, Elementor...) stay: they are part of the generated site's own fingerprint.
const HEAD_DROP = {
  common: [/^\s*<meta charset/i, /^\s*<link rel="canonical"/i, /^\s*<link rel="shortlink"/i, /^\s*<meta name="generator" content="(WordPress|Drupal)\b/i],
  wordpress: [/^\s*<script src="[^"]*\/wp-includes\/[^"]*"[^>]*><\/script>\s*$/i, /^\s*<link rel="stylesheet" id="wp-block-library-css"/i, /^\s*<meta name=['"]robots['"]/i, /^\s*<link rel="alternate" type="application\/rss\+xml"/i],
  drupal: [/^\s*<meta name="(viewport|MobileOptimized|HandheldFriendly)"/i],
};
// Multi-line head elements WordPress core prints itself (inline styles and emoji settings with fixed ids).
const WORDPRESS_HEAD_BLOCKS = /<(style|script)\b[^>]*\bid=["'](global-styles-inline-css|wp-img-auto-sizes-contain-inline-css|wp-emoji-styles-inline-css|wp-block-library-inline-css|classic-theme-styles-inline-css|wp-emoji-settings)["'][^>]*>[\s\S]*?<\/\1>/g;
// Body classes SiteForge's WordPress imitation emits and WordPress core prints itself; only removed from sites
// generated with the WordPress profile (page builders' classes are kept: a real site with that plugin has them).
const WORDPRESS_CORE_CLASS = /^(home|archive|single|page|wp-singular|page-template-default|single-format-standard|wp-embed-responsive|is-block-theme|page-id-\d+|postid-\d+|post-type-archive(-[a-z0-9_-]+)?|single-[a-z0-9_-]+|[a-z0-9_-]+-template-default|wp-theme-[a-z0-9-]+)$/;
// Body scripts and placeholders the real CMS prints itself.
const BODY_DROP = {
  common: [/\n?<script type="speculationrules">[\s\S]*?<\/script>/g, /\n?\s*<script type="application\/json" data-drupal-selector="drupal-settings-json">[\s\S]*?<\/script>/g],
  drupal: [/\n?\s*<div data-drupal-messages-fallback(="")? class="hidden"><\/div>/g],
};

function slugify(text, max = 60) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max) || 'site';
}

function decodeTitle(html) {
  return html.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&raquo;/g, '»').replace(/&laquo;/g, '«').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// Splits one generated page. Returns null when the file is not a full page (the caller then serves it as a static file).
export function splitPage(html, cms, sourceProfile = 'none') {
  const headStart = html.indexOf('<head>'), headEnd = html.indexOf('</head>');
  const bodyOpen = html.indexOf('<body', headEnd);
  const bodyOpenEnd = html.indexOf('>', bodyOpen) + 1;
  const bodyClose = html.lastIndexOf('</body>');
  if (headStart < 0 || headEnd < 0 || bodyOpen < 0 || bodyClose < bodyOpenEnd) return null;
  let head = html.slice(headStart + 6, headEnd);
  const title = decodeTitle(/<title>([\s\S]*?)<\/title>/i.exec(head)?.[1]?.trim() ?? '');
  if (cms === 'wordpress') head = head.replace(WORDPRESS_HEAD_BLOCKS, '');
  // <html> attributes other than lang/dir (which the CMS prints): Webflow's data-wf-*, data-ready, xmlns:og...
  const htmlTag = /<html\b([^>]*)>/i.exec(html.slice(0, headStart))?.[1] ?? '';
  const htmlAttrs = [...htmlTag.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].filter(([, name]) => !['lang', 'dir'].includes(name.toLowerCase())).map(([, name, value]) => [name, value ?? null]);
  const drop = [...HEAD_DROP.common, ...(HEAD_DROP[cms] ?? [])];
  // The CMS prints the page's own <title>; only that first one is dropped, so extra <title> noise stays in the page.
  let titleDropped = false;
  const headLines = head.split('\n').filter(line => {
    if (!titleDropped && /^\s*<title>.*<\/title>\s*$/i.test(line)) { titleDropped = true; return false; }
    return line.trim() && !drop.some(pattern => pattern.test(line));
  });
  const bodyTag = html.slice(bodyOpen + 5, bodyOpenEnd - 1);
  const dropClass = cms === 'wordpress' && sourceProfile === 'wordpress';
  const classes = (/\sclass="([^"]*)"/.exec(bodyTag)?.[1] ?? '').split(/\s+/).filter(name => name && !(dropClass && WORDPRESS_CORE_CLASS.test(name))).join(' ');
  const attrs = bodyTag.replace(/\sclass="[^"]*"/, '').trim();
  let body = html.slice(bodyOpenEnd, bodyClose);
  for (const pattern of [...BODY_DROP.common, ...(BODY_DROP[cms] ?? [])]) body = body.replace(pattern, '');
  // Pages whose <main> was removed by noise, or is built in the browser (React/Angular), keep the whole body as content.
  let mainStart = body.search(/<main[\s>]/);
  let mainEnd = mainStart < 0 ? -1 : body.indexOf('</main>', mainStart);
  const wholeBody = mainStart < 0 || mainEnd < 0;
  if (wholeBody) { mainStart = 0; mainEnd = body.length - 7; }
  // The WordPress imitation's menu-item-N ids could collide with the real WordPress menu's ids (outside <main> only).
  const chrome = text => (cms === 'wordpress' && sourceProfile === 'wordpress' ? text.replace(/ id="menu-item-\d+"/g, '') : text);
  return { title, htmlAttrs, headLines, classes, attrs, before: chrome(body.slice(0, mainStart)), main: wholeBody ? chrome(body) : body.slice(mainStart, mainEnd + 7), after: chrome(body.slice(mainEnd + 7)) };
}

// Line table: lines that appear on more than one page (header, footer, shared styles) are stored once; a page keeps
// [start, length] runs of their indices. Lines unique to one page are kept in the page itself as a plain string, so the
// table the CMS loads on every request stays small (about 150 KB instead of 5 MB for a 1,000-page site).
function encodeRuns(index, textLines) {
  const runs = [];
  for (const line of textLines) {
    const last = runs.at(-1);
    const n = index.get(line);
    if (n === undefined) {
      if (typeof last === 'string') runs[runs.length - 1] = `${last}\n${line}`; else runs.push(line);
    } else if (Array.isArray(last) && last[0] + last[1] === n) last[1]++;
    else runs.push([n, 1]);
  }
  return runs;
}

export function decodeRuns(lines, runs) {
  return runs.flatMap(run => (typeof run === 'string' ? [run] : lines.slice(run[0], run[0] + run[1]))).join('\n');
}

const layoutLines = parts => [...parts.headLines, ...parts.before.split('\n'), ...parts.after.split('\n')];

// The answer-key facts a package needs: site details and each page's url, title, kind and content type. Big sites keep
// their pages in private/answer-pages/ (250 per file) next to answer-key.json (300 MB for 100,000 pages); those are read
// one file at a time and only the head of answer-key.json is parsed, so memory stays small.
const ANSWER_CHUNK = 250;
const outlinePage = page => ({ url: page.url, title: page.title, kind: page.kind, contentType: page.contentType });
async function answerOutline(siteDirectory) {
  const privateRoot = join(siteDirectory, 'private');
  const index = await readFile(join(privateRoot, 'answer-index.json'), 'utf8').then(JSON.parse, () => null);
  if (index && Number.isInteger(index.pageCount) && index.pageCount > 0) {
    const site = await answerSiteHead(join(privateRoot, 'answer-key.json'));
    const files = Array.from({ length: Math.ceil(index.pageCount / ANSWER_CHUNK) }, (_, chunk) => join(privateRoot, 'answer-pages', `${chunk}.json`));
    if (site && (await Promise.all(files.map(file => stat(file).then(() => true, () => false)))).every(Boolean)) {
      return { site, count: index.pageCount, async *pages() {
        let count = 0;
        for (const file of files) for (const page of JSON.parse(await readFile(file, 'utf8'))) { count++; yield outlinePage(page); }
        if (count !== index.pageCount) throw new Error(`${privateRoot}: answer pages changed while the package was being built`);
      } };
    }
  }
  const answers = JSON.parse(await readFile(join(privateRoot, 'answer-key.json'), 'utf8').catch(() => readFile(join(privateRoot, 'ground-truth.json'), 'utf8'))
    .catch(error => { throw error.code === 'ENOENT' ? new Error(`No answer key in ${privateRoot}: point to a generated site folder (the one with public/ and private/)`) : error; }));
  const pages = answers.pages.map(outlinePage);
  return { site: answers.site, count: pages.length, async *pages() { yield* pages; } };
}
// The "site" object at the start of answer-key.json, read without parsing the rest; null when it is not found early.
async function answerSiteHead(file) {
  let handle;
  try { handle = await open(file, 'r'); } catch { return null; }
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const start = text.indexOf('"site":{');
    if (start < 0) return null;
    let depth = 0, inString = false;
    for (let i = start + 7; i < text.length; i++) {
      const c = text[i];
      if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start + 7, i + 1));
    }
    return null;
  } finally { await handle.close(); }
}

// The file of a page URL (pages are folders with an index.html).
const pageFile = url => join(url.replace(/^\/+/, ''), 'index.html');

// First pass over a generated site: which pages exist, which lines are shared, and a content hash. Page HTML is read one
// file at a time and not kept, and the answer pages are read again for the second pass instead of being kept, so memory
// stays nearly flat (100,000 pages are about 2.5 GB of HTML).
export async function scanSite(siteDirectory, cms) {
  if (!CMS_TARGETS.includes(cms)) throw new Error(`cms must be one of ${CMS_TARGETS.join(', ')}`);
  const outline = await answerOutline(siteDirectory);
  if (outline.count > MAX_CMS_PAGES) throw new Error(`CMS theme packages support up to ${MAX_CMS_PAGES.toLocaleString('en-US')} pages; this site has ${outline.count.toLocaleString('en-US')}`);
  const publicRoot = join(siteDirectory, 'public');
  const { site } = outline;
  const sourceProfile = site.cmsProfile ?? 'none';
  const origin = new URL(site.baseUrl ?? 'http://127.0.0.1:4310').origin;
  const hash = createHash('sha256').update(`siteforge-cms-4\0${cms}\0${sourceProfile}\0${site.name}\0`);
  // Lines seen once are remembered in a fixed 16 MB Bloom filter (no string kept per line; the same size for 100 or
  // 100,000 pages); lines seen again are copied into the shared table. A false positive only moves a line used once
  // into the shared table: pages stay exact either way.
  const seen = new Uint8Array(1 << 24), shared = new Map();
  const bits = digest => [0, 4, 8].map(at => digest.readUInt32BE(at) % (seen.length * 8));
  // Which answer-key pages are exported (a page whose file is missing, or is not a full page, is left out).
  const included = new Uint8Array(outline.count);
  let total = 0, n = -1, front = null, first = null;
  const types = new Set();
  for await (const page of outline.pages()) {
    n++;
    let html;
    try { html = packagePageHtml(await readFile(join(publicRoot, pageFile(page.url)), 'utf8'), origin); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const parts = splitPage(html, cms, sourceProfile);
    if (!parts) continue;
    included[n] = 1; total++;
    first ??= page.url;
    if (page.url === '/') front = page.url;
    if (page.kind === 'detail') types.add(page.contentType);
    // The hash covers the split parts, not just the HTML, so a SiteForge version that splits pages differently also
    // triggers a re-import (bump the format string when the record or run encoding changes).
    hash.update(JSON.stringify([page.url, page.title ?? '', page.kind, page.contentType ?? '', parts])).update('\0');
    // Lines are substrings of the page and would keep the whole page string alive, so `shared` keeps a copy.
    for (const line of new Set(layoutLines(parts))) {
      const positions = bits(createHash('sha1').update(line).digest());
      if (positions.every(bit => seen[bit >> 3] & (1 << (bit & 7)))) { if (!shared.has(line)) shared.set(Buffer.from(line, 'utf8').toString('utf8'), true); }
      else for (const bit of positions) seen[bit >> 3] |= 1 << (bit & 7);
    }
  }
  if (!total) throw new Error('No generated pages were found to export');
  const lines = [...shared.keys()];
  // Everything else (images, CSS, feeds, trap resources) is served as-is. The CMS's own robots.txt is kept; WordPress
  // also serves its own sitemap and core files, so SiteForge's imitation copies of those are left out.
  // Exported page files are remembered as 30-bit digests (small integers), not as 100,000 path strings; a collision could
  // only leave out a static file whose digest matches a page's.
  const fileKey = file => createHash('sha1').update(file).digest().readUInt32BE(0) >>> 2;
  const pageFiles = new Set();
  n = -1;
  for await (const page of outline.pages()) if (included[++n]) pageFiles.add(fileKey(pageFile(page.url).replaceAll('\\', '/')));
  const skip = file => file === 'robots.txt' || (cms === 'wordpress' && (file === 'sitemap.xml' || file.startsWith('wp-includes/') || file.startsWith('wp-admin/'))) || (file.endsWith('index.html') && pageFiles.has(fileKey(file)));
  const staticFiles = await listStatic(publicRoot, skip);
  return { cms, sourceProfile, site: { id: site.id, name: site.name, domain: site.domain, cmsProfile: sourceProfile, origin },
    front: front ?? first, types: [...types].sort(), total, lines, hash: hash.digest('hex').slice(0, 32), outline, included, staticFiles, publicRoot };
}

// Files under the public folder that are not skipped, without first listing all of them (100,000 page files).
async function listStatic(root, skip, prefix = '', out = []) {
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await listStatic(root, skip, path, out);
    else if (entry.isFile() && !skip(path)) out.push(path);
  }
  return out;
}

// Second pass: yields one page record at a time, ready for pages.ndjson.
export async function* pageRecords(scan) {
  const index = new Map(scan.lines.map((line, n) => [line, n]));
  let n = -1;
  for await (const page of scan.outline.pages()) {
    if (!scan.included[++n]) continue;
    const parts = splitPage(packagePageHtml(await readFile(join(scan.publicRoot, pageFile(page.url)), 'utf8'), scan.site.origin), scan.cms, scan.sourceProfile);
    if (!parts) throw new Error(`${page.url} changed while the package was being built`);
    // `name` is the page's own title (post/node title, menus, search); `title` is the full document <title>.
    const name = String(page.title ?? '').trim() || parts.title || page.url;
    yield { path: page.url, kind: page.kind, type: page.kind === 'detail' ? page.contentType : 'page', name, title: parts.title || name, htmlAttrs: parts.htmlAttrs, classes: parts.classes, attrs: parts.attrs,
      head: encodeRuns(index, parts.headLines), before: encodeRuns(index, parts.before.split('\n')), main: parts.main, after: encodeRuns(index, parts.after.split('\n')) };
  }
}

// The whole content model in memory (tests and small sites); packages use scanSite and pageRecords instead.
export async function cmsContent(siteDirectory, cms) {
  const scan = await scanSite(siteDirectory, cms);
  const pages = [];
  for await (const page of pageRecords(scan)) pages.push(page);
  return { ...scan, pages };
}

// ---------------------------------------------------------------------------------------------------------------
// WordPress: one theme folder. Activating the theme imports the pages (in batches on admin page loads for big sites).

const phpString = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
// Site names go into a CSS header comment and a PHP doc comment: no line breaks (they would add header fields) and
// no comment terminator. Inserting a space cannot create a new "*/".
const commentSafe = value => String(value).replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /');
// File types served from the static folders (both CMSs). Text types get the generation origin rewritten.
const MIME = { css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', pdf: 'application/pdf', xml: 'application/xml', rss: 'application/rss+xml', atom: 'application/atom+xml', json: 'application/json', webmanifest: 'application/manifest+json', txt: 'text/plain', html: 'text/html', htm: 'text/html', woff: 'font/woff', woff2: 'font/woff2', gz: 'application/gzip', csv: 'text/csv', ics: 'text/calendar' };
const phpMime = () => `[${Object.entries(MIME).map(([ext, type]) => `'${ext}' => '${type}'`).join(', ')}]`;
const REWRITE_EXTENSIONS = "['xml', 'rss', 'atom', 'txt', 'json', 'html', 'htm', 'webmanifest']";

function wordpressFiles(content, slug) {
  const { site } = content;
  const style = `/*
Theme Name: SiteForge test site - ${commentSafe(site.name)}
Theme URI: https://example.invalid/siteforge
Author: SiteForge
Description: Test fixture generated by SiteForge for crawler and migration testing. Activating it imports ${content.total} fictional pages. Not for production use.
Version: 1.0.0
Requires at least: 6.0
Requires PHP: 7.4
License: GPL-2.0-or-later
Text Domain: ${slug}
Tags: test-fixture
*/
`;
  const functions = `<?php
/**
 * SiteForge test-site theme for "${commentSafe(site.name)}". Generated; do not edit.
 * Pages keep the generated <main> markup byte-for-byte. WordPress adds its own head, body classes and footer scripts.
 */
if (!defined('ABSPATH')) exit;
define('SITEFORGE_DIR', __DIR__);
define('SITEFORGE_SITE', ${phpString(site.id)});
// Content version: a replaced theme with new content is re-imported even when WordPress does not switch themes.
define('SITEFORGE_HASH', ${phpString(content.hash)});
// Address the site was generated for; sitemaps, feeds and documents are rewritten to this WordPress address.
define('SITEFORGE_ORIGIN', ${phpString(content.site.origin)});

// Pages carry a placeholder where they linked to the generation address; the import replaces it with this WordPress
// site's address, so fully qualified links point here (WordPress itself stores absolute URLs in post content).
function siteforge_localize($text) {
  static $pairs = null;
  if ($pairs === null) {
    $url = wp_parse_url(home_url());
    $host = ($url['host'] ?? 'localhost') . (isset($url['port']) ? ':' . $url['port'] : '');
    $pairs = [${phpString(ORIGIN_PLACEHOLDER)} => ($url['scheme'] ?? 'http') . '://' . $host, ${phpString(ORIGIN_PLACEHOLDER.replace('http:', ''))} => '//' . $host];
  }
  return strtr($text, $pairs);
}

// Legacy .htm documents keep the encoding they declare (byte-order mark or <meta> charset), as SiteForge serves them.
function siteforge_html_type($file) {
  $start = (string) file_get_contents($file, false, null, 0, 1024);
  if (strncmp($start, "\\xFF\\xFE", 2) === 0 || strncmp($start, "\\xFE\\xFF", 2) === 0) return 'text/html; charset=utf-16';
  return preg_match('/<meta[^>]+charset=["\\']?([A-Za-z0-9_-]+)/i', $start, $m) ? 'text/html; charset=' . $m[1] : 'text/html';
}

function siteforge_rebased($file, $ext, $target) {
  $origins = [SITEFORGE_ORIGIN, str_replace('/', '\\/', SITEFORGE_ORIGIN)];
  $targets = [$target, str_replace('/', '\\/', $target)];
  if (in_array($ext, ${REWRITE_EXTENSIONS}, true)) {
    $body = file_get_contents($file);
    return strpos($body, SITEFORGE_ORIGIN) === false && strpos($body, $origins[1]) === false ? null : str_replace($origins, $targets, $body);
  }
  if ($ext === 'gz' && function_exists('gzdecode')) {
    $raw = @gzdecode(file_get_contents($file));
    if ($raw !== false && strpos($raw, SITEFORGE_ORIGIN) !== false) return gzencode(str_replace($origins, $targets, $raw));
  }
  return null;
}

// Generated images, CSS and other files live in siteforge-static/ and are served at their original URLs, so image
// field values in the answer key stay the same. Real files on disk (WordPress core) are served by the web server first.
function siteforge_serve_static() {
  $path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
  if ($path === '' || substr($path, -1) === '/' || strpos($path, '..') !== false) return;
  $file = SITEFORGE_DIR . '/siteforge-static' . $path;
  if (!is_file($file)) return;
  $types = ${phpMime()};
  $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
  $body = siteforge_rebased($file, $ext, untrailingslashit(home_url()));
  status_header(200);
  @ini_set('default_charset', '');
  header('Content-Type: ' . ($ext === 'htm' ? siteforge_html_type($file) : ($types[$ext] ?? 'application/octet-stream')));
  header('Content-Length: ' . ($body === null ? filesize($file) : strlen($body)));
  if ($body === null) readfile($file); else echo $body;
  exit;
}
siteforge_serve_static();

function siteforge_types() { return get_option('siteforge_types', []); }
// Generated path => post ID, split into buckets of about 200 paths (options that are not autoloaded), so a request
// loads one small bucket instead of a map of the whole site (100,000 pages would be megabytes on every request).
function siteforge_bucket($path) { return 'siteforge_paths_' . (crc32($path) % max(1, (int) get_option('siteforge_buckets', 1))); }
function siteforge_lookup($path) {
  $bucket = get_option(siteforge_bucket($path), []);
  return (int) (is_array($bucket) ? ($bucket[$path] ?? 0) : 0);
}
// The page imported at a path, from post meta (slower: not indexed by value); used while an import is running.
function siteforge_meta_lookup($path) {
  global $wpdb;
  return (int) $wpdb->get_var($wpdb->prepare("SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_siteforge_path' AND meta_value IN (%s, %s) LIMIT 1", $path, rtrim($path, '/') . '/'));
}

add_action('after_setup_theme', function () {
  add_theme_support('title-tag');
  add_theme_support('automatic-feed-links');
  add_theme_support('post-thumbnails');
  add_theme_support('html5', ['search-form', 'comment-form', 'gallery', 'caption', 'style', 'script']);
  register_nav_menus(['primary' => 'Primary']);
});

add_action('init', function () {
  foreach (siteforge_types() as $type => $label) {
    register_post_type($type, ['label' => $label, 'public' => true, 'show_in_rest' => true, 'rewrite' => false, 'query_var' => false, 'supports' => ['title', 'editor', 'custom-fields']]);
  }
});

// WordPress's own RSS feed (linked from every page head) lists the imported detail pages, as a real site's feed would.
add_filter('request', function ($vars) {
  if (isset($vars['feed']) && empty($vars['post_type']) && empty($vars['p']) && empty($vars['page_id'])) $vars['post_type'] = array_merge(['post'], array_keys(siteforge_types()));
  return $vars;
});
// Author archives are not pages of the test site; keep them out of WordPress's sitemap.
add_filter('wp_sitemaps_add_provider', function ($provider, $name) { return $name === 'users' ? false : $provider; }, 10, 2);
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_script('jquery');
  if (is_singular() && comments_open()) wp_enqueue_script('comment-reply');
});
add_action('widgets_init', function () {
  register_sidebar(['name' => 'Footer widgets', 'id' => 'siteforge-footer', 'before_widget' => '<section id="%1$s" class="widget %2$s">', 'after_widget' => '</section>', 'before_title' => '<h2 class="widget-title">', 'after_title' => '</h2>']);
});

// Real WordPress output around the generated content: the comment thread and form, and a widget area.
function siteforge_extras() {
  ob_start();
  if (is_singular() && (comments_open() || get_comments_number())) {
    $id = get_queried_object_id();
    $comments = get_comments(['post_id' => $id, 'status' => 'approve', 'order' => 'ASC']);
    echo '<section id="comments" class="comments-area">';
    if ($comments) {
      echo '<h2 class="comments-title">' . esc_html(sprintf(_n('%s response', '%s responses', count($comments)), number_format_i18n(count($comments)))) . '</h2><ol class="comment-list">';
      wp_list_comments(['style' => 'ol', 'short_ping' => true, 'avatar_size' => 48], $comments);
      echo '</ol>';
    }
    comment_form();
    echo '</section>';
  }
  if (is_active_sidebar('siteforge-footer')) {
    echo '<aside id="secondary" class="widget-area" aria-label="Footer widgets">';
    dynamic_sidebar('siteforge-footer');
    echo '</aside>';
  }
  return ob_get_clean();
}

// Requests are routed by the generated URL, so WordPress serves every page at exactly the path in the answer key.
add_action('parse_request', function ($wp) {
  $path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
  // Shortlinks (?p=123, printed in every page head) redirect to the page, as on a real WordPress site.
  if ($path === '/' && isset($_GET['p']) && ctype_digit((string) $_GET['p']) && get_post_meta((int) $_GET['p'], '_siteforge_path', true)) {
    wp_safe_redirect(get_permalink((int) $_GET['p']), 301);
    exit;
  }
  if ($path === '/') return;
  // WordPress's embed view of a post (/<post>/embed/, linked from its oEmbed response), as for any real post.
  $embed = (bool) preg_match('#^(/.+/)embed/?$#', $path, $match);
  if ($embed && !siteforge_post_id($path) && siteforge_post_id($match[1])) $path = $match[1]; else $embed = false;
  $id = siteforge_post_id($path);
  if (!$id) return;
  $type = get_post_type($id);
  $wp->query_vars = ($type === 'page' ? ['page_id' => $id] : ['p' => $id, 'post_type' => $type]) + ($embed ? ['embed' => true] : []);
});
// The post imported at a generated path, or 0.
function siteforge_post_id($path) {
  $id = siteforge_lookup($path) ?: siteforge_lookup(rtrim($path, '/') . '/');
  // While an import runs, the newest pages may not be in the path buckets yet; their path is always in post meta.
  if (!$id && siteforge_import_pending()) $id = siteforge_meta_lookup($path);
  return (int) $id;
}
// oEmbed discovery links in every page head resolve to the imported post, so they answer 200 as on a real site.
add_filter('oembed_request_post_id', function ($id, $url) {
  return $id ?: siteforge_post_id(rawurldecode((string) parse_url($url, PHP_URL_PATH)));
}, 10, 2);
function siteforge_link($link, $post) {
  $id = is_object($post) ? $post->ID : (int) $post;
  $path = get_post_meta($id, '_siteforge_path', true);
  return $path ? home_url($path) : $link;
}
add_filter('post_type_link', 'siteforge_link', 10, 2);
add_filter('page_link', 'siteforge_link', 10, 2);

function siteforge_layout() {
  static $layout = null;
  if ($layout !== null) return $layout;
  $id = is_singular() ? get_queried_object_id() : (int) get_option('page_on_front');
  $meta = $id ? get_post_meta($id, '_siteforge', true) : '';
  $layout = is_array($meta) ? $meta : [];
  return $layout;
}
function siteforge_lines($runs) {
  static $lines = null;
  if ($lines === null) $lines = get_option('siteforge_lines', []);
  $out = [];
  // A run is [start, length] in the shared line table, or a string of lines that appear on this page only.
  foreach ((array) $runs as $run) {
    if (is_string($run)) { $out[] = $run; continue; }
    for ($i = 0; $i < $run[1]; $i++) $out[] = $lines[$run[0] + $i] ?? '';
  }
  return implode("\\n", $out);
}
add_filter('pre_get_document_title', function ($title) {
  $layout = siteforge_layout();
  return (is_singular() && !empty($layout['title'])) ? esc_html($layout['title']) : $title;
});
// <html> attributes of the generated page (Webflow data-wf-*, data-ready, xmlns:og...) after WordPress's lang.
add_filter('language_attributes', function ($output) {
  if (is_admin() || is_feed()) return $output;
  foreach ((siteforge_layout()['html'] ?? []) as $attribute) $output .= ' ' . esc_attr($attribute[0]) . ($attribute[1] === null ? '' : '="' . esc_attr($attribute[1]) . '"');
  return $output;
});
add_filter('body_class', function ($classes) {
  $layout = siteforge_layout();
  return empty($layout['classes']) ? $classes : array_merge($classes, preg_split('/\\s+/', $layout['classes']));
});

// ---- Content import -------------------------------------------------------------------------------------------
function siteforge_data() { return json_decode(file_get_contents(SITEFORGE_DIR . '/content/site.json'), true); }
// Pages are read one line at a time from pages.ndjson, so memory use does not grow with the site.
function siteforge_pages_handle($offset) {
  $handle = fopen(SITEFORGE_DIR . '/content/pages.ndjson', 'rb');
  if ($handle && $offset > 0) fseek($handle, $offset);
  return $handle;
}

// One import at a time (admin page loads, cron and the command-line importer can overlap). A lock older than five
// minutes is considered abandoned (a running import refreshes it): returns 1 for a new lock, 2 for a taken-over one.
function siteforge_lock() {
  if (add_option('siteforge_import_lock', time(), '', false)) return 1;
  if (time() - (int) get_option('siteforge_import_lock', 0) < 300) return 0;
  update_option('siteforge_import_lock', time(), false);
  return 2;
}
// Import progress: pages done and the byte offset of the next page in pages.ndjson, stored together in one option so an
// interrupted request can never leave the two out of step.
function siteforge_progress() {
  $progress = get_option('siteforge_progress', [0, 0]);
  return is_array($progress) ? [(int) ($progress[0] ?? 0), (int) ($progress[1] ?? 0)] : [0, 0];
}
function siteforge_import_pending() {
  return get_option('siteforge_hash') !== SITEFORGE_HASH || siteforge_progress()[0] < (int) get_option('siteforge_total', 0);
}
// WordPress keeps every post, meta value and option it touches in its in-request cache; a long import empties it now
// and then so memory use does not grow with the site.
function siteforge_forget() {
  if (function_exists('wp_cache_flush_runtime')) wp_cache_flush_runtime(); else wp_cache_flush();
}
// Saves the paths imported since the last call into their buckets, then the progress (in that order: a page counted as
// done is always reachable).
function siteforge_save_progress(&$pending, $done, $offset) {
  $groups = [];
  foreach ($pending as $path => $id) $groups[siteforge_bucket($path)][$path] = $id;
  foreach ($groups as $name => $entries) {
    $bucket = get_option($name, []);
    update_option($name, $entries + (is_array($bucket) ? $bucket : []), false);
  }
  $pending = [];
  update_option('siteforge_progress', [$done, $offset], true);
  update_option('siteforge_import_lock', time(), false);
}
// Removes posts of an earlier SiteForge import directly in the database (wp_delete_post() is far too slow for 100,000).
function siteforge_delete_posts($ids) {
  global $wpdb;
  $in = implode(',', array_map('intval', $ids));
  $comments = $wpdb->get_col("SELECT comment_ID FROM {$wpdb->comments} WHERE comment_post_ID IN ($in)");
  if ($comments) {
    $list = implode(',', array_map('intval', $comments));
    $wpdb->query("DELETE FROM {$wpdb->commentmeta} WHERE comment_id IN ($list)");
    $wpdb->query("DELETE FROM {$wpdb->comments} WHERE comment_ID IN ($list)");
  }
  $revisions = $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'revision' AND post_parent IN ($in)");
  $all = implode(',', array_map('intval', array_merge($ids, $revisions)));
  $wpdb->query("DELETE FROM {$wpdb->postmeta} WHERE post_id IN ($all)");
  $wpdb->query("DELETE FROM {$wpdb->term_relationships} WHERE object_id IN ($all)");
  $wpdb->query("DELETE FROM {$wpdb->posts} WHERE ID IN ($all)");
  siteforge_forget();
}

function siteforge_keep_slug($override, $slug) { return $slug; }

// Imports pages for about $budget seconds (0: until done) and returns [pages done, total]. Big sites continue on later
// admin page loads, or all at once with the command-line importer (siteforge-import.php).
function siteforge_import($budget = 20) {
  global $wpdb;
  $lock = siteforge_lock();
  if (!$lock) return [siteforge_progress()[0], (int) get_option('siteforge_total', 0)];
  $started = microtime(true);
  $data = siteforge_data();
  $total = (int) $data['total'];
  if (get_option('siteforge_hash') !== SITEFORGE_HASH) {
    update_option('siteforge_hash', SITEFORGE_HASH, true);
    update_option('siteforge_progress', [0, 0], true);
    update_option('siteforge_total', $total, true);
    update_option('siteforge_cleanup', 1, true);
  }
  // A previously imported SiteForge site is removed first, so one install holds one test site. It goes in slices of
  // 500 posts, so removing a big site also works in time-limited requests.
  while (get_option('siteforge_cleanup')) {
    $old = $wpdb->get_col("SELECT DISTINCT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_siteforge_path' LIMIT 500");
    if (!$old) {
      foreach ($wpdb->get_col("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE 'siteforge_paths%'") as $name) {
        if (strpos($name, 'siteforge_paths') === 0) delete_option($name);
      }
      delete_option('siteforge_cleanup');
      break;
    }
    siteforge_delete_posts($old);
    if ($budget && microtime(true) - $started > $budget) { delete_option('siteforge_import_lock'); return [0, $total]; }
  }
  [$done, $offset] = siteforge_progress();
  if ($done === 0) {
    $types = [];
    foreach ($data['types'] as $type) $types[substr('sf_' . preg_replace('/[^a-z0-9_]/', '_', strtolower($type)), 0, 20)] = ucwords(str_replace('-', ' ', $type));
    update_option('siteforge_types', $types, true);
    foreach ($types as $type => $label) register_post_type($type, ['label' => $label, 'public' => true, 'rewrite' => false, 'query_var' => false]);
    update_option('siteforge_lines', json_decode(siteforge_localize(file_get_contents(SITEFORGE_DIR . '/content/lines.json')), true), false);
    update_option('siteforge_buckets', max(1, (int) ceil($total / 200)), true);
    update_option('blogname', $data['site']['name']);
    // WordPress's untouched sample content ("Hello world!", "Sample Page") is not part of the test site.
    foreach ([['hello-world', 'post', 'Hello world!'], ['sample-page', 'page', 'Sample Page']] as [$slug, $type, $title]) {
      $sample = get_page_by_path($slug, OBJECT, $type);
      if ($sample && $sample->post_title === $title && $sample->post_date_gmt === $sample->post_modified_gmt) wp_trash_post($sample->ID);
    }
  }
  // After an interrupted request, the pages imported since its last saved progress already exist: they are found by
  // their path in post meta and updated, not imported twice.
  $recheck = $lock === 2 ? $done + 60 : $done;
  $pending = [];
  $at = [$done, $offset];
  $handle = siteforge_pages_handle($offset);
  if (function_exists('wp_defer_term_counting')) wp_defer_term_counting(true);
  // Each slice of 50 pages is written in one database transaction, with the progress that counts it: much faster than
  // one commit per row, and an interrupted request leaves either the whole slice or none of it.
  $wpdb->query('START TRANSACTION');
  // Pages are found by their generated path, so slugs need not be unique; WordPress's uniqueness check scans every
  // post on some databases (SQLite) and would make a 100,000-page import slower with every page.
  add_filter('pre_wp_unique_post_slug', 'siteforge_keep_slug', 10, 2);
  for ($i = $done; $i < $total; $i++) {
    $line = $handle ? fgets($handle) : false;
    // A shorter file than expected (for example a truncated upload) ends the import instead of leaving it pending forever.
    if ($line === false) { $at = [$total, (int) ($handle ? ftell($handle) : 0)]; break; }
    $at = [$i + 1, ftell($handle)];
    $page = json_decode(siteforge_localize($line), true);
    if (!is_array($page) || !isset($page['path'], $page['type'], $page['main'])) continue;
    $type = $page['type'] === 'page' ? 'page' : substr('sf_' . preg_replace('/[^a-z0-9_]/', '_', strtolower($page['type'])), 0, 20);
    $slug = trim((string) substr(strrchr('/' . trim($page['path'], '/'), '/'), 1)) ?: 'home';
    $existing = $pending[$page['path']] ?? siteforge_lookup($page['path']);
    if (!$existing && $i < $recheck) $existing = siteforge_meta_lookup($page['path']);
    $id = wp_insert_post(wp_slash(['ID' => $existing, 'post_type' => $type, 'post_status' => 'publish', 'post_title' => $page['name'], 'post_name' => $slug, 'post_content' => '', 'comment_status' => $page['kind'] === 'detail' ? 'open' : 'closed', 'ping_status' => 'closed']), true);
    if (is_wp_error($id)) continue;
    // Written directly so WordPress content filters cannot change a single byte of the generated markup.
    $wpdb->update($wpdb->posts, ['post_content' => $page['main']], ['ID' => $id]);
    clean_post_cache($id);
    update_post_meta($id, '_siteforge_path', $page['path']);
    update_post_meta($id, '_siteforge', wp_slash(['title' => $page['title'], 'html' => $page['htmlAttrs'], 'classes' => $page['classes'], 'attrs' => $page['attrs'], 'head' => $page['head'], 'before' => $page['before'], 'after' => $page['after']]));
    $pending[$page['path']] = $id;
    // About one detail page in three gets a short, seeded comment thread (fictional names and text).
    $hash = crc32($page['path']);
    if ($page['kind'] === 'detail' && !$existing && $hash % 3 === 0) {
      $names = ['Avery Holt', 'Jordan Pike', 'Sam Okafor', 'Riley Chen', 'Morgan Reyes', 'Casey Lund'];
      $texts = ['Thanks for putting this together.', 'Is there an updated version of this page?', 'Very helpful, I shared it with my team.', 'The opening hours listed here look different from the main page.', 'Could you add a printable version?', 'Great resource!'];
      for ($c = 0; $c < 1 + $hash % 3; $c++) {
        wp_insert_comment(['comment_post_ID' => $id, 'comment_author' => $names[($hash >> ($c + 2)) % 6], 'comment_author_email' => 'reader' . $c . '@example.invalid', 'comment_content' => $texts[($hash >> ($c + 5)) % 6], 'comment_approved' => 1, 'comment_date' => gmdate('Y-m-d H:i:s', 1767225600 + ($hash % 86400) + $c * 3600)]);
      }
    }
    if ($page['path'] === $data['front']) { update_option('show_on_front', 'page'); update_option('page_on_front', $id); }
    $over = $budget && microtime(true) - $started > $budget;
    if (count($pending) >= 50 || $over) { siteforge_save_progress($pending, $at[0], $at[1]); $wpdb->query('COMMIT'); siteforge_forget(); if (!$over) $wpdb->query('START TRANSACTION'); }
    if ($over) break;
  }
  remove_filter('pre_wp_unique_post_slug', 'siteforge_keep_slug', 10);
  if ($handle) fclose($handle);
  siteforge_save_progress($pending, $at[0], $at[1]);
  $wpdb->query('COMMIT');
  if (function_exists('wp_defer_term_counting')) wp_defer_term_counting(false);
  if ($at[0] >= $total) {
    // Block widgets as a site owner would add them; WordPress renders them with its own block markup. The page list
    // prints every page, so big sites (thousands of listing pages) list the latest comments instead.
    $page_count = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'page' AND post_status = 'publish'");
    $browse = $page_count <= 200 ? '<!-- wp:page-list /-->' : '<!-- wp:latest-comments {"commentsToShow":5} /-->';
    update_option('show_avatars', 0);
    update_option('widget_block', [
      2 => ['content' => '<!-- wp:search {"label":"Search","buttonText":"Search"} /-->'],
      3 => ['content' => '<!-- wp:group --><div class="wp-block-group"><!-- wp:heading --><h2 class="wp-block-heading">Browse</h2><!-- /wp:heading -->' . $browse . '</div><!-- /wp:group -->'],
      4 => ['content' => '<!-- wp:paragraph --><p>' . esc_html($data['site']['name']) . '</p><!-- /wp:paragraph -->'],
      '_multiwidget' => 1,
    ]);
    update_option('sidebars_widgets', ['wp_inactive_widgets' => [], 'siteforge-footer' => ['block-2', 'block-3', 'block-4'], 'array_version' => 3]);
    // A real WordPress navigation menu of the home and section pages, printed with wp_nav_menu() (menu-item classes,
    // current-menu-item, aria-current).
    $existing_menu = wp_get_nav_menu_object('SiteForge main');
    if ($existing_menu) wp_delete_nav_menu($existing_menu->term_id);
    $menu = wp_create_nav_menu('SiteForge main');
    if (!is_wp_error($menu)) {
      $sections = get_posts(['post_type' => 'page', 'post_status' => 'publish', 'numberposts' => 12, 'meta_key' => '_siteforge_path', 'orderby' => 'ID', 'order' => 'ASC']);
      foreach ($sections as $position => $section) {
        wp_update_nav_menu_item($menu, 0, ['menu-item-object-id' => $section->ID, 'menu-item-object' => 'page', 'menu-item-type' => 'post_type', 'menu-item-status' => 'publish', 'menu-item-position' => $position + 1]);
      }
      set_theme_mod('nav_menu_locations', ['primary' => $menu]);
    }
  }
  delete_option('siteforge_import_lock');
  return [$at[0], $total];
}
add_action('after_switch_theme', function () {
  delete_option('siteforge_hash');
  if (function_exists('set_time_limit')) @set_time_limit(0);
  siteforge_import();
});
// Continues a large import, and starts a new one when the theme was replaced in place with different content.
add_action('admin_init', function () {
  if (wp_doing_ajax() || !current_user_can('manage_options') || get_option('stylesheet') !== basename(SITEFORGE_DIR) || !siteforge_import_pending()) return;
  [$done, $total] = siteforge_import();
  if ($done < $total) add_action('admin_notices', function () use ($done, $total) { echo '<div class="notice notice-info"><p>SiteForge is importing test pages: ' . (int) $done . ' of ' . (int) $total . '. Reload this page to continue, or run the theme\\'s siteforge-import.php from the command line.</p></div>'; });
});
`;
  const index = `<?php
/** SiteForge test-site template: WordPress head and footer around the generated page. */
if (!defined('ABSPATH')) exit;
$layout = siteforge_layout();
$main = is_singular() ? get_post_field('post_content', get_queried_object_id(), 'raw') : '';
if ($main === '' && is_search()) {
  $items = '';
  while (have_posts()) { the_post(); $items .= '<li><a href="' . esc_url(get_permalink()) . '">' . esc_html(get_the_title()) . '</a></li>'; }
  $main = '<main id="content" class="site-main search-results"><div class="page-heading"><h1>Search results for: ' . esc_html(get_search_query()) . '</h1></div>' . ($items ? '<ul class="search-list">' . $items . '</ul>' : '<p>Nothing matched your search.</p>') . '</main>';
}
if ($main === '') { status_header(404); $main = '<main id="content" class="site-main"><div class="page-heading"><h1>Page not found</h1></div><p>The page you requested could not be found.</p></main>'; }
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<?php wp_head(); ?>
<?php echo siteforge_lines($layout['head'] ?? []); ?>
</head>
<body <?php body_class(); ?><?php echo empty($layout['attrs']) ? '' : ' ' . $layout['attrs']; ?>>
<?php wp_body_open(); ?>
<?php echo siteforge_lines($layout['before'] ?? []); ?><?php if (has_nav_menu('primary')) wp_nav_menu(['theme_location' => 'primary', 'container' => 'nav', 'container_class' => 'cms-menu', 'container_aria_label' => 'Site menu', 'fallback_cb' => false]); ?><?php echo $main; ?><?php echo siteforge_extras(); ?><?php echo siteforge_lines($layout['after'] ?? []); ?>
<?php wp_footer(); ?>
</body>
</html>
`;
  const cliImporter = `<?php
/**
 * SiteForge command-line importer: activates this theme if needed and imports every page without web request time
 * limits. Memory use stays flat, so a 100,000-page site imports under the default 128 MB memory limit.
 *
 *   php wp-content/themes/${slug}/siteforge-import.php [path/to/wp-load.php]
 */
if (PHP_SAPI !== 'cli') {
  if (!headers_sent()) header('HTTP/1.1 403 Forbidden');
  exit("The SiteForge importer runs from the command line only.\\n");
}
$siteforge_load = $argv[1] ?? dirname(__DIR__, 3) . '/wp-load.php';
if (!is_file($siteforge_load)) {
  fwrite(STDERR, "wp-load.php not found at $siteforge_load; pass its path as the first argument.\\n");
  exit(2);
}
$_SERVER['REQUEST_URI'] = $_SERVER['REQUEST_URI'] ?? '/';
require $siteforge_load;
if (function_exists('set_time_limit')) @set_time_limit(0);
$siteforge_slug = basename(__DIR__);
if (get_option('stylesheet') !== $siteforge_slug) {
  if (!wp_get_theme($siteforge_slug)->exists()) {
    fwrite(STDERR, "Theme $siteforge_slug is not installed in this WordPress.\\n");
    exit(1);
  }
  switch_theme($siteforge_slug);
  // The import runs here, not on the next web request.
  delete_option('theme_switched');
  delete_option('siteforge_hash');
  require_once __DIR__ . '/functions.php';
}
$siteforge_started = microtime(true);
$siteforge_last = -1;
while (siteforge_import_pending()) {
  [$siteforge_done, $siteforge_total] = siteforge_import(30);
  printf("%d of %d pages (%ds, peak memory %.1f MB)\\n", $siteforge_done, $siteforge_total, microtime(true) - $siteforge_started, memory_get_peak_usage(true) / 1048576);
  // Another import (an admin page load) holds the lock: wait for it.
  if ($siteforge_done === $siteforge_last && !get_option('siteforge_cleanup')) sleep(5);
  $siteforge_last = $siteforge_done;
}
echo "SiteForge import complete.\\n";
`;
  return [
    { name: `${slug}/style.css`, data: style },
    { name: `${slug}/functions.php`, data: functions },
    { name: `${slug}/index.php`, data: index },
    { name: `${slug}/siteforge-import.php`, data: cliImporter },
    { name: `${slug}/README.txt`, data: `SiteForge test theme for "${site.name}".\n\nInstall: Appearance > Themes > Add New > Upload Theme, then Activate. Activation imports ${content.total} pages; large sites finish importing as you load admin pages (each load imports for about 20 seconds).\nBig sites: the ZIP is usually larger than the upload limit. Unzip it into wp-content/themes/ instead, then activate the theme (Appearance > Themes) or run the command-line importer, which activates it and imports every page without web time limits:\n  php wp-content/themes/${slug}/siteforge-import.php\n(run from the WordPress folder; pass the path to wp-load.php as the first argument if WordPress is elsewhere).\nAny permalink setting works: the theme serves every page at its generated URL.\nCrawl the site root and compare with the answer key from SiteForge. URLs and field locations match the generated site.\nThis is a test fixture, not a production theme.\n` },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Drupal: a module (content import, routing for static files) and a theme (templates). Unpack into web/.

function drupalFiles(content) {
  const { site } = content;
  const label = site.name.replace(/[\r\n]/g, ' ').replaceAll("'", "''");
  const module = 'modules/custom/siteforge_content';
  const theme = 'themes/custom/siteforge_theme';
  const info = `name: 'SiteForge test content'
type: module
description: 'Imports the SiteForge test site "${label}" (${content.total} fictional pages). Test fixture, not for production.'
package: SiteForge
core_version_requirement: ^10 || ^11
dependencies:
  - drupal:node
  - drupal:path
  - drupal:path_alias
  - drupal:text
  - drupal:filter
  - drupal:block
  - drupal:comment
  - drupal:menu_link_content
`;
  const services = `services:
  siteforge_content.static_files:
    class: Drupal\\siteforge_content\\StaticFiles
    tags:
      - { name: event_subscriber }
  siteforge_content.trailing_slash:
    class: Drupal\\siteforge_content\\TrailingSlash
    tags:
      - { name: path_processor_inbound, priority: 1000 }
      - { name: path_processor_outbound, priority: 400 }
  siteforge_content.import_on_admin:
    class: Drupal\\siteforge_content\\ImportOnAdmin
    tags:
      - { name: event_subscriber }
`;
  const staticFiles = `<?php

namespace Drupal\\siteforge_content;

use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpFoundation\\BinaryFileResponse;
use Symfony\\Component\\HttpFoundation\\Response;
use Symfony\\Component\\HttpKernel\\Event\\RequestEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;

/**
 * Serves the generated images, CSS and other files at their original URLs.
 */
class StaticFiles implements EventSubscriberInterface {

  public static function getSubscribedEvents(): array {
    return [KernelEvents::REQUEST => ['serve', 1000]];
  }

  public function serve(RequestEvent $event): void {
    $path = rawurldecode($event->getRequest()->getPathInfo());
    if ($path === '' || str_ends_with($path, '/') || str_contains($path, '..')) {
      return;
    }
    $file = dirname(__DIR__) . '/static' . $path;
    if (!is_file($file)) {
      return;
    }
    $types = ${phpMime()};
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $type = $types[$ext] ?? 'application/octet-stream';
    // Legacy .htm documents keep the encoding they declare (byte-order mark or <meta> charset), as SiteForge serves them.
    if ($ext === 'htm') {
      $start = (string) file_get_contents($file, FALSE, NULL, 0, 1024);
      $type = str_starts_with($start, "\\xFF\\xFE") || str_starts_with($start, "\\xFE\\xFF") ? 'text/html; charset=utf-16'
        : (preg_match('/<meta[^>]+charset=["\\']?([A-Za-z0-9_-]+)/i', $start, $match) ? 'text/html; charset=' . $match[1] : 'text/html; charset=windows-1252');
    }
    // Sitemaps, feeds and documents list the generation address; point them at this Drupal site instead.
    $origin = \\Drupal::state()->get('siteforge_content.origin', '');
    if ($origin !== '') {
      $target = $event->getRequest()->getSchemeAndHttpHost();
      $origins = [$origin, str_replace('/', '\\/', $origin)];
      $targets = [$target, str_replace('/', '\\/', $target)];
      $body = NULL;
      if (in_array($ext, ${REWRITE_EXTENSIONS}, TRUE)) {
        $text = file_get_contents($file);
        if (str_contains($text, $origins[0]) || str_contains($text, $origins[1])) {
          $body = str_replace($origins, $targets, $text);
        }
      }
      elseif ($ext === 'gz' && function_exists('gzdecode')) {
        $raw = @gzdecode(file_get_contents($file));
        if ($raw !== FALSE && str_contains($raw, $origin)) {
          $body = gzencode(str_replace($origins, $targets, $raw));
        }
      }
      if ($body !== NULL) {
        $event->setResponse(new Response($body, 200, ['Content-Type' => $type]));
        return;
      }
    }
    $response = new BinaryFileResponse($file);
    $response->headers->set('Content-Type', $type);
    $event->setResponse($response);
  }

}
`;
  const trailing = `<?php

namespace Drupal\\siteforge_content;

use Drupal\\Core\\PathProcessor\\InboundPathProcessorInterface;
use Drupal\\Core\\PathProcessor\\OutboundPathProcessorInterface;
use Drupal\\Core\\Render\\BubbleableMetadata;
use Symfony\\Component\\HttpFoundation\\Request;

/**
 * Generated links end in "/"; Drupal aliases do not. Both forms reach the same node, and links Drupal prints itself
 * (canonical, breadcrumbs) use the generated form, so they match the answer-key URLs.
 */
class TrailingSlash implements InboundPathProcessorInterface, OutboundPathProcessorInterface {

  public function processInbound($path, Request $request) {
    return ($path !== '/' && str_ends_with($path, '/')) ? rtrim($path, '/') : $path;
  }

  public function processOutbound($path, &$options = [], ?Request $request = NULL, ?BubbleableMetadata $bubbleable_metadata = NULL) {
    // Runs before Drupal's alias processor: a node with a path alias gets that alias plus "/". The alias manager's
    // per-page lookup cache is used, so no list of every alias is loaded (100,000 pages would be megabytes per request).
    // Links that ask for the unaliased path (the shortlink) keep it.
    if (!empty($options['alias']) || !preg_match('#^/node/\\d+$#', $path)) {
      return $path;
    }
    $alias = \\Drupal::service('path_alias.manager')->getAliasByPath($path, isset($options['language']) ? $options['language']->getId() : NULL);
    return ($alias !== $path && $alias !== '/' && $alias !== '') ? $alias . '/' : $path;
  }

}
`;
  const importOnAdmin = `<?php

namespace Drupal\\siteforge_content;

use Drupal\\Core\\StringTranslation\\StringTranslationTrait;
use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpKernel\\Event\\RequestEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;

/**
 * Continues a big import on admin page loads by site administrators (about 20 seconds per load).
 */
class ImportOnAdmin implements EventSubscriberInterface {

  public static function getSubscribedEvents(): array {
    // After routing (32), so the admin route is known.
    return [KernelEvents::REQUEST => ['import', 0]];
  }

  public function import(RequestEvent $event): void {
    $request = $event->getRequest();
    if (!$event->isMainRequest() || $request->isXmlHttpRequest() || !function_exists('siteforge_content_import_pending') || !siteforge_content_import_pending()) {
      return;
    }
    if (!\\Drupal::service('router.admin_context')->isAdminRoute() || !\\Drupal::currentUser()->hasPermission('administer site configuration')) {
      return;
    }
    [$done, $total] = siteforge_content_import(20);
    if ($done < $total) {
      \\Drupal::messenger()->addStatus('SiteForge is importing test pages: ' . $done . ' of ' . $total . '. Reload to continue.');
    }
  }

}
`;
  const install = `<?php

/**
 * @file
 * Creates the content types and imports the SiteForge test pages.
 */

use Drupal\\field\\Entity\\FieldConfig;
use Drupal\\field\\Entity\\FieldStorageConfig;
use Drupal\\filter\\Entity\\FilterFormat;
use Drupal\\node\\Entity\\Node;
use Drupal\\block\\Entity\\Block;
use Drupal\\comment\\Entity\\Comment;
use Drupal\\comment\\Entity\\CommentType;
use Drupal\\Core\\Cache\\Cache;
use Drupal\\menu_link_content\\Entity\\MenuLinkContent;
use Drupal\\node\\Entity\\NodeType;

/**
 * Implements hook_install().
 */
function siteforge_content_install() {
  if (function_exists('set_time_limit')) {
    @set_time_limit(0);
  }
  $data = json_decode(file_get_contents(__DIR__ . '/content/site.json'), TRUE);
  if (!is_file(__DIR__ . '/content/pages.ndjson')) {
    throw new \\RuntimeException('SiteForge test content: content/pages.ndjson is missing. Unzip the whole package into the Drupal web root and try again.');
  }
  // No filters: the generated <main> markup is stored and printed byte-for-byte.
  if (!FilterFormat::load('siteforge_raw')) {
    FilterFormat::create(['format' => 'siteforge_raw', 'name' => 'SiteForge raw HTML', 'weight' => 10, 'filters' => []])->save();
  }
  $bundles = ['sf_page' => 'SiteForge page'];
  foreach ($data['types'] as $type) {
    $bundles[substr('sf_' . preg_replace('/[^a-z0-9_]/', '_', strtolower($type)), 0, 32)] = ucwords(str_replace('-', ' ', $type));
  }
  foreach ($bundles as $bundle => $name) {
    if (!NodeType::load($bundle)) {
      NodeType::create(['type' => $bundle, 'name' => $name])->save();
    }
  }
  foreach (['body' => 'text_long', 'field_siteforge_layout' => 'string_long'] as $field => $fieldType) {
    if (!FieldStorageConfig::loadByName('node', $field)) {
      FieldStorageConfig::create(['field_name' => $field, 'entity_type' => 'node', 'type' => $fieldType])->save();
    }
    foreach (array_keys($bundles) as $bundle) {
      if (!FieldConfig::loadByName('node', $bundle, $field)) {
        FieldConfig::create(['field_name' => $field, 'entity_type' => 'node', 'bundle' => $bundle, 'label' => $field === 'body' ? 'Body' : 'SiteForge layout'])->save();
      }
    }
  }
  // Drupal's own comment system on detail content types; anonymous visitors may read and post, as on many public sites.
  if (!CommentType::load('comment')) {
    CommentType::create(['id' => 'comment', 'label' => 'Default comments', 'target_entity_type_id' => 'node', 'description' => 'Comments on SiteForge test pages.'])->save();
  }
  if (!FieldStorageConfig::loadByName('comment', 'comment_body')) {
    FieldStorageConfig::create(['field_name' => 'comment_body', 'entity_type' => 'comment', 'type' => 'text_long'])->save();
  }
  if (!FieldConfig::loadByName('comment', 'comment', 'comment_body')) {
    FieldConfig::create(['field_name' => 'comment_body', 'entity_type' => 'comment', 'bundle' => 'comment', 'label' => 'Comment', 'required' => TRUE])->save();
  }
  $repository = \\Drupal::service('entity_display.repository');
  $repository->getFormDisplay('comment', 'comment')->setComponent('comment_body', ['type' => 'text_textarea'])->save();
  $repository->getViewDisplay('comment', 'comment')->setComponent('comment_body', ['type' => 'text_default', 'label' => 'hidden'])->save();
  if (!FieldStorageConfig::loadByName('node', 'comment')) {
    FieldStorageConfig::create(['field_name' => 'comment', 'entity_type' => 'node', 'type' => 'comment', 'settings' => ['comment_type' => 'comment']])->save();
  }
  foreach (array_keys($bundles) as $bundle) {
    if ($bundle !== 'sf_page' && !FieldConfig::loadByName('node', $bundle, 'comment')) {
      FieldConfig::create(['field_name' => 'comment', 'entity_type' => 'node', 'bundle' => $bundle, 'label' => 'Comments', 'default_value' => [['status' => 2, 'cid' => 0, 'last_comment_timestamp' => 0, 'last_comment_name' => '', 'last_comment_uid' => 0, 'comment_count' => 0]], 'settings' => ['default_mode' => 1, 'per_page' => 50, 'anonymous' => 0, 'form_location' => 1, 'preview' => 1]])->save();
    }
  }
  user_role_grant_permissions('anonymous', ['access comments', 'post comments']);
  user_role_grant_permissions('authenticated', ['access comments', 'post comments']);
  \\Drupal::state()->set('siteforge_content.lines', json_decode(file_get_contents(__DIR__ . '/content/lines.json'), TRUE));
  \\Drupal::state()->set('siteforge_content.origin', $data['site']['origin'] ?? '');
  $state = \\Drupal::state();
  $state->setMultiple(['siteforge_content.total' => (int) $data['total'], 'siteforge_content.progress' => [0, 0], 'siteforge_content.finalized' => FALSE]);
  $state->delete('siteforge_content.front');
  // The theme is installed before the pages, so pages already imported render as the generated site while a big
  // import continues.
  \\Drupal::service('theme_installer')->install(['siteforge_theme']);
  \\Drupal::configFactory()->getEditable('system.theme')->set('default', 'siteforge_theme')->save();
  // Installing a theme copies the previous default theme's blocks (page title, menus, tabs). They are replaced by a
  // fixed set: the generated page already has its one <h1> and navigation. Drupal renders these with its own wrappers.
  foreach (\\Drupal::entityTypeManager()->getStorage('block')->loadByProperties(['theme' => 'siteforge_theme']) as $block) {
    $block->delete();
  }
  foreach ([['messages', 'system_messages_block', 'highlighted', 'Status messages'], ['breadcrumbs', 'system_breadcrumb_block', 'breadcrumb', 'Breadcrumbs'], ['powered', 'system_powered_by_block', 'footer', 'Powered by Drupal'], ['main_menu', 'system_menu_block:main', 'primary_menu', 'Main navigation']] as [$id, $plugin, $region, $label]) {
    $settings = ['id' => $plugin, 'label' => $label, 'label_display' => '0', 'provider' => 'system'] + ($region === 'primary_menu' ? ['level' => 1, 'depth' => 1, 'expand_all_items' => FALSE] : []);
    Block::create(['id' => 'siteforge_theme_' . $id, 'theme' => 'siteforge_theme', 'region' => $region, 'plugin' => $plugin, 'weight' => 0, 'settings' => $settings, 'visibility' => []])->save();
  }
  \\Drupal::configFactory()->getEditable('system.site')->set('name', $data['site']['name'])->save();
  // The first batch of pages (about 20 seconds). Big sites continue on admin page loads, on cron, or all at once with
  // drush php:eval "siteforge_content_import_all();" (see siteforge_content.module).
  \\Drupal::moduleHandler()->loadInclude('siteforge_content', 'module');
  siteforge_content_import(20);
}

/**
 * Implements hook_uninstall().
 */
function siteforge_content_uninstall() {
  // Removes the imported test pages and their content types so another SiteForge site can be installed cleanly.
  $storage = \\Drupal::entityTypeManager()->getStorage('node');
  $bundles = array_filter(array_keys(\\Drupal::service('entity_type.bundle.info')->getBundleInfo('node')), fn ($bundle) => str_starts_with($bundle, 'sf_'));
  if ($bundles) {
    // In slices of 50, forgetting each slice afterwards, so removing 100,000 nodes does not exhaust memory.
    foreach (array_chunk($storage->getQuery()->accessCheck(FALSE)->condition('type', $bundles, 'IN')->execute(), 50) as $ids) {
      $storage->delete($storage->loadMultiple($ids));
      \\Drupal::service('entity.memory_cache')->deleteAll();
    }
    foreach ($bundles as $bundle) {
      NodeType::load($bundle)?->delete();
    }
  }
  FieldStorageConfig::loadByName('node', 'field_siteforge_layout')?->delete();
  \\Drupal::lock()->release('siteforge_content_import');
  \\Drupal::state()->deleteMultiple(['siteforge_content.lines', 'siteforge_content.aliases', 'siteforge_content.origin', 'siteforge_content.total', 'siteforge_content.progress', 'siteforge_content.finalized', 'siteforge_content.front']);
  user_role_revoke_permissions('anonymous', ['access comments', 'post comments']);
  $links = \\Drupal::entityTypeManager()->getStorage('menu_link_content');
  $links->delete($links->loadByProperties(['description' => 'SiteForge test site']));
  $config = \\Drupal::configFactory();
  if ($config->get('system.theme')->get('default') === 'siteforge_theme') {
    $fallback = array_key_exists('olivero', \\Drupal::service('extension.list.theme')->getList()) ? 'olivero' : 'stark';
    \\Drupal::service('theme_installer')->install([$fallback]);
    $config->getEditable('system.theme')->set('default', $fallback)->save();
  }
  // The theme depends on this module's data, so it is removed even when another default theme was chosen meanwhile.
  if (\\Drupal::service('theme_handler')->themeExists('siteforge_theme') && $config->get('system.theme')->get('admin') !== 'siteforge_theme') {
    \\Drupal::service('theme_installer')->uninstall(['siteforge_theme']);
  }
  $config->getEditable('system.site')->set('page.front', '/user/login')->save();
  siteforge_content_clear_caches();
}
`;
  const moduleFile = `<?php

/**
 * @file
 * SiteForge test content: layout data for the SiteForge theme.
 */

use Drupal\\comment\\Entity\\Comment;
use Drupal\\Core\\Cache\\Cache;
use Drupal\\Core\\Render\\Markup;
use Drupal\\Core\\Url;
use Drupal\\menu_link_content\\Entity\\MenuLinkContent;
use Drupal\\node\\Entity\\Node;
use Drupal\\node\\NodeInterface;

/**
 * Imports test pages for about $budget seconds (0: until done) and returns [pages done, total].
 *
 * Pages are read one line at a time from content/pages.ndjson, starting at the byte offset saved in Drupal state, so
 * memory use does not grow with the site. hook_install() imports the first batch; the rest follows on admin page loads,
 * on cron, or all at once with: drush php:eval "siteforge_content_import_all();"
 */
function siteforge_content_import(int $budget = 20): array {
  $state = \\Drupal::state();
  $total = (int) $state->get('siteforge_content.total', 0);
  [$done, $offset] = $state->get('siteforge_content.progress', [0, 0]) + [0, 0];
  if ($done >= $total && $state->get('siteforge_content.finalized', TRUE)) {
    return [$done, $total];
  }
  // One import at a time: admin page loads, cron and the command line can overlap. The lock is renewed as pages go.
  $lock = \\Drupal::lock();
  if (!$lock->acquire('siteforge_content_import', 300)) {
    return [$done, $total];
  }
  if (function_exists('set_time_limit')) {
    @set_time_limit($budget ? $budget * 3 + 60 : 0);
  }
  $started = microtime(TRUE);
  $data = json_decode(file_get_contents(__DIR__ . '/content/site.json'), TRUE);
  $pages = @fopen(__DIR__ . '/content/pages.ndjson', 'rb');
  if (!$pages) {
    $lock->release('siteforge_content_import');
    throw new \\RuntimeException('SiteForge test content: content/pages.ndjson is missing. Unzip the whole package into the Drupal web root and try again.');
  }
  fseek($pages, $offset);
  $count = 0;
  // Each slice of 25 pages is saved in one database transaction, with the progress that counts it: much faster than
  // one commit per node, and an interrupted request leaves either the whole slice or none of it.
  $database = \\Drupal::database();
  $transaction = $database->startTransaction();
  while ($done < $total) {
    $line = fgets($pages);
    // A shorter file than expected (for example a truncated upload) ends the import instead of leaving it pending.
    if ($line === FALSE) {
      $done = $total;
      break;
    }
    $page = json_decode($line, TRUE);
    if (is_array($page) && isset($page['path'], $page['type'], $page['main'])) {
      siteforge_content_import_page($page, $data['front']);
    }
    $done++;
    $offset = ftell($pages);
    $over = $budget && microtime(TRUE) - $started > $budget;
    if (++$count % 25 === 0 || $over) {
      $state->set('siteforge_content.progress', [$done, $offset]);
      siteforge_content_commit($transaction);
      $transaction = $over ? NULL : $database->startTransaction();
      // Drupal keeps every loaded entity in a static cache; a long import empties it so memory stays flat.
      \\Drupal::service('entity.memory_cache')->deleteAll();
      $lock->acquire('siteforge_content_import', 300);
    }
    if ($over) {
      break;
    }
  }
  fclose($pages);
  $state->set('siteforge_content.progress', [$done, $offset]);
  siteforge_content_commit($transaction);
  // Pages requested before they were imported may be cached as "not found", in the page cache and in the router's
  // cache of the path (a new alias does not invalidate that).
  Cache::invalidateTags(['4xx-response', 'route_match']);
  if ($done >= $total && !$state->get('siteforge_content.finalized', FALSE)) {
    siteforge_content_finalize($data);
  }
  $lock->release('siteforge_content_import');
  return [$done, $total];
}

/**
 * Commits an import transaction.
 */
function siteforge_content_commit(&$transaction): void {
  if ($transaction && method_exists($transaction, 'commitOrRelease')) {
    $transaction->commitOrRelease();
  }
  $transaction = NULL;
}

/**
 * Imports one page as a node (with its path alias and a seeded comment thread). A page that already exists (an
 * interrupted request imported it after its last saved progress) is skipped.
 */
function siteforge_content_import_page(array $page, string $front): void {
  $state = \\Drupal::state();
  $bundle = $page['type'] === 'page' ? 'sf_page' : substr('sf_' . preg_replace('/[^a-z0-9_]/', '_', strtolower($page['type'])), 0, 32);
  $alias = rtrim($page['path'], '/');
  $existing = $alias === '' ? $state->get('siteforge_content.front') : current(\\Drupal::entityTypeManager()->getStorage('path_alias')->getQuery()->accessCheck(FALSE)->condition('alias', $alias)->range(0, 1)->execute());
  if ($existing) {
    return;
  }
  $node = Node::create([
    'type' => $bundle,
    'title' => mb_substr($page['name'], 0, 255),
    'uid' => 1,
    'status' => 1,
    'body' => ['value' => $page['main'], 'format' => 'siteforge_raw'],
    'field_siteforge_layout' => json_encode(['title' => $page['title'], 'html' => $page['htmlAttrs'], 'classes' => $page['classes'], 'attrs' => $page['attrs'], 'head' => $page['head'], 'before' => $page['before'], 'after' => $page['after']]),
    'path' => $alias === '' ? [] : ['alias' => $alias, 'pathauto' => 0],
  ]);
  $node->save();
  // About one detail page in three gets a short, seeded comment thread (fictional names and text).
  $hash = crc32($page['path']);
  if ($bundle !== 'sf_page' && $hash % 3 === 0) {
    $names = ['Avery Holt', 'Jordan Pike', 'Sam Okafor', 'Riley Chen', 'Morgan Reyes', 'Casey Lund'];
    $texts = ['Thanks for putting this together.', 'Is there an updated version of this page?', 'Very helpful, I shared it with my team.', 'The opening hours listed here look different from the main page.', 'Could you add a printable version?', 'Great resource!'];
    for ($c = 0; $c < 1 + $hash % 3; $c++) {
      $text = $texts[($hash >> ($c + 5)) % 6];
      Comment::create(['entity_type' => 'node', 'entity_id' => $node->id(), 'field_name' => 'comment', 'comment_type' => 'comment', 'subject' => mb_substr($text, 0, 40), 'comment_body' => ['value' => $text, 'format' => 'plain_text'], 'name' => $names[($hash >> ($c + 2)) % 6], 'mail' => 'reader' . $c . '@example.invalid', 'uid' => 0, 'status' => 1, 'created' => 1767225600 + ($hash % 86400) + $c * 3600])->save();
    }
  }
  // The front page works as soon as it is imported (it is usually the first page).
  if ($page['path'] === $front) {
    $state->set('siteforge_content.front', $node->id());
    \\Drupal::configFactory()->getEditable('system.site')->set('page.front', '/node/' . $node->id())->save();
  }
}

/**
 * Runs once, when the last batch is imported: the main menu, the front page and the caches.
 */
function siteforge_content_finalize(array $data): void {
  $state = \\Drupal::state();
  $front = $state->get('siteforge_content.front');
  // A real Drupal main menu of the home and section pages (the first twelve non-detail pages, in import order),
  // rendered by the core menu block (menu--main classes, data-drupal-link-system-path attributes, is-active).
  $links = \\Drupal::entityTypeManager()->getStorage('menu_link_content');
  $links->delete($links->loadByProperties(['description' => 'SiteForge test site']));
  $storage = \\Drupal::entityTypeManager()->getStorage('node');
  $ids = $storage->getQuery()->accessCheck(FALSE)->condition('type', 'sf_page')->sort('nid')->range(0, 12)->execute();
  $weight = 0;
  foreach ($storage->loadMultiple($ids) as $section) {
    // The front page links to "/" (an answer-key URL), not to its /node/ID system path.
    $uri = ((string) $section->id() === (string) $front) ? 'internal:/' : 'entity:node/' . $section->id();
    MenuLinkContent::create(['title' => $section->label(), 'link' => ['uri' => $uri], 'menu_name' => 'main', 'weight' => $weight++, 'expanded' => FALSE, 'description' => 'SiteForge test site'])->save();
  }
  $site = \\Drupal::configFactory()->getEditable('system.site')->set('name', $data['site']['name']);
  if ($front) {
    $site->set('page.front', '/node/' . $front);
  }
  $site->save();
  $state->set('siteforge_content.finalized', TRUE);
  siteforge_content_clear_caches();
}

/**
 * Imports every remaining page, for the command line: drush php:eval "siteforge_content_import_all();"
 */
function siteforge_content_import_all(): void {
  if (function_exists('set_time_limit')) {
    @set_time_limit(0);
  }
  $started = microtime(TRUE);
  $last = -1;
  while (TRUE) {
    [$done, $total] = siteforge_content_import(30);
    if (PHP_SAPI === 'cli') {
      printf("%d of %d pages (%ds, peak memory %.1f MB)\\n", $done, $total, microtime(TRUE) - $started, memory_get_peak_usage(TRUE) / 1048576);
    }
    if ($done >= $total && \\Drupal::state()->get('siteforge_content.finalized', TRUE)) {
      break;
    }
    // Another import (an admin page load or cron) holds the lock: wait for it.
    if ($done === $last) {
      sleep(5);
    }
    $last = $done;
  }
}

/**
 * Whether test pages are still to be imported.
 */
function siteforge_content_import_pending(): bool {
  $state = \\Drupal::state();
  [$done] = $state->get('siteforge_content.progress', [0, 0]) + [0, 0];
  return $done < (int) $state->get('siteforge_content.total', 0) || !$state->get('siteforge_content.finalized', TRUE);
}

/**
 * Implements hook_cron(): continues a big import, so it completes without admin page loads.
 */
function siteforge_content_cron() {
  if (siteforge_content_import_pending()) {
    siteforge_content_import(30);
  }
}

/**
 * Clears what would keep showing an earlier SiteForge site: cached pages and compiled Twig templates.
 */
function siteforge_content_clear_caches() {
  Cache::invalidateTags(['rendered', 'http_response', '4xx-response', 'route_match']);
  foreach (['page', 'dynamic_page_cache', 'render'] as $bin) {
    \\Drupal::cache($bin)->deleteAll();
  }
  \\Drupal::service('twig')->invalidate();
}

/**
 * Implements hook_page_attachments().
 *
 * The theme prints the stored page instead of the node render array, so the canonical and shortlink tags that a
 * node page carries are added here.
 */
function siteforge_content_page_attachments(array &$attachments) {
  // Only the node's own page: edit forms, revisions and delete confirmations stay ordinary Drupal pages.
  $node = \\Drupal::routeMatch()->getRouteName() === 'entity.node.canonical' ? \\Drupal::routeMatch()->getParameter('node') : NULL;
  if (!$node instanceof NodeInterface || !$node->hasField('field_siteforge_layout')) {
    return;
  }
  $front = \\Drupal::service('path.matcher')->isFrontPage();
  $canonical = $front ? Url::fromRoute('<front>', [], ['absolute' => TRUE]) : $node->toUrl('canonical', ['absolute' => TRUE]);
  $attachments['#attached']['html_head_link'][] = [['rel' => 'canonical', 'href' => $canonical->toString()], TRUE];
  $attachments['#attached']['html_head_link'][] = [['rel' => 'shortlink', 'href' => $node->toUrl('canonical', ['absolute' => TRUE, 'alias' => TRUE])->toString()], TRUE];
}

/**
 * Returns the stored layout pieces for the current node page, or NULL.
 */
function siteforge_content_layout(): ?array {
  static $layout = FALSE;
  if ($layout !== FALSE) {
    return $layout;
  }
  $layout = NULL;
  $node = \\Drupal::routeMatch()->getRouteName() === 'entity.node.canonical' ? \\Drupal::routeMatch()->getParameter('node') : NULL;
  if ($node instanceof NodeInterface && $node->hasField('field_siteforge_layout') && !$node->get('field_siteforge_layout')->isEmpty()) {
    $data = json_decode($node->get('field_siteforge_layout')->value, TRUE);
    $lines = \\Drupal::state()->get('siteforge_content.lines', []);
    // Pages carry a placeholder where they linked to the generation address; it becomes this site's address.
    $request = \\Drupal::request();
    $localize = fn ($text) => strtr($text, [${phpString(ORIGIN_PLACEHOLDER)} => $request->getSchemeAndHttpHost(), ${phpString(ORIGIN_PLACEHOLDER.replace('http:', ''))} => '//' . $request->getHttpHost()]);
    $join = function ($runs) use ($lines, $localize) {
      $out = [];
      // A run is [start, length] in the shared line table, or a string of lines that appear on this page only.
      foreach ((array) $runs as $run) {
        if (is_string($run)) {
          $out[] = $run;
          continue;
        }
        for ($i = 0; $i < $run[1]; $i++) {
          $out[] = $lines[$run[0] + $i] ?? '';
        }
      }
      return Markup::create($localize(implode("\\n", $out)));
    };
    $layout = [
      'title' => Markup::create(htmlspecialchars($data['title'], ENT_QUOTES | ENT_HTML5, 'UTF-8', FALSE)),
      'html' => $data['html'] ?? [],
      'classes' => preg_split('/\\s+/', trim($data['classes']), -1, PREG_SPLIT_NO_EMPTY),
      'attrs' => Markup::create($data['attrs'] === '' ? '' : ' ' . $data['attrs']),
      'head' => $join($data['head']),
      'before' => $join($data['before']),
      'main' => Markup::create($localize($node->get('body')->value)),
      'after' => $join($data['after']),
      // Drupal renders the comment thread and form itself, between the generated content and footer.
      'comments' => $node->hasField('comment') ? $node->get('comment')->view(['type' => 'comment_default', 'label' => 'hidden', 'settings' => ['view_mode' => 'default', 'pager_id' => 0]]) : [],
    ];
  }
  return $layout;
}
`;
  const themeInfo = `name: 'SiteForge test theme'
type: theme
description: 'Renders the SiteForge test site "${label}". Test fixture, not for production.'
core_version_requirement: ^10 || ^11
base theme: false
libraries:
  - siteforge_theme/global
regions:
  primary_menu: 'Primary menu'
  highlighted: Highlighted
  breadcrumb: Breadcrumb
  content: Content
  footer: Footer
`;
  const libraries = `global:
  version: 1.0
  js:
    js/siteforge.js: {}
  dependencies:
    - core/drupal
    - core/drupalSettings
    - core/once
`;
  const themeFile = `<?php

/**
 * @file
 * SiteForge test theme: prints the generated page inside Drupal's own html and page templates.
 */

/**
 * Implements hook_preprocess_html().
 */
function siteforge_theme_preprocess_html(array &$variables) {
  $layout = function_exists('siteforge_content_layout') ? siteforge_content_layout() : NULL;
  $variables['siteforge'] = $layout;
  if ($layout) {
    $variables['head_title'] = ['title' => $layout['title']];
    // <html> attributes of the generated page (Webflow data-wf-*, data-ready, xmlns:og...) after Drupal's lang/dir.
    foreach ($layout['html'] as [$name, $value]) {
      $variables['html_attributes']->setAttribute($name, $value ?? '');
    }
    foreach ($layout['classes'] as $class) {
      $variables['attributes']['class'][] = $class;
    }
  }
}

/**
 * Implements hook_preprocess_page().
 */
function siteforge_theme_preprocess_page(array &$variables) {
  $variables['siteforge'] = function_exists('siteforge_content_layout') ? siteforge_content_layout() : NULL;
}
`;
  const html = `{#
/**
 * @file
 * SiteForge test theme: Drupal's html template with the generated head lines added.
 */
#}
<!DOCTYPE html>
<html{{ html_attributes }}>
  <head>
    <head-placeholder token="{{ placeholder_token }}">
    <title>{{ head_title|safe_join(' | ') }}</title>
    <css-placeholder token="{{ placeholder_token }}">
    <js-placeholder token="{{ placeholder_token }}">
{{ siteforge.head }}
  </head>
  <body{{ attributes }}{{ siteforge.attrs }}>
    {# Drupal core's skip link, as printed by its own html.html.twig. #}
    <a href="#main-content" class="visually-hidden focusable skip-link">
      {{ 'Skip to main content'|t }}
    </a>
    {{ page_top }}
    {{ page }}
    {{ page_bottom }}
    <js-bottom-placeholder token="{{ placeholder_token }}">
  </body>
</html>
`;
  const page = `{#
/**
 * @file
 * SiteForge test theme: the generated page; Drupal's own content region for anything else (403, 404, admin forms).
 */
#}
{% if siteforge %}{{ siteforge.before }}{{ page.primary_menu }}{{ page.highlighted }}{{ page.breadcrumb }}<a id="main-content" tabindex="-1"></a>{{ siteforge.main }}{{ siteforge.comments }}{{ siteforge.after }}{% else %}{{ page.highlighted }}<a id="main-content" tabindex="-1"></a><main id="content" class="site-main">{{ page.content }}</main>{% endif %}
{{ page.footer }}
`;
  return [
    { name: `${module}/siteforge_content.info.yml`, data: info },
    { name: `${module}/siteforge_content.services.yml`, data: services },
    { name: `${module}/siteforge_content.install`, data: install },
    { name: `${module}/siteforge_content.module`, data: moduleFile },
    { name: `${module}/src/StaticFiles.php`, data: staticFiles },
    { name: `${module}/src/TrailingSlash.php`, data: trailing },
    { name: `${module}/src/ImportOnAdmin.php`, data: importOnAdmin },
    { name: `${theme}/siteforge_theme.info.yml`, data: themeInfo },
    { name: `${theme}/siteforge_theme.libraries.yml`, data: libraries },
    { name: `${theme}/siteforge_theme.theme`, data: themeFile },
    { name: `${theme}/js/siteforge.js`, data: '(function (Drupal) {\n  Drupal.behaviors.siteforge = { attach() {} };\n})(Drupal);\n' },
    { name: `${theme}/templates/html.html.twig`, data: html },
    { name: `${theme}/templates/page.html.twig`, data: page },
    { name: 'SITEFORGE-README.txt', data: `SiteForge test site "${site.name}" for Drupal 10 or 11.\n\nUnzip into the Drupal web root (the folder with index.php) so modules/custom/siteforge_content and themes/custom/siteforge_theme are created.\nThen enable "SiteForge test content" (Extend page, or: drush en siteforge_content). Installing it installs the SiteForge theme, makes it the default and imports the first pages (about 20 seconds). Big sites continue importing on admin page loads (\"SiteForge is importing test pages: X of Y. Reload to continue.\") and on cron; to import everything at once from the command line:\n  drush php:eval \"siteforge_content_import_all();\"\nTotal pages: ${content.total}. Pages already imported are served while the import continues.\nCrawl the site root and compare with the answer key from SiteForge. URLs and field locations match the generated site.\nThis is a test fixture, not a production module or theme. To remove it, uninstall the module and delete the nodes.\n` },
  ];
}

// Package entries for zipping: { name, data } for generated files, { name, path } for copied site files.
export async function cmsPackageEntries(siteDirectory, cms) {
  const content = await scanSite(siteDirectory, cms);
  // Small files are read whole by PHP; pages.ndjson holds one page per line, is read one line at a time and is written
  // here as a stream (built page by page while the ZIP is sent), so neither side holds the whole site in memory.
  const meta = JSON.stringify({ version: 3, site: content.site, front: content.front, types: content.types, total: content.total });
  const data = prefix => [{ name: `${prefix}/content/site.json`, data: meta }, { name: `${prefix}/content/lines.json`, data: JSON.stringify(content.lines) },
    { name: `${prefix}/content/pages.ndjson`, open: async () => Readable.from((async function* () { for await (const page of pageRecords(content)) yield `${JSON.stringify(page)}\n`; })()) }];
  if (cms === 'wordpress') {
    const slug = `siteforge-${slugify(content.site.id, 40)}`;
    return { content, root: slug, entries: [...wordpressFiles(content, slug), ...data(slug),
      ...content.staticFiles.map(file => ({ name: `${slug}/siteforge-static/${file}`, path: join(content.publicRoot, file) }))] };
  }
  const module = 'modules/custom/siteforge_content';
  return { content, root: '', entries: [...drupalFiles(content), ...data(module),
    ...content.staticFiles.map(file => ({ name: `${module}/static/${file}`, path: join(content.publicRoot, file) }))] };
}
