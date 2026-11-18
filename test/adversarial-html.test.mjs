import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'parse5';
import { validateConfig, NOISE_TYPES, MARKUP_NOISE_TYPES } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { applyDataNoise, applyHtmlNoise, DATE_FORMAT_POOL, FIELD_LABEL_POOLS, dateFormatVariant, fieldLabelVariant } from '../src/noise/noise.mjs';
import { validateAnswerKey } from '../src/answers/answer-key.mjs';
import { buildTransportPlan } from '../src/noise/transport.mjs';
import { renderPage } from '../src/render/renderers.mjs';
import { generate, listFiles } from '../src/site/generator.mjs';
import { attr, textContent, walk } from '../src/site/util.mjs';

// Every page loads the site's own behaviour script (and the search page its index; src/render/site-runtime.mjs); markup
// operators must add no other script.
const withoutRuntime = html => html.replace(/<script\b[^>]*assets\/(site-actions|search-index)\.js[^>]*><\/script>\s*/gi, '');
const NEW_TYPES = ['comment-clutter', 'hidden-boilerplate', 'duplicate-heading', 'nested-layout-table', 'link-variants', 'broken-image', 'conflicting-metadata', 'obsolete-markup', 'missing-main', 'legacy-document', 'image-missing-alt', 'onclick-navigation', 'javascript-only-link', 'deep-wrapper-tree', 'frame-missing-title', 'legacy-color-attribute', 'shortcode-residue', 'split-text-runs', 'entity-encoded-text', 'uppercase-legacy-tags', 'microdata-attributes', 'inline-svg-icons', 'hidden-reader-copy', 'analytics-beacon', 'spacer-elements', 'builder-modules'];
// Markup operators only: crawler traps may emit scripts and non-local hrefs and have their own contract in crawler-traps.test.mjs.
const HTML_TYPES = MARKUP_NOISE_TYPES.filter(type => type !== 'delayed-content');
const PRIVATE_TERMS = /expectedCluster|canonicalValues|noiseEvents|ground-truth|pageId/;
const PUBLIC_NOISE_LABELS = new RegExp(NOISE_TYPES.join('|'));
const SEMANTIC_TYPES = new Set(['split-text-runs', 'entity-encoded-text', 'uppercase-legacy-tags', 'microdata-attributes', 'inline-svg-icons', 'comment-clutter', 'nested-layout-table', 'link-variants', 'obsolete-markup', 'onclick-navigation', 'javascript-only-link', 'deep-wrapper-tree', 'legacy-color-attribute']);

function fixture(seed, fieldLayout, types, severity = 3) {
  const config = validateConfig({
    version: 1,
    seed,
    site: { id: 'adversarial-html', domain: 'library', framework: 'html', visualStyle: 'legacy', pageCount: 12 },
    contentTypes: [{
      name: 'record', label: 'Records', fieldLayout,
      fields: [
        { name: 'title', type: 'title' },
        { name: 'author', type: 'person' },
        { name: 'publishedAt', type: 'date' },
        { name: 'revisedAt', type: 'date' },
        { name: 'location', type: 'place' },
        { name: 'note', type: 'text' },
      ],
    }],
    noise: { level: 'custom', probability: 1, severity, maxPerPage: NOISE_TYPES.length, types },
  });
  const source = createModel(config);
  const canonical = source.pages.find(page => page.kind === 'detail');
  return { source, canonical };
}

function classNodes(root, className) {
  return walk(root, node => attr(node, 'class')?.split(/\s+/).includes(className));
}

function assertOnlyLocalResources(doc) {
  for (const node of walk(doc, item => ['a', 'img', 'script'].includes(item.tagName))) {
    const value = attr(node, node.tagName === 'a' ? 'href' : 'src');
    if (value !== undefined) assert((value.startsWith('/') && !value.startsWith('//')) || value.startsWith('#') || (node.tagName === 'a' && value === 'javascript:void(0)' && /^window\.location\.href='\/[a-zA-Z0-9/_-]*'$/.test(attr(node, 'onclick') ?? '')), value);
  }
}

function assertOperator(type, cleanHtml, noisyHtml, canonical) {
  const clean = parse(cleanHtml);
  const noisy = parse(noisyHtml);
  assert.notEqual(noisyHtml, cleanHtml);
  if (type === 'comment-clutter') {
    assert.match(noisyHtml, /<!-- archive layout marker \d+ -->/);
    assert(walk(noisy, node => node.nodeName === '#comment').length >= 6);
  }
  if (type === 'hidden-boilerplate') {
    const nodes = classNodes(noisy, 'supplemental-archive');
    assert.equal(nodes.length, 3);
    assert(nodes.every(node => attr(node, 'hidden') === '' && attr(node, 'aria-hidden') === 'true'));
  }
  if (type === 'duplicate-heading') {
    const headings = walk(noisy, node => node.tagName === 'h1');
    assert.equal(headings.length, walk(clean, node => node.tagName === 'h1').length + 3);
    assert(headings.every(node => textContent(node).trim() === canonical.title));
  }
  if (type === 'nested-layout-table') {
    const tables = classNodes(noisy, 'layout-table');
    assert.equal(tables.length, 3);
    assert.equal(classNodes(tables[0], 'field-list').length, 1);
    assert.match(noisyHtml, /role="presentation"/);
  }
  if (type === 'link-variants') {
    const nav = classNodes(noisy, 'record-views')[0];
    const hrefs = walk(nav, node => node.tagName === 'a').map(node => attr(node, 'href'));
    assert.deepEqual(hrefs, [`${canonical.url}#content`, `${canonical.url}?view=compact`, `${canonical.url}?view=compact#content`]);
    assert.equal(new Set(hrefs).size, 3);
  }
  if (type === 'broken-image') {
    const cleanImage = walk(clean, node => node.tagName === 'img')[0];
    const noisyImage = walk(noisy, node => node.tagName === 'img')[0];
    assert.match(attr(noisyImage, 'src'), /^\/assets\/missing-\d+\.png$/);
    assert.match(attr(noisyImage, 'srcset'), /^\/assets\/missing-/);
    assert.equal(attr(noisyImage, 'alt'), attr(cleanImage, 'alt'));
    assert.equal(attr(noisyImage, 'data-resource-state'), 'unavailable');
  }
  if (type === 'conflicting-metadata') {
    const descriptions = walk(noisy, node => node.tagName === 'meta' && attr(node, 'name') === 'description');
    assert.equal(descriptions.length, 2);
    assert(descriptions.some(node => attr(node, 'content') === canonical.title));
    assert.equal(textContent(walk(noisy, node => node.tagName === 'title')[0]).trim(), textContent(walk(clean, node => node.tagName === 'title')[0]).trim());
    assert.equal(walk(noisy, node => node.tagName === 'meta' && attr(node, 'name') === 'title').length, 1);
  }
  if (type === 'obsolete-markup') {
    assert.equal(classNodes(noisy, 'obsolete-layout').length, 1);
    for (const tag of ['center', 'font', 'big', 'tt']) assert.equal(walk(noisy, node => node.tagName === tag).length, 1);
    assert.match(noisyHtml, /<center class="obsolete-layout"><font face="serif"><big><tt>/);
  }
  if (type === 'missing-main') {
    assert.equal(walk(noisy, node => node.tagName === 'main').length, 0);
    assert.equal(walk(noisy, node => node.tagName === 'div' && attr(node, 'id') === 'content').length, 1);
  }
  if (type === 'legacy-document') {
    assert.doesNotMatch(noisyHtml, /^<!doctype/i);
    assert.equal(attr(walk(noisy, node => node.tagName === 'html')[0], 'lang'), undefined);
  }
  if (type === 'image-missing-alt') {
    assert.equal(attr(walk(noisy, node => node.tagName === 'img')[0], 'alt'), undefined);
  }
  if (type === 'onclick-navigation') {
    const button = walk(noisy, node => node.tagName === 'button' && attr(node, 'class') === 'archive-action')[0];
    assert(button);
    assert.match(attr(button, 'onclick'), /^window\.location\.href='\/[a-zA-Z0-9/_-]*'$/);
  }
  if (type === 'javascript-only-link') {
    assert(walk(noisy, node => node.tagName === 'a' && attr(node, 'href') === 'javascript:void(0)' && attr(node, 'onclick')).length >= 1);
  }
  if (type === 'deep-wrapper-tree') {
    assert.equal(classNodes(noisy, 'legacy-wrapper').length, 16);
    assert.equal(classNodes(noisy, 'field-list').length, 1);
  }
  if (type === 'frame-missing-title') {
    const frame = walk(noisy, node => node.tagName === 'iframe' && attr(node, 'class') === 'legacy-frame')[0];
    assert(frame);
    assert.equal(attr(frame, 'title'), undefined);
    assert.match(attr(frame, 'srcdoc'), /Archive reference panel/);
  }
  if (type === 'legacy-color-attribute') {
    const body = walk(noisy, node => node.tagName === 'body')[0];
    assert.equal(attr(body, 'bgcolor'), '#ffffff');
    assert.equal(attr(body, 'vlink'), '#663399');
  }
  // 2026-11-02 operators: the field list reads the same text in a parser, whatever the markup around it.
  const domText = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(domText).join('');
  const fieldText = doc => { const list = classNodes(doc, 'field-list')[0]; return list ? domText(list).replace(/\s+/g, ' ').trim() : null; };
  if (['split-text-runs', 'entity-encoded-text', 'uppercase-legacy-tags', 'microdata-attributes', 'inline-svg-icons'].includes(type)) assert.equal(fieldText(noisy), fieldText(clean), `${type} keeps field text`);
  if (type === 'split-text-runs') assert(classNodes(noisy, 'mso-run').length >= 1);
  if (type === 'entity-encoded-text') assert.match(noisyHtml, /&#(\d+|x[0-9a-f]+);/);
  if (type === 'uppercase-legacy-tags') {
    assert.match(noisyHtml, /<(DIV|P|DL|DD|TD|TABLE)[\s>]/);
    assert.equal(walk(noisy, node => ['dd', 'td', 'p'].includes(node.tagName)).length, walk(clean, node => ['dd', 'td', 'p'].includes(node.tagName)).length, 'same elements once parsed');
  }
  if (type === 'microdata-attributes') assert.equal(attr(classNodes(noisy, 'field-list')[0], 'itemscope'), '');
  if (type === 'inline-svg-icons') assert(classNodes(noisy, 'field-icon').length >= 1);
  if (type === 'hidden-reader-copy') assert(classNodes(noisy, 'sr-only').length >= 1);
  if (type === 'analytics-beacon') assert(walk(noisy, node => node.tagName === 'img' && attr(node, 'width') === '1' && /beacon=\d+/.test(attr(node, 'src') ?? '')).length >= 1);
  if (type === 'spacer-elements') assert.match(noisyHtml, /<p>&nbsp;<\/p><p><\/p>/i);
  if (type === 'builder-modules') {
    // Severity 3 adds all four modules; none of them carries a record field, so the field list is untouched.
    assert.equal(classNodes(noisy, 'content-module').length, 4, 'photo, button, audio player and slider');
    assert.equal(walk(noisy, node => node.tagName === 'audio').length, 1);
    assert.equal(classNodes(noisy, 'field-list').length, classNodes(clean, 'field-list').length, 'field list unchanged');
    assert.equal(fieldText(noisy), fieldText(clean), 'field text unchanged');
  }
  if (type === 'shortcode-residue') {
    const residue = classNodes(noisy, 'legacy-content')[0];
    assert(residue, 'leftover shortcode block');
    assert.match(noisyHtml, /<p>\[(caption|vc_row|et_pb_section)[^<]*\]<\/p>/);
    assert.equal(classNodes(noisy, 'field-list').length, 1, 'field list unchanged');
  }
  assert.doesNotMatch(noisyHtml, PRIVATE_TERMS);
  assert.doesNotMatch(noisyHtml, PUBLIC_NOISE_LABELS);
  assert.doesNotMatch(withoutRuntime(noisyHtml), /<script\b/i);
  assertOnlyLocalResources(noisy);
}

function assertPairEffect(type, html, canonical) {
  const doc = parse(html);
  if (type === 'comment-clutter') assert.match(html, /<!-- archive layout marker \d+ -->/);
  if (type === 'hidden-boilerplate') assert(classNodes(doc, 'supplemental-archive').length >= 1);
  if (type === 'duplicate-heading') assert(walk(doc, node => node.tagName === 'h1').length >= 2);
  if (type === 'nested-layout-table') assert(classNodes(doc, 'layout-table').length >= 1);
  if (type === 'link-variants') assert(classNodes(doc, 'record-views').length >= 1);
  if (type === 'broken-image') {
    const image = walk(doc, node => node.tagName === 'img')[0];
    assert.match(attr(image, 'src'), /^\/assets\/missing-\d+\.png$/);
    if (attr(image, 'alt') !== undefined) assert.equal(attr(image, 'alt'), canonical.image.alt);
  }
  if (type === 'conflicting-metadata') {
    assert(walk(doc, node => node.tagName === 'meta' && attr(node, 'name') === 'title' && attr(node, 'content') === 'Untitled legacy catalog record').length >= 1);
    assert.equal(textContent(walk(doc, node => node.tagName === 'h1')[0]).trim(), canonical.title);
  }
  if (type === 'obsolete-markup') assert(classNodes(doc, 'obsolete-layout').length >= 1);
  if (type === 'missing-main') assert.equal(walk(doc, node => node.tagName === 'main').length, 0);
  if (type === 'legacy-document') assert.doesNotMatch(html, /^<!doctype/i);
  if (type === 'image-missing-alt') assert.equal(attr(walk(doc, node => node.tagName === 'img')[0], 'alt'), undefined);
  if (type === 'onclick-navigation') assert(walk(doc, node => node.tagName === 'button' && attr(node, 'onclick')).length >= 1);
  if (type === 'javascript-only-link') assert(walk(doc, node => node.tagName === 'a' && attr(node, 'href') === 'javascript:void(0)').length >= 1);
  if (type === 'deep-wrapper-tree') assert.equal(classNodes(doc, 'legacy-wrapper').length, 16);
  if (type === 'frame-missing-title') assert(walk(doc, node => node.tagName === 'iframe' && attr(node, 'title') === undefined).length >= 1);
  if (type === 'legacy-color-attribute') assert.equal(attr(walk(doc, node => node.tagName === 'body')[0], 'bgcolor'), '#ffffff');
  if (type === 'shortcode-residue') assert(classNodes(doc, 'legacy-content').length >= 1);
  if (type === 'split-text-runs') assert(classNodes(doc, 'mso-run').length >= 1 || classNodes(doc, 'field-list').length === 0);
  if (type === 'microdata-attributes') assert(walk(doc, node => attr(node, 'itemscope') !== undefined).length >= 1 || classNodes(doc, 'field-list').length === 0);
  if (type === 'hidden-reader-copy') assert(classNodes(doc, 'sr-only').length >= 1);
  if (type === 'analytics-beacon') assert(classNodes(doc, 'tracking-pixel').length >= 1);
  // class-churn may run after the spacers and add classes to them.
  if (type === 'spacer-elements') assert.match(html, /<p\b[^>]*>&nbsp;<\/p><p\b[^>]*><\/p>/i);
  if (type === 'builder-modules') assert(classNodes(doc, 'content-module').length >= 1);
}

for (const type of NEW_TYPES) {
  test(`${type} is observable across seeds and field layouts without changing canonical truth`, () => {
    for (const seed of [17, 8801]) {
      for (const fieldLayout of ['definition-list', 'table', 'paragraphs']) {
        const { source, canonical } = fixture(seed, fieldLayout, [type]);
        const before = structuredClone(canonical);
        const page = applyDataNoise(canonical, source.site);
        assert.equal(page.noiseEvents[0].preservesSemantics, SEMANTIC_TYPES.has(type));
        const cleanHtml = renderPage(source.site, canonical);
        const noisyHtml = applyHtmlNoise(renderPage(source.site, page), page, source.site);
        assertOperator(type, cleanHtml, noisyHtml, canonical);
        if (type === 'broken-image') {
          const image = walk(parse(noisyHtml), node => node.tagName === 'img')[0];
          assert.equal(attr(image, 'src'), page.image.src);
          assert.equal(attr(image, 'srcset'), page.image.srcset);
          assert.notEqual(page.image.src, canonical.image.src);
        }
        assert.deepEqual(canonical, before);
        assert.deepEqual(page.fields, canonical.fields);
        assert.deepEqual(page.canonicalValues, canonical.fields);
        assert.equal(page.expectedCluster, canonical.expectedCluster);
      }
    }
  });
}

test('every feasible pair of non-delayed operators composes deterministically', () => {
  let pair = 0;
  for (let left = 0; left < HTML_TYPES.length; left++) {
    for (let right = left + 1; right < HTML_TYPES.length; right++) {
      const types = [HTML_TYPES[left], HTML_TYPES[right]];
      const layout = ['definition-list', 'table', 'paragraphs'][pair++ % 3];
      let selected;
      for (let attempt = 0; attempt < 64; attempt++) {
        const candidate = fixture(3000 + pair * 64 + attempt, layout, types);
        const page = applyDataNoise(candidate.canonical, candidate.source.site);
        if (types.every(type => page.noiseEvents.some(event => event.type === type))) {
          selected = { ...candidate, page };
          break;
        }
      }
      assert(selected, `no feasible seed for ${types.join(' + ')}`);
      const { source, canonical, page: firstPage } = selected;
      const before = structuredClone(canonical);
      const secondPage = applyDataNoise(canonical, source.site);
      const first = applyHtmlNoise(renderPage(source.site, firstPage), firstPage, source.site);
      const second = applyHtmlNoise(renderPage(source.site, secondPage), secondPage, source.site);
      assert.deepEqual(firstPage, secondPage, types.join(' + '));
      assert.equal(first, second, types.join(' + '));
      assert.deepEqual(canonical, before, types.join(' + '));
      if (types.includes('missing-main')) assert.doesNotMatch(first, /<main\b/);
      else assert.match(first, /<main\b/);
      assert.match(first, /<h1\b/);
      assert.doesNotMatch(first, PRIVATE_TERMS);
      assert.doesNotMatch(first, PUBLIC_NOISE_LABELS);
      assert.doesNotMatch(withoutRuntime(first), /<script\b/i);
      assertOnlyLocalResources(parse(first));
      assert.deepEqual(new Set(firstPage.noiseEvents.map(event => event.type)), new Set(types), types.join(' + '));
      for (const type of types.filter(type => NEW_TYPES.includes(type))) assertPairEffect(type, first, canonical);
    }
  }
});

test('conflicting metadata survives missing-metadata at every severity and event order', () => {
  for (const severity of [1, 2, 3]) {
    for (const order of [
      ['missing-metadata', 'conflicting-metadata'],
      ['conflicting-metadata', 'missing-metadata'],
    ]) {
      const { source, canonical } = fixture(7400 + severity, 'definition-list', [], severity);
      const page = structuredClone(canonical);
      page.noiseEvents = order.map(type => ({ type, severity, preservesSemantics: false }));
      const html = applyHtmlNoise(renderPage(source.site, page), page, source.site);
      const doc = parse(html);
      const titleConflict = walk(doc, node => node.tagName === 'meta' && attr(node, 'name') === 'title');
      assert.equal(titleConflict.length, 1, `${order.join(' then ')} at severity ${severity}`);
      assert.equal(attr(titleConflict[0], 'content'), 'Untitled legacy catalog record');
      assert.equal(textContent(walk(doc, node => node.tagName === 'h1')[0]).trim(), canonical.title);
      assert.deepEqual(page.fields, canonical.fields);
      assert.doesNotMatch(html, PRIVATE_TERMS);
      assert.doesNotMatch(html, PUBLIC_NOISE_LABELS);
    }
  }
});

test('generated static pages are deterministic and keep private truth out of HTML', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adversarial-html-'));
  const input = {
    version: 1,
    seed: 6123,
    site: { id: 'adversarial-generated', domain: 'library', framework: 'html', visualStyle: 'legacy', pageCount: 12 },
    contentTypes: [{ name: 'record', label: 'Records', fieldLayout: 'mixed', fields: [{ name: 'title', type: 'title' }, { name: 'author', type: 'person' }, { name: 'publishedAt', type: 'date' }, { name: 'note', type: 'text' }] }],
    noise: { level: 'custom', probability: 1, severity: 3, maxPerPage: NOISE_TYPES.length, types: NEW_TYPES },
  };
  try {
    await generate(input, join(root, 'a'));
    await generate(input, join(root, 'b'));
    const files = (await listFiles(join(root, 'a', 'public'))).filter(file => file.endsWith('.html'));
    assert(files.length > 0);
    for (const file of files) {
      const first = await readFile(join(root, 'a', 'public', file), 'utf8');
      const second = await readFile(join(root, 'b', 'public', file), 'utf8');
      assert.equal(first, second, file);
      assert.doesNotMatch(first, PRIVATE_TERMS);
      assert.doesNotMatch(first, PUBLIC_NOISE_LABELS);
      assert.doesNotMatch(withoutRuntime(first), /<script\b/i);
      assertOnlyLocalResources(parse(first));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('date-format pool renders every real-world format exactly for a known date', () => {
  const expected = {
    'us-long': 'March 5, 2024', 'us-numeric': '03/05/2024', 'day-month-year': '5 March 2024', 'abbreviated-month': 'Mar. 5, 2024',
    'dotted-european': '5.3.2024', 'weekday-long': 'Tuesday, March 5, 2024', 'month-year': 'March 2024', 'iso-datetime': '2024-03-05T00:00:00Z',
  };
  assert.deepEqual(DATE_FORMAT_POOL.map(entry => entry.id), Object.keys(expected));
  for (const entry of DATE_FORMAT_POOL) assert.equal(entry.format(2024, 3, 5), expected[entry.id]);
  assert(DATE_FORMAT_POOL.every(entry => entry.format(2024, 3, 5) !== '2024-03-05'), 'no pool entry may equal the canonical ISO rendering');
});

const poolFor = key => FIELD_LABEL_POOLS.find(entry => entry.match.test(key)).labels;
const htmlText = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('seeded date and label pools reach every entry, render it, and keep the answer key valid', () => {
  const dateSeen = new Set(); const labelSeen = { author: new Set(), publicationDate: new Set(), isbn: new Set() };
  for (let seed = 1; seed <= 40; seed++) {
    const configuration = validateConfig({ version: 1, seed, site: { id: `pool-${seed}`, domain: 'library', framework: 'html', pageCount: 24 },
      contentTypes: [{ name: 'book', label: 'Books', fieldLayout: 'mixed', fields: [{ name: 'title', type: 'title' }, { name: 'author', type: 'person' },
        { name: 'publicationDate', type: 'date' }, { name: 'isbn', type: 'isbn' }] }],
      noise: { level: 'custom', probability: 1, severity: 2, maxPerPage: 2, types: ['date-format', 'label-variation'] } });
    const source = createModel(configuration);
    const pages = source.pages.map(page => applyDataNoise(page, source.site));
    validateAnswerKey(source, { ...source, pages, transport: buildTransportPlan(source.pages, { profile: configuration.transport.profile, seed: configuration.seed }) }, configuration);
    for (const [index, page] of pages.entries()) {
      const canonical = source.pages[index];
      const html = applyHtmlNoise(renderPage(source.site, page), page, source.site);
      assert.doesNotMatch(html, PUBLIC_NOISE_LABELS);
      for (const event of page.noiseEvents) {
        if (event.type === 'date-format') {
          const shown = page.fields[event.field];
          assert.equal(page.canonicalValues[event.field], canonical.fields[event.field]);
          assert.equal(shown, dateFormatVariant(canonical.fields[event.field], configuration.seed, page.pageId));
          const [y, m, d] = canonical.fields[event.field].split('-').map(Number);
          const entry = DATE_FORMAT_POOL.find(candidate => candidate.format(y, m, d) === shown);
          assert(entry, `${shown} is not a pool format`);
          if (page.kind === 'detail') { assert(html.includes(htmlText(shown)), `${shown} must render`); dateSeen.add(entry.id); }
        }
        if (event.type === 'label-variation' && event.field in labelSeen) {
          const shown = page.fieldLabels[event.field];
          assert.equal(shown, fieldLabelVariant(event.field, page.fieldLayout, configuration.seed, page.pageId));
          assert(poolFor(event.field).some(value => value === shown || value === `${shown}:`), `${shown} is not a pool label`);
          if (page.kind === 'detail' && page.fieldLayout !== 'paragraphs') { assert(html.includes(htmlText(shown)), `${shown} must render`); labelSeen[event.field].add(shown); }
        }
      }
    }
  }
  assert.deepEqual([...dateSeen].sort(), DATE_FORMAT_POOL.map(entry => entry.id).sort());
  for (const [key, seen] of Object.entries(labelSeen)) assert.deepEqual([...seen].sort(), [...poolFor(key)].sort(), `${key} labels`);
});

test('the answer key rejects a date or label variant other than the seeded pool choice', () => {
  const configuration = validateConfig({ version: 1, seed: 77, site: { id: 'pool-tamper', domain: 'library', framework: 'html', pageCount: 24 },
    contentTypes: [{ name: 'book', label: 'Books', fieldLayout: 'table', fields: [{ name: 'title', type: 'title' }, { name: 'author', type: 'person' }, { name: 'publicationDate', type: 'date' }] }],
    noise: { level: 'custom', probability: 1, severity: 2, maxPerPage: 2, types: ['date-format', 'label-variation'] } });
  const source = createModel(configuration);
  const transport = buildTransportPlan(source.pages, { profile: configuration.transport.profile, seed: configuration.seed });
  const pages = source.pages.map(page => applyDataNoise(page, source.site));
  validateAnswerKey(source, { ...source, pages, transport }, configuration);
  const index = pages.findIndex(page => page.noiseEvents.some(event => event.type === 'date-format'));
  const dateField = pages[index].noiseEvents.find(event => event.type === 'date-format').field;
  const shown = pages[index].fields[dateField];
  const [y, m, d] = source.pages[index].fields[dateField].split('-').map(Number);
  const other = DATE_FORMAT_POOL.map(entry => entry.format(y, m, d)).find(value => value !== shown);
  const tamperedDate = pages.map((page, i) => i === index ? { ...page, fields: { ...page.fields, [dateField]: other } } : page);
  assert.throws(() => validateAnswerKey(source, { ...source, pages: tamperedDate, transport }, configuration), /unexplained publicationDate value/);
  const labelIndex = pages.findIndex(page => page.noiseEvents.some(event => event.type === 'label-variation' && event.field === 'author'));
  const otherLabel = poolFor('author').find(value => value !== pages[labelIndex].fieldLabels.author);
  const tamperedLabel = pages.map((page, i) => i === labelIndex ? { ...page, fieldLabels: { ...page.fieldLabels, author: otherLabel } } : page);
  assert.throws(() => validateAnswerKey(source, { ...source, pages: tamperedLabel, transport }, configuration), /unrecorded field labels/);
});
