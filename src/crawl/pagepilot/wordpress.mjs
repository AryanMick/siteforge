import { lookup } from 'node:dns/promises';
import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Agent, fetch } from 'undici';
import { privateAddress, pinnedLookup } from '../real-crawler.mjs';
import { atomicJson, runDirectory } from './store.mjs';

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RECEIPTS_FILE = 'wordpress-receipts.json';
const LOCK_FILE = '.wordpress-export.lock';

export class WordPressExportError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function siteEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\\\0]/.test(raw)) throw new WordPressExportError(400, 'Enter a safe HTTPS WordPress site URL.');
  let url;
  try { url = new URL(raw); } catch { throw new WordPressExportError(400, 'Enter a valid WordPress site URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
    throw new WordPressExportError(400, 'The WordPress site must use HTTPS on the default port, without credentials, a query, or a fragment.');
  }
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch { throw new WordPressExportError(400, 'The WordPress site URL contains invalid encoding.'); }
  if (decoded.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) throw new WordPressExportError(400, 'The WordPress site URL contains an unsafe path.');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/wp-json/wp/v2/posts`;
  return url;
}

async function vettedAddresses(hostname, dnsLookup) {
  let timer;
  try {
    const addresses = await Promise.race([
      dnsLookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS); }),
    ]);
    if (!Array.isArray(addresses) || !addresses.length || addresses.some(entry => privateAddress(entry.address))) {
      throw new WordPressExportError(400, 'The WordPress site must resolve only to public network addresses.');
    }
    return addresses;
  } catch (error) {
    if (error instanceof WordPressExportError) throw error;
    throw new WordPressExportError(502, 'The WordPress site address could not be resolved.');
  } finally { clearTimeout(timer); }
}

async function boundedJson(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('response_too_large');
  }
  const reader = response.body?.getReader();
  const chunks = []; let size = 0;
  if (reader) try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('response_too_large'); }
      chunks.push(part.value);
    }
  } finally { reader?.releaseLock(); }
  const body = Buffer.concat(chunks).toString('utf8');
  try { return body ? JSON.parse(body) : {}; } catch { throw new Error('invalid_json'); }
}

function failureForStatus(status) {
  if (status === 401) return 'WordPress authentication failed.';
  if (status === 403) return 'The WordPress user is not allowed to create drafts.';
  if (status === 404) return 'The WordPress posts REST endpoint was not found.';
  if (status === 413) return 'WordPress rejected the draft because it is too large.';
  return `WordPress rejected the draft (HTTP ${status}).`;
}

function safeLink(value, endpoint) {
  try {
    const link = new URL(value);
    return link.protocol === 'https:' && !link.username && !link.password && link.origin === endpoint.origin ? link.href : '';
  } catch { return ''; }
}

async function readReceipts(runId) {
  try {
    const saved = JSON.parse(await readFile(join(runDirectory(runId), RECEIPTS_FILE), 'utf8'));
    return saved?.version === 1 && Array.isArray(saved.records) ? saved : { version: 1, records: [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, records: [] };
    throw new WordPressExportError(500, 'Saved WordPress receipts could not be read; no drafts were sent.');
  }
}

async function withRunLock(runId, operation) {
  const path = join(runDirectory(runId), LOCK_FILE);
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new WordPressExportError(409, 'A WordPress export is already running for this report.');
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Send captured records sequentially. Successful receipts make refresh/re-submit idempotent. */
export async function createWordPressDrafts({ siteUrl, username, applicationPassword, pages, runId }, transport = { lookup, fetch, Agent }) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 10) throw new WordPressExportError(400, 'Select between 1 and 10 captured pages.');
  if (typeof username !== 'string' || !username || /[:\u0000-\u001f\u007f]/.test(username)
    || typeof applicationPassword !== 'string' || !applicationPassword || /[\u0000-\u001f\u007f]/.test(applicationPassword)) {
    throw new WordPressExportError(400, 'WordPress credentials are required.');
  }
  const endpoint = siteEndpoint(siteUrl);
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
  const addresses = await vettedAddresses(hostname, transport.lookup);
  const dispatcher = new transport.Agent({ connect: { lookup: pinnedLookup(endpoint.hostname, addresses) }, connections: 1 });
  try {
    return await withRunLock(runId, async () => {
      const receipts = await readReceipts(runId);
      const key = sourceUrl => `${endpoint.origin}${endpoint.pathname.replace(/\/wp-json\/wp\/v2\/posts$/, '')}\u0000${sourceUrl}`;
      const known = new Map(receipts.records.map(record => [record.key, record]));
      const created = []; const failed = []; let uncertain = false;
      for (const page of pages) {
        const receipt = known.get(key(page.sourceUrl));
        if (receipt) { created.push({ sourceUrl: receipt.sourceUrl, id: receipt.id, link: receipt.link }); continue; }
        let response;
        try {
          response = await transport.fetch(endpoint, {
            method: 'POST', dispatcher, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
              Authorization: `Basic ${Buffer.from(`${username}:${applicationPassword}`, 'utf8').toString('base64')}`,
              Accept: 'application/json', 'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: String(page.title).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]), slug: page.slug, content: page.content, status: 'draft' }),
          });
          if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel(); uncertain = true;
            failed.push({ sourceUrl: page.sourceUrl, error: 'WordPress redirected the authenticated request. Check WordPress before retrying.' });
            continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            if (response.status >= 500) uncertain = true;
            failed.push({ sourceUrl: page.sourceUrl, error: response.status >= 500 ? 'WordPress had a server error. Check WordPress before retrying.' : failureForStatus(response.status) });
            continue;
          }
          const payload = await boundedJson(response);
          if (!Number.isInteger(payload.id) || payload.id <= 0 || payload.status !== 'draft') throw new Error('invalid_success');
          const record = { key: key(page.sourceUrl), siteUrl: endpoint.origin + endpoint.pathname.replace(/\/wp-json\/wp\/v2\/posts$/, ''), sourceUrl: page.sourceUrl, id: payload.id, link: safeLink(payload.link, endpoint), createdAt: new Date().toISOString() };
          receipts.records.push(record); known.set(record.key, record);
          await atomicJson(join(runDirectory(runId), RECEIPTS_FILE), receipts);
          created.push({ sourceUrl: record.sourceUrl, id: record.id, link: record.link });
        } catch {
          uncertain = true;
          failed.push({ sourceUrl: page.sourceUrl, error: 'The WordPress response was interrupted or unclear. Check WordPress before retrying.' });
        }
      }
      return { created, failed, uncertain };
    });
  } finally { await dispatcher.close?.().catch(() => {}); }
}
