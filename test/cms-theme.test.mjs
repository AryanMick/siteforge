import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generate } from '../src/generator.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { cmsContent, cmsPackageEntries, decodeRuns, splitPage, packagePageHtml, ORIGIN_PLACEHOLDER } from '../src/cms-theme.mjs';
import { downloadName } from '../src/fixture-lab/archive.mjs';

const plan = (domain, cmsProfile, framework, noise, seed, linkMode) => sitePlan({ name: 'Theme', domain, pagesPerSite: 24, seed, visualStyle: 'modern', randomness: 50, cmsProfile, noise, framework, sourceClutter: 'realistic', optionalFields: true, ...(linkMode ? { linkMode } : {}) }, 0);

function hasPhp() { try { execFileSync('php', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } }

test('every page is stored losslessly: <main> byte-for-byte, chrome rebuilt line-for-line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-cms-theme-'));
  try {
    for (const [domain, cms, framework, noise, seed, linkMode] of [['museum', 'wordpress', 'html', 'high', 11], ['government', 'drupal', 'html', 'high', 12], ['news', 'none', 'react', 'medium', 13], ['library', 'none', 'react', 'medium', 14, 'absolute']]) {
      const directory = join(root, domain);
      await generate(plan(domain, cms, framework, noise, seed, linkMode).config, directory);
      const answer = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
      for (const target of ['wordpress', 'drupal']) {
        const content = await cmsContent(directory, target);
        assert.equal(content.pages.length, answer.pages.length, `${domain} -> ${target}: every answer-key page is exported`);
        assert.deepEqual(content.pages.map(page => page.path), answer.pages.map(page => page.url));
        for (const page of content.pages) {
          // Fully qualified links to the generation address carry a placeholder the CMS replaces with its own address.
          const raw = await readFile(join(directory, 'public', page.path, 'index.html'), 'utf8');
          const html = packagePageHtml(raw, content.site.origin);
          if (linkMode === 'absolute') {
            assert.ok(html.includes(`href="${ORIGIN_PLACEHOLDER}/`), 'links use the placeholder');
            // As on the preview, href/src attributes and the client app's page data are rewritten (not srcset or <noscript>).
            assert.ok(!/\ssrc="https?:\/\/[^"]*siteforge\.test/.test(html), 'scripts and images load from the CMS');
          }
          const body = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('</body>'));
          const rebuilt = decodeRuns(content.lines, page.before) + page.main + decodeRuns(content.lines, page.after);
          // Only the CMS's own scripts (speculation rules, Drupal settings) are removed; they are re-added by the real CMS.
          let strip = text => (target === 'wordpress' && cms === 'wordpress' ? text.replace(/ id="menu-item-\d+"/g, '') : text).replace(/\n?<script type="speculationrules">[\s\S]*?<\/script>/g, '').replace(/\n?\s*<script type="application\/json" data-drupal-selector="drupal-settings-json">[\s\S]*?<\/script>/g, '');
          if (target === 'drupal') { const base = strip; strip = text => base(text).replace(/\n?\s*<div data-drupal-messages-fallback(="")? class="hidden"><\/div>/g, ''); }
          assert.equal(rebuilt, strip(body), `${domain} -> ${target} ${page.path}`);
          if (html.includes('<main')) assert.ok(page.main.startsWith('<main') || page.before === undefined || page.main.includes('<main'));
          assert.ok(!decodeRuns(content.lines, page.head).includes('<title>'), 'the CMS prints the title');
          assert.equal(page.name, answer.pages.find(record => record.url === page.path).title || page.path, 'post/node titles are the page titles, not the document title');
          if (target === 'wordpress') assert.doesNotMatch(decodeRuns(content.lines, page.head), /id="(global-styles-inline-css|wp-img-auto-sizes-contain-inline-css)"|<meta name="robots"|application\/rss\+xml|content="WordPress/, 'WordPress prints these itself');
        }
        if (target === 'wordpress') assert.ok(!content.staticFiles.some(file => file.startsWith('wp-includes/') || file === 'robots.txt'));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('splitPage keeps <main> exact and falls back to the whole body when <main> is missing', () => {
  const page = '<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<title>A &amp; B &#8211; Site</title>\n<link rel="canonical" href="/x/">\n<meta name="generator" content="WordPress 7">\n<link rel="stylesheet" href="/assets/site.css">\n</head>\n<body class="a b" data-x="1">\n<header>H</header>\n<main id="content"><h1>T</h1></main>\n<footer>F</footer>\n<script type="speculationrules">\n{}\n</script>\n</body></html>';
  const parts = splitPage(page.replace('<html>', '<html lang="en" data-wf-page="abc" data-ready="true" xmlns:og="http://ogp.me/ns#">'), 'wordpress', 'wordpress');
  assert.equal(parts.title, 'A & B – Site');
  assert.deepEqual(parts.headLines, ['<link rel="stylesheet" href="/assets/site.css">']);
  assert.equal(parts.classes, 'a b');
  assert.deepEqual(parts.htmlAttrs, [['data-wf-page', 'abc'], ['data-ready', 'true'], ['xmlns:og', 'http://ogp.me/ns#']]);
  const wpBody = '<!doctype html><html><head>\n<title>x</title>\n<meta name="generator" content="Joomla! - Open Source Content Management">\n<meta name="generator" content="WordPress 7.1">\n</head><body class="home page page-id-4 hs-site-page"><main><h1>x</h1></main></body></html>';
  assert.equal(splitPage(wpBody, 'wordpress', 'wordpress').classes, 'hs-site-page');
  assert.equal(splitPage(wpBody, 'wordpress', 'hubspot').classes, 'home page page-id-4 hs-site-page', 'only the WordPress imitation\'s classes are removed');
  assert.deepEqual(splitPage(wpBody, 'drupal').headLines, ['<meta name="generator" content="Joomla! - Open Source Content Management">'], 'other platforms keep their generator tag');
  assert.equal(parts.attrs, 'data-x="1"');
  assert.equal(parts.main, '<main id="content"><h1>T</h1></main>');
  assert.equal(parts.before, '\n<header>H</header>\n');
  assert.equal(parts.after, '\n<footer>F</footer>\n');
  const noMain = splitPage(page.replace('<main id="content">', '<div id="content">').replace('</main>', '</div>'), 'drupal');
  assert.equal(noMain.before, '');
  assert.ok(noMain.main.includes('<div id="content"><h1>T</h1></div>') && noMain.main.includes('<footer>F</footer>'));
  assert.equal(splitPage('<p>fragment</p>', 'drupal'), null);
});

test('theme packages contain installable WordPress and Drupal extensions with valid PHP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-cms-package-'));
  try {
    const directory = join(root, 'site');
    await generate(plan('library', 'wordpress', 'html', 'medium', 21).config, directory);
    const wordpress = await cmsPackageEntries(directory, 'wordpress');
    const wpNames = wordpress.entries.map(entry => entry.name);
    for (const file of ['style.css', 'functions.php', 'index.php', 'content/site.json', 'content/lines.json', 'content/pages.ndjson']) assert.ok(wpNames.includes(`${wordpress.root}/${file}`), file);
    assert.match(wordpress.entries.find(entry => entry.name.endsWith('/style.css')).data, /^\/\*\nTheme Name: SiteForge test site - /);
    assert.ok(wpNames.some(name => name.startsWith(`${wordpress.root}/siteforge-static/assets/`)));
    const wpCode = wordpress.entries.filter(entry => /\.php$/.test(entry.name)).map(entry => entry.data).join('\n');
    for (const feature of ['wp_head()', 'wp_footer()', 'body_class()', 'comment_form()', "dynamic_sidebar('siteforge-footer')", 'wp_safe_redirect(get_permalink', 'is_search()', "wp_nav_menu(['theme_location' => 'primary'", 'wp_update_nav_menu_item', "isset($vars['feed'])", "add_filter('oembed_request_post_id'", "['embed' => true]"]) assert.ok(wpCode.includes(feature), feature);
    assert.ok(!wpCode.includes("add_filter('redirect_canonical'"), 'WordPress keeps its own canonical redirects');
    // Big sites: batched import with flat memory, path buckets instead of one site-wide map, and a CLI-only importer.
    for (const feature of ['siteforge_save_progress', 'siteforge_forget()', "'siteforge_paths_' . (crc32($path)", 'siteforge_delete_posts($old)', "add_filter('pre_wp_unique_post_slug'", "$wpdb->query('START TRANSACTION')", 'SiteForge is importing test pages: ']) assert.ok(wpCode.includes(feature), feature);
    assert.ok(!wpCode.includes("get_option('siteforge_paths', [])"), 'no site-wide path map is loaded per request');
    const cli = wordpress.entries.find(entry => entry.name === `${wordpress.root}/siteforge-import.php`).data;
    assert.match(cli, /PHP_SAPI !== 'cli'[\s\S]*403[\s\S]*exit/, 'the importer refuses web requests');
    assert.match(cli, /wp-load\.php/); assert.match(cli, /siteforge_import\(30\)/);
    assert.match(wordpress.entries.find(entry => entry.name.endsWith('/README.txt')).data, /wp-content\/themes/);
    // Pages are streamed into the ZIP one at a time, not held in memory as one string.
    const pagesEntry = wordpress.entries.find(entry => entry.name.endsWith('/content/pages.ndjson'));
    assert.equal(typeof pagesEntry.open, 'function'); assert.equal(pagesEntry.data, undefined);
    // The scan keeps one byte per answer page (exported or not) and re-reads the answer pages for the second pass.
    assert.equal(wordpress.content.included.reduce((sum, flag) => sum + flag, 0), wordpress.content.total);
    assert.equal(wordpress.content.pageList, undefined, 'no list of every page is kept in memory');
    // The content hash drives re-import detection: same site, same hash; one changed page, a new hash.
    assert.equal((await cmsPackageEntries(directory, 'wordpress')).content.hash, wordpress.content.hash);
    const changedFile = join(directory, 'public', ...JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8')).pages[1].url.split('/').filter(Boolean), 'index.html');
    const original = await readFile(changedFile, 'utf8');
    await writeFile(changedFile, original.replace('</main>', '<p>changed</p></main>'));
    assert.notEqual((await cmsPackageEntries(directory, 'wordpress')).content.hash, wordpress.content.hash);
    await writeFile(changedFile, original);
    const drupal = await cmsPackageEntries(directory, 'drupal');
    const drNames = drupal.entries.map(entry => entry.name);
    for (const file of ['modules/custom/siteforge_content/siteforge_content.info.yml', 'modules/custom/siteforge_content/siteforge_content.install', 'modules/custom/siteforge_content/content/site.json', 'themes/custom/siteforge_theme/siteforge_theme.info.yml', 'themes/custom/siteforge_theme/templates/html.html.twig', 'themes/custom/siteforge_theme/templates/page.html.twig']) assert.ok(drNames.includes(file), file);
    const drupalCode = drupal.entries.filter(entry => !entry.path && !entry.name.endsWith('.json')).map(entry => entry.data).join('\n');
    // Drupal imports in time-limited batches too: first batch on install, then admin page loads, cron or drush.
    for (const feature of ['function siteforge_content_import(int $budget = 20)', 'siteforge_content_import(20);', "'siteforge_content.progress', [$done, $offset]", 'function siteforge_content_import_all()', 'function siteforge_content_cron()', 'function siteforge_content_finalize(', "entity.memory_cache')->deleteAll()", 'SiteForge is importing test pages: ', 'Reload to continue.', "'4xx-response', 'route_match'", 'ImportOnAdmin', "isAdminRoute()", "'administer site configuration'"]) assert.ok(drupalCode.includes(feature), feature);
    assert.ok(!drupalCode.includes("set('siteforge_content.aliases'"), 'no site-wide alias list in state');
    const installHook = drupal.entries.find(entry => entry.name.endsWith('.install')).data;
    assert.ok(!installHook.includes('MenuLinkContent::create'), 'the menu is built once, when the last batch completes');
    assert.ok(installHook.indexOf("theme_installer')->install") < installHook.indexOf('siteforge_content_import(20)'), 'the theme is installed before pages, so imported pages render during the import');
    for (const feature of ['siteforge_content_page_attachments', "'rel' => 'shortlink'", 'path_processor_outbound', 'system_breadcrumb_block', 'system_powered_by_block', 'drupal:comment', 'Comment::create', '{{ siteforge.comments }}', 'system_menu_block:main', 'MenuLinkContent::create', '{{ page.primary_menu }}', '{{ page.breadcrumb }}', '<js-bottom-placeholder', 'visually-hidden focusable skip-link', '<a id="main-content" tabindex="-1"></a>']) assert.ok(drupalCode.includes(feature), feature);
    const readEntry = async entry => { if (entry.data !== undefined) return entry.data; let text = ''; for await (const chunk of await entry.open()) text += chunk; return text; };
    const drupalData = Object.fromEntries(await Promise.all(drupal.entries.filter(entry => entry.name.includes('/content/')).map(async entry => [entry.name.split('/content/')[1], await readEntry(entry)])));
    const entryData = suffix => drupalData[suffix.replace('content/', '')];
    const meta = JSON.parse(entryData('content/site.json'));
    const lines = JSON.parse(entryData('content/lines.json'));
    const pageLines = entryData('content/pages.ndjson').split('\n').filter(Boolean);
    assert.equal(meta.front, '/');
    assert.equal(meta.total, pageLines.length, 'one page per line');
    assert.equal(meta.paths, undefined, 'site.json stays small at 100,000 pages: paths are only in pages.ndjson');
    assert.ok(pageLines.every(line => JSON.parse(line).path), 'every line is a whole page');
    assert.ok(lines.length < pageLines.length * 200, 'shared lines are stored once');
    const uses = new Map();
    for (const page of pageLines.map(line => JSON.parse(line))) {
      const indices = new Set();
      for (const run of [...page.head, ...page.before, ...page.after]) if (Array.isArray(run)) for (let i = run[0]; i < run[0] + run[1]; i++) indices.add(i);
      for (const i of indices) uses.set(i, (uses.get(i) ?? 0) + 1);
    }
    assert.ok(lines.every((_, i) => uses.get(i) >= 2), 'the shared table holds only lines used by two or more pages');
    assert.ok(pageLines.some(line => [...JSON.parse(line).before, ...JSON.parse(line).after].some(run => typeof run === 'string')), 'page-only lines stay in the page');
    if (hasPhp()) {
      for (const entry of [...wordpress.entries, ...drupal.entries].filter(entry => entry.data && /\.(php|install|module|theme)$/.test(entry.name))) {
        const file = join(root, 'lint', entry.name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, entry.data);
        assert.match(execFileSync('php', ['-l', file], { encoding: 'utf8' }), /No syntax errors/, entry.name);
      }
    }
    await assert.rejects(cmsContent(directory, 'joomla'), /cms must be one of/);
    await assert.rejects(cmsContent(join(root, 'not-a-site'), 'wordpress'), /No answer key in .*generated site folder/);
    // Hostile site names cannot break the PHP file or add style.css header fields.
    const keyPath = join(directory, 'private', 'answer-key.json');
    const key = JSON.parse(await readFile(keyPath, 'utf8'));
    key.site.name = 'Hall **// "Q" \'x\'\nTemplate: twentytwentyfive */ <?php';
    await writeFile(keyPath, JSON.stringify(key));
    const hostile = await cmsPackageEntries(directory, 'wordpress');
    const styleCss = hostile.entries.find(entry => entry.name.endsWith('/style.css')).data;
    assert.doesNotMatch(styleCss, /^Template:/m);
    assert.equal(styleCss.match(/\*\//g).length, 1, 'one comment terminator');
    if (hasPhp()) {
      const file = join(root, 'lint', 'hostile-functions.php');
      await writeFile(file, hostile.entries.find(entry => entry.name.endsWith('/functions.php')).data);
      assert.match(execFileSync('php', ['-l', file], { encoding: 'utf8' }), /No syntax errors/);
    }
    assert.match(hostile.entries.find(entry => entry.name.endsWith('/functions.php')).data, /define\('SITEFORGE_HASH', '[0-9a-f]{32}'\)/);
    assert.equal(downloadName({ name: 'My set' }, { id: 'site-001' }, 'drupal'), 'my-set-site-001-drupal-theme.zip');
  } finally { await rm(root, { recursive: true, force: true }); }
});
