import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import { analyzePage } from '../../src/page-analysis.mjs';
import { clusterPages } from '../../src/page-clusters.mjs';
import { validateConfig } from '../../src/config.mjs';
import { createModel } from '../../src/model.mjs';
import { renderPage } from '../../src/renderers.mjs';

interface HtmlWorld extends World {
  publicMarkup: string;
  sourceFields: Record<string, string>;
  observedHtml: ReturnType<typeof analyzePage>;
  recordsForClustering: ReturnType<typeof analyzePage>[];
  candidateClusters: ReturnType<typeof clusterPages>;
}

Given('a fictional record rendered with the {string} field layout', function(this: HtmlWorld, layout: string) {
  const config = validateConfig({ site: { id: 'bdd-layouts', pageCount: 12 }, contentTypes: [{ name: 'book', label: 'Books', fieldLayout: layout, fields: [{ name: 'title', type: 'title' }, { name: 'author', type: 'person' }, { name: 'publicationDate', type: 'date' }] }] });
  const model = createModel(config);
  const page = model.pages.find(record => record.contentType === 'book')!;
  this.sourceFields = structuredClone(page.fields);
  this.publicMarkup = renderPage(model.site, page);
});
When('the generic HTML analyzer reads the public markup', function(this: HtmlWorld) {
  this.observedHtml = analyzePage(this.publicMarkup, 'https://fiction.test/start/page.html');
});
Then('its observed fields match the separately constructed source record', function(this: HtmlWorld) {
  assert.deepEqual(this.observedHtml.fields, this.sourceFields);
});
Given('three public records with shared core fields and varying optional fields', function(this: HtmlWorld) {
  this.recordsForClustering = [
    '<dl><dt>Author</dt><dd>A</dd><dt>Published</dt><dd>2020</dd></dl>',
    '<table><tr><th>Author</th><td>B</td></tr><tr><th>Published</th><td>2021</td></tr><tr><th>Cover</th><td>cover.png</td></tr></table>',
    '<p><b>Author:</b> C</p><p><b>Published:</b> 2022</p><p><b>Subtitle:</b> Notes</p>',
  ].map((html, index) => analyzePage(`<main><h1>Record ${index}</h1>${html}</main>`, `https://fiction.test/${index}`));
});
When('the generic candidate clusters those public records', function(this: HtmlWorld) {
  this.candidateClusters = clusterPages(this.recordsForClustering);
});
Then('all three records belong to one predicted cluster', function(this: HtmlWorld) {
  assert.equal(this.candidateClusters.pages.length, 3);
  assert.equal(this.candidateClusters.clusters.length, 1);
});
Given('an HTML page with a relative link and an archive base URL', function(this: HtmlWorld) {
  this.publicMarkup = '<base href="/archive/"><a href="record.html">Record</a>';
});
Then('the discovered link points into the archive directory', function(this: HtmlWorld) {
  assert.deepEqual(this.observedHtml.links, ['https://fiction.test/archive/record.html']);
});
