import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { MARKUP_NOISE_TYPES, NOISE_TYPES } from '../src/config.mjs';
import { generate } from '../src/generator.mjs';
import { serve } from '../src/server.mjs';
import { normalizeSourceText } from '../src/util.mjs';

const root = await mkdtemp(join(tmpdir(), 'siteforge-locations-'));
const browser = await chromium.launch({ headless: true });
const layouts = ['definition-list', 'table', 'paragraphs'];
const frameworks = ['html', 'react', 'angular'];
const modes = ['relative', 'absolute', 'mixed'];
const profiles = [
  { cmsProfile: 'wordpress', builderProfile: 'gutenberg' },
  { cmsProfile: 'wordpress', builderProfile: 'elementor' },
  { cmsProfile: 'drupal' },
];
const edgeText = "  Editor's note: <tag> &amp; a literal marker.\r\nA second\rline\u0000 follows.  ";
const normalizedEdgeText = normalizeSourceText(edgeText);
let visited = 0;
let located = 0;
let repeatedLocated = 0;
let repeatedEdgeValues = 0;
const covered = new Set();
const repeatedLayouts = new Set();
const repeatedStates = new Set();

async function readLocation(page, location) {
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
  for (const [fi, framework] of frameworks.entries()) for (const [li, layout] of layouts.entries()) {
    const id = `locations-${framework}-${layout}`;
    const directory = join(root, id);
    const noiseTypes = NOISE_TYPES.filter(type => type !== (framework === 'html' ? 'delayed-content' : 'missing-main'));
    const config = { seed: 41 + fi * 17 + li, variation: { amount: 80 }, site: {
      id, name: "Archive's\r\nname\u0000: edition", framework, pageCount: 30,
      visualStyle: 'legacy', linkMode: modes[li],
      ...profiles[(fi + li) % profiles.length],
    }, contentPool: [edgeText], contentTypes: [{ name: 'record', label: 'Records\rvolume\uD800', fieldLayout: layout, fields: [
      { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
      { name: 'publicationDate', type: 'date' }, { name: 'body', type: 'text', optional: true, presenceProbability: 0.5 },
      { name: 'coverImage', type: 'image', optional: true, presenceProbability: 0.5 },
    ] }], noise: { level: 'custom', probability: 1, severity: 3,
      maxPerPage: noiseTypes.length, types: noiseTypes } };
    await generate(config, directory);
    const truth = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
    const server = await serve(directory, { port: 0, rebaseOrigin: true });
    const page = await browser.newPage();
    const pageErrors = [];
    const coveredInCombo = new Set();
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
      const details = truth.pages.filter(item => item.contentType === 'record');
      const presentImage = details.find(item => item.fieldStates.coverImage === 'present');
      const absentImage = details.find(item => item.fieldStates.coverImage === 'absent');
      const templateSamples = [...new Map(details.map(item => [item.template, item])).values()];
      assert.equal(templateSamples.length, 4, `${id}: detail template coverage`);
      const listings = truth.pages.filter(item => item.kind === 'listing');
      for (const listing of listings) {
        const publicHtml = await readFile(join(directory, 'public', listing.url.slice(1), 'index.html'), 'utf8');
        assert(!publicHtml.includes('repeatedItemLocations') && !publicHtml.includes('repeatedItemLocationVersion'),
          `${id}/${listing.pageId}: private locations leaked into public HTML`);
      }
      const samples = [...new Set([truth.pages.find(item => item.kind === 'home'),
        ...listings, ...templateSamples, presentImage, absentImage].filter(Boolean))];
      assert(presentImage && absentImage, `${id}: image-state coverage`);
      for (const record of samples) {
        await page.goto(server.url + record.url, { waitUntil: 'load' });
        if (framework !== 'html') await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
        for (const [name, location] of Object.entries(record.fieldLocations)) {
          if (location.state === 'absent') {
            assert.equal(location.selector, undefined, `${id}/${record.pageId}/${name}: absent selector`);
            continue;
          }
          assert.equal(location.state, 'present', `${id}/${record.pageId}/${name}: unresolved locator`);
          const result = await readLocation(page, location);
          assert.equal(result.count, 1, `${id}/${record.pageId}/${name}: selector ${location.selector}`);
          assert.equal(result.value, record.fields[name], `${id}/${record.pageId}/${name}: value`);
          located++;
        }
        if (record.repeatedItems) {
          assert.equal(record.repeatedItemLocations?.length, record.repeatedItems.length, `${id}/${record.pageId}: repeated location count`);
          const firstTitle = record.repeatedItemLocations[0].fieldLocations.title.selector;
          const table = firstTitle.includes('table.repeated-records');
          repeatedLayouts.add(table ? 'table' : 'list');
          assert.equal(await page.locator(table ? '#content table.repeated-records > tbody > tr'
            : '#content ul.repeated-records > li').count(), record.repeatedItems.length, `${id}/${record.pageId}: repeated row count`);
          for (const [index, item] of record.repeatedItems.entries()) {
            const entry = record.repeatedItemLocations[index];
            assert.deepEqual([entry.pageId, entry.url], [item.pageId, item.url], `${id}/${record.pageId}: item identity`);
            const row = entry.fieldLocations.title.selector.slice(0, -' > a'.length);
            const scalarCount = Object.keys(item.fields).filter(name => name !== 'title').length;
            assert.equal(await page.locator(`${row} > p`).count(), scalarCount, `${id}/${record.pageId}/${item.pageId}: scalar count`);
            for (const [name, location] of Object.entries(entry.fieldLocations)) {
              repeatedStates.add(location.state);
              if (location.state === 'absent') {
                assert.equal(location.selector, undefined, `${id}/${item.pageId}/${name}: absent selector`);
                assert.equal(Object.hasOwn(item.fields, name), false, `${id}/${item.pageId}/${name}: absent value`);
                continue;
              }
              assert.equal(location.state, 'present', `${id}/${item.pageId}/${name}: unresolved location`);
              const result = await readLocation(page, location);
              assert.equal(result.count, 1, `${id}/${item.pageId}/${name}: selector ${location.selector}`);
              assert.equal(result.value, item.fields[name], `${id}/${item.pageId}/${name}: value`);
              if (name === 'body') {
                assert.equal(item.fields[name], normalizedEdgeText, `${id}/${item.pageId}: boundary text`);
                repeatedEdgeValues++;
              }
              repeatedLocated++;
            }
          }
        }
        if (record.contentType === 'record') {
          const scalarCount = Object.keys(record.fields).filter(name => name !== 'title' && name !== 'coverImage').length;
          const renderedCount = await page.locator(layout === 'definition-list' ? '#content dl.field-list > dd'
            : layout === 'table' ? '#content table.field-list > tbody > tr > td'
              : '#content section.field-list > p').count();
          assert.equal(renderedCount, scalarCount, `${id}/${record.pageId}: field-list cardinality`);
          assert.equal(await page.locator('#content img[data-field="coverImage"]').count(),
            record.fieldStates.coverImage === 'present' ? 1 : 0, `${id}/${record.pageId}: image presence`);
        }
        for (const event of record.noiseEvents) {
          covered.add(event.type);
          coveredInCombo.add(event.type);
        }
        visited++;
      }
      assert.deepEqual(pageErrors, [], `${id}: browser errors`);
      // Crawler-trap types also run here (locators must survive them); exhaustive coverage is required for markup noise.
      const markupInCombo = noiseTypes.filter(type => MARKUP_NOISE_TYPES.includes(type));
      assert.deepEqual([...coveredInCombo].filter(type => MARKUP_NOISE_TYPES.includes(type)).sort(), [...markupInCombo].sort(), `${id}: actual noise coverage`);
      console.log(`${framework}/${layout}/${modes[li]}: ${samples.length} pages, locators verified; ${coveredInCombo.size} eligible noise types observed`);
    } finally {
      await page.close();
      await server.close();
    }
  }
  assert.deepEqual([...covered].filter(type => MARKUP_NOISE_TYPES.includes(type)).sort(), [...MARKUP_NOISE_TYPES].sort(), 'all markup noise types observed');
  assert.deepEqual([...repeatedLayouts].sort(), ['list', 'table'], 'both repeated listing layouts observed');
  assert.deepEqual([...repeatedStates].sort(), ['absent', 'present'], 'optional repeated fields both absent and present');
  assert(repeatedEdgeValues > 0, 'boundary text appears in repeated listings');
  console.log(`PASS: ${visited} pages, ${located} page locations, ${repeatedLocated} repeated locations, ${repeatedEdgeValues} boundary values; noise ${[...covered].sort().join(', ')}`);
} finally {
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
