import { LEGACY_NOISE_TYPES } from '../config.mjs';
import { OBSTACLE_CATALOG } from './catalog.mjs';
import { DOMAINS, PRESETS } from '../presets.mjs';

export const CATALOG_VERSION = 1;

export const CATALOG_SETTINGS = Object.freeze({
  siteCount: 1440,
  pagesPerSite: 16,
  domain: 'mixed',
  framework: 'mixed',
  visualStyle: 'legacy',
  noise: 'high',
  fieldLayout: 'mixed',
  optionalFields: true,
  scenario: 'baseline',
  transport: 'mixed',
  previewProtocol: 'mixed',
  suite: 'regression-1440',
});

const ALL_NOISE_TYPES = OBSTACLE_CATALOG.filter(item => LEGACY_NOISE_TYPES.includes(item.id)).map(item => item.id);

export const CASE_PROFILES = Object.freeze([
  profile('clean-control', 'Clean control', [], 'none', true),
  profile('legacy-structure', 'Legacy structure', [
    'extra-wrapper', 'class-churn', 'inline-style', 'reorder-fields',
    'malformed-nesting', 'duplicate-id', 'nested-layout-table', 'obsolete-markup',
  ]),
  profile('extraction-decoys', 'Extraction decoys', [
    'boilerplate', 'comment-clutter', 'hidden-boilerplate',
    'duplicate-heading', 'conflicting-metadata', 'missing-metadata',
  ]),
  profile('field-variations', 'Field variations', [
    'missing-field', 'label-variation', 'date-format', 'reorder-fields',
  ]),
  profile('resources-rendering', 'Resources and rendering', [
    'link-variants', 'broken-image', 'delayed-content',
  ]),
  profile('http-faults', 'HTTP faults', ALL_NOISE_TYPES, 'mixed'),
]);

// 2026-11-02: real-world failure patterns, appended as case-1441 onwards so the original
// case-0001..case-1440 IDs (the regression-1440 suite) never move. Every type below already
// exists in MARKUP_NOISE_TYPES or CRAWLER_TRAP_TYPES; html-only types are dropped for React/Angular
// and delayed-content for HTML, exactly as the core profiles do.
export const REAL_WORLD_PROFILES = Object.freeze([
  realWorld('word-paste', 'Pasted from Word',
    'Copy pasted from Microsoft Word or Outlook into a WYSIWYG editor, as on many university, council and charity sites: MsoNormal span runs, &nbsp; spacer paragraphs, character entities, font colours and windows-1252 bytes behind a conflicting charset.',
    ['split-text-runs', 'entity-encoded-text', 'spacer-elements', 'inline-style', 'obsolete-markup', 'legacy-color-attribute', 'class-churn', 'windows-1252-documents', 'charset-conflict']),
  realWorld('legacy-dreamweaver', 'Dreamweaver-era table site',
    'Hand-built 2000s Dreamweaver/FrontPage sites on IIS: upper-case tags, nested layout tables, spacer cells, bgcolor attributes, MM_swapImage rollover and document.write menus, image maps and no main landmark.',
    ['uppercase-legacy-tags', 'nested-layout-table', 'spacer-elements', 'legacy-color-attribute', 'obsolete-markup', 'legacy-document', 'missing-main', 'image-missing-alt', 'image-map-navigation', 'dhtml-hover-menu', 'document-write-menu', 'ie-conditional-links', 'mixed-case-extensions', 'default-document-aliases'],
    { transportProfile: 'legacy-server' }),
  realWorld('seo-plugin-heavy', 'Stacked WordPress SEO plugins',
    'WordPress with Yoast SEO and Rank Math (or All in One SEO) active at once: schema.org microdata plus contradicting JSON-LD, two canonicals, extra titles, og:/twitter: URL conflicts, screen-reader text, tracking pixels and sitemap/robots quirks.',
    ['microdata-attributes', 'structured-data-conflict', 'multiple-canonical', 'title-anomalies', 'social-url-conflicts', 'meta-robots-variants', 'hidden-reader-copy', 'analytics-beacon', 'rel-link-hints', 'feed-links', 'sitemap-traps', 'robots-txt-traps', 'shortcode-residue'],
    { site: { cmsProfile: 'wordpress', builderProfile: 'none' } }),
  realWorld('calendar-facets', 'Event calendar and facet explosion',
    'Drupal Views exposed filters and event-calendar modules (as on council, museum and university event listings): endless next-month/next-day calendars, year/month/day archives, faceted filters, sort parameters, tag-cloud search and session IDs.',
    ['calendar-trap', 'day-calendar-trap', 'date-archive-trap', 'faceted-navigation', 'sort-order-params', 'pagination-query-variants', 'search-tag-cloud', 'session-id-urls', 'login-wall-links'],
    { site: { cmsProfile: 'drupal' } }),
  realWorld('analytics-heavy', 'Tag-manager marketing site',
    'HubSpot-style marketing sites run through Google Tag Manager: consent banners over the content, tracking pixels, utm_ parameters on internal links, inline SVG icon sprites, links that only exist in scripts, JSON or data-href, and lazy images.',
    ['analytics-beacon', 'inline-svg-icons', 'cookie-consent-wall', 'tracking-params', 'hidden-reader-copy', 'js-string-links', 'json-blob-links', 'data-attribute-links', 'lazy-load-noscript', 'onclick-navigation', 'delayed-content'],
    { site: { cmsProfile: 'hubspot', sourceClutter: 'realistic' } }),
  realWorld('migration-redirects', 'Half-finished platform migration',
    'A site part-way through a replatform (for example .aspx to WordPress, or HTTP to HTTPS): redirect chains, canonical chains to the new host, meta-refresh and JavaScript stubs, mixed relative/absolute links, http/https and protocol-relative duplicates, default-document aliases and dated copies.',
    ['canonical-chain', 'canonical-cross-host', 'meta-refresh-link', 'js-redirect-page', 'cross-scheme-links', 'protocol-relative-links', 'duplicate-url-aliases', 'default-document-aliases', 'near-duplicate-dated', 'tracking-params', 'link-variants'],
    { transportProfile: 'redirects', site: { linkMode: 'mixed' } }),
  realWorld('aspnet-webforms', 'ASP.NET WebForms intranet',
    'ASP.NET WebForms sites on IIS (common for public-sector portals): __doPostBack links, drop-down jump menus, GET search forms, cookieless session IDs in the path, Default.aspx aliases, mixed-case .ASPX extensions and window.open pop-ups.',
    ['postback-link', 'select-navigation', 'form-get-navigation', 'session-id-urls', 'default-document-aliases', 'mixed-case-extensions', 'window-open-popup', 'javascript-only-link', 'deep-wrapper-tree', 'frame-missing-title'],
    { transportProfile: 'legacy-server', site: { linkMode: 'root-relative' } }),
]);

export const ALL_CASE_PROFILES = Object.freeze([...CASE_PROFILES, ...REAL_WORLD_PROFILES]);
const HTML_ONLY_TYPES = new Set(['missing-main', 'uppercase-legacy-tags']);

const FRAMEWORKS = Object.freeze(['html', 'react', 'angular']);
const FIELD_LAYOUTS = Object.freeze(['definition-list', 'table', 'paragraphs', 'mixed']);
const PROTOCOLS = Object.freeze(['http', 'https']);
const FILTER_KEYS = new Set(['id', 'domain', 'framework', 'fieldLayout', 'protocol', 'profile', 'visualStyle', 'set']);
const CASE_SETS = new Set(['core', 'real-world', 'all']);

const CASES = Object.freeze([...buildCases(CASE_PROFILES, 'core', 0), ...buildCases(REAL_WORLD_PROFILES, 'real-world', CATALOG_SETTINGS.siteCount)]);
export const CORE_CASE_COUNT = CATALOG_SETTINGS.siteCount;
export const TOTAL_CASE_COUNT = CASES.length;
const CASES_BY_ID = new Map(CASES.map(item => [item.id, item]));

export function listCatalogCases(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new TypeError('filters must be an object');
  for (const key of Object.keys(filters)) if (!FILTER_KEYS.has(key)) throw new TypeError(`Unknown catalog filter: ${key}`);
  // Without a set filter the list is the 1,440-case regression suite, so existing callers keep their indexes.
  // Pass { set: 'real-world' } for case-1441 onwards or { set: 'all' } for every case. An id lookup searches every set.
  const { set = filters.id === undefined ? 'core' : 'all', ...rest } = filters;
  if (!CASE_SETS.has(set)) throw new TypeError(`Unknown catalog set: ${set}`);
  return CASES.filter(item => (set === 'all' || item.set === set) && Object.entries(rest).every(([key, expected]) => matches(item[key], expected)))
    .map(item => ({ ...item }));
}

export function getCatalogCase(id) {
  const item = CASES_BY_ID.get(id);
  if (!item) throw new Error(`Unknown catalog case: ${id}`);
  return { ...item };
}

export function buildCatalogSiteConfig(id, { seed = 48291, pageCount = 16, name } = {}) {
  const item = getCatalogCase(id);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('seed must be an unsigned 32-bit integer');
  if (!Number.isInteger(pageCount) || pageCount < 12 || pageCount > 100000) throw new TypeError('pageCount must be an integer from 12 to 100000');
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) throw new TypeError('name must be a non-empty string');

  const selected = ALL_CASE_PROFILES.find(profileItem => profileItem.id === item.profile);
  const noiseTypes = selected.types
    .filter(type => type !== 'delayed-content' || item.framework !== 'html')
    .filter(type => !HTML_ONLY_TYPES.has(type) || item.framework === 'html');
  const contentTypes = structuredClone(PRESETS[item.domain].types);
  for (const contentType of contentTypes) {
    contentType.fieldLayout = item.fieldLayout;
    const optional = contentType.fields.findLast(field => field.name !== 'title');
    if (optional) Object.assign(optional, { optional: true, presenceProbability: 0.5 });
  }

  const noise = selected.noise === 'clean'
    ? { level: 'clean', probability: 0, severity: 1, maxPerPage: 0, types: [] }
    : { level: 'custom', probability: 1, severity: 3, maxPerPage: noiseTypes.length, types: noiseTypes };

  return {
    version: 1,
    seed,
    previewProtocol: item.protocol,
    site: {
      id: item.id,
      name: name?.trim() || item.label,
      domain: item.domain,
      framework: item.framework,
      visualStyle: item.visualStyle,
      ...selected.site,
      pageCount,
      baseUrl: `${item.protocol}://${item.id}.example.test`,
    },
    contentTypes,
    noise,
    transport: { profile: selected.transportProfile },
    limits: { maxPages: pageCount },
  };
}

function realWorld(id, label, description, noiseTypes, { transportProfile = 'none', site = {} } = {}) {
  return Object.freeze({ ...profile(id, label, noiseTypes, transportProfile), description, site: Object.freeze({ ...site }) });
}

function profile(id, label, noiseTypes, transportProfile = 'none', clean = false) {
  return Object.freeze({
    id,
    label,
    site: Object.freeze({}),
    types: Object.freeze([...noiseTypes]),
    noise: clean ? 'clean' : 'custom',
    probability: clean ? 0 : 1,
    severity: clean ? 1 : 3,
    maxPerPage: clean ? 0 : noiseTypes.length,
    transportProfile,
  });
}

function matches(actual, expected) {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

function title(value) {
  return value.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function buildCases(profiles, set, offset) {
  const result = [];
  for (const domain of DOMAINS) {
    for (const framework of FRAMEWORKS) {
      for (const fieldLayout of FIELD_LAYOUTS) {
        for (const protocol of PROTOCOLS) {
          for (const profileItem of profiles) {
            const id = `case-${String(offset + result.length + 1).padStart(4, '0')}`;
            result.push(Object.freeze({
              id,
              label: `${title(domain)} | ${framework.toUpperCase()} | ${title(fieldLayout)} | ${protocol.toUpperCase()} | ${profileItem.label}`,
              domain,
              framework,
              fieldLayout,
              protocol,
              profile: profileItem.id,
              visualStyle: 'legacy',
              set,
            }));
          }
        }
      }
    }
  }
  return result;
}
