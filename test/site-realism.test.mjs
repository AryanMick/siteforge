import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generator.mjs';
import { createModel } from '../src/model.mjs';
import { validateConfig } from '../src/config.mjs';
import { renderPage } from '../src/renderers.mjs';
import { serve } from '../src/server.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { DOMAINS } from '../src/presets.mjs';

const plan = (domain, extra = {}) => sitePlan({ name: 'Legacy library test set', domain, pagesPerSite: 24, seed: 48291, ...extra }, 0);

test('each site type gets its own realistic name instead of the test-set name', () => {
  const names = DOMAINS.map(domain => plan(domain).config.site.name);
  assert.equal(new Set(names).size, DOMAINS.length);
  for (const name of names) assert.doesNotMatch(name, /Legacy library test set/);
  assert.match(plan('library').config.site.name, /Library/);
  assert.match(plan('university').config.site.name, /University|College/);
  assert.equal(plan('museum').summary.name, plan('museum').config.site.name);
});

test('record titles and text are written for the site type, not shared templates', () => {
  const titles = {};
  for (const domain of DOMAINS) {
    const model = createModel(validateConfig(plan(domain).config));
    const details = model.pages.filter(page => page.kind === 'detail' && page.contentType !== 'information');
    titles[domain] = details.map(page => page.title);
    for (const page of details) {
      assert.doesNotMatch(page.title, /^(Perspectives on|A guide to|Resources for|Exploring|Planning for|Notes on) .+: .+ \d+$/, `${domain}: ${page.title}`);
      for (const value of Object.values(page.fields)) assert.doesNotMatch(String(value), /This \w+ resource covers/, `${domain}/${page.pageId}`);
    }
  }
  const all = Object.values(titles).flat();
  assert(new Set(all).size > all.length * 0.8, 'titles should rarely repeat across site types');
});

test('sector chrome and themes differ between site types', () => {
  const headers = new Set();
  for (const domain of DOMAINS) {
    const model = createModel(validateConfig({ ...plan(domain).config, site: { ...plan(domain).config.site, visualStyle: 'conventional' } }));
    const html = renderPage(model.site, model.pages[0]);
    assert.match(html, new RegExp(`<body class="[^"]*theme-${domain}`));
    const header = html.slice(html.indexOf('<div class="utility-bar'), html.indexOf('<nav'));
    headers.add(header.replaceAll(model.site.name, ''));
  }
  assert.equal(headers.size, DOMAINS.length);
});

test('CMS view-source is readable and preview responses carry CMS headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-realism-'));
  try {
    for (const cmsProfile of ['wordpress', 'drupal', 'none']) {
      const directory = join(root, cmsProfile);
      await generate(plan('municipality', { cmsProfile, noise: 'clean' }).config, directory);
      const html = await readFile(join(directory, 'public', 'index.html'), 'utf8');
      assert(html.split('\n').length > 30, `${cmsProfile}: page source should be formatted across lines`);
      const preview = await serve(directory, { port: 0, rebaseOrigin: true });
      try {
        const response = await fetch(`${preview.url}/`);
        await response.text();
        if (cmsProfile === 'drupal') assert.equal(response.headers.get('x-generator'), 'Drupal 11 (https://www.drupal.org)');
        else assert.equal(response.headers.get('x-generator'), null);
        if (cmsProfile === 'wordpress') {
          assert.match(response.headers.get('x-powered-by') ?? '', /^PHP\//);
          assert.match(html, /<meta name="generator" content="WordPress \d+\.\d+\.\d+">/);
          assert.match(html, /<ul id="primary-menu" class="menu">/);
        }
        if (cmsProfile === 'drupal') assert.match(html, /class="menu menu--level-1"/);
        if (cmsProfile === 'none') assert.doesNotMatch(html, /wp-content|drupal/i);
      } finally { await preview.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('front pages use sector layouts, illustrations and real labels instead of placeholders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-home-'));
  try {
    const images = new Set();
    for (const domain of DOMAINS) {
      const directory = join(root, domain);
      await generate({ ...plan(domain, { noise: 'clean', visualStyle: 'conventional', cmsProfile: 'wordpress' }).config }, directory);
      const html = await readFile(join(directory, 'public', 'index.html'), 'utf8');
      assert.match(html, new RegExp(`class="home-layout home-${domain} home-v-\\d"`));
      assert.match(html, /class="home-tiles"/);
      assert.doesNotMatch(html, /class="kicker">(Welcome|Record|Directory)</);
      assert.doesNotMatch(html, /alt="(Collection artwork|Geometric cover artwork from the collection)"/);
      images.add((await readFile(join(directory, 'public', 'assets', 'collection.png'))).toString('base64'));
      const style = await readFile(join(directory, 'public', 'wp-content', 'themes', html.match(/wp-content\/themes\/([a-z0-9-]+)\//)[1], 'style.css'), 'utf8');
      assert.match(style, /^\/\*\nTheme Name: /);
      assert.doesNotMatch(style, /SiteForge|fixture/i);
    }
    assert.equal(images.size, DOMAINS.length, 'each site type has its own illustration');
  } finally { await rm(root, { recursive: true, force: true }); }
});
