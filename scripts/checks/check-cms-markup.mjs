import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { generate } from '../../src/site/generator.mjs';
import { serve } from '../../src/preview/server.mjs';
import { VERSION } from '../../src/site/util.mjs';

const profiles = [
  { cmsProfile: 'none', builderProfile: 'none' },
  { cmsProfile: 'wordpress', builderProfile: 'none' },
  { cmsProfile: 'wordpress', builderProfile: 'gutenberg' },
  { cmsProfile: 'wordpress', builderProfile: 'elementor' },
  { cmsProfile: 'wordpress', builderProfile: 'beaver-builder' },
  { cmsProfile: 'wordpress', builderProfile: 'divi' },
  { cmsProfile: 'wordpress', builderProfile: 'wpbakery' },
  { cmsProfile: 'wordpress', builderProfile: 'oxygen' },
  { cmsProfile: 'wordpress', builderProfile: 'bricks' },
  { cmsProfile: 'wordpress', builderProfile: 'avada' },
  { cmsProfile: 'wordpress', builderProfile: 'siteorigin' },
  { cmsProfile: 'drupal', builderProfile: 'none' },
];
const root = await mkdtemp(join(tmpdir(), 'siteforge-cms-browser-'));
const output = resolve(process.env.SITEFORGE_CMS_OUTPUT || 'outputs/cms-browser');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'evidence.json'), JSON.stringify({ status: 'running', startedAt: new Date().toISOString(), generatorVersion: VERSION }, null, 2));
const browser = await chromium.launch({ headless: true });
let baselinePages;
let visited = 0;
let pageFields = 0;
let repeatedFields = 0;
const noiseSeen = new Set();
const optionalStates = new Set();
const repeatedStates = new Set();
const expectedNoise = ['extra-wrapper', 'class-churn', 'inline-style', 'reorder-fields',
  'missing-field', 'label-variation', 'date-format'];

async function locate(page, location) {
  return page.evaluate(({ selector, read, label }) => {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length !== 1) return { count: matches.length };
    const element = matches[0];
    if (read === 'urlPath') return { count: 1, value: new URL(element.getAttribute('src'), document.baseURI).pathname };
    if (read === 'afterLabel') {
      const prefix = `${label}: `;
      return { count: 1, value: element.textContent.startsWith(prefix)
        ? element.textContent.slice(prefix.length) : null };
    }
    if (read === 'afterStrongLabel') {
      const strong = element.firstChild;
      if (strong?.nodeType !== Node.ELEMENT_NODE || strong.tagName !== 'STRONG' || strong.textContent !== label) {
        return { count: 1, value: null };
      }
      const remaining = [...element.childNodes].slice(1).map(node => node.textContent).join('');
      return { count: 1, value: remaining.startsWith(' ') ? remaining.slice(1) : null };
    }
    return { count: 1, value: element.textContent };
  }, location);
}

try {
  for (const framework of ['html', 'react', 'angular']) for (const profile of profiles) {
    const name = `${framework}-${profile.cmsProfile}-${profile.builderProfile}`;
    const directory = join(root, name);
    await generate({ version: 1, seed: 37, variation: { amount: 80 },
      site: { id: 'cms-browser', name: 'CMS Browser Source', domain: 'library', framework,
        visualStyle: 'legacy', pageCount: 30, pageSize: 8, baseUrl: 'http://cms-browser.siteforge.test',
        ...profile },
      contentTypes: [{ name: 'book', label: 'Books', fieldLayout: 'mixed', fields: [
        { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
        { name: 'publicationDate', type: 'date' },
        { name: 'summary', type: 'text', optional: true, presenceProbability: 0.5 },
        { name: 'coverImage', type: 'image', optional: true, presenceProbability: 0.5 },
      ] }],
      noise: { level: 'custom', probability: 0.7, severity: 2, maxPerPage: 2,
        types: expectedNoise },
    }, directory);
    const answer = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
    if (baselinePages === undefined) baselinePages = answer.pages;
    else assert.deepEqual(answer.pages, baselinePages, `${name}: CMS or framework changed private page answers`);
    assert(answer.pages.every(item => !Object.hasOwn(item, 'cmsProfile') && !Object.hasOwn(item, 'builderProfile')),
      `${name}: CMS metadata leaked into page answers`);
    const details = answer.pages.filter(item => item.contentType === 'book');
    const withCover = details.find(item => item.fieldStates.coverImage === 'present');
    const withoutCover = details.find(item => item.fieldStates.coverImage === 'absent');
    const removedField = details.find(item => item.noiseEvents.some(event => event.type === 'missing-field'));
    assert(withCover && withoutCover, `${name}: optional image states`);
    assert(removedField, `${name}: missing-field noise coverage`);
    const samples = [...new Set([
      answer.pages.find(item => item.kind === 'home'),
      ...answer.pages.filter(item => item.kind === 'listing'),
      details[0], withCover, withoutCover, removedField,
    ].filter(Boolean))];
    const preview = await serve(directory, { port: 0, rebaseOrigin: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      for (const record of samples) {
        await page.goto(preview.url + record.url, { waitUntil: 'load' });
        if (framework !== 'html') await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
        assert.equal(await page.locator('main#content').count(), 1, `${name}/${record.pageId}: main count`);
        assert.equal(await page.locator('article main').count(), 0, `${name}/${record.pageId}: article ancestor of main`);
        assert.equal(await page.locator('#content > .page-heading > h1').textContent(), record.title,
          `${name}/${record.pageId}: direct heading`);
        if (profile.cmsProfile === 'wordpress') {
          assert.equal(await page.locator(`#content article.${record.contentType}.type-${record.contentType}.hentry`).count(), 1,
            `${name}/${record.pageId}: WordPress article type`);
          if (profile.builderProfile === 'gutenberg') assert.equal(await page.locator('#content .wp-block-group .wp-block-columns .wp-block-column').count(), 1);
          if (profile.builderProfile === 'elementor') {
            assert.equal(await page.locator('#content .elementor[data-elementor-id] [data-element_type="container"] [data-widget_type="html.default"] .elementor-widget-container').count(), 1);
          }
          if (profile.builderProfile === 'beaver-builder') {
            const path = '#content .entry-content > .fl-builder-content > .fl-row > .fl-row-content-wrap > .fl-row-content > .fl-col-group > .fl-col > .fl-col-content > .fl-module-html > .fl-module-content > .fl-html';
            assert.equal(await page.locator(path).count(), 1, `${name}/${record.pageId}: Beaver HTML module`);
            const nodes = await page.locator('#content .fl-row, #content .fl-col-group, #content .fl-col, #content .fl-module-html').evaluateAll(elements => elements.map(element => ({
              token: element.getAttribute('data-node'), classes: [...element.classList],
            })));
            assert.equal(nodes.length, 4);
            for (const node of nodes) {
              assert.match(node.token, /^[a-f0-9]{8}$/);
              assert(node.classes.includes(`fl-node-${node.token}`));
            }
            assert.equal(await page.locator('#content [data-post-id]').count(), 0);
          }
        }
        if (profile.cmsProfile === 'drupal') {
          // Listing pages are Drupal Views (src/render/drupal-views.mjs), not nodes.
          if (record.kind === 'listing') assert.equal(await page.locator('#content .region-content').count(), 1, `${name}/${record.pageId}: Drupal region`);
          else assert.equal(await page.locator(`#content .node.node--type-${record.contentType} .node__content`).count(), 1, `${name}/${record.pageId}: Drupal node`);
          assert.equal(await page.locator('#content [data-history-node-id], #content .field--name-body').count(), 0);
        }
        for (const [field, location] of Object.entries(record.fieldLocations)) {
          if (location.state === 'absent') {
            assert.equal(location.selector, undefined, `${name}/${record.pageId}/${field}: absent selector`);
            continue;
          }
          const found = await locate(page, location);
          assert.deepEqual(found, { count: 1, value: record.fields[field] },
            `${name}/${record.pageId}/${field}: ${location.selector}`);
          pageFields++;
        }
        if (record.contentType === 'book') optionalStates.add(record.fieldStates.coverImage);
        for (const event of record.noiseEvents) noiseSeen.add(event.type);
        if (record.repeatedItems) {
          assert.equal(record.repeatedItemLocations.length, record.repeatedItems.length);
          for (const [index, item] of record.repeatedItems.entries()) {
            const locations = record.repeatedItemLocations[index];
            assert.deepEqual([locations.pageId, locations.url], [item.pageId, item.url]);
            for (const [field, location] of Object.entries(locations.fieldLocations)) {
              repeatedStates.add(location.state);
              if (location.state === 'absent') {
                assert.equal(location.selector, undefined, `${name}/${item.pageId}/${field}: absent selector`);
                assert.equal(Object.hasOwn(item.fields, field), false);
                continue;
              }
              const found = await locate(page, location);
              assert.deepEqual(found, { count: 1, value: item.fields[field] },
                `${name}/${item.pageId}/${field}: ${location.selector}`);
              repeatedFields++;
            }
          }
        }
        visited++;
      }
      if (framework === 'html' && profile.builderProfile === 'elementor') {
        await page.goto(preview.url + withCover.url, { waitUntil: 'load' });
        await page.screenshot({ path: join(output, 'elementor-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: join(output, 'elementor-mobile.png'), fullPage: true });
      }
      if (framework === 'html' && profile.builderProfile === 'beaver-builder') {
        await page.goto(preview.url + withCover.url, { waitUntil: 'load' });
        await page.screenshot({ path: join(output, 'beaver-builder-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: join(output, 'beaver-builder-mobile.png'), fullPage: true });
      }
      assert.deepEqual(errors, [], `${name}: browser errors`);
      console.log(`${name}: ${samples.length} pages checked`);
    } finally {
      await page.close();
      await preview.close();
    }
  }
  assert.deepEqual([...optionalStates].sort(), ['absent', 'present']);
  assert.deepEqual([...repeatedStates].sort(), ['absent', 'present']);
  assert.deepEqual([...noiseSeen].sort(), [...expectedNoise].sort(), 'Configured noise coverage changed');
  await writeFile(join(output, 'evidence.json'), JSON.stringify({
    status: 'passed', completedAt: new Date().toISOString(), generatorVersion: VERSION, profiles: 18,
    visited, pageFields, repeatedFields, noiseSeen: [...noiseSeen].sort(),
    optionalStates: [...optionalStates].sort(), repeatedStates: [...repeatedStates].sort(),
    limits: 'Bounded representative CMS markup checks, not installed CMS, full version fidelity or scale acceptance.',
  }, null, 2));
  console.log(`PASS: ${profiles.length * 3} profile/framework combinations, ${visited} pages, ${pageFields} page fields, ${repeatedFields} repeated fields; noise observed: ${[...noiseSeen].sort().join(', ')}`);
} catch (error) {
  await writeFile(join(output, 'evidence.json'), JSON.stringify({ status: 'failed', generatorVersion: VERSION,
    failedAt: new Date().toISOString(), error: error.message, visited, pageFields, repeatedFields }, null, 2));
  throw error;
} finally {
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
