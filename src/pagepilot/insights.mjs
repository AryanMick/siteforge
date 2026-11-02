const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const LAYOUT_EXCLUDED_TAGS = new Set(['div', 'span', 'script', 'style']);
const MAX_FIELDS = 100;
const MAX_EXAMPLES = 3;
const MAX_VALUE_LENGTH = 150;
const MAX_PATH_PATTERNS = 8;
const MAX_LAYOUT_VARIANTS = 6;

function safeEntries(value, limit = Infinity) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([key]) => key && !UNSAFE_KEYS.has(key))
    .slice(0, limit);
}

function asBoundedText(value, limit = MAX_VALUE_LENGTH) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, limit);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, limit);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return String(value).slice(0, limit);
  return '';
}

function valueType(value) {
  const text = asBoundedText(value);
  if (!text) return 'text';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return 'number';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email';
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return 'url';
  } catch { /* Not an absolute web URL. */ }
  // Require an unambiguous, real year-first date rather than Date.parse's locale guesses.
  const dateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    const checked = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (checked.getUTCFullYear() === Number(year) && checked.getUTCMonth() === Number(month) - 1 && checked.getUTCDate() === Number(day)) return 'date';
  }
  return 'text';
}

function inferredType(types) {
  return types.size === 1 ? [...types][0] : 'mixed';
}

function pathPattern(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  let pathname;
  try {
    pathname = new URL(rawUrl, 'https://pagepilot.invalid').pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter(Boolean);
  if (!segments.length) return '/*';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const numericId = /^\d+$/;
  let generalized = false;
  const normalized = segments.map(segment => {
    if (uuid.test(segment)) {
      generalized = true;
      return ':uuid';
    }
    if (numericId.test(segment)) {
      generalized = true;
      return ':id';
    }
    return segment;
  });
  if (generalized) return `/${normalized.join('/')}`;
  return segments.length === 1 ? '/*' : `/${segments.slice(0, -1).join('/')}/*`;
}

function countBucket(count) {
  if (count === 1) return '1';
  if (count <= 3) return '2-3';
  if (count <= 7) return '4-7';
  return '8+';
}

function layoutSignature(page) {
  const tags = safeEntries(page?.features?.tags, 200)
    .filter(([tag, count]) => /^[a-z][a-z0-9-]{0,30}$/i.test(tag)
      && !LAYOUT_EXCLUDED_TAGS.has(tag.toLowerCase())
      && Number.isFinite(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 30);
  if (!tags.length) return '(no semantic tag counts)';
  return tags.map(([tag, count]) => `${tag.toLowerCase()}:${countBucket(count)}`).join(', ');
}

function summarizeLayoutVariants(pages) {
  const counts = new Map();
  for (const page of pages) {
    const signature = layoutSignature(page);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return [...counts]
    .map(([signature, pages]) => ({ signature, pages }))
    .sort((left, right) => right.pages - left.pages || left.signature.localeCompare(right.signature))
    .slice(0, MAX_LAYOUT_VARIANTS);
}

function summarizePaths(pages) {
  const counts = new Map();
  for (const page of pages) {
    const pattern = pathPattern(page?.url);
    if (pattern) counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_PATH_PATTERNS)
    .map(([pattern]) => pattern);
}

function summarizeFields(pages) {
  const fields = new Map();
  for (const page of pages) {
    for (const [name, value] of safeEntries(page?.fields, MAX_FIELDS)) {
      let field = fields.get(name);
      if (!field) {
        field = { present: 0, values: [], types: new Set() };
        fields.set(name, field);
      }
      field.present++;
      const text = asBoundedText(value);
      if (text) field.values.push(text);
      field.types.add(valueType(value));
    }
  }
  const total = pages.length;
  const summarized = [...fields]
    .map(([name, field]) => ({
      name,
      present: field.present,
      total,
      coverage: total ? field.present / total : 0,
      inferredType: inferredType(field.types),
      examples: [...new Set(field.values)].sort((left, right) => left.localeCompare(right)).slice(0, MAX_EXAMPLES),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    fields: summarized,
    sharedFields: summarized.filter(field => field.total > 0 && field.present === field.total).map(field => field.name),
    variableFields: summarized.filter(field => field.present < field.total).map(field => field.name),
  };
}

const NOTES = Object.freeze([
  'Similarity uses Dice overlap of recognized field labels, excluding title, when pages have recognized fields.',
  'Values and topic text are ignored for similarity when recognized field labels are available.',
  'When labels are missing, clustering falls back to tag and term features.',
  'Fields that vary here may be optional, but no authoritative schema was observed.',
  'Cohesion is a clustering heuristic, not accuracy or confidence.',
]);

function clusterPagesFromRaw(rawByUrl, urls) {
  const seen = new Set();
  return (Array.isArray(urls) ? urls : [])
    .filter(url => typeof url === 'string' && !seen.has(url) && seen.add(url))
    .sort((left, right) => left.localeCompare(right))
    .map(url => rawByUrl.get(url))
    .filter(Boolean);
}

function stablePageFingerprint(page) {
  const fields = safeEntries(page?.fields, MAX_FIELDS)
    .map(([name, value]) => `${name}\u0000${asBoundedText(value, 1_000)}`)
    .sort()
    .join('\u0001');
  const tags = safeEntries(page?.features?.tags, 200)
    .filter(([, count]) => Number.isFinite(count))
    .map(([tag, count]) => `${tag}\u0000${count}`)
    .sort()
    .join('\u0001');
  return `${fields}\u0002${tags}`;
}

/**
 * Produces bounded, observed summaries. It never consults ground truth, fetches URLs,
 * or treats fields, routes, layouts, or cluster membership as a confirmed schema.
 */
export function buildClusterInsights(pages, clustered) {
  const rawByUrl = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!page || typeof page !== 'object' || typeof page.url !== 'string' || !page.url) continue;
    // A crawler normally has unique URLs; this keeps malformed duplicate inputs deterministic.
    const existing = rawByUrl.get(page.url);
    if (!existing || stablePageFingerprint(page).localeCompare(stablePageFingerprint(existing)) < 0) rawByUrl.set(page.url, page);
  }
  const insights = {};
  const clusters = Array.isArray(clustered?.clusters) ? [...clustered.clusters] : [];
  for (const cluster of clusters.sort((left, right) => String(left?.id ?? '').localeCompare(String(right?.id ?? '')))) {
    const id = typeof cluster?.id === 'string' ? cluster.id : '';
    if (!id || UNSAFE_KEYS.has(id)) continue;
    const members = clusterPagesFromRaw(rawByUrl, cluster.urls);
    const fieldSummary = summarizeFields(members);
    insights[id] = {
      representativeUrl: typeof cluster.representativeUrl === 'string' ? cluster.representativeUrl : '',
      cohesion: cluster.cohesion,
      fields: fieldSummary.fields,
      sharedFields: fieldSummary.sharedFields,
      variableFields: fieldSummary.variableFields,
      pathPatterns: summarizePaths(members),
      layoutVariants: summarizeLayoutVariants(members),
      notes: [...NOTES],
    };
  }
  return insights;
}
