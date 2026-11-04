import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import { parse, serialize } from 'parse5';
import { validateConfig } from '../../src/site/config.mjs';
import { createModel } from '../../src/site/model.mjs';
import { applyDataNoise, applyHtmlNoise } from '../../src/noise/noise.mjs';
import { renderPage } from '../../src/render/renderers.mjs';

interface NoisePlanWorld extends World {
  noiseModel: ReturnType<typeof createModel>;
  noiseSource: ReturnType<typeof createModel>['pages'][number];
  noiseAnswer: ReturnType<typeof applyDataNoise>;
}

function model(types: string[], variation: number) {
  return createModel(validateConfig({
    seed: 71, site: { id: 'noise-plan-bdd', pageCount: 8 }, variation: { amount: variation },
    contentTypes: [{ name: 'record', label: 'Records', fields: [
      { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
    ] }],
    noise: { level: 'custom', probability: 1, severity: 2, maxPerPage: types.length, types },
  }));
}

Given('a rich listing configured for deep wrapper noise', function(this: NoisePlanWorld) {
  this.noiseModel = model(['deep-wrapper-tree'], 80);
  this.noiseSource = this.noiseModel.pages.find(page => page.kind === 'listing')!;
  assert(this.noiseSource && 'repeatedItems' in this.noiseSource);
  assert(Array.isArray(this.noiseSource.repeatedItems) && this.noiseSource.repeatedItems.length);
});
Given('a detail with one scalar field configured for removal and deep wrappers', function(this: NoisePlanWorld) {
  this.noiseModel = model(['missing-field', 'deep-wrapper-tree'], 0);
  this.noiseSource = this.noiseModel.pages.find(page => page.kind === 'detail')!;
  assert.deepEqual(Object.keys(this.noiseSource.fields).sort(), ['author', 'title']);
});
When('the source noise plan is applied', function(this: NoisePlanWorld) {
  this.noiseAnswer = applyDataNoise(this.noiseSource, this.noiseModel.site);
});
Then('its answer records no deep wrapper event', function(this: NoisePlanWorld) {
  assert.deepEqual(this.noiseAnswer.noiseEvents, []);
});
Then('its rendered document is unchanged by wrapper noise', function(this: NoisePlanWorld) {
  const clean = renderPage(this.noiseModel.site, this.noiseSource);
  const observed = applyHtmlNoise(renderPage(this.noiseModel.site, this.noiseAnswer), this.noiseAnswer, this.noiseModel.site);
  assert.equal(serialize(parse(observed)), serialize(parse(clean)));
});
Then('its answer records only the field removal', function(this: NoisePlanWorld) {
  assert.deepEqual(this.noiseAnswer.noiseEvents.map((event: { type: string }) => event.type), ['missing-field']);
});
Then('the removed field has an absent extraction location', function(this: NoisePlanWorld) {
  assert.equal(this.noiseAnswer.fieldStates.author, 'absent');
  assert.deepEqual(this.noiseAnswer.fieldLocations.author, { state: 'absent', reason: 'removed' });
});
