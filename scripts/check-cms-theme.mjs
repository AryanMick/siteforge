// Checks a SiteForge site after its WordPress or Drupal theme package was installed into a real CMS.
//
//   node scripts/check-cms-theme.mjs <generated-site-directory> <cms-base-url> [--sample N] [--seed S]
//
// For every answer-key page it confirms: status 200, the <main> element is byte-for-byte the generated one, the same <h1>
// count, every answer-key field location resolves to its value in a real browser, and every same-site asset loads.
// --sample N checks N random pages plus the home page and up to max(20, N/10) random listing pages (big sites); the menu
// check still covers every answer-key URL. Big sites' answer pages are read from private/answer-pages/ one file at a
// time instead of parsing the whole answer key. SiteForge does not install or run a CMS itself; see README
// "WordPress and Drupal theme packages".
import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { rebaseHtml } from '../src/rebase-html.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');

const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); if (at < 0) return null; const [, value] = args.splice(at, 2); return value; };
const sampleOption = option('--sample');
const sampleSize = sampleOption === null ? null : Number(sampleOption);
const seed = Number(option('--seed') ?? 1);
const [siteDirectory, base] = args;
if (!siteDirectory || !base || (sampleSize !== null && !(Number.isInteger(sampleSize) && sampleSize > 0))) { console.error('Usage: node scripts/check-cms-theme.mjs <generated-site-directory> <cms-base-url> [--sample N] [--seed S]'); process.exit(2); }
const CHUNK = 250;
const index = await readFile(join(siteDirectory, 'private', 'answer-index.json'), 'utf8').then(JSON.parse, () => null);
const metadata = index && await readFile(join(siteDirectory, 'private', 'metadata.json'), 'utf8').then(JSON.parse, () => null);
// Small sites (or sites without the split answer files) use the whole answer key as before.
const whole = index && metadata?.site ? null : JSON.parse(await readFile(join(siteDirectory, 'private', 'answer-key.json'), 'utf8'));
const answer = { site: whole?.site ?? metadata.site };
const allUrls = whole ? whole.pages.map(page => page.url) : index.pages.map(page => page.url);
let chosen = allUrls.map((_, n) => n);
if (sampleSize !== null) {
  let state = seed >>> 0 || 1;
  const random = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
  const pick = (pool, count) => { const copy = [...pool]; for (let i = 0; i < Math.min(count, copy.length); i++) { const j = i + Math.floor(random() * (copy.length - i)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy.slice(0, count); };
  const kindOf = n => (whole ? whole.pages[n].kind : (index.pages[n].contentType === 'home' ? 'home' : index.pages[n].contentType.startsWith('listing') ? 'listing' : 'detail'));
  const listings = chosen.filter(n => kindOf(n) !== 'detail');
  chosen = [...new Set([allUrls.indexOf('/'), ...pick(chosen, sampleSize), ...pick(listings, Math.max(20, Math.floor(sampleSize / 10)))].filter(n => n >= 0))].sort((a, b) => a - b);
}
let loaded = { chunk: -1, pages: [] };
async function* records() {
  for (const n of chosen) {
    if (whole) { yield whole.pages[n]; continue; }
    const chunk = Math.floor(n / CHUNK);
    if (loaded.chunk !== chunk) loaded = { chunk, pages: JSON.parse(await readFile(join(siteDirectory, 'private', 'answer-pages', `${chunk}.json`), 'utf8')) };
    yield loaded.pages[n % CHUNK];
  }
}
const mainOf = html => { const start = html.indexOf('<main'); return start < 0 ? '' : html.slice(start, html.indexOf('</main>', start) + 7); };
const browser = await chromium.launch({ headless: true });
const tab = await browser.newPage();
const failures = [];
const assets = new Set();
let fields = 0, repeated = 0;
async function locate(location) {
  return tab.evaluate(({ selector, read, label }) => {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length !== 1) return { count: matches.length };
    const element = matches[0];
    if (read === 'urlPath') return { count: 1, value: new URL(element.getAttribute('src'), document.baseURI).pathname };
    if (read === 'afterLabel') { const prefix = `${label}: `; return { count: 1, value: element.textContent.startsWith(prefix) ? element.textContent.slice(prefix.length) : null }; }
    if (read === 'afterStrongLabel') { const strong = element.firstChild; if (strong?.nodeType !== 1 || strong.tagName !== 'STRONG' || strong.textContent !== label) return { count: 1, value: null }; const rest = [...element.childNodes].slice(1).map(n => n.textContent).join(''); return { count: 1, value: rest.startsWith(' ') ? rest.slice(1) : null }; }
    return { count: 1, value: element.textContent };
  }, location);
}
for await (const record of records()) {
  const response = await fetch(new URL(record.url, base), { redirect: 'manual' });
  const html = await response.text();
  // Links to the generation address now point to the CMS address, as on the SiteForge preview.
  const sourceOrigin = answer.site.baseUrl ? new URL(answer.site.baseUrl).origin : null;
  const original = await readFile(join(siteDirectory, 'public', record.url, 'index.html'), 'utf8');
  const generated = sourceOrigin ? rebaseHtml(original, new URL(base).origin, sourceOrigin) : original;
  if (response.status !== 200) { failures.push(`${record.url}: status ${response.status}`); continue; }
  if (mainOf(html) !== mainOf(generated)) failures.push(`${record.url}: <main> differs from the generated page`);
  const h1s = text => (text.match(/<h1[\s>]/g) ?? []).length;
  if (h1s(html) !== h1s(generated)) failures.push(`${record.url}: ${h1s(html)} <h1> elements, generated page has ${h1s(generated)}`);
  // Same-site files in any link form (root-relative, relative or fully qualified); page links end in "/".
  for (const match of html.matchAll(/(?<![\w-])(?:src|href)\s*=\s*["']([^"'#]+)/g)) {
    let url; try { url = new URL(match[1].replaceAll('&amp;', '&'), new URL(record.url, base)); } catch { continue; }
    if (url.origin === new URL(base).origin && !url.pathname.endsWith('/') && /^https?:$/.test(url.protocol)) assets.add(url.pathname + url.search);
  }
  await tab.goto(new URL(record.url, base).href, { waitUntil: 'load' });
  if (answer.site.framework !== 'html') await tab.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 15000 }).catch(() => failures.push(`${record.url}: client app did not finish rendering`));
  for (const [field, location] of Object.entries(record.fieldLocations ?? {})) {
    if (location.state !== 'present') continue;
    const found = await locate(location); fields++;
    if (found.count !== 1 || found.value !== record.fields[field]) failures.push(`${record.url} ${field}: ${JSON.stringify(found).slice(0, 120)}`);
  }
  for (const [index, item] of (record.repeatedItems ?? []).entries()) for (const [field, location] of Object.entries(record.repeatedItemLocations[index].fieldLocations)) {
    if (location.state !== 'present') continue;
    const found = await locate(location); repeated++;
    if (found.count !== 1 || found.value !== item.fields[field]) failures.push(`${record.url} repeated ${field}: ${JSON.stringify(found).slice(0, 100)}`);
  }
}
// The CMS's own navigation menu must render (it catches stale compiled templates), and link only to answer-key URLs.
const home = await (await fetch(new URL('/', base))).text();
// Real installs are told apart from SiteForge's imitation markup by output only the real CMS prints.
const menu = /rel=["']https:\/\/api\.w\.org\/["']/.test(home) ? /<nav class="cms-menu"[\s\S]*?<\/nav>/.exec(home)?.[0]
  : /data-off-canvas-main-canvas/.test(home) ? /<nav[^>]*id="block-siteforge-theme-main-menu"[\s\S]*?<\/nav>/.exec(home)?.[0] : 'not a CMS';
if (!menu) failures.push('the CMS navigation menu is missing on the home page');
else if (menu !== 'not a CMS') {
  const pageUrls = new Set(allUrls);
  for (const match of menu.matchAll(/href="([^"]+)"/g)) {
    const path = new URL(match[1].replaceAll('&amp;', '&'), base).pathname;
    if (!pageUrls.has(path)) failures.push(`CMS menu links to ${path}, which is not an answer-key URL`);
  }
}
for (const url of assets) {
  const response = await fetch(new URL(url, base));
  // Broken-image noise points at files that are deliberately missing from the generated site; those may 404 here too.
  const generatedFile = join(siteDirectory, 'public', decodeURIComponent(url.split('?')[0]));
  const intentionallyMissing = response.status === 404 && !(await stat(generatedFile).catch(() => null));
  if (response.status !== 200 && !intentionallyMissing) failures.push(`asset ${url}: status ${response.status}`);
}
await browser.close();
if (failures.length) { console.error(failures.slice(0, 20).join('\n')); throw new Error(`${failures.length} CMS theme check failures`); }
console.log(`PASS: ${chosen.length}${chosen.length < allUrls.length ? ` of ${allUrls.length}` : ''} pages served by ${base} with identical <main>; ${fields} page fields and ${repeated} repeated fields located; ${assets.size} assets load`);
