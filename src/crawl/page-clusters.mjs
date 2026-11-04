import { agnes } from 'ml-hclust';

const MAX_HARD_PAGES = 500;
const NEUTRAL_TAGS = new Set(['div', 'span']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function finiteCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 1_000_000) : 0;
}

function cleanCountMap(value, { exclude = new Set(), limit = 300 } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value)
    .filter(([key, count]) => key && !exclude.has(key) && finiteCount(count))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
}

function cleanFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, fieldValue]) => key && !UNSAFE_KEYS.has(key) && typeof fieldValue === 'string')
    .slice(0, 100));
}

function pageLabels(page) {
  const values = Array.isArray(page.fieldLabels) ? page.fieldLabels : Object.keys(cleanFields(page.fields));
  const labels = new Set();
  for (const value of values.slice(0, 300)) {
    if (typeof value !== 'string') continue;
    const label = value.trim().slice(0, 80);
    if (label && !UNSAFE_KEYS.has(label)) labels.add(label);
  }
  return labels;
}

function dice(left, right) {
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const key of left) if (right.has(key)) intersection++;
  return 2 * intersection / (left.size + right.size);
}

function cosine(left, right) {
  if (!left.size || !right.size) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const value of left.values()) leftMagnitude += value * value;
  for (const value of right.values()) rightMagnitude += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) ?? 0);
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

function tfIdfVectors(pages) {
  const termMaps = pages.map(page => cleanCountMap(page.features?.terms));
  const frequencies = new Map();
  for (const terms of termMaps) for (const term of terms.keys()) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  return termMaps.map(terms => new Map([...terms].map(([term, count]) => [
    term,
    (1 + Math.log(count)) * (Math.log((pages.length + 1) / ((frequencies.get(term) ?? 0) + 1)) + 1),
  ])));
}

function normalizedPages(pages) {
  const wordVectors = tfIdfVectors(pages);
  return pages.map((page, index) => {
    const labels = pageLabels(page);
    return {
      source: page,
      labels,
      informativeLabels: new Set([...labels].filter(label => label !== 'title')),
      tags: new Map([...cleanCountMap(page.features?.tags, { exclude: NEUTRAL_TAGS, limit: 100 })]
        .map(([tag, count]) => [tag, 1 + Math.log(count)])),
      terms: wordVectors[index],
    };
  });
}

function pageSimilarity(left, right) {
  const labelSimilarity = dice(left.informativeLabels, right.informativeLabels);
  const tagSimilarity = cosine(left.tags, right.tags);
  const termSimilarity = cosine(left.terms, right.terms);
  const leftHasLabels = left.informativeLabels.size > 0;
  const rightHasLabels = right.informativeLabels.size > 0;
  // Once both records expose fields, layout and prose are not schema identity.
  if (leftHasLabels && rightHasLabels) return labelSimilarity;
  if (leftHasLabels || rightHasLabels) return 0.62 * labelSimilarity + 0.18 * tagSimilarity + 0.20 * termSimilarity;
  return 0.85 * tagSimilarity + 0.15 * termSimilarity;
}

function distanceMatrix(pages) {
  const matrix = Array.from({ length: pages.length }, () => Array(pages.length).fill(0));
  for (let row = 1; row < pages.length; row++) {
    for (let column = 0; column < row; column++) {
      const distance = Math.max(0, Math.min(1, 1 - pageSimilarity(pages[row], pages[column])));
      matrix[row][column] = distance;
      matrix[column][row] = distance;
    }
  }
  return matrix;
}

function commonLabels(cluster, pages) {
  const counts = new Map();
  for (const index of cluster) {
    for (const label of pages[index].labels) {
      if (label !== 'title' && !label.startsWith('@type:')) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const minimum = Math.ceil(cluster.length * 0.75);
  return [...counts].filter(([, count]) => count >= minimum).map(([label]) => label).sort();
}

function displayLabel(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase();
}

function suggestedName(indices, pages, commonFields) {
  const types = new Map();
  for (const index of indices) {
    const pageTypes = new Set();
    for (const record of Array.isArray(pages[index].source.records) ? pages[index].source.records.slice(0, 100) : []) {
      if (typeof record?.type === 'string' && record.type.trim()) {
        pageTypes.add(record.type.trim().slice(0, 80));
      }
    }
    for (const type of pageTypes) types.set(type, (types.get(type) ?? 0) + 1);
  }
  const commonType = [...types].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (commonType && commonType[1] >= Math.ceil(indices.length * 0.75)) return `${displayLabel(commonType[0])} pages`;
  if (commonFields.length) return `Pages with ${commonFields.slice(0, 3).map(displayLabel).join(', ')}`;
  return indices.length === 1 ? 'Unmatched page' : 'Structurally similar pages';
}

function representative(indices, matrix, pages) {
  let best = indices[0];
  let bestDistance = Infinity;
  for (const candidate of indices) {
    const mean = indices.reduce((sum, other) => sum + matrix[candidate][other], 0) / indices.length;
    if (mean < bestDistance || (mean === bestDistance && pages[candidate].source.url < pages[best].source.url)) {
      best = candidate;
      bestDistance = mean;
    }
  }
  return pages[best].source.url;
}

function cohesion(indices, matrix) {
  if (indices.length < 2) return 1;
  let similarity = 0;
  let pairs = 0;
  for (let left = 0; left < indices.length; left++) {
    for (let right = 0; right < left; right++) {
      similarity += 1 - matrix[indices[left]][indices[right]];
      pairs++;
    }
  }
  return Number((similarity / pairs).toFixed(6));
}

export function clusterPages(inputPages, { threshold = 0.32, maxPages = MAX_HARD_PAGES } = {}) {
  if (!Array.isArray(inputPages)) throw new TypeError('pages must be an array');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError('threshold must be between 0 and 1');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_HARD_PAGES) {
    throw new RangeError(`maxPages must be an integer between 1 and ${MAX_HARD_PAGES}`);
  }
  if (inputPages.length > maxPages) throw new RangeError(`page count exceeds maxPages (${maxPages})`);
  for (const page of inputPages) {
    if (!page || typeof page !== 'object' || typeof page.url !== 'string' || !page.url.trim()) {
      throw new TypeError('each page must have a non-empty string url');
    }
  }
  const pagesByUrl = [...inputPages].sort((a, b) => a.url.localeCompare(b.url));
  for (let index = 1; index < pagesByUrl.length; index++) {
    if (pagesByUrl[index - 1].url === pagesByUrl[index].url) throw new Error(`duplicate page URL: ${pagesByUrl[index].url}`);
  }
  const pages = normalizedPages(pagesByUrl);
  const matrix = distanceMatrix(pages);
  let groups = [];
  if (pages.length === 1) groups = [[0]];
  if (pages.length > 1) groups = agnes(matrix, { method: 'average', isDistanceMatrix: true }).cut(threshold).map(cluster => cluster.indices());
  groups = groups.map(indices => indices.sort((a, b) => pages[a].source.url.localeCompare(pages[b].source.url)))
    .sort((a, b) => pages[a[0]].source.url.localeCompare(pages[b[0]].source.url));

  const clusterIdByIndex = new Map();
  const clusters = groups.map((indices, index) => {
    const id = `cluster-${String(index + 1).padStart(3, '0')}`;
    for (const pageIndex of indices) clusterIdByIndex.set(pageIndex, id);
    const commonFields = commonLabels(indices, pages);
    return {
      id,
      urls: indices.map(pageIndex => pages[pageIndex].source.url),
      count: indices.length,
      suggestedName: suggestedName(indices, pages, commonFields),
      commonFields,
      representativeUrl: representative(indices, matrix, pages),
      cohesion: cohesion(indices, matrix),
    };
  });
  const warnings = [];
  const noStructuredFields = pages.filter(page => !page.informativeLabels.size).length;
  const noFeatures = pages.filter(page => !page.tags.size && !page.terms.size).length;
  if (noStructuredFields) warnings.push(`${noStructuredFields} page(s) had no informative field labels; structure and terms carried their similarity.`);
  if (noFeatures) warnings.push(`${noFeatures} page(s) had no usable tag or term features.`);

  return {
    version: 1,
    method: 'agglomerative average-linkage over bounded heuristic distances (ml-hclust)',
    threshold,
    pages: pages.map((page, index) => ({
      url: page.source.url,
      cluster: clusterIdByIndex.get(index),
      fields: cleanFields(page.source.fields),
    })),
    clusters,
    warnings,
  };
}
