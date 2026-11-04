import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import { validateConfig } from '../../src/site/config.mjs';
import { createModel } from '../../src/site/model.mjs';
import { applyDataNoise } from '../../src/noise/noise.mjs';

type ModelPage = ReturnType<typeof createModel>['pages'][number];
type Location = { state: 'present'; selector: string; read: string; precision: string; label?: string }
  | { state: 'absent'; reason: string };
type LocatedListing = ModelPage & {
  repeatedItems: { pageId: string; fields: Record<string, unknown> }[];
  repeatedItemLocations: { pageId: string; fieldLocations: Record<string, Location> }[];
};

function firstLocatedListing(pages: ModelPage[]): LocatedListing {
  const page = pages.find(candidate => candidate.kind === 'listing');
  assert(page && 'repeatedItems' in page && Array.isArray(page.repeatedItems));
  assert('repeatedItemLocations' in page && Array.isArray(page.repeatedItemLocations));
  return page as LocatedListing;
}

interface RepeatedWorld extends World {
  repeatedSeed: number;
  repeatedConfig: ReturnType<typeof validateConfig>;
  repeatedSource: ReturnType<typeof createModel>;
  repeatedObserved: ReturnType<typeof createModel>['pages'];
}

Given('a varied listing source with seed {int}', function(this: RepeatedWorld, seed: number) {
  this.repeatedSeed = seed;
});

When('its source model is built without rendering HTML', function(this: RepeatedWorld) {
  this.repeatedConfig = validateConfig({ seed: this.repeatedSeed, variation: { amount: 80 },
    site: { id: 'bdd-repeated', pageCount: 30 }, contentTypes: [{ name: 'record', label: 'Records', fields: [
      { name: 'title', type: 'title' }, { name: 'publicationDate', type: 'date' },
      { name: 'summary', type: 'text', optional: true, presenceProbability: 0.5 },
    ] }] });
  this.repeatedSource = createModel(this.repeatedConfig);
  assert.equal(this.repeatedSource.repeatedItemLocationVersion, 1);
});

Then('its repeated title uses a {string} selector', function(this: RepeatedWorld, layout: string) {
  const listing = firstLocatedListing(this.repeatedSource.pages);
  assert(listing.repeatedItemLocations.length);
  const location = listing.repeatedItemLocations[0].fieldLocations.title;
  assert(location.state === 'present');
  assert.equal(location.read, 'textContent');
  assert(location.selector.startsWith(layout === 'table' ? '#content table.repeated-records > tbody > tr:nth-of-type(1) > td > a'
    : '#content ul.repeated-records > li:nth-of-type(1) > a'));
});

Then('each repeated scalar uses a strong-label reader', function(this: RepeatedWorld) {
  const listing = firstLocatedListing(this.repeatedSource.pages);
  assert(listing.repeatedItemLocations.length);
  for (const item of listing.repeatedItemLocations) for (const [name, location] of Object.entries(item.fieldLocations)) {
    if (name !== 'title' && location.state === 'present') {
      assert.equal(location.read, 'afterStrongLabel');
      assert.equal(location.precision, 'container');
    }
  }
});

Then('an optional repeated field absent at source has no selector', function(this: RepeatedWorld) {
  const listing = firstLocatedListing(this.repeatedSource.pages);
  assert(listing.repeatedItemLocations.length);
  const missing = listing.repeatedItemLocations.find(item => item.fieldLocations.summary.state === 'absent');
  assert(missing);
  assert.deepEqual(missing.fieldLocations.summary, { state: 'absent', reason: 'source-absent' });
});

When('date-format noise is applied to its detail pages', function(this: RepeatedWorld) {
  const site = structuredClone(this.repeatedSource.site);
  site.noise = { level: 'custom', probability: 1, severity: 1, maxPerPage: 1, types: ['date-format'], overrides: {} };
  this.repeatedObserved = this.repeatedSource.pages.map(page => applyDataNoise(page, site));
});

Then('the listing date remains the source value at its repeated location', function(this: RepeatedWorld) {
  const listing = firstLocatedListing(this.repeatedObserved);
  assert(listing.repeatedItems.length && listing.repeatedItemLocations.length);
  const item = listing.repeatedItems[0];
  const detail = this.repeatedObserved.find(page => page.pageId === item.pageId);
  assert(detail && 'publicationDate' in detail.fields);
  assert(typeof item.fields.publicationDate === 'string');
  assert.notEqual(item.fields.publicationDate, detail.fields.publicationDate);
  assert.equal(listing.repeatedItemLocations[0].fieldLocations.publicationDate.state, 'present');
});
