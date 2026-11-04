import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serve } from '../src/preview/server.mjs';
import { atomicJson, PREVIEW_LIFETIME_MS } from '../src/fixture-lab/store.mjs';
import { ensurePreviewCertificate } from '../src/fixture-lab/tls.mjs';

const directory = await realpath(resolve(process.argv[2]));
const recordPath = resolve(process.argv[3]);
const config = JSON.parse(await readFile(join(directory, 'private', 'config.json'), 'utf8'));
const protocol = config.previewProtocol ?? 'http';
if (!['http', 'https'].includes(protocol)) throw new Error('private/config.json contains an invalid previewProtocol');
const credentials = protocol === 'https' ? await ensurePreviewCertificate(join(directory, 'private', 'tls')) : undefined;
const preview = await serve(directory, { port: 0, host: '127.0.0.1', rebaseOrigin: true, tls: credentials && { key: credentials.key, cert: credentials.cert } });
const startedAt = new Date();
await atomicJson(recordPath, { pid: process.pid, url: preview.url, protocol, startedAt: startedAt.toISOString(), expiresAt: new Date(startedAt.getTime() + PREVIEW_LIFETIME_MS).toISOString() });

let closing = false;
async function close() { if (closing) return; closing = true; await preview.close().catch(() => {}); process.exit(0); }
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
setTimeout(() => { void close(); }, PREVIEW_LIFETIME_MS).unref();
