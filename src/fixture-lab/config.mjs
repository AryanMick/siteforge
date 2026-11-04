import { z } from 'zod';
import { DOMAINS, PRESETS } from '../site/presets.mjs';
import { CRAWLER_TRAP_TYPES, MARKUP_NOISE_TYPES } from '../site/config.mjs';
import { TRAP_SCENARIOS } from '../noise/crawler-traps.mjs';
import { OPT_IN_SCENARIOS, OPT_IN_TRANSPORT, SCENARIO_LABELS, TRANSPORT_LABELS } from './catalog.mjs';
import { CATALOG_SETTINGS, buildCatalogSiteConfig, getCatalogCase, listCatalogCases } from './case-catalog.mjs';
import { seedFor } from '../site/util.mjs';
import { SECTION_LABELS, siteNameFor } from '../site/domain-content.mjs';

export const FIXTURE_DOMAINS = [...DOMAINS];
export const FRAMEWORKS = ['html', 'react', 'angular'];
export const VISUAL_STYLES = ['legacy', 'conventional', 'modern'];
export const NOISE_LEVELS = ['clean', 'low', 'medium', 'high'];
export const CHALLENGES = ['standard', 'hard', 'extreme'];
export const FIELD_LAYOUTS = ['definition-list', 'table', 'paragraphs', 'mixed'];
export const SCENARIOS = Object.keys(SCENARIO_LABELS);

const SCENARIO_NOISE = {
  'legacy-clutter': ['extra-wrapper', 'class-churn', 'inline-style', 'boilerplate', 'malformed-nesting', 'duplicate-id', 'missing-metadata', 'reorder-fields', 'legacy-document', 'missing-main', 'deep-wrapper-tree', 'legacy-color-attribute', 'frame-missing-title', 'split-text-runs', 'entity-encoded-text', 'uppercase-legacy-tags', 'spacer-elements'],
  'inconsistent-fields': ['missing-field', 'label-variation', 'date-format', 'reorder-fields'],
  'client-delay': ['delayed-content'],
  'extraction-traps': ['boilerplate', 'comment-clutter', 'hidden-boilerplate', 'duplicate-heading', 'conflicting-metadata', 'link-variants', 'broken-image', 'image-missing-alt', 'onclick-navigation', 'javascript-only-link', 'hidden-reader-copy', 'analytics-beacon', 'microdata-attributes', 'inline-svg-icons'],
  'crawler-traps': [...CRAWLER_TRAP_TYPES],
  ...Object.fromEntries(Object.entries(TRAP_SCENARIOS).map(([name, types]) => [name, [...types]])),
  'parser-stress': ['extra-wrapper', 'malformed-nesting', 'duplicate-id', 'nested-layout-table', 'obsolete-markup', 'reorder-fields', 'missing-main', 'legacy-document', 'deep-wrapper-tree', 'legacy-color-attribute', 'frame-missing-title', 'uppercase-legacy-tags', 'entity-encoded-text', 'split-text-runs'],
};

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  siteCount: z.number().int().min(1).max(1440).default(1),
  pagesPerSite: z.number().int().min(0).max(100000).refine(value => value === 0 || value >= 5, 'Use at least 5 pages.').default(60),
  // true: pagesPerSite is the per-site maximum; every site gets a seeded random size and all sites share PAGE_BUDGET.
  randomPageCount: z.boolean().optional(),
  domain: z.enum([...DOMAINS, 'mixed', 'random']).default('library'),
  framework: z.enum([...FRAMEWORKS, 'mixed', 'random']).default('html'),
  visualStyle: z.enum([...VISUAL_STYLES, 'mixed', 'random']).default('conventional'),
  noise: z.enum([...NOISE_LEVELS, 'mixed', 'random']).default('clean'),
  challenge: z.enum([...CHALLENGES, 'random']).optional(),
  seed: z.number().int().min(0).max(0xffffffff).default(48291),
  randomness: z.number().int().min(0).max(100).optional(),
  fieldLayout: z.enum([...FIELD_LAYOUTS, 'random']).default('mixed'),
  linkMode: z.enum(['root-relative', 'relative', 'absolute', 'mixed', 'base-relative', 'random']).optional(),
  cmsProfile: z.enum(['none', 'wordpress', 'drupal', 'joomla', 'squarespace', 'webflow', 'hubspot', 'aem', 'sitecore', 'wix', 'shopify', 'ghost', 'random']).optional(),
  builderProfile: z.enum(['none', 'gutenberg', 'elementor', 'beaver-builder', 'divi', 'wpbakery', 'random']).optional(),
  sourceClutter: z.enum(['none', 'realistic']).optional(),
  optionalFields: z.union([z.boolean(), z.literal('random')]).default(true),
  scenario: z.enum([...SCENARIOS, 'random']).default('baseline'),
  transport: z.enum([...Object.keys(TRANSPORT_LABELS), 'random']).default('none'),
  previewProtocol: z.enum(['http', 'https', 'mixed', 'random']).default('http'),
  suite: z.enum(['custom', 'regression-1440', 'catalog-case']).default('custom'),
  caseId: z.string().regex(/^case-\d{4}$/).optional(),
}).strict().superRefine((value, context) => {
  const issue = (path, message) => context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.suite === 'custom') {
    if (value.previewProtocol === 'mixed') issue('previewProtocol', 'Choose HTTP or HTTPS for a custom batch.');
    if (value.siteCount > 500) issue('siteCount', 'Custom batches cannot exceed 500 websites.');
    if (value.caseId) issue('caseId', 'Case IDs require a catalog-case request.');
  } else {
    if (value.challenge !== undefined && value.challenge !== 'standard') issue('challenge', 'Catalog cases use their fixed challenge settings.');
    for (const [key, expected] of Object.entries(CATALOG_SETTINGS)) {
      if (key === 'suite' || key === 'siteCount') continue;
      if (key === 'previewProtocol' && value.suite === 'catalog-case') continue;
      if (value[key] !== expected) issue(key, `Catalog requests require ${key} to be ${expected}.`);
    }
    const count = value.suite === 'regression-1440' ? CATALOG_SETTINGS.siteCount : 1;
    if (value.siteCount !== count) issue('siteCount', `This catalog request requires ${count} websites.`);
    if (value.suite === 'catalog-case') {
      if (!value.caseId || !listCatalogCases({ id: value.caseId }).length) issue('caseId', 'Choose an existing catalog case.');
      else if (value.previewProtocol !== getCatalogCase(value.caseId).protocol) issue('previewProtocol', 'Protocol must match the selected catalog case.');
    } else if (value.caseId) issue('caseId', 'The full catalog does not accept a single case ID.');
  }
  if (value.randomPageCount === true) {
    if (value.suite !== 'custom') issue('randomPageCount', 'Catalog requests use fixed page counts.');
    if (value.pagesPerSite === 0) issue('pagesPerSite', 'Enter the maximum pages per site (5 to 100,000) for a random page count.');
  } else if (value.siteCount * (value.pagesPerSite || Math.min(200, Math.floor(100000 / value.siteCount))) > PAGE_BUDGET) context.addIssue({ code: z.ZodIssueCode.custom, path: ['siteCount'], message: 'Total generated pages cannot exceed 100,000.' });
  if (value.scenario === 'client-delay' && !['react', 'angular'].includes(value.framework)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['framework'], message: 'Client delay requires the React or Angular framework.' });
  if (['gutenberg', 'elementor', 'beaver-builder', 'divi', 'wpbakery'].includes(value.builderProfile) && value.cmsProfile !== 'wordpress') issue('builderProfile', 'Select WordPress for this page-builder markup.');
});

export function validateFixtureInput(input) { return schema.parse(input); }

export const PAGE_BUDGET = 100000;
export const MIN_RANDOM_PAGES = 5;

// Seeded per-site sizes from 5 to the requested maximum. When the draws would exceed the shared
// page budget they are scaled down proportionally (never below 5), so the whole set stays within it.
export function randomPageCounts(config) {
  const max = config.pagesPerSite;
  const counts = Array.from({ length: config.siteCount }, (_, index) => MIN_RANDOM_PAGES + seedFor(config.seed, index, 'random-page-count-v2') % (max - MIN_RANDOM_PAGES + 1));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= PAGE_BUDGET) return counts;
  const scaled = counts.map(count => Math.max(MIN_RANDOM_PAGES, Math.floor(count * PAGE_BUDGET / total)));
  let excess = scaled.reduce((sum, count) => sum + count, 0) - PAGE_BUDGET;
  while (excess > 0) {
    const largest = scaled.indexOf(Math.max(...scaled));
    const cut = Math.min(excess, scaled[largest] - MIN_RANDOM_PAGES);
    scaled[largest] -= cut; excess -= cut;
  }
  return scaled;
}

const randomCountCache = new WeakMap();
function cachedRandomPageCounts(config) {
  if (!randomCountCache.has(config)) randomCountCache.set(config, randomPageCounts(config));
  return randomCountCache.get(config);
}

export function pagesForSite(config, index) {
  if (config.randomPageCount === true) return cachedRandomPageCounts(config)[index];
  if (config.pagesPerSite !== 0) return config.pagesPerSite;
  // Legacy requests: 0 meant a random 5..200 pages per site.
  const max = Math.min(200, Math.floor(100000 / config.siteCount));
  return 5 + seedFor(config.seed, index, 'random-page-count') % (max - 4);
}

export function totalPlannedPages(config) {
  return Array.from({ length: config.siteCount }, (_, index) => pagesForSite(config, index)).reduce((total, count) => total + count, 0);
}

function select(value, choices, seed, index, salt) {
  if (value === 'random') return choices[seedFor(seed, index, salt, 'setting') % choices.length];
  if (value !== 'mixed') return value;
  return choices[(seed + index + salt) % choices.length];
}

function fittedPresetTypes(domain, pageCount) {
  const types = structuredClone(PRESETS[domain].types).slice(0, Math.floor((pageCount - 1) / 2));
  const retained = new Set(types.map(type => type.name));
  for (const type of types) if (type.relationTo && !retained.has(type.relationTo)) delete type.relationTo;
  return types;
}

export function sitePlan(input, index) {
  const value = validateFixtureInput(input);
  if (!Number.isInteger(index) || index < 0 || index >= value.siteCount) throw new RangeError('Site index is outside the requested batch');
  if (value.suite !== 'custom') {
    const descriptor = value.suite === 'catalog-case' ? getCatalogCase(value.caseId) : listCatalogCases()[index];
    const config = buildCatalogSiteConfig(descriptor.id, { seed: value.seed, pageCount: value.pagesPerSite, name: `${value.name} ${descriptor.id}` });
    return { id: descriptor.id, config, summary: {
      id: descriptor.id, caseId: descriptor.id, name: descriptor.label, domain: descriptor.domain,
      framework: descriptor.framework, fieldLayout: descriptor.fieldLayout, visualStyle: descriptor.visualStyle,
      noise: config.noise.level, scenario: descriptor.profile, transport: config.transport.profile,
      previewProtocol: descriptor.protocol, pageCount: config.site.pageCount, seed: config.seed,
    } };
  }
  const domain = select(value.domain, DOMAINS, value.seed, index, 0);
  const framework = select(value.framework, FRAMEWORKS, value.seed, index, 1);
  const visualStyle = select(value.visualStyle, VISUAL_STYLES, value.seed, index, 2);
  const noise = select(value.noise, NOISE_LEVELS, value.seed, index, 3);
  const fieldLayout = value.fieldLayout === 'mixed' ? 'mixed' : select(value.fieldLayout, FIELD_LAYOUTS.filter(item => item !== 'mixed'), value.seed, index, 4);
  const linkMode = value.linkMode === 'mixed' ? 'mixed' : select(value.linkMode, ['relative', 'absolute', 'mixed'], value.seed, index, 5);
  // Random CMS markup is WordPress or Drupal only (2026-11-04, the user's request). The other platform profiles can
  // still be asked for by name through the API and the case catalog, but the app and Random never pick them.
  const cmsProfile = select(value.cmsProfile, ['wordpress', 'drupal'], value.seed, index, 10);
  const builderProfile = cmsProfile === 'wordpress' ? select(value.builderProfile, ['none', 'gutenberg', 'elementor', 'beaver-builder', 'divi', 'wpbakery'], value.seed, index, 11) : 'none';
  // Crawler traps widen the URL space, so the random choice never selects them implicitly.
  const scenario = select(value.scenario, SCENARIOS.filter(item => !OPT_IN_SCENARIOS.includes(item)).filter(item => item !== 'client-delay' || framework !== 'html'), value.seed, index, 6);
  const transport = value.transport === 'mixed' ? 'mixed' : select(value.transport, Object.keys(TRANSPORT_LABELS).filter(item => !OPT_IN_TRANSPORT.includes(item)), value.seed, index, 7);
  const previewProtocol = select(value.previewProtocol, ['http', 'https'], value.seed, index, 8);
  const challenge = select(value.challenge, CHALLENGES, value.seed, index, 9);
  const optionalFields = value.optionalFields === 'random' ? seedFor(value.seed, index, 'optional-fields') % 2 === 0 : value.optionalFields;
  const pageCount = pagesForSite(value, index);
  const seed = (value.seed + Math.imul(index, 0x9e3779b1)) >>> 0;
  const id = `site-${String(index + 1).padStart(3, '0')}-${domain}`;
  const siteName = siteNameFor(domain, seed) ?? `${value.name} ${index + 1}`;
  const contentTypes = fittedPresetTypes(domain, pageCount).map(type => {
    const labels = SECTION_LABELS[domain]?.[type.name];
    if (labels) type.label = labels[seedFor(seed, id, type.name, 'section-label') % labels.length];
    type.fieldLayout = fieldLayout;
    if (optionalFields) {
      const optional = type.fields.findLast(field => field.name !== 'title' && field.type !== 'image' && !field.optional);
      if (optional) Object.assign(optional, { optional: true, presenceProbability: 0.5 });
    } else {
      for (const field of type.fields) if (field.optional) field.presenceProbability = 1;
    }
    return type;
  });
  const noiseTypes = (scenario === 'baseline' ? MARKUP_NOISE_TYPES : SCENARIO_NOISE[scenario])
    .filter(type => type !== 'delayed-content' || framework !== 'html')
    .filter(type => type !== 'missing-main' || framework === 'html');
  return {
    id,
    config: {
      version: 1,
      seed,
      ...(challenge === undefined ? {} : { challenge }),
      site: { id, name: siteName, domain, framework, visualStyle, ...(linkMode ? { linkMode } : {}), ...(cmsProfile ? { cmsProfile, builderProfile } : {}), ...(value.sourceClutter ? { sourceClutter: value.sourceClutter } : {}), pageCount, baseUrl: `http://${id}.siteforge.test` },
      contentTypes,
      ...(value.randomness === undefined ? {} : { variation: { amount: value.randomness } }),
      noise: { level: noise, types: noiseTypes },
      transport: { profile: transport },
      previewProtocol,
      limits: { maxPages: pageCount },
    },
    summary: { id, name: siteName, domain, framework, visualStyle, fieldLayout, linkMode, cmsProfile, builderProfile, ...(value.sourceClutter ? { sourceClutter: value.sourceClutter } : {}), noise, scenario, transport, previewProtocol, optionalFields, pageCount, seed, ...(challenge === undefined ? {} : { challenge }), ...(value.randomness === undefined ? {} : { randomness: value.randomness }) },
  };
}
