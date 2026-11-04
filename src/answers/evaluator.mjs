import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const c2 = (n) => n * (n - 1) / 2;
const div = (a, b) => b === 0 ? null : a / b;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const err = (path, message) => { throw new TypeError(`${path}: ${message}`); };
const reqObj = (v, p) => { if (!record(v)) err(p, 'expected an object'); };
const reqStr = (v, p) => { if (typeof v !== 'string' || !v.length) err(p, 'expected a non-empty string'); };
const text = (v) => v.normalize('NFC').trim().replace(/\s+/gu, ' ');

function stringRecord(value, path) {
  reqObj(value, path);
  for (const [key, item] of Object.entries(value)) {
    reqStr(key, `${path} key`);
    if (typeof item !== 'string') err(`${path}.${key}`, 'expected a string');
  }
}

function schemas(value, path) {
  if (value === undefined) return;
  reqObj(value, path);
  for (const [type, fields] of Object.entries(value)) {
    reqStr(type, `${path} key`);
    if (!Array.isArray(fields)) err(`${path}.${type}`, 'expected an array');
    fields.forEach((field, i) => reqStr(field, `${path}.${type}[${i}]`));
  }
}

function relationships(value, path, required = false) {
  if (value === undefined && !required) return;
  if (!Array.isArray(value)) err(path, 'expected an array');
  value.forEach((relationship, i) => {
    reqObj(relationship, `${path}[${i}]`);
    reqStr(relationship.type, `${path}[${i}].type`);
    reqStr(relationship.targetUrl, `${path}[${i}].targetUrl`);
  });
}

function validateTruth(truth) {
  reqObj(truth, 'truth');
  if (truth.version !== 1) err('truth.version', 'expected 1');
  reqObj(truth.site, 'truth.site');
  reqStr(truth.site.id, 'truth.site.id');
  reqStr(truth.site.baseUrl, 'truth.site.baseUrl');
  if (!['html', 'react', 'angular'].includes(truth.site.framework)) err('truth.site.framework', "expected 'html', 'react', or 'angular'");
  reqObj(truth.site.noise, 'truth.site.noise');
  try { new URL(truth.site.baseUrl); } catch { err('truth.site.baseUrl', 'expected an absolute URL'); }
  if (!Array.isArray(truth.pages)) err('truth.pages', 'expected an array');
  schemas(truth.schemas, 'truth.schemas');
  truth.pages.forEach((page, i) => {
    const path = `truth.pages[${i}]`;
    reqObj(page, path);
    for (const key of ['url', 'pageId', 'expectedCluster', 'contentType']) reqStr(page[key], `${path}.${key}`);
    stringRecord(page.fields, `${path}.fields`);
    stringRecord(page.canonicalValues, `${path}.canonicalValues`);
    reqObj(page.fieldStates, `${path}.fieldStates`);
    for (const [key, state] of Object.entries(page.fieldStates)) {
      if (state !== 'present' && state !== 'absent') err(`${path}.fieldStates.${key}`, "expected 'present' or 'absent'");
      if (state === 'absent' && own(page.fields, key)) err(`${path}.fields.${key}`, 'field marked absent must not be visible');
      if (state === 'present' && !own(page.fields, key)) err(`${path}.fields.${key}`, 'field marked present must be visible');
    }
    for (const key of Object.keys(page.fields)) {
      if (page.fieldStates[key] !== 'present') err(`${path}.fieldStates.${key}`, "visible field must be marked 'present'");
    }
    relationships(page.relationships, `${path}.relationships`, true);
    repeatedItemList(page.repeatedItems, `${path}.repeatedItems`);
    if (!Array.isArray(page.noiseEvents)) err(`${path}.noiseEvents`, 'expected an array');
    page.noiseEvents.forEach((event, j) => {
      reqObj(event, `${path}.noiseEvents[${j}]`);
      reqStr(event.type, `${path}.noiseEvents[${j}].type`);
      if (!Number.isFinite(event.severity)) err(`${path}.noiseEvents[${j}].severity`, 'expected a finite number');
      if (typeof event.preservesSemantics !== 'boolean') err(`${path}.noiseEvents[${j}].preservesSemantics`, 'expected a boolean');
      if (event.field !== undefined) reqStr(event.field, `${path}.noiseEvents[${j}].field`);
    });
  });
}

function validateActual(actual) {
  reqObj(actual, 'actual');
  if (actual.version !== 1) err('actual.version', 'expected 1');
  if (!Array.isArray(actual.pages)) err('actual.pages', 'expected an array');
  schemas(actual.schemas, 'actual.schemas');
  actual.pages.forEach((page, i) => {
    const path = `actual.pages[${i}]`;
    reqObj(page, path);
    reqStr(page.url, `${path}.url`);
    reqStr(page.cluster, `${path}.cluster`);
    if (page.contentType !== undefined) reqStr(page.contentType, `${path}.contentType`);
    if (page.fields !== undefined) stringRecord(page.fields, `${path}.fields`);
    relationships(page.relationships, `${path}.relationships`);
    repeatedItemList(page.repeatedItems, `${path}.repeatedItems`);
  });
}

// Records listed on a listing page (book cards, table rows): [{ url?, fields }]. Optional in actual output.
function repeatedItemList(value, path) {
  if (value === undefined) return;
  if (!Array.isArray(value)) err(path, 'expected an array');
  value.forEach((item, i) => {
    reqObj(item, `${path}[${i}]`);
    if (item.url !== undefined) reqStr(item.url, `${path}[${i}].url`);
    stringRecord(item.fields, `${path}[${i}].fields`);
  });
}

function validateOptions(options) {
  reqObj(options, 'options');
  for (const key of ['contentTypeMap', 'fieldNameMap', 'fieldNormalizers']) {
    if (options[key] !== undefined && !record(options[key])) err(`options.${key}`, 'expected an object');
  }
  const drop = options.dropQueryParams ?? options.dropParams;
  if (drop !== undefined && drop !== true && !Array.isArray(drop)) err('options.dropQueryParams', 'expected true or an array');
  if (Array.isArray(drop)) drop.forEach((name, i) => reqStr(name, `options.dropQueryParams[${i}]`));
  for (const [key, value] of Object.entries(options.contentTypeMap ?? {})) {
    reqStr(value, `options.contentTypeMap.${key}`);
  }
  for (const [key, value] of Object.entries(options.fieldNameMap ?? {})) {
    if (record(value)) {
      for (const [alias, target] of Object.entries(value)) reqStr(target, `options.fieldNameMap.${key}.${alias}`);
    } else reqStr(value, `options.fieldNameMap.${key}`);
  }
  for (const [key, value] of Object.entries(options.fieldNormalizers ?? {})) {
    if (value !== 'date' && typeof value !== 'function') err(`options.fieldNormalizers.${key}`, "expected a function or 'date'");
  }
  if (options.dateFields !== undefined && !Array.isArray(options.dateFields) && !record(options.dateFields)) {
    err('options.dateFields', 'expected an array or object');
  }
  if (Array.isArray(options.dateFields)) options.dateFields.forEach((name, i) => reqStr(name, `options.dateFields[${i}]`));
  if (record(options.dateFields)) for (const [name, enabled] of Object.entries(options.dateFields)) {
    if (enabled !== true && enabled !== false) err(`options.dateFields.${name}`, 'expected a boolean');
  }
  if (options.maxDiagnostics !== undefined
    && (!Number.isInteger(options.maxDiagnostics) || options.maxDiagnostics < 0 || options.maxDiagnostics > 100)) {
    err('options.maxDiagnostics', 'expected an integer from 0 to 100');
  }
}

function url(raw, base, options, path) {
  let value;
  try { value = new URL(raw, base); } catch { err(path, 'expected a valid absolute or base-relative URL'); }
  value.hash = '';
  const drop = options.dropQueryParams ?? options.dropParams;
  if (drop === true) value.search = '';
  else if (Array.isArray(drop)) drop.forEach((name) => value.searchParams.delete(name));
  return value.href;
}

function index(pages, kind, base, options) {
  const result = new Map();
  pages.forEach((page, i) => {
    const normalizedUrl = url(page.url, base, options, `${kind}.pages[${i}].url`);
    if (result.has(normalizedUrl)) err(`${kind}.pages[${i}].url`, `duplicate normalized URL ${JSON.stringify(normalizedUrl)}`);
    result.set(normalizedUrl, { page, normalizedUrl, index: i });
  });
  return result;
}

function fscore(tp, fp, fn) {
  const precision = div(tp, tp + fp);
  const recall = div(tp, tp + fn);
  const f1 = div(2 * tp, 2 * tp + fp + fn);
  return { truePositive: tp, falsePositive: fp, falseNegative: fn, precision, recall, f1 };
}

function clustering(rows, missingSingletons) {
  const truth = new Map();
  const pred = new Map();
  const cells = new Map();
  for (const row of rows) {
    const a = row.truth.page.expectedCluster;
    const b = row.actual ? row.actual.page.cluster
      : missingSingletons ? Symbol(row.truth.normalizedUrl) : null;
    if (b === null) continue;
    truth.set(a, (truth.get(a) ?? 0) + 1);
    pred.set(b, (pred.get(b) ?? 0) + 1);
    if (!cells.has(a)) cells.set(a, new Map());
    cells.get(a).set(b, (cells.get(a).get(b) ?? 0) + 1);
  }
  const n = [...truth.values()].reduce((a, b) => a + b, 0);
  let tp = 0;
  for (const row of cells.values()) for (const size of row.values()) tp += c2(size);
  const expectedPositive = [...truth.values()].reduce((sum, n) => sum + c2(n), 0);
  const predictedPositive = [...pred.values()].reduce((sum, n) => sum + c2(n), 0);
  const pair = fscore(tp, predictedPositive - tp, expectedPositive - tp);
  const notes = [];
  if (!predictedPositive) notes.push('Pairwise precision is null because there are no predicted positive pairs.');
  if (!expectedPositive) notes.push('Pairwise recall is null because there are no expected positive pairs.');
  if (pair.f1 === null) notes.push('Pairwise F1 is null because there are no expected or predicted positive pairs.');
  let adjustedRandIndex = null;
  if (n < 2) {
    adjustedRandIndex = 1;
    notes.push('Degenerate sample with fewer than two pages; identical pair decisions score 1.');
  } else {
    const total = c2(n);
    const expected = expectedPositive * predictedPositive / total;
    const denominator = (expectedPositive + predictedPositive) / 2 - expected;
    if (denominator) adjustedRandIndex = (tp - expected) / denominator;
    else if (pair.falsePositive === 0 && pair.falseNegative === 0) {
      adjustedRandIndex = 1;
      notes.push('Degenerate identical partition (all singleton or all one cluster); ARI is defined as 1.');
    } else notes.push('Adjusted Rand index is undefined because its adjustment denominator is zero.');
  }
  return {
    pages: n, truthClusters: truth.size, predictedClusters: pred.size,
    pairs: { ...pair, expectedPositive, predictedPositive }, adjustedRandIndex, notes,
  };
}

const mappedType = (label, options) => label !== undefined && own(options.contentTypeMap ?? {}, label)
  ? options.contentTypeMap[label] : label;

function fieldMap(type, options) {
  const map = options.fieldNameMap ?? {};
  return record(map[type]) ? map[type] : map;
}

function fieldName(name, type, options) {
  const normalized = text(name);
  const map = fieldMap(type, options);
  const value = own(map, name) ? map[name] : own(map, normalized) ? map[normalized] : normalized;
  if (typeof value !== 'string' || !text(value)) err(`options.fieldNameMap.${name}`, 'expected a non-empty string target');
  return text(value);
}

const MONTHS = new Map([
  ['january', 1], ['jan', 1], ['february', 2], ['feb', 2], ['march', 3], ['mar', 3],
  ['april', 4], ['apr', 4], ['may', 5], ['june', 6], ['jun', 6], ['july', 7], ['jul', 7],
  ['august', 8], ['aug', 8], ['september', 9], ['sep', 9], ['sept', 9], ['october', 10], ['oct', 10],
  ['november', 11], ['nov', 11], ['december', 12], ['dec', 12],
]);

function calendarDate(year, month, day) {
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeDate(value) {
  let match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match) return calendarDate(Number(match[1]), Number(match[2]), Number(match[3])) ?? value;
  // "March 5, 2024", "Mar. 5, 2024" and "Tuesday, March 5, 2024" (the weekday must be right).
  match = /^(?:([A-Za-z]+),\s+)?([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})(?:\s+UTC)?$/u.exec(value);
  if (match) {
    const month = MONTHS.get(match[2].toLowerCase());
    const iso = month ? calendarDate(Number(match[4]), month, Number(match[3])) : undefined;
    if (!iso) return value;
    if (match[1] && WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] !== match[1].toLowerCase()) return value;
    return iso;
  }
  // "5 March 2024" (day first with a month name is unambiguous; numeric 03/05/2024 and 5.3.2024 stay unnormalized).
  match = /^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/u.exec(value);
  if (match) {
    const month = MONTHS.get(match[2].toLowerCase());
    return month ? calendarDate(Number(match[3]), month, Number(match[1])) ?? value : value;
  }
  match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):?(\d{2}))$/u.exec(value);
  if (match) {
    const validDate = calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
    const validTime = Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6] ?? 0) <= 59;
    const validOffset = match[8] === 'Z' || Number(match[9]) <= 23 && Number(match[10]) <= 59;
    if (!validDate || !validTime || !validOffset) return value;
    const instant = Date.parse(value);
    return Number.isNaN(instant) ? value : new Date(instant).toISOString();
  }
  return value;
}

function fieldValue(value, field, options) {
  const normalized = text(value);
  const fn = options.fieldNormalizers?.[field];
  const dates = options.dateFields;
  const date = fn === 'date' || Array.isArray(dates) && dates.includes(field) || record(dates) && dates[field] === true;
  if (typeof fn === 'function') {
    const result = fn(normalized);
    if (typeof result !== 'string') err(`options.fieldNormalizers.${field}`, 'normalizer must return a string');
    return text(result);
  }
  if (fn !== undefined && fn !== 'date') err(`options.fieldNormalizers.${field}`, "expected a function or 'date'");
  return date ? normalizeDate(normalized) : normalized;
}

function actualFields(fields, type, options, path) {
  const result = new Map();
  for (const [source, value] of Object.entries(fields)) {
    const name = fieldName(source, type, options);
    if (result.has(name)) err(path, `field-name alias collision: multiple fields map to ${JSON.stringify(name)}`);
    result.set(name, fieldValue(value, name, options));
  }
  return result;
}

function relationshipItems(items, base, options, path) {
  const result = new Map();
  for (let i = 0; i < items.length; i++) {
    const relationship = items[i];
    const type = text(relationship.type);
    const targetUrl = url(relationship.targetUrl, base, options, `${path}[${i}].targetUrl`);
    const key = JSON.stringify([type, targetUrl]);
    if (result.has(key)) err(path, `duplicate normalized relationship ${JSON.stringify({ type, targetUrl })}`);
    result.set(key, { type, targetUrl });
  }
  return result;
}

function truthFields(row, options) {
  const result = new Map();
  for (const [source, value] of Object.entries(row.truth.page.fields)) {
    if (row.truth.page.fieldStates?.[source] === 'absent') continue;
    const name = text(source);
    if (result.has(name)) err(`truth.pages[${row.truth.index}].fields`, `normalized field collision at ${JSON.stringify(name)}`);
    result.set(name, fieldValue(value, name, options));
  }
  return result;
}

function fields(rows, options) {
  const eligible = rows.filter((row) => row.actual);
  const provided = eligible.filter((row) => row.actual.page.fields !== undefined);
  const pageCoverage = { eligiblePages: eligible.length, providedPages: provided.length, recall: div(provided.length, eligible.length) };
  if (!provided.length) return {
    availability: 'unavailable',
    reason: eligible.length ? 'No observed page supplied a fields payload.' : 'No expected pages were observed.',
    pageCoverage, presence: null, values: null,
  };
  let pt = 0, pp = 0, pn = 0, vt = 0, vp = 0, vn = 0;
  for (const row of provided) {
    const expected = row.expectedFields;
    const actual = row.actualFields;
    for (const [name, value] of actual) {
      if (!expected.has(name)) { pp++; vp++; }
      else {
        pt++;
        if (value === expected.get(name)) vt++;
        else { vp++; vn++; }
      }
    }
    for (const name of expected.keys()) if (!actual.has(name)) { pn++; vn++; }
  }
  return {
    availability: provided.length === eligible.length ? 'available' : 'partial', pageCoverage,
    presence: fscore(pt, pp, pn), values: fscore(vt, vp, vn),
  };
}

// Listing records: each actual item is matched to an expected item by its link URL when both give one, otherwise by
// position among the unmatched items, and a position match needs at least one equal field value (so arbitrary
// records cannot score). Items score like pages (precision/recall); matched items' field values score like page
// fields. Every observed page takes part: records reported on a page that lists none in the answer key are false
// positives, also counted separately as recordsOnPagesWithoutRecords.
function repeatedItemScore(rows, truthTypes, base, options) {
  const observed = rows.filter((row) => row.actual);
  const listing = observed.filter((row) => (row.truth.page.repeatedItems?.length ?? 0) > 0);
  const provided = observed.filter((row) => row.actual.page.repeatedItems !== undefined);
  const providedListing = listing.filter((row) => row.actual.page.repeatedItems !== undefined);
  const pageCoverage = { eligiblePages: listing.length, providedPages: providedListing.length, recall: div(providedListing.length, listing.length) };
  if (!provided.length) return { availability: 'unavailable', reason: listing.length ? 'No observed listing page supplied repeatedItems.' : 'No expected listing records were observed.', pageCoverage, items: null, values: null, recordsOnPagesWithoutRecords: 0 };
  let it = 0, ip = 0, iN = 0, vt = 0, vp = 0, vn = 0, stray = 0;
  for (const row of provided) {
    const actual = row.actual.page.repeatedItems;
    const truthItems = row.truth.page.repeatedItems ?? [];
    if (!truthItems.length) { ip += actual.length; stray += actual.length; continue; }
    const expected = truthItems.map((item, i) => ({ item, key: item.url ? url(item.url, base, options, `truth.pages[${row.truth.index}].repeatedItems[${i}].url`) : null, used: false }));
    const typeOf = (truthItem) => (truthItem.url && truthTypes.get(url(truthItem.url, base, options, 'truth repeated item url'))) ?? row.truth.page.contentType;
    const want = (truthItem) => {
      const result = new Map();
      for (const [name, value] of Object.entries(truthItem.fields)) {
        const key = text(name);
        if (result.has(key)) err(`truth.pages[${row.truth.index}].repeatedItems`, `normalized field collision at ${JSON.stringify(key)}`);
        result.set(key, fieldValue(value, key, options));
      }
      return result;
    };
    const pairs = [];
    const unmatched = [];
    actual.forEach((item, i) => {
      const key = item.url ? url(item.url, base, options, `actual.pages[${row.actual.index}].repeatedItems[${i}].url`) : null;
      const match = key && expected.find((entry) => !entry.used && entry.key === key);
      if (match) { match.used = true; pairs.push([match.item, item]); } else unmatched.push({ item, key, index: i });
    });
    for (const { item, key, index } of unmatched) {
      // A URL that names another page is wrong; otherwise the next unused record without a matching URL may pair.
      const next = expected.find((entry) => !entry.used && (key === null || entry.key === null));
      const got = next && actualFields(item.fields, typeOf(next.item), options, `actual.pages[${row.actual.index}].repeatedItems[${index}]`);
      const wanted = next && want(next.item);
      if (next && [...got].some(([name, value]) => wanted.get(name) === value)) { next.used = true; pairs.push([next.item, item]); } else ip++;
    }
    iN += expected.filter((entry) => !entry.used).length;
    it += pairs.length;
    for (const [truthItem, actualItem] of pairs) {
      const wanted = want(truthItem);
      const got = actualFields(actualItem.fields, typeOf(truthItem), options, `actual.pages[${row.actual.index}].repeatedItems`);
      for (const [name, value] of got) {
        if (wanted.has(name) && wanted.get(name) === value) vt++;
        else { vp++; if (wanted.has(name)) vn++; }
      }
      for (const name of wanted.keys()) if (!got.has(name)) vn++;
    }
  }
  // Listing pages the tool reached but reported no records for count as missed records.
  for (const row of listing.filter((item) => item.actual.page.repeatedItems === undefined)) iN += row.truth.page.repeatedItems.length;
  return { availability: providedListing.length === listing.length ? 'available' : 'partial', pageCoverage, items: fscore(it, ip, iN), values: fscore(vt, vp, vn), recordsOnPagesWithoutRecords: stray };
}

function relationshipScore(rows) {
  const eligible = rows.filter((row) => row.actual);
  const provided = eligible.filter((row) => row.actual.page.relationships !== undefined);
  const pageCoverage = { eligiblePages: eligible.length, providedPages: provided.length, recall: div(provided.length, eligible.length) };
  if (!provided.length) return {
    availability: 'unavailable',
    reason: eligible.length ? 'No observed page supplied a relationships payload.' : 'No expected pages were observed.',
    pageCoverage,
    score: null,
  };
  let tp = 0, fp = 0, fn = 0;
  for (const row of provided) {
    for (const key of row.actual.relationships.keys()) {
      if (row.truth.relationships.has(key)) tp++;
      else fp++;
    }
    for (const key of row.truth.relationships.keys()) if (!row.actual.relationships.has(key)) fn++;
  }
  return {
    availability: provided.length === eligible.length ? 'available' : 'partial',
    pageCoverage,
    score: fscore(tp, fp, fn),
  };
}

function types(rows, options) {
  const eligible = rows.filter((row) => row.actual);
  const provided = eligible.filter((row) => row.actual.page.contentType !== undefined);
  const coverage = { eligiblePages: eligible.length, providedPages: provided.length, recall: div(provided.length, eligible.length) };
  if (!provided.length) return {
    availability: 'unavailable', reason: eligible.length ? 'No observed page supplied a contentType.' : 'No expected pages were observed.',
    coverage, correct: null, accuracy: null,
  };
  const correct = provided.filter((row) => mappedType(row.actual.page.contentType, options) === row.truth.page.contentType).length;
  return { availability: provided.length === eligible.length ? 'available' : 'partial', coverage, correct, accuracy: correct / provided.length };
}

function schemaScore(truth, actual, options) {
  if (truth.schemas === undefined) return { availability: 'unavailable', reason: 'Truth does not define schemas.', presence: null };
  if (actual.schemas === undefined) return { availability: 'unavailable', reason: 'Actual output does not supply schemas.', presence: null };
  const expected = new Set(), predicted = new Set();
  for (const [type, names] of Object.entries(truth.schemas)) {
    const seen = new Set();
    for (const source of names) {
      const name = text(source);
      if (seen.has(name)) err(`truth.schemas.${type}`, `normalized field collision at ${JSON.stringify(name)}`);
      seen.add(name); expected.add(JSON.stringify([type, name]));
    }
  }
  for (const [sourceType, names] of Object.entries(actual.schemas)) {
    const type = mappedType(sourceType, options), seen = new Set();
    for (const source of names) {
      const name = fieldName(source, type, options);
      if (seen.has(name)) err(`actual.schemas.${sourceType}`, `field-name alias collision at ${JSON.stringify(name)}`);
      seen.add(name); predicted.add(JSON.stringify([type, name]));
    }
  }
  let tp = 0;
  for (const item of predicted) if (expected.has(item)) tp++;
  return { availability: 'available', presence: fscore(tp, predicted.size - tp, expected.size - tp) };
}

function scope(rows, options) {
  const observed = rows.filter((row) => row.actual);
  return {
    pages: rows.length,
    coverage: { expected: rows.length, observed: observed.length, missing: rows.length - observed.length, recall: div(observed.length, rows.length) },
    clustering: {
      allExpected: { ...clustering(rows, true), population: 'All expected pages; every missing page is treated as its own unique predicted singleton.' },
      observedOnly: { ...clustering(observed, false), population: 'Only expected pages present in actual output.' },
    },
    contentType: types(rows, options), fields: fields(rows, options), relationships: relationshipScore(rows),
  };
}

function mapping(rows) {
  const groups = new Map();
  for (const row of rows) if (row.actual) {
    const p = row.actual.page.cluster, e = row.truth.page.expectedCluster;
    if (!groups.has(p)) groups.set(p, { size: 0, counts: new Map() });
    const group = groups.get(p); group.size++; group.counts.set(e, (group.counts.get(e) ?? 0) + 1);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([predictedCluster, group]) => {
    const best = [...group.counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { predictedCluster, bestExpectedCluster: best[0], overlap: best[1], observedSize: group.size, purity: best[1] / group.size };
  });
}

function diagnosticCollector(limit) {
  const counts = new Map(), samples = new Map();
  return {
    add(kind, value) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if (!samples.has(kind)) samples.set(kind, []);
      if (samples.get(kind).length < limit) samples.get(kind).push(value);
    },
    finish() {
      const items = [], groups = [...samples.entries()];
      for (let i = 0; items.length < limit; i++) {
        let added = false;
        for (const [kind, values] of groups) {
          if (values[i] === undefined || items.length >= limit) continue;
          items.push({ kind, ...values[i] });
          added = true;
        }
        if (!added) break;
      }
      const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
      return {
        limit,
        total,
        recorded: items.length,
        truncated: total > items.length,
        counts: Object.fromEntries(counts),
        items,
      };
    },
  };
}

const preview = (value) => value.length <= 200 ? value : `${value.slice(0, 197)}...`;

function composition(counts, limit = 20) {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    totalLabels: sorted.length,
    labels: sorted.slice(0, limit).map(([label, pages]) => ({ label, pages })),
    truncated: sorted.length > limit,
  };
}

function diagnostics(rows, limit) {
  const result = diagnosticCollector(limit);
  const expectedClusters = new Map(), predictedClusters = new Map();
  for (const row of rows) {
    const urlValue = row.truth.normalizedUrl;
    const expectedLabel = row.truth.page.expectedCluster;
    if (!expectedClusters.has(expectedLabel)) expectedClusters.set(expectedLabel, { pages: 0, missing: 0, predicted: new Map() });
    const expectedGroup = expectedClusters.get(expectedLabel);
    expectedGroup.pages++;
    if (!row.actual) {
      expectedGroup.missing++;
      result.add('missingUrl', { url: urlValue, pageId: row.truth.page.pageId });
      continue;
    }
    const predictedLabel = row.actual.page.cluster;
    expectedGroup.predicted.set(predictedLabel, (expectedGroup.predicted.get(predictedLabel) ?? 0) + 1);
    if (!predictedClusters.has(predictedLabel)) predictedClusters.set(predictedLabel, { pages: 0, expected: new Map() });
    const predictedGroup = predictedClusters.get(predictedLabel);
    predictedGroup.pages++;
    predictedGroup.expected.set(expectedLabel, (predictedGroup.expected.get(expectedLabel) ?? 0) + 1);

    if (row.actual.page.fields !== undefined) {
      for (const [name, actualValue] of row.actualFields) {
        if (!row.expectedFields.has(name)) result.add('extraField', { url: urlValue, field: name, actual: preview(actualValue) });
        else if (actualValue !== row.expectedFields.get(name)) result.add('wrongFieldValue', {
          url: urlValue, field: name, expected: preview(row.expectedFields.get(name)), actual: preview(actualValue),
        });
      }
      for (const [name, expectedValue] of row.expectedFields) {
        if (!row.actualFields.has(name)) result.add('missingField', { url: urlValue, field: name, expected: preview(expectedValue) });
      }
    }
    if (row.actual.page.relationships !== undefined) {
      for (const [key, item] of row.actual.relationships) {
        if (!row.truth.relationships.has(key)) result.add('extraRelationship', { url: urlValue, ...item });
      }
      for (const [key, item] of row.truth.relationships) {
        if (!row.actual.relationships.has(key)) result.add('missingRelationship', { url: urlValue, ...item });
      }
    }
  }
  for (const [expectedCluster, group] of expectedClusters) if (group.predicted.size > 1) {
    result.add('clusterSplit', {
      expectedCluster, expectedPages: group.pages, missingPages: group.missing,
      predictedComposition: composition(group.predicted),
    });
  }
  for (const [predictedCluster, group] of predictedClusters) if (group.expected.size > 1) {
    result.add('clusterMerge', {
      predictedCluster, observedPages: group.pages, expectedComposition: composition(group.expected),
    });
  }
  return result.finish();
}

function breakdowns(rows, options) {
  const typeGroups = new Map(), noiseGroups = new Map(), severityGroups = new Map(), clean = [], noisy = [];
  for (const row of rows) {
    const contentType = row.truth.page.contentType;
    if (!typeGroups.has(contentType)) typeGroups.set(contentType, []);
    typeGroups.get(contentType).push(row);
    const events = row.truth.page.noiseEvents ?? [];
    (events.length ? noisy : clean).push(row);
    for (const noiseType of new Set(events.map((event) => event.type))) {
      if (!noiseGroups.has(noiseType)) noiseGroups.set(noiseType, []);
      noiseGroups.get(noiseType).push(row);
    }
    for (const key of new Set(events.map((event) => JSON.stringify([event.type, event.severity])))) {
      if (!severityGroups.has(key)) severityGroups.set(key, []);
      severityGroups.get(key).push(row);
    }
  }
  const byContentType = Object.fromEntries(
    [...typeGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, group]) => [type, scope(group, options)]),
  );
  const byNoiseType = Object.fromEntries(
    [...noiseGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, group]) => [type, scope(group, options)]),
  );
  const severityOutput = new Map();
  for (const [key, group] of severityGroups) {
    const [type, severity] = JSON.parse(key);
    if (!severityOutput.has(type)) severityOutput.set(type, new Map());
    severityOutput.get(type).set(String(severity), scope(group, options));
  }
  const byNoiseTypeAndSeverity = Object.fromEntries(
    [...severityOutput.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, severities]) => [
      type,
      Object.fromEntries([...severities.entries()].sort(([a], [b]) => Number(a) - Number(b))),
    ]),
  );
  return {
    byContentType,
    byNoiseStatus: { clean: scope(clean, options), noisy: scope(noisy, options) },
    byNoiseType,
    byNoiseTypeAndSeverity,
  };
}

export function evaluate(truth, actual, options = {}) {
  validateTruth(truth); validateActual(actual); validateOptions(options);
  const expected = index(truth.pages, 'truth', truth.site.baseUrl, options);
  const observed = index(actual.pages, 'actual', truth.site.baseUrl, options);
  for (const entry of expected.values()) {
    entry.relationships = relationshipItems(entry.page.relationships, truth.site.baseUrl, options, `truth.pages[${entry.index}].relationships`);
  }
  for (const entry of observed.values()) {
    if (entry.page.relationships !== undefined) {
      entry.relationships = relationshipItems(entry.page.relationships, truth.site.baseUrl, options, `actual.pages[${entry.index}].relationships`);
    }
  }
  const rows = [...expected.values()].map((page) => ({ truth: page, actual: observed.get(page.normalizedUrl) ?? null }));
  for (const row of rows) if (row.actual?.page.fields !== undefined) {
    row.expectedFields = truthFields(row, options);
    row.actualFields = actualFields(row.actual.page.fields, row.truth.page.contentType, options, `actual.pages[${row.actual.index}].fields`);
  }
  const unexpectedUrls = [...observed.keys()].filter((item) => !expected.has(item)).sort();
  const main = scope(rows, options);
  return {
    reportVersion: 1, truthVersion: truth.version, actualVersion: actual.version,
    site: { id: truth.site.id, baseUrl: truth.site.baseUrl, framework: truth.site.framework ?? null },
    coverage: {
      ...main.coverage, actualPages: actual.pages.length, unexpected: unexpectedUrls.length,
      unexpectedPageRate: div(unexpectedUrls.length, actual.pages.length), unexpectedUrls,
    },
    clustering: {
      ...main.clustering, bestOverlapMapping: mapping(rows),
      mappingNote: 'Diagnostic many-to-one overlap mapping only; label-invariant metrics do not use this mapping.',
    },
    contentType: main.contentType,
    relationships: main.relationships,
    fields: {
      availability: main.fields.availability,
      ...(main.fields.reason ? { reason: main.fields.reason } : {}),
      pageCoverage: main.fields.pageCoverage,
      pagePresence: main.fields.presence, values: main.fields.values, schemaPresence: schemaScore(truth, actual, options),
    },
    repeatedItems: repeatedItemScore(rows, new Map([...expected.values()].map((entry) => [entry.normalizedUrl, entry.page.contentType])), truth.site.baseUrl, options),
    diagnostics: diagnostics(rows, options.maxDiagnostics ?? 100),
    breakdowns: breakdowns(rows, options),
    normalization: {
      urls: 'Resolved against truth.site.baseUrl; fragments removed; path case and query preserved unless configured.',
      values: 'Unicode NFC, trim, and whitespace collapse; date normalization only for explicitly configured fields.',
    },
  };
}

function flatten(value, path = '', rows = []) {
  if (value === null || typeof value !== 'object') rows.push([path, value]);
  else if (Array.isArray(value)) rows.push([path, JSON.stringify(value)]);
  else for (const [key, item] of Object.entries(value)) flatten(item, path ? `${path}.${key}` : key, rows);
  return rows;
}

const csv = (value) => {
  const result = value === null ? '' : String(value);
  return /[",\r\n]/u.test(result) ? `"${result.replaceAll('"', '""')}"` : result;
};
const html = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const pct = (value) => value === null ? 'Unavailable' : `${(value * 100).toFixed(2)}%`;

function htmlReport(report) {
  const summary = [
    ['Coverage', `${report.coverage.observed} / ${report.coverage.expected} (${pct(report.coverage.recall)})`],
    ['Unexpected pages', `${report.coverage.unexpected} (${pct(report.coverage.unexpectedPageRate)})`],
    ['Pairwise F1, all expected', pct(report.clustering.allExpected.pairs.f1)],
    ['Adjusted Rand index', report.clustering.allExpected.adjustedRandIndex?.toFixed(4) ?? 'Unavailable'],
    ['Content type accuracy', pct(report.contentType.accuracy)],
    ['Field value F1', report.fields.values ? pct(report.fields.values.f1) : 'Unavailable'],
    ['Relationship F1', report.relationships.score ? pct(report.relationships.score.f1) : 'Unavailable'],
    ['Listing records found (F1)', report.repeatedItems?.items ? pct(report.repeatedItems.items.f1) : 'Unavailable'],
    ['Listing record field F1', report.repeatedItems?.values ? pct(report.repeatedItems.values.f1) : 'Unavailable'],
  ];
  const cards = summary.map(([a, b]) => `<section><span>${html(a)}</span><strong>${html(b)}</strong></section>`).join('');
  const rows = flatten(report).map(([a, b]) => `<tr><th>${html(a)}</th><td>${html(b)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evaluation report</title><style>:root{font:14px/1.45 system-ui,sans-serif;color:#20242a;background:#f5f6f7}body{margin:0}main{max-width:1100px;margin:auto;padding:28px}h1{font-size:24px;margin:0 0 6px}.meta{color:#606872;margin:0 0 24px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;background:#d7dbe0;border:1px solid #d7dbe0}.summary section{background:white;padding:14px}.summary span{display:block;color:#606872;font-size:12px}.summary strong{display:block;font-size:18px;margin-top:4px}h2{font-size:18px;margin:28px 0 10px}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid #e5e7ea;overflow-wrap:anywhere}th{width:45%;font-weight:600}@media(max-width:600px){main{padding:16px}th,td{display:block;width:auto}}</style></head><body><main><h1>Evaluation report</h1><p class="meta">${html(report.site.id)} · ${html(report.site.baseUrl)}</p><div class="summary">${cards}</div><h2>All metrics</h2><table><tbody>${rows}</tbody></table></main></body></html>`;
}

export async function writeReports(report, outputDir) {
  reqObj(report, 'report'); reqStr(outputDir, 'outputDir');
  await mkdir(outputDir, { recursive: true });
  const rows = [['metric', 'value'], ...flatten(report)];
  const files = [
    [join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`],
    [join(outputDir, 'report.csv'), `${rows.map((row) => row.map(csv).join(',')).join('\n')}\n`],
    [join(outputDir, 'report.html'), htmlReport(report)],
  ];
  const existing = [];
  for (const [path] of files) {
    try { await access(path); existing.push(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (existing.length) throw new Error(`Report file already exists: ${existing.join(', ')}`);
  for (const [path, contents] of files) await writeFile(path, contents, { encoding: 'utf8', flag: 'wx' });
}
