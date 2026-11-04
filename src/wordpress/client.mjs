// Client for the SiteForge Importer WordPress plugin (wordpress/siteforge-importer, REST namespace siteforge/v1).
// Every request sends the import token in X-SiteForge-Token. Errors name the likely cause: the site is not running,
// the token is wrong, or the plugin is not active.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class WordPressError extends Error {
  constructor(message, { status = 0, code = 'wordpress_error', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'WordPressError';
    this.status = status;
    this.code = code;
  }
}

/** The local WordPress connection written by the WordPress runtime: { url, adminUrl, username, password, token }. */
export async function readConnection(root = process.cwd()) {
  const file = join(resolve(root), '.wordpress', 'connection.json');
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new WordPressError(`No local WordPress connection: ${file} does not exist. Start the local WordPress first, or pass --url and --token.`, { code: 'no_connection' });
    throw error;
  }
  let connection;
  try { connection = JSON.parse(text); } catch { throw new WordPressError(`${file} is not valid JSON.`, { code: 'bad_connection' }); }
  if (!connection || typeof connection.url !== 'string') throw new WordPressError(`${file} has no url.`, { code: 'bad_connection' });
  return connection;
}

function baseUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new WordPressError(`Invalid WordPress URL: ${url}`, { code: 'bad_url' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new WordPressError(`WordPress URL must use http or https: ${url}`, { code: 'bad_url' });
  parsed.hash = ''; parsed.search = '';
  return parsed.href.replace(/\/+$/, '');
}

/**
 * @param {{ url: string, token: string, fetch?: typeof fetch, timeoutMs?: number }} options
 */
export function wordpressClient({ url, token, fetch: fetchImpl = globalThis.fetch, timeoutMs = 300000 } = {}) {
  if (!url) throw new WordPressError('A WordPress URL is required.', { code: 'bad_url' });
  if (!token) throw new WordPressError('The SiteForge import token is required (Settings → SiteForge Importer in WordPress).', { code: 'no_token' });
  const base = baseUrl(url);

  async function call(method, route, { body, query } = {}) {
    // ?rest_route= works with every permalink setting (also "Plain", where /wp-json/ does not exist).
    const target = new URL(`${base}/`);
    target.searchParams.set('rest_route', `/siteforge/v1${route}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchImpl(target, {
        method,
        headers: { 'X-SiteForge-Token': token, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? `did not answer within ${Math.round(timeoutMs / 1000)} s` : (error?.cause?.code ?? error?.message ?? 'network error');
      throw new WordPressError(`WordPress at ${base} is not reachable (${reason}). Is it running?`, { code: 'unreachable', cause: error });
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: handled below */ }
    if (response.ok && data !== null) return data;
    const code = data?.code;
    if (response.status === 401 || response.status === 403 || code === 'siteforge_forbidden') {
      throw new WordPressError(`WordPress at ${base} rejected the import token. Copy it from Settings → SiteForge Importer.`, { status: response.status, code: 'bad_token' });
    }
    if (response.status === 404 && (code === 'rest_no_route' || data === null)) {
      throw new WordPressError(`WordPress at ${base} has no SiteForge Importer API. Install and activate the plugin from wordpress/siteforge-importer.`, { status: 404, code: 'plugin_missing' });
    }
    if (data?.message) throw new WordPressError(`WordPress: ${data.message}`, { status: response.status, code: code ?? 'wordpress_error' });
    if (response.ok) throw new WordPressError(`WordPress at ${base} answered ${route} with something other than JSON. Is this a WordPress site with the SiteForge Importer plugin?`, { status: response.status, code: 'not_json' });
    throw new WordPressError(`WordPress at ${base} answered ${response.status} ${response.statusText} for ${route}.`, { status: response.status, code: 'http_error' });
  }

  return {
    url: base,
    status: () => call('GET', '/status'),
    types: () => call('GET', '/types'),
    match: (types, { reuseExisting = true } = {}) => call('POST', '/match', { body: { types, reuseExisting } }),
    importBatch: body => call('POST', '/import', { body }),
    // One slice of records per call; pass offset to continue (the result's nextOffset, null when done).
    relationships: (siteId, { offset = 0, limit = 200 } = {}) => call('POST', '/relationships', { body: { siteId, offset, limit } }),
    pages: body => call('POST', '/pages', { body }),
    // Deletes up to `limit` items per call; repeat until the result's done is true.
    reset: (siteId, { limit = 200 } = {}) => call('POST', '/reset', { body: { siteId, limit } }),
    answerKey: (siteId, { offset, limit } = {}) => call('GET', '/answer-key', { query: { siteId, offset, limit } }),
  };
}

/** A client for the given URL and token, or for .wordpress/connection.json when they are omitted. */
export async function connect({ url, token, root, fetch } = {}) {
  let connection = {};
  if (!url || !token) connection = await readConnection(root);
  return { client: wordpressClient({ url: url ?? connection.url, token: token ?? connection.token, fetch }), connection: { ...connection, url: url ?? connection.url } };
}
