import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_BUDGET, pagesForSite, randomPageCounts, sitePlan, totalPlannedPages, validateFixtureInput } from '../src/fixture-lab/config.mjs';
import { createPlanSnapshot, assertSavedSiteSummary } from '../src/fixture-lab/plans.mjs';
import { validateNewFixtureInput } from '../src/fixture-lab/new-request.mjs';
import { randomFixtureInput } from '../src/fixture-lab/random.mjs';

test('a fixed page count is used exactly for every site', () => {
  const config = validateFixtureInput({ name: 'Fixed', siteCount: 4, pagesPerSite: 1234, seed: 3 });
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => pagesForSite(config, index)), [1234, 1234, 1234, 1234]);
});

test('random page count draws each site from 5 to the typed maximum', () => {
  const config = validateFixtureInput({ name: 'Random up to 300', siteCount: 40, pagesPerSite: 300, randomPageCount: true, seed: 11 });
  const counts = Array.from({ length: 40 }, (_, index) => pagesForSite(config, index));
  assert(counts.every(count => Number.isInteger(count) && count >= 5 && count <= 300));
  assert(counts.some(count => count > 200), 'maximum above the old 200 cap is reachable');
  assert(new Set(counts).size > 20, 'sites receive different sizes');
  assert.deepEqual(randomPageCounts(config), counts);
  assert.deepEqual(randomPageCounts(validateFixtureInput({ name: 'Replay', siteCount: 40, pagesPerSite: 300, randomPageCount: true, seed: 11 })), counts, 'same seed replays');
  assert.notDeepEqual(randomPageCounts(validateFixtureInput({ name: 'Other', siteCount: 40, pagesPerSite: 300, randomPageCount: true, seed: 12 })), counts);
});

test('ten random sites up to 100,000 pages share the 100,000-page budget', () => {
  for (const seed of [0, 1, 7, 99, 48291]) {
    const config = validateNewFixtureInput({ name: 'Ten big random sites', siteCount: 10, pagesPerSite: 100000, randomPageCount: true, seed });
    const counts = randomPageCounts(config);
    assert.equal(counts.length, 10);
    assert(counts.every(count => count >= 5 && count <= 100000));
    assert(totalPlannedPages(config) <= PAGE_BUDGET, `seed ${seed}: ${totalPlannedPages(config)}`);
    assert(new Set(counts).size > 5, 'sizes still vary after scaling');
  }
  const many = validateFixtureInput({ name: 'Many', siteCount: 500, pagesPerSite: 100000, randomPageCount: true, seed: 5 });
  assert(totalPlannedPages(many) <= PAGE_BUDGET);
  assert(randomPageCounts(many).every(count => count >= 5));
});

test('saved plans and summaries record the random sizes and audit their bounds', () => {
  const request = validateFixtureInput({ name: 'Plan', siteCount: 3, pagesPerSite: 40, randomPageCount: true, seed: 21, domain: 'library' });
  const snapshot = createPlanSnapshot(request);
  snapshot.sites.forEach((plan, index) => {
    assert.equal(plan.summary.pageCount, pagesForSite(request, index));
    assert.equal(plan.config.site.pageCount, plan.summary.pageCount);
    assertSavedSiteSummary(plan.summary, plan.config, index, request);
  });
  const plan = sitePlan(request, 0);
  assert.throws(() => assertSavedSiteSummary({ ...plan.summary, pageCount: 41 }, { ...plan.config, site: { ...plan.config.site, pageCount: 41 } }, 0, request), /outside 5\.\.40/);
});

test('random page count validation and compatibility', () => {
  assert.throws(() => validateFixtureInput({ name: 'Zero max', pagesPerSite: 0, randomPageCount: true }), /maximum pages per site/);
  assert.throws(() => validateFixtureInput({ name: 'Too big', pagesPerSite: 100001, randomPageCount: true }));
  assert.throws(() => validateFixtureInput({ name: 'Fixed over budget', siteCount: 10, pagesPerSite: 100000 }), /cannot exceed 100,000/);
  const legacy = validateFixtureInput({ name: 'Legacy zero', siteCount: 8, pagesPerSite: 0, seed: 413 });
  for (let index = 0; index < 8; index++) { const count = pagesForSite(legacy, index); assert(count >= 5 && count <= 200); }
  const single = randomFixtureInput({ seed: 4, pagesPerSite: 900, randomPageCount: true });
  assert.equal(single.randomPageCount, true);
  assert(pagesForSite(single, 0) >= 5 && pagesForSite(single, 0) <= 900);
});
