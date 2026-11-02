import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import { validateConfig } from '../../src/config.mjs';
import { createModel } from '../../src/model.mjs';

type Location = { state: string; selector?: string; read?: string; label?: string; precision?: string; reason?: string };
interface LocationWorld extends World {
  locationLayout: string;
  locations: Record<string, Location>;
}

Given('a source library using {string} field markup', function(this: LocationWorld, layout: string) {
  this.locationLayout = layout;
});

When('the source records are constructed without rendering HTML', function(this: LocationWorld) {
  const source = createModel(validateConfig({ seed: 27, site: { id: 'source-locations', pageCount: 5 },
    contentTypes: [{ name: 'book', label: 'Books', fieldLayout: this.locationLayout, fields: [
      { name: 'title', type: 'title' }, { name: 'author', type: 'person' },
      { name: 'coverImage', type: 'image', optional: true, presenceProbability: 0 },
    ] }], noise: { level: 'clean' } }));
  assert.equal(source.fieldLocationVersion, 1);
  const book = source.pages.find(page => page.contentType === 'book');
  assert(book);
  this.locations = (book as typeof book & { fieldLocations: Record<string, Location> }).fieldLocations;
});

Then('the title location selects the page heading', function(this: LocationWorld) {
  assert.deepEqual(this.locations.title, { state: 'present', selector: '#content > .page-heading > h1', read: 'textContent', precision: 'value' });
});

Then('the author location uses {string} on {string}', function(this: LocationWorld, read: string, selector: string) {
  assert.deepEqual(this.locations.author, { state: 'present', selector, read,
    ...(read === 'afterLabel' ? { label: 'Author', precision: 'container' } : { precision: 'value' }) });
});

Then('an optional cover absent at source has no extraction selector', function(this: LocationWorld) {
  assert.deepEqual(this.locations.coverImage, { state: 'absent', reason: 'source-absent' });
});
