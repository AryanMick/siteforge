#!/usr/bin/env node
// Combination matrix check (2026-11-04).
//
// Brad: "you should have a testing methodology that tests news with React and news with regular, news with mixed,
// government with React, government with mixed and so on, so that all the combinations have gotten some testing."
//
// Generates one small site (16 to 24 pages, realistic page source, medium noise, 50% randomness, a fixed seed per
// combination) through sitePlan, exactly as the app plans a test set, for every
//   site type (all 10) x technology (html, react, angular, mixed) x CMS markup (none, wordpress, drupal).
// "mixed" is a 3-site set planned with framework 'mixed', so sitePlan picks the framework per site (it must pick all
// three). Each generated site is checked, and every check records pass/fail with its reason:
//   1. generate: generation succeeds (it runs validateAnswerKey), the answer key written to disk validates again against
//      canonical.json and config.json, and the site has the requested framework and CMS markup in its page source;
//   2. inventory: every answer-key page exists in public/ and in sitemap.xml (and nothing else is in the sitemap), and
//      the clusters and content types are what the model says: metadata.json (the counts the app shows) and an
//      independent derivation from the plan's content types (types with the same field shape share a cluster, one
//      listing cluster per listing-record schema);
//   3. locations: in Chromium, on the home page, one listing and 3 detail pages (React/Angular pages after
//      data-ready), every expected field value is found at its recorded field location and every listing record field
//      at its repeated-item location, with no page errors;
//   4. links: every same-site link and asset on those pages (in the page source, in the rendered page and in the
//      browser's own requests) returns 200 unless it is recorded deliberate noise, and no unrecorded external URL;
//   5. score: a perfect answer built from the answer key scores 100% on every evaluator metric.
//
// Usage (artifacts are deleted as soon as each site is checked):
//   PLAYWRIGHT_BROWSERS_PATH=... node scripts/checks/check-matrix.mjs           full: 120 combinations, 180 sites
//   PLAYWRIGHT_BROWSERS_PATH=... node scripts/checks/check-matrix.mjs --quick   html/react/angular x none, 30 sites
// Options: --concurrency <n> (default 3), --budget-minutes <n> (default 30 full, 10 quick), --filter <regex on
// "site type/technology/cms">, --out <dir> (default outputs/matrix/<date>, quick: outputs/matrix/<date>-quick),
// --keep-failed (keep failing sites under the temporary root for debugging).
// Writes report.json and report.md. Exit code 1 if any combination fails or is not run within the time budget.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DOMAINS } from '../../src/site/presets.mjs';
import { FRAMEWORKS, VISUAL_STYLES, sitePlan } from '../../src/fixture-lab/config.mjs';
import { generate } from '../../src/site/generator.mjs';
import { serve } from '../../src/preview/server.mjs';
import { validateAnswerKey } from '../../src/answers/answer-key.mjs';
import { evaluate } from '../../src/answers/evaluator.mjs';
import { listingClusterId, listingItemSchema } from '../../src/site/model.mjs';
import { VERSION } from '../../src/site/util.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const { chromium } = await import('playwright');
const cheerio = createRequire(import.meta.url)('cheerio');

const TECHNOLOGIES = ['html', 'react', 'angular', 'mixed'];
const CMS_PROFILES = ['none', 'wordpress', 'drupal'];
const CHECKS = ['generate', 'inventory', 'locations', 'links', 'score'];

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const quick = process.argv.includes('--quick');
const keepFailed = process.argv.includes('--keep-failed');
const concurrency = Math.max(1, Number(option('concurrency', 3)));
const budgetMs = Number(option('budget-minutes', quick ? 10 : 30)) * 60_000;
const filter = option('filter') ? new RegExp(option('filter')) : null;
const date = new Date().toLocaleDateString('en-CA');
const outDir = resolve(option('out', join('outputs', 'matrix', quick ? `${date}-quick` : date)));
const technologies = quick ? ['html', 'react', 'angular'] : TECHNOLOGIES;
const cmsProfiles = quick ? ['none'] : CMS_PROFILES;

// One request per combination. The seed, page count and visual style vary per combination but are fixed, so a quick
// run builds exactly the same sites as the matching cells of a full run.
function combinations() {
  const result = [];
  for (const [d, domain] of DOMAINS.entries()) for (const [t, technology] of TECHNOLOGIES.entries()) for (const [c, cms] of CMS_PROFILES.entries()) {
    if (!technologies.includes(technology) || !cmsProfiles.includes(cms)) continue;
    const index = d * 12 + t * 3 + c;
    const id = `${domain}/${technology}/${cms}`;
    if (filter && !filter.test(id)) continue;
    result.push({ id, domain, technology, cms, index, request: {
      name: 'Matrix', siteCount: technology === 'mixed' ? 3 : 1, pagesPerSite: 16 + index % 9, seed: 52000 + index * 7,
      domain, framework: technology, visualStyle: VISUAL_STYLES[(d + t + c) % 3], noise: 'medium', randomness: 50,
      fieldLayout: 'mixed', linkMode: 'root-relative', cmsProfile: cms, builderProfile: 'none', sourceClutter: 'realistic',
      optionalFields: true, scenario: 'baseline', transport: 'none', previewProtocol: 'http',
    } });
  }
  return result;
}

const sameSet = (a, b) => a.size === b.size && [...a].every(item => b.has(item));
const list = set => [...set].sort().join(', ');
const short = (value, length = 90) => { const text = JSON.stringify(value) ?? String(value); return text.length > length ? `${text.slice(0, length - 1)}…` : text; };

// Reads a recorded field location the way check-field-locations.mjs does.
async function readLocation(page, location) {
  return page.evaluate(({ selector, read, label }) => {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length !== 1) return { count: matches.length };
    const element = matches[0];
    if (read === 'urlPath') return { count: 1, value: new URL(element.getAttribute('src'), document.baseURI).pathname };
    if (read === 'afterLabel') {
      const prefix = `${label}: `;
      return { count: 1, value: element.textContent.startsWith(prefix) ? element.textContent.slice(prefix.length) : null };
    }
    if (read === 'afterStrongLabel') {
      const strong = element.firstChild;
      if (strong?.nodeType !== Node.ELEMENT_NODE || strong.tagName !== 'STRONG' || strong.textContent !== label) return { count: 1, value: null };
      const remaining = [...element.childNodes].slice(1).map(node => node.textContent).join('');
      return { count: 1, value: remaining.startsWith(' ') ? remaining.slice(1) : null };
    }
    return { count: 1, value: element.textContent };
  }, location);
}

// Home, one listing (with listing records when there are any) and 3 detail pages of different content types,
// preferring a different field layout for each.
function samplePages(truth) {
  const home = truth.pages.find(page => page.kind === 'home');
  const listings = truth.pages.filter(page => page.kind === 'listing');
  const listing = listings.find(page => page.repeatedItems?.length) ?? listings[0];
  const byType = new Map();
  for (const page of truth.pages) if (page.kind === 'detail' && page.contentType !== 'information') {
    if (!byType.has(page.contentType)) byType.set(page.contentType, []);
    byType.get(page.contentType).push(page);
  }
  const details = [], layouts = new Set();
  for (const group of byType.values()) {
    if (details.length === 3) break;
    const pick = group.find(page => !layouts.has(page.fieldLayout)) ?? group[0];
    layouts.add(pick.fieldLayout); details.push(pick);
  }
  return [home, listing, ...details].filter(Boolean);
}

// URLs a page refers to, as check-site-controls.mjs collects them: links, stylesheets, scripts, images, frames, form
// actions and sources, skipping templates, noscript, the hidden honeypot and resource hints.
const URL_SELECTOR = 'a[href], link[href], script[src], img[src], img[srcset], iframe[src], form[action], source[src], source[srcset]';
const SKIPPED_RELS = ['dns-prefetch', 'preconnect', 'shortlink'];
const srcsetUrls = value => String(value ?? '').split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean);
function sourceUrls(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = $('base[href]').attr('href') ?? pageUrl;
  const result = [];
  $(URL_SELECTOR).each((_, element) => {
    if ($(element).closest('template, noscript, .crawler-honeypot').length || SKIPPED_RELS.includes(element.attribs.rel)) return;
    for (const raw of [element.attribs.href, element.attribs.src, element.attribs.action, ...srcsetUrls(element.attribs.srcset)]) if (raw) result.push({ raw, base });
  });
  return result;
}
async function renderedUrls(page) {
  return page.evaluate(({ selector, skipped }) => {
    const result = [];
    for (const element of document.querySelectorAll(selector)) {
      if (element.closest('template, noscript, .crawler-honeypot') || skipped.includes(element.getAttribute('rel'))) continue;
      const srcset = (element.getAttribute('srcset') ?? '').split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean);
      for (const raw of [element.getAttribute('href'), element.getAttribute('src'), element.getAttribute('action'), ...srcset]) if (raw) result.push({ raw, base: document.baseURI });
    }
    return result;
  }, { selector: URL_SELECTOR, skipped: SKIPPED_RELS });
}

function expectedModel(config, truth) {
  const types = config.contentTypes;
  const detailClusters = new Map();
  for (const type of types) {
    const shape = JSON.stringify(type.fields.map(field => [field.name, field.type, Boolean(field.optional)]).sort((a, b) => a[0].localeCompare(b[0])));
    if (!detailClusters.has(shape)) detailClusters.set(shape, type.name);
  }
  const listingClusters = config.variation?.amount > 0 ? types.map(type => listingClusterId(listingItemSchema(type))) : ['listing'];
  const information = truth.pages.some(page => page.contentType === 'information') ? ['information'] : [];
  return {
    clusters: new Set(['home', ...detailClusters.values(), ...listingClusters, ...information]),
    contentTypes: new Set(['home', 'listing', ...types.map(type => type.name), ...information]),
  };
}

async function checkSite(browser, root, combo, plan) {
  const started = performance.now();
  const config = plan.config;
  const result = { siteId: plan.id, framework: config.site.framework, cmsProfile: config.site.cmsProfile, visualStyle: config.site.visualStyle, pageCount: config.site.pageCount, seed: config.seed, checks: {}, counts: {} };
  const failures = Object.fromEntries(CHECKS.map(name => [name, []]));
  const fail = (check, message) => failures[check].push(message);
  const directory = join(root, `${combo.id.replaceAll('/', '-')}-${plan.id}`);
  let preview = null, context = null, phase = 'generate';
  try {
    // 1. Generation and the answer key.
    try { await generate(config, directory); } catch (error) { fail('generate', error.message.split('\n').slice(0, 3).join(' ')); return result; }
    const read = async (...parts) => readFile(join(directory, ...parts), 'utf8');
    const truth = JSON.parse(await read('private', 'answer-key.json'));
    const savedConfig = JSON.parse(await read('private', 'config.json'));
    const metadata = JSON.parse(await read('private', 'metadata.json'));
    try { validateAnswerKey(JSON.parse(await read('private', 'canonical.json')), truth, savedConfig); }
    catch (error) { fail('generate', `answer key on disk: ${error.message.split('\n')[0]}`); }
    const home = await read('public', 'index.html');
    const marker = { html: !home.includes('id="page-data"'), react: home.includes('/assets/react-app.js'), angular: home.includes('/assets/angular-app.js') };
    if (truth.site.framework !== config.site.framework || !marker[config.site.framework]) fail('generate', `framework is ${truth.site.framework}, page source does not match ${config.site.framework}`);
    const cmsSeen = home.includes('/wp-content/') ? 'wordpress' : /drupalSettings|data-drupal-/.test(home) ? 'drupal' : 'none';
    if (metadata.site.cmsProfile !== combo.cms || cmsSeen !== combo.cms) fail('generate', `CMS markup: configured ${metadata.site.cmsProfile}, page source looks like ${cmsSeen}, expected ${combo.cms}`);

    // 2. Inventory, clusters and content types.
    phase = 'inventory';
    for (const page of truth.pages) if (!existsSync(join(directory, 'public', ...page.url.split('/').filter(Boolean), 'index.html'))) fail('inventory', `missing public file for ${page.url}`);
    const sitemap = new Set([...(await read('public', 'sitemap.xml')).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname));
    const urls = new Set(truth.pages.map(page => page.url));
    if (!sameSet(sitemap, urls)) fail('inventory', `sitemap lists ${sitemap.size} URLs, answer key ${urls.size} (${short([...urls].filter(url => !sitemap.has(url)).concat([...sitemap].filter(url => !urls.has(url))))})`);
    const clusters = new Set(truth.pages.map(page => page.expectedCluster));
    const contentTypes = new Set(truth.pages.map(page => page.contentType));
    const expected = expectedModel(savedConfig, truth);
    if (!sameSet(clusters, expected.clusters)) fail('inventory', `clusters: answer key has ${clusters.size} (${list(clusters)}), the plan implies ${expected.clusters.size} (${list(expected.clusters)})`);
    if (metadata.clusters.length !== clusters.size || !sameSet(new Set(metadata.clusters), clusters)) fail('inventory', `metadata.json reports ${metadata.clusters.length} clusters, answer key has ${clusters.size}`);
    if (!sameSet(contentTypes, expected.contentTypes)) fail('inventory', `content types: answer key has ${list(contentTypes)}, the plan implies ${list(expected.contentTypes)}`);
    const schemaTypes = new Set(Object.keys(truth.schemas));
    if (![...contentTypes].every(type => schemaTypes.has(type)) || !sameSet(new Set(metadata.contentTypes), schemaTypes)) fail('inventory', `metadata.json content types (${metadata.contentTypes.length}) differ from the answer-key schemas (${schemaTypes.size})`);
    for (const type of savedConfig.contentTypes) {
      if (!truth.pages.some(page => page.kind === 'detail' && page.contentType === type.name)) fail('inventory', `no detail page for ${type.name}`);
      if (!truth.pages.some(page => page.kind === 'listing' && page.links.some(link => truth.pages.find(item => item.url === link.href)?.contentType === type.name))) fail('inventory', `no listing for ${type.name}`);
    }
    const shapes = new Map();
    for (const page of truth.pages) {
      const shape = JSON.stringify([...truth.schemas[page.contentType]].sort());
      if (shapes.has(page.expectedCluster) && shapes.get(page.expectedCluster) !== shape) fail('inventory', `cluster ${page.expectedCluster} mixes data structures`);
      shapes.set(page.expectedCluster, shape);
    }
    result.counts.clusters = clusters.size; result.counts.contentTypes = contentTypes.size; result.counts.pages = truth.pages.length;

    // 5. The scorer: a perfect answer scores 100%.
    phase = 'score';
    const perfect = { version: 1, tool: 'matrix-perfect-answer', schemas: truth.schemas, pages: truth.pages.map(page => ({
      url: page.url, cluster: page.expectedCluster, contentType: page.contentType, fields: page.fields, relationships: page.relationships,
      ...(page.repeatedItems?.length ? { repeatedItems: page.repeatedItems.map(item => ({ url: item.url, fields: item.fields })) } : {}),
    })) };
    try {
      const report = evaluate(truth, perfect);
      const metrics = {
        coverage: report.coverage.recall, noUnexpectedPages: report.coverage.unexpected === 0 ? 1 : 0,
        clusterPairF1: report.clustering.allExpected.pairs.f1, adjustedRandIndex: report.clustering.allExpected.adjustedRandIndex,
        contentTypeAccuracy: report.contentType.accuracy, fieldPresenceF1: report.fields.pagePresence?.f1, fieldValueF1: report.fields.values?.f1,
        schemaF1: report.fields.schemaPresence?.presence?.f1,
        ...(truth.pages.some(page => page.relationships.length) ? { relationshipF1: report.relationships.score?.f1 } : {}),
        ...(truth.pages.some(page => page.repeatedItems?.length) ? { listingRecordF1: report.repeatedItems.items?.f1, listingFieldF1: report.repeatedItems.values?.f1 } : {}),
      };
      for (const [name, value] of Object.entries(metrics)) if (value !== 1) fail('score', `${name} is ${value}`);
      if (report.diagnostics.total) fail('score', `${report.diagnostics.total} diagnostics: ${short(report.diagnostics.counts)}`);
      result.counts.scoredMetrics = Object.keys(metrics).length;
    } catch (error) { fail('score', `evaluate threw: ${error.message.split('\n')[0]}`); }

    // 3 and 4. Browser checks on the sampled pages, then the link check.
    phase = 'locations';
    preview = await serve(directory, { port: 0, rebaseOrigin: true });
    const origin = preview.url;
    const sourceOrigin = new URL(savedConfig.site.baseUrl).origin;
    const transport = await read('private', 'transport.json').catch(() => '');
    const recorded = JSON.stringify(truth.pages.map(page => page.noiseEvents)) + transport;
    const brokenImagePages = new Set(truth.pages.filter(page => page.noiseEvents.some(event => event.type === 'broken-image')).map(page => page.url));
    const allowed = (target, pageUrl) => recorded.includes(target.pathname) || (target.search && recorded.includes(target.search.slice(1, 40)))
      || recorded.includes(decodeURIComponent(target.pathname))
      || (/^\/assets\/missing-\d+(-[12]x)?\.png$/.test(target.pathname) && brokenImagePages.has(pageUrl));
    const targets = new Map();
    const external = new Set();
    const addUrl = (raw, base, pageUrl, how) => {
      if (/^(mailto|tel|sms|javascript|data|ftp|file|about|blob):/i.test(raw) || raw.startsWith('#')) return;
      let target;
      try { target = new URL(raw, new URL(base, origin)); } catch { return; }
      if (target.origin === sourceOrigin) target = new URL(`${target.pathname}${target.search}`, origin);
      if (target.origin !== origin) {
        if (/^https?:$/.test(target.protocol) && !recorded.includes(raw) && !/\.invalid$/.test(target.hostname)) external.add(`${raw} (${how} ${pageUrl})`);
        return;
      }
      target.hash = '';
      if (!targets.has(target.href)) targets.set(target.href, { pageUrl, how, raw });
    };
    context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    const requests = [];
    page.on('pageerror', error => pageErrors.push(error.message.split('\n')[0]));
    // Each browser request belongs to the page that started it: a client-rendered image can still be answered after
    // the check has moved on to the next page.
    let current = null;
    const startedOn = new WeakMap();
    page.on('request', request => startedOn.set(request, current));
    page.on('response', response => { if (response.status() >= 400) requests.push({ url: response.url(), status: response.status(), pageUrl: startedOn.get(response.request()) }); });
    page.on('requestfailed', request => requests.push({ url: request.url(), status: request.failure()?.errorText ?? 'failed', pageUrl: startedOn.get(request) }));
    let located = 0, repeatedLocated = 0;
    const sampled = samplePages(truth);
    result.sampled = sampled.map(record => record.url);
    for (const record of sampled) {
      const where = record.url;
      const errorsBefore = pageErrors.length;
      current = record.url;
      try {
        await page.goto(origin + record.url, { waitUntil: 'load', timeout: 30_000 });
        if (config.site.framework !== 'html') await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 15_000 });
      } catch (error) { fail('locations', `${where}: page did not load or render: ${error.message.split('\n')[0]}`); continue; }
      for (const [name, location] of Object.entries(record.fieldLocations ?? {})) {
        if (location.state === 'absent') { if (location.selector !== undefined || Object.hasOwn(record.fields, name)) fail('locations', `${where} ${name}: absent field has a selector or value`); continue; }
        if (location.state !== 'present') { fail('locations', `${where} ${name}: unresolved location (${location.state}: ${location.reason})`); continue; }
        const found = await readLocation(page, location);
        if (found.count !== 1) fail('locations', `${where} ${name}: ${found.count} matches for ${location.selector}`);
        else if (found.value !== record.fields[name]) fail('locations', `${where} ${name}: found ${short(found.value, 60)}, expected ${short(record.fields[name], 60)} at ${location.selector}`);
        else located++;
      }
      if (record.repeatedItems?.length) {
        if (record.repeatedItemLocations?.length !== record.repeatedItems.length) fail('locations', `${where}: ${record.repeatedItemLocations?.length ?? 0} repeated-item locations for ${record.repeatedItems.length} records`);
        for (const [index, item] of record.repeatedItems.entries()) {
          const entry = record.repeatedItemLocations?.[index];
          if (!entry || entry.url !== item.url) { fail('locations', `${where}: repeated item ${index + 1} has no matching location`); continue; }
          for (const [name, location] of Object.entries(entry.fieldLocations)) {
            if (location.state === 'absent') { if (Object.hasOwn(item.fields, name)) fail('locations', `${where} record ${item.pageId} ${name}: marked absent but has a value`); continue; }
            if (location.state !== 'present') { fail('locations', `${where} record ${item.pageId} ${name}: unresolved location`); continue; }
            const found = await readLocation(page, location);
            if (found.count !== 1) fail('locations', `${where} record ${item.pageId} ${name}: ${found.count} matches for ${location.selector}`);
            else if (found.value !== item.fields[name]) fail('locations', `${where} record ${item.pageId} ${name}: found ${short(found.value, 60)}, expected ${short(item.fields[name], 60)}`);
            else repeatedLocated++;
          }
        }
      }
      if (pageErrors.length > errorsBefore) fail('locations', `${where}: page errors: ${pageErrors.slice(errorsBefore, errorsBefore + 2).join(' | ')}`);
      for (const { raw, base } of await renderedUrls(page)) addUrl(raw, base, record.url, 'rendered');
      for (const { raw, base } of sourceUrls(await read('public', ...record.url.split('/').filter(Boolean), 'index.html'), record.url)) addUrl(raw, base, record.url, 'source');
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    for (const request of requests) {
      let target;
      try { target = new URL(request.url); } catch { continue; }
      if (target.origin !== origin) continue;
      target.hash = '';
      const pageUrl = request.pageUrl ?? '(unknown page)';
      // The browser cancelled it (a lazy image or a request still open when the next page loads): the server never
      // answered, so the URL is requested below like every other one and must return 200 there.
      if (request.status === 'net::ERR_ABORTED') { if (!targets.has(target.href)) targets.set(target.href, { pageUrl, how: 'browser request', raw: target.pathname }); continue; }
      // A planned 404 (broken-image noise) or other recorded noise is expected to fail in the browser too.
      if (!allowed(target, pageUrl)) fail('links', `browser request ${request.status} ${target.pathname}${target.search} on ${pageUrl}`);
    }
    result.counts.fieldsLocated = located; result.counts.repeatedFieldsLocated = repeatedLocated;
    if (located === 0) fail('locations', 'no field location was verified');
    phase = 'links';
    const entries = [...targets];
    for (let i = 0; i < entries.length; i += 16) {
      await Promise.all(entries.slice(i, i + 16).map(async ([href, from]) => {
        const response = await fetch(href, { redirect: 'follow', signal: AbortSignal.timeout(15_000) }).catch(error => ({ status: error.name }));
        if (response.status === 200) { await response.arrayBuffer?.(); return; }
        await response.arrayBuffer?.().catch(() => {});
        const target = new URL(href);
        if (!allowed(target, from.pageUrl)) fail('links', `${response.status} ${target.pathname}${target.search} (${from.how} ${from.raw.slice(0, 80)} on ${from.pageUrl})`);
      }));
    }
    for (const item of external) fail('links', `unrecorded external URL ${item}`);
    result.counts.urlsChecked = targets.size;
    return result;
  } catch (error) {
    fail(phase, `check crashed: ${error.message.split('\n')[0]}`);
    return result;
  } finally {
    await context?.close().catch(() => {});
    await preview?.close().catch(() => {});
    for (const name of CHECKS) result.checks[name] = failures[name].length ? { ok: false, reason: failures[name].slice(0, 6).join('; ') + (failures[name].length > 6 ? `; … ${failures[name].length - 6} more` : '') } : { ok: true };
    result.ok = CHECKS.every(name => result.checks[name].ok);
    result.durationMs = Math.round(performance.now() - started);
    if (!(keepFailed && !result.ok)) {
      await rm(directory, { recursive: true, force: true });
      await rm(`${directory}.building-${process.pid}`, { recursive: true, force: true });
    } else result.keptAt = directory;
  }
}

function markFor(combo) { return combo.status === 'pass' ? '✓' : combo.status === 'fail' ? '✗' : '–'; }
function grid(combos, markdown) {
  const byId = new Map(combos.map(combo => [combo.id, combo]));
  const cell = (domain, technology) => cmsProfiles.map(cms => byId.get(`${domain}/${technology}/${cms}`)).map(combo => combo ? markFor(combo) : ' ').join(' ');
  const domains = DOMAINS.filter(domain => combos.some(combo => combo.domain === domain));
  if (markdown) {
    const header = `| Site type | ${technologies.join(' | ')} |\n| --- | ${technologies.map(() => ':---:').join(' | ')} |`;
    return `${header}\n${domains.map(domain => `| ${domain} | ${technologies.map(technology => cell(domain, technology)).join(' | ')} |`).join('\n')}`;
  }
  const width = Math.max(cmsProfiles.length * 2 + 2, Math.max(...technologies.map(technology => technology.length)) + 2);
  const lines = [`${''.padEnd(14)}${technologies.map(technology => technology.padEnd(width)).join('')}`];
  if (cmsProfiles.length > 1) lines.push(`${''.padEnd(14)}${technologies.map(() => cmsProfiles.map(cms => cms[0]).join(' ').padEnd(width)).join('')}`);
  for (const domain of domains) lines.push(`${domain.padEnd(14)}${technologies.map(technology => cell(domain, technology).padEnd(width)).join('')}`);
  return lines.join('\n');
}

const started = Date.now();
const startedAt = new Date().toISOString();
const combos = combinations();
const jobs = [];
for (const combo of combos) {
  combo.status = 'not-run'; combo.reasons = []; combo.sites = [];
  try {
    combo.plans = Array.from({ length: combo.request.siteCount }, (_, index) => sitePlan(combo.request, index));
    if (combo.technology === 'mixed') {
      const picked = new Set(combo.plans.map(plan => plan.config.site.framework));
      combo.mixedFrameworks = combo.plans.map(plan => plan.config.site.framework);
      if (!sameSet(picked, new Set(FRAMEWORKS))) combo.reasons.push(`mixed set picked ${combo.mixedFrameworks.join(', ')}, not all of ${FRAMEWORKS.join(', ')}`);
    }
    for (const plan of combo.plans) jobs.push({ combo, plan });
  } catch (error) { combo.status = 'fail'; combo.reasons.push(`sitePlan: ${error.message.split('\n')[0]}`); }
}
console.log(`Matrix check (${quick ? 'quick' : 'full'}): ${combos.length} combinations, ${jobs.length} sites, ${concurrency} at a time, budget ${budgetMs / 60_000} min; generator ${VERSION}`);
const root = await mkdtemp(join(tmpdir(), 'siteforge-matrix-'));
const browser = await chromium.launch({ headless: true });
let next = 0, done = 0;
try {
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      if (Date.now() - started > budgetMs) return;
      const job = jobs[next++];
      const site = await checkSite(browser, root, job.combo, job.plan);
      job.combo.sites.push(site);
      done++;
      const failed = CHECKS.filter(name => !site.checks[name].ok);
      console.log(`[${String(done).padStart(3)}/${jobs.length}] ${site.ok ? 'PASS' : 'FAIL'} ${job.combo.id}${job.combo.technology === 'mixed' ? ` (${site.framework})` : ''} ${site.pageCount} pages, ${(site.durationMs / 1000).toFixed(1)}s${failed.length ? ` — ${failed.map(name => `${name}: ${site.checks[name].reason}`).join(' | ').slice(0, 600)}` : ''}`);
    }
  }));
} finally {
  await browser.close();
  if (!keepFailed) await rm(root, { recursive: true, force: true });
}

for (const combo of combos) {
  delete combo.plans;
  if (combo.status === 'fail' && !combo.sites.length) continue;
  if (combo.sites.length < combo.request.siteCount) { combo.status = 'not-run'; combo.reasons.push(`${combo.request.siteCount - combo.sites.length} of ${combo.request.siteCount} sites not run within the time budget`); continue; }
  for (const site of combo.sites) for (const name of CHECKS) if (!site.checks[name].ok) combo.reasons.push(`${site.siteId} (${site.framework}) ${name}: ${site.checks[name].reason}`);
  combo.status = combo.reasons.length ? 'fail' : 'pass';
}
const totals = { combinations: combos.length, passed: combos.filter(c => c.status === 'pass').length, failed: combos.filter(c => c.status === 'fail').length, notRun: combos.filter(c => c.status === 'not-run').length, sites: jobs.length, sitesChecked: combos.reduce((n, c) => n + c.sites.length, 0) };
const durationMs = Date.now() - started;
const report = { version: 1, date, mode: quick ? 'quick' : 'full', generatorVersion: VERSION, startedAt, finishedAt: new Date().toISOString(), durationMs, concurrency, budgetMinutes: budgetMs / 60_000, filter: filter?.source ?? null,
  axes: { siteTypes: DOMAINS, technologies, cmsProfiles }, checks: CHECKS, totals, combinations: combos };
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failures = combos.filter(combo => combo.status !== 'pass');
const md = [`# SiteForge combination matrix — ${date} (${report.mode})`, '',
  `Generator ${VERSION}. ${totals.combinations} combinations (${totals.sitesChecked} of ${totals.sites} sites checked) in ${(durationMs / 60_000).toFixed(1)} min: ${totals.passed} passed, ${totals.failed} failed, ${totals.notRun} not run.`, '',
  `Each cell shows ${cmsProfiles.join(' · ')} CMS markup (✓ pass, ✗ fail, – not run). "mixed" is a 3-site set where sitePlan picks the framework per site.`, '',
  grid(combos, true), '',
  'Checks per site: generate (generation and answer-key validation, requested framework and CMS in the page source), inventory (every answer-key page in public/ and the sitemap; clusters and content types as the model says), locations (field and listing-record values at their recorded locations in Chromium on home, one listing and 3 details), links (same-site links and assets on those pages return 200 unless recorded noise), score (a perfect answer scores 100%).', '',
  ...(failures.length ? ['## Failures', '', ...failures.map(combo => `- **${combo.id}** (${combo.status}): ${combo.reasons.join(' / ')}`)] : ['All combinations passed.']), ''].join('\n');
await writeFile(join(outDir, 'report.md'), md);
console.log(`\n${grid(combos, false)}\n`);
console.log(`(${cmsProfiles.join(' · ')} per technology; ✓ pass, ✗ fail, – not run)`);
console.log(`${totals.passed}/${totals.combinations} combinations passed, ${totals.failed} failed, ${totals.notRun} not run; ${totals.sitesChecked} sites in ${(durationMs / 60_000).toFixed(1)} min.`);
console.log(`Report: ${join(outDir, 'report.md')}`);
if (totals.failed || totals.notRun) process.exitCode = 1;
