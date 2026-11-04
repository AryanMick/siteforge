// Markup fingerprints of six more site platforms, beside the WordPress and Drupal profiles in renderers.mjs.
//
// Each profile adds what that platform's real pages carry outside the content: generator tags, asset URL shapes,
// inline configuration scripts, <html>/<body> attributes and classes, content wrappers inside <main> (after the page
// heading, so answer-key field locations are unchanged), end-of-body scripts, robots.txt and response headers.
// Every referenced asset is written into the public site as a small local file, so nothing points off-site and no
// link is broken. Identifiers are seeded tokens, not real account, portal or database IDs.
import { seedFor, escapeHtml } from '../site/util.mjs';
import { faviconPng, realScript, realStyle } from './site-runtime.mjs';

export const PLATFORM_PROFILES = ['joomla', 'squarespace', 'webflow', 'hubspot', 'aem', 'sitecore', 'wix', 'shopify', 'ghost'];
export const PLATFORM_LABELS = { joomla: 'Joomla', squarespace: 'Squarespace', webflow: 'Webflow', hubspot: 'HubSpot CMS', aem: 'Adobe Experience Manager', sitecore: 'Sitecore', wix: 'Wix', shopify: 'Shopify', ghost: 'Ghost' };

const hex = (site, length, ...parts) => {
  let out = '';
  for (let i = 0; out.length < length; i++) out += seedFor(site.seed, 'platform-hex', i, ...parts).toString(16).padStart(8, '0');
  return out.slice(0, length);
};
const num = (site, max, ...parts) => seedFor(site.seed, 'platform-num', ...parts) % max;
const slugOf = site => String(site.name ?? site.id ?? 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site';
const pascal = site => String(site.name ?? 'Site').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 3).map(word => word[0].toUpperCase() + word.slice(1)).join('') || 'Site';
// '<' is escaped so no inline value can close its <script>; '/' is left as is so absolute URLs stay visible to
// origin rewriting (preview rebasing, CMS exports).
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const pageKind = page => page.kind === 'home' ? 'home' : page.kind === 'listing' ? 'listing' : 'detail';

// Asset files per platform: [path, query]. Paths are local; queries mimic each platform's cache-busting shape.
function files(site) {
  const s = slugOf(site);
  switch (site.cmsProfile) {
    case 'joomla': {
      const v = hex(site, 32, 'joomla-media-version');
      return {
        styles: [['/media/templates/site/cassiopeia/css/template.min.css', v], ['/media/templates/site/cassiopeia/css/vendor/joomla-custom-elements/joomla-alert.min.css', '0.4.1'], ['/media/system/css/joomla-fontawesome.min.css', v]],
        scripts: [['/media/system/js/core.min.js', v], ['/media/templates/site/cassiopeia/js/template.min.js', v], ['/media/system/js/messages.min.js', v]],
        icons: [['/media/templates/site/cassiopeia/images/joomla-favicon.svg', '']],
      };
    }
    case 'squarespace': {
      const build = `${num(site, 9000, 'sqs-build') + 1000}-${hex(site, 12, 'sqs-build')}`;
      const base = `/static/vta/5c5a519771c10ba3470d8101/versioned-assets/${build}`;
      return { styles: [[`${base}/static.css`, ''], ['/site.css', `v=${1700000000000 + num(site, 90000000000, 'sqs-site-css')}`]], scripts: [[`${base}/scripts/@sqs/polyfiller/1.6/legacy.js`, ''], [`${base}/scripts/site-bundle.js`, '']], icons: [] };
    }
    case 'webflow': {
      const siteId = hex(site, 24, 'wf-site');
      return { styles: [[`/${siteId}/css/${s}.webflow.${hex(site, 9, 'wf-css')}.css`, '']], scripts: [[`/js/jquery-3.5.1.min.dc5e7f18c8.js`, `site=${siteId}`], [`/${siteId}/js/webflow.${hex(site, 9, 'wf-js')}.js`, '']], icons: [[`/${siteId}/images/favicon.png`, ''], [`/${siteId}/images/webclip.png`, '']] };
    }
    case 'hubspot': {
      const portal = 20000000 + num(site, 9000000, 'hs-portal');
      return {
        styles: [[`/hs-fs/hub/${portal}/hub_generated/template_assets/${num(site, 900000000, 'hs-tpl') + 100000000}/${1700000000000 + num(site, 90000000000, 'hs-tpl-ts')}/template_main.min.css`, ''], ['/hs/hsstatic/cos-i18n/static-1.53/bundles/project.css', '']],
        scripts: [['/hs/hsstatic/jquery-libs/static-1.4/jquery/jquery-1.11.2.js', ''], ['/hs/hsstatic/content-cwv-embed/static-1.1293/embed.js', ''], ['/hs/hsstatic/keyboard-accessible-menu-flyouts/static-1.17/bundles/project.js', ''], [`/hs/scriptloader/${portal}.js`, '']],
        icons: [], portal,
      };
    }
    case 'aem': {
      const lc = name => `lc-${hex(site, 32, 'aem-lc', name)}-lc`;
      return {
        styles: [[`/etc.clientlibs/${s}/clientlibs/clientlib-base.${lc('base')}.min.css`, ''], [`/etc.clientlibs/${s}/clientlibs/clientlib-site.${lc('site-css')}.min.css`, '']],
        scripts: [['/etc.clientlibs/core/wcm/components/commons/datalayer/v2/clientlibs/core.wcm.components.commons.datalayer.v2.' + lc('datalayer') + '.min.js', ''], [`/etc.clientlibs/clientlibs/granite/jquery.${lc('jquery')}.min.js`, ''], [`/etc.clientlibs/clientlibs/granite/utils.${lc('utils')}.min.js`, ''], [`/etc.clientlibs/${s}/clientlibs/clientlib-site.${lc('site-js')}.min.js`, '']],
        icons: [[`/content/dam/${s}/favicon.ico`, '']],
      };
    }
    case 'sitecore': {
      const theme = pascal(site);
      const rev = name => `rev=${hex(site, 32, 'sc-rev', name)}`;
      return {
        styles: [['/-/media/Base-Themes/Core-Libraries/styles/pre-optimized-min.css', rev('core-css')], ['/-/media/Base-Themes/Main-Theme/styles/pre-optimized-min.css', rev('main-css')], [`/-/media/Themes/${theme}/${theme}/${theme}/styles/pre-optimized-min.css`, rev('site-css')]],
        scripts: [['/-/media/Base-Themes/Core-Libraries/scripts/optimized-min.js', rev('core-js')], ['/-/media/Base-Themes/XA-API/Scripts/optimized-min.js', rev('xa-js')], [`/-/media/Themes/${theme}/${theme}/${theme}/scripts/optimized-min.js`, rev('site-js')]],
        icons: [[`/-/media/Project/${theme}/favicon.ico`, '']],
      };
    }
    case 'wix': {
      const v = num(site, 900, 'wix-thunderbolt') + 100;
      return {
        styles: [[`/_partials/wix-thunderbolt/dist/thunderbolt-1.${v}.0/main.${hex(site, 8, 'wix-css')}.min.css`, '']],
        scripts: [[`/_partials/wix-thunderbolt/dist/thunderbolt-1.${v}.0/main.${hex(site, 8, 'wix-js')}.bundle.min.js`, ''], [`/_partials/wix-thunderbolt/dist/thunderbolt-1.${v}.0/clientWorker.${hex(site, 8, 'wix-worker')}.bundle.min.js`, '']],
        icons: [['/_partials/wix-thunderbolt/favicon.png', '']],
      };
    }
    case 'shopify': {
      const shop = 50000000000 + num(site, 9000000000, 'shopify-shop');
      const v = name => `v=${num(site, 900000000, 'shopify-v', name) + 100000000}`;
      return {
        styles: [['/cdn/shop/t/3/assets/base.css', v('base')], ['/cdn/shop/t/3/assets/component-card.css', v('card')]],
        scripts: [['/cdn/shop/t/3/assets/global.js', v('global')], [`/cdn/shopifycloud/storefront/assets/storefront/load_feature-${hex(site, 10, 'shopify-feature')}.js`, `shop_id=${shop}`]],
        icons: [],
      };
    }
    case 'ghost': {
      const v = `v=${hex(site, 10, 'ghost-v')}`;
      return { styles: [['/assets/built/screen.css', v], ['/public/cards.min.css', v]], scripts: [['/assets/built/source.js', v], ['/public/cards.min.js', v], ['/public/portal.min.js', v]], icons: [] };
    }
    default: return { styles: [], scripts: [], icons: [] };
  }
}

export const isPlatform = site => PLATFORM_PROFILES.includes(site.cmsProfile);

export function platformAssetPaths(site) {
  if (!isPlatform(site)) return [];
  const { styles, scripts, icons } = files(site);
  return [...styles, ...scripts, ...icons].map(([path]) => path);
}

export function platformAssetBody(site, path) {
  const initial = escapeHtml(String(site.name ?? 'S').trim().charAt(0).toUpperCase() || 'S');
  if (path.endsWith('.svg')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#${hex(site, 6, 'favicon').replace(/^[89a-f]/, '1')}"/><text x="16" y="22" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${initial}</text></svg>\n`;
  if (/\.(ico|png)$/.test(path)) return faviconPng(site);
  if (path.endsWith('.css')) return realStyle(site, path);
  return realScript(site, path);
}

const link = (ctx, path, query) => ctx.href(query ? `${path}?${query}` : path);

export function platformHead(site, page, ctx) {
  const f = files(site);
  const name = escapeHtml(site.name);
  switch (site.cmsProfile) {
    case 'joomla': {
      const options = { 'joomla.jtext': { ERROR: 'Error', MESSAGE: 'Message', NOTICE: 'Notice', WARNING: 'Warning', JCLOSE: 'Close', JOK: 'OK', JOPEN: 'Open' }, 'system.paths': { root: '', rootFull: `${new URL('/', ctx.canonical).href}`, base: '', baseFull: `${new URL('/', ctx.canonical).href}` }, 'csrf.token': hex(site, 32, 'joomla-csrf') };
      return `<meta name="generator" content="Joomla! - Open Source Content Management">
${f.icons.map(([path]) => `<link href="${link(ctx, path)}" rel="icon" type="image/svg+xml">`).join('\n')}
${f.styles.map(([path, q]) => `<link href="${link(ctx, path, q)}" rel="stylesheet">`).join('\n')}
<script type="application/json" class="joomla-script-options new">${json(options)}</script>
<script src="${link(ctx, f.scripts[0][0], f.scripts[0][1])}"></script>
<script src="${link(ctx, f.scripts[1][0], f.scripts[1][1])}" defer></script>
<script src="${link(ctx, f.scripts[2][0], f.scripts[2][1])}" type="module"></script>`;
    }
    case 'squarespace': {
      const context = { facebookAppId: String(300000000000000 + num(site, 99999999999, 'sqs-fb')), rollups: {}, pageType: page.kind === 'detail' ? 50 : 2, website: { id: hex(site, 24, 'sqs-website'), identifier: slugOf(site), websiteType: 1, contentModifiedOn: 1767225600000 + num(site, 86400000, 'sqs-mod'), siteTitle: site.name, siteDescription: '', location: {}, shareButtonOptions: {}, authenticUrl: new URL('/', ctx.canonical).href, internalUrl: `https://${slugOf(site)}.squarespace.com`, baseUrl: new URL('/', ctx.canonical).href.replace(/\/$/, ''), timeZone: 'America/New_York', language: 'en-US' }, websiteSettings: { id: hex(site, 24, 'sqs-settings'), websiteId: hex(site, 24, 'sqs-website'), commentLikesAllowed: true, commentAnonAllowed: true, contactPhoneNumber: '', storeSettings: { currencyCode: 'USD' } }, collection: { title: page.title, id: hex(site, 24, 'sqs-collection', page.pageId), fullUrl: page.url, type: page.kind === 'detail' ? 1 : 10, permissionType: 1 }, templateId: '5c5a519771c10ba3470d8101', templateVersion: '7.1', pageFeatures: [1, 2, 4], impersonatedSession: false, tzData: {}, showAnnouncementBar: false };
      return `<!-- This is Squarespace. --><!-- ${escapeHtml(slugOf(site))} -->
<base href="">
<meta name="generator" content="Squarespace">
<script type="text/javascript" crossorigin="anonymous" defer="true" nomodule="nomodule" src="${link(ctx, f.scripts[0][0])}"></script>
<script>Static = window.Static || {}; Static.SQUARESPACE_CONTEXT = ${json(context)};</script>
<link rel="stylesheet" type="text/css" href="${link(ctx, f.styles[0][0])}">
<link rel="stylesheet" type="text/css" href="${link(ctx, f.styles[1][0], f.styles[1][1])}">`.replace('<base href="">\n', site.linkMode === 'base-relative' ? '' : '<base href="">\n');
    }
    case 'webflow':
      return `<meta content="${escapeHtml(page.title)}" property="og:title">
<meta content="Webflow" name="generator">
<link href="${link(ctx, f.styles[0][0])}" rel="stylesheet" type="text/css">
<script type="text/javascript">!function(o,c){var n=c.documentElement,t=" w-mod-";n.className+=t+"js",("ontouchstart"in o||o.DocumentTouch&&c instanceof DocumentTouch)&&(n.className+=t+"touch")}(window,document);</script>
<link href="${link(ctx, f.icons[0][0])}" rel="shortcut icon" type="image/x-icon">
<link href="${link(ctx, f.icons[1][0])}" rel="apple-touch-icon">`;
    case 'hubspot': {
      const id = 100000000000 + num(site, 900000000000, 'hs-page', page.pageId);
      return `<meta name="generator" content="HubSpot">
<link rel="stylesheet" href="${link(ctx, f.styles[0][0])}">
<link rel="stylesheet" href="${link(ctx, f.styles[1][0])}">
<script src="${link(ctx, f.scripts[0][0])}"></script>
<script>hsjQuery = window['jQuery'];</script>
<script>var hsVars = hsVars || {}; hsVars['language'] = 'en'; hsVars['page_id'] = '${id}';</script>`;
    }
    case 'aem':
      return `<meta name="template" content="${pageKind(page) === 'detail' ? 'article-page' : pageKind(page) === 'listing' ? 'landing-page' : 'home-page'}">
<link rel="icon" href="${link(ctx, f.icons[0][0])}">
${f.styles.map(([path]) => `<link rel="stylesheet" href="${link(ctx, path)}" type="text/css">`).join('\n')}
<script async src="${link(ctx, f.scripts[0][0])}"></script>`;
    case 'sitecore':
      return `<link rel="shortcut icon" href="${link(ctx, f.icons[0][0])}">
${f.styles.map(([path, q]) => `<link href="${link(ctx, path, q)}" rel="stylesheet" />`).join('\n')}
<meta property="twitter:card" content="summary_large_image" />`;
    case 'wix':
      return `<meta name="generator" content="Wix.com Website Builder"/>
<meta http-equiv="X-Wix-Meta-Site-Id" content="${hex(site, 8, 'wix-meta')}-${hex(site, 4, 'wix-meta-b')}-${hex(site, 4, 'wix-meta-c')}"/>
<meta http-equiv="X-Wix-Application-Instance-Id" content="${hex(site, 8, 'wix-app')}-${hex(site, 4, 'wix-app-b')}"/>
<meta http-equiv="X-Wix-Published-Version" content="${100 + num(site, 900, 'wix-version')}"/>
<meta http-equiv="etag" content="bug"/>
${f.styles.map(([path]) => `<link rel="stylesheet" href="${link(ctx, path)}">`).join('\n')}
<link rel="icon" sizes="192x192" href="${link(ctx, f.icons[0][0])}" type="image/png"/>`;
    case 'shopify': {
      const theme = { name: 'Dawn', id: 100000000000 + num(site, 900000000000, 'shopify-theme'), schema_name: 'Dawn', schema_version: '15.2.0', theme_store_id: 887, role: 'main' };
      return `<meta name="shopify-checkout-api-token" content="${hex(site, 32, 'shopify-token')}">
<meta id="shopify-digital-wallet" name="shopify-digital-wallet" content="/${50000000000 + num(site, 9000000000, 'shopify-shop')}/digital_wallets/dialog">
<script>var Shopify = Shopify || {};
Shopify.shop = "${escapeHtml(slugOf(site))}.myshopify.com";
Shopify.locale = "en";
Shopify.currency = {"active":"USD","rate":"1.0"};
Shopify.country = "US";
Shopify.theme = ${json(theme)};
Shopify.routes = Shopify.routes || {};
Shopify.routes.root = "/";</script>
${f.styles.map(([path, q]) => `<link href="${link(ctx, path, q)}" rel="stylesheet" type="text/css" media="all" />`).join('\n')}
<script src="${link(ctx, f.scripts[0][0], f.scripts[0][1])}" defer="defer"></script>`;
    }
    case 'ghost':
      return `<meta name="generator" content="Ghost 6.3">
${f.styles.map(([path, q]) => `<link rel="stylesheet" type="text/css" href="${link(ctx, path, q)}">`).join('\n')}
<style id="gh-members-styles">.gh-post-upgrade-cta-content,.gh-post-upgrade-cta{display:flex;flex-direction:column;align-items:center;text-align:center}</style>`;
    default: return '';
  }
}

export function platformHtmlAttrs(site, page) {
  if (site.cmsProfile === 'webflow') return ` data-wf-domain="${escapeHtml(new URL(site.baseUrl).host)}" data-wf-page="${hex(site, 24, 'wf-page', page.pageId)}" data-wf-site="${hex(site, 24, 'wf-site')}"`;
  if (site.cmsProfile === 'squarespace') return ' xmlns:og="http://opengraphprotocol.org/schema/"';
  return '';
}

export const platformLang = site => site.cmsProfile === 'joomla' ? 'en-gb' : site.cmsProfile === 'squarespace' ? 'en-US' : site.cmsProfile === 'sitecore' ? 'en' : 'en';
export const platformTitleSeparator = site => site.cmsProfile === 'joomla' ? ' - ' : site.cmsProfile === 'squarespace' ? ' &mdash; ' : site.cmsProfile === 'hubspot' ? ' | ' : ' | ';

export function platformBodyClasses(site, page) {
  const kind = pageKind(page);
  const type = escapeHtml(page.contentType ?? 'page');
  switch (site.cmsProfile) {
    case 'joomla': return ` site com_content wrapper-static view-${kind === 'home' ? 'featured' : kind === 'listing' ? 'category' : 'article'}${kind === 'listing' ? ' layout-blog' : ' no-layout'} no-task itemid-${101 + num(site, 400, 'joomla-item', page.pageId)}${kind === 'detail' ? ' has-sidebar-right' : ''}`;
    case 'squarespace': return ` header-overlay-alignment-center tweak-social-icons-style-solid tweak-blog-alternating-side-by-side-width-full primary-button-style-solid primary-button-shape-pill ${kind === 'detail' ? 'view-item' : 'view-list'} collection-type-${kind === 'detail' ? 'blog-basic-grid' : 'page'} collection-layout-default ${kind === 'home' ? 'homepage ' : ''}mobile-style-available sqs-seven-one`;
    case 'webflow': return ' body';
    case 'hubspot': return `   hs-content-id-${100000000000 + num(site, 900000000000, 'hs-page', page.pageId)} hs-${kind === 'detail' ? 'blog-post' : 'site-page'} page `;
    case 'aem': return ` page basicpage ${kind === 'detail' ? 'article-page' : 'landing-page'}`;
    case 'sitecore': return ' default-device bodyclass';
    case 'wix': return ' responsive';
    case 'shopify': return ` gradient template-${pageKind(page) === 'detail' ? 'page' : pageKind(page) === 'home' ? 'index' : 'collection'}`;
    case 'ghost': return ` ${pageKind(page) === 'detail' ? `post-template tag-${escapeHtml(page.contentType ?? 'page')}` : pageKind(page) === 'home' ? 'home-template' : 'tag-template'} gh-font-heading-inter gh-font-body-inter`;
    default: return '';
  }
}

export function platformBodyAttrs(site, page) {
  if (site.cmsProfile === 'squarespace') return ` id="collection-${hex(site, 24, 'sqs-collection', page.pageId)}"`;
  if (site.cmsProfile === 'aem') return ` id="${pageKind(page)}-${hex(site, 10, 'aem-page', page.pageId)}" data-cmp-link-accessibility-enabled data-cmp-link-accessibility-text="opens in a new tab" data-cmp-data-layer-enabled`;
  return '';
}

export function platformBodyStart(site, page) {
  if (site.cmsProfile === 'aem') {
    const id = `${pageKind(page)}-${hex(site, 10, 'aem-page', page.pageId)}`;
    const layer = { [id]: { '@type': `${slugOf(site)}/components/page`, 'repo:modifyDate': '2026-05-02T10:21:45Z', 'dc:title': page.title, 'xdm:template': `/conf/${slugOf(site)}/settings/wcm/templates/${pageKind(page) === 'detail' ? 'article-page' : 'landing-page'}`, 'xdm:language': 'en', 'xdm:tags': [], 'repo:path': `/content/${slugOf(site)}/us/en${page.url.replace(/\/$/, '') || ''}.html` } };
    return `\n<script>\n  window.adobeDataLayer = window.adobeDataLayer || [];\n  adobeDataLayer.push({\n    page: ${json(layer)},\n    event:'cmp:show',\n    eventInfo: { path: 'page.${id}' }\n  });\n</script>`;
  }
  if (site.cmsProfile === 'wix') return '\n<!--pageHtmlEmbeds.bodyStart start--><!--pageHtmlEmbeds.bodyStart end-->';
  if (site.cmsProfile === 'sitecore') return '\n<!-- #wrapper -->';
  return '';
}

// Markup the platform prints just before <main> (status/message containers).
export function platformBeforeMain(site) {
  if (site.cmsProfile === 'joomla') return '\n    <div id="system-message-container" aria-live="polite"></div>';
  if (site.cmsProfile === 'shopify') return '\n    <div id="shopify-section-announcement-bar" class="shopify-section announcement-bar-section"></div>';
  if (site.cmsProfile === 'squarespace') return '\n    <div class="sqs-announcement-bar-dropzone"></div>';
  return '';
}

// Content wrappers inside <main>, after the page heading.
export function platformContent(site, page, body) {
  const id = name => hex(site, 24, name, page.pageId);
  switch (site.cmsProfile) {
    case 'joomla':
      return pageKind(page) === 'detail'
        ? `<div class="com-content-article item-page" itemscope itemtype="https://schema.org/Article"><meta itemprop="inLanguage" content="en-GB"><div itemprop="articleBody" class="com-content-article__body">${body}</div></div>`
        : `<div class="com-content-category-blog blog" itemscope itemtype="https://schema.org/Blog"><div class="com-content-category-blog__items blog-items">${body}</div></div>`;
    case 'squarespace':
      return `<article class="sections" id="sections" data-page-sections="${id('sqs-sections')}"><section data-test="page-section" data-section-theme="" class="page-section layout-engine-section background-width--full-bleed section-height--medium content-width--wide horizontal-alignment--center vertical-alignment--middle" data-section-id="${id('sqs-section')}"><div class="content-wrapper"><div class="content"><div class="sqs-layout sqs-grid-12 columns-12" data-type="page" data-updated-on="${1767225600000 + num(site, 86400000, 'sqs-upd', page.pageId)}" id="page-${id('sqs-page')}"><div class="row sqs-row"><div class="col sqs-col-12 span-12"><div class="sqs-block html-block sqs-block-html" data-block-type="2" data-border-radii="&#123;&quot;topLeft&quot;:&#123;&quot;unit&quot;:&quot;px&quot;,&quot;value&quot;:0.0&#125;&#125;" id="block-${hex(site, 20, 'sqs-block', page.pageId)}"><div class="sqs-block-content"><div class="sqs-html-content">${body}</div></div></div></div></div></div></div></div></section></article>`;
    case 'webflow':
      return `<div class="w-layout-blockcontainer container w-container"><div class="rich-text-block w-richtext">${body}</div></div>`;
    case 'hubspot': {
      const widget = 1700000000000 + num(site, 90000000000, 'hs-widget', page.pageId);
      return `<div class="body-container-wrapper"><div class="body-container body-container--${pageKind(page) === 'detail' ? 'blog-post' : 'page'}"><div class="row-fluid-wrapper row-depth-1 row-number-1 dnd-section"><div class="row-fluid "><div class="span12 widget-span widget-type-cell dnd-column" style="" data-widget-type="cell" data-x="0" data-w="12"><div class="row-fluid-wrapper row-depth-1 row-number-2 dnd-row"><div class="row-fluid "><div class="span12 widget-span widget-type-custom_widget dnd-module" style="" data-widget-type="custom_widget" data-x="0" data-w="12"><div id="hs_cos_wrapper_widget_${widget}" class="hs_cos_wrapper hs_cos_wrapper_widget hs_cos_wrapper_type_module" style="" data-hs-cos-general-type="widget" data-hs-cos-type="module"><span id="hs_cos_wrapper_widget_${widget}_" class="hs_cos_wrapper hs_cos_wrapper_widget hs_cos_wrapper_type_rich_text" style="" data-hs-cos-general-type="widget" data-hs-cos-type="rich_text">${body}</span></div></div></div></div></div></div></div></div></div></div>`;
    }
    case 'aem': {
      const text = hex(site, 10, 'aem-text', page.pageId);
      const layer = escapeHtml(JSON.stringify({ [`text-${text}`]: { '@type': 'core/wcm/components/text/v2/text', 'repo:modifyDate': '2026-05-02T10:21:45Z', 'xdm:text': '' } }));
      return `<div class="root container responsivegrid"><div id="container-${hex(site, 10, 'aem-container', page.pageId)}" class="cmp-container"><div class="aem-Grid aem-Grid--12 aem-Grid--default--12 "><div class="text aem-GridColumn aem-GridColumn--default--12"><div data-cmp-data-layer="${layer}" id="text-${text}" class="cmp-text">${body}</div></div></div></div></div>`;
    }
    case 'sitecore':
      return `<div class="row"><div class="component rich-text col-12" id="${hex(site, 8, 'sc-a', page.pageId)}-${hex(site, 4, 'sc-b', page.pageId)}-${hex(site, 4, 'sc-c', page.pageId)}"><div class="component-content">${body}</div></div></div>`;
    case 'wix':
      return `<section id="comp-${hex(site, 8, 'wix-section', page.pageId)}" class="wixui-section" tabindex="-1"><div data-testid="columns" class="comp-${hex(site, 8, 'wix-columns', page.pageId)}-columns"><div id="comp-${hex(site, 8, 'wix-column', page.pageId)}" class="wixui-column-strip__column"><div data-testid="richTextElement" class="wixui-rich-text" id="comp-${hex(site, 8, 'wix-text', page.pageId)}">${body}</div></div></div></section>`;
    case 'shopify':
      return `<div id="shopify-section-template--${num(site, 90000000000000, 'shopify-template', page.pageId)}__main" class="shopify-section section"><div class="page-width page-width--narrow section-template--main-padding"><div class="rte">${body}</div></div></div>`;
    case 'ghost':
      return `<article class="gh-article ${pageKind(page) === 'detail' ? 'post' : 'page'}"><section class="gh-content gh-canvas is-body">${body}</section></article>`;
    default: return body;
  }
}

export function platformBodyEnd(site, page, ctx) {
  const f = files(site);
  switch (site.cmsProfile) {
    case 'squarespace':
      return `\n<script defer="defer" src="${link(ctx, f.scripts[1][0])}" type="text/javascript"></script>\n<script type="text/javascript" data-sqs-type="imageloader-bootstrapper">(function() {if(window.ImageLoader) { window.ImageLoader.bootstrap({}, document); }})();</script>\n<script>window.Squarespace && Squarespace.afterBodyLoad && Squarespace.afterBodyLoad(Y);</script>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" style="display:none" data-usage="social-icons-svg"><symbol id="instagram-unauth-icon" viewBox="0 0 64 64"><path d="M46.91,25.816"/></symbol></svg>\n`;
    case 'webflow':
      return `\n<script src="${link(ctx, f.scripts[0][0], f.scripts[0][1])}" type="text/javascript" crossorigin="anonymous"></script>\n<script src="${link(ctx, f.scripts[1][0])}" type="text/javascript"></script>\n`;
    case 'hubspot': {
      const id = 100000000000 + num(site, 900000000000, 'hs-page', page.pageId);
      const vars = { render_id: `${hex(site, 8, 'hs-render', page.pageId)}-${hex(site, 4, 'hs-r2', page.pageId)}-${hex(site, 4, 'hs-r3', page.pageId)}`, ticks: 1767225600000 + num(site, 86400000, 'hs-ticks', page.pageId), page_id: id, content_group_id: 0, portal_id: f.portal, app_hs_base_url: 'https://app.hubspot.com', cp_hs_base_url: 'https://cp.hubspot.com', language: 'en', analytics_page_type: page.kind === 'detail' ? 'blog-post' : 'standard-page', scp_content_type: '', analytics_page_id: String(id), category_id: page.kind === 'detail' ? 3 : 1, folder_id: 0, is_hubspot_user: false };
      return `\n${f.scripts.slice(1, 3).map(([path]) => `<script src="${link(ctx, path)}"></script>`).join('\n')}\n<!-- Start of HubSpot Analytics Code -->\n<script type="text/javascript">\nvar _hsq = _hsq || [];\n_hsq.push(["setContentType", "${page.kind === 'detail' ? 'blog-post' : 'standard-page'}"]);\n_hsq.push(["setCanonicalUrl", ${JSON.stringify(ctx.canonical).replaceAll('<', '\\u003c')}]);\n_hsq.push(["setPageId", "${id}"]);\n_hsq.push(["setContentMetadata", {"contentPageId":${id},"legacyPageId":"${id}","contentFolderId":null,"contentGroupId":null,"abTestId":null,"languageVariantId":${id},"languageCode":"en"}]);\n</script>\n<script type="text/javascript" id="hs-script-loader" async defer src="${link(ctx, f.scripts[3][0])}"></script>\n<!-- End of HubSpot Analytics Code -->\n<script type="text/javascript">\nvar hsVars = ${json(vars)};\n</script>\n`;
    }
    case 'aem':
      return `\n${f.scripts.slice(1).map(([path]) => `<script src="${link(ctx, path)}"></script>`).join('\n')}\n`;
    case 'sitecore':
      return `\n<input name="__RequestVerificationToken" type="hidden" value="${Buffer.from(hex(site, 64, 'sc-token', page.pageId), 'hex').toString('base64url')}" />\n${f.scripts.map(([path, q]) => `<script src="${link(ctx, path, q)}"></script>`).join('\n')}\n<!-- /#wrapper -->\n`;
    case 'wix':
      return `\n<script type="application/json" id="wix-viewer-model">${json({ siteFeatures: ['assetsLoader', 'tpaCommons', 'pages', 'seo'], site: { metaSiteId: hex(site, 8, 'wix-meta'), siteId: hex(site, 8, 'wix-site'), externalBaseUrl: new URL('/', ctx.canonical).href.replace(/\/$/, ''), isResponsive: true }, language: { userLanguage: 'en' }, requestUrl: ctx.canonical, fleetConfig: { fleetName: 'thunderbolt-renderer', type: 'Rollout', code: 0 } })}</script>\n<script src="${link(ctx, f.scripts[0][0])}" async></script>\n<script src="${link(ctx, f.scripts[1][0])}" defer></script>\n`;
    case 'shopify':
      return `\n<script src="${link(ctx, f.scripts[1][0], f.scripts[1][1])}" defer="defer"></script>\n<script>window.ShopifyAnalytics = window.ShopifyAnalytics || {}; window.ShopifyAnalytics.meta = window.ShopifyAnalytics.meta || {}; window.ShopifyAnalytics.meta.currency = 'USD'; var meta = {"page":{"pageType":"${page.kind === 'detail' ? 'page' : page.kind === 'home' ? 'home' : 'collection'}","resourceType":"page","resourceId":${100000000000 + num(site, 900000000000, 'shopify-page', page.pageId)}}};</script>\n<div id="shopify-block-${hex(site, 22, 'shopify-block')}" class="shopify-block shopify-app-block"></div>\n`;
    case 'ghost':
      return `\n<script src="${link(ctx, f.scripts[0][0], f.scripts[0][1])}"></script>\n<script src="${link(ctx, f.scripts[1][0], f.scripts[1][1])}"></script>\n<script defer src="${link(ctx, f.scripts[2][0], f.scripts[2][1])}" data-i18n="true" data-ghost="${escapeHtml(new URL('/', ctx.canonical).href)}" data-key="${hex(site, 26, 'ghost-key')}" data-api="${escapeHtml(new URL('/ghost/api/content/', ctx.canonical).href)}" data-locale="en" crossorigin="anonymous"></script>\n`;
    default: return '';
  }
}

export function platformRobots(site, sitemap) {
  switch (site.cmsProfile) {
    case 'joomla': return `# If the Joomla site is installed within a folder\n# eg www.example.com/joomla/ then the robots.txt file\n# MUST be moved to the site root\n# eg www.example.com/robots.txt\n# AND the joomla folder name MUST be prefixed to all of the\n# paths.\nUser-agent: *\n${['/administrator/', '/api/', '/bin/', '/cache/', '/cli/', '/components/', '/includes/', '/installation/', '/language/', '/layouts/', '/libraries/', '/logs/', '/modules/', '/plugins/', '/tmp/'].map(path => `Disallow: ${path}`).join('\n')}\n\n${sitemap}`;
    case 'squarespace': return `# Squarespace Robots Txt\n\nUser-agent: *\n${['/config', '/search', '/account$', '/account/', '/commerce/digital-download/', '/api/', '/static/', '/*?author=*', '/*&author=*', '/*?tag=*', '/*&tag=*', '/*?month=*', '/*&month=*', '/*?view=*', '/*&view=*', '/*?format=json', '/*&format=json', '/*?format=page-context', '/*&format=page-context', '/*?format=main-content', '/*&format=main-content', '/*?format=json-pretty', '/*&format=json-pretty', '/*?format=ical', '/*&format=ical', '/*?reversePaginate=*', '/*&reversePaginate=*'].map(path => `Disallow: ${path}`).join('\n')}\n\n${sitemap}`;
    case 'hubspot': return `User-agent: *\nDisallow: /_hcms/preview/\nDisallow: /hs/manage-preferences/\nDisallow: /hs/preferences-center/\nDisallow: /_hcms/livechat/\n\n${sitemap}`;
    case 'aem': return `User-agent: *\nDisallow: /bin/\nDisallow: /libs/\nDisallow: /apps/\nDisallow: /etc/\nAllow: /etc.clientlibs/\nDisallow: /content/*.infinity.json\nDisallow: /*.model.json$\n\n${sitemap}`;
    case 'sitecore': return `User-agent: *\nDisallow: /sitecore/\nDisallow: /sitecore%20modules/\nDisallow: /-/speak/\nDisallow: /layouts/\nDisallow: /api/sitecore/\n\n${sitemap}`;
    case 'wix': return `# By Wix\nUser-agent: *\nAllow: /\n\n# Optimization for Google Ads Bot\nUser-agent: AdsBot-Google-Mobile\nUser-agent: AdsBot-Google\nDisallow: /_api/*\nDisallow: /_partials*\nDisallow: /pro-gallery-webapp/v1/galleries/*\n\n# Block PetalBot\nUser-agent: PetalBot\nDisallow: /\n\n${sitemap}`;
    case 'shopify': return `# we use Shopify as our ecommerce platform\n\nUser-agent: *\n${['/a/downloads/-/*', '/admin', '/cart', '/orders', '/checkouts/', '/checkout', '/carts', '/account', '/collections/*sort_by*', '/*/collections/*sort_by*', '/collections/*+*', '/collections/*%2B*', '/blogs/*+*', '/*/blogs/*%2B*', '/*?*oseid=*', '/*preview_theme_id*', '/*preview_script_id*', '/policies/', '/search', '/apple-app-site-association', '/.well-known/shopify/monorail', '/cdn/wpm/*.js', '/recommendations/products'].map(path => `Disallow: ${path}`).join('\n')}\n\n${sitemap}`;
    case 'ghost': return `User-agent: *\n${sitemap}Disallow: /ghost/\nDisallow: /email/\nDisallow: /members/api/comments/counts/\nDisallow: /r/\nDisallow: /webmentions/receive/\n`;
    default: return `User-agent: *\nAllow: /\n${sitemap}`;
  }
}

// Response headers the platform's hosting sends (realistic-source previews only).
export function platformHeaders(profile, seed = 0) {
  switch (profile) {
    case 'joomla': return { Server: 'Apache', 'X-Powered-By': 'PHP/8.2.20', 'Content-Language': 'en-gb' };
    case 'squarespace': return { Server: 'Squarespace', 'X-ContextId': `${(seed >>> 0).toString(36)}/${((seed * 7) >>> 0).toString(36)}`, 'X-Frame-Options': 'SAMEORIGIN' };
    case 'webflow': return { Server: 'cloudflare', 'X-Lambda-Id': `${((seed * 13) >>> 0).toString(16)}-wf`, 'X-Cluster-Name': 'us-east-1-prod-hosting-red' };
    case 'hubspot': return { Server: 'cloudflare', 'X-Powered-By': 'HubSpot', 'X-HS-Cache-Config': 'BrowserNoCache-EdgeMedium', 'X-HS-Content-Id': String(100000000000 + (seed % 900000000000)) };
    case 'aem': return { Server: 'Apache', 'X-Dispatcher': 'dispatcher1useast1', 'X-Vhost': 'publish' };
    case 'sitecore': return { Server: 'Microsoft-IIS/10.0', 'X-Powered-By': 'ASP.NET', 'X-AspNet-Version': '4.0.30319', 'Set-Cookie': `SC_ANALYTICS_GLOBAL_COOKIE=${((seed * 31) >>> 0).toString(16).padStart(8, '0')}0000000000000000000000|False; expires=Mon, 30-Oct-2036 00:00:00 GMT; path=/; HttpOnly` };
    case 'wix': return { Server: 'Pepyaka', 'X-Wix-Request-Id': `${((seed * 17) >>> 0).toString(10)}.${((seed * 19) >>> 0).toString(10)}`, 'X-Content-Type-Options': 'nosniff' };
    case 'shopify': return { Server: 'cloudflare', 'Powered-By': 'Shopify', 'X-ShopId': String(50000000000 + num({ seed }, 9000000000, 'shopify-shop')), 'X-ShardId': String(100 + (seed % 300)) };
    case 'ghost': return { Server: 'nginx', 'X-Powered-By': 'Express', 'Cache-Control': 'public, max-age=0' };
    default: return {};
  }
}

// Attributes of the site header and footer as each platform's templates print them (class lists keep site-header /
// site-footer so the site's own CSS still applies).
export function platformHeaderAttrs(site, variant) {
  switch (site.cmsProfile) {
    case 'joomla': return ` class="header container-header full-width site-header${variant}"`;
    case 'squarespace': return ` id="header" class="header theme-col--primary site-header${variant}" data-section-theme="" data-controller="Header" data-current-styles="&#123;&quot;layout&quot;: &quot;navRight&quot;&#125;"`;
    case 'webflow': return ` data-collapse="medium" data-animation="default" data-duration="400" data-easing="ease" role="banner" class="navbar w-nav site-header${variant}"`;
    case 'hubspot': return ` class="header site-header${variant}" data-global-resource-path="${escapeHtml(slugOf(site))}-theme/templates/partials/header.html"`;
    case 'aem': return ` class="experiencefragment cmp-experiencefragment cmp-experiencefragment--header site-header${variant}" id="experiencefragment-${hex(site, 10, 'aem-xf-header')}"`;
    case 'sitecore': return ` id="header" class="container-fluid site-header${variant}"`;
    case 'wix': return ` id="SITE_HEADER" class="wixui-header site-header${variant}" tabindex="-1"`;
    case 'shopify': return ` class="header header--middle-left header--mobile-center page-width header--has-menu site-header${variant}"`;
    case 'ghost': return ` id="gh-navigation" class="gh-navigation is-left-logo gh-outer site-header${variant}"`;
    default: return null;
  }
}

export function platformFooterAttrs(site, variant) {
  switch (site.cmsProfile) {
    case 'joomla': return ` class="container-footer footer full-width site-footer${variant}"`;
    case 'squarespace': return ` class="sections site-footer${variant}" id="footer-sections" data-footer-sections`;
    case 'webflow': return ` class="footer w-container site-footer${variant}"`;
    case 'hubspot': return ` class="footer site-footer${variant}" data-global-resource-path="${escapeHtml(slugOf(site))}-theme/templates/partials/footer.html"`;
    case 'aem': return ` class="experiencefragment cmp-experiencefragment cmp-experiencefragment--footer site-footer${variant}" id="experiencefragment-${hex(site, 10, 'aem-xf-footer')}"`;
    case 'sitecore': return ` id="footer" class="container-fluid site-footer${variant}"`;
    case 'wix': return ` id="SITE_FOOTER" class="wixui-footer site-footer${variant}" tabindex="-1"`;
    case 'shopify': return ` class="footer color-scheme-1 gradient section-sections--footer-padding site-footer${variant}"`;
    case 'ghost': return ` class="gh-foot gh-outer site-footer${variant}"`;
    default: return null;
  }
}
