import { createServer } from 'node:http';
import { createFixtureHandler } from '../preview/server.mjs';
import { ownedSite, validSiteId, validUuid } from './store.mjs';

const suffix = '.siteforge.test';

export function siteHostname(siteId) {
  validSiteId(siteId);
  if (siteId.length > 63) throw new Error('Site ID is too long for a DNS label');
  return `${siteId}${suffix}`;
}

export function parseSiteHost(authority) {
  if (typeof authority !== 'string' || authority !== authority.trim()) return null;
  const match = /^([a-z][a-z0-9-]{0,62})\.siteforge\.test(?::([1-9][0-9]{0,4}))?$/.exec(authority.toLowerCase());
  if (!match || (match[2] && Number(match[2]) > 65535)) return null;
  try {
    return { siteId: validSiteId(match[1]), authority: authority.toLowerCase() };
  } catch { return null; }
}

export async function startGateway({ jobId, port = 4480, host = '127.0.0.1' } = {}) {
  validUuid(jobId);
  const handlers = new Map();
  const server = createServer(async (request, response) => {
    const route = parseSiteHost(request.headers.host);
    if (!route) { response.writeHead(404); response.end('Unknown fixture host'); return; }
    const key = route.siteId;
    try {
      let handler = handlers.get(key);
      if (!handler) {
        const { directory } = await ownedSite(jobId, route.siteId);
        handler = await createFixtureHandler(directory, { rebaseOrigin: true, originForRequest: () => `http://${route.authority}` });
        handlers.set(key, handler);
      }
      await handler(request, response);
    } catch {
      if (!response.headersSent) { response.writeHead(404); response.end('Fixture site is unavailable'); }
    }
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, accept); });
  return { server, port: server.address().port, close: () => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())) };
}
