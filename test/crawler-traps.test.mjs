import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { request } from 'node:http';
import { parse } from 'parse5';
import robotsParser from 'robots-parser';
import { validateConfig, CRAWLER_TRAP_TYPES, MARKUP_NOISE_TYPES, NOISE_TYPES } from '../src/config.mjs';
import { createModel } from '../src/model.mjs';
import { applyDataNoise, applyHtmlNoise } from '../src/noise.mjs';
import { renderPage, finalizePage } from '../src/renderers.mjs';
import { validateAnswerKey } from '../src/answer-key.mjs';
import { buildTransportPlan, LEGACY_SERVER_TYPES, validateTransportPlan } from '../src/transport.mjs';
import { generate } from '../src/generator.mjs';
import { serve } from '../src/server.mjs';
import { sitePlan, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { LEGACY_SERVER_CATALOG, OBSTACLE_CATALOG, OPT_IN_SCENARIOS, SCENARIO_LABELS, TRANSPORT_LABELS } from '../src/fixture-lab/catalog.mjs';
import { RESOURCE_ONLY_TRAP_TYPES, SCRIPT_TRAP_TYPES, TRAP_GROUPS, TRAP_SCENARIOS, stripSessionPath, trapDetails, trapGroup } from '../src/crawler-traps.mjs';
import { attr, escapeHtml, walk } from '../src/util.mjs';

const PUBLIC_NOISE_LABELS = new RegExp(NOISE_TYPES.map(type => `\\b${type}\\b`).join('|'));
const PRIVATE_TERMS = /expectedCluster|canonicalValues|noiseEvents|ground-truth|answer-key/;
const BASE = 'http://traps.siteforge.test';
const configFor = (severity, framework = 'html', types = CRAWLER_TRAP_TYPES, extra = {}, transport = 'none') => validateConfig({
  seed: 9182, site: { id: 'crawler-traps', framework, visualStyle: 'legacy', pageCount: 14, baseUrl: BASE, ...extra },
  noise: { level: 'custom', probability: 1, severity, maxPerPage: types.length, types: [...types] },
  transport: { profile: transport },
});
const observe = config => { const model = createModel(config); return { model, observed: model.pages.map(page => applyDataNoise(page, model.site)) }; };
const noTransport = (model, config) => buildTransportPlan(model.pages, { profile: 'none', seed: config.seed });

test('trap registry, catalog, scenarios and opt-in rules agree', () => {
  assert(CRAWLER_TRAP_TYPES.length >= 75, `only ${CRAWLER_TRAP_TYPES.length} traps`);
  assert.equal(new Set(CRAWLER_TRAP_TYPES).size, CRAWLER_TRAP_TYPES.length);
  for (const type of CRAWLER_TRAP_TYPES) {
    assert(NOISE_TYPES.includes(type) && !MARKUP_NOISE_TYPES.includes(type), type);
    assert.equal(OBSTACLE_CATALOG.find(item => item.id === type)?.group, TRAP_GROUPS[trapGroup(type)], type);
  }
  assert.deepEqual(Object.values(TRAP_SCENARIOS).flat().sort(), [...CRAWLER_TRAP_TYPES].sort());
  for (const scenario of OPT_IN_SCENARIOS) assert(SCENARIO_LABELS[scenario], scenario);
  assert.deepEqual(sitePlan(validateFixtureInput({ name: 'All', scenario: 'crawler-traps' }), 0).config.noise.types, CRAWLER_TRAP_TYPES);
  for (const [scenario, types] of Object.entries(TRAP_SCENARIOS)) {
    assert(types.length >= 2, scenario);
    assert.deepEqual(sitePlan(validateFixtureInput({ name: scenario, scenario }), 0).config.noise.types, types, scenario);
  }
  assert(sitePlan(validateFixtureInput({ name: 'Baseline' }), 0).config.noise.types.every(type => !CRAWLER_TRAP_TYPES.includes(type)));
  const random = validateFixtureInput({ name: 'Random', siteCount: 300, pagesPerSite: 5, scenario: 'random', transport: 'random', framework: 'random' });
  for (let index = 0; index < 300; index++) {
    const plan = sitePlan(random, index);
    assert(!OPT_IN_SCENARIOS.includes(plan.summary.scenario));
    assert.notEqual(plan.summary.transport, 'legacy-server');
  }
  assert.equal(TRANSPORT_LABELS['legacy-server'], 'Legacy server behaviour');
  assert.deepEqual(LEGACY_SERVER_CATALOG.map(item => item.id), LEGACY_SERVER_TYPES);
  for (const label of ['CGI Bin', 'Login', 'Frames', 'Feeds', 'M']) {
    assert.throws(() => validateConfig({ site: { id: 'reserved' }, contentTypes: [{ name: 'record', label, fields: [{ name: 'title', type: 'title' }] }] }), /reserved URL slug/, label);
  }
});

test('every trap records verifiable details and keeps canonical truth, at every severity and framework', () => {
  for (const severity of [1, 2, 3]) {
    for (const framework of ['html', 'react', 'angular']) {
      const config = configFor(severity, framework);
      const { model, observed } = observe(config);
      const before = JSON.stringify(model.pages);
      const seen = new Set();
      for (const [index, page] of observed.entries()) {
        const canonical = model.pages[index];
        for (const key of ['fields', 'links', 'fieldLocations', 'repeatedItems', 'repeatedItemLocations', 'url', 'expectedCluster']) assert.deepEqual(page[key], canonical[key], key);
        for (const event of page.noiseEvents) {
          seen.add(event.type);
          assert.deepEqual(event.details, trapDetails(event.type, canonical, model.site, severity));
          assert.deepEqual(JSON.parse(JSON.stringify(event.details)), event.details, `${event.type} details must be plain JSON`);
        }
        const clean = renderPage(model.site, canonical);
        const noisy = finalizePage(model.site, page, applyHtmlNoise(renderPage(model.site, page), page, model.site));
        if (page.noiseEvents.some(event => !RESOURCE_ONLY_TRAP_TYPES.includes(event.type))) assert.notEqual(noisy, clean);
        assert.doesNotMatch(noisy, PUBLIC_NOISE_LABELS, page.url);
        assert.doesNotMatch(noisy, PRIVATE_TERMS);
        assert.equal(applyHtmlNoise(renderPage(model.site, page), page, model.site), applyHtmlNoise(renderPage(model.site, page), page, model.site));
      }
      assert.deepEqual([...new Set(CRAWLER_TRAP_TYPES)].filter(type => !seen.has(type)), [], `severity ${severity} ${framework}`);
      assert.equal(JSON.stringify(model.pages), before);
      validateAnswerKey(model, { ...model, pages: observed, transport: noTransport(model, config) }, config);
    }
  }
});

function hrefsIn(details) {
  const out = [];
  const visit = (value, key) => {
    if (typeof value === 'string' && ['href', 'entry', 'confirmHref', 'feed', 'frameSrc', 'index'].includes(key)) out.push(value);
    else if (Array.isArray(value)) for (const item of value) visit(item, ['targets', 'variants', 'slotted', 'fallbackLinks', 'jsonTargets', 'hrefs'].includes(key) ? 'href' : key);
    else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) visit(item, name);
  };
  visit(details, '');
  return out;
}

test('trap markup exposes exactly what the answer key records', () => {
  const config = configFor(3);
  const { model, observed } = observe(config);
  for (const page of observed) {
    const html = applyHtmlNoise(renderPage(model.site, page), page, model.site);
    const doc = parse(html);
    const details = Object.fromEntries(page.noiseEvents.map(event => [event.type, event.details]));
    for (const [type, d] of Object.entries(details)) {
      if (['entity-encoded-hrefs', 'sitemap-traps', 'robots-txt-traps'].includes(type)) continue;
      for (const href of hrefsIn(d)) assert(html.includes(escapeHtml(href)) || html.includes(href), `${type} ${href} on ${page.url}`);
    }
    const scripts = walk(doc, node => node.tagName === 'script').length;
    assert.equal(scripts > 0, Object.keys(details).some(type => SCRIPT_TRAP_TYPES.includes(type)));
    if (page.url === '/') {
      assert(details['robots-txt-traps'] && details['sitemap-traps']);
      assert.match(html, /<link rel="sitemap" type="application\/xml" href="\/sitemap-index\.xml">/);
      continue;
    }
    const pageUrl = new URL(page.url, BASE);
    const baseHref = attr(walk(doc, node => node.tagName === 'base')[0] ?? { attrs: [] }, 'href');
    const documentBase = baseHref ? new URL(baseHref, pageUrl) : pageUrl;
    const anchors = walk(doc, node => node.tagName === 'a').map(node => attr(node, 'href')).filter(Boolean);
    const resolve = href => { const url = new URL(href, documentBase); return url.origin === new URL(BASE).origin ? url.pathname : url.href; };
    for (const type of ['relative-climb-links', 'backslash-urls', 'whitespace-hrefs', 'protocol-relative-links', 'dot-segment-urls']) {
      for (const link of details[type].links) {
        assert(anchors.includes(link.href), `${type} ${JSON.stringify(link.href)}`);
        assert.equal(resolve(link.href), link.resolvesTo, `${type} ${JSON.stringify(link.href)}`);
      }
    }
    for (const link of details['entity-encoded-hrefs'].links) {
      assert(html.includes(`href="${link.raw}"`), link.raw);
      assert.equal(new URL(link.raw.replaceAll('&#47;', '/').replaceAll('&#x2F;', '/').replaceAll('&amp;', '&'), pageUrl).pathname, link.resolvesTo);
    }
    assert.equal(resolve('contact/'), '/intl/contact/');
    assert.deepEqual(walk(doc, node => node.tagName === 'base').map(node => attr(node, 'href')), details['base-href-traps'].bases);
    assert.match(html, /<template shadowrootmode="open"><nav><a href="[^"]+">Related record<\/a><\/nav><slot><\/slot><\/template>/);
    assert.match(html, /document\.write\('<div class="legacy-menu">/);
    assert.match(html, /<!--\[if lt IE 9\]><p><a href="\/old-site\/ie-\d+\.htm">/);
    assert.match(html, /<!--\[if !IE\]><!--><p class="modern-only">/);
    assert.match(html, /<a xlink:href="/);
    assert(walk(doc, node => node.tagName === 'a' && attr(node, 'data-url') && attr(node, 'href') === undefined).length === 1);
    assert(html.startsWith('﻿'));
    const canonicals = walk(doc, node => node.tagName === 'link' && attr(node, 'rel') === 'canonical').map(node => attr(node, 'href'));
    // misleading-canonical, canonical-chain, canonical-to-404 and canonical-cross-host each rewrite the first tag; multiple-canonical adds one.
    assert.equal(canonicals.length, 2);
    assert.equal(canonicals[1], `${BASE}${details['multiple-canonical'].canonicals[1]}`);
    const robots = walk(doc, node => node.tagName === 'meta' && ['robots', 'googlebot'].includes(attr(node, 'name'))).map(node => attr(node, 'content'));
    assert.deepEqual(robots.sort(), ['noindex, nofollow', ...details['meta-robots-variants'].metas.map(meta => meta.content)].sort());
    assert.equal(walk(doc, node => node.tagName === 'meta' && attr(node, 'charset')).length, 0);
    assert.equal(walk(doc, node => node.tagName === 'div' && attr(node, 'role') === 'dialog').length, 2);
    assert(walk(doc, node => node.tagName === 'a' && attr(node, 'rel') === 'nofollow').length >= 1);
    // 2026-11-02 traps: extra titles, contradicting JSON-LD, right-to-left text and address-changing infinite scroll.
    const titles = walk(doc, node => node.tagName === 'title').map(node => node.childNodes.map(child => child.value).join(''));
    assert.deepEqual(titles.slice(1), details['title-anomalies'].extraTitles, `${page.url} titles`);
    const ldBlocks = walk(doc, node => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json').map(node => JSON.parse(node.childNodes[0].value));
    const declared = ldBlocks.find(block => block.name === details['structured-data-conflict'].declared.name);
    assert(declared, `${page.url} JSON-LD`);
    assert.notEqual(declared.name, page.fields.title);
    if (details['structured-data-conflict'].declared.datePublished) assert.equal(declared.datePublished, details['structured-data-conflict'].declared.datePublished);
    const rtl = walk(doc, node => node.tagName === 'p' && attr(node, 'dir') === 'rtl');
    assert.equal(rtl.length, 1);
    assert.equal(attr(rtl[0], 'lang'), details['rtl-content-block'].language);
    assert(html.includes(details['rtl-content-block'].text));
    if (page.kind === 'listing') assert.equal(attr(walk(doc, node => attr(node, 'class') === 'scroll-sentinel')[0], 'data-pages'), details['pushstate-infinite-scroll'].pushStateUrls.join(' '));
    else assert.equal(details['pushstate-infinite-scroll'], undefined);
  }
});

test('composition: each trap alone and every trap paired with the next one stays deterministic', () => {
  for (const [index, type] of CRAWLER_TRAP_TYPES.entries()) {
    for (const types of [[type], [type, CRAWLER_TRAP_TYPES[(index + 1) % CRAWLER_TRAP_TYPES.length]], [type, MARKUP_NOISE_TYPES[index % MARKUP_NOISE_TYPES.length]].filter(item => item !== 'delayed-content')]) {
      const config = configFor(2, 'html', types);
      const first = observe(config);
      const second = observe(config);
      assert.deepEqual(first.observed, second.observed);
      for (const [i, page] of first.observed.entries()) {
        assert.equal(applyHtmlNoise(renderPage(first.model.site, page), page, first.model.site), applyHtmlNoise(renderPage(second.model.site, second.observed[i]), second.observed[i], second.model.site));
      }
      validateAnswerKey(first.model, { ...first.model, pages: first.observed, transport: noTransport(first.model, config) }, config);
    }
  }
});

test('the answer key rejects altered or invented trap details', () => {
  const config = configFor(2);
  const { model, observed } = observe(config);
  const transport = noTransport(model, config);
  for (const type of ['calendar-trap', 'faceted-navigation', 'robots-txt-traps', 'canonical-chain']) {
    const tampered = structuredClone(observed);
    const event = tampered.flatMap(page => page.noiseEvents).find(item => item.type === type);
    event.details = { ...event.details, injected: true };
    assert.throws(() => validateAnswerKey(model, { ...model, pages: tampered, transport }, config), new RegExp(`unverifiable ${type} details`));
  }
  const markupConfig = validateConfig({ ...structuredClone(config), noise: { level: 'custom', probability: 1, severity: 2, maxPerPage: 1, types: ['boilerplate'] } });
  const markupModel = createModel(markupConfig);
  const markup = markupModel.pages.map(page => applyDataNoise(page, markupModel.site));
  markup[0].noiseEvents[0].details = { invented: true };
  assert.throws(() => validateAnswerKey(markupModel, { ...markupModel, pages: markup, transport }, markupConfig), /unexpected defect details/);
});

test('session path parameters are stripped only in their documented forms', () => {
  assert.equal(stripSessionPath('/books/x/;jsessionid=ABC123'), '/books/x/');
  assert.equal(stripSessionPath('/books/x;JSESSIONID=abc/'), '/books/x/');
  assert.equal(stripSessionPath('/(S(abc012))/books/x/'), '/books/x/');
  assert.equal(stripSessionPath('/books/(S(abc))/x/'), '/books/(S(abc))/x/');
  assert.equal(stripSessionPath('/(S(../private))/x/'), '/(S(../private))/x/');
});

async function crawlBounded(origin, entry, limit, within) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const path = queue.shift();
    const response = await fetch(origin + path, { redirect: 'manual' });
    assert.equal(response.status, 200, path);
    const body = await response.text();
    for (const match of body.matchAll(/href="([^"]+)"/g)) {
      const target = new URL(match[1].replaceAll('&amp;', '&'), origin + path);
      const next = target.pathname + target.search;
      if (!within(next) || seen.has(next)) continue;
      seen.add(next);
      assert(seen.size <= limit, `trap exceeded its declared bound at ${next}`);
      queue.push(next);
    }
  }
  return seen.size;
}

test('the preview server and public resources behave exactly as the answer key states', { timeout: 300000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-crawler-traps-'));
  const previews = [];
  try {
    const config = configFor(3);
    await generate(config, join(root, 'traps'));
    await generate({ ...config, noise: { level: 'clean' } }, join(root, 'clean'));
    const read = name => readFile(join(root, 'traps', 'private', name), 'utf8').then(JSON.parse);
    const truth = await read('answer-key.json');
    const manifest = await read('manifest.json');
    const preview = await serve(join(root, 'traps'), { port: 0 });
    previews.push(preview);
    const origin = preview.url;
    const get = (path, init) => fetch(origin + path, { redirect: 'manual', ...init });
    const status = async path => (await get(path)).status;
    const events = truth.pages.flatMap(page => page.noiseEvents.map(event => ({ page, event })));
    assert.deepEqual(new Set(events.map(item => item.event.type)), new Set(CRAWLER_TRAP_TYPES));
    const htmlPages = Object.keys(manifest.artifactFiles).filter(file => file.endsWith('index.html'));
    assert.equal(htmlPages.length, truth.pages.length, 'extra resources must not look like pages');
    const first = type => events.find(item => item.event.type === type && item.page.kind === 'detail') ?? events.find(item => item.event.type === type);
    const original = async url => (await get(url)).text();

    for (const type of ['session-id-urls', 'duplicate-url-aliases', 'tracking-params', 'print-duplicates', 'mobile-duplicates', 'sort-order-params', 'default-document-aliases', 'mixed-case-extensions']) {
      const { page, event } = first(type);
      const body = await original(page.url);
      for (const alias of event.details.aliases) {
        const response = await get(alias.href);
        assert.equal(response.status, alias.status, `${type} ${alias.href}`);
        if (alias.status === 200) assert.equal(await response.text(), body, alias.href);
        else assert.equal(response.headers.get('location'), alias.resolvesTo);
      }
    }
    for (const type of ['faceted-navigation', 'pagination-query-variants']) {
      const { page, event } = first(type);
      const body = await original(page.url);
      for (const href of event.details.variants.map(item => item.href ?? item)) assert.equal(await (await get(href)).text(), body, href);
    }
    const long = first('long-url-links').event.details.links[0];
    assert(long.length > 2000);
    assert.equal(await status(long.href), 200);

    const bounded = [
      ['calendar-trap', next => next.startsWith('/cgi-bin/calendar.pl?month=')],
      ['day-calendar-trap', next => next.startsWith('/cgi-bin/calendar.pl?date=')],
      ['path-info-trap', next => next.startsWith('/cgi-bin/browse.pl/')],
      ['date-archive-trap', next => next.startsWith('/cgi-bin/archive.pl/')],
      ['load-more-pagination', next => next.startsWith('/cgi-bin/list.pl')],
      ['login-wall-links', next => next.startsWith('/login?')],
    ];
    for (const [type, within] of bounded) {
      const d = first(type).event.details;
      assert.equal(await crawlBounded(origin, d.entry ?? d.href, d.reachableUrls, within), d.reachableUrls, type);
    }
    const search = first('search-tag-cloud').event.details;
    let searched = 0;
    for (const href of search.links) searched += await crawlBounded(origin, href, search.pagesPerQuery, next => next.startsWith('/cgi-bin/search.pl'));
    assert.equal(searched, search.reachableUrls);
    for (const path of ['/cgi-bin/calendar.pl?month=1995-12', '/cgi-bin/calendar.pl?month=2016-01', '/cgi-bin/calendar.pl?date=2006-01-01', '/cgi-bin/calendar.pl?date=2004-02-30',
      `/cgi-bin/browse.pl/archive/${'media/'.repeat(8)}`, '/cgi-bin/browse.pl/archive/../../private/', '/cgi-bin/archive.pl/2005/', '/cgi-bin/archive.pl/2003/02/30/',
      '/cgi-bin/list.pl?offset=15', '/cgi-bin/search.pl?q=%3Cscript%3E', '/login?next=//evil.example/']) assert.equal(await status(path), 404, path);
    assert.match(await (await get('/cgi-bin/list.pl?offset=210')).text(), /<ul class="results-page"><\/ul>/);

    for (const type of ['meta-refresh-link', 'meta-refresh-delayed']) {
      const d = first(type).event.details;
      assert.match(await (await get(d.href)).text(), new RegExp(`<meta http-equiv="refresh" content="${d.refreshDelaySeconds}; URL=${d.refreshTo}">`));
    }
    const jump = first('js-redirect-page').event.details;
    assert.match(await (await get(jump.href)).text(), new RegExp(`window\\.location\\.replace\\("${jump.redirectTo}"\\)`));
    const nojs = first('noscript-meta-refresh').event.details;
    assert.match(await (await get(nojs.href)).text(), new RegExp(`<noscript><meta http-equiv="refresh" content="0; URL=${nojs.refreshTo}"></noscript>`));
    for (const bad of ['//evil.example/', 'https://evil.example/', '/private/answer-key.json', '/missing/']) {
      for (const path of [`/cgi-bin/redirect.pl?url=${encodeURIComponent(bad)}`, `/cgi-bin/jump.pl?to=${encodeURIComponent(bad)}`, `/cgi-bin/nojs.pl?url=${encodeURIComponent(bad)}`, `/cgi-bin/canonical.pl?hop=1&url=${encodeURIComponent(bad)}`]) assert.equal(await status(path), 404, path);
    }
    const chain = first('canonical-chain').event.details;
    assert.match(await (await get(chain.chain[0])).text(), new RegExp(`<link rel="canonical" href="${escapeHtml(BASE + chain.chain[1]).replace(/[?]/g, '\\?')}">`));
    assert.match(await (await get(chain.chain[1])).text(), new RegExp(`<link rel="canonical" href="${BASE}${chain.chain[2]}">`));

    const deadLinks = [
      ...events.filter(item => item.event.type === 'comment-only-link').flatMap(item => item.event.details.links.map(link => [link.href, link.expectedStatus])),
      ...[first('ie-conditional-links').event.details.hiddenInConditionalComment[0]].map(link => [link.href, link.expectedStatus]),
      [first('canonical-to-404').event.details.declaredCanonical, 404],
      ...first('hreflang-alternates').event.details.alternates.map(item => [item.href, item.status]),
      ...first('css-links').event.details.imports.concat(first('css-links').event.details.urls).map(item => [item.href, item.expectedStatus]),
      ...first('object-embed-fallback').event.details.plugins.map(item => [item.src, item.expectedStatus]),
      ...first('cookie-consent-wall').event.details.links.map(item => [item.href, item.expectedStatus]),
      ...first('base-href-traps').event.details.relativeLinks.map(item => [item.resolvesTo, item.status]),
      ...first('rel-link-hints').event.details.hints.map(item => [item.href, item.status]),
      ...first('space-unicode-urls').event.details.resources.map(item => [encodeURI(item.path), item.expectedStatus]),
    ];
    for (const [path, expected] of deadLinks) assert.equal(await status(path), expected, path);
    // fetch() normalises dot segments and backslashes; a crawler that sends the literal path sees these statuses.
    const rawStatus = path => new Promise((accept, reject) => { const url = new URL(origin); request({ host: url.hostname, port: url.port, path }, response => { response.resume(); accept(response.statusCode); }).on('error', reject).end(); });
    for (const item of first('dot-segment-urls').event.details.links.filter(link => link.rawRequestStatus)) assert.equal(await rawStatus(item.href), item.rawRequestStatus, item.href);
    for (const item of first('backslash-urls').event.details.links) assert.equal(await rawStatus(item.href.replaceAll('\\', '%5C')), item.rawRequestStatus, item.href);

    const frameset = await original('/frames/frameset.html');
    assert.match(frameset, /<frameset cols="200,\*"><frame name="nav" src="\/frames\/nav\.html"[^>]*><frame name="main" src="\/"><noframes>/);
    for (const href of first('frameset-navigation').event.details.navTargets) assert.match(await original('/frames/nav.html'), new RegExp(`href="${href}" target="main"`));
    const feed = await original('/feeds/news.rss');
    for (const page of truth.pages.filter(item => item.kind === 'detail').slice(0, 5)) assert(feed.includes(`<link>${BASE}${page.url}</link>`));
    const copy = first('duplicate-section-content');
    assert.equal(await original(copy.event.details.copy.path), await original(copy.page.url));
    const dated = first('near-duplicate-dated');
    const datedBody = await original(dated.event.details.copy.path);
    assert(datedBody.includes(`Edition of ${dated.event.details.copy.date}</p></body>`));
    assert.equal(datedBody.replace(`<p class="edition-date">Edition of ${dated.event.details.copy.date}</p>`, ''), await original(dated.page.url));

    const press = first('windows-1252-documents').event.details.resources;
    const pressBytes = await Promise.all(press.map(async item => Buffer.from(await (await get(item.path)).arrayBuffer())));
    assert.equal((await get(press[0].path)).headers.get('content-type'), 'text/html');
    // This Node build lacks full ICU, so decode the windows-1252 C1 range explicitly.
    const cp1252 = bytes => [...bytes].map(byte => ({ 0x92: '\u2019', 0x93: '\u201c', 0x94: '\u201d', 0x97: '\u2014' })[byte] ?? String.fromCharCode(byte)).join('');
    assert(cp1252(pressBytes[0]).includes(press[0].expectedText));
    assert(/charset=windows-1252/.test(cp1252(pressBytes[0])));
    assert(new TextDecoder('utf-8').decode(pressBytes[1]).includes('�'));
    const utf16 = Buffer.from(await (await get(first('utf16-document').event.details.resources[0].path)).arrayBuffer());
    assert.deepEqual([...utf16.subarray(0, 2)], [0xff, 0xfe]);
    assert(new TextDecoder('utf-16le').decode(utf16.subarray(2)).includes('reading room hours changed'));
    const charsetPage = first('charset-conflict');
    const charsetResponse = await get(charsetPage.page.url);
    assert.equal(charsetResponse.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.deepEqual([...Buffer.from(await charsetResponse.arrayBuffer()).subarray(0, 3)], [0xef, 0xbb, 0xbf]);

    const robotsTrap = first('robots-txt-traps').event.details;
    const robotsText = await original('/robots.txt');
    assert.equal(robotsText, robotsTrap.content);
    const robots = robotsParser(`${BASE}/robots.txt`, robotsText);
    for (const item of robotsTrap.expectations) assert.equal(robots.isAllowed(`${BASE}${item.path}`, item.userAgent ?? 'SmartciteBot'), item.allowed, JSON.stringify(item));
    assert.equal(robots.getCrawlDelay('SmartciteBot'), robotsTrap.crawlDelaySeconds);
    const sitemap = first('sitemap-traps').event.details;
    for (const resource of sitemap.resources) assert.equal(await status(resource.path), 200, resource.path);
    assert.match(gunzipSync(Buffer.from(await (await get('/sitemap-legacy.xml.gz')).arrayBuffer())).toString(), new RegExp(`<loc>${BASE}/</loc>`));
    for (const entry of sitemap.entries.filter(item => item.expectedStatus)) assert.equal(await status(new URL(entry.loc).pathname), entry.expectedStatus, entry.loc);
    for (const resource of [...sitemap.resources.map(item => item.path), '/frames/frameset.html', '/feeds/news.rss', press[0].path]) assert(Object.hasOwn(manifest.artifactFiles, resource.slice(1)), resource);

    for (const path of ['/private;jsessionid=1/answer-key.json', '/(S(abc))/private/answer-key.json', '/PRIVATE/answer-key.json', '/m/private/answer-key.json', '/private/default.asp']) assert.equal(await status(path), 404, path);

    const rebased = await serve(join(root, 'traps'), { port: 0, rebaseOrigin: true });
    previews.push(rebased);
    const host = new URL(rebased.url).host;
    const prPage = first('protocol-relative-links');
    assert((await (await fetch(rebased.url + prPage.page.url)).text()).includes(`href="//${host}${prPage.event.details.links[0].resolvesTo}"`));
    const rebasedSitemap = await (await fetch(`${rebased.url}/sitemap-pages.xml`)).text();
    assert(rebasedSitemap.includes(`<loc>${rebased.url}/</loc>`) && rebasedSitemap.includes('<loc>http://www.wrong-host.siteforge.invalid/</loc>'));
    assert((await (await fetch(`${rebased.url}/robots.txt`)).text()).includes('Sitemap: http://www.wrong-host.siteforge.invalid/sitemap.xml'));

    const plain = await serve(join(root, 'clean'), { port: 0 });
    previews.push(plain);
    const sample = first('session-id-urls');
    for (const path of [sample.event.details.aliases[0].href, '/cgi-bin/calendar.pl?month=2004-03', '/cgi-bin/browse.pl/archive/', '/login?next=%2F', `/m${sample.page.url}`, `${sample.page.url}default.asp`, sample.page.url.toUpperCase(), '/frames/frameset.html', '/sitemap-index.xml']) {
      assert.equal((await fetch(plain.url + path, { redirect: 'manual' })).status, 404, path);
    }
  } finally {
    for (const preview of previews) await preview.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the legacy-server profile plans and serves every documented response condition', { timeout: 120000 }, async () => {
  const pages = Array.from({ length: 20 }, (_, index) => ({ kind: 'detail', url: `/records/${index}/` }));
  const plan = buildTransportPlan(pages, { profile: 'legacy-server', seed: 5 });
  assert.deepEqual(plan.rules.map(rule => rule.type), LEGACY_SERVER_TYPES);
  assert.deepEqual(validateTransportPlan(plan), plan);
  for (const [type, mutate] of [['intermittent-503', rule => { rule.failCount = 0; }], ['redirect-external', rule => { rule.location = '//evil.example/'; }], ['http-500', rule => { rule.expected.availability = 'available'; }], ['slow-drip', rule => { rule.chunkDelayMs = 5000; }]]) {
    const broken = structuredClone(plan);
    mutate(broken.rules.find(rule => rule.type === type));
    assert.throws(() => validateTransportPlan(broken), type);
  }
  assert.throws(() => validateTransportPlan({ ...plan, profile: 'mixed' }));

  const root = await mkdtemp(join(tmpdir(), 'siteforge-legacy-server-'));
  let preview;
  try {
    const config = validateConfig({ seed: 77, site: { id: 'legacy-server', pageCount: 40, baseUrl: BASE }, transport: { profile: 'legacy-server' }, noise: { level: 'custom', probability: 1, severity: 2, maxPerPage: 1, types: ['duplicate-url-aliases'] } });
    await generate(config, join(root, 'site'));
    const rules = JSON.parse(await readFile(join(root, 'site', 'private', 'transport.json'), 'utf8')).rules;
    assert.deepEqual(rules.map(rule => rule.type), LEGACY_SERVER_TYPES);
    preview = await serve(join(root, 'site'), { port: 0 });
    const get = (path, init) => fetch(preview.url + path, { redirect: 'manual', ...init });
    const rule = type => rules.find(item => item.type === type);
    const file = path => readFile(join(root, 'site', 'public', path, 'index.html'));

    const chain = rule('redirect-status-chain');
    let location = chain.path;
    const statuses = [];
    for (let hop = 0; hop < 5; hop++) { const response = await get(location); statuses.push(response.status); location = response.headers.get('location'); }
    assert.deepEqual(statuses, [301, 302, 303, 307, 308]);
    assert.equal(location, '/');
    const caseRule = rule('redirect-case-variant');
    const caseResponse = await get(caseRule.path);
    assert.equal(caseResponse.status, 301);
    assert.equal(caseResponse.headers.get('location'), caseRule.path.toUpperCase());
    assert.equal((await get(caseRule.path.toUpperCase())).status, 404, 'case fallback must not rescue a planned case redirect');
    assert.equal((await get(rule('redirect-external').path)).headers.get('location'), `http://moved.siteforge.invalid${rule('redirect-external').path}`);
    const flaky = rule('intermittent-503');
    const flakyStatuses = [];
    for (let attempt = 0; attempt < 3; attempt++) flakyStatuses.push((await get(flaky.path)).status);
    assert.deepEqual(flakyStatuses, [503, 503, 200]);
    assert.equal((await get(rule('http-503-retry-after').path)).headers.get('retry-after'), '120');
    assert.equal((await get(rule('http-500').path)).status, 500);
    const drip = rule('slow-drip');
    const started = performance.now();
    assert.deepEqual(Buffer.from(await (await get(drip.path)).arrayBuffer()), await file(drip.path));
    assert(performance.now() - started >= drip.chunkDelayMs * (drip.chunkCount - 1) - 20);
    await assert.rejects(async () => (await get(rule('truncated-body').path)).arrayBuffer());
    assert.equal((await get(rule('missing-content-type').path)).headers.get('content-type'), null);
    await assert.rejects(async () => (await get(rule('gzip-mismatch').path)).text());
    assert.equal((await get(rule('x-robots-tag').path)).headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await get(rule('link-header-canonical').path)).headers.get('link'), '</>; rel="canonical"');
    const cookie = rule('cookie-required');
    const gate = await get(cookie.path);
    assert.equal(gate.status, 302);
    assert.equal(gate.headers.get('location'), cookie.path);
    const jar = gate.headers.get('set-cookie').split(';')[0];
    assert.equal((await get(cookie.path, { headers: { cookie: jar } })).status, 200);
    const soft = await get(rule('soft-404-navigation').path);
    const softBody = await soft.text();
    assert.equal(soft.status, 200);
    assert.match(softBody, /<h1>Page not found<\/h1>/);
    assert.match(softBody, /<nav class="site-nav"/);
  } finally {
    await preview?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy-server answers by user agent: bot pre-rendering and firewall blocking', async () => {
  const { generate } = await import('../src/generator.mjs');
  const { serve } = await import('../src/server.mjs');
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const parent = await mkdtemp(join(tmpdir(), 'siteforge-agents-'));
  const root = join(parent, 'site');
  try {
    await generate({ version: 1, seed: 44, site: { id: 'agents', framework: 'react', rendering: 'client', pageCount: 40, baseUrl: 'http://agents.siteforge.test' }, transport: { profile: 'legacy-server' }, noise: { level: 'clean' } }, root);
    const plan = JSON.parse(await readFile(join(root, 'private', 'transport.json'), 'utf8'));
    const answer = JSON.parse(await readFile(join(root, 'private', 'answer-key.json'), 'utf8'));
    const prerender = plan.rules.find(rule => rule.type === 'bot-prerender');
    const blocked = plan.rules.find(rule => rule.type === 'user-agent-block');
    assert(prerender && blocked, 'both user-agent rules are planned');
    assert(answer.transport.rules.some(rule => rule.type === 'bot-prerender'), 'answer key records the rule');
    const preview = await serve(root, { port: 0 });
    try {
      const as = (path, agent) => fetch(preview.url + path, { headers: { 'user-agent': agent } });
      const browser = await (await as(prerender.path, 'Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36')).text();
      const bot = await as(prerender.path, 'SmartciteBot/1.0 (+https://crawler.example)');
      const botHtml = await bot.text();
      assert.match(browser, /<site-app/);
      assert.equal(bot.headers.get('x-prerender'), '1');
      assert.doesNotMatch(botHtml, /<site-app/);
      const record = answer.pages.find(page => page.url === prerender.path);
      assert.match(botHtml, new RegExp(`<h1>${record.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`));
      assert.equal((await as(blocked.path, 'curl/8.7.1')).status, 403);
      assert.equal((await as(blocked.path, 'python-requests/2.32')).status, 403);
      assert.equal((await as(blocked.path, 'Mozilla/5.0 Firefox/131.0')).status, 200);
      assert.equal((await as(blocked.path, 'SmartciteBot/1.0')).status, 200);
    } finally { await preview.close(); }
  } finally { await rm(parent, { recursive: true, force: true }); }
});
