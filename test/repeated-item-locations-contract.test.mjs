import test from 'node:test';
import assert from 'node:assert/strict';
import { planRepeatedItemLocations } from '../src/repeated-item-locations.mjs';

const schema = [
  { name: 'summary', optional: true },
  { name: 'title' },
  { name: 'publicationDate' },
  { name: 'source__ID', optional: true },
];

function listing(template = 'listing-1') {
  return {
    pageId: 'listing-records', kind: 'listing', template,
    links: [{ href: '/records/second/' }, { href: '/records/first/' }],
    repeatedItems: [
      { pageId: 'record-second', url: '/records/second/', fields: {
        title: 'Second', publicationDate: '2026-10-10', source__ID: 'B-2', summary: 'Second summary',
      } },
      { pageId: 'record-first', url: '/records/first/', fields: {
        title: 'First', summary: 'First summary', publicationDate: '2026-10-09',
      } },
    ],
  };
}

test('journal list selectors preserve source item order and field insertion positions', () => {
  assert.deepEqual(planRepeatedItemLocations(listing(), { shell: 'journal' }, schema), [
    { pageId: 'record-second', url: '/records/second/', fieldLocations: {
      summary: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > p:nth-of-type(3)', read: 'afterStrongLabel', label: 'Summary', precision: 'container' },
      title: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > a', read: 'textContent', precision: 'value' },
      publicationDate: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > p:nth-of-type(1)', read: 'afterStrongLabel', label: 'Publication Date', precision: 'container' },
      source__ID: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > p:nth-of-type(2)', read: 'afterStrongLabel', label: 'Source ID', precision: 'container' },
    } },
    { pageId: 'record-first', url: '/records/first/', fieldLocations: {
      summary: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(2) > p:nth-of-type(1)', read: 'afterStrongLabel', label: 'Summary', precision: 'container' },
      title: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(2) > a', read: 'textContent', precision: 'value' },
      publicationDate: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(2) > p:nth-of-type(2)', read: 'afterStrongLabel', label: 'Publication Date', precision: 'container' },
      source__ID: { state: 'absent', reason: 'source-absent' },
    } },
  ]);
});

test('listing-0 and archive shell select table cells; other supported shells select list items', () => {
  for (const [template, shell] of [['listing-0', 'directory'], ['listing-2', 'archive']]) {
    const page = listing(template);
    page.repeatedItems = [page.repeatedItems[1]];
    assert.deepEqual(planRepeatedItemLocations(page, { shell }, schema), [
      { pageId: 'record-first', url: '/records/first/', fieldLocations: {
        summary: { state: 'present', selector: '#content table.repeated-records > tbody > tr:nth-of-type(1) > td > p:nth-of-type(1)', read: 'afterStrongLabel', label: 'Summary', precision: 'container' },
        title: { state: 'present', selector: '#content table.repeated-records > tbody > tr:nth-of-type(1) > td > a', read: 'textContent', precision: 'value' },
        publicationDate: { state: 'present', selector: '#content table.repeated-records > tbody > tr:nth-of-type(1) > td > p:nth-of-type(2)', read: 'afterStrongLabel', label: 'Publication Date', precision: 'container' },
        source__ID: { state: 'absent', reason: 'source-absent' },
      } },
    ]);
  }
  const page = listing('listing-2');
  page.repeatedItems = [page.repeatedItems[1]];
  assert.deepEqual(planRepeatedItemLocations(page, { shell: 'civic' }, schema), [
    { pageId: 'record-first', url: '/records/first/', fieldLocations: {
      summary: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > p:nth-of-type(1)', read: 'afterStrongLabel', label: 'Summary', precision: 'container' },
      title: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > a', read: 'textContent', precision: 'value' },
      publicationDate: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > p:nth-of-type(2)', read: 'afterStrongLabel', label: 'Publication Date', precision: 'container' },
      source__ID: { state: 'absent', reason: 'source-absent' },
    } },
  ]);
});

test('optional absence has no selector and does not consume a scalar position', () => {
  const page = listing();
  page.repeatedItems = [{ pageId: 'record-first', url: '/records/first/', fields: {
    title: 'First', publicationDate: '2026-10-09',
  } }];
  assert.deepEqual(planRepeatedItemLocations(page, { shell: 'journal' }, schema), [
    { pageId: 'record-first', url: '/records/first/', fieldLocations: {
      summary: { state: 'absent', reason: 'source-absent' },
      title: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > a', read: 'textContent', precision: 'value' },
      publicationDate: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > p:nth-of-type(1)', read: 'afterStrongLabel', label: 'Publication Date', precision: 'container' },
      source__ID: { state: 'absent', reason: 'source-absent' },
    } },
  ]);
});

test('hyphenated keys and camel case receive exact labels', () => {
  const page = listing();
  page.repeatedItems = [{ pageId: 'record-first', url: '/records/first/', fields: {
    title: 'First', 'external-ID': 'A-1', publicationDate: '2026-10-09',
  } }];
  assert.deepEqual(planRepeatedItemLocations(page, { shell: 'journal' }, [
    { name: 'title' }, { name: 'external-ID' }, { name: 'publicationDate' },
  ]), [
    { pageId: 'record-first', url: '/records/first/', fieldLocations: {
      title: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > a', read: 'textContent', precision: 'value' },
      'external-ID': { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > p:nth-of-type(1)', read: 'afterStrongLabel', label: 'External ID', precision: 'container' },
      publicationDate: { state: 'present', selector: '#content ul.repeated-records > li:nth-of-type(1) > p:nth-of-type(2)', read: 'afterStrongLabel', label: 'Publication Date', precision: 'container' },
    } },
  ]);
});

test('pages without repeated items have no repeated-item plan', () => {
  assert.equal(planRepeatedItemLocations({ pageId: 'plain', kind: 'detail' }, {}, undefined), undefined);
});

test('invalid listing representation is rejected with the listing identity', () => {
  for (const mutate of [
    page => { page.kind = 'detail'; },
    page => { page.template = 'listing-3'; },
    page => { page.template = 'listing-01'; },
    page => { page.template = 'prefix-listing-1'; },
    page => { page.repeatedItems = {}; },
    page => { page.repeatedItems = []; },
  ]) {
    const page = listing();
    mutate(page);
    assert.throws(() => planRepeatedItemLocations(page, { shell: 'journal' }, schema),
      { message: 'Unsupported repeated-item representation on listing-records' });
  }
  assert.throws(() => planRepeatedItemLocations(listing(), {}, schema),
    { message: 'Unsupported repeated-item representation on listing-records' });
  assert.throws(() => planRepeatedItemLocations(listing(), { shell: 'journal' }, {}),
    { message: 'Unsupported repeated-item representation on listing-records' });
  assert.throws(() => planRepeatedItemLocations(listing(), { shell: 'journal' }, [{ name: 'summary' }]),
    { message: 'Unsupported repeated-item representation on listing-records' });
});

test('every repeated item needs an exact rendered link', () => {
  const page = listing();
  page.links = [{ href: '/records/first/' }, { href: '/records/second' }];
  assert.throws(() => planRepeatedItemLocations(page, { shell: 'journal' }, schema),
    { message: 'Repeated item record-second has no rendered link on listing-records' });
  page.links = [{ href: '/records/second/' }];
  assert.throws(() => planRepeatedItemLocations(page, { shell: 'journal' }, schema),
    { message: 'Repeated item record-first has no rendered link on listing-records' });
});

test('missing required title or scalar field is rejected by item identity', () => {
  const page = listing();
  delete page.repeatedItems[1].fields.title;
  assert.throws(() => planRepeatedItemLocations(page, { shell: 'journal' }, schema),
    { message: 'Repeated item record-first is missing required field title' });
  page.repeatedItems[1].fields.title = 'First';
  delete page.repeatedItems[1].fields.publicationDate;
  assert.throws(() => planRepeatedItemLocations(page, { shell: 'journal' }, schema),
    { message: 'Repeated item record-first is missing required field publicationDate' });
});
