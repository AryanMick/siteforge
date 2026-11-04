import { Faker, en } from '@faker-js/faker';
import { PRESETS } from './presets.mjs';
import { VERSION, seedFor, slug, chance, hash, normalizeSourceText } from './util.mjs';
import { planFieldLocations } from '../answers/field-locations.mjs';
import { planRepeatedItemLocations } from '../answers/repeated-item-locations.mjs';
import { MEDIA_POOL } from './illustrations.mjs';
import { IMAGE_ALT, SITE_DESCRIPTIONS, domainSentences, domainShortValue, domainTitle, isPersonType, personName, town } from './domain-content.mjs';

const FIELD_LAYOUTS = ['definition-list', 'table', 'paragraphs'];

export function listingItemSchema(type) {
  const scalar = type.fields.find(field => field.name !== 'title' && field.type !== 'image');
  const text = type.fields.find(field => field.type === 'text' && field.name !== scalar?.name);
  return [type.fields.find(field => field.name === 'title'), scalar, text]
    .filter(Boolean)
    .map(field => ({ name: field.name, type: field.type, optional: Boolean(field.optional) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function listingClusterId(itemSchema) {
  return `listing-${hash(itemSchema).slice(0, 16)}`;
}

function imagePathFor(config, type, index) {
  if (!config.variation?.amount) return '/assets/collection.png';
  const variant = seedFor(config.seed, config.site.id, type.name, index, 'variation-image') % 4;
  return `/assets/collection-${variant + 1}.png`;
}

function paragraph(faker, topic, field, domain, index, pool, variation) {
  if (pool) return pool[faker.number.int({ min: 0, max: pool.length - 1 })];
  const group = faker.helpers.arrayElement(['residents', 'researchers', 'visitors', 'community partners', 'students']);
  const place = faker.location.city();
  const phase = faker.helpers.arrayElement(['planning', 'assessment', 'documentation', 'review', 'delivery']);
  const sentences = domainSentences(faker, domain, field, topic, index, variation.subjectName) ?? [
    `This ${domain} resource covers ${topic} for ${group} in ${place}.`,
    `The ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} describes ${phase}, local responsibilities and the materials available for this subject.`,
    `Entry ${index + 1} includes background from the ${2020 + index % 6} collection, an overview of related work and the next scheduled review.`,
    'Readers can follow the associated records for additional context.',
    `The accompanying notes connect this subject with ${topic} materials held elsewhere in the collection.`,
    `A follow-up review is planned for ${2026 + index % 4}.`,
  ];
  if (!variation.amount) return sentences.slice(0, 4).join(' ');
  const spread = Math.ceil(variation.amount / 34);
  const selector = seedFor(variation.seed, field, 'content-length');
  const count = Math.max(1, Math.min(sentences.length, 4 + selector % (spread * 2 + 1) - spread));
  const selected = sentences.slice(0, count);
  if (count < 2 || chance(variation.seed, field, 'paragraph-break') >= variation.amount / 100) return selected.join(' ');
  const breakAfter = 1 + seedFor(variation.seed, field, 'paragraph-position') % (count - 1);
  return `${selected.slice(0, breakAfter).join(' ')}\n\n${selected.slice(breakAfter).join(' ')}`;
}

function valuesFor(config, type, index) {
  const faker = new Faker({ locale: [en] });
  const recordSeed = seedFor(config.seed, config.site.id, type.name, index);
  const amount = config.variation?.amount ?? 0;
  faker.seed(recordSeed);
  const topics = PRESETS[config.site.domain].topics;
  const topic = topics[index % topics.length];
  const heading = faker.helpers.arrayElement(['Perspectives on', 'A guide to', 'Resources for', 'Exploring', 'Planning for', 'Notes on']);
  const fields = {};
  let short = null;
  for (const f of type.fields) {
    let presenceProbability = f.presenceProbability ?? 0.5;
    if (f.optional && amount > 0 && presenceProbability > 0 && presenceProbability < 1) {
      const offset = (chance(recordSeed, f.name, 'variation-presence') * 2 - 1) * 0.4 * amount / 100;
      presenceProbability = Math.max(0.05, Math.min(0.95, presenceProbability + offset));
    }
    if (f.optional && chance(config.seed, config.site.id, type.name, index, f.name, 'presence') >= presenceProbability) continue;
    if (f.type === 'title') fields[f.name] = config.contentPool ? `${heading} ${topic}: ${faker.location.city()} ${index + 1}` : (domainTitle(faker, config.site.domain, type.name, topic, index) ?? `${heading} ${topic}: ${faker.location.city()} ${index + 1}`);
    else if (f.type === 'person' && f.name === 'name' && isPersonType(type.name) && fields.title) fields[f.name] = fields.title.replace(/, (MD|DO|NP|PA-C)$/, '');
    else if (f.type === 'person') fields[f.name] = config.contentPool ? faker.person.fullName() : personName(faker);
    else if (!config.contentPool && f.type !== 'date' && f.type !== 'image' && (short = domainShortValue(faker, f.name, topic, index)) !== null) fields[f.name] = short;
    else if (f.type === 'place') fields[f.name] = config.contentPool ? faker.location.city() : town(faker);
    else if (f.type === 'address') fields[f.name] = `${faker.location.streetAddress()}, ${config.contentPool ? faker.location.city() : town(faker)}`;
    else if (f.type === 'date' && f.name === 'endDate' && !config.contentPool) fields[f.name] = new Date(Date.UTC(2020 + index % 6, index % 12 + 2 + index % 5, 1 + (index * 7) % 27)).toISOString().slice(0, 10);
    else if (f.name === 'version' && !config.contentPool && /^Release /.test(fields.title ?? '')) fields[f.name] = fields.title.slice(8);
    else if (f.type === 'date') fields[f.name] = new Date(Date.UTC(2020 + index % 6, index % 12, 1 + (index * 7) % 27)).toISOString().slice(0, 10);
    else if (f.type === 'isbn') fields[f.name] = faker.commerce.isbn();
    else if (f.type === 'image') fields[f.name] = imagePathFor(config, type, index);
    else if (f.name === 'openingHours') fields[f.name] = faker.helpers.arrayElement(['Monday to Friday, 09:00-17:00', 'Tuesday to Saturday, 10:00-18:00', 'Monday to Saturday, 08:30-16:30']);
    else if (/Number|Code|identifier|reference|version/i.test(f.name)) fields[f.name] = `${type.name.slice(0,3).toUpperCase()}-${2020 + index % 6}-${String(index + 1).padStart(5,'0')}`;
    else if (f.name === 'credits') fields[f.name] = String(2 + index % 5);
    else fields[f.name] = paragraph(faker, topic, f.name, config.site.domain, index, config.contentPool, { amount, seed: recordSeed, subjectName: isPersonType(type.name) ? fields.name : undefined });
  }
  return fields;
}

function variedPageSize(config) {
  const amount = config.variation?.amount ?? 0;
  const base = config.site.pageSize;
  if (!amount) return base;
  const spread = Math.max(1, Math.round(base * 0.5 * amount / 100));
  const delta = seedFor(config.seed, config.site.id, 'variation-page-size') % (spread * 2 + 1) - spread;
  return Math.max(5, Math.min(100, base + delta));
}

function variedWeight(config, type) {
  const amount = config.variation?.amount ?? 0;
  if (!amount) return type.weight;
  const spread = Math.max(1, Math.ceil(amount / 25));
  const delta = seedFor(config.seed, config.site.id, type.name, 'variation-weight') % (spread * 2 + 1) - spread;
  return Math.max(1, Math.min(100, type.weight + delta));
}

export function createModel(config) {
  const settings = { ...config.site, name: normalizeSourceText(config.site.name) };
  const types = config.contentTypes.map(type => ({ ...type, label: normalizeSourceText(type.label) }));
  // Themed (non-legacy) sites reuse a pool of sector illustrations and portraits, like a real media library.
  const mediaPool = !config.contentPool && Boolean(IMAGE_ALT[settings.domain]) && settings.visualStyle !== 'legacy';
  const amount = config.variation?.amount ?? 0;
  const size = variedPageSize(config);
  const counts = types.map(() => 1);
  let used = 1 + types.length * 2;
  let cursor = 0;
  const weighted = types.flatMap((t, i) => Array(variedWeight(config, t)).fill(i));
  while (used < settings.pageCount) {
    let added = false;
    for (let attempt = 0; attempt < weighted.length; attempt++) {
      const i = weighted[cursor++ % weighted.length];
      const cost = counts[i] % size === 0 ? 2 : 1;
      if (used + cost > settings.pageCount) continue;
      counts[i]++; used += cost; added = true; break;
    }
    if (!added) break;
  }
  const site = { ...settings, ...(mediaPool ? { mediaPool: true, personSections: types.filter(t => isPersonType(t.name)).map(t => `/${slug(t.label)}/`) } : {}), pageSize: size, seed: config.seed, noise: config.noise, description: !config.contentPool && SITE_DESCRIPTIONS[settings.domain] ? SITE_DESCRIPTIONS[settings.domain][seedFor(config.seed, settings.id, 'site-description') % SITE_DESCRIPTIONS[settings.domain].length] : PRESETS[settings.domain].description, navigation: types.map(t => ({ label: t.label, href: `/${slug(t.label)}/` })),
    ...(amount > 0 ? { shell: ['directory', 'archive', 'journal', 'civic'][seedFor(config.seed, settings.id, 'variation-shell') % 4] } : {}) };
  const pages = [];
  const groups = new Map();
  const clusterByShape = new Map();
  const listingSchemas = new Map();
  types.forEach((t, ti) => {
    const group = [];
    const shape = JSON.stringify(t.fields.map(f => [f.name, f.type, Boolean(f.optional)]).sort((a, b) => a[0].localeCompare(b[0])));
    if (!clusterByShape.has(shape)) clusterByShape.set(shape, t.name);
    for (let i = 0; i < counts[ti]; i++) {
      const fields = Object.fromEntries(Object.entries(valuesFor(config, t, i))
        .map(([name, value]) => [name, normalizeSourceText(value)]));
      const imageField = t.fields.find(f => f.type === 'image')?.name;
      const template = amount > 0 ? seedFor(config.seed, settings.id, t.name, i, 'variation-template') % 4 : i % 3;
      const image = imageField ? (fields[imageField] ? { src: fields[imageField], alt: `${fields.title} cover`, field: imageField } : null)
        : mediaPool ? (isPersonType(t.name)
          ? { src: `/assets/media/portrait-${1 + seedFor(config.seed, settings.id, t.name, i, 'portrait') % MEDIA_POOL.portraits}.png`, alt: `Portrait of ${fields.title.replace(/, (MD|DO|NP|PA-C)$/, '')}` }
          : { src: `/assets/media/${settings.domain}-${1 + seedFor(config.seed, settings.id, t.name, i, 'scene') % MEDIA_POOL.scenes}.png`, alt: IMAGE_ALT[settings.domain] })
        : { src: imagePathFor(config, t, i), alt: IMAGE_ALT[settings.domain] ?? 'Geometric cover artwork from the collection' };
      const page = { pageId: `${t.name}-${String(i + 1).padStart(6, '0')}`, url: `/${slug(t.label)}/${String(i + 1).padStart(6,'0')}-${slug(fields.title)}/`, kind: 'detail', contentType: t.name, expectedCluster: t.name, template: `detail-${template}`, title: fields.title, fields, canonicalValues: structuredClone(fields), fieldStates: Object.fromEntries(Object.keys(fields).map(k => [k, 'present'])), relationships: [], links: [], image, ...(imageField ? { fieldSelectors: { [imageField]: `img[data-field="${imageField}"]` } } : {}), noiseEvents: [], delayMs: 0 };
      page.expectedCluster = clusterByShape.get(shape);
      page.fieldLayout = t.fieldLayout === 'mixed' ? FIELD_LAYOUTS[amount > 0 ? seedFor(config.seed, settings.id, t.name, i, 'variation-layout') % FIELD_LAYOUTS.length : i % FIELD_LAYOUTS.length] : (t.fieldLayout ?? 'definition-list');
      for (const f of t.fields) if (!Object.hasOwn(fields, f.name)) page.fieldStates[f.name] = 'absent';
      pages.push(page); group.push(page);
    }
    groups.set(t.name, group);
  });
  for (const t of types) {
    const group = groups.get(t.name);
    const itemSchema = amount > 0 ? listingItemSchema(t) : null;
    const listingCluster = itemSchema ? listingClusterId(itemSchema) : null;
    if (itemSchema) listingSchemas.set(listingCluster, itemSchema);
    if (t.relationTo) group.forEach((p, i) => {
      const targets = groups.get(t.relationTo);
      const target = targets[i % targets.length];
      p.relationships = [{ type: 'related', targetUrl: target.url }];
      p.links.push({ label: target.title, href: target.url });
      if (p.fields.author && target.fields.name) { p.fields.author = target.fields.name; p.canonicalValues.author = target.fields.name; }
    });
    for (let offset = 0; offset < group.length; offset += size) {
      const n = Math.floor(offset / size) + 1;
      const base = `/${slug(t.label)}/`;
      const url = n === 1 ? base : `${base}page/${n}/`;
      const links = group.slice(offset, offset + size).map(p => ({ label: p.title, href: p.url }));
      if (n > 1) links.push({ label: 'Previous page', href: n === 2 ? base : `${base}page/${n - 1}/` });
      if (offset + size < group.length) links.push({ label: 'Next page', href: `${base}page/${n + 1}/` });
      const listing = supportPage(`listing-${t.name}-${n}`, url, 'listing', 'listing', `${t.label}${n > 1 ? ` - Page ${n}` : ''}`, links);
      if (amount > 0) {
        listing.expectedCluster = listingCluster;
        listing.template = `listing-${seedFor(config.seed, settings.id, t.name, n, 'variation-listing') % 3}`;
        listing.repeatedItems = group.slice(offset, offset + size).map(record => {
          const fields = Object.fromEntries(itemSchema.filter(field => Object.hasOwn(record.fields, field.name))
            .map(field => [field.name, record.fields[field.name]]));
          return { pageId: record.pageId, url: record.url, fields };
        });
      }
      pages.push(listing);
    }
  }
  const detailPages = pages.filter(p => p.kind === 'detail');
  const featuredStep = IMAGE_ALT[settings.domain] ? Math.max(1, Math.floor(detailPages.length / 6)) : 23;
  const home = supportPage('home', '/', 'home', 'home', site.name, [...site.navigation, ...detailPages.filter((_, i) => i % featuredStep === 0).slice(0, IMAGE_ALT[settings.domain] ? 6 : 8).map(p => ({ label: p.title, href: p.url }))]);
  if (IMAGE_ALT[settings.domain]) for (const page of [home, ...pages]) if (page.image?.alt === 'Collection artwork') page.image.alt = IMAGE_ALT[settings.domain];
  home.fields.summary = site.description; home.canonicalValues.summary = site.description; home.fieldStates.summary = 'present';
  pages.unshift(home);
  if (used < settings.pageCount) {
    pages.push(supportPage('information', '/site-information/', 'detail', 'information', 'Site information', []));
    home.links.push({ label: 'Site information', href: '/site-information/' });
  }
  if (pages.length !== settings.pageCount) throw new Error(`Page accounting error: ${pages.length} != ${settings.pageCount}`);
  if (new Set(pages.map(p => p.url)).size !== pages.length) throw new Error('Page URLs collide; content type labels must produce unique slugs');
  const schemas = Object.fromEntries(types.map(t => [t.name, t.fields.map(f => f.name)]));
  Object.assign(schemas, { home: ['title','summary'], listing: ['title'] });
  if (used < settings.pageCount) schemas.information = ['title'];
  const schemaDefinitions = Object.fromEntries(types.map(t => [t.name, { required: t.fields.filter(f => !f.optional).map(f => f.name), optional: t.fields.filter(f => f.optional).map(f => f.name) }]));
  for (const [cluster, repeatedItemSchema] of listingSchemas) {
    schemas[cluster] = ['title'];
    schemaDefinitions[cluster] = { required: ['title'], optional: [], repeatedItemSchema };
  }
  for (const page of pages) {
    page.fieldLocations = planFieldLocations(page);
    const locations = planRepeatedItemLocations(page, site, schemaDefinitions[page.expectedCluster]?.repeatedItemSchema);
    if (locations !== undefined) page.repeatedItemLocations = locations;
  }
  return { version: 1, generatorVersion: VERSION, listingTruthVersion: 1, fieldLocationVersion: 1, repeatedItemLocationVersion: 1, site, schemas, schemaDefinitions, pages };
}

function supportPage(id, url, kind, contentType, title, links) {
  return { pageId: id, url, kind, contentType, expectedCluster: contentType, template: kind, title, fields: { title }, canonicalValues: { title }, fieldStates: { title: 'present' }, relationships: [], links, image: { src: '/assets/collection.png', alt: 'Collection artwork' }, noiseEvents: [], delayMs: 0 };
}
