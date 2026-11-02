import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, NOISE_TYPES } from '../src/config.mjs';
import { createModel } from '../src/model.mjs';
import { applyDataNoise, applyHtmlNoise, dateFormatVariant } from '../src/noise.mjs';
import { renderPage, finalizePage } from '../src/renderers.mjs';
import { RESOURCE_ONLY_TRAP_TYPES } from '../src/crawler-traps.mjs';

function model(seed, types, framework = 'html', severity = 3) {
  const config = validateConfig({ version: 1, seed, site: { id: 'legacy-contract', domain: 'library', framework, visualStyle: 'legacy', pageCount: 60 }, noise: { level: 'custom', probability: 1, severity, maxPerPage: 12, types } });
  return createModel(config);
}

for (const seed of [71, 924]) {
  for (const type of NOISE_TYPES) {
    test(`legacy obstacle ${type} is observable and retains source identity (seed ${seed})`, () => {
      const source = model(seed, [type], type === 'delayed-content' ? 'react' : 'html');
      const before = JSON.stringify(source);
      let affected = 0;
      for (const canonical of source.pages) {
        const page = applyDataNoise(canonical, source.site);
        assert.equal(page.expectedCluster, canonical.expectedCluster);
        assert.equal(page.url, canonical.url);
        assert.deepEqual(page.canonicalValues, canonical.fields);
        assert(page.noiseEvents.every(event => event.type === type));
        if (!page.noiseEvents.length) continue;
        affected++;
        const cleanHtml = renderPage(source.site, canonical);
        const observedHtml = applyHtmlNoise(renderPage(source.site, page), page, source.site);
        if (type === 'delayed-content') {
          assert.equal(page.delayMs, 600);
          assert.match(finalizePage(source.site, page, observedHtml), /react-app\.js/);
        } else if (!RESOURCE_ONLY_TRAP_TYPES.includes(type)) {
          // Resource-only traps (robots.txt) change public files, checked in crawler-traps.test.mjs.
          assert.notEqual(observedHtml, cleanHtml, `${type} must change observable HTML, not only its event log`);
        }
        if (type === 'missing-field') {
          const removed = page.noiseEvents[0].field;
          assert.equal(page.fieldStates[removed], 'absent');
          assert.equal(Object.hasOwn(page.fields, removed), false);
          assert.equal(page.canonicalValues[removed], canonical.fields[removed]);
        }
        if (type === 'date-format') assert.equal(page.fields[page.noiseEvents[0].field], dateFormatVariant(canonical.fields[page.noiseEvents[0].field], source.site.seed, page.pageId));
        if (type === 'malformed-nesting') assert.match(observedHtml, /<p class="archive-note"><div>Record last reviewed\.<\/p><\/div>/);
        assert.doesNotMatch(observedHtml, /expectedCluster|canonicalValues|noiseEvents|ground-truth\.json/);
      }
      assert(affected > 0, `${type} must affect eligible pages`);
      assert.equal(JSON.stringify(source), before, 'Noise must never rewrite source answers');
    });
  }
}

test('high boilerplate noise contains repeated legacy navigation and table clutter', () => {
  const source = model(71, ['boilerplate']);
  const page = applyDataNoise(source.pages[0], source.site);
  const html = applyHtmlNoise(renderPage(source.site, page), page, source.site);
  assert.match(html, /class="legacy-notice-table"/);
  assert.match(html, /aria-label="Archive shortcuts"/);
  assert.match(html, /Web archive notice/);
  assert.doesNotMatch(html, /<a\b[^>]*href="https?:\/\//);
});

test('wrapper, reordering, malformed markup and missing fields compose without moving clusters', () => {
  const source = model(123, ['extra-wrapper', 'reorder-fields', 'malformed-nesting', 'missing-field']);
  for (const canonical of source.pages) {
    const page = applyDataNoise(canonical, source.site);
    const html = applyHtmlNoise(renderPage(source.site, page), page, source.site);
    assert.equal(page.expectedCluster, canonical.expectedCluster);
    assert.equal(page.url, canonical.url);
    assert.match(html, /<main\b/);
    assert.match(html, /<h1>/);
    assert.deepEqual(page.canonicalValues, canonical.fields);
    assert(page.noiseEvents.length <= 4);
  }
});
