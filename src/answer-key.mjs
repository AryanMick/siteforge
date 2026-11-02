import assert from 'node:assert/strict';
import { NOISE_TYPES } from './config.mjs';
import { validateTransportPlan } from './transport.mjs';
import { listingClusterId, listingItemSchema } from './model.mjs';
import { planFieldLocations } from './field-locations.mjs';
import { planRepeatedItemLocations } from './repeated-item-locations.mjs';
import { seedFor } from './util.mjs';
import { NON_SEMANTIC_TRAP_TYPES, isCrawlerTrap, trapDetails } from './crawler-traps.mjs';
import { dateFormatVariant, fieldLabelVariant } from './noise.mjs';

const nonSemantic = new Set(['missing-field', 'malformed-nesting', 'boilerplate', 'delayed-content', 'missing-metadata', 'hidden-boilerplate', 'duplicate-heading', 'broken-image', 'conflicting-metadata', 'missing-main', 'legacy-document', 'image-missing-alt', 'frame-missing-title', 'shortcode-residue', 'hidden-reader-copy', 'analytics-beacon', 'spacer-elements', ...NON_SEMANTIC_TRAP_TYPES]);

function check(condition, message) {
  if (!condition) throw new Error(`Invalid answer key: ${message}`);
}

function keys(value) { return Object.keys(value ?? {}); }

// The displayed date is re-derived from the canonical ISO value and the seeded pool choice.
function displayedDate(value, seed, pageId) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  check(match && Number(match[2]) >= 1 && Number(match[2]) <= 12, 'date-format source is not an ISO date');
  return dateFormatVariant(value, seed, pageId);
}

export function validateAnswerKey(source, answer, config) {
  check(source?.pages && Array.isArray(source.pages), 'source pages are missing');
  check(answer?.pages && Array.isArray(answer.pages), 'answer pages are missing');
  check(source.pages.length === config.site.pageCount && answer.pages.length === source.pages.length, 'page inventory does not match pageCount');
  assert.deepEqual(answer.site, source.site, 'Invalid answer key: site differs from source');
  assert.deepEqual(answer.schemas, source.schemas, 'Invalid answer key: schemas differ from source');
  assert.deepEqual(answer.schemaDefinitions, source.schemaDefinitions, 'Invalid answer key: schema definitions differ from source');
  check(answer.generatorVersion === source.generatorVersion, 'generator version differs from source');
  const listingTruthRequired = source.generatorVersion !== '1.0.0';
  if (listingTruthRequired) check(source.listingTruthVersion === 1 && answer.listingTruthVersion === 1, 'listing truth version is missing');
  const fieldLocationsRequired = !['1.0.0', '1.1.0'].includes(source.generatorVersion);
  if (fieldLocationsRequired) check(source.fieldLocationVersion === 1 && answer.fieldLocationVersion === 1, 'field location version is missing');
  const repeatedItemLocationsRequired = !['1.0.0', '1.1.0', '1.2.0', '1.2.1'].includes(source.generatorVersion);
  if (repeatedItemLocationsRequired) check(source.repeatedItemLocationVersion === 1 && answer.repeatedItemLocationVersion === 1, 'repeated-item location version is missing');
  check(answer.site.seed === config.seed && answer.site.id === config.site.id, 'site identity differs from configuration');
  const ids = new Set(); const urls = new Set();
  for (const page of answer.pages) {
    check(page && typeof page.pageId === 'string' && page.pageId && !ids.has(page.pageId), 'duplicate or missing page ID');
    check(typeof page.url === 'string' && page.url.startsWith('/') && !page.url.startsWith('//') && !urls.has(page.url), 'duplicate or invalid page URL');
    ids.add(page.pageId); urls.add(page.url);
  }
  check(urls.has('/'), 'home URL is missing');
  const sourceIds = new Set(source.pages.map(page => page.pageId));
  check(sourceIds.size === source.pages.length, 'source has duplicate page IDs');
  const sourceUrls = new Set(source.pages.map(page => page.url));
  check(sourceUrls.size === source.pages.length, 'source has duplicate page URLs');
  const sourceById = new Map(source.pages.map(page => [page.pageId, page]));
  const supported = new Set(NOISE_TYPES);
  for (let i = 0; i < answer.pages.length; i++) {
    const original = source.pages[i]; const page = answer.pages[i];
    const where = `page ${page.pageId}`;
    check(page.pageId === original.pageId && page.url === original.url, `${where} differs from source inventory`);
    check(Object.hasOwn(answer.schemas, page.contentType) && Object.hasOwn(answer.schemas, page.expectedCluster), `${where} has an unknown schema or cluster`);
    for (const property of ['kind', 'contentType', 'expectedCluster', 'template', 'title', 'fieldLayout']) {
      check(page[property] === original[property], `${where} changed ${property}`);
    }
    assert.deepEqual(page.canonicalValues, original.fields, `Invalid answer key: ${where} lost canonical identity`);
    assert.deepEqual(page.relationships, original.relationships, `Invalid answer key: ${where} changed relations`);
    assert.deepEqual(page.links, original.links, `Invalid answer key: ${where} changed links`);
    assert.deepEqual(page.repeatedItems, original.repeatedItems, `Invalid answer key: ${where} changed repeated items`);
    if (fieldLocationsRequired) {
      assert.deepEqual(original.fieldLocations, planFieldLocations(original), `Invalid answer key: ${where} has invalid source field locations`);
      assert.deepEqual(page.fieldLocations, planFieldLocations(page), `Invalid answer key: ${where} has invalid observed field locations`);
    }
    if (listingTruthRequired && config.variation?.amount > 0 && page.kind === 'listing') {
      check(Array.isArray(page.repeatedItems) && page.repeatedItems.length > 0, `${where} has no repeated items`);
    }
    if (repeatedItemLocationsRequired) {
      const itemSchema = answer.schemaDefinitions[page.expectedCluster]?.repeatedItemSchema;
      assert.deepEqual(original.repeatedItemLocations, planRepeatedItemLocations(original, source.site, itemSchema), `Invalid answer key: ${where} has invalid source repeated-item locations`);
      assert.deepEqual(page.repeatedItemLocations, planRepeatedItemLocations(page, answer.site, itemSchema), `Invalid answer key: ${where} has invalid observed repeated-item locations`);
    }
    if (page.repeatedItems !== undefined) {
      check(page.kind === 'listing' && page.repeatedItems.length > 0, `${where} has repeated items outside a listing`);
      const itemSchema = answer.schemaDefinitions[page.expectedCluster]?.repeatedItemSchema;
      if (listingTruthRequired) check(Array.isArray(itemSchema) && itemSchema.some(field => field.name === 'title'), `${where} has no repeated-item schema`);
      const declaredFields = itemSchema && new Set(itemSchema.map(field => field.name));
      for (const item of page.repeatedItems) {
        const target = sourceById.get(item.pageId);
        check(target && target.url === item.url && page.links.some(link => link.href === item.url), `${where} has a repeated item without a local detail link`);
        check(target.kind === 'detail' && item.fields.title === target.fields.title, `${where} has an invalid repeated item title`);
        for (const [field, value] of Object.entries(item.fields)) check(Object.hasOwn(target.fields, field) && target.fields[field] === value, `${where} has an invalid repeated item field ${field}`);
        if (itemSchema) {
          const type = config.contentTypes.find(entry => entry.name === target.contentType);
          check(type && page.expectedCluster === listingClusterId(listingItemSchema(type)), `${where} has the wrong repeated-item cluster`);
          assert.deepEqual(itemSchema, listingItemSchema(type), `Invalid answer key: ${where} has an incorrect repeated-item schema`);
          check(Object.keys(item.fields).length === [...declaredFields].filter(field => Object.hasOwn(target.fields, field)).length
            && Object.keys(item.fields).every(field => declaredFields.has(field)), `${where} has missing or undeclared repeated-item fields`);
          for (const field of itemSchema) {
            check(field.optional || Object.hasOwn(item.fields, field.name), `${where} is missing required repeated-item field ${field.name}`);
          }
        }
      }
    }
    const schema = new Set(answer.schemas[page.contentType]);
    const imageField = config.contentTypes.find(type => type.name === page.contentType)?.fields.find(field => field.type === 'image')?.name;
    const expectedSelectors = imageField ? { [imageField]: `img[data-field="${imageField}"]` } : undefined;
    assert.deepEqual(original.fieldSelectors, expectedSelectors, `Invalid answer key: ${where} has invalid source field selectors`);
    assert.deepEqual(page.fieldSelectors, expectedSelectors, `Invalid answer key: ${where} changed field selectors`);
    if (imageField) {
      const sourceImage = Object.hasOwn(original.fields, imageField) ? { src: original.fields[imageField], alt: `${original.fields.title} cover`, field: imageField } : null;
      check(!sourceImage || /^\/assets\/collection(?:-[1-4])?\.png$/.test(sourceImage.src), `${where} has an invalid source image field`);
      assert.deepEqual(original.image, sourceImage, `Invalid answer key: ${where} has an inconsistent source image`);
    }
    check(schema.has('title') && original.fields.title === page.title, `${where} has no canonical title`);
    const definition = answer.schemaDefinitions[page.contentType];
    if (definition) {
      check([...definition.required, ...definition.optional].length === schema.size && [...definition.required, ...definition.optional].every(key => schema.has(key)), `${where} has an inconsistent schema definition`);
      for (const key of definition.required) check(Object.hasOwn(original.fields, key), `${where} is missing required source field ${key}`);
    }
    for (const key of keys(original.fields)) check(schema.has(key), `${where} source field ${key} is outside its schema`);
    check(keys(original.fieldStates).length === schema.size && [...schema].every(key => original.fieldStates[key] === (Object.hasOwn(original.fields, key) ? 'present' : 'absent')), `${where} has inconsistent source field states`);
    check(keys(page.fieldStates).length === schema.size && keys(page.fieldStates).every(key => schema.has(key)), `${where} field states do not cover its schema`);
    check(keys(page.fields).every(key => schema.has(key)), `${where} has an undeclared observed field`);
    check(Array.isArray(page.noiseEvents) && page.noiseEvents.length <= config.noise.maxPerPage, `${where} has too many noise events`);
    const eventTypes = new Set(); const missing = new Set(); const dates = new Set(); const labels = new Set();
    for (const event of page.noiseEvents) {
      check(supported.has(event.type) && config.noise.types.includes(event.type) && !eventTypes.has(event.type), `${where} records an unsupported or duplicate defect`);
      check(event.severity === config.noise.severity && event.preservesSemantics === !nonSemantic.has(event.type), `${where} has inconsistent defect metadata`);
      eventTypes.add(event.type);
      if (isCrawlerTrap(event.type)) assert.deepEqual(event.details, trapDetails(event.type, original, source.site, config.noise.severity), `Invalid answer key: ${where} has unverifiable ${event.type} details`);
      else check(event.details === undefined, `${where} has unexpected defect details`);
      if (['missing-field', 'date-format', 'label-variation'].includes(event.type)) {
        check(typeof event.field === 'string' && event.field !== 'title' && Object.hasOwn(original.fields, event.field), `${where} has a defect for a nonexistent source field`);
        if (event.type === 'missing-field') missing.add(event.field);
        if (event.type === 'date-format') dates.add(event.field);
        if (event.type === 'label-variation') labels.add(event.field);
      } else if (event.type === 'broken-image' && imageField) {
        check(event.field === imageField && Object.hasOwn(original.fields, imageField), `${where} has an invalid broken image field`);
      } else check(event.field === undefined, `${where} has an unexpected defect field`);
    }
    check(![...missing].some(key => dates.has(key) || labels.has(key)), `${where} formats or labels a missing field`);
    for (const key of schema) {
      const present = Object.hasOwn(page.fields, key);
      check(['present', 'absent'].includes(page.fieldStates[key]) && (page.fieldStates[key] === 'present') === present, `${where} has an invalid ${key} state`);
      check(present === (Object.hasOwn(original.fields, key) && !missing.has(key)), `${where} has an unrecorded field omission or addition`);
      if (present) {
        const value = dates.has(key) ? displayedDate(original.fields[key], config.seed, page.pageId)
          : key === imageField && eventTypes.has('broken-image') ? `/assets/missing-${seedFor(config.seed, page.pageId, 'broken-image') % 100000}.png`
            : original.fields[key];
        check(page.fields[key] === value, `${where} has an unexplained ${key} value`);
      }
    }
    check(page.fields.title === original.fields.title, `${where} lost its title`);
    const expectedLabels = Object.fromEntries([...new Set([...labels, ...missing].filter(key => Object.hasOwn(page.fieldLabels ?? {}, key)))].map(key => [key, fieldLabelVariant(key, page.fieldLayout, config.seed, page.pageId)]));
    check([...labels].every(key => Object.hasOwn(page.fieldLabels ?? {}, key)), `${where} lost a recorded field label`);
    assert.deepEqual(page.fieldLabels ?? {}, expectedLabels, `Invalid answer key: ${where} has unrecorded field labels`);
    check(page.delayMs === (eventTypes.has('delayed-content') ? config.noise.severity * 200 : 0), `${where} has an unrecorded client delay`);
    if (imageField && page.fieldStates[imageField] === 'absent') {
      assert.equal(page.image, null, `Invalid answer key: ${where} rendered an absent image field`);
    } else if (eventTypes.has('broken-image')) {
      const resource = seedFor(config.seed, page.pageId, 'broken-image') % 100000;
      const expectedImage = { ...original.image, src: `/assets/missing-${resource}.png`, ...(config.noise.severity >= 2 ? { srcset: `/assets/missing-${resource}-1x.png 1x, /assets/missing-${resource}-2x.png 2x` } : {}) };
      assert.deepEqual(page.image, expectedImage, `Invalid answer key: ${where} changed its recorded broken image`);
    }
    else assert.deepEqual(page.image, original.image, `Invalid answer key: ${where} changed its image`);
    for (const relation of page.relationships) check(urls.has(relation.targetUrl), `${where} references a missing related page`);
    for (const link of page.links) check(urls.has(link.href), `${where} links to a missing page`);
  }
  const transport = validateTransportPlan(answer.transport);
  check(transport.profile === config.transport.profile, 'transport profile differs from configuration');
  for (const rule of transport.rules) check(urls.has(rule.path) && answer.pages.find(page => page.url === rule.path)?.kind === 'detail', `transport targets a missing detail page: ${rule.path}`);
  return answer;
}
