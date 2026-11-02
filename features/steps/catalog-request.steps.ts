import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import { ZodError } from 'zod';
import { validateNewFixtureInput } from '../../src/fixture-lab/new-request.mjs';
import { sitePlan } from '../../src/fixture-lab/config.mjs';
import { CATALOG_SETTINGS } from '../../src/fixture-lab/case-catalog.mjs';

interface CatalogRequestWorld extends World {
  catalogInput: Record<string, unknown>;
  acceptedInput?: ReturnType<typeof validateNewFixtureInput>;
  requestFailure?: unknown;
}

Given('a new {string} request with absolute links', function(this: CatalogRequestWorld, suite: string) {
  assert(['regression-1440', 'catalog-case'].includes(suite));
  this.catalogInput = { ...CATALOG_SETTINGS, name: 'Fixed catalog', suite, linkMode: 'absolute',
    ...(suite === 'catalog-case' ? { siteCount: 1, caseId: 'case-0001', previewProtocol: 'http' } : {}) };
});
Given('a new custom request with CMS markup and absolute links', function(this: CatalogRequestWorld) {
  this.catalogInput = { name: 'Custom source', pagesPerSite: 8, cmsProfile: 'wordpress',
    builderProfile: 'elementor', linkMode: 'absolute', randomness: 70 };
});
Given('a new random builder request with {string} CMS', function(this: CatalogRequestWorld, cms: string) {
  assert(['omitted', 'none', 'drupal'].includes(cms));
  this.catalogInput = { name: 'Ignored random builder', pagesPerSite: 5, builderProfile: 'random',
    ...(cms === 'omitted' ? {} : { cmsProfile: cms }) };
});
When('the generation request is checked', function(this: CatalogRequestWorld) {
  try { this.acceptedInput = validateNewFixtureInput(this.catalogInput); }
  catch (error) { this.requestFailure = error; }
});
Then('it is rejected with a linkMode field error before a job starts', function(this: CatalogRequestWorld) {
  assert.equal(this.acceptedInput, undefined);
  assert(this.requestFailure instanceof ZodError);
  assert(this.requestFailure.issues.some(issue => issue.path[0] === 'linkMode' && /fixed settings/.test(issue.message)));
});
Then('it is rejected with a builderProfile field error', function(this: CatalogRequestWorld) {
  assert.equal(this.acceptedInput, undefined);
  assert(this.requestFailure instanceof ZodError);
  assert(this.requestFailure.issues.some(issue => issue.path[0] === 'builderProfile' && /requires WordPress or a random CMS/.test(issue.message)));
});
Then('its site plan retains CMS markup and absolute links', function(this: CatalogRequestWorld) {
  assert.equal(this.requestFailure, undefined);
  assert(this.acceptedInput);
  const plan = sitePlan(this.acceptedInput, 0);
  assert('cmsProfile' in plan.config.site);
  assert('builderProfile' in plan.config.site);
  assert('linkMode' in plan.config.site);
  assert('variation' in plan.config);
  assert.equal(plan.config.site.cmsProfile, 'wordpress');
  assert.equal(plan.config.site.builderProfile, 'elementor');
  assert.equal(plan.config.site.linkMode, 'absolute');
  assert.equal(plan.config.variation?.amount, 70);
});
