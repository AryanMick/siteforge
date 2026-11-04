import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as parse5 from 'parse5';
import { generate } from '../src/site/generator.mjs';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { renderPage } from '../src/pages/renderers.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.childNodes ?? []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function childWithClass(node, className) {
  return node.childNodes?.find(child => child.attrs?.some(attribute => attribute.name === 'class'
    && attribute.value.split(' ').includes(className)));
}

function attribute(node, name) {
  return node.attrs?.find(item => item.name === name)?.value;
}

function nodeText(node) {
  return node.value ?? (node.childNodes ?? []).map(nodeText).join('');
}

function collectNodes(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.childNodes ?? []) collectNodes(child, predicate, found);
  return found;
}

test('Beaver Builder is WordPress-only and resolves in random site plans', () => {
  const explicit = sitePlan({ name: 'Beaver source', cmsProfile: 'wordpress', builderProfile: 'beaver-builder' }, 0);
  assert.equal(explicit.config.site.builderProfile, 'beaver-builder');
  assert.equal(explicit.summary.builderProfile, 'beaver-builder');
  assert.equal(validateConfig(explicit.config).site.builderProfile, 'beaver-builder');
  assert.throws(() => validateConfig({ version: 1, site: { id: 'invalid-cms', cmsProfile: 'drupal', builderProfile: 'beaver-builder' } }), /require the WordPress/);
  assert.throws(() => sitePlan({ name: 'Invalid pair', cmsProfile: 'none', builderProfile: 'beaver-builder' }, 0), /Select WordPress/);
  const choices = new Set(Array.from({ length: 128 }, (_, seed) => sitePlan({
    name: 'Random builder', cmsProfile: 'wordpress', builderProfile: 'random', seed,
  }, 0).summary.builderProfile));
  assert.deepEqual([...choices].sort(), ['beaver-builder', 'divi', 'elementor', 'gutenberg', 'none', 'wpbakery']);
});

test('Beaver Builder renders paired nodes through an HTML module', () => {
  const model = createModel(validateConfig({ version: 1, seed: 31,
    site: { id: 'beaver-source', pageCount: 7, cmsProfile: 'wordpress', builderProfile: 'beaver-builder' },
    contentTypes: [{ name: 'book', label: 'Books', fields: [
      { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
    ] }], noise: { level: 'clean' },
  }));
  const record = model.pages.find(page => page.kind === 'detail');
  assert(record);
  const html = renderPage(model.site, record);
  const main = findNode(parse5.parse(html), node => node.tagName === 'main');
  assert(main);
  assert.equal(main.parentNode.tagName, 'body');
  const article = childWithClass(main, 'type-book');
  const entry = childWithClass(article, 'entry-content');
  const builder = childWithClass(entry, 'fl-builder-content');
  const row = childWithClass(builder, 'fl-row');
  const rowWrap = childWithClass(row, 'fl-row-content-wrap');
  const rowContent = childWithClass(rowWrap, 'fl-row-content');
  const group = childWithClass(rowContent, 'fl-col-group');
  const column = childWithClass(group, 'fl-col');
  const columnContent = childWithClass(column, 'fl-col-content');
  const module = childWithClass(columnContent, 'fl-module-html');
  const moduleContent = childWithClass(module, 'fl-module-content');
  const rawHtml = childWithClass(moduleContent, 'fl-html');
  assert(rawHtml);
  for (const node of [row, group, column, module]) {
    const token = attribute(node, 'data-node');
    assert.match(token, /^[a-f0-9]{8}$/);
    assert(attribute(node, 'class').split(' ').includes(`fl-node-${token}`));
  }
  assert(nodeText(rawHtml).includes(record.fields.author));
  assert.doesNotMatch(html, /data-post-id|fl-builder-content-\d+/);
});

test('clean CMS source closes every generated div explicitly', () => {
  const profiles = [
    ['none', 'none'], ['wordpress', 'none'], ['wordpress', 'gutenberg'],
    ['wordpress', 'elementor'], ['wordpress', 'beaver-builder'], ['drupal', 'none'],
  ];
  for (const [cmsProfile, builderProfile] of profiles) {
    const model = createModel(validateConfig({ version: 1, seed: 9,
      site: { id: 'closed-cms', pageCount: 8, cmsProfile, builderProfile },
      noise: { level: 'clean' },
    }));
    for (const page of model.pages) {
      const document = parse5.parse(renderPage(model.site, page), { sourceCodeLocationInfo: true });
      const divs = collectNodes(document, node => node.tagName === 'div');
      assert(divs.length > 0);
      for (const div of divs) {
        assert(div.sourceCodeLocation?.endTag,
          `${cmsProfile}/${builderProfile}/${page.pageId}: unclosed ${attribute(div, 'class') ?? 'div'}`);
      }
    }
  }
});

test('Beaver node tokens repeat for a fixed source and change with seed and page', () => {
  const config = seed => validateConfig({ version: 1, seed,
    site: { id: 'beaver-tokens', pageCount: 8, cmsProfile: 'wordpress', builderProfile: 'beaver-builder' },
    noise: { level: 'clean' },
  });
  const first = createModel(config(31));
  const nextSeed = createModel(config(32));
  const tokens = (site, page) => collectNodes(parse5.parse(renderPage(site, page)),
    node => attribute(node, 'data-node') !== undefined).map(node => attribute(node, 'data-node'));
  assert.equal(renderPage(first.site, first.pages[0]), renderPage(first.site, first.pages[0]));
  assert.equal(tokens(first.site, first.pages[0]).length, 4);
  assert.notDeepEqual(tokens(first.site, first.pages[0]), tokens(nextSeed.site, nextSeed.pages[0]));
  assert.notDeepEqual(tokens(first.site, first.pages[0]), tokens(first.site, first.pages[1]));
});

test('CMS articles stay inside main and identify content without a false body field', () => {
  const input = { version: 1, seed: 9, site: { id: 'cms-structure', pageCount: 5 },
    contentTypes: [{ name: 'book', label: 'Books', fields: [
      { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
    ] }] };
  for (const cmsProfile of ['wordpress', 'drupal']) {
    const source = createModel(validateConfig({ ...input, site: { ...input.site, cmsProfile } }));
    const page = source.pages.find(item => item.kind === 'detail');
    assert(page);
    const html = renderPage(source.site, page);
    const main = findNode(parse5.parse(html), node => node.tagName === 'main');
    assert(main);
    assert.equal(main.parentNode.tagName, 'body');
    assert(findNode(main, node => node.tagName === 'article'));
    if (cmsProfile === 'wordpress') {
      assert.match(html, /class="book type-book status-publish hentry"/);
    } else {
      assert.doesNotMatch(html, /field--name-body|data-history-node-id/);
    }
  }
});

test('CMS and page-builder profiles render recognisable wrappers without changing page truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-cms-'));
  const answers = [];
  try {
    const profiles = [
      { cmsProfile: 'none', builderProfile: 'none', marker: /class="page-shell/ },
      { cmsProfile: 'wordpress', builderProfile: 'none', marker: /class="home type-home status-publish hentry"/ },
      { cmsProfile: 'wordpress', builderProfile: 'gutenberg', marker: /class="wp-block-group is-layout-constrained"/ },
      { cmsProfile: 'wordpress', builderProfile: 'elementor', marker: /class="elementor-widget-container"/ },
      { cmsProfile: 'wordpress', builderProfile: 'beaver-builder', marker: /class="fl-html"/ },
      { cmsProfile: 'wordpress', builderProfile: 'divi', marker: /class="et_pb_text_inner"/ },
      { cmsProfile: 'wordpress', builderProfile: 'wpbakery', marker: /class="wpb_text_column wpb_content_element"/ },
      { cmsProfile: 'drupal', builderProfile: 'none', marker: /class="node node--type-home node--view-mode-full"/ },
    ];
    for (const [index, profile] of profiles.entries()) {
      const directory = join(root, String(index));
      await generate({ version: 1, seed: 9, site: { id: 'cms-demo', domain: 'library', framework: 'html', pageCount: 8, baseUrl: 'http://cms-demo.example.test', cmsProfile: profile.cmsProfile, builderProfile: profile.builderProfile }, noise: { level: 'clean' } }, directory);
      const html = await readFile(join(directory, 'public', 'index.html'), 'utf8');
      assert.match(html, profile.marker);
      assert.equal((html.match(/<h1>/g) ?? []).length, 1);
      answers.push(JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8')).pages);
    }
    for (const answer of answers.slice(1)) assert.deepEqual(answer, answers[0]);
    assert.throws(() => validateConfig({ version: 1, site: { id: 'invalid-cms', cmsProfile: 'drupal', builderProfile: 'elementor' } }), /require the WordPress/);
    assert.throws(() => sitePlan({ name: 'Invalid pair', cmsProfile: 'drupal', builderProfile: 'gutenberg' }, 0), /Select WordPress/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CMS profiles expose detectable generator, asset and body-class fingerprints outside main', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-cms-fingerprint-'));
  try {
    const profiles = [
      { cmsProfile: 'wordpress', builderProfile: 'none', head: [/<meta name="generator" content="WordPress \d+\.\d+\.\d+">/, /id="wp-block-library-css" href="[^"]*\/wp-includes\/css\/dist\/block-library\/style\.min\.css\?ver=/, /\/wp-content\/themes\/[a-z0-9-]+\/style\.css\?ver=/, /<script src="[^"]*\/wp-includes\/js\/jquery\/jquery\.min\.js\?ver=[\d.]+" id="jquery-core-js">/, /<link rel="shortlink" href="[^"]*\?p=\d+">/], body: /wp-theme-[a-z0-9-]+/, end: /<script type="speculationrules">/ },
      { cmsProfile: 'wordpress', builderProfile: 'elementor', head: [/<meta name="generator" content="Elementor /, /id="elementor-frontend-css" href="[^"]*\/wp-content\/plugins\/elementor\//], body: /elementor-default/ },
      { cmsProfile: 'wordpress', builderProfile: 'beaver-builder', head: [/id="fl-builder-layout-bundle-css" href="[^"]*\/wp-content\/uploads\/bb-plugin\//], body: /\bfl-builder\b/ },
      { cmsProfile: 'wordpress', builderProfile: 'divi', head: [/id="divi-style-parent-css" href="[^"]*\/wp-content\/themes\/Divi\//], body: /\bet_divi_theme\b/ },
      { cmsProfile: 'wordpress', builderProfile: 'wpbakery', head: [/id="js_composer_front-css" href="[^"]*\/wp-content\/plugins\/js_composer\//], body: /\bwpb-js-composer\b/ },
      { cmsProfile: 'drupal', builderProfile: 'none', head: [/<meta name="Generator" content="Drupal 11 \(https:\/\/www\.drupal\.org\)">/, /<meta name="MobileOptimized" content="width">/, /\/sites\/default\/files\/css\/css_[\w-]+\.css\?delta=0&amp;language=en&amp;theme=\w+&amp;include=/], body: /path-frontpage/, end: /data-drupal-selector="drupal-settings-json">\{"path":\{"baseUrl":"\\\/"[^<]*"ajaxPageState"/ },
    ];
    const answers = [];
    for (const [index, profile] of profiles.entries()) {
      for (const linkMode of ['root-relative', 'relative', 'absolute']) {
        const directory = join(root, `${index}-${linkMode}`);
        await generate({ version: 1, seed: 9, site: { id: 'cms-fingerprint', domain: 'library', framework: 'html', pageCount: 8, baseUrl: 'http://cms-fingerprint.example.test', linkMode, cmsProfile: profile.cmsProfile, builderProfile: profile.builderProfile }, noise: { level: 'clean' } }, directory);
        const html = await readFile(join(directory, 'public', 'index.html'), 'utf8');
        const [headHtml, bodyHtml] = html.split('</head>');
        for (const pattern of profile.head) assert.match(headHtml, pattern, `${profile.cmsProfile}/${profile.builderProfile}/${linkMode}`);
        assert.match(/<body class="([^"]*)"/.exec(bodyHtml)[1], profile.body);
        if (profile.end) assert.match(bodyHtml.split('</main>')[1], profile.end);
        // Every referenced CMS script exists too, so view-source fingerprints never 404.
        for (const script of collectNodes(parse5.parse(html), node => node.tagName === 'script' && attribute(node, 'src'))) {
          const path = new URL(attribute(script, 'src'), 'http://cms-fingerprint.example.test/').pathname;
          await readFile(join(directory, 'public', ...path.slice(1).split('/')));
        }
        // Every referenced CMS stylesheet exists in the public website so fingerprints never become broken links.
        const document = parse5.parse(html);
        const sheets = collectNodes(document, node => node.tagName === 'link' && attribute(node, 'rel') === 'stylesheet');
        assert.equal(attribute(sheets[0], 'href').endsWith('assets/site.css'), true, 'site stylesheet stays first');
        for (const sheet of sheets) {
          const path = new URL(attribute(sheet, 'href'), 'http://cms-fingerprint.example.test/').pathname;
          await readFile(join(directory, 'public', ...path.slice(1).split('/')));
        }
        const main = findNode(document, node => node.tagName === 'main');
        assert.equal(main.parentNode.tagName, 'body');
        assert.doesNotMatch(html, /field--name-body|data-history-node-id|data-post-id/);
        if (linkMode === 'root-relative') answers.push(JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8')).pages);
      }
      const detail = (await readFile(join(root, `${index}-root-relative`, 'private', 'answer-key.json'), 'utf8'));
      const page = JSON.parse(detail).pages.find(item => item.kind === 'detail');
      const detailHtml = await readFile(join(root, `${index}-root-relative`, 'public', ...page.url.slice(1).split('/'), 'index.html'), 'utf8');
      if (profile.cmsProfile === 'wordpress') assert.match(detailHtml, new RegExp(`<body class="[^"]*single single-${page.contentType} postid-\\d+`));
      else assert.match(detailHtml, new RegExp(`<body class="[^"]*path-node page-node-type-${page.contentType}`));
    }
    for (const answer of answers.slice(1)) assert.deepEqual(answer, answers[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('no-CMS sites receive no CMS fingerprints', async () => {
  const model = createModel(validateConfig({ version: 1, seed: 9, site: { id: 'plain-source', pageCount: 8 }, noise: { level: 'clean' } }));
  for (const page of model.pages) assert.doesNotMatch(renderPage(model.site, page), /wp-content|wp-includes|name="generator"|name="Generator"|drupal|sites\/default\/files|wp-theme/i);
});
