import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as parse5 from 'parse5';
import { generate } from '../src/site/generator.mjs';
import { sitePlan } from '../src/fixture-lab/config.mjs';
import { PLATFORM_PROFILES, platformHeaders } from '../src/render/platforms.mjs';
import { walk, attr } from '../src/site/util.mjs';

const FINGERPRINTS = {
  joomla: [/<meta name="generator" content="Joomla! - Open Source Content Management">/, /class="joomla-script-options new"/, /\/media\/system\/js\/core\.min\.js\?/, /com_content/, /id="system-message-container"/],
  squarespace: [/<!-- This is Squarespace\. -->/, /Static\.SQUARESPACE_CONTEXT = /, /<body id="collection-[0-9a-f]{24}"/, /sqs-block-html/, /sqs-seven-one/],
  webflow: [/<meta content="Webflow" name="generator">/, /data-wf-page="[0-9a-f]{24}" data-wf-site="[0-9a-f]{24}"/, /w-richtext/, /\.webflow\.[0-9a-f]{9}\.css/],
  hubspot: [/<meta name="generator" content="HubSpot">/, /hs_cos_wrapper_type_rich_text/, /hs-content-id-\d+/, /id="hs-script-loader"/, /var hsVars = /],
  aem: [/\/etc\.clientlibs\/[^"]+\.lc-[0-9a-f]{32}-lc\.min\.css/, /data-cmp-data-layer-enabled/, /aem-GridColumn/, /adobeDataLayer\.push/, /cmp-text/],
  sitecore: [/\/-\/media\/Base-Themes\/Core-Libraries\/styles\/pre-optimized-min\.css\?rev=/, /__RequestVerificationToken/, /component rich-text/, /default-device bodyclass/],
  wix: [/<meta name="generator" content="Wix\.com Website Builder"\/>/, /X-Wix-Meta-Site-Id/, /id="wix-viewer-model"/, /class="wixui-rich-text"/, /\/_partials\/wix-thunderbolt\/dist\//],
  shopify: [/Shopify\.theme = \{"name":"Dawn"/, /shopify-checkout-api-token/, /\/cdn\/shop\/t\/3\/assets\/base\.css\?v=/, /id="shopify-section-template--\d+__main"/, /class="rte"/],
  ghost: [/<meta name="generator" content="Ghost 6\.3">/, /\/assets\/built\/screen\.css\?v=/, /data-api="[^"]*\/ghost\/api\/content\/"/, /class="gh-content gh-canvas is-body"/],
};
const plan = (cmsProfile, seed) => sitePlan({ name: 'Platform', domain: 'library', pagesPerSite: 20, seed, visualStyle: 'modern', randomness: 50, cmsProfile, noise: 'clean', sourceClutter: 'realistic' }, 0);

test('platform profiles carry their fingerprints, keep the page contract and reference only existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'siteforge-platforms-'));
  try {
    const plainDirectory = join(root, 'none');
    await generate(plan('none', 31).config, plainDirectory);
    const plain = JSON.parse(await readFile(join(plainDirectory, 'private', 'answer-key.json'), 'utf8'));
    for (const profile of PLATFORM_PROFILES) {
      const directory = join(root, profile);
      await generate(plan(profile, 31).config, directory);
      const answer = JSON.parse(await readFile(join(directory, 'private', 'answer-key.json'), 'utf8'));
      assert.deepEqual(answer.pages.map(page => [page.url, page.fields, page.fieldLocations]), plain.pages.map(page => [page.url, page.fields, page.fieldLocations]), `${profile}: answer key matches the plain site`);
      const robots = await readFile(join(directory, 'public', 'robots.txt'), 'utf8');
      assert.match(robots, /Sitemap: /, `${profile}: robots keeps the sitemap`);
      for (const page of answer.pages.filter((item, index, all) => all.findIndex(other => other.kind === item.kind) === index)) {
        const html = await readFile(join(directory, 'public', ...page.url.split('/').filter(Boolean), 'index.html'), 'utf8');
        for (const pattern of FINGERPRINTS[profile]) assert.match(html, pattern, `${profile}/${page.kind}: ${pattern}`);
        assert.doesNotMatch(html, /wp-content|wp-includes|drupal-settings-json|sites\/default\/files/, `${profile}: no WordPress/Drupal fingerprints`);
        const document = parse5.parse(html);
        assert.equal(walk(document, node => node.tagName === 'main').length, 1);
        assert.equal(walk(document, node => node.tagName === 'h1').length, 1);
        assert.equal(walk(document, node => node.tagName === 'main')[0].parentNode.tagName, 'body');
        const ids = walk(document, node => attr(node, 'id') !== undefined).map(node => attr(node, 'id'));
        assert.equal(new Set(ids).size, ids.length, `${profile}: duplicate ids`);
        for (const node of walk(document, item => ['script', 'img'].includes(item.tagName) && attr(item, 'src') || item.tagName === 'link' && ['stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon'].includes(attr(item, 'rel')))) {
          const url = new URL(attr(node, node.tagName === 'link' ? 'href' : 'src'), `http://example.test${page.url}`);
          assert.equal(url.host, 'example.test');
          await stat(join(directory, 'public', ...decodeURIComponent(url.pathname).split('/').filter(Boolean)));
        }
      }
      assert.ok(platformHeaders(profile, 7).Server, `${profile}: server header`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
