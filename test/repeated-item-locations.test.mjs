import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/site/config.mjs';
import { createModel } from '../src/site/model.mjs';
import { applyDataNoise } from '../src/noise/noise.mjs';
import { planRepeatedItemLocations } from '../src/answers/repeated-item-locations.mjs';
import { validateAnswerKey } from '../src/answers/answer-key.mjs';
import { buildTransportPlan } from '../src/noise/transport.mjs';
import { renderPage } from '../src/pages/renderers.mjs';

const schema = [
  { name: 'publicationDate', type: 'date', optional: false },
  { name: 'summary', type: 'text', optional: true },
  { name: 'title', type: 'title', optional: false },
];

function listing(template = 'listing-0') {
  return { pageId: 'listing-record-1', kind: 'listing', template,
    links: [{ href: '/records/1/' }, { href: '/records/2/' }],
    repeatedItems: [
      { pageId: 'record-1', url: '/records/1/', fields: { publicationDate: '2026-10-09', summary: '  First\nline  ', title: 'First' } },
      { pageId: 'record-2', url: '/records/2/', fields: { publicationDate: '2026-10-10', title: 'Second' } },
    ] };
}

function config(noise = { level: 'clean' }) {
  return validateConfig({ seed: 41, variation: { amount: 80 }, site: { id: 'repeated-locations', pageCount: 30 },
    contentTypes: [{ name: 'record', label: 'Records', fields: [
      { name: 'title', type: 'title' }, { name: 'publicationDate', type: 'date' },
      { name: 'summary', type: 'text', optional: true, presenceProbability: 0.5 },
      { name: 'coverImage', type: 'image', optional: true, presenceProbability: 0.5 },
    ] }], noise });
}

function answerFor(source, configuration) {
  return { ...source, pages: source.pages.map(page => applyDataNoise(page, source.site)),
    transport: buildTransportPlan(source.pages, { profile: configuration.transport.profile, seed: configuration.seed }) };
}

test('table and list locations follow rendered item order and explicit optional absence', () => {
  for (const [template, shell, tag] of [
    ['listing-0', 'directory', 'table'],
    ['listing-1', 'archive', 'table'],
    ['listing-1', 'journal', 'ul'],
    ['listing-2', 'civic', 'ul'],
  ]) {
    const locations = planRepeatedItemLocations(listing(template), { shell }, schema);
    const first = tag === 'table'
      ? '#content table.repeated-records > tbody > tr:nth-of-type(1) > td'
      : '#content ul.repeated-records > li:nth-of-type(1)';
    const second = first.replace('nth-of-type(1)', 'nth-of-type(2)');
    assert.deepEqual(locations[0], { pageId: 'record-1', url: '/records/1/', fieldLocations: {
      publicationDate: { state: 'present', selector: `${first} > p:nth-of-type(1)`, read: 'afterStrongLabel', label: 'Publication Date', precision: 'container' },
      summary: { state: 'present', selector: `${first} > p:nth-of-type(2)`, read: 'afterStrongLabel', label: 'Summary', precision: 'container' },
      title: { state: 'present', selector: `${first} > a`, read: 'textContent', precision: 'value' },
    } });
    assert.deepEqual(locations[1], { pageId: 'record-2', url: '/records/2/', fieldLocations: {
      publicationDate: { state: 'present', selector: `${second} > p:nth-of-type(1)`, read: 'afterStrongLabel', label: 'Publication Date', precision: 'container' },
      summary: { state: 'absent', reason: 'source-absent' },
      title: { state: 'present', selector: `${second} > a`, read: 'textContent', precision: 'value' },
    } });
  }
  assert.equal(planRepeatedItemLocations({ kind: 'listing' }, { shell: undefined }, undefined), undefined);
  assert.throws(() => planRepeatedItemLocations(listing(), { shell: undefined }, schema), /Unsupported repeated-item representation/);
  assert.throws(() => planRepeatedItemLocations(listing('listing-9'), { shell: 'directory' }, schema), /Unsupported repeated-item representation/);
  const broken = listing();
  delete broken.repeatedItems[0].fields.publicationDate;
  assert.throws(() => planRepeatedItemLocations(broken, { shell: 'directory' }, schema), /missing required field/);
});

test('new source locations exist before HTML and validation rejects changed plans', () => {
  const configuration = config();
  const source = createModel(configuration);
  assert.equal(source.generatorVersion, '1.9.0');
  assert.equal(source.fieldLocationVersion, 1);
  assert.equal(source.repeatedItemLocationVersion, 1);
  const listings = source.pages.filter(page => page.kind === 'listing');
  assert(listings.length > 0);
  assert(listings.every(page => page.repeatedItemLocations?.length === page.repeatedItems.length));
  assert(source.pages.filter(page => page.kind !== 'listing').every(page => page.repeatedItemLocations === undefined));
  assert(listings.flatMap(page => page.repeatedItemLocations).some(item => item.fieldLocations.summary.state === 'absent'));
  assert(listings.flatMap(page => page.repeatedItemLocations).some(item => item.fieldLocations.summary.state === 'present'));
  assert(!renderPage(source.site, listings[0]).includes('repeatedItemLocations'));
  const answer = answerFor(source, configuration);
  validateAnswerKey(source, answer, configuration);

  for (const mutate of [
    key => { delete key.repeatedItemLocationVersion; },
    key => { delete key.pages.find(page => page.kind === 'listing').repeatedItemLocations; },
    key => { key.pages.find(page => page.kind === 'listing').repeatedItemLocations[0].pageId = 'wrong-id'; },
    key => { key.pages.find(page => page.kind === 'listing').repeatedItemLocations.reverse(); },
    key => { key.pages.find(page => page.kind === 'listing').repeatedItemLocations[0].fieldLocations.title.selector = '#content a'; },
    key => {
      const entry = key.pages.flatMap(page => page.repeatedItemLocations ?? []).find(item => item.fieldLocations.summary.state === 'absent');
      entry.fieldLocations.summary = { state: 'present', selector: '#content p', read: 'textContent', precision: 'value' };
    },
  ]) {
    const changed = structuredClone(answer);
    mutate(changed);
    assert.throws(() => validateAnswerKey(source, changed, configuration), /Invalid answer key/);
  }
  const changedSource = structuredClone(source);
  changedSource.pages.find(page => page.kind === 'listing').repeatedItemLocations[0].url = '/wrong/';
  assert.throws(() => validateAnswerKey(changedSource, answer, configuration), /invalid source repeated-item locations/);
});

test('older keys need no repeated-item marker or locations', () => {
  const configuration = config();
  for (const version of ['1.0.0', '1.1.0', '1.2.0', '1.2.1']) {
    const source = createModel(configuration);
    source.generatorVersion = version;
    delete source.repeatedItemLocationVersion;
    for (const page of source.pages) delete page.repeatedItemLocations;
    if (['1.0.0', '1.1.0'].includes(version)) {
      delete source.fieldLocationVersion;
      for (const page of source.pages) delete page.fieldLocations;
    }
    if (version === '1.0.0') delete source.listingTruthVersion;
    validateAnswerKey(source, { ...structuredClone(source), transport: buildTransportPlan(source.pages) }, configuration);
  }
});

test('plain link-only listings do not invent repeated-item locations', () => {
  const configuration = validateConfig({ seed: 41, site: { id: 'plain-listing', pageCount: 10 },
    contentTypes: [{ name: 'record', label: 'Records', fields: [
      { name: 'title', type: 'title' }, { name: 'publicationDate', type: 'date' },
    ] }] });
  const source = createModel(configuration);
  for (const page of source.pages.filter(page => page.kind === 'listing')) {
    assert.equal(page.repeatedItems, undefined);
    assert.equal(page.repeatedItemLocations, undefined);
    assert(renderPage(source.site, page).includes('class="link-list"'));
  }
  validateAnswerKey(source, answerFor(source, configuration), configuration);
});

test('canonical listing values stay independently readable when detail date noise changes observed detail', () => {
  const configuration = config({ level: 'custom', probability: 1, severity: 1, maxPerPage: 1, types: ['date-format'] });
  const source = createModel(configuration);
  const answer = answerFor(source, configuration);
  validateAnswerKey(source, answer, configuration);
  const listingPage = answer.pages.find(page => page.kind === 'listing');
  const item = listingPage.repeatedItems[0];
  const detail = answer.pages.find(page => page.pageId === item.pageId);
  assert.notEqual(item.fields.publicationDate, detail.fields.publicationDate);
  assert(renderPage(answer.site, listingPage).includes(item.fields.publicationDate));
  assert.equal(listingPage.repeatedItemLocations[0].fieldLocations.publicationDate.state, 'present');
});
