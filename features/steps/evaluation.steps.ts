import assert from 'node:assert/strict';
import { Given, Then, When, type World } from '@cucumber/cucumber';
import { evaluate } from '../../src/evaluator.mjs';

function goldPage(url: string, cluster: string) {
  return { url, pageId: url, expectedCluster: cluster, contentType: cluster, fields: { title: url }, canonicalValues: { title: url }, fieldStates: { title: 'present' }, relationships: [], noiseEvents: [] };
}
function gold() {
  return { version: 1, site: { id: 'bdd', baseUrl: 'https://fictional.test', framework: 'html', noise: {} }, pages: ['B1', 'B2', 'B3', 'A1', 'A2', 'L1'].map((name, index) => goldPage(`/${name}`, index < 3 ? 'book' : index < 5 ? 'author' : 'listing')) };
}
interface EvaluationWorld extends World {
  truth: ReturnType<typeof gold>;
  original: ReturnType<typeof gold>;
  score: ReturnType<typeof evaluate>;
}
Given('known groups of three books two authors and one listing', function(this: EvaluationWorld) {
  this.truth = gold();
});
When('the candidate returns the {string} grouping', function(this: EvaluationWorld, partition: string) {
  const labels: Record<string, string[]> = { renamed: ['x', 'x', 'x', 'y', 'y', 'z'], split: ['x', 'x', 'w', 'y', 'y', 'z'], merged: ['x', 'x', 'x', 'x', 'x', 'z'] };
  assert.ok(labels[partition]);
  this.score = evaluate(this.truth, { version: 1, pages: this.truth.pages.map((page, index) => ({ url: page.url, cluster: labels[partition][index] })) });
});
Then('there are {int} true positive pairs {int} false positive pairs and {int} false negative pairs', function(this: EvaluationWorld, tp: number, fp: number, fn: number) {
  const pairs = this.score.clustering.allExpected.pairs;
  assert.equal(pairs.truePositive, tp);
  assert.equal(pairs.falsePositive, fp);
  assert.equal(pairs.falseNegative, fn);
  assert.equal(pairs.f1, 2 * tp / (2 * tp + fp + fn));
});
Then('all six expected pages are accounted for', function(this: EvaluationWorld) {
  assert.equal(this.score.coverage.recall, 1);
});
When('the candidate omits one book', function(this: EvaluationWorld) {
  this.score = evaluate(this.truth, { version: 1, pages: this.truth.pages.filter(page => page.url !== '/B3').map(page => ({ url: page.url, cluster: page.expectedCluster })) });
});
Then('coverage is five out of six even if observed grouping is correct', function(this: EvaluationWorld) {
  assert.equal(this.score.coverage.recall, 5 / 6);
  assert.equal(this.score.clustering.observedOnly.pairs.f1, 1);
  assert.equal(this.score.coverage.missing, 1);
});
Given('a book answer with an absent optional cover', function(this: EvaluationWorld) {
  this.truth = { ...gold(), pages: [goldPage('/B1', 'book')] };
  Object.assign(this.truth.pages[0].fieldStates, { coverImage: 'absent' });
  this.original = structuredClone(this.truth);
});
When('the candidate invents a cover image value', function(this: EvaluationWorld) {
  this.score = evaluate(this.truth, { version: 1, pages: [{ url: '/B1', cluster: 'anything', fields: { title: '/B1', coverImage: '/invented-cover.png' } }] });
});
Then('the invented cover is a false positive', function(this: EvaluationWorld) {
  assert.equal(this.score.fields.pagePresence!.falsePositive, 1);
  assert.equal(this.score.fields.values!.falsePositive, 1);
});
Then('the private answer remains unchanged', function(this: EvaluationWorld) {
  assert.deepEqual(this.truth, this.original);
});
Given('the listing page lists the three books as records', function(this: EvaluationWorld) {
  this.truth = gold();
  const listing = this.truth.pages.find(page => page.url === '/L1')!;
  Object.assign(listing, { repeatedItems: ['B1', 'B2', 'B3'].map(name => ({ pageId: name, url: `/${name}`, fields: { title: `/${name}` } })) });
});
When('the candidate reports {string} listing records', function(this: EvaluationWorld, records: string) {
  const record = (name: string) => ({ url: `/${name}`, fields: { title: `/${name}` } });
  const listed = { 'all three by link': ['B1', 'B2', 'B3'].map(record), 'two by link': ['B1', 'B2'].map(record),
    'three plus one on a book': ['B1', 'B2', 'B3'].map(record), 'one unrelated without link': [{ fields: { title: 'Unrelated' } }] }[records]!;
  const pages: { url: string; cluster: string; repeatedItems?: unknown[] }[] = [{ url: '/L1', cluster: 'list', repeatedItems: listed }, { url: '/B1', cluster: 'book' }];
  if (records === 'three plus one on a book') pages[1].repeatedItems = [record('A1')];
  this.score = evaluate(this.truth, { version: 1, pages } as Parameters<typeof evaluate>[1]);
});
Then('listing records score {int} found {int} extra and {int} missed', function(this: EvaluationWorld, tp: number, fp: number, fn: number) {
  const items = this.score.repeatedItems!.items!;
  assert.deepEqual([items.truePositive, items.falsePositive, items.falseNegative], [tp, fp, fn]);
});
