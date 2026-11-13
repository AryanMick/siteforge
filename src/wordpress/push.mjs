import { replaceFile } from '../site/replace-file.mjs';
// Pushes a generated SiteForge site into a real WordPress through the SiteForge Importer plugin: native custom post
// types with their fields, media library images, topic terms, relationships and an optional Home page. The active
// theme and plugins (including Elementor) decide how it looks. Afterwards the plugin's answer key, with the real
// WordPress URLs, is saved as <site>/private/wordpress-answer-key.json for scoring a crawl of the WordPress site.
//
// Big sites are streamed: canonical.json is read record by record and sent in batches, never as one request.
import { createReadStream } from 'node:fs';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { PRESETS } from '../site/presets.mjs';
import { slug } from '../site/util.mjs';
import { connect, wordpressClient } from './client.mjs';

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_BATCH_BYTES = 3 * 1024 * 1024;
export const ANSWER_KEY_FILE = 'wordpress-answer-key.json';
// Records are dated one minute apart, newest first, ending at this fixed instant: archives (newest first) then list
// them in the generator's order, and a second push writes the same dates.
const DATE_BASE = Date.UTC(2025, 0, 1, 12, 0, 0);
const LONG_TEXT = 100;
const SINGULAR = { object: 'Collection object', findingAid: 'Finding aid', faculty: 'Faculty profile', journalist: 'Writer', resource: 'Learning resource', opportunity: 'Volunteer opportunity' };
const ACRONYMS = { Isbn: 'ISBN', Url: 'URL', Id: 'ID' };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

export const humanize = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  .replace(/^./, letter => letter.toUpperCase()).split(' ').map(word => ACRONYMS[word] ?? word).join(' ');

/**
 * Elements of the top-level array `key` of a JSON file, one parsed element at a time (the file is never loaded
 * whole). Works for canonical.json, where `pages` holds every page of the site.
 */
export async function* streamJsonArray(file, key = 'pages', { chunkSize = 1 << 20 } = {}) {
  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: chunkSize });
  let depth = 0, inString = false, escaped = false;
  let keyText = null, lastKey = null, pendingKey = null;
  let inTarget = false, item = null, itemStart = -1;
  for await (const chunk of stream) {
    const items = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (inString) {
        if (escaped) escaped = false;
        else if (c === 92) escaped = true;
        else if (c === 34) {
          inString = false;
          if (keyText !== null) { pendingKey = keyText + chunk.slice(itemStart, i); keyText = null; itemStart = -1; }
        }
        continue;
      }
      if (c === 34) {
        inString = true;
        // Strings directly inside the root object may be keys; remember the one before the next colon.
        if (depth === 1 && !inTarget) { keyText = ''; itemStart = i + 1; }
        continue;
      }
      if (c === 58 && depth === 1 && pendingKey !== null) { lastKey = pendingKey; pendingKey = null; continue; }
      if (c === 123 || c === 91) {
        if (inTarget && depth === 2) { item = ''; itemStart = i; }
        depth++;
        if (depth === 2 && c === 91 && lastKey === key) inTarget = true;
        continue;
      }
      if (c === 125 || c === 93) {
        depth--;
        if (inTarget && depth === 2 && item !== null) { items.push(JSON.parse(item + chunk.slice(itemStart, i + 1))); item = null; itemStart = -1; }
        else if (inTarget && depth === 1) { inTarget = false; lastKey = null; }
        continue;
      }
      if (c === 44 && depth === 1) { lastKey = null; pendingKey = null; }
    }
    // Carry an unfinished element or key into the next chunk.
    if (item !== null) { item += chunk.slice(itemStart); itemStart = 0; }
    else if (keyText !== null) { keyText += chunk.slice(itemStart); itemStart = 0; }
    for (const value of items) yield value;
  }
  if (depth !== 0 || inString) throw new Error(`${file} ended before its JSON was complete.`);
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${file} is missing. Is this a generated SiteForge site folder?`);
    throw error;
  }
}

/** UTC date in WordPress's "Y-m-d H:i:s" form, `index` minutes before the base instant. */
export function recordDate(index) {
  return new Date(DATE_BASE - index * 60000).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Reads a generated site's private data: settings, content types and one pass over the pages for counts, field
 * lengths (short values are shown as rows, long text as paragraphs) and the URL → record ID map for relationships.
 */
export async function loadSite(siteDir) {
  const root = resolve(siteDir);
  const config = await readJson(join(root, 'private', 'config.json'));
  const metadata = await readJson(join(root, 'private', 'metadata.json')).catch(() => ({}));
  const canonical = join(root, 'private', 'canonical.json');
  await stat(canonical).catch(() => { throw new Error(`${canonical} is missing. Is this a generated SiteForge site folder?`); });
  const contentTypes = config.contentTypes ?? [];
  const known = new Set(contentTypes.map(type => type.name));
  const lengths = new Map(contentTypes.map(type => [type.name, new Map()]));
  const counts = new Map(contentTypes.map(type => [type.name, 0]));
  const sections = new Map();
  const urls = new Map();
  let intro = '';
  let records = 0;
  for await (const page of streamJsonArray(canonical)) {
    if (page.kind === 'home') intro = page.fields?.summary ?? '';
    if (page.kind !== 'detail' || !known.has(page.contentType)) continue;
    records++;
    urls.set(page.url, page.pageId);
    counts.set(page.contentType, counts.get(page.contentType) + 1);
    if (!sections.has(page.contentType)) sections.set(page.contentType, page.url.split('/').filter(Boolean).slice(0, -1).join('/'));
    const stats = lengths.get(page.contentType);
    for (const [name, value] of Object.entries(page.fields ?? {})) {
      const text = String(value);
      const long = text.length > LONG_TEXT || text.includes('\n');
      stats.set(name, (stats.get(name) ?? false) || long);
    }
  }
  const types = contentTypes.map(type => {
    const imageField = type.fields.find(field => field.type === 'image')?.name ?? null;
    return {
      name: type.name,
      label: type.label,
      singular: SINGULAR[type.name] ?? humanize(type.name),
      slug: sections.get(type.name) || slug(type.label),
      relationTo: type.relationTo ?? null,
      imageField,
      fields: type.fields.filter(field => field.name !== 'title').map(field => ({
        name: field.name,
        type: field.type,
        label: humanize(field.name),
        display: field.type === 'image' ? 'image' : lengths.get(type.name).get(field.name) ? 'text' : 'row',
      })),
    };
  });
  const site = { id: config.site.id, name: metadata.site?.name ?? config.site.name, domain: config.site.domain, baseUrl: config.site.baseUrl };
  return { id: site.id, name: site.name, domain: site.domain, root, config, site, types, intro, counts: Object.fromEntries(counts), records, urls, canonical };
}

/** Image of a record as the plugin expects it; the bytes are read only when `withData` (first use in this push). */
export async function recordImage(root, page, type, withData) {
  const src = page.image?.src;
  if (!src || typeof src !== 'string' || !src.startsWith('/') || src.includes('..')) return null;
  const mime = MIME[extname(src).toLowerCase()];
  if (!mime) return null;
  const publicRoot = join(root, 'public');
  const file = resolve(publicRoot, `.${src}`);
  if (!file.startsWith(publicRoot + sep)) return null;
  const field = type.imageField && page.image.field === type.imageField ? type.imageField : null;
  const image = { filename: src.split('/').pop(), source: src, mime, alt: page.image.alt ?? '', field };
  if (!withData) return image;
  try { return { ...image, base64: (await readFile(file)).toString('base64') }; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** The import payload of one canonical detail page. */
export function recordPayload(page, { type, index, urls, topics, image }) {
  const fields = {};
  for (const [name, value] of Object.entries(page.fields ?? {})) {
    if (name === 'title' || name === type.imageField) continue;
    fields[name] = String(value);
  }
  const number = Number(/(\d+)$/.exec(page.pageId)?.[1] ?? index + 1);
  const topic = topics?.length ? topics[(number - 1) % topics.length] : null;
  return {
    externalId: page.pageId,
    type: page.contentType,
    title: page.title ?? page.fields?.title,
    slug: page.url.split('/').filter(Boolean).pop(),
    path: page.url,
    date: recordDate(index),
    order: index,
    fields,
    relationships: (page.relationships ?? []).filter(relation => urls.has(relation.targetUrl)).map(relation => ({ type: relation.type || 'related', targetExternalId: urls.get(relation.targetUrl) })),
    image,
    terms: topic ? { topic: [topic.charAt(0).toUpperCase() + topic.slice(1)] } : {},
  };
}

/** Record payloads in batches of at most `size` records and about `maxBytes` of JSON. */
export async function* recordBatches(site, { size = DEFAULT_BATCH_SIZE, maxBytes = DEFAULT_BATCH_BYTES, pages } = {}) {
  const types = new Map(site.types.map(type => [type.name, type]));
  const topics = PRESETS[site.domain]?.topics ?? [];
  const sentImages = new Set();
  let batch = [], bytes = 0, index = 0;
  for await (const page of pages ?? streamJsonArray(site.canonical)) {
    const type = types.get(page.contentType);
    if (page.kind !== 'detail' || !type) continue;
    const source = page.image?.src;
    const image = await recordImage(site.root, page, type, Boolean(source) && !sentImages.has(source));
    if (image?.base64) sentImages.add(source);
    const record = recordPayload(page, { type, index: index++, urls: site.urls, topics, image });
    const size1 = JSON.stringify(record).length;
    if (batch.length && (batch.length >= size || bytes + size1 > maxBytes)) { yield batch; batch = []; bytes = 0; }
    batch.push(record); bytes += size1;
  }
  if (batch.length) yield batch;
}

/** The `types` part of every import request. */
export function typeSpec(site) {
  return site.types.map(({ name, label, singular, slug: section, fields }) => ({ name, label, singular, slug: section, fields }));
}

/** Downloads the answer key in slices and writes it as one JSON file (through a temporary file). */
export async function saveAnswerKey(client, siteId, file, { pageSize = 500, onProgress = () => {} } = {}) {
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await open(temporary, 'w', 0o600);
  let pages = 0, offset = 0, total = null, archives = 0;
  try {
    for (;;) {
      const slice = await client.answerKey(siteId, { offset, limit: pageSize });
      if (total === null) {
        const { pages: _pages, total: _total, offset: _offset, limit: _limit, nextOffset: _next, ...header } = slice;
        total = slice.total;
        await handle.write(`${JSON.stringify(header, null, 2).replace(/\n}$/, '')},\n  "pages": [\n`);
      }
      for (const page of slice.pages) {
        await handle.write(`${pages ? ',\n' : ''}    ${JSON.stringify(page)}`);
        pages++;
        if (page.kind === 'listing') archives++;
      }
      await onProgress({ phase: 'answer-key', done: pages, total });
      if (slice.nextOffset === null || slice.nextOffset === undefined || !slice.pages.length) break;
      offset = slice.nextOffset;
    }
    await handle.write('\n  ]\n}\n');
    await handle.close();
    await replaceFile(temporary, file);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { pages, total, archives };
}

/**
 * Pushes a generated site into WordPress.
 * @param {string} siteDir generated site folder (with private/ and public/)
 * @param {{ url?: string, token?: string, builder?: 'blocks'|'elementor', setFrontPage?: boolean, homePage?: boolean,
 *   reuseExisting?: boolean, batchSize?: number, onProgress?: (event: object) => unknown, client?: object, root?: string,
 *   fetch?: typeof fetch }} options
 */
export async function pushSiteToWordPress(siteDir, { url, token, builder = 'blocks', setFrontPage = false, homePage = true, reuseExisting = true, siteKey, batchSize = DEFAULT_BATCH_SIZE, onProgress = () => {}, client, root, fetch } = {}) {
  if (!['blocks', 'elementor'].includes(builder)) throw new Error('builder must be blocks or elementor');
  let connection = { url };
  if (!client) ({ client, connection } = url && token ? { client: wordpressClient({ url, token, fetch }), connection: { url } } : await connect({ url, token, root, fetch }));
  const status = await client.status();
  if (builder === 'elementor' && !status.elementor?.active) throw new Error('builder elementor needs the Elementor plugin to be active in WordPress.');
  await onProgress({ phase: 'scan', done: 0, total: 0 });
  const site = await loadSite(siteDir);
  // siteKey keeps sites from different test sets apart when they share a site id (every set has a site-001-...).
  if (siteKey !== undefined) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(siteKey)) throw new Error('siteKey must be lowercase letters, digits and dashes, starting with a letter (at most 64).');
    site.id = siteKey;
  }
  const types = typeSpec(site);
  const totals = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  const warnings = [];
  const failures = [];
  let mapped = [];
  let done = 0;
  await onProgress({ phase: 'import', done, total: site.records, ...totals });
  for await (const records of recordBatches(site, { size: batchSize })) {
    const result = await client.importBatch({ site: { id: site.id, name: site.name }, builder, reuseExisting, types, records });
    mapped = result.types ?? mapped;
    for (const key of Object.keys(totals)) totals[key] += result[key] ?? 0;
    for (const item of result.results ?? []) {
      if (item.warnings?.length && warnings.length < 20) warnings.push(...item.warnings.map(message => `${item.externalId}: ${message}`));
      if (item.status === 'failed' && failures.length < 20) failures.push(`${item.externalId}: ${item.error}`);
    }
    done += records.length;
    await onProgress({ phase: 'import', done, total: site.records, ...totals });
  }
  let relationshipsUpdated = 0;
  for (let offset = 0; offset !== null && offset !== undefined;) {
    const result = await client.relationships(site.id, { offset, limit: 200 });
    relationshipsUpdated += result.updated ?? 0;
    offset = result.nextOffset;
    await onProgress({ phase: 'relationships', done: Math.min(site.records, offset ?? site.records), total: site.records });
  }
  let home = null;
  if (homePage || setFrontPage) {
    await onProgress({ phase: 'pages', done: 0, total: 1 });
    home = await client.pages({ siteId: site.id, title: 'Home', intro: site.intro || site.name, setFrontPage });
  }
  const answerKeyPath = join(site.root, 'private', ANSWER_KEY_FILE);
  const answers = await saveAnswerKey(client, site.id, answerKeyPath, { onProgress });
  const base = client.url ?? connection.url;
  const summary = {
    siteId: site.id,
    url: status.wordpress?.home ?? `${base}/`,
    adminUrl: connection.adminUrl ?? status.wordpress?.admin ?? `${base}/wp-admin/`,
    builder,
    elementor: builder === 'elementor' ? status.elementor?.version ?? true : false,
    theme: status.theme?.name ?? null,
    records: site.records,
    ...totals,
    types: mapped.map(type => ({ name: type.name, postType: type.postType, reused: type.reused, label: type.label, archiveUrl: type.archiveUrl })),
    relationshipsUpdated,
    home,
    answerKeyPath,
    answerKeyPages: answers.pages,
    archivePages: answers.archives,
    warnings,
    failures,
  };
  await onProgress({ phase: 'done', done: site.records, total: site.records, ...totals });
  return summary;
}

/** Deletes everything the import created for a site (in slices). */
export async function resetSiteInWordPress(siteDirOrId, { url, token, client, root, fetch, onProgress = () => {} } = {}) {
  const siteId = /^[a-z][a-z0-9-]{0,63}$/.test(siteDirOrId) && !(await stat(siteDirOrId).catch(() => null))
    ? siteDirOrId : (await readJson(join(resolve(siteDirOrId), 'private', 'config.json'))).site.id;
  if (!client) ({ client } = url && token ? { client: wordpressClient({ url, token, fetch }) } : await connect({ url, token, root, fetch }));
  let deleted = 0;
  for (;;) {
    const result = await client.reset(siteId, { limit: 200 });
    deleted += result.deleted ?? 0;
    await onProgress({ phase: 'reset', deleted, remaining: result.remaining });
    if (result.done) return { siteId, deleted, removedTypes: result.removedTypes ?? [] };
    if (!result.deleted) throw new Error(`WordPress could not delete the remaining ${result.remaining} items of ${siteId}.`);
  }
}
