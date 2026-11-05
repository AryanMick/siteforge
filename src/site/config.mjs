import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { DOMAINS, PRESETS } from './presets.mjs';
import { slug } from './util.mjs';
import { CRAWLER_TRAP_TYPES, TRAP_RESERVED_SLUGS } from '../noise/crawler-traps.mjs';

export const DEFAULT_NOISE_TYPES = ['extra-wrapper', 'class-churn', 'inline-style', 'reorder-fields', 'boilerplate', 'missing-field', 'label-variation', 'date-format', 'malformed-nesting', 'duplicate-id', 'missing-metadata', 'delayed-content'];
export const LEGACY_NOISE_TYPES = [...DEFAULT_NOISE_TYPES, 'comment-clutter', 'hidden-boilerplate', 'duplicate-heading', 'nested-layout-table', 'link-variants', 'broken-image', 'conflicting-metadata', 'obsolete-markup'];
export const MARKUP_NOISE_TYPES = [...LEGACY_NOISE_TYPES, 'missing-main', 'legacy-document', 'image-missing-alt', 'onclick-navigation', 'javascript-only-link', 'deep-wrapper-tree', 'frame-missing-title', 'legacy-color-attribute', 'shortcode-residue',
  // 2026-11-02: eight more operators (text runs, character references, legacy tag case, microdata, icons, screen-reader text, beacons, spacers).
  'split-text-runs', 'entity-encoded-text', 'uppercase-legacy-tags', 'microdata-attributes', 'inline-svg-icons', 'hidden-reader-copy', 'analytics-beacon', 'spacer-elements',
  // 2026-11-05: page-builder modules (photo, button, audio player, content slider) added beside the page content.
  'builder-modules'];
// Markup operators that are valid in noise.types but left out of the default "baseline" scenario, so existing seeds keep building the same sites.
export const OPT_IN_NOISE_TYPES = ['builder-modules'];
// Crawler traps expand the URL space a crawler sees, so they are opt-in (crawler-traps scenario or explicit noise.types).
export { CRAWLER_TRAP_TYPES };
export const NOISE_TYPES = [...MARKUP_NOISE_TYPES, ...CRAWLER_TRAP_TYPES];
export const PROFILES = { clean: { probability: 0, severity: 1, maxPerPage: 0 }, low: { probability: 0.12, severity: 1, maxPerPage: 2 }, medium: { probability: 0.35, severity: 2, maxPerPage: 4 }, high: { probability: 0.7, severity: 3, maxPerPage: 7 }, custom: { probability: 0.35, severity: 2, maxPerPage: 4 } };
const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/).refine(v => !['__proto__', 'constructor', 'prototype'].includes(v), 'Reserved name');
const fieldSchema = z.object({ name, type: z.enum(['title', 'text', 'person', 'date', 'place', 'address', 'isbn', 'image']).default('text'), optional: z.boolean().optional(), presenceProbability: z.number().min(0).max(1).optional() }).strict();
const typeSchema = z.object({ name, label: z.string().min(1).max(100), weight: z.number().int().min(1).max(100).default(1), fields: z.array(fieldSchema).min(1).max(30), fieldLayout: z.enum(['definition-list', 'table', 'paragraphs', 'mixed']).optional(), relationTo: name.optional() }).strict();
const schema = z.object({
  version: z.literal(1).default(1), seed: z.number().int().min(0).max(0xffffffff).default(48291),
  challenge: z.enum(['standard', 'hard', 'extreme']).optional(),
  site: z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), name: z.string().min(1).max(150).optional(), domain: z.enum(DOMAINS).default('library'), framework: z.enum(['html', 'react', 'angular']).default('html'), rendering: z.enum(['static', 'client']).optional(), visualStyle: z.enum(['legacy', 'conventional', 'modern']).default('conventional'), linkMode: z.enum(['root-relative', 'relative', 'absolute', 'mixed', 'base-relative']).optional(), cmsProfile: z.enum(['none', 'wordpress', 'drupal', 'joomla', 'squarespace', 'webflow', 'hubspot', 'aem', 'sitecore', 'wix', 'shopify', 'ghost']).optional(), builderProfile: z.enum(['none', 'gutenberg', 'elementor', 'beaver-builder', 'divi', 'wpbakery']).optional(), sourceClutter: z.enum(['none', 'realistic']).optional(), pageCount: z.number().int().min(5).max(100000).default(500), pageSize: z.number().int().min(5).max(100).default(24), baseUrl: z.string().url().default('http://127.0.0.1:4310') }).strict(),
  contentTypes: z.array(typeSchema).min(1).max(12).optional(),
  contentPool: z.array(z.string().min(20).max(4000)).min(1).max(1000).optional(),
  variation: z.object({ amount: z.number().int().min(0).max(100) }).strict().optional(),
  previewProtocol: z.enum(['http', 'https']).default('http'),
  transport: z.object({ profile: z.enum(['none', 'errors', 'redirects', 'mixed', 'legacy-server']).default('none') }).strict().default({}),
  noise: z.object({ level: z.enum(['clean', 'low', 'medium', 'high', 'custom']).default('clean'), probability: z.number().min(0).max(1).optional(), severity: z.number().int().min(1).max(3).optional(), maxPerPage: z.number().int().min(0).max(NOISE_TYPES.length).optional(), types: z.array(z.enum(NOISE_TYPES)).optional(), overrides: z.record(z.enum(NOISE_TYPES), z.number().min(0).max(1)).default({}) }).strict().default({}),
  limits: z.object({ maxPages: z.number().int().min(5).max(100000).default(100000) }).strict().default({})
}).strict();

export function validateConfig(input) {
  const explicitContentTypes = input?.contentTypes !== undefined;
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(`Invalid configuration:\n${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n')}`);
  const c = result.data;
  const preset = PRESETS[c.site.domain];
  c.site.name ??= preset.name;
  c.site.rendering ??= c.site.framework === 'html' ? 'static' : 'client';
  if ((c.site.framework === 'html') !== (c.site.rendering === 'static')) throw new Error('Supported combinations are html/static, react/client and angular/client.');
  if (c.site.builderProfile && c.site.builderProfile !== 'none' && c.site.cmsProfile !== 'wordpress') throw new Error('Page-builder markup profiles require the WordPress CMS profile.');
  const origin = new URL(c.site.baseUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('site.baseUrl must be a plain http(s) origin without credentials, path, query or fragment.');
  c.site.baseUrl = origin.origin;
  if (c.site.pageCount > c.limits.maxPages) throw new Error('pageCount exceeds limits.maxPages');
  if (!explicitContentTypes) {
    const typeLimit = Math.floor((c.site.pageCount - 1) / 2);
    c.contentTypes = structuredClone(preset.types).slice(0, typeLimit);
    const retained = new Set(c.contentTypes.map(type => type.name));
    for (const type of c.contentTypes) if (type.relationTo && !retained.has(type.relationTo)) delete type.relationTo;
  }
  const names = c.contentTypes.map(t => t.name);
  if (new Set(names).size !== names.length) throw new Error('Duplicate content type name');
  if (new Set(c.contentTypes.map(t => slug(t.label))).size !== names.length) throw new Error('Content type labels must have unique URL slugs');
  if (c.contentTypes.some(t => ['site-information','assets','private','page', ...TRAP_RESERVED_SLUGS].includes(slug(t.label)))) throw new Error('Content type label uses a reserved URL slug');
  if (names.some(n => ['home', 'listing', 'information'].includes(n))) throw new Error('home, listing and information are reserved content types');
  if (c.site.pageCount < 2 * names.length + 1) throw new Error('pageCount must accommodate a home, listing and detail for every type');
  for (const t of c.contentTypes) {
    if (new Set(t.fields.map(f => f.name)).size !== t.fields.length) throw new Error(`Duplicate fields in ${t.name}`);
    if (t.fields.filter(f => f.type === 'image').length > 1) throw new Error(`${t.name} supports one image field`);
    if (!t.fields.some(f => f.name === 'title' && f.type === 'title')) throw new Error(`${t.name} requires a title field of type title`);
    for (const f of t.fields) {
      if (f.name === 'title' && f.optional) throw new Error('title cannot be optional');
      if (f.presenceProbability !== undefined && !f.optional) throw new Error('presenceProbability requires an optional field');
    }
    if (t.relationTo && !names.includes(t.relationTo)) throw new Error(`Unknown relation target ${t.relationTo}`);
  }
  c.noise = { ...PROFILES[c.noise.level], ...Object.fromEntries(Object.entries(c.noise).filter(([,v]) => v !== undefined)) };
  c.noise.types ??= DEFAULT_NOISE_TYPES.filter(t => t !== 'delayed-content' || c.site.framework !== 'html');
  if (new Set(c.noise.types).size !== c.noise.types.length) throw new Error('Duplicate noise types');
  if (c.site.framework === 'html' && c.noise.types.includes('delayed-content')) throw new Error('delayed-content requires a client framework');
  if (c.noise.level === 'clean' && (c.noise.probability !== 0 || c.noise.maxPerPage !== 0 || Object.values(c.noise.overrides).some(v => v !== 0))) throw new Error('clean noise must have zero probability and maxPerPage');
  if (c.noise.level !== 'clean' && ['hard', 'extreme'].includes(c.challenge)) {
    c.noise.probability = c.challenge === 'hard' ? 0.85 : 1;
    c.noise.severity = 3;
    c.noise.maxPerPage = c.challenge === 'hard' ? Math.min(10, c.noise.types.length) : c.noise.types.length;
    c.noise.overrides = {};
  }
  return c;
}
export async function loadConfig(path) { return validateConfig(parse(await readFile(path, 'utf8'))); }
