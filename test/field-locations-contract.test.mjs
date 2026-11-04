import test from 'node:test';
import assert from 'node:assert/strict';
import { planFieldLocations } from '../src/answers/field-locations.mjs';

const present = (selector, read = 'textContent', precision = 'value') => ({
  state: 'present', selector, read, precision,
});

function detail(layout = 'definition-list') {
  return {
    kind: 'detail', fieldLayout: layout,
    fields: { title: 'Record', author: 'Ada', publicationDate: '2026-10-09', body: '  Literal & text.  ', coverImage: '/assets/collection.png' },
    canonicalValues: { title: 'Record', author: 'Ada', publicationDate: '2026-10-09', body: '  Literal & text.  ', coverImage: '/assets/collection.png' },
    fieldStates: { title: 'present', author: 'present', publicationDate: 'present', body: 'present', coverImage: 'present' },
    fieldSelectors: { coverImage: 'img[data-field="coverImage"]' }, noiseEvents: [],
  };
}

test('definition-list locations use exact value nodes in declared scalar order, ignoring image placement', () => {
  assert.deepEqual(planFieldLocations(detail()), {
    title: present('#content > .page-heading > h1'),
    author: present('#content dl.field-list > dd:nth-of-type(1)'),
    publicationDate: present('#content dl.field-list > dd:nth-of-type(2)'),
    body: present('#content dl.field-list > dd:nth-of-type(3)'),
    coverImage: present('#content img[data-field="coverImage"]', 'urlPath'),
  });
});

test('reordered fields reverse scalar positions but do not move title or image locations', () => {
  const page = detail('table');
  page.noiseEvents = [{ type: 'reorder-fields' }];
  assert.deepEqual(planFieldLocations(page), {
    title: present('#content > .page-heading > h1'),
    author: present('#content table.field-list > tbody > tr:nth-of-type(3) > td'),
    publicationDate: present('#content table.field-list > tbody > tr:nth-of-type(2) > td'),
    body: present('#content table.field-list > tbody > tr:nth-of-type(1) > td'),
    coverImage: present('#content img[data-field="coverImage"]', 'urlPath'),
  });
});

test('missing optional and removed required fields have distinct absence reasons and no selector', () => {
  const page = detail('table');
  delete page.fields.body;
  delete page.canonicalValues.body;
  delete page.fields.publicationDate;
  page.fieldStates.body = 'absent';
  page.fieldStates.publicationDate = 'absent';
  assert.deepEqual(planFieldLocations(page), {
    title: present('#content > .page-heading > h1'),
    author: present('#content table.field-list > tbody > tr:nth-of-type(1) > td'),
    publicationDate: { state: 'absent', reason: 'removed' },
    body: { state: 'absent', reason: 'source-absent' },
    coverImage: present('#content img[data-field="coverImage"]', 'urlPath'),
  });
});

test('paragraph locations name their container extraction and exact generated or overridden labels', () => {
  const page = detail('paragraphs');
  page.fieldLabels = { author: "Editor's: author" };
  page.fields.source__ID = 'X-42';
  page.canonicalValues.source__ID = 'X-42';
  page.fieldStates.source__ID = 'present';
  assert.deepEqual(planFieldLocations(page), {
    title: present('#content > .page-heading > h1'),
    author: { ...present('#content section.field-list > p:nth-of-type(1)', 'afterLabel', 'container'), label: "Editor's: author" },
    publicationDate: { ...present('#content section.field-list > p:nth-of-type(2)', 'afterLabel', 'container'), label: 'Publication Date' },
    body: { ...present('#content section.field-list > p:nth-of-type(3)', 'afterLabel', 'container'), label: 'Body' },
    coverImage: present('#content img[data-field="coverImage"]', 'urlPath'),
    source__ID: { ...present('#content section.field-list > p:nth-of-type(4)', 'afterLabel', 'container'), label: 'Source ID' },
  });
});

test('home summary selects the heading lede, not the duplicate field-list value', () => {
  const page = { kind: 'home', fields: { title: 'Archive', summary: 'Overview', curator: 'Ada' },
    canonicalValues: { title: 'Archive', summary: 'Overview', curator: 'Ada' },
    fieldStates: { title: 'present', summary: 'present', curator: 'present' }, noiseEvents: [] };
  assert.deepEqual(planFieldLocations(page), {
    title: present('#content > .page-heading > h1'),
    summary: present('#content > .page-heading > p.lede'),
    curator: present('#content dl.field-list > dd:nth-of-type(2)'),
  });
});

test('a detail summary is an ordinary scalar, and unrelated noise does not reorder it', () => {
  const page = { kind: 'detail', fieldLayout: 'paragraphs',
    fields: { title: 'Record', author: 'Ada', summary: 'A summary' },
    canonicalValues: { title: 'Record', author: 'Ada', summary: 'A summary' },
    fieldStates: { title: 'present', author: 'present', summary: 'present' },
    noiseEvents: [{ type: 'duplicate-id' }] };
  assert.deepEqual(planFieldLocations(page), {
    title: present('#content > .page-heading > h1'),
    author: { ...present('#content section.field-list > p:nth-of-type(1)', 'afterLabel', 'container'), label: 'Author' },
    summary: { ...present('#content section.field-list > p:nth-of-type(2)', 'afterLabel', 'container'), label: 'Summary' },
  });
  delete page.noiseEvents;
  assert.deepEqual(planFieldLocations(page).summary,
    { ...present('#content section.field-list > p:nth-of-type(2)', 'afterLabel', 'container'), label: 'Summary' });
});

test('default definition-list and unsupported layout states are explicit', () => {
  const page = detail();
  delete page.fieldLayout;
  assert.deepEqual(planFieldLocations(page).author, present('#content dl.field-list > dd:nth-of-type(1)'));
  page.fieldLayout = 'cards';
  assert.deepEqual(planFieldLocations(page).author, { state: 'ambiguous', reason: 'unsupported-field-layout' });
});
