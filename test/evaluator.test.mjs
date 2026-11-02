import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluate, writeReports } from '../src/evaluator.mjs';

function truthPage(url, cluster, fields = { title: url }, extra = {}) {
  return {
    url, pageId: url, expectedCluster: cluster, contentType: 'article', fields,
    canonicalValues: { ...fields },
    fieldStates: Object.fromEntries(Object.keys(fields).map((key) => [key, 'present'])),
    relationships: [], noiseEvents: [], ...extra,
  };
}

function actualPage(url, cluster, extra = {}) {
  return { url, cluster, ...extra };
}

function fixture(pages, extra = {}) {
  return {
    version: 1,
    site: { id: 'site', baseUrl: 'https://example.test/', framework: 'html', noise: {} },
    pages,
    ...extra,
  };
}

test('perfect clustering is label-invariant and reports optional capabilities', () => {
  const truth = fixture([
    truthPage('/a', 'template-1'), truthPage('/b', 'template-1'),
    truthPage('/c', 'template-2'), truthPage('/d', 'template-2'),
  ]);
  const actual = { version: 1, pages: [
    actualPage('/a#top', 'blue'), actualPage('/b', 'blue'),
    actualPage('/c', 'red'), actualPage('/d', 'red'),
  ] };
  const report = evaluate(truth, actual);
  assert.equal(report.coverage.recall, 1);
  assert.equal(report.clustering.allExpected.pairs.f1, 1);
  assert.equal(report.clustering.allExpected.adjustedRandIndex, 1);
  assert.equal(report.contentType.availability, 'unavailable');
  assert.equal(report.contentType.accuracy, null);
  assert.equal(report.fields.availability, 'unavailable');
  assert.equal(report.fields.values, null);
});

test('split and merge errors are visible without relying on label mapping', () => {
  const splitTruth = fixture([truthPage('/a', 'x'), truthPage('/b', 'x'), truthPage('/c', 'x')]);
  const split = evaluate(splitTruth, { version: 1, pages: [actualPage('/a', '1'), actualPage('/b', '1'), actualPage('/c', '2')] });
  assert.deepEqual(
    split.clustering.allExpected.pairs,
    { truePositive: 1, falsePositive: 0, falseNegative: 2, precision: 1, recall: 1 / 3, f1: 0.5, expectedPositive: 3, predictedPositive: 1 },
  );

  const mergeTruth = fixture([
    truthPage('/a', 'x'), truthPage('/b', 'x'), truthPage('/c', 'y'), truthPage('/d', 'y'),
  ]);
  const merge = evaluate(mergeTruth, { version: 1, pages: mergeTruth.pages.map((page) => actualPage(page.url, 'one')) });
  assert.equal(merge.clustering.allExpected.pairs.precision, 1 / 3);
  assert.equal(merge.clustering.allExpected.pairs.recall, 1);
  assert.equal(merge.clustering.bestOverlapMapping.length, 1);
});

test('missing pages are unique singletons in all-expected metrics and excluded observed-only', () => {
  const truth = fixture([truthPage('/a', 'x'), truthPage('/b', 'x'), truthPage('/c', 'x')]);
  const report = evaluate(truth, { version: 1, pages: [actualPage('/a', 'one'), actualPage('/b', 'one')] });
  assert.equal(report.coverage.missing, 1);
  assert.equal(report.clustering.allExpected.pages, 3);
  assert.equal(report.clustering.allExpected.pairs.recall, 1 / 3);
  assert.equal(report.clustering.observedOnly.pages, 2);
  assert.equal(report.clustering.observedOnly.pairs.f1, 1);
  assert.match(report.clustering.allExpected.population, /unique predicted singleton/);
});

test('unexpected pages count once and use actual-page denominator', () => {
  const report = evaluate(
    fixture([truthPage('/a', 'x')]),
    { version: 1, pages: [actualPage('/a', 'x'), actualPage('https://other.test/a', 'z')] },
  );
  assert.equal(report.coverage.unexpected, 1);
  assert.equal(report.coverage.unexpectedPageRate, 0.5);
  assert.deepEqual(report.coverage.unexpectedUrls, ['https://other.test/a']);
});

test('field presence and values use micro denominators and penalize absent-field hallucinations', () => {
  const truth = fixture([
    truthPage('/a', 'x', { title: 'Café', author: 'Ada' }, {
      canonicalValues: { title: 'Café', author: 'Ada', secret: 'hidden' },
      fieldStates: { title: 'present', author: 'present', secret: 'absent' },
    }),
  ]);
  const actual = { version: 1, pages: [actualPage('/a', 'x', {
    fields: { title: '  Cafe\u0301  ', author: 'Wrong', secret: 'hidden' },
  })] };
  const report = evaluate(truth, actual);
  assert.deepEqual(report.fields.pagePresence, {
    truePositive: 2, falsePositive: 1, falseNegative: 0, precision: 2 / 3, recall: 1, f1: 0.8,
  });
  assert.deepEqual(report.fields.values, {
    truePositive: 1, falsePositive: 2, falseNegative: 1, precision: 1 / 3, recall: 0.5, f1: 0.4,
  });
});

test('field capability can be partial and empty payloads are scored', () => {
  const truth = fixture([truthPage('/a', 'x', { title: 'A' }), truthPage('/b', 'x', { title: 'B' })]);
  const report = evaluate(truth, { version: 1, pages: [
    actualPage('/a', 'x', { fields: {} }), actualPage('/b', 'x'),
  ] });
  assert.equal(report.fields.availability, 'partial');
  assert.deepEqual(report.fields.pageCoverage, { eligiblePages: 2, providedPages: 1, recall: 0.5 });
  assert.equal(report.fields.pagePresence.falseNegative, 1);
  assert.equal(report.fields.pagePresence.precision, null);
  assert.equal(report.fields.pagePresence.f1, 0);
});

test('content types require explicit labels/map and are never inferred from clusters', () => {
  const truth = fixture([truthPage('/a', 'x'), truthPage('/b', 'y')]);
  const unmapped = evaluate(truth, { version: 1, pages: [
    actualPage('/a', 'article', { contentType: 'story' }), actualPage('/b', 'article'),
  ] });
  assert.equal(unmapped.contentType.availability, 'partial');
  assert.equal(unmapped.contentType.accuracy, 0);
  const mapped = evaluate(truth, { version: 1, pages: [actualPage('/a', 'anything', { contentType: 'story' })] }, {
    contentTypeMap: { story: 'article' },
  });
  assert.equal(mapped.contentType.accuracy, 1);
});

test('schema scoring is optional and supports field aliases', () => {
  const truth = fixture([truthPage('/a', 'x')], { schemas: { article: ['title', 'publicationDate'] } });
  const unavailable = evaluate(truth, { version: 1, pages: [actualPage('/a', 'x')] });
  assert.equal(unavailable.fields.schemaPresence.availability, 'unavailable');
  const available = evaluate(truth, {
    version: 1, pages: [actualPage('/a', 'x')], schemas: { story: ['headline', 'publicationDate'] },
  }, { contentTypeMap: { story: 'article' }, fieldNameMap: { article: { headline: 'title' } } });
  assert.equal(available.fields.schemaPresence.presence.f1, 1);
});

test('date normalization is opt-in while whitespace and NFC normalization are default', () => {
  const truth = fixture([truthPage('/a', 'x', { published: '2020-01-01', title: 'A B' })]);
  const actual = { version: 1, pages: [actualPage('/a', 'x', { fields: { published: 'January 1, 2020', title: ' A\n B ' } })] };
  assert.equal(evaluate(truth, actual).fields.values.truePositive, 1);
  assert.equal(evaluate(truth, actual, { dateFields: ['published'] }).fields.values.f1, 1);
  const ambiguous = { version: 1, pages: [actualPage('/a', 'x', { fields: { published: '01/01/2020', title: 'A B' } })] };
  assert.equal(evaluate(truth, ambiguous, { dateFields: ['published'] }).fields.values.truePositive, 1);
  assert.equal(evaluate(truth, ambiguous, { dateFields: ['published'] }).fields.values.falseNegative, 1);
  const invalid = { version: 1, pages: [actualPage('/a', 'x', { fields: { published: '2020-02-30', title: 'A B' } })] };
  assert.equal(evaluate(truth, invalid, { dateFields: ['published'] }).fields.values.falseNegative, 1);
  // Generator 1.9.0 date pool: unambiguous month-name forms normalize; numeric, month-only and wrong weekdays do not.
  const score = published => evaluate(truth, { version: 1, pages: [actualPage('/a', 'x', { fields: { published, title: 'A B' } })] }, { dateFields: ['published'] }).fields.values.falseNegative;
  for (const ok of ['Jan. 1, 2020', '1 January 2020', 'Wednesday, January 1, 2020', 'Jan 1, 2020', '1 Jan. 2020']) assert.equal(score(ok), 0, ok);
  for (const bad of ['Monday, January 1, 2020', '1.1.2020', 'January 2020', '31 February 2020', 'Smarch 1, 2020']) assert.equal(score(bad), 1, bad);
});

test('relationship tuples are normalized and scored as an optional capability', () => {
  const truth = fixture([
    truthPage('/a', 'x', {}, { relationships: [{ type: 'related', targetUrl: '/b#truth' }] }),
    truthPage('/b', 'x', {}),
  ]);
  const unavailable = evaluate(truth, { version: 1, pages: [actualPage('/a', 'x'), actualPage('/b', 'x')] });
  assert.equal(unavailable.relationships.availability, 'unavailable');
  assert.equal(unavailable.relationships.score, null);
  const perfect = evaluate(truth, { version: 1, pages: [
    actualPage('/a', 'x', { relationships: [{ type: 'related', targetUrl: 'https://example.test/b#actual' }] }),
    actualPage('/b', 'x', { relationships: [] }),
  ] });
  assert.equal(perfect.relationships.availability, 'available');
  assert.equal(perfect.relationships.score.f1, 1);
  const wrong = evaluate(truth, { version: 1, pages: [
    actualPage('/a', 'x', { relationships: [{ type: 'related', targetUrl: '/other' }] }),
    actualPage('/b', 'x'),
  ] });
  assert.equal(wrong.relationships.availability, 'partial');
  assert.deepEqual(wrong.relationships.score, {
    truePositive: 0, falsePositive: 1, falseNegative: 1, precision: 0, recall: 0, f1: 0,
  });
});

test('duplicate normalized relationships are rejected', () => {
  const truth = fixture([truthPage('/a', 'x', {})]);
  assert.throws(() => evaluate(truth, { version: 1, pages: [actualPage('/a', 'x', { relationships: [
    { type: 'next', targetUrl: '/b#one' }, { type: 'next', targetUrl: '/b#two' },
  ] })] }), /duplicate normalized relationship/);
  const duplicateTruth = fixture([truthPage('/a', 'x', {}, { relationships: [
    { type: 'next', targetUrl: '/b#one' }, { type: 'next', targetUrl: '/b#two' },
  ] })]);
  assert.throws(() => evaluate(duplicateTruth, { version: 1, pages: [] }), /duplicate normalized relationship/);
});

test('URL normalization removes fragments but preserves path case and semantic query', () => {
  const truth = fixture([truthPage('/News?edition=US#truth', 'x')]);
  const match = evaluate(truth, { version: 1, pages: [actualPage('https://example.test/News?edition=US#actual', 'x')] });
  assert.equal(match.coverage.recall, 1);
  const mismatch = evaluate(truth, { version: 1, pages: [actualPage('/news?edition=us', 'x')] });
  assert.equal(mismatch.coverage.recall, 0);
  assert.equal(mismatch.coverage.unexpected, 1);
  const configured = evaluate(truth, { version: 1, pages: [actualPage('/News?edition=CA', 'x')] }, { dropQueryParams: true });
  assert.equal(configured.coverage.recall, 1);
});

test('explicit datetime offsets normalize to the same instant', () => {
  const truth = fixture([truthPage('/a','x',{published:'2026-09-24T12:00:00Z'})]);
  const actual = {version:1,pages:[actualPage('/a','y',{fields:{published:'2026-09-24T08:00:00-04:00'}})]};
  assert.equal(evaluate(truth,actual,{dateFields:['published']}).fields.values.f1,1);
  actual.pages[0].fields.published='2026-09-24T08:00:00';
  assert.equal(evaluate(truth,actual,{dateFields:['published']}).fields.values.f1,0);
});

test('duplicate normalized URLs and field alias collisions are rejected', () => {
  const truth = fixture([truthPage('/a', 'x')]);
  assert.throws(() => evaluate(truth, { version: 1, pages: [actualPage('/a#one', 'x'), actualPage('/a#two', 'y')] }), /duplicate normalized URL/);
  assert.throws(() => evaluate(fixture([truthPage('/a#one', 'x'), truthPage('/a#two', 'y')]), { version: 1, pages: [] }), /duplicate normalized URL/);
  assert.throws(() => evaluate(truth, { version: 1, pages: [actualPage('/a', 'x', { fields: { headline: 'A', title: 'A' } })] }, {
    fieldNameMap: { headline: 'title' },
  }), /field-name alias collision/);
});

test('malformed required input throws useful paths', () => {
  assert.throws(() => evaluate({}, { version: 1, pages: [] }), /truth.version/);
  assert.throws(() => evaluate(fixture([]), { version: 1, pages: [{ url: '/a' }] }), /actual.pages\[0\]\.cluster/);
  assert.throws(() => evaluate(fixture([truthPage('http://[bad', 'x')]), { version: 1, pages: [] }), /truth.pages\[0\]\.url/);
  const contradictory = truthPage('/a', 'x');
  contradictory.fieldStates.title = 'absent';
  assert.throws(() => evaluate(fixture([contradictory]), { version: 1, pages: [] }), /field marked absent/);
});

test('empty and singleton datasets have explicit degenerate metrics', () => {
  const empty = evaluate(fixture([]), { version: 1, pages: [] });
  assert.equal(empty.coverage.recall, null);
  assert.equal(empty.coverage.unexpectedPageRate, null);
  assert.equal(empty.clustering.allExpected.adjustedRandIndex, 1);
  assert.equal(empty.clustering.allExpected.pairs.f1, null);
  const singleton = evaluate(fixture([truthPage('/a', 'x')]), { version: 1, pages: [actualPage('/a', 'z')] });
  assert.equal(singleton.clustering.allExpected.adjustedRandIndex, 1);
  assert.match(singleton.clustering.allExpected.notes.join(' '), /fewer than two/);
  const nonsingle = fixture([truthPage('/a', 'x'), truthPage('/b', 'x')]);
  const singletonPredictions = evaluate(nonsingle, { version: 1, pages: [actualPage('/a', '1'), actualPage('/b', '2')] });
  assert.equal(singletonPredictions.clustering.allExpected.pairs.precision, null);
  assert.equal(singletonPredictions.clustering.allExpected.pairs.recall, 0);
  assert.equal(singletonPredictions.clustering.allExpected.pairs.f1, 0);
});

test('breakdowns include content type, clean/noisy, and each noise type', () => {
  const truth = fixture([
    truthPage('/a', 'x', {}, { contentType: 'article' }),
    truthPage('/b', 'y', {}, { contentType: 'profile', noiseEvents: [
      { type: 'missing-field', severity: 1, preservesSemantics: false },
      { type: 'label-variation', severity: 1, preservesSemantics: true },
    ] }),
  ]);
  const report = evaluate(truth, { version: 1, pages: [actualPage('/a', '1'), actualPage('/b', '2')] });
  assert.deepEqual(Object.keys(report.breakdowns.byContentType), ['article', 'profile']);
  assert.equal(report.breakdowns.byNoiseStatus.clean.pages, 1);
  assert.equal(report.breakdowns.byNoiseStatus.noisy.pages, 1);
  assert.equal(report.breakdowns.byNoiseType['missing-field'].pages, 1);
  assert.equal(report.breakdowns.byNoiseTypeAndSeverity['missing-field']['1'].pages, 1);
});

test('diagnostics include bounded actionable URL, field, split, and merge examples', () => {
  const truth = fixture([
    truthPage('/a', 'A', { title: 'A' }), truthPage('/b', 'A', { title: 'B' }),
    truthPage('/c', 'B', { title: 'C' }), truthPage('/d', 'B', { title: 'D' }),
  ]);
  const actual = { version: 1, pages: [
    actualPage('/a', 'x', { fields: { title: 'wrong' } }),
    actualPage('/b', 'y', { fields: { extra: 'value' } }),
    actualPage('/c', 'x', { fields: { title: 'C' } }),
  ] };
  const report = evaluate(truth, actual);
  const kinds = new Set(report.diagnostics.items.map((item) => item.kind));
  for (const kind of ['missingUrl', 'wrongFieldValue', 'missingField', 'extraField', 'clusterSplit', 'clusterMerge']) {
    assert(kinds.has(kind), `missing diagnostic ${kind}`);
  }
  const limited = evaluate(truth, actual, { maxDiagnostics: 3 }).diagnostics;
  assert.equal(limited.limit, 3);
  assert.equal(limited.recorded, 3);
  assert.equal(limited.truncated, true);
  assert.throws(() => evaluate(truth, actual, { maxDiagnostics: 101 }), /maxDiagnostics/);
});

test('writeReports creates valid JSON, escaped CSV, and escaped readable HTML', async (t) => {
  const truth = fixture([truthPage('/a', 'x')]);
  truth.site.id = '<script>alert("x")</script>,site';
  const report = evaluate(truth, { version: 1, pages: [actualPage('/a', 'x')] });
  const dir = await mkdtemp(join(tmpdir(), 'evaluator-report-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  await writeReports(report, dir);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')), report);
  const csv = await readFile(join(dir, 'report.csv'), 'utf8');
  assert.match(csv, /^metric,value\n/);
  assert.match(csv, /"<script>alert\(""x""\)<\/script>,site"/);
  const html = await readFile(join(dir, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;,site/);
  await assert.rejects(writeReports(report, dir), /Report file already exists/);
});

test('50,000 pages evaluate without pair materialization', () => {
  const count = 50_000;
  const truthPages = Array.from({ length: count }, (_, i) => truthPage(`/p/${i}`, `c-${i % 100}`, {}));
  const actualPages = Array.from({ length: count }, (_, i) => actualPage(`/p/${i}`, `label-${i % 100}`));
  const report = evaluate(fixture(truthPages), { version: 1, pages: actualPages });
  assert.equal(report.coverage.observed, count);
  assert.equal(report.clustering.allExpected.pairs.f1, 1);
});

test('breakdowns group many distinct content types in one pass', () => {
  const count = 2_000;
  const truthPages = Array.from({ length: count }, (_, i) => truthPage(`/u/${i}`, `c-${i}`, {}, { contentType: `type-${i}` }));
  const actualPages = Array.from({ length: count }, (_, i) => actualPage(`/u/${i}`, `label-${i}`));
  const report = evaluate(fixture(truthPages), { version: 1, pages: actualPages });
  assert.equal(Object.keys(report.breakdowns.byContentType).length, count);
});

test('listing records score by link URL, then by position, with field values like page fields (2026-11-02)', () => {
  const items = [
    { pageId: 'b1', url: '/books/1', fields: { title: 'One', author: 'Ann' } },
    { pageId: 'b2', url: '/books/2', fields: { title: 'Two', author: 'Ben' } },
    { pageId: 'b3', url: '/books/3', fields: { title: 'Three' } },
  ];
  const truth = fixture([truthPage('/books', 'listing', { title: 'Books' }, { contentType: 'listing', repeatedItems: items }), truthPage('/books/1', 'book', { title: 'One' }, { contentType: 'book' }), truthPage('/about', 'page')]);
  const perfect = evaluate(truth, { version: 1, pages: [actualPage('/books', 'x', { repeatedItems: items.map(({ url, fields }) => ({ url, fields })) }), actualPage('/books/1', 'y'), actualPage('/about', 'z')] });
  assert.equal(perfect.repeatedItems.availability, 'available');
  assert.equal(perfect.repeatedItems.items.f1, 1);
  assert.equal(perfect.repeatedItems.values.f1, 1);
  // Out of order with URLs still matches; without URLs, items pair by position; an unknown URL is a false positive.
  const mixed = evaluate(truth, { version: 1, pages: [actualPage('/books', 'x', { repeatedItems: [
    { url: 'https://example.test/books/2', fields: { title: 'Two', author: 'Ben' } },
    { fields: { title: 'One', author: 'Anne' } },
    { url: '/books/99', fields: { title: 'Ghost' } },
  ] })] });
  assert.deepEqual([mixed.repeatedItems.items.truePositive, mixed.repeatedItems.items.falsePositive, mixed.repeatedItems.items.falseNegative], [2, 1, 1]);
  assert.deepEqual([mixed.repeatedItems.values.truePositive, mixed.repeatedItems.values.falsePositive, mixed.repeatedItems.values.falseNegative], [3, 1, 1]);
  assert.equal(mixed.repeatedItems.pageCoverage.recall, 1);
  // Not supplying repeatedItems is reported as unavailable, not as zero.
  const none = evaluate(truth, { version: 1, pages: [actualPage('/books', 'x')] });
  assert.equal(none.repeatedItems.availability, 'unavailable');
  assert.equal(none.repeatedItems.items, null);
  assert.throws(() => evaluate(truth, { version: 1, pages: [actualPage('/books', 'x', { repeatedItems: [{ url: '/books/1' }] })] }), /repeatedItems\[0\]\.fields/);
});

test('the documented output example is accepted and scored (examples/smartcite-output.example.json)', async () => {
  const example = JSON.parse(await readFile(new URL('../examples/smartcite-output.example.json', import.meta.url), 'utf8'));
  const schema = JSON.parse(await readFile(new URL('../examples/smartcite-output.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.required, ['version', 'pages']);
  assert.deepEqual(schema.properties.pages.items.required, ['url', 'cluster']);
  const truth = fixture(example.pages.map((page) => truthPage(page.url, page.cluster, page.fields, {
    contentType: page.contentType, relationships: page.relationships ?? [],
    ...(page.repeatedItems ? { repeatedItems: page.repeatedItems.map((item, i) => ({ pageId: `item-${i}`, ...item })) } : {}),
  })));
  const report = evaluate(truth, example);
  assert.equal(report.coverage.recall, 1);
  assert.equal(report.fields.values.f1, 1);
  assert.equal(report.repeatedItems.values.f1, 1);
  assert.equal(report.relationships.score.f1, 1);
});

test('listing-record scoring cannot be gamed: stray records, unrelated position matches, URL-less truth (review 2026-11-02)', () => {
  const items = [{ pageId: 'b1', url: '/books/1', fields: { title: 'One' } }, { pageId: 'b2', fields: { title: 'Two' } }];
  const truth = fixture([truthPage('/books', 'listing', { title: 'Books' }, { contentType: 'listing', repeatedItems: items }), truthPage('/books/1', 'book', { title: 'One' }, { contentType: 'book' })]);
  // Records on a detail page are false positives, also reported separately.
  const stray = evaluate(truth, { version: 1, pages: [actualPage('/books', 'x', { repeatedItems: [{ url: '/books/1', fields: { title: 'One' } }, { fields: { title: 'Two' } }] }), actualPage('/books/1', 'y', { repeatedItems: [{ url: '/books/9', fields: { title: 'Nine' } }] })] });
  assert.deepEqual([stray.repeatedItems.items.truePositive, stray.repeatedItems.items.falsePositive, stray.repeatedItems.items.falseNegative], [2, 1, 0]);
  assert.equal(stray.repeatedItems.recordsOnPagesWithoutRecords, 1);
  // A URL-less record with no matching value does not pair by position.
  const junk = evaluate(truth, { version: 1, pages: [actualPage('/books', 'x', { repeatedItems: [{ fields: { title: 'zzz' } }] })] });
  assert.deepEqual([junk.repeatedItems.items.truePositive, junk.repeatedItems.items.falsePositive, junk.repeatedItems.items.falseNegative], [0, 1, 2]);
  // A truth record without a URL can pair with an actual record that has one, when a value matches.
  const urlOnActual = evaluate(truth, { version: 1, pages: [actualPage('/books', 'x', { repeatedItems: [{ url: '/books/2', fields: { title: 'Two' } }] })] });
  assert.deepEqual([urlOnActual.repeatedItems.items.truePositive, urlOnActual.repeatedItems.items.falsePositive], [1, 0]);
  // Colliding normalized truth field names are rejected, as for page fields.
  const colliding = fixture([truthPage('/books', 'listing', { title: 'Books' }, { repeatedItems: [{ pageId: 'c', fields: { title: 'A', ' title': 'B' } }] })]);
  assert.throws(() => evaluate(colliding, { version: 1, pages: [actualPage('/books', 'x', { repeatedItems: [{ fields: { title: 'A' } }] })] }), /collision/);
});

test('listing-record scoring details: coverage, partial results, per-type field names and error paths', () => {
  const books = [{ pageId: 'b1', url: '/books/1', fields: { title: 'One', author: 'Ann' } }, { pageId: 'b2', url: '/books/2', fields: { title: 'Two', author: 'Ben' } }];
  const people = [{ pageId: 'p1', url: '/people/1', fields: { title: 'Ann' } }];
  const truth = fixture([
    truthPage('/books', 'listing', { title: 'Books' }, { contentType: 'listing', repeatedItems: books }),
    truthPage('/people', 'listing', { title: 'People' }, { contentType: 'listing', repeatedItems: people }),
    truthPage('/books/1', 'book', { title: 'One' }, { contentType: 'book' }),
    truthPage('/people/1', 'person', { title: 'Ann' }, { contentType: 'person' }),
    truthPage('/about', 'page'),
  ]);
  // Nothing supplied: unavailable, with the reason; pages without records are not eligible.
  const none = evaluate(truth, { version: 1, pages: [actualPage('/books', 'a'), actualPage('/about', 'b')] });
  assert.equal(none.repeatedItems.reason, 'No observed listing page supplied repeatedItems.');
  assert.equal(none.repeatedItems.pageCoverage.eligiblePages, 1);
  const noListing = evaluate(truth, { version: 1, pages: [actualPage('/about', 'b')] });
  assert.equal(noListing.repeatedItems.reason, 'No expected listing records were observed.');
  // Records for one of two reached listings: partial, and the other listing's records count as missed.
  const partial = evaluate(truth, { version: 1, pages: [actualPage('/books', 'a', { repeatedItems: [{ url: '/books/1', fields: { title: 'One' } }] }), actualPage('/people', 'c'), actualPage('/about', 'b', { repeatedItems: [] })] });
  assert.equal(partial.repeatedItems.availability, 'partial');
  assert.deepEqual(partial.repeatedItems.pageCoverage, { eligiblePages: 2, providedPages: 1, recall: 0.5 });
  assert.deepEqual([partial.repeatedItems.items.truePositive, partial.repeatedItems.items.falsePositive, partial.repeatedItems.items.falseNegative], [1, 0, 2]);
  // A missing field is a false negative only.
  assert.deepEqual([partial.repeatedItems.values.truePositive, partial.repeatedItems.values.falsePositive, partial.repeatedItems.values.falseNegative], [1, 0, 1]);
  // Field names map by the record's own content type (the linked page's type).
  const options = { fieldNameMap: { book: { name: 'title', writer: 'author' }, person: { label: 'title' } } };
  const mapped = evaluate(truth, { version: 1, pages: [
    actualPage('/books', 'a', { repeatedItems: [{ url: '/books/1', fields: { name: 'One', writer: 'Ann' } }] }),
    actualPage('/people', 'c', { repeatedItems: [{ url: '/people/1', fields: { label: 'Ann' } }] }),
  ] }, options);
  assert.deepEqual([mapped.repeatedItems.values.truePositive, mapped.repeatedItems.values.falsePositive], [3, 0]);
  // Errors name the offending record.
  assert.throws(() => evaluate(truth, { version: 1, pages: [actualPage('/books', 'a', { repeatedItems: [{ url: 'http://[bad', fields: { title: 'x' } }] })] }), /actual\.pages\[0\]\.repeatedItems\[0\]\.url/);
  const badTruth = fixture([truthPage('/books', 'listing', { title: 'B' }, { repeatedItems: [{ pageId: 'x', url: 'http://[bad', fields: { title: 'x' } }] })]);
  assert.throws(() => evaluate(badTruth, { version: 1, pages: [actualPage('/books', 'a', { repeatedItems: [] })] }), /truth\.pages\[0\]\.repeatedItems\[0\]\.url/);
  const clash = { fieldNameMap: { book: { a: 'title', b: 'title' }, listing: { a: 'title', b: 'title' } } };
  assert.throws(() => evaluate(truth, { version: 1, pages: [actualPage('/books', 'a', { repeatedItems: [{ url: '/books/1', fields: { a: 'One', b: 'One' } }] })] }, clash), /actual\.pages\[0\]\.repeatedItems: field-name alias collision/);
  assert.throws(() => evaluate(truth, { version: 1, pages: [actualPage('/books', 'a', { repeatedItems: [{ fields: { a: 'One', b: 'One' } }] })] }, clash), /actual\.pages\[0\]\.repeatedItems\[0\]: field-name alias collision/);
  const colliding = fixture([truthPage('/books', 'listing', { title: 'B' }, { repeatedItems: [{ pageId: 'c', fields: { title: 'A', ' title': 'B' } }] })]);
  assert.throws(() => evaluate(colliding, { version: 1, pages: [actualPage('/books', 'a', { repeatedItems: [{ fields: { title: 'A' } }] })] }), /truth\.pages\[0\]\.repeatedItems: normalized field collision/);
});
