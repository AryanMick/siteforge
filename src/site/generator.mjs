import { mkdir, writeFile, readFile, stat, rename, copyFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { validateConfig } from './config.mjs';
import { createModel } from './model.mjs';
import { applyDataNoise, applyHtmlNoise } from '../noise/noise.mjs';
import { renderPage, finalizePage, prepareAssets, renderUtilityPage } from '../render/renderers.mjs';
import { searchIndexScript, SEARCH_INDEX_ASSET, utilityPageSpecs } from '../render/site-runtime.mjs';
import { VERSION, hash, json, escapeHtml } from './util.mjs';
import { listFiles } from './artifact-files.mjs';
import { buildTransportPlan } from '../noise/transport.mjs';
import { validateAnswerKey } from '../answers/answer-key.mjs';
import { hashJson, writeJsonArtifact } from './json-artifacts.mjs';
import { writeAnswerInspection } from '../fixture-lab/answer-inspection.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { trapArtifacts } from '../noise/crawler-traps.mjs';
import { isPlatform, platformRobots } from '../render/platforms.mjs';
import { bindDrupalViews, drupalViewsArtifacts } from '../render/drupal-views.mjs';
export { listFiles } from './artifact-files.mjs';

async function ensureNewOutput(path) {
  try { await stat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Output already exists: ${path}. Choose a new --out directory to preserve previous runs.`);
}

// robots.txt as the selected CMS ships it (WordPress virtual robots, Drupal 10/11 default file); plain sites allow everything.
function robotsTxt(config) {
  const sitemap = `Sitemap: ${config.site.baseUrl}/sitemap.xml\n`;
  if (config.site.cmsProfile === 'wordpress') return `User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\n${sitemap}`;
  if (config.site.cmsProfile === 'drupal') {
    const rules = ['/core/', '/profiles/', '/README.md', '/composer/Metapackage/README.txt', '/composer/Plugin/ProjectMessage/README.md', '/composer/Plugin/Scaffold/README.md', '/composer/Plugin/VendorHardening/README.txt', '/composer/Template/README.txt', '/modules/README.txt', '/sites/README.txt', '/themes/README.txt', '/web.config',
      '/admin/', '/comment/reply/', '/filter/tips', '/node/add/', '/search/', '/user/register', '/user/password', '/user/login', '/user/logout', '/media/oembed', '/*/media/oembed',
      '/index.php/admin/', '/index.php/comment/reply/', '/index.php/filter/tips', '/index.php/node/add/', '/index.php/search/', '/index.php/user/password', '/index.php/user/register', '/index.php/user/login', '/index.php/user/logout', '/index.php/media/oembed', '/index.php/*/media/oembed'];
    return `#\n# robots.txt\n#\n# This file is to prevent the crawling and indexing of certain parts\n# of your site by web crawlers and spiders run by sites like Yahoo!\n# and Google. By telling these "robots" where not to go on your site,\n# you save bandwidth and server resources.\n#\n# For more information about the robots.txt standard, see:\n# http://www.robotstxt.org/robotstxt.html\n\nUser-agent: *\n# CSS, JS, Images\nAllow: /core/*.css$\nAllow: /core/*.css?\nAllow: /core/*.js$\nAllow: /core/*.js?\nAllow: /core/*.gif\nAllow: /core/*.jpg\nAllow: /core/*.jpeg\nAllow: /core/*.png\nAllow: /core/*.svg\nAllow: /profiles/*.css$\nAllow: /profiles/*.js$\n# Directories, files and paths\n${rules.map(rule => `Disallow: ${rule}`).join('\n')}\n\n${sitemap}`;
  }
  if (isPlatform(config.site)) return platformRobots(config.site, sitemap);
  return `User-agent: *\nAllow: /\n${sitemap}`;
}

export async function generate(input, outputDirectory, { onProgress = async () => {} } = {}) {
  const config = validateConfig(input);
  const target = resolve(outputDirectory);
  await ensureNewOutput(target);
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.building-${process.pid}`;
  await ensureNewOutput(staging);
  await mkdir(join(staging, 'public'), { recursive: true });
  await mkdir(join(staging, 'private'), { mode: 0o700 });
  const started = performance.now();
  try {
    const canonical = createModel(config);
    const transport = buildTransportPlan(canonical.pages, { profile: config.transport.profile, seed: config.seed });
    const observed = canonical.pages.map(p => applyDataNoise(p, canonical.site));
    const truth = validateAnswerKey(canonical, { ...canonical, pages: observed, transport }, config);
    const canonicalDigest = hashJson(canonical.pages);
    const truthDigest = hashJson(truth);
    await writeJsonArtifact(join(staging, 'private', 'canonical.json'), canonical);
    await writeJsonArtifact(join(staging, 'private', 'answer-key.json'), truth);
    // ground-truth.json is the legacy name of the same answer key: a copy-on-write clone where supported, otherwise a copy.
    await copyFile(join(staging, 'private', 'answer-key.json'), join(staging, 'private', 'ground-truth.json'), fsConstants.COPYFILE_FICLONE);
    await writeAnswerInspection(join(staging, 'private'), truth);
    canonical.pages = [];
    await onProgress({ phase: 'pages', completedPages: 0, totalPages: observed.length });
    await prepareAssets(canonical.site, join(staging, 'public'));
    // Drupal listings read their View (records, facets, sorts, tabs) from the observed pages; no-op for other profiles.
    bindDrupalViews(canonical.site, observed);
    let completedPages = 0;
    for (const page of observed) {
      const file = join(staging, 'public', page.url, 'index.html');
      await mkdir(dirname(file), { recursive: true });
      const html = finalizePage(canonical.site, page, applyHtmlNoise(renderPage(canonical.site, page), page, canonical.site));
      await writeFile(file, html);
      completedPages++;
      if (completedPages % 500 === 0 || completedPages === observed.length) await onProgress({ phase: 'pages', completedPages, totalPages: observed.length });
    }
    const urls = observed.map(p => `${config.site.baseUrl}${p.url}`);
    const chunks = [];
    for (let i = 0; i < urls.length; i += 45000) {
      const filename = urls.length <= 45000 ? 'sitemap.xml' : `sitemap-${chunks.length + 1}.xml`;
      chunks.push(filename);
      await writeFile(join(staging, 'public', filename), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.slice(i,i+45000).map(url => `<url><loc>${escapeHtml(url)}</loc></url>`).join('')}</urlset>`);
    }
    if (chunks.length > 1) await writeFile(join(staging, 'public', 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${chunks.map(name => `<sitemap><loc>${config.site.baseUrl}/${name}</loc></sitemap>`).join('')}</sitemapindex>`);
    await writeFile(join(staging, 'public', 'robots.txt'), robotsTxt(config));
    // Public resources declared by crawler-trap events (frames, feeds, copies, robots/sitemap traps); hashed below like every public file.
    const publicRoot = join(staging, 'public');
    for (const artifact of trapArtifacts({ site: canonical.site, pages: observed, readPublic: url => readFileSync(join(publicRoot, url, 'index.html')) })) {
      const file = resolve(publicRoot, `.${artifact.path}`);
      if (!file.startsWith(publicRoot + sep)) throw new Error(`Trap resource escapes the public root: ${artifact.path}`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, artifact.body);
    }
    // Drupal Views variants (facet, sort, tab and pager pages) as real files; described privately, not answer-key pages.
    if (canonical.site.cmsProfile === 'drupal') {
      const views = drupalViewsArtifacts(canonical.site, page => finalizePage(canonical.site, page, renderPage(canonical.site, page)));
      for (const artifact of views.files) {
        const file = resolve(publicRoot, `.${artifact.path}`);
        if (!file.startsWith(publicRoot + sep)) throw new Error(`View variant escapes the public root: ${artifact.path}`);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, artifact.body);
      }
      await writeFile(join(staging, 'private', 'drupal-views.json'), json(views.manifest), { mode: 0o600 });
    }
    // Pages behind the site's controls (search results, my list, sign-in, request and newsletter confirmations, policy
    // pages) and the search index. Not answer-key pages: noindex, absent from the sitemap, written after the page files.
    await writeFile(join(publicRoot, ...SEARCH_INDEX_ASSET.slice(1).split('/')), searchIndexScript(canonical.site, observed));
    for (const utility of utilityPageSpecs(canonical.site)) {
      const file = join(publicRoot, ...utility.path.slice(1).split('/'));
      if (existsSync(file)) continue;
      await writeFile(file, renderUtilityPage(canonical.site, { path: utility.path, title: utility.title, body: utility.main }));
    }
    await onProgress({ phase: 'verifying', completedPages, totalPages: observed.length });
    const manifest = { version: 1, inspectionVersion: 1, generatorVersion: VERSION, nodeVersion: process.version, seed: config.seed, siteId: config.site.id, pageCount: observed.length, framework: config.site.framework, noise: config.noise, configurationSha256: hash(config), canonicalSha256: canonicalDigest, truthSha256: truthDigest, artifactFiles: {} };
    for (const name of await listFiles(join(staging,'public'))) manifest.artifactFiles[name] = hash(await readFile(join(staging, 'public', name)));
    await writeFile(join(staging, 'private', 'config.json'), json(config), { mode: 0o600 });
    await writeFile(join(staging, 'private', 'transport.json'), json(transport), { mode: 0o600 });
    await writeFile(join(staging, 'private', 'manifest.json'), json(manifest), { mode: 0o600 });
    const coverage = { counts: {}, affectedPages: 0 };
    for (const page of observed) {
      if (page.noiseEvents.length) coverage.affectedPages++;
      for (const type of new Set(page.noiseEvents.map(event => event.type))) coverage.counts[type] = (coverage.counts[type] ?? 0) + 1;
    }
    await writeFile(join(staging, 'private', 'metadata.json'), json({
      version: 1,
      site: { id: canonical.site.id, name: canonical.site.name, domain: canonical.site.domain, framework: canonical.site.framework, visualStyle: canonical.site.visualStyle, shell: canonical.site.shell, cmsProfile: canonical.site.cmsProfile ?? 'none', builderProfile: canonical.site.builderProfile ?? 'none', linkMode: canonical.site.linkMode ?? 'root-relative', baseUrl: canonical.site.baseUrl },
      pageCount: observed.length,
      contentTypes: Object.keys(canonical.schemas),
      clusters: [...new Set(observed.map(page => page.expectedCluster))],
      noise: { configured: config.noise, appliedEvents: observed.reduce((count, page) => count + page.noiseEvents.length, 0) },
      configuration: config,
      coverage,
      transport: { profile: transport.profile, ruleCount: transport.rules.length },
      seed: config.seed,
      generatorVersion: VERSION,
      canonicalSha256: canonicalDigest,
      answerSha256: manifest.truthSha256,
    }), { mode: 0o600 });
    await writeFile(join(staging, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./public/index.html"><title>Open test website</title></head><body><a href="./public/index.html">Open test website</a></body></html>\n');
    await writeFile(join(staging, 'private', 'run.json'), json({ durationMs: Math.round(performance.now() - started), peakRssBytes: process.resourceUsage().maxRSS * 1024, completedAt: new Date().toISOString(), status: 'complete' }), { mode: 0o600 });
    await rename(staging, target);
    return { directory: target, pageCount: observed.length, canonicalSha256: canonicalDigest, durationMs: Math.round(performance.now()-started), noiseEvents: observed.reduce((n,p) => n+p.noiseEvents.length,0) };
  } catch (error) {
    await writeFile(join(staging,'private','failure.json'),json({ status:'failed', message: error.message }), { mode: 0o600 });
    throw new Error(`Generation failed; diagnostic files retained at ${staging}: ${error.message}`, { cause: error });
  }
}
