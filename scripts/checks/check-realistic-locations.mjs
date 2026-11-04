import { generate } from '../../src/site/generator.mjs';
import { sitePlan } from '../../src/fixture-lab/config.mjs';
import { serve } from '../../src/preview/server.mjs';
import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
import { rm, readFile } from 'node:fs/promises';
// Verifies answer-key field and repeated-item locations on realistic-source sites (clutter, pretty-printed main, media).
const root = await mkdtemp(join(tmpdir(), 'siteforge-realistic-locations-'));
const browser = await chromium.launch({ headless: true });
async function locate(page, location) {
  return page.evaluate(({ selector, read, label }) => {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length !== 1) return { count: matches.length };
    const element = matches[0];
    if (read === 'urlPath') return { count: 1, value: new URL(element.getAttribute('src'), document.baseURI).pathname };
    if (read === 'afterLabel') { const prefix = `${label}: `; return { count: 1, value: element.textContent.startsWith(prefix) ? element.textContent.slice(prefix.length) : null }; }
    if (read === 'afterStrongLabel') { const strong = element.firstChild; if (strong?.nodeType !== 1 || strong.tagName !== 'STRONG' || strong.textContent !== label) return { count: 1, value: null }; const rest = [...element.childNodes].slice(1).map(n => n.textContent).join(''); return { count: 1, value: rest.startsWith(' ') ? rest.slice(1) : null }; }
    return { count: 1, value: element.textContent };
  }, location);
}
const domains = ['library','government','municipality','university','healthcare','documentation','museum','nonprofit','records','news'];
let checked = 0, repeated = 0; const failures = [];
for (const [i, domain] of domains.entries()) {
  const cms = ['wordpress', 'drupal', 'none', 'joomla', 'squarespace', 'wix', 'shopify', 'ghost', 'aem', 'sitecore'][i];
  const framework = ['html', 'react', 'angular'][i % 3];
  const linkMode = ['root-relative', 'relative', 'absolute', 'mixed', 'base-relative'][i % 5];
  const dir = join(root, domain);
  await rm(dir, { recursive: true, force: true });
  const plan = sitePlan({ name: 'L', domain, pagesPerSite: 36, seed: 900 + i, visualStyle: i % 2 ? 'modern' : 'conventional', randomness: 60, cmsProfile: cms, noise: 'medium', framework, linkMode, sourceClutter: 'realistic', optionalFields: true }, 0);
  await generate(plan.config, dir);
  const answer = JSON.parse(await readFile(`${dir}/private/answer-key.json`, 'utf8'));
  const s = await serve(dir, { port: 0, host: '127.0.0.1', rebaseOrigin: true });
  const page = await browser.newPage();
  for (const record of answer.pages) {
    await page.goto(s.url + record.url, { waitUntil: 'load' });
    if (framework !== 'html') await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 15000 }).catch(() => {});
    for (const [field, location] of Object.entries(record.fieldLocations ?? {})) {
      if (location.state !== 'present') continue;
      const found = await locate(page, location);
      checked++;
      if (found.count !== 1 || found.value !== record.fields[field]) failures.push(`${domain}/${framework}/${linkMode} ${record.url} ${field}: ${JSON.stringify(found).slice(0, 120)} expected ${JSON.stringify(record.fields[field]).slice(0, 60)}`);
    }
    for (const [index, item] of (record.repeatedItems ?? []).entries()) for (const [field, location] of Object.entries(record.repeatedItemLocations[index].fieldLocations)) {
      if (location.state !== 'present') continue;
      const found = await locate(page, location); repeated++;
      if (found.count !== 1 || found.value !== item.fields[field]) failures.push(`${domain} repeated ${record.url} ${field}: ${JSON.stringify(found).slice(0, 100)}`);
    }
  }
  await page.close(); await s.close();
}
await browser.close();
await rm(root, { recursive: true, force: true });
if (failures.length) { console.error(failures.slice(0, 20).join('\n')); throw new Error(`${failures.length} realistic-source location failures`); }
console.log(`PASS: ${checked} page fields and ${repeated} repeated fields located exactly on realistic-source sites (10 domains, 9 CMS/platform profiles, 3 frameworks, 5 link modes)`);
