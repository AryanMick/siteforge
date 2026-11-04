import { isIP } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = ['color-contrast', 'document-title', 'frame-title', 'html-has-lang', 'image-alt', 'link-name', 'meta-viewport', 'valid-lang'];

function loopbackOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('origin must be an absolute URL'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ipv4 = isIP(host) === 4 && host.split('.')[0] === '127';
  if (url.protocol !== 'http:' || url.username || url.password || (host !== 'localhost' && host !== '::1' && !ipv4)) {
    throw new TypeError('origin must be an unauthenticated HTTP loopback origin');
  }
  if (url.pathname !== '/' || url.search || url.hash) throw new TypeError('origin must not include a path, query, or fragment');
  return url.origin;
}

function auditUrls(origin, paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new TypeError('paths must be a non-empty array');
  return paths.map((path, index) => {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0')) {
      throw new TypeError(`paths[${index}] must be a same-origin absolute path`);
    }
    const url = new URL(path, origin);
    let decodedPath;
    try { decodedPath = decodeURIComponent(url.pathname); } catch { throw new TypeError(`paths[${index}] contains invalid URL encoding`); }
    if (url.origin !== origin || url.username || url.password || decodedPath.split('/').includes('..') || decodedPath.includes('\\') || decodedPath.includes('\0')) {
      throw new TypeError(`paths[${index}] must stay on the supplied origin`);
    }
    if (decodedPath === '/private' || decodedPath.startsWith('/private/')) {
      throw new TypeError(`paths[${index}] must not access private fixture data`);
    }
    url.hash = '';
    return url.href;
  });
}

function contrastData(node) {
  return [...node.any, ...node.all, ...node.none]
    .filter((check) => check.id === 'color-contrast' || check.data != null)
    .map((check) => ({ id: check.id, impact: check.impact, message: check.message, data: check.data ?? null }));
}

function findings(items) {
  return items.map((item) => ({
    id: item.id,
    impact: item.impact,
    help: item.help,
    helpUrl: item.helpUrl,
    nodes: item.nodes.map((node) => ({
      target: node.target,
      html: node.html,
      failureSummary: node.failureSummary,
      contrastData: contrastData(node),
    })),
  }));
}

export async function auditLocalContrast(origin, paths, { outDir, viewports = [{ width: 1280, height: 900 }, { width: 390, height: 844 }] } = {}) {
  const allowedOrigin = loopbackOrigin(origin);
  const urls = auditUrls(allowedOrigin, paths);
  if (!Array.isArray(viewports) || viewports.length === 0 || viewports.some(({ width, height } = {}) => !Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1)) {
    throw new TypeError('viewports must contain positive integer width and height values');
  }
  const screenshots = outDir === undefined ? null : resolve(outDir);
  if (screenshots) await mkdir(screenshots, { recursive: true });

  process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('../../.cache/browsers', import.meta.url));
  const { chromium } = await import('playwright');
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    return { status: 'unavailable', samples: [], note: `Chromium could not launch; no accessibility conclusion was made: ${error.message}` };
  }

  const samples = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport });
      try {
        await context.route('**/*', async (route) => {
          let requestUrl;
          try { requestUrl = new URL(route.request().url()); } catch { await route.abort('blockedbyclient'); return; }
          let requestPath;
          try { requestPath = decodeURIComponent(requestUrl.pathname); } catch { await route.abort('blockedbyclient'); return; }
          if (requestUrl.origin !== allowedOrigin || requestUrl.username || requestUrl.password || requestPath === '/private' || requestPath.startsWith('/private/')) {
            await route.abort('blockedbyclient');
          } else {
            await route.continue();
          }
        });
        for (let index = 0; index < urls.length; index++) {
          const url = urls[index];
          const page = await context.newPage();
          try {
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            if (!response?.ok()) throw new Error(`Audit target returned HTTP ${response?.status() ?? 'unknown'}: ${url}`);
            const results = await new AxeBuilder({ page }).withRules(RULES).analyze();
            const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
            if (screenshots) {
              const name = `${String(index + 1).padStart(2, '0')}-${new URL(url).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}-${viewport.width}x${viewport.height}.png`;
              await page.screenshot({ path: join(screenshots, name), fullPage: true });
            }
            samples.push({ url, viewport: { ...viewport }, violations: findings(results.violations), incomplete: findings(results.incomplete), horizontalOverflow });
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { status: 'complete', samples, note: 'These are sampled, rendered-page results for selected WCAG rules; they do not establish accessibility of the whole site.' };
}
