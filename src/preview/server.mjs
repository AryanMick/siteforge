import { gzipSync } from 'node:zlib';
import { PLATFORM_PROFILES, platformHeaders } from '../render/platforms.mjs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';
import { previewUrl, rebaseHtml } from './rebase-html.mjs';
import { validateTransportPlan } from '../noise/transport.mjs';
import { enabledServerTraps, rewriteTrapPath, trapRouteResponse } from '../noise/crawler-traps.mjs';

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.xml', '.txt', '.json', '.svg', '.webmanifest']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.wav': 'audio/wav', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.htm': 'text/html', '.rss': 'application/rss+xml; charset=utf-8', '.gz': 'application/gzip' };
// Only URLs on the fixture's own source origin are rebased, so deliberate wrong-host entries stay wrong.
function sameOrigin(value, sourceOrigin) { try { return !sourceOrigin || new URL(value).origin === sourceOrigin; } catch { return false; } }
// Directory listings are cached: a preview serves a finished site whose files no longer change.
const listings = new Map();
async function exactCase(root, segments) {
  let directory = root;
  for (const segment of segments) {
    if (!listings.has(directory)) listings.set(directory, readdir(directory).then(names => new Set(names), () => new Set()));
    if (!(await listings.get(directory)).has(segment)) return false;
    directory = join(directory, segment);
  }
  return true;
}
function rebaseSitemap(source, origin, sourceOrigin) { return source.replace(/<loc>([^<]+)<\/loc>/g, (match, value) => sameOrigin(value, sourceOrigin) ? `<loc>${previewUrl(value, origin)}</loc>` : match); }
function rebaseRobots(source, origin, sourceOrigin) { return source.replace(/^(\s*Sitemap:\s*)(\S+)/gim, (match, label, value) => sameOrigin(value, sourceOrigin) ? `${label}${previewUrl(value, origin)}` : match); }

async function loadTransportPlan(directory) {
  try {
    const source = await readFile(join(directory, 'private', 'transport.json'), 'utf8');
    return validateTransportPlan(JSON.parse(source));
  } catch (error) {
    if (error.code === 'ENOENT') return validateTransportPlan({ version: 1, profile: 'none', rules: [] });
    throw new Error(`Cannot start preview: invalid private/transport.json: ${error.message}`, { cause: error });
  }
}

async function publicFile(root, pathname) {
  let file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + sep)) throw new Error('Path escapes public root');
  const info = await stat(file);
  if (info.isDirectory()) file = join(file, 'index.html');
  file = await realpath(file);
  if (!file.startsWith(root + sep)) throw new Error('Path escapes public root');
  return file;
}

async function validateTransportTargets(plan, root) {
  const files = new Map();
  for (const rule of plan.rules) {
    try {
      const file = await publicFile(root, rule.path);
      if (files.has(file)) throw new Error('Two response rules refer to the same source file');
      files.set(file, rule);
    }
    catch (error) { throw new Error(`Cannot start preview: transport target does not exist under public/: ${rule.path}`, { cause: error }); }
  }
  return files;
}

function transportRoutes(plan) {
  const virtual = new Map();
  for (const rule of plan.rules) for (const [index, path] of (rule.virtualPaths ?? []).entries()) virtual.set(path, { rule, index });
  return { virtual };
}

function send(req, res, status, body = '', headers = {}) {
  const content = Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

const agentMatches = (req, pattern) => new RegExp(pattern, 'i').test(String(req.headers['user-agent'] ?? ''));

function applyImmediateTransportRule(req, res, rule, state) {
  if (rule.type === 'user-agent-block') {
    if (!agentMatches(req, rule.agentPattern)) return false;
    send(req, res, rule.status, '<!doctype html><html lang="en"><head><title>Access denied</title></head><body><h1>Access denied</h1><p>Your request was blocked by the site firewall. Reference #' + rule.path.length + '-WAF.</p></body></html>', { 'Content-Type': 'text/html; charset=utf-8' });
    return true;
  }
  if (rule.type === 'intermittent-503') {
    const count = state.get(rule.path) ?? 0;
    state.set(rule.path, count + 1);
    if (count >= rule.failCount) return false;
    send(req, res, rule.status, 'Synthetic 503 response\n', { 'Retry-After': String(rule.retryAfterSeconds) });
    return true;
  }
  if (rule.type === 'cookie-required') {
    if ((req.headers.cookie ?? '').split(/;\s*/).some(item => item.startsWith(`${rule.cookieName}=`))) return false;
    send(req, res, rule.status, '', { Location: rule.path, 'Set-Cookie': `${rule.cookieName}=SF${rule.path.length}SESSION; Path=/; HttpOnly` });
    return true;
  }
  if (rule.type === 'redirect-status-chain') { send(req, res, rule.status, '', { Location: rule.virtualPaths[0] }); return true; }
  if (rule.type === 'redirect-case-variant' || rule.type === 'redirect-external') { send(req, res, rule.status, '', { Location: rule.location }); return true; }
  if (rule.type.startsWith('http-')) {
    const headers = rule.retryAfterSeconds ? { 'Retry-After': String(rule.retryAfterSeconds) } : {};
    send(req, res, rule.status, `Synthetic ${rule.status} response\n`, headers);
    return true;
  }
  if (rule.type === 'soft-404') {
    send(req, res, rule.status, '<!doctype html><html lang="en"><head><title>Not found</title></head><body><main><h1>Page not found</h1><p>This synthetic page is unavailable.</p></main></body></html>', { 'Content-Type': 'text/html; charset=utf-8' });
    return true;
  }
  if (rule.type === 'redirect-chain' || rule.type === 'redirect-loop') {
    send(req, res, rule.status, '', { Location: rule.virtualPaths[0] ?? rule.path });
    return true;
  }
  return false;
}

function applyVirtualTransportRoute(req, res, route) {
  const { rule, index } = route;
  if (rule.type === 'redirect-status-chain') { send(req, res, rule.hopStatuses[index], '', { Location: rule.virtualPaths[index + 1] ?? rule.expected.finalPath }); return; }
  const location = rule.type === 'redirect-chain'
    ? (rule.virtualPaths[index + 1] ?? rule.expected.finalPath)
    : (rule.virtualPaths[index + 1] ?? rule.path);
  send(req, res, rule.status, '', { Location: location });
}

async function publicPageExists(root, target) {
  try { return (await stat(await publicFile(root, target))).isFile(); } catch { return false; }
}

// Body-stage legacy-server conditions: the document itself is healthy, the response is not.
async function sendTransportBody(req, res, rule, body, headers) {
  if (rule?.type === 'missing-content-type') delete headers['Content-Type'];
  if (rule?.type === 'gzip-mismatch') headers['Content-Encoding'] = 'gzip';
  if (rule?.type === 'x-robots-tag') headers['X-Robots-Tag'] = rule.header;
  if (rule?.type === 'link-header-canonical') headers.Link = `<${rule.canonicalPath}>; rel="canonical"`;
  if (rule?.type === 'bot-prerender' && agentMatches(req, rule.agentPattern)) {
    // Replace a client-rendering shell with its server-rendered main content, as prerender services do.
    const html = body.toString('utf8');
    const shell = /<site-app[\s\S]*?<\/site-app><script id="page-data" type="application\/json">([\s\S]*?)<\/script><script type="module"[^>]*><\/script>/.exec(html);
    if (shell) {
      try { body = Buffer.from(html.replace(shell[0], JSON.parse(shell[1])[0])); } catch {}
    }
    headers['X-Prerender'] = '1';
    headers['Content-Length'] = body.length;
  }
  if (rule?.type === 'soft-404-navigation') {
    const notFound = '<main id="content"><h1>Page not found</h1><p>The page you requested could not be found. Use the navigation to continue.</p></main>';
    body = Buffer.from(body.toString('utf8').replace(/<main\b[\s\S]*<\/main>/, notFound).replace(/<site-app[\s\S]*?<\/site-app><script id="page-data"[\s\S]*?<\/script><script type="module"[^>]*><\/script>/, notFound));
    headers['Content-Length'] = body.length;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  if (rule?.type === 'truncated-body') { res.write(body.subarray(0, Math.floor(body.length / 2)), () => res.destroy()); return; }
  if (rule?.type === 'slow-drip') {
    const size = Math.ceil(body.length / rule.chunkCount);
    for (let index = 0; index < rule.chunkCount; index++) {
      res.write(body.subarray(index * size, (index + 1) * size));
      if (index < rule.chunkCount - 1) await new Promise(resolvePromise => setTimeout(resolvePromise, rule.chunkDelayMs));
    }
    res.end();
    return;
  }
  res.end(body);
}

export async function createFixtureHandler(directory, { rebaseOrigin = false, originForRequest = () => null } = {}) {
  const fixtureRoot = resolve(directory);
  const root = await realpath(join(fixtureRoot, 'public'));
  let sourceOrigin = null;
  let cmsHeaders = {};
  let traps = new Set();
  let configuredBaseUrl = '';
  let compressResponses = false;
  let serverHeaders = {};
  const transportState = new Map();
  try {
    const privateConfig = JSON.parse(await readFile(join(fixtureRoot, 'private', 'config.json'), 'utf8'));
    configuredBaseUrl = typeof privateConfig.site?.baseUrl === 'string' ? privateConfig.site.baseUrl : '';
    const cmsProfile = privateConfig.site?.cmsProfile;
    // Sites generated with realistic page source are served like production sites: gzip when the client accepts it.
    compressResponses = privateConfig.site?.sourceClutter === 'realistic';
    if (compressResponses) serverHeaders = { Server: cmsProfile === 'drupal' ? 'Apache' : cmsProfile === 'wordpress' ? 'nginx' : 'AmazonS3', 'X-Cache': 'Hit from edge', Age: '0' };
    // Crawler-trap routes exist only when the private configuration enabled those noise types.
    traps = enabledServerTraps(privateConfig.noise?.types);
    // Response headers that real CMS installs send, so header-based detectors agree with view-source.
    if (cmsProfile === 'drupal') cmsHeaders = { 'X-Generator': 'Drupal 11 (https://www.drupal.org)', 'X-Drupal-Cache': 'HIT', 'X-Drupal-Dynamic-Cache': 'MISS', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Language': 'en' };
    else if (cmsProfile === 'wordpress') cmsHeaders = { 'X-Powered-By': 'PHP/8.3.14', 'Vary': 'Accept-Encoding' };
    else if (PLATFORM_PROFILES.includes(cmsProfile)) {
      const { Server, ...rest } = platformHeaders(cmsProfile, Number(privateConfig.seed) || 0);
      cmsHeaders = rest;
      if (compressResponses) serverHeaders = { ...serverHeaders, Server };
    }
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (rebaseOrigin) {
    try {
      const baseUrl = JSON.parse(await readFile(join(fixtureRoot, 'private', 'config.json'), 'utf8')).site?.baseUrl;
      if (baseUrl) sourceOrigin = new URL(baseUrl).origin;
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Realistic sites answer missing pages like a CMS does: the site's own chrome with a "page not found" message.
  let notFoundPage = null;
  const notFound = async (req, res) => {
    if (!compressResponses) { res.writeHead(404); res.end('Not found'); return; }
    if (notFoundPage === null) {
      try {
        const home = await readFile(join(root, 'index.html'), 'utf8');
        const message = '<main id="content" class="page-shell not-found"><header class="page-heading"><p class="kicker">Error 404</p><h1>Page not found</h1><p class="lede">Sorry, we couldn’t find that page. It may have moved, or the address may be mistyped. Try the menu or the search box.</p></header></main>';
        notFoundPage = Buffer.from(home.replace(/<title>[\s\S]*?<\/title>/, match => match.replace(/>[\s\S]*?</, '>Page not found<'))
          .replace(/<main\b[\s\S]*<\/main>/, message)
          .replace(/<site-app[\s\S]*?<\/site-app><script id="page-data"[\s\S]*?<\/script><script type="module"[^>]*><\/script>/, message)
          .replace(/<link rel="canonical"[^>]*>\n?/, '').replace('<head>', '<head>\n  <meta name="robots" content="noindex">'));
      } catch { notFoundPage = Buffer.from('Not found'); }
    }
    const accepts = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const origin = rebaseOrigin ? originForRequest(req) : null;
    const page = origin ? Buffer.from(rebaseHtml(notFoundPage.toString('utf8'), origin, sourceOrigin)) : notFoundPage;
    const body = accepts ? gzipSync(page, { level: 6 }) : page;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding', ...serverHeaders, ...(accepts ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const transport = await loadTransportPlan(fixtureRoot);
  const transportFiles = await validateTransportTargets(transport, root);
  const routes = transportRoutes(transport);
  const handleRequest = async (req,res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, 'http://localhost');
      let pathname = rewriteTrapPath(decodeURIComponent(url.pathname), traps);
      const trapResponse = traps.size ? await trapRouteResponse(pathname, url.searchParams, traps, {
        exists: target => publicPageExists(root, target),
        readPage: async target => readFile(await publicFile(root, target), 'utf8'),
        baseUrl: configuredBaseUrl,
      }) : null;
      if (trapResponse) {
        const publicOrigin = rebaseOrigin ? originForRequest(req) : null;
        const body = trapResponse.status === 200 && publicOrigin ? rebaseHtml(trapResponse.body, publicOrigin, sourceOrigin) : trapResponse.body;
        send(req, res, trapResponse.status, body, trapResponse.status === 200 ? { 'Content-Type': 'text/html; charset=utf-8' } : {});
        return;
      }
      const segments = pathname.split('/').filter(Boolean);
      if (pathname.includes('\0') || pathname.includes('\\') || segments.some(s => s.startsWith('.')) || segments[0]?.toLowerCase() === 'private') { await notFound(req, res); return; }
      const virtualRoute = routes.virtual.get(pathname);
      if (virtualRoute) { applyVirtualTransportRoute(req, res, virtualRoute); return; }
      if (pathname.startsWith('/__siteforge_transport__/')) { await notFound(req, res); return; }
      let file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(root + sep)) { await notFound(req, res); return; }
      let info;
      try {
        info = await stat(file);
        // macOS and Windows disks ignore letter case; a real Linux web host does not, and the answer key follows it.
        if (!(await exactCase(root, segments))) throw Object.assign(new Error(`No file with this exact case: ${pathname}`), { code: 'ENOENT' });
      }
      catch (error) {
        // Old IIS/Windows hosts answer case variants of a path with the same document.
        const lower = pathname.toLowerCase();
        if (error.code !== 'ENOENT' || !traps.has('duplicate-url-aliases') || lower === pathname) throw error;
        pathname = lower;
        file = resolve(root, `.${pathname}`);
        if (file !== root && !file.startsWith(root + sep)) { await notFound(req, res); return; }
        info = await stat(file);
        // A planned redirect to an upper-case URL must still break, as it does on a case-sensitive host.
        const target = await realpath(info.isDirectory() ? join(file, 'index.html') : file).catch(() => file);
        if (transportFiles.get(target)?.type === 'redirect-case-variant') { await notFound(req, res); return; }
      }
      if (info.isDirectory()) {
        if (!pathname.endsWith('/')) { res.writeHead(308,{ Location: `${pathname}/${url.search}` }); res.end(); return; }
        file = join(file, 'index.html');
      }
      file = await realpath(file);
      if (!file.startsWith(root + sep)) { await notFound(req, res); return; }
      // Match actual file identity so index.html and repeated-slash aliases cannot bypass a planned fault.
      const rule = transportFiles.get(file);
      if (rule && applyImmediateTransportRule(req, res, rule, transportState)) return;
      if (rule?.type === 'slow-response') await new Promise(resolvePromise => setTimeout(resolvePromise, rule.delayMs));
      let body = await readFile(file);
      const publicOrigin = rebaseOrigin ? originForRequest(req) : null;
      if (publicOrigin) {
        const source = body.toString('utf8'); const extension = extname(file);
        if (extension === '.html') body = Buffer.from(rebaseHtml(source, publicOrigin, sourceOrigin));
        else if (extension === '.xml' && /(?:^|[\\/])sitemap(?:-|\.)/.test(file)) body = Buffer.from(rebaseSitemap(source, publicOrigin, sourceOrigin));
        else if (file.endsWith(`${sep}robots.txt`)) body = Buffer.from(rebaseRobots(source, publicOrigin, sourceOrigin));
      }
      const contentType = rule?.type === 'wrong-content-type' ? rule.contentType : (MIME[extname(file)] ?? 'application/octet-stream');
      const headers = { 'Content-Type': contentType, 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...serverHeaders, ...(extname(file) === '.html' ? cmsHeaders : {}) };
      // Planned transport faults keep their exact bytes; every other text response is compressed when accepted.
      if (compressResponses && !rule && COMPRESSIBLE.has(extname(file)) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && body.length > 1024) {
        body = gzipSync(body, { level: 6 });
        Object.assign(headers, { 'Content-Encoding': 'gzip', 'Content-Length': body.length, Vary: 'Accept-Encoding' });
      } else if (compressResponses && COMPRESSIBLE.has(extname(file))) headers.Vary = 'Accept-Encoding';
      await sendTransportBody(req, res, rule, body, headers);
    } catch { if (!res.headersSent) await notFound(req, res); else res.destroy(); }
  };
  return handleRequest;
}

export async function serve(directory, { port = 4310, host = '127.0.0.1', rebaseOrigin = false, tls } = {}) {
  let publicOrigin = null;
  const handleRequest = await createFixtureHandler(directory, { rebaseOrigin, originForRequest: () => publicOrigin });
  const server = tls === undefined ? createHttpServer(handleRequest) : createHttpsServer(tls, handleRequest);
  await new Promise((resolvePromise,reject) => { server.once('error',reject); server.listen(port,host,resolvePromise); });
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  publicOrigin = `${tls === undefined ? 'http' : 'https'}://${urlHost}:${server.address().port}`;
  return { server, url: publicOrigin, close: () => new Promise((resolvePromise,reject) => { server.close(error => error ? reject(error) : resolvePromise()); server.closeIdleConnections(); }) };
}
